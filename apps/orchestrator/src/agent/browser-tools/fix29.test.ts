import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { RunSupercarOptions } from '../supercar/agent-loop.js';
import { BrowserControl } from '../supercar/browser-control.js';
import { unperformedActions, withoutUnperformed } from './action-claims.js';
import { assessCompletionFacts, observedEvidence } from './completion-fields.js';
import { assessEngagementClaims, engagementClaims, sameCount } from './engagement-counts.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';

vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));

/**
 * FIX-29 — FIRECRAWL-1 r7/r8 fc-douyin: 「点赞数为「97」」 while the page showed
 * 赞 20 / 评论 2 / 收藏 10 / 分享 97. The detail bar's numbers sit next to bare
 * icons with hashed class names (the observation read `generic: "20"` …
 * `generic: "97"`); the same counters are marked up in the (hidden) player.
 */
const DOUYIN = `<!doctype html><meta charset="utf-8"><title>仙桥洞 - 抖音</title>
<div data-e2e="detail-video-info">
  <h1>仙桥洞 真的好美，喜欢的小伙伴，冲冲冲</h1>
  <div class="NoBOOMd6">
    <div class="o2tLobnl" style="cursor:pointer"><div class="s7K4YLGp"><svg viewBox="0 0 90 94"></svg></div><span class="hIpNkUXt">20</span></div>
    <div class="o2tLobnl" style="cursor:pointer"><div class="s7K4YLGp"><svg viewBox="0 0 90 94"></svg></div><span class="hIpNkUXt">2</span></div>
    <div class="o2tLobnl" style="cursor:pointer"><div class="s7K4YLGp"><svg viewBox="0 0 90 94"></svg></div><span class="hIpNkUXt">10</span></div>
    <div class="bJX7d7PL o2tLobnl" data-e2e="video-share-icon-container" style="cursor:pointer"><svg viewBox="0 0 90 94"></svg><span class="sB3y0d3B">97</span></div>
  </div>
  <div>发布时间：2025-05-21 22:28</div>
</div>
<div style="display:none">
  <div data-e2e="video-player-digg">20</div>
  <div data-e2e="feed-comment-icon">2</div>
  <div data-e2e="video-player-collect">10</div>
  <div data-e2e="video-player-share">97</div>
</div>`;

/** Two counters with the same value and no markup of their own: no guess. */
const SAME_VALUES = `<!doctype html><meta charset="utf-8"><title>Same values</title>
<div class="bar">
  <div class="a1" style="cursor:pointer"><svg></svg><span>10</span></div>
  <div class="a2" style="cursor:pointer"><svg></svg><span>10</span></div>
  <div class="a3" style="cursor:pointer"><svg></svg><span>3</span></div>
</div>
<div style="display:none"><div data-e2e="like-count">10</div><div data-e2e="collect-count">10</div></div>
<nav class="pager"><a href="?p=3" style="cursor:pointer"><span>3</span></a></nav>`;

/** A labelled button (YouTube-style) and a counter whose own aria-label names it. */
const LABELLED = `<!doctype html><meta charset="utf-8"><title>Labelled</title>
<button aria-label="与另外 471 人一起顶此视频"><svg></svg><span>471</span></button>
<div aria-label="收藏" style="cursor:pointer"><svg></svg><span>1.2万</span></div>`;

const JD_LOGIN = `<!doctype html><meta charset="utf-8"><title>京东-欢迎登录</title>
<h1>京东APP扫码登录</h1><form><input placeholder="账号名/手机号/邮箱"><input type="password" placeholder="密码"><button>登录</button></form>`;

