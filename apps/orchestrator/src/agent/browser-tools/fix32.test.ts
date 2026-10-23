import { describe, expect, it } from 'vitest';
import { listPartialNote, reviewListAnswer } from '../../execution/answer-verifier.js';
import type { ExecutionContract } from '../../execution/execution-contract.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { observationState, qqMusicReadRpc } from './cloud-observation.js';
import { assessCompletionFacts, observedEvidence } from './completion-fields.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import {
  MASKED_PAGE,
  SENSITIVE_PAGE_MESSAGE,
  runUnifiedBrowserLoop,
  siteLock,
} from './unified-browser-loop.js';

/** FIX-32 (QUEUE 31): browser-side fixes for Deploy-32 b-p02 / b-m01 / v06. */

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

/** A browser whose reads return `page(url)` for the last page opened. */
function browser(page: (url: string) => string) {
  let url = 'about:blank';
  const opened: string[] = [];
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') {
      url = action.url!;
      opened.push(url);
      return { ok: true, text: `已打开 ${url}`, url };
    }
    return { ok: true, text: page(url), url };
  };
  return { execute, opened, currentPageUrl: () => url };
}

describe('v06: QQ 音乐 RPC — only verified read methods pass', () => {
  const rpc = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
  const call = (module: string, method: string) =>
    JSON.stringify({
      comm: { ct: 24, cv: 0 },
      req_0: { module, method, param: { topid: 26, offset: 0, num: 3, period: '' } },
    });
  it.each([
    ['chart detail', call('musicToplist.ToplistInfoServer', 'GetDetail')],
    ['chart list', call('musicToplist.ToplistInfoServer', 'GetAll')],
    ['search', call('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop')],
  ])('%s is a read', (_case, body) => {
    expect(qqMusicReadRpc(rpc, body)).toBe(true);
  });
  it.each([
    // The web client's own requests (captured 2026-10-22, clicking 排行榜): encrypted.
    [
      'an encrypted body',
      'https://u6.y.qq.com/cgi-bin/musics.fcg?_=1792713552573&encoding=ag-1&sign=zzc49db6fa7bzy31zbvzipgb1kffxspsigk4e4d6d1889',
      'JHj8fDQKLvmSIH7OXa0hl9bzb2+IalowslypJQTgl+QL6qUldQgNuP7DKz1sFpLRm70f9ilu3NyCv8IOmyz+DbV6stEySzRGAzMsB7uzUPOfdAk0N75MIf39',
    ],
    ['the empty beacon (t.y.qq.com)', 'https://t.y.qq.com/cgi-bin/musicu.fcg', ''],
    // Not verified as reads — favourites, follows, comments, play reports, anything else.
    ['a favourite', rpc.href, call('music.musicasset.SongFavWrite', 'FavSong')],
    ['a follow', rpc.href, call('music.concern.RelationServer', 'Follow')],
    ['a comment', rpc.href, call('music.globalComment.CommentWriteServer', 'AddComment')],
    ['a play report', rpc.href, call('music.stat.PlayReport', 'Report')],
    ['an unknown method', rpc.href, call('musicToplist.ToplistInfoServer', 'GetDetailAndMore')],
    [
      'a read batched with a write',
      rpc.href,
      JSON.stringify({
        req_0: { module: 'musicToplist.ToplistInfoServer', method: 'GetDetail' },
        req_1: { module: 'music.musicasset.SongFavWrite', method: 'FavSong' },
      }),
    ],
    [
      'another host',
      'https://evil.example/cgi-bin/musicu.fcg',
      call('musicToplist.ToplistInfoServer', 'GetDetail'),
    ],
  ])('%s still pauses', (_case, url, body) => {
    expect(qqMusicReadRpc(new URL(url), body)).toBe(false);
  });
});

describe('b-p02: prices on a regional page', () => {
  it('Deploy-31: the delivery fee is not the price the answer contradicts', () => {
    const page = observedEvidence(
      'x',
      [
        '- heading "Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)"',
        '- generic [ref=e364]: S$9.53 delivery Wed, Oct 28',
      ].join('\n'),
      'https://www.amazon.com/dp/B0DZJXN9FJ',
    );
    const facts = assessCompletionFacts({
      summary:
        '商品名称：Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)\n价格：S$14.99',
      pages: [page],
    });
    expect(facts.contradictions.join('；')).not.toMatch(/delivery/i);
    // PR #294 review: the fee goes, the item's own price on the same line stays.
    const sameLine = observedEvidence(
      'x',
      '- generic: Price S$14.99, S$9.53 delivery',
      'https://a.example/dp/1',
    );
    expect(
      assessCompletionFacts({ summary: '价格：S$12.99', pages: [sameLine] }).contradictions,
    ).toEqual([expect.stringContaining('与页面不符')]);
    expect(
      assessCompletionFacts({ summary: '价格：S$14.99', pages: [sameLine] }).contradictions,
    ).toEqual([]);
    // A different price that is not a fee still contradicts.
    const priced = observedEvidence(
      'x',
      '- generic [ref=e12]: S$15.82',
      'https://www.amazon.com/dp/B0',
    );
    expect(
      assessCompletionFacts({ summary: '价格：S$14.99', pages: [priced] }).contradictions,
    ).toEqual([expect.stringContaining('与页面不符')]);
  });
  it('SGD 11.46 and S$11.46 are the same price', () => {
    const page = observedEvidence(
      'x',
      '- link "LISEN USB C to USB C Cable" - generic: S$11.46',
      'https://www.amazon.com/s?k=usb+c+cable',
    );
    const facts = assessCompletionFacts({ summary: '价格：SGD 11.46', pages: [page] });
    expect(facts.contradictions).toEqual([]);
    expect(facts.unverified).toEqual([]);
  });
});

