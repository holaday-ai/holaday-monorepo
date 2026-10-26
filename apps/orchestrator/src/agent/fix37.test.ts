import { readLoginContext } from '@holaday/shared-types';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { answerClaimsDownloadableFile } from '../execution/file-artifact-consistency.js';
import { HttpAkshareClient } from './a-share/akshare-http-client.js';
import { assessCompletionFacts, observedEvidence } from './browser-tools/completion-fields.js';
import { answerNotObtained } from './scrape-runner.js';

/** Deploy-37 b-v06 (tsk_4g6TY2tKJBAufaNyh4fVi), verbatim. */
const B_V06 =
  '根据抓取的[QQ音乐热歌榜](https://y.qq.com/n/ryqq/toplist/26)（2026-10-26 数据），第一名的**歌曲名称页面未显示**，只显示歌手是**许嵩**，时长 04:24。';

describe('FIX-37 #1 · b-v06: 「第一名的**歌曲名称页面未显示**」 is the asked value missing', () => {
  it('the production answer goes to the browser', () => {
    expect(answerNotObtained(B_V06, 'QQ音乐热歌榜第一名是啥')).toBe(true);
    expect(answerNotObtained(B_V06, '在 QQ 音乐看热歌榜第一名')).toBe(true);
  });
  it('without the bold marks too', () => {
    expect(answerNotObtained(B_V06.replace(/\*\*/g, ''), 'QQ音乐热歌榜第一名是啥')).toBe(true);
  });
  it('reverse: side fields missing are still answers', () => {
    expect(
      answerNotObtained('茅台股价 1500 元。页面未显示价格变化。', '贵州茅台今天股价多少'),
    ).toBe(false);
    expect(answerNotObtained('茅台股价 1500 元，历史价格页面未显示。', '茅台股价多少')).toBe(false);
    expect(answerNotObtained('上证指数 3684 点，成交额页面未显示。', '上证指数现在多少点')).toBe(
      false,
    );
    expect(
      answerNotObtained(
        'QQ音乐热歌榜第一名是《天龙八部之宿敌》，歌手许嵩。',
        'QQ音乐热歌榜第一名是啥',
      ),
    ).toBe(false);
    // Codex on PR #300: the asked name is given; another name missing is a side field.
    expect(
      answerNotObtained(
        'QQ音乐热歌榜第一名是《晴天》，歌手周杰伦，专辑名称页面未显示。',
        'QQ音乐热歌榜第一名是啥',
      ),
    ).toBe(false);
    expect(
      answerNotObtained(
        '第一名是「晴天」，歌曲名称页面未显示完整版本号。',
        'QQ音乐热歌榜第一名是啥',
      ),
    ).toBe(false);
  });
});

describe('FIX-37 #2 · a timed-out stock quote is asked once more', () => {
  const quote = {
    data: [{ 代码: '600519', 最新价: 1338.92, 涨跌幅: 0.29, 行情时间: '2026-10-26 13:03:00' }],
    count: 1,
    source: 'akshare:stock_zh_a_minute(sina,1m,latest)',
    fetched_at: '2026-10-26T05:03:20Z',
    disclaimer: 'd',
  };
  const ok = () => ({ ok: true, status: 200, json: async () => quote });
  const client = (fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<unknown>) =>
    new HttpAkshareClient({
      baseUrl: `http://ak-${Math.random()}.test`,
      timeoutMs: 50,
      fetchImpl: fetchImpl as never,
      logger: { warn: vi.fn() },
    });

  it('our own timeout, then the slow fetch has filled the cache: the second ask has it', async () => {
    let calls = 0;
    const result = await client(async (_url, init) => {
      calls++;
      if (calls === 1)
        return new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      return ok();
    }).getStockQuote('600519');
    expect(calls).toBe(2);
    expect(result.error).toBeUndefined();
    expect(result.data[0]?.最新价).toBe(1338.92);
  });

  it('akshare-mcp’s single-flight timeout is asked once more as well', async () => {
    let calls = 0;
    const result = await client(async () => {
      calls++;
      return calls === 1
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              ...quote,
              data: [],
              error: 'timeout',
              error_code: 'SINGLE_FLIGHT_TIMEOUT',
            }),
          }
        : ok();
    }).getStockQuote('600519');
    expect(calls).toBe(2);
    expect(result.data).toHaveLength(1);
  });

  it('any other failure is not retried', async () => {
    let calls = 0;
    const result = await client(async () => {
      calls++;
      return { ok: false, status: 500, body: { cancel: async () => {} }, json: async () => ({}) };
    }).getStockQuote('600519');
    expect(calls).toBe(1);
    expect(result.error).toBeTruthy();
  });
});

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe('FIX-37 #3 · a sign-up form with no container at all (coordinator fixture R as written)', () => {
  it('its boxes are login boxes, 注册 a login control; the page’s own search box is not', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<main><h1>行情</h1><input id="kw" aria-label="搜索地点"></main><div style="position:fixed;inset:0;background:rgba(0,0,0,.5)"><div style="width:340px;background:#fff"><p>注册</p></div></div>${Array.from({ length: 5 }, (_, i) => `<input id="f${i}" placeholder="字段${i}">`).join('')}<input id="ph" placeholder="请输入"><input id="pw" type="password"><button id="go">注册</button>`,
    );
    const read = (css: string) => page.locator(css).evaluate(readLoginContext, false);
    for (const css of ['#ph', '#f0']) expect((await read(css)).loginField).toBe(true);
    expect((await read('#go')).loginControl).toBe(true);
    expect((await read('#kw')).loginField).toBe(false);
    await page.close();
  });

  it('reverse: a wrapped form beside a body-level password box is untouched', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<div><label>收货城市 <input id="city"></label></div><input type="password"><p>登录</p>',
    );
    expect((await page.locator('#city').evaluate(readLoginContext, false)).loginField).toBe(false);
    await page.close();
  });
});

describe('FIX-37 #4 · two false notes', () => {
  it('b-d04: 「下载链接：https://…」 points at the page’s file, not one we generated', () => {
    expect(
      answerClaimsDownloadableFile(
        'Python 最新版为 3.15.2（发布日期 Oct. 25, 2026）。\n\n- 最新版本：Python 3.15.2\n- macOS安装包下载链接：https://www.python.org/ftp/python/3.15.2/python-3.15.2-macos11.pkg',
      ),
    ).toBe(false);
    expect(answerClaimsDownloadableFile('报告已整理好，下载链接：report.pdf')).toBe(true);
    expect(answerClaimsDownloadableFile('文件已生成，点击下载')).toBe(true);
  });

  it('core-06: 「页面：中国历史 - 维基百科」 is the read page’s own title', () => {
    const page = observedEvidence(
      'x',
      '- heading "中国历史" [level=1]\n- heading "夏朝" [level=2]',
      'https://zh.wikipedia.org/wiki/%E4%B8%AD%E5%9B%BD%E5%8E%86%E5%8F%B2',
    );
    const facts = (value: string) =>
      assessCompletionFacts({
        summary: '第3节标题为「夏朝」。',
        fields: [{ name: '页面', value }],
        pages: [page],
      });
    expect(facts('中国历史 - 维基百科').unverified).toEqual([]);
    expect(facts('日本历史 - 维基百科').unverified.join('；')).toContain('日本历史');
  });
});