let server: Server;
let base: string;
let browser: Browser;
beforeAll(async () => {
  server = createServer((req, res) => {
    const body = req.url?.startsWith('/douyin')
      ? DOUYIN
      : req.url?.startsWith('/same')
        ? SAME_VALUES
        : req.url?.startsWith('/labelled')
          ? LABELLED
          : '<!doctype html><title>Plain</title><h1>Plain page</h1><p>Public text.</p>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function observe(path: string) {
  const page = await browser.newPage();
  try {
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: '读视频标题、作者和点赞数（不播放）',
    });
    await tools.execute({ tool: 'navigate', url: `${base}${path}` } as never);
    const read = await tools.execute({ tool: 'snapshot' } as never);
    return { text: read.text, tree: (JSON.parse(read.text) as { tree: string }).tree };
  } finally {
    await page.close();
  }
}
const countLine = (tree: string, value: string) =>
  tree
    .split('\n')
    .find((line) => line.trim().endsWith(`: "${value}"`) || line.trim().endsWith(`: ${value}`)) ??
  '';

describe('the snapshot says which counter a bare number is', () => {
  it('the Douyin bar: 20 点赞, 2 评论, 10 收藏, 97 分享', async () => {
    const { tree } = await observe('/douyin');
    expect(countLine(tree, '20')).toContain('[互动=点赞]');
    expect(countLine(tree, '2')).toContain('[互动=评论]');
    expect(countLine(tree, '10')).toContain('[互动=收藏]');
    expect(countLine(tree, '97')).toContain('[互动=分享]');
  });
  it('two marked counters with the same value, and a page number: no mark', async () => {
    const { tree } = await observe('/same');
    expect(tree).not.toContain('[互动=');
  });
  it("a counter's own label marks it; a labelled button keeps its name", async () => {
    const { tree } = await observe('/labelled');
    expect(tree).toContain('与另外 471 人一起顶此视频');
    expect(countLine(tree, '1.2万')).toContain('[互动=收藏]');
  });
});

describe("an answer's engagement number is that counter's", () => {
  const marked = [
    '- generic [ref=e455] [互动=点赞]: "20"',
    '- generic [ref=e464] [互动=评论]: "2"',
    '- generic [ref=e477] [互动=收藏]: "10"',
    '- generic [ref=e486] [互动=分享]: "97"',
  ].join('\n');
  const bare = ['- generic [ref=e455]: "20"', '- generic [ref=e486]: "97"'].join('\n');
  const r7 =
    '已打开指定抖音视频页并读取到：视频标题为「仙桥洞 真的好美」，作者为「利利的旅行盲盒」，点赞数为「97」。未触发播放操作。';
  it('reads the claims an answer makes', () => {
    expect(engagementClaims(r7)).toEqual([expect.objectContaining({ kind: '点赞', value: '97' })]);
    expect(engagementClaims('- 点赞：20\n- 评论 2 条\n- 10 个收藏')).toEqual([
      expect.objectContaining({ kind: '点赞', value: '20' }),
      expect.objectContaining({ kind: '评论', value: '2' }),
      expect.objectContaining({ kind: '收藏', value: '10' }),
    ]);
    expect(engagementClaims('点赞数：无法确认（页面只有图标）')).toEqual([]);
    expect(engagementClaims('发布时间：2025-05-21，标题见上')).toEqual([]);
    // PR #291 review: a dislike count is not a like count.
    expect(engagementClaims('Dislikes: 5')).toEqual([]);
    expect(engagementClaims('Likes: 471, dislikes: 5')).toEqual([
      expect.objectContaining({ kind: '点赞', value: '471' }),
    ]);
  });
  it('r7: 97 is the share count, not the like count', () => {
    const [why] = assessEngagementClaims(r7, [marked]);
    expect(why).toContain('「20」');
    expect(why).toContain('标注的是分享数');
  });
  it('万/亿/k/w counts compare by value, at the page precision (review 2)', () => {
    for (const [answer, page] of [
      ['12000', '1.2万'],
      ['12345', '1.2万'],
      ['1.2万', '12000'],
      ['3.4亿', '340000000'],
      ['1500', '1.5k'],
      ['23000', '2.3w'],
      ['4740', '4740'],
    ])
      expect(sameCount(answer!, page!), `${answer} ~ ${page}`).toBe(true);
    for (const [answer, page] of [
      ['13000', '1.2万'],
      ['97', '20'],
      ['1.3万', '12000'],
    ])
      expect(sameCount(answer!, page!), `${answer} !~ ${page}`).toBe(false);
    const favourites = '- generic [ref=e9] [互动=收藏]: "1.2万"';
    expect(assessEngagementClaims('收藏数：12000', [favourites])).toEqual([]);
    expect(assessEngagementClaims('收藏数：15000', [favourites])).toHaveLength(1);
  });
  it('the right numbers pass', () => {
    expect(assessEngagementClaims('点赞 20，评论 2，收藏 10，分享 97', [marked])).toEqual([]);
  });
  it('a bare number next to an icon cannot be delivered as the like count', () => {
    const [why] = assessEngagementClaims(r7, [bare]);
    expect(why).toContain('无法确认点赞数');
    // The same answer read as page text ("20\n2\n10\n97").
    expect(assessEngagementClaims(r7, ['仙桥洞\n20\n2\n10\n97'])[0]).toContain('无法确认');
  });
  it("a number on its kind's labelled line passes (YouTube)", () => {
    const youtube =
      '- button "与另外 471 人一起顶此视频" [ref=e52] [cursor=pointer]:\n  - generic: "471"';
    expect(assessEngagementClaims('点赞数：471', [youtube])).toEqual([]);
  });
  it('the check runs with the other completion facts', () => {
    const page = observedEvidence(
      JSON.stringify({ tree: marked }),
      marked,
      'https://www.douyin.com/video/1',
    );
    expect(assessCompletionFacts({ summary: r7, pages: [page] }).contradictions).toEqual([
      expect.stringContaining('分享数'),
    ]);
  });
});

function scriptedLoop(calls: Array<{ name: string; input: Record<string, unknown> }>) {
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

describe('the loop: a wrong counter is sent back, then not delivered', () => {
  const tree = [
    '- heading "仙桥洞 真的好美" [level=1] [ref=e1]',
    '- generic [ref=e455] [互动=点赞]: "20"',
    '- generic [ref=e486] [互动=分享]: "97"',
  ].join('\n');
  const execute = async (action: { tool: string }): Promise<UnifiedToolResult> =>
    action.tool === 'navigate'
      ? { ok: true, text: '已打开', url: 'https://www.douyin.com/video/1' }
      : ({
          ok: true,
          text: JSON.stringify({ tree, sourceURL: 'https://www.douyin.com/video/1' }),
        } as UnifiedToolResult);
  const answer = (likes: string) => ({
    name: 'finish',
    input: { status: 'completed', summary: `标题：仙桥洞 真的好美\n点赞数：${likes}` },
  });
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: '打开 https://www.douyin.com/video/1 读视频标题和点赞数（不播放）',
      adapter,
      maxSteps: 10,
      execute: execute as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const open = [
    { name: 'navigate', input: { url: 'https://www.douyin.com/video/1' } },
    { name: 'snapshot', input: {} },
  ];
  it('97 is sent back naming the share count; 20 then completes', async () => {
    const { outcome, seen } = await run([...open, answer('97'), answer('20')]);
    expect(seen).toContain('标注的是分享数');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(outcome.status === 'completed' && outcome.summary).toContain('20');
  });
  it('97 twice is not completed', async () => {
    const { outcome } = await run([...open, answer('97'), answer('97')]);
    expect(outcome.status).not.toBe('completed');
  });
});

describe('a search or another source the run never made', () => {
  const douyin = {
    visitedUrls: ['https://www.douyin.com/video/7507106798919601427'],
    searched: false,
  };
  const r4 =
    '任务执行失败：无法获取目标视频信息。页面在未登录状态下仅显示抖音通用导航栏和底部备案信息。尝试通过 extract 提取结构化数据、截图确认、以及搜索引擎检索该视频 ID 均未获得有效结果。需要用户登录后才能读取该视频的标题、作者和点赞数。';
  it('r4: the failure text claims a search', () => {
    expect(unperformedActions(r4, douyin)).toEqual([expect.stringContaining('没有做过任何搜索')]);
    expect(withoutUnperformed(r4, douyin)).not.toMatch(/检索/);
    expect(withoutUnperformed(r4, douyin)).toContain('需要用户登录后');
  });
  it('only the claimed clause of a comma-joined failure text goes (review 3)', () => {
    const line =
      '页面在未登录状态下只显示导航栏，提示需要登录才能查看，尝试通过搜索引擎检索该视频 ID 也无结果，需要用户登录后才能读取。';
    expect(withoutUnperformed(line, douyin)).toBe(
      '页面在未登录状态下只显示导航栏，提示需要登录才能查看，需要用户登录后才能读取。',
    );
    // r4: the true steps around the claimed search stay.
    expect(withoutUnperformed(r4, douyin)).toContain('尝试通过 extract 提取结构化数据、截图确认');
    expect(withoutUnperformed('又通过搜索引擎检索了一次。', douyin)).toBe('');
  });
  it('a run that did search, or opened a search page, may say so', () => {
    expect(unperformedActions(r4, { ...douyin, searched: true })).toEqual([]);
    expect(
      unperformedActions(r4, {
        visitedUrls: [...douyin.visitedUrls, 'https://search-results.holaday.invalid/?q=x'],
        searched: false,
      }),
    ).toEqual([]);
  });
  it('another source needs a second site', () => {
    const text = '我换了其他来源，均无法读取。';
    expect(unperformedActions(text, douyin)).toEqual([expect.stringContaining('没有换过来源')]);
    expect(
      unperformedActions(text, {
        visitedUrls: [...douyin.visitedUrls, 'https://www.iesdouyin.com/share/video/1'],
        searched: false,
      }),
    ).toEqual([]);
  });
  it('nouns, advice and denials are not claims', () => {
    for (const text of [
      '本次搜索使用 Brave 搜索接口（不是 Google 结果页）。',
      '已从 Brave 搜索结果打开真实天气来源页面。',
      '建议用户换用其他来源或登录后重试。',
      '未进行搜索，也没有换其他来源。',
      '可以尝试在站内搜索该视频。',
    ])
      expect(unperformedActions(text, douyin)).toEqual([]);
    expect(unperformedActions('I searched for the video ID.', douyin)).toHaveLength(1);
  });

  const failWith = (summary: string) => ({ name: 'finish', input: { status: 'failed', summary } });
  const execute = async (action: { tool: string }): Promise<UnifiedToolResult> =>
    action.tool === 'navigate'
      ? { ok: true, text: '已打开', url: 'https://www.douyin.com/video/1' }
      : ({
          ok: true,
          text: JSON.stringify({ tree: '- generic [ref=e1]: 加载中' }),
        } as UnifiedToolResult);
  const run = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
    const { adapter, seen } = scriptedLoop(calls);
    return runUnifiedBrowserLoop({
      intent: '打开 https://www.douyin.com/video/1 读视频标题',
      adapter,
      maxSteps: 10,
      execute: execute as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const open = [
    { name: 'navigate', input: { url: 'https://www.douyin.com/video/1' } },
    { name: 'snapshot', input: {} },
  ];
  const honest = '页面只显示导航栏和加载中，读取不到视频标题；需要用户登录后再试。';
  it('the failure text is sent back once; the honest rewrite is delivered', async () => {
    const { outcome, seen } = await run([...open, failWith(r4), failWith(honest)]);
    expect(seen).toContain('失败说明里写了本次没做过的动作');
    expect(outcome).toMatchObject({ status: 'failed', reason: honest });
  });
  it('repeated, the claimed search is taken out of the failure text', async () => {
    const { outcome } = await run([...open, failWith(r4), failWith(r4)]);
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.reason).not.toMatch(/检索/);
    expect(outcome.status === 'failed' && outcome.reason).toContain('需要用户登录后');
  });
  it('a completed answer claiming a search is sent back as well', async () => {
    const tree = '- heading "仙桥洞" [level=1] [ref=e1]';
    const { adapter, seen } = scriptedLoop([
      ...open,
      {
        name: 'finish',
        input: { status: 'completed', summary: '通过搜索引擎检索该视频 ID 后读到标题：仙桥洞' },
      },
      { name: 'finish', input: { status: 'completed', summary: '标题：仙桥洞' } },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://www.douyin.com/video/1 读视频标题',
      adapter,
      maxSteps: 10,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: 'https://www.douyin.com/video/1' }
          : { ok: true, text: JSON.stringify({ tree }) }) as never,
    });
    expect(seen.join('\n')).toContain('没有做过任何搜索');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});

describe('a search the run did make may be said', () => {
  it('typing into the page counts as a search', async () => {
    const tree = '- textbox "搜索" [ref=e2]\n- heading "结果" [level=1] [ref=e1]';
    const { adapter, seen } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://shop.example/' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e2', text: '收纳盒', submit: true } },
      { name: 'finish', input: { status: 'completed', summary: '已搜索收纳盒，结果页标题：结果' } },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://shop.example/ 搜索收纳盒',
      adapter,
      maxSteps: 10,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: 'https://shop.example/' }
          : action.tool === 'type'
            ? { ok: true, text: '已输入' }
            : { ok: true, text: JSON.stringify({ tree }) }) as never,
    });
    expect(seen.join('\n')).not.toContain('没有做过任何搜索');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('typing into a name field is not a search (PR #291 review)', async () => {
    const tree = '- textbox "Customer name" [ref=e2]\n- heading "Order" [level=1] [ref=e1]';
    const { adapter, seen } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://shop.example/' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e2', text: 'Test User' } },
      {
        name: 'finish',
        input: { status: 'completed', summary: '已搜索收纳盒，结果页标题：Order' },
      },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '已在 Customer name 填入 Test User，页面标题：Order',
        },
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://shop.example/ 填写姓名',
      adapter,
      maxSteps: 10,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: 'https://shop.example/' }
          : action.tool === 'type'
            ? { ok: true, text: '已输入' }
            : { ok: true, text: JSON.stringify({ tree }) }) as never,
    });
    expect(seen.join('\n')).toContain('没有做过任何搜索');
    expect(outcome.status === 'completed' && outcome.summary).not.toContain('已搜索');
  });
});

