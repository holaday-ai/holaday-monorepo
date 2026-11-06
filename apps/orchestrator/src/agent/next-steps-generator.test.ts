import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import {
  NEXT_STEPS_SYSTEM_PROMPT,
  filterNextSteps,
  generateNextSteps,
  nextStepsUserMessage,
  parseNextSteps,
  parseTaskTitle,
  relevantNextSteps,
  validNextSteps,
  withoutEchoes,
} from './next-steps-generator.js';

/** FIX-57 #4: next steps that continue this result, in the assistant's voice. */
const adapter = (text: string, seen: unknown[] = []): MessagesAdapter => ({
  metadata: { provider: 'anthropic', model: 'fixture' },
  async create(request, options) {
    seen.push({ request, options });
    return {
      id: 'x',
      metadata: { provider: 'anthropic', model: 'fixture' },
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    };
  },
});

describe('FIX-57 #4 · next steps', () => {
  it('parses {steps:[{label,prompt}]} or a fenced block; a bare string is not a step', () => {
    const one = {
      label: '要不要把三大指数整理成对比表？',
      prompt: '把上证、深证、创业板昨天的表现整理成对比表',
    };
    expect(parseNextSteps(JSON.stringify({ steps: [one] }))).toEqual([one]);
    expect(
      parseNextSteps(`好的：\n\`\`\`json\n${JSON.stringify({ steps: [one] })}\n\`\`\``),
    ).toEqual([one]);
    expect(parseNextSteps('["查看深证成指表现"]')).toEqual([]);
    expect(parseNextSteps('not json')).toEqual([]);
  });

  it('drops internal names, investment calls, credential asks and duplicates; keeps 3', () => {
    const intent = '上证指数最新收盘';
    const kept = filterNextSteps(intent, [
      {
        label: '开盘后我再拉一次实时点位对比？',
        prompt: '今天开盘后查上证指数实时点位，并与昨天收盘对比',
      },
      { label: '开盘后我再拉一次实时点位对比？', prompt: '重复' },
      { label: '用 firecrawl 再抓一次？', prompt: '用 firecrawl 抓东方财富' },
      { label: '要不要我判断该不该买入？', prompt: '分析上证指数现在是否该买入' },
      { label: '把账号密码给我，我替你登录？', prompt: '把账号密码给我，我登录查看' },
      { label: '读一下 tab_3 的内容？', prompt: '读 tab_3' },
      { label: '换个浏览器内核再试一次？', prompt: '切换不同内核重新访问' },
      {
        label: '整理三大指数昨日表现对比表？',
        prompt: '把上证、深证、创业板昨天的表现整理成一张对比表',
      },
      { label: '每天收盘后提醒你点位？', prompt: '每个交易日收盘后告诉我上证指数收盘点位和涨跌幅' },
      { label: '第四条多余的？', prompt: '第四条多余的' },
    ]);
    expect(kept.map((s) => s.label)).toEqual([
      '开盘后我再拉一次实时点位对比？',
      '整理三大指数昨日表现对比表？',
      '每天收盘后提醒你点位？',
    ]);
  });

  it("inherits the person's prohibitions on label and prompt", () => {
    expect(
      filterNextSteps('打开表单填好，不要提交', [
        { label: '要我直接帮你提交吗？', prompt: '提交这个表单' },
        { label: '把填好的内容截图发你？', prompt: '把表单当前填写内容截图' },
      ]).map((s) => s.label),
    ).toEqual(['把填好的内容截图发你？']);
  });

  it('a partial or failed result tells the model what is missing and the recent tasks', () => {
    const msg = nextStepsUserMessage({
      intent: '看京东这个商品的价格',
      outcome: 'failed',
      summary: '京东商品页要登录',
      missing: '商品价格',
      recentIntents: ['查上证指数', '  看  茅台  股价 '],
    });
    expect(msg).toContain('结果：失败');
    expect(msg).toContain('失败原因：京东商品页要登录');
    expect(msg).toContain('没拿到的部分：商品价格');
    expect(msg).toContain('- 看 茅台 股价');
  });

  it('one bounded call; an empty answer is an empty list', async () => {
    const seen: Array<{ options: unknown }> = [];
    expect(
      await generateNextSteps({
        messagesAdapter: adapter('{"steps":[]}', seen),
        intent: '查天气',
        outcome: 'completed',
        summary: '北京晴',
      }),
    ).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.options).toEqual({ timeoutMs: 15_000, maxRetries: 0 });
  });

  it('repositories accept 1–3 steps of the right size only', () => {
    expect(validNextSteps([])).toBe(false);
    expect(validNextSteps([{ label: '整理对比表？', prompt: '整理对比表' }])).toBe(true);
    expect(validNextSteps([{ label: 'x'.repeat(49), prompt: '整理对比表' }])).toBe(false);
    expect(validNextSteps([{ label: '整理对比表？', prompt: 'x'.repeat(301) }])).toBe(false);
  });

  it('复审 #1-1d: the same answer names the task for the sidebar', () => {
    expect(parseTaskTitle('{"title":"京东 iPhone 16 Pro 价格","steps":[]}')).toBe(
      '京东 iPhone 16 Pro 价格',
    );
    expect(parseTaskTitle('{"title":"使用云端浏览器","steps":[]}')).toBeNull();
    expect(parseTaskTitle('{"title":"https://item.jd.com","steps":[]}')).toBeNull();
    expect(parseTaskTitle('{"steps":[]}')).toBeNull();
  });

  it("复审 #3: the only hard rule — never reopen the walled address; platforms are the model's call", () => {
    const walled = ['https://item.jd.com/100142621606.html'];
    const steps = [
      {
        label: '再打开那个京东页面试试？',
        prompt: '重新打开 https://item.jd.com/100142621606.html 读价格',
      },
      {
        label: '再打开第 3 条商品页拿价格？',
        prompt: '打开 https://www.amazon.sg/dp/B0F8374PX3 读第 3 个商品的价格',
      },
      {
        label: '再看亚马逊上第 3 个的价格？',
        prompt: '在 amazon.com 搜 usb c cable，读第 3 个商品的价格',
      },
      { label: '顺便看看淘宝和拼多多的同款？', prompt: '在淘宝、拼多多搜同款，列出价格' },
    ];
    expect(relevantNextSteps(walled, steps).map((s) => s.label)).toEqual([
      '再打开第 3 条商品页拿价格？',
      '再看亚马逊上第 3 个的价格？',
      '顺便看看淘宝和拼多多的同款？',
    ]);
    // The mobile page of the same item is the same address.
    expect(
      relevantNextSteps(walled, [
        { label: '手机版再试？', prompt: 'https://item.m.jd.com/100142621606.html' },
      ]),
    ).toEqual([]);
    expect(relevantNextSteps([], steps)).toHaveLength(4);
  });

  it('协调方第 2 次代体验: no cross-platform step unless the request compares platforms', () => {
    const only = nextStepsUserMessage({
      intent: '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
      outcome: 'completed',
      summary: '1. UGREEN — S$10.92',
    });
    expect(only).toContain('用户这次没有要求比价或跨平台');
    const compare = nextStepsUserMessage({
      intent: '比较京东和淘宝上 AirPods 的价格',
      outcome: 'completed',
      summary: '京东 ¥1299，淘宝 ¥1199',
    });
    expect(compare).not.toContain('用户这次没有要求比价或跨平台');
    expect(NEXT_STEPS_SYSTEM_PROMPT).toContain('就不要提「和京东同款对比」');
  });

  it('协调方第 3 次代体验: the request or a recent one said again is never a step', () => {
    const asked = ['上证指数现在多少点', '亚马逊新加坡站 USB C 线价格'];
    expect(
      withoutEchoes(asked, [
        { label: '上证指数现在多少点', prompt: '上证指数现在多少点' },
        { label: '亚马逊新加坡站 USB C 线价格？', prompt: '帮我查亚马逊新加坡站 USB C 线价格' },
        {
          label: '创业板今天跌了 2.87%，要我看看是什么带动的吗？',
          prompt: '查一下今天创业板指下跌的主要原因',
        },
      ]).map((s) => s.label),
    ).toEqual(['创业板今天跌了 2.87%，要我看看是什么带动的吗？']);
    // What came back in that run: a bare list of the recent requests → no steps at all.
    expect(parseNextSteps('["上证指数现在多少点","亚马逊新加坡站 USB C 线价格"]')).toEqual([]);
    expect(NEXT_STEPS_SYSTEM_PROMPT).toContain('绝不原样照抄用户这次的原话或最近任务的原话');
    expect(NEXT_STEPS_SYSTEM_PROMPT).toContain('收盘后再告诉你三大指数的结果？');
  });

  it('复审 #4: an item id in the query is part of the address; bare retries are banned', () => {
    const walled = ['https://item.taobao.com/item.htm?id=111'];
    const steps = [
      {
        label: '再打开这个淘宝商品？',
        prompt: '打开 https://item.taobao.com/item.htm?id=111&spm=a1 读价格',
      },
      {
        label: '看看同店另一款的价格？',
        prompt: '打开 https://item.taobao.com/item.htm?id=222 读价格',
      },
    ];
    expect(relevantNextSteps(walled, steps).map((s) => s.label)).toEqual([
      '看看同店另一款的价格？',
    ]);
    expect(NEXT_STEPS_SYSTEM_PROMPT).toContain(
      '不要给「再试一次？」「重试一下？」这类原样重来的提议',
    );
  });

  it('复审 #3: the model is told which platform the link is and when other platforms fit', () => {
    const msg = nextStepsUserMessage({
      intent: '打开 https://item.jd.com/100142621606.html 读商品标题和价格',
      outcome: 'partial',
      summary: '价格被打码',
    });
    expect(msg).toContain('用户给的链接域名：item.jd.com');
    expect(NEXT_STEPS_SYSTEM_PROMPT).toContain('item.jd.com 就是京东');
    expect(NEXT_STEPS_SYSTEM_PROMPT).toContain(
      '用户自己说了要比价、跟其他平台比，才可以提其他平台',
    );
  });
});
