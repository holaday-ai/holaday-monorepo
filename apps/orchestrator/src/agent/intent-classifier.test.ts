/**
 * Phase 24 RC follow-up — generate-default intent classifier.
 *
 * Default flipped from 'browser' to 'generate' after RC data showed
 * 72/165 timeouts were pure-generation tasks routed to a 10-slot
 * BrowserPool. Browser is reserved for tasks that genuinely need a
 * live page: explicit URL, browser-action verb, or named site.
 *
 * No Haiku call — keyword rules only (cost saving + determinism).
 * Tests pin every category so a future "default to browser" regression
 * is caught at unit time.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { classifyExecutionMode } from './intent-classifier.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

describe('classifyExecutionMode — default is generate', () => {
  it('empty intent → generate (was browser, flipped for RC)', async () => {
    const out = await classifyExecutionMode({ intent: '', logger: fakeLogger() });
    expect(out).toBe('generate');
  });

  it('pure translation task → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我把这段话翻译成英文',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('plan-writing task → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '写一份产品发布计划',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('analysis task → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '分析中国新能源汽车 2026 年的市场格局',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('SOP / 术语表 → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我整理一份运维 SOP',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('vague short intent → generate (no browser tells)', async () => {
    const out = await classifyExecutionMode({
      intent: '生成一个产品名',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });
});

describe('classifyExecutionMode — browser routes', () => {
  it('explicit https URL → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '总结 https://example.com/article 这篇文章',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('http URL → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '抓 http://blog.example.org 的最新文章',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('www-prefixed bare host → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '看一下 www.zhihu.com 上的热榜',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('verb 搜索 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索一下 iPhone 16 的价格',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('verb 查找 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '查找深圳的 PM 岗位',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('verb 打开 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '打开知乎热榜',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('verb 登录 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '登录 Gmail 看看新邮件',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('verb 下单 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我下单一杯瑞幸',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('verb 比价 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我比价 Bose QC45',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('site name 京东 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '京东最近有什么手机促销',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('site name 小红书 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '小红书最近的爆款笔记是什么',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('site name 知乎 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '知乎上 AI Agent 的高赞回答',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('site name 微博 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '微博热搜榜单',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('English browser verb open + site → browser', async () => {
    const out = await classifyExecutionMode({
      intent: 'open github.com/anthropics and find recent stars',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });
});

describe('classifyExecutionMode — explicit skill hint short-circuit', () => {
  it('content-creator skill stays generate even with site name in intent', async () => {
    const out = await classifyExecutionMode({
      intent: '为知乎账号写一篇 AI Agent 普及文',
      skillId: 'content-creator',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('xiaohongshu skill is browser even on a generate-leaning intent', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我写一段笔记',
      skillId: 'xiaohongshu',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('unknown skill falls through to keyword logic', async () => {
    const out = await classifyExecutionMode({
      intent: '写一份方案',
      skillId: 'made-up-role-id',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });
});

describe('classifyExecutionMode — does not call the API', () => {
  it('classifier never invokes the Anthropic client (cost-free)', async () => {
    const create = vi.fn();
    const client = {
      messages: { create },
    } as unknown as import('@anthropic-ai/sdk').default;
    await classifyExecutionMode({
      intent: '写一段产品文案',
      logger: fakeLogger(),
      client,
    });
    await classifyExecutionMode({
      intent: '打开京东搜手机',
      logger: fakeLogger(),
      client,
    });
    await classifyExecutionMode({
      intent: '完全模糊的需求',
      logger: fakeLogger(),
      client,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