describe('local f29a jd: a login wall reached between browser actions', () => {
  it('is handed to the user at the next turn, not searched around', async () => {
    let walled = false;
    const { adapter } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://item.jd.com/1.html' } },
      { name: 'snapshot', input: {} },
      { name: 'web_search', input: { query: '100142621606' } },
      { name: 'web_search', input: { query: '100142621606 价格' } },
      { name: 'finish', input: { status: 'failed', summary: '多次搜索也无结果' } },
    ]);
    const searches: string[] = [];
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://item.jd.com/1.html 读商品标题和页面显示的价格',
      adapter,
      maxSteps: 10,
      // The page moves on to the login page while the model only searches.
      webSearch: async (query: string) => {
        searches.push(query);
        walled = true;
        return [];
      },
      captchaHandoff: async () => true,
      probeBlocker: async () =>
        walled
          ? { reason: 'login', message: '页面遇到登录墙，需要你接管登录；当前任务尚未完成。' }
          : null,
      execute: (async (action: { tool: string }) => {
        return action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: 'https://item.jd.com/1.html' }
          : { ok: true, text: JSON.stringify({ tree: '- heading "商品详情" [level=1] [ref=e1]' }) };
      }) as never,
    } as never);
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
    expect(searches).toEqual(['100142621606']);
  });
  it('an unreadable page (still loading) is not handed over (review D1)', async () => {
    let loading = false;
    const { adapter } = scriptedLoop([
      { name: 'navigate', input: { url: 'https://item.jd.com/1.html' } },
      { name: 'snapshot', input: {} },
      { name: 'web_search', input: { query: '100142621606' } },
      { name: 'finish', input: { status: 'failed', summary: '没有读到价格' } },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://item.jd.com/1.html 读商品标题和页面显示的价格',
      adapter,
      maxSteps: 10,
      webSearch: async () => {
        loading = true;
        return [];
      },
      captchaHandoff: async () => true,
      probeBlocker: async () =>
        loading
          ? { reason: 'page_unreadable', message: '无法确认当前页面状态，请重新读取后继续。' }
          : null,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: 'https://item.jd.com/1.html' }
          : {
              ok: true,
              text: JSON.stringify({ tree: '- heading "商品详情" [level=1] [ref=e1]' }),
            }) as never,
    } as never);
    expect(outcome.status).not.toBe('awaiting_user');
  });
  it('"多次搜索" without a search is a claimed search', () => {
    expect(
      unperformedActions('多次搜索“100142621606”也无结果。', {
        visitedUrls: ['https://item.jd.com/1.html'],
        searched: false,
      }),
    ).toHaveLength(1);
  });
});