describe('b-p02: an honest gap on the page is delivered as 部分完成', () => {
  const answer = `已在 amazon.com 搜索 "usb c cable"，读取搜索结果页前3个商品的名称和价格：

1. 名称：Anker USB C to USB C Cable；价格：未获取到（该商品卡片仅显示 "See options"，无具体价格）。
2. 名称：LISEN USB C to USB C Cable；价格：SGD 11.46。
3. 名称：USB C Monitor Cable 2FT；价格：SGD 15.32。`;
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
  it('completes once, as 部分完成, without a rejection', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://www.amazon.com/s?k=usb+c+cable' } },
      { name: 'read_page', input: {} },
      { name: 'finish', input: { status: 'completed', summary: answer } },
    ]);
    const site = browser(
      () =>
        'link "Anker USB C to USB C Cable" See options\nlink "LISEN USB C to USB C Cable" SGD 11.46\nlink "USB C Monitor Cable 2FT" SGD 15.32',
    );
    const rejected: unknown[] = [];
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名和价格',
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
      reviewFinish: (summary: string, page?: string) => reviewListAnswer(contract, summary, page),
      partialNote: (summary: string, page?: string) => listPartialNote(contract, summary, page),
      onCompletionRejected: async (event: unknown) => {
        rejected.push(event);
      },
    } as never);
    expect(rejected).toEqual([]);
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/^部分完成：第 1 条页面未显示价格/),
      partial: expect.anything(),
    });
  });
});

describe('b-m01: 高德 stays 高德; a masked login page goes to the user', () => {
  const intent = '请使用云端浏览器，高德地图查一下杭州东站到西湖断桥怎么走，大概多久';
  it('another map site is refused; the named site is not', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://ditu.amap.com/dir?type=car' } },
      { name: 'navigate', input: { url: 'https://map.baidu.com/dir/杭州东站/西湖断桥' } },
      { name: 'finish', input: { status: 'failed', summary: '高德地图路线页没有读到路线。' } },
    ]);
    const site = browser(() => 'heading "路线规划" 请选择正确的起点、途经点或终点');
    const outcome = await runUnifiedBrowserLoop({
      intent,
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    });
    expect(site.opened).toEqual(['https://ditu.amap.com/dir?type=car']);
    expect(seen.join('\n')).toContain('不要换到 map.baidu.com');
    expect(outcome.status).toBe('failed');
  });
  it.each([
    // Production: a local host is no stand-in for the named site (PR #295 review) — neither
    // it nor the public substitute opens; the host opens the named site itself (NAV-EXIT-1).
    [false, ['https://the-internet.herokuapp.com/']],
    // browser:loop-audit serves the named site from a loopback fixture; a public host stays refused.
    [true, ['http://127.0.0.1:53781/iframe']],
  ])('Deploy-33: localFixtures=%s → %j', async (localFixtures, opened) => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'http://127.0.0.1:53781/iframe' } },
      { name: 'navigate', input: { url: 'https://demo.example.com/iframe' } },
      { name: 'finish', input: { status: 'failed', summary: '没有读到。' } },
    ]);
    const site = browser(() => 'heading "iframe"');
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
      ...(localFixtures ? { localFixtures: true } : {}),
    });
    expect(site.opened).toEqual(opened);
  });
  it('a named address locks its whole site, not just that host', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'navigate', input: { url: 'https://search.jd.com/Search?keyword=iPhone' } },
      { name: 'navigate', input: { url: 'https://www.taobao.com/' } },
      { name: 'finish', input: { status: 'failed', summary: '没有读到价格。' } },
    ]);
    const site = browser(() => 'heading "商品"');
    await runUnifiedBrowserLoop({
      intent: '京东 https://item.jd.com/100142621606.html 这个多少钱',
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    });
    expect(site.opened).toEqual([
      'https://item.jd.com/100142621606.html',
      'https://search.jd.com/Search?keyword=iPhone',
    ]);
  });
  it('PR #294 review: an address on any TLD locks its site', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://docs.example.tech/guide' } },
      { name: 'navigate', input: { url: 'https://mirror.example.org/guide' } },
      { name: 'finish', input: { status: 'failed', summary: '没有读到。' } },
    ]);
    const site = browser(() => 'heading "Guide"');
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，打开 https://docs.example.tech/guide 读第一段',
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    });
    expect(site.opened).toEqual(['https://docs.example.tech/guide']);
  });
  it('a link the run read on the named site may be followed', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://www.amap.com/' } },
      { name: 'read_page', input: {} },
      { name: 'navigate', input: { url: 'https://lbs.example.com/doc' } },
      { name: 'finish', input: { status: 'failed', summary: '没有读到路线。' } },
    ]);
    const site = browser(() => 'link "开放平台" https://lbs.example.com/doc');
    await runUnifiedBrowserLoop({
      intent,
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    });
    expect(site.opened).toEqual(['https://www.amap.com/', 'https://lbs.example.com/doc']);
  });
  it('a read masked for its login form hands over instead of wandering off', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://ditu.amap.com/dir?type=car' } },
      { name: 'read_page', input: {} },
      { name: 'navigate', input: { url: 'https://map.baidu.com/' } },
    ]);
    const masked = JSON.stringify({
      redacted: true,
      tree: '已遮挡，未读取：敏感输入页面，请用户接管',
      status: 'redacted_unread',
    });
    const site = browser(() => masked);
    const outcome = await runUnifiedBrowserLoop({
      intent,
      adapter,
      maxSteps: 6,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    });
    expect(outcome).toMatchObject({
      status: 'awaiting_user',
      reason: 'login',
      message: SENSITIVE_PAGE_MESSAGE,
    });
    expect(site.opened).toEqual(['https://ditu.amap.com/dir?type=car']);
  });
});

