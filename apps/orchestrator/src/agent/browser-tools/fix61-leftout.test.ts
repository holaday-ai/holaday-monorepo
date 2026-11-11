import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { AskedFieldJudge } from '../scrape-field-judge.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { confirmLeftOut, runUnifiedBrowserLoop } from './unified-browser-loop.js';

function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, seen };
}

const DY =
  '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
const PAGE =
  'heading "仙桥洞 真的好美，喜欢的小伙伴，冲冲冲" [level=1]\nlink "利利的旅行盲盒"\ngeneric: 20\ntext: 点赞';
const ANSWER =
  '视频标题：仙桥洞 真的好美，喜欢的小伙伴，冲冲冲；作者：利利的旅行盲盒；点赞数：20。页面有登录提示弹窗，未登录状态下读取的公开信息如上。';

async function runDy(fieldJudge?: AskedFieldJudge) {
  const { adapter, seen } = scripted([
    { name: 'navigate', input: { url: 'https://www.douyin.com/video/7507106798919601427' } },
    { name: 'snapshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: ANSWER } },
    { name: 'screenshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: ANSWER } },
  ]);
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate')
      return { ok: true, text: `已打开 ${action.url}`, url: action.url };
    if (action.tool === 'screenshot') return { ok: true, text: '截图已保存' };
    return { ok: true, text: `${PAGE} @ https://www.douyin.com/video/7507106798919601427` };
  };
  const outcome = await runUnifiedBrowserLoop({
    intent: DY,
    adapter,
    maxSteps: 10,
    execute: execute as never,
    currentPageUrl: () => 'https://www.douyin.com/video/7507106798919601427',
    ...(fieldJudge ? { fieldJudge } : {}),
  });
  return {
    seen: seen.join('\n'),
    outcome: outcome as { status: string; summary: string; partial?: { missing?: string } },
  };
}

describe('FIX-61: a browser answer that leaves out named counts is not 完成', () => {
  it('local dy-1: the judge reads comments, favourites and shares as missing → one look, then 部分完成', async () => {
    const judge: AskedFieldJudge = async () => [
      { field: '视频标题', hasValue: true },
      { field: '作者', hasValue: true },
      { field: '点赞数', hasValue: true },
      { field: '评论数', hasValue: false },
      { field: '收藏数', hasValue: false },
      { field: '分享数', hasValue: false },
    ];
    const { outcome, seen } = await runDy(judge);
    expect(seen).toContain('答案里没有写出');
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toMatch(/^部分完成/);
    expect(outcome.partial?.missing).toMatch(/评论数/);
  });

  it('复审 #2 #1: no judge, a failed or an empty reading → the field-name doubt alone is dropped (baseline)', async () => {
    for (const judge of [
      undefined,
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => {
        throw new Error('Arrearage');
      }),
    ]) {
      const { outcome, seen } = await runDy(judge as AskedFieldJudge | undefined);
      expect(seen).not.toContain('答案里没有写出');
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).not.toMatch(/^部分完成/);
    }
  });
});

const CAT_URL = 'https://www.douyin.com/video/7500000000000000001';
const CAT = `打开 ${CAT_URL} 读视频标题、作者和点赞数（不播放）`;
const CAT_PAGE = 'heading "猫咪跳舞" [level=1]\nlink "小王"\ngeneric: 12.3万\ntext: 赞';

