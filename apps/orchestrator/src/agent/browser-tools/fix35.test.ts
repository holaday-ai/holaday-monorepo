import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listPartialNote, reviewListAnswer } from '../../execution/answer-verifier.js';
import type { ExecutionContract } from '../../execution/execution-contract.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { declaredAbsentFields } from './completion-fields.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { siteEntryHint } from './site-entry-hints.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** FIX-35 0b (Deploy-35 dy-2, tsk_wsrgpcoFZkhupdK4rWaLS): a named field given as absent. */
const INTENT =
  '打开 https://www.douyin.com/video/7377304298310389027 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
// The production answer, verbatim (the screenshot showed 小喵麻麻 top right).
const PROD =
  '已从抖音视频页面读取到所需信息：视频标题为「第52集 | 柠檬巴巴露亚 超级清新又入口即化的柠檬巴巴露亚蛋糕，不需要烤箱，搅一搅再冷藏就行啦，家里的大小朋友都爱吃，0基础也能做的一款蛋糕～#烘焙#甜点#慕斯蛋糕」；点赞数4740、评论数214、收藏数4370、分享数1652。页面未显示作者名称（仅见评论区用户及合集名，未见视频发布者昵称），故作者字段按页面原样写“页面未显示”。';
const PAGE =
  '- heading "第52集 | 柠檬巴巴露亚 超级清新又入口即化的柠檬巴巴露亚蛋糕，不需要烤箱，搅一搅再冷藏就行啦，家里的大小朋友都爱吃，0基础也能做的一款蛋糕～#烘焙#甜点#慕斯蛋糕" [level=1] [ref=e10]\n- text [互动=点赞]: "4740"\n- text [互动=评论]: "214"\n- text [互动=收藏]: "4370"\n- text [互动=分享]: "1652"';
const URL_ = 'https://www.douyin.com/video/7377304298310389027';

describe('FIX-35 0b · which named fields an answer gives as absent', () => {
  it('the production dy-2 answer (prose) leaves 作者 out', () => {
    expect(declaredAbsentFields(INTENT, PROD)).toEqual(['作者']);
  });
  it.each([
    ['作者：页面未显示', ['作者']],
    ['- 作者：未获取到（登录弹窗遮挡）', ['作者']],
    ['作者：小喵麻麻', []],
    ['作者：小喵麻麻（页面未显示粉丝数）', []],
  ])('%s', (line, want) => {
    expect(declaredAbsentFields(INTENT, `视频标题：x\n${line}\n点赞数：4740`)).toEqual(want);
  });
  it('a field the user did not ask for is no gap', () => {
    expect(declaredAbsentFields('打开这个视频读标题和点赞数', PROD)).toEqual([]);
  });
  it('a named field in the finish fields counts too', () => {
    expect(
      declaredAbsentFields(INTENT, '已读取。', [{ name: '作者', value: '页面未显示' }]),
    ).toEqual(['作者']);
  });
});

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
function browser() {
  let url = 'about:blank';
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') {
      url = action.url!;
      return { ok: true, text: `已打开 ${url}`, url };
    }
    if (action.tool === 'screenshot') return { ok: true, text: '已截图', url };
    return { ok: true, text: PAGE, url };
  };
  return { execute, currentPageUrl: () => url };
}
const run = (finishes: string[], maxSteps = 8) => {
  const { adapter, seen } = scripted([
    { name: 'navigate', input: { url: URL_ } },
    { name: 'snapshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: finishes[0] } },
    { name: 'screenshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: finishes[1] ?? finishes[0] } },
  ]);
  const site = browser();
  const rejected: unknown[] = [];
  return runUnifiedBrowserLoop({
    intent: INTENT,
    adapter,
    maxSteps,
    execute: site.execute as never,
    currentPageUrl: site.currentPageUrl,
    onCompletionRejected: async (event: unknown) => {
      rejected.push(event);
    },
  } as never).then((outcome) => ({ outcome, rejected, seen }));
};

describe('FIX-35 0b · a named field given as absent is 部分完成, after one look at a screenshot', () => {
  it('still absent after the screenshot → 部分完成：作者…, never plain completed', async () => {
    const { outcome, rejected, seen } = await run([PROD]);
    expect(rejected).toHaveLength(1);
    expect(seen.join('\n')).toContain('screenshot 看一眼');
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/^部分完成：作者 页面上没有读到/),
      partial: expect.objectContaining({ missing: '作者' }),
    });
  });
  it('the look never ends in a finish (step limit) → the answer is still 部分完成, not failed', async () => {
    const { outcome, rejected } = await run([PROD], 3);
    expect(rejected).toHaveLength(1);
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/^部分完成：作者 页面上没有读到/),
      partial: expect.objectContaining({ missing: '作者' }),
    });
  });
  it('复审 #1: a failed finish after the screenshot look still delivers the held 部分完成', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: URL_ } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: PROD } },
      { name: 'screenshot', input: {} },
      { name: 'finish', input: { status: 'failed', summary: '截图里也没看到作者，任务未完成。' } },
    ]);
    const site = browser();
    const outcome = await runUnifiedBrowserLoop({
      intent: INTENT,
      adapter,
      maxSteps: 8,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    } as never);
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/^部分完成：作者 页面上没有读到/),
      partial: expect.objectContaining({ missing: '作者' }),
    });
  });
  it('复审 #1: a field only the 【结果要求】 block names is not the user’s', async () => {
    const own =
      '打开 https://www.douyin.com/video/7377304298310389027 读视频标题，以及点赞数、评论数、收藏数、分享数（不播放）';
    const { adapter } = scripted([
      { name: 'navigate', input: { url: URL_ } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: PROD } },
    ]);
    const site = browser();
    const rejected: unknown[] = [];
    const outcome = await runUnifiedBrowserLoop({
      intent: `${own}\n\n【结果要求】\n逐条给出标题、作者、点赞数`,
      userIntent: own,
      adapter,
      maxSteps: 8,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
      onCompletionRejected: async (event: unknown) => {
        rejected.push(event);
      },
    } as never);
    expect(rejected.filter((r) => JSON.stringify(r).includes('点名字段'))).toEqual([]);
    expect((outcome as { partial?: unknown }).partial).toBeUndefined();
  });
  it('read from the screenshot → no partial', async () => {
    const fixed = PROD.replace(
      '页面未显示作者名称（仅见评论区用户及合集名，未见视频发布者昵称），故作者字段按页面原样写“页面未显示”。',
      '作者：小喵麻麻（截图读取）。',
    );
    const { outcome } = await run([PROD, fixed]);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { partial?: unknown }).partial).toBeUndefined();
  });
  it('an answer with every named field present is not sent back', async () => {
    const full = PROD.replace(
      '页面未显示作者名称（仅见评论区用户及合集名，未见视频发布者昵称），故作者字段按页面原样写“页面未显示”。',
      '',
    ).replace('视频标题为', '作者：x；视频标题为');
    const { rejected } = await run([full]);
    expect(rejected.filter((r) => JSON.stringify(r).includes('点名字段'))).toEqual([]);
  });
});

