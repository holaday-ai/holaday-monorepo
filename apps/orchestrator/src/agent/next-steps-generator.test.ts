import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import {
  filterNextSteps,
  generateNextSteps,
  nextStepsUserMessage,
  parseNextSteps,
  validNextSteps,
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
  it('parses {steps:[{label,prompt}]}, a fenced block, or a bare list of strings', () => {
    const one = {
      label: '要不要把三大指数整理成对比表？',
      prompt: '把上证、深证、创业板昨天的表现整理成对比表',
    };
    expect(parseNextSteps(JSON.stringify({ steps: [one] }))).toEqual([one]);
    expect(
      parseNextSteps(`好的：\n\`\`\`json\n${JSON.stringify({ steps: [one] })}\n\`\`\``),
    ).toEqual([one]);
    expect(parseNextSteps('["查看深证成指表现"]')).toEqual([
      { label: '查看深证成指表现', prompt: '查看深证成指表现' },
    ]);
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
    expect(seen[0]?.options).toEqual({ timeoutMs: 8000, maxRetries: 0 });
  });

  it('repositories accept 1–3 steps of the right size only', () => {
    expect(validNextSteps([])).toBe(false);
    expect(validNextSteps([{ label: '整理对比表？', prompt: '整理对比表' }])).toBe(true);
    expect(validNextSteps([{ label: 'x'.repeat(49), prompt: '整理对比表' }])).toBe(false);
    expect(validNextSteps([{ label: '整理对比表？', prompt: 'x'.repeat(201) }])).toBe(false);
  });
});