/** FIX-32 coordinator review (PR #294 head c325c967). */
describe('review 1: the site lock leaves room for the search fallback and a named second site', () => {
  it('a result web_search returned may be opened under the lock (Google walled)', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://www.google.com/search?q=Claude' } },
      { name: 'web_search', input: { query: 'Claude' } },
      { name: 'navigate', input: { url: 'https://www.anthropic.com/claude' } },
      { name: 'navigate', input: { url: 'https://unrelated.example/' } },
      { name: 'finish', input: { status: 'failed', summary: '没有读到。' } },
    ]);
    const site = browser(() => 'heading "Claude"');
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，打开 google.com 搜索 Claude 并总结第一条',
      adapter,
      maxSteps: 8,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
      webSearch: async () => [{ title: 'Claude', url: 'https://www.anthropic.com/claude' }],
    });
    expect(site.opened).toEqual([
      'https://www.google.com/search?q=Claude',
      'https://www.anthropic.com/claude',
    ]);
  });
  it.each([
    ['总结 https://a.example.com/x 并在维基百科查作者', ['example.com', 'wikipedia.org']],
    ['请使用云端浏览器，打开 google.com 搜索 Claude 并总结第一条', ['google.com']],
    // A second place we cannot name: no lock rather than a wrong one.
    ['总结 https://a.example.com/x 并在 MDN 查作者', []],
  ])('%s → %j', (intent, sites) => {
    expect(siteLock(intent)).toEqual(sites);
  });
});

describe('review 4: the handover says why the page was masked', () => {
  const masked = (maskReason?: string) =>
    JSON.stringify({
      redacted: true,
      status: 'redacted_unread',
      ...(maskReason ? { maskReason } : {}),
    });
  it.each([
    ['login', 'login', MASKED_PAGE.login.message],
    ['payment', 'payment', MASKED_PAGE.payment.message],
    ['unreadable', 'permission', MASKED_PAGE.unreadable.message],
    [undefined, 'login', MASKED_PAGE.login.message],
  ])('%s → %s', async (maskReason, reason, message) => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://shop.example/checkout' } },
      { name: 'read_page', input: {} },
    ]);
    const site = browser(() => masked(maskReason));
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，打开 https://shop.example/checkout 看看订单金额',
      adapter,
      maxSteps: 4,
      execute: site.execute as never,
      currentPageUrl: site.currentPageUrl,
    });
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason, message });
  });
  it('the observer names the cause without changing what it masks', async () => {
    const chromium = (await import('playwright')).chromium;
    const b = await chromium.launch({ headless: true });
    try {
      const page = await b.newPage();
      const state = async (html: string, path = '/') => {
        await page.route('**/*', (r) =>
          r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
        );
        await page.goto(`https://masked.example${path}`);
        await page.unroute('**/*');
        return observationState(page.mainFrame());
      };
      expect(await state('<input type="password">')).toMatchObject({
        sensitive: true,
        maskReason: 'login',
      });
      expect(await state('<input placeholder="银行卡号">')).toMatchObject({
        sensitive: true,
        maskReason: 'payment',
      });
      expect(await state('<p>订单</p>', '/checkout')).toMatchObject({
        sensitive: true,
        maskReason: 'payment',
      });
      expect(await state('<input placeholder="搜索">')).toMatchObject({
        sensitive: false,
        maskReason: null,
      });
    } finally {
      await b.close();
    }
  }, 60_000);
});