async function runCat(answer: string, fieldJudge?: AskedFieldJudge) {
  const { adapter, seen } = scripted([
    { name: 'navigate', input: { url: CAT_URL } },
    { name: 'snapshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: answer } },
    { name: 'screenshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: answer } },
  ]);
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate')
      return { ok: true, text: `已打开 ${action.url}`, url: action.url };
    if (action.tool === 'screenshot') return { ok: true, text: '截图已保存' };
    return { ok: true, text: `${CAT_PAGE} @ ${CAT_URL}` };
  };
  const outcome = await runUnifiedBrowserLoop({
    intent: CAT,
    adapter,
    maxSteps: 10,
    execute: execute as never,
    currentPageUrl: () => CAT_URL,
    ...(fieldJudge ? { fieldJudge } : {}),
  });
  return { outcome: outcome as { status: string; summary: string }, seen: seen.join('\n') };
}

const allGiven: AskedFieldJudge = async () => [
  { field: '视频标题', hasValue: true },
  { field: '作者', hasValue: true },
  { field: '点赞数', hasValue: true },
];

describe('FIX-61 复审 #1 #3: a named count written naturally is read by the small model', () => {
  for (const answer of [
    '**猫咪跳舞**，作者小王，12.3万赞。',
    '视频《猫咪跳舞》由 @小王 发布，获赞 12.3 万。',
  ]) {
    it(`「${answer}」: the judge reads the likes → 完成, no extra round`, async () => {
      const judge = vi.fn(allGiven);
      const { outcome, seen } = await runCat(answer, judge);
      expect(judge).toHaveBeenCalledTimes(1);
      expect(judge.mock.calls[0]?.[0]).toEqual({ request: CAT, answer });
      expect(seen).not.toContain('答案里没有写出');
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).not.toMatch(/^部分完成/);
    });

    it(`「${answer}」: the judge failing (null / 欠费 / empty) → 完成, as the baseline`, async () => {
      for (const judge of [
        vi.fn(async () => null),
        vi.fn(async () => []),
        vi.fn(async () => {
          throw new Error('Arrearage');
        }),
      ]) {
        const { outcome, seen } = await runCat(answer, judge as AskedFieldJudge);
        expect(judge).toHaveBeenCalled();
        expect(seen).not.toContain('答案里没有写出');
        expect(outcome.status).toBe('completed');
        expect(outcome.summary).not.toMatch(/^部分完成/);
      }
    });
  }

  it('without a judge → 完成, as the baseline', async () => {
    const { outcome, seen } = await runCat('**猫咪跳舞**，作者小王，12.3万赞。');
    expect(seen).not.toContain('答案里没有写出');
    expect(outcome.summary).not.toMatch(/^部分完成/);
  });

  it('a count the judge reads as missing is still sent back', async () => {
    const judge: AskedFieldJudge = async () => [
      { field: '视频标题', hasValue: true },
      { field: '作者', hasValue: true },
      { field: '点赞数', hasValue: false },
    ];
    const { outcome, seen } = await runCat('**猫咪跳舞**，作者小王。', judge);
    expect(seen).toContain('答案里没有写出 点赞数');
    expect(outcome.summary).toMatch(/^部分完成/);
  });
});

describe('confirmLeftOut', () => {
  it('no doubt, no call; the judge only clears doubts, never adds one', async () => {
    const judge = vi.fn<AskedFieldJudge>(async () => [{ field: '评论数', hasValue: false }]);
    expect(await confirmLeftOut(judge, 'r', 'a', [])).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
    // 评论数 was never doubted, and the judge says nothing about 点赞数: nothing is left out.
    expect(await confirmLeftOut(judge, 'r', 'a', ['点赞数'])).toEqual([]);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('matches the judge’s field with or without 「数」; a field it skipped is dropped', async () => {
    const judge: AskedFieldJudge = async () => [
      { field: '点赞', hasValue: true },
      { field: '评论数', hasValue: false },
    ];
    expect(await confirmLeftOut(judge, 'r', 'a', ['点赞数', '评论数', '分享数'])).toEqual([
      '评论数',
    ]);
  });

  it('no judge, null, empty or a throw → nothing is left out', async () => {
    expect(await confirmLeftOut(undefined, 'r', 'a', ['点赞数'])).toEqual([]);
    expect(await confirmLeftOut(async () => null, 'r', 'a', ['点赞数'])).toEqual([]);
    expect(await confirmLeftOut(async () => [], 'r', 'a', ['点赞数'])).toEqual([]);
    expect(
      await confirmLeftOut(
        async () => {
          throw new Error('timeout');
        },
        'r',
        'a',
        ['点赞数'],
      ),
    ).toEqual([]);
  });
});