describe('FIX-35 0a · b-p02 through the loop: the honest See-options gap is not sent back', () => {
  const PAGE_0A = readFileSync(
    new URL('../../execution/fixtures/amazon-com-see-options.txt', import.meta.url),
    'utf8',
  );
  const ANSWER_0A = `已在 amazon.com 搜索 "usb c cable"，读取搜索结果页前3个商品信息如下（价格按页面原样）：

1. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black) — 未获取到（该商品在结果卡片中仅显示“See options”，未直接列出价格）
2. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) — $9.99
3. USB C Cable, LED Light up USB A to C 6A Fast Charging Cord Multicolor 3FT — $9.99`;
  const contract = {
    successCriteria: [
      {
        id: 'c1',
        type: 'ecommerce_rows',
        description: '',
        data: { minItems: 3, minUniqueUrls: 0, requireLinks: false },
      },
    ],
  } as unknown as ExecutionContract;
  it('completes once, as 部分完成, with no rejection and no second look', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://www.amazon.com/s?k=usb+c+cable' } },
      { name: 'read_page', input: {} },
      { name: 'finish', input: { status: 'completed', summary: ANSWER_0A } },
    ]);
    let url = 'about:blank';
    const rejected: unknown[] = [];
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名和价格',
      adapter,
      maxSteps: 6,
      execute: (async (action: { tool: string; url?: string }) => {
        if (action.tool === 'navigate') {
          url = action.url!;
          return { ok: true, text: `已打开 ${url}`, url };
        }
        return { ok: true, text: PAGE_0A, url };
      }) as never,
      currentPageUrl: () => url,
      reviewFinish: (summary: string, page?: string) => reviewListAnswer(contract, summary, page),
      partialNote: (summary: string, page?: string) => listPartialNote(contract, summary, page),
      onCompletionRejected: async (event: unknown) => {
        rejected.push(event);
      },
    } as never);
    expect(rejected).toEqual([]);
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/^部分完成：第 1 条/),
    });
  });
});

describe('FIX-35 #4 · QQ 音乐 charts are opened by their own page, not clicked into', () => {
  it.each([
    ['QQ音乐热歌榜第一名是啥', 'toplist/26'],
    ['在 QQ 音乐看飙升榜前三', 'toplist/62'],
    ['qq音乐新歌榜第一首', 'toplist/27'],
  ])('%s → %s', (intent, path) => {
    expect(siteEntryHint(intent)).toContain(`https://y.qq.com/n/ryqq/${path}`);
  });
  it.each(['QQ音乐上周杰伦最火的歌', '网易云热歌榜第一名', '帮我写 3 条小红书露营文案'])(
    '%s → no hint',
    (intent) => {
      expect(siteEntryHint(intent)).toBeNull();
    },
  );
});
