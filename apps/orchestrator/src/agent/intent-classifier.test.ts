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

describe('classifyExecutionMode — pre-Firecrawl regression suite (site/URL without interaction now scrape)', () => {
  // Phase 24 RC follow-up — the original 2-route classifier sent
  // every URL / site mention to browser. With Firecrawl as a third
  // route, the same intents now route to 'scrape' UNLESS the
  // intent also carries an interaction verb (登录/打开/下单/...).
  // These tests pin the new behaviour so a future "always-browser"
  // regression is caught at unit time.
  it('site name 知乎 (no interaction) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '知乎上 AI Agent 的高赞回答',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('site name 微博 (no interaction) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '微博热搜榜单',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('English search verb on a site → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: 'find recent stars on github.com/anthropics',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
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

describe('classifyExecutionMode — scrape route (Firecrawl path)', () => {
  it('search verb + site name → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索小红书上露营装备热门笔记',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('查询 verb (info-only) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '查询苹果最新财报',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('research / 研究 → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '研究中国新能源车 2026 年市场格局',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('查找 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '查找深圳的 PM 岗位',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('搜索 verb alone → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索 iPhone 16 的价格',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('URL with 分析 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '总结 https://example.com/article 这篇文章',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('URL with 提取 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '提取 https://blog.example.org 上的关键观点',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('site name only (implicit info lookup) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '知乎上 AI Agent 的高赞回答',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('对比 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '对比拼多多和京东的会员价格',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });
});

describe('classifyExecutionMode — browser overrides scrape (interaction verbs)', () => {
  it('打开 + site → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '打开京东帮我搜蓝牙耳机',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('登录 + site → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '登录淘宝查看我的订单',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('下单 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我下单一杯瑞幸',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('点击 / 提交 / 填写 → browser', async () => {
    for (const verb of ['点击', '提交', '填写']) {
      const out = await classifyExecutionMode({
        intent: `${verb}表单`,
        logger: fakeLogger(),
      });
      expect(out).toBe('browser');
    }
  });

  it('比价 → browser (BOSS spec puts comparison shopping on browser path)', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我比价 Bose QC45',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });
});

describe('classifyExecutionMode — generate stays generate', () => {
  it('translation → generate (no scrape needed)', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我把这段话翻译成英文',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('writing prose → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '写一份产品发布计划',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('SOP write → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我整理一份运维 SOP',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('analysis WITHOUT search/site/url → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '分析这段商业模式有哪些风险点',
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