describe('core-07: the return names a tab only listed by list_tabs (no "undefined")', () => {
  it('the listed title is shown', async () => {
    let active = 'source';
    let next = 0;
    const listed: Record<string, string> = {
      source: 'Web browser - Wikipedia',
      t1: 'Safari (web browser) - Wikipedia',
    };
    const execute = async (action: {
      tool: string;
      targetTabId?: string;
    }): Promise<UnifiedToolResult> => {
      if (action.tool === 'click') {
        active = `t${++next}`;
        return {
          ok: true,
          text: `已打开新标签 ${active}`,
          tabId: active,
          openedTab: true,
          url: 'https://en.wikipedia.org/wiki/Safari',
        };
      }
      if (action.tool === 'list_tabs')
        return {
          ok: true,
          text: JSON.stringify({
            tabs: Object.entries(listed).map(([tabId, title]) => ({ tabId, title })),
          }),
        };
      if (action.tool === 'switch_tab') active = action.targetTabId!;
      // A read with no level-1 heading: the title comes from list_tabs only.
      return {
        ok: true,
        tabId: active,
        text: JSON.stringify({ tabId: active, tree: '- paragraph: text' }),
      };
    };
    const { adapter, seen } = scriptedLoop([
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e1', newTab: true } },
      { name: 'switch_tab', input: { targetTabId: 't1' } },
      { name: 'list_tabs', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      {
        name: 'finish',
        input: { status: 'completed', summary: '打开了一个新标签并读取，已切回原标签。' },
      },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '新标签标题：Safari (web browser) - Wikipedia。已切回原标签。',
        },
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，从一个页面打开1个链接到新标签，分别读标题后回到第一个',
      adapter,
      maxSteps: 12,
      observationV2: true,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: execute as never,
    });
    const all = seen.join('\n');
    expect(all).toContain('新标签的标题没写进答案：「Safari (web browser) - Wikipedia」');
    expect(all).not.toContain('undefined');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});

describe('Deploy-29 fc-jd: a run whose browser control is lost on a login page', () => {
  async function scenario(failViewport: boolean, target: string, cancelAtTurn2 = false) {
    const page = await browser.newPage();
    // As on JD: the item page opens, then sends the anonymous visitor to the login page.
    await page.route('https://item.jd.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<h1>商品详情</h1><script>setTimeout(() => location.assign('https://passport.jd.com/new/login.aspx'), 2500)</script>`,
      }),
    );
    await page.route('https://passport.jd.com/**', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: JD_LOGIN }),
    );
    await page.route('https://plain.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>Plain page</h1><p>Public text.</p>',
      }),
    );
    const control = new BrowserControl();
    let turn = 0;
    const run = runUnifiedSupercarTask({
      taskId: `fix29-jd-${failViewport}-${target}`,
      userExternalId: 'fixture-user',
      intent: `打开 ${target} 读商品标题和页面显示的价格`,
      executor: { getPage: async () => page } as never,
      browserControl: control,
      browserCapabilities: {
        viewportV2: true,
        observationV2: true,
        replayV1: false,
        routingV2: false,
      },
      timeoutMs: 8000,
      isTaskCancelled: async () => cancelAtTurn2 && turn >= 2,
      messagesAdapter: {
        metadata: { provider: 'anthropic', model: 'fixture' },
        async create() {
          turn += 1;
          if (turn === 2)
            await page.waitForURL(/passport|plain/, { timeout: 6000 }).catch(() => {});
          // A viewer connects after the navigation: its resize fails (the page moved on).
          if (turn === 2 && failViewport)
            control.queueViewport(async () => {
              throw new Error('browser_session_changed');
            });
          const call =
            turn === 1
              ? { name: 'navigate', input: { url: target } }
              : turn === 2
                ? { name: 'snapshot', input: {} }
                : { name: 'finish', input: { status: 'failed', summary: '没读到' } };
          return {
            id: String(turn),
            metadata: this.metadata,
            stopReason: 'tool_use',
            content: [{ type: 'tool_use', id: String(turn), ...call }],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        },
      },
    } as RunSupercarOptions);
    try {
      return { outcome: await run, control };
    } finally {
      control.close();
      await page.close();
    }
  }
  it('the login page is named, with a rerun, not 「已取消」 (the closed control cannot be handed over)', async () => {
    const { outcome, control } = await scenario(true, 'https://item.jd.com/100142621606.html');
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.reason).toMatch(/登录/);
    expect(outcome.status === 'failed' && outcome.reason).toContain('请重新执行任务');
    expect(control.snapshot()).toMatchObject({ phase: 'closed', error: 'viewport_failed' });
  }, 20000);
  it('without a wall, it fails and says why', async () => {
    const { outcome } = await scenario(true, 'https://plain.example/item');
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(outcome.status === 'failed' && outcome.reason).toContain('画面同步中断');
  }, 20000);
  it("the user's cancel comes first: cancelled, not failed (review 4)", async () => {
    const { outcome } = await scenario(true, 'https://item.jd.com/100142621606.html', true);
    expect(outcome.status).toBe('cancelled');
  }, 20000);
  it('a viewport that applies does not stop the run', async () => {
    const { outcome } = await scenario(false, 'https://item.jd.com/100142621606.html');
    expect(outcome.status).toBe('awaiting_user');
  }, 20000);
});
