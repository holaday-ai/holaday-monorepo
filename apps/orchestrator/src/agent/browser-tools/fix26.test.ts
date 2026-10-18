import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { completionGap } from './browser-completion.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** FIX-26: the INTEGRATE-26 findings, with the real rejected answers as fixtures. */
const answers = JSON.parse(
  readFileSync(new URL('./fixtures/integrate26-answers.json', import.meta.url), 'utf8'),
) as { saCore02: string[]; sbCore04: string[]; sbCore02: string[] };
const P = '请使用云端浏览器，';
const WEATHER = `${P}Google 搜索「新加坡 天气」读出天气卡片`;
const RESULTS = [
  { tool: 'navigate', ok: true, url: 'https://search-results.holaday.invalid/search?q=x' },
];

describe('1. a suggested or denied visit is not a claimed visit (sa core-02)', () => {
  it.each(answers.saCore02.map((answer, i) => [i + 1, answer]))(
    'the real answer %i is not rejected for weather.gov.sg',
    (_i, answer) => {
      expect(completionGap(WEATHER, answer as string, RESULTS as never, false)).toBeNull();
    },
  );
  it.each([
    '若需更精细的预报，可进一步打开结果中的 AccuWeather、Weather.gov.sg 等链接读取',
    '如需更多，可再打开结果中的 weather.gov.sg',
    '如需更详细的小时预报，可自行访问结果列表中的 weather.gov.sg 查看。',
    '本次未实际访问 weather.gov.sg 或其他外部天气网站',
    '我没有打开 weather.gov.sg。',
  ])('"%s" passes', (answer) => {
    expect(completionGap(WEATHER, answer, RESULTS as never, false)).toBeNull();
  });
  it.each([
    '已打开 weather.gov.sg 读取到当前温度 31°。',
    '我访问了 weather.gov.sg，页面显示 31°。',
    '读取了 weather.gov.sg 的天气页面。',
    '没有用摘要，而是已打开 weather.gov.sg 读取。',
  ])('"%s" still needs a visit receipt', (answer) => {
    expect(completionGap(WEATHER, answer, RESULTS as never, false)).toContain('weather.gov.sg');
  });
});

describe('2. a page filter tab is not a browser tab switch (sb core-04)', () => {
  const YT = `${P}YouTube 搜索「Playwright tutorial」返回前5个视频标题`;
  const trace = [{ tool: 'navigate', ok: true, url: 'https://www.youtube.com/' }];
  it('the real answer passes', () => {
    expect(completionGap(YT, answers.sbCore04[0]!, trace as never, false)).toBeNull();
  });
  it.each(['切换到「图片」标签后读取', '切换到“全部”标签', '切换到筛选标签「视频」'])(
    '"%s" passes',
    (answer) => {
      expect(completionGap(YT, answer, trace as never, false)).toBeNull();
    },
  );
  it.each(['最后切回第一个标签页', '已切换到新标签', '切换到 tab_1 标签', '已切回原标签'])(
    '"%s" still needs a switch_tab receipt',
    (answer) => {
      expect(completionGap(YT, answer, trace as never, false)).toContain('switch_tab');
    },
  );
  it('"切换回第一个新标签" on an open-links task still needs the start tab (fb core-07)', () => {
    const opened = [
      { tool: 'click', ok: true, tabId: 'new1', openedTab: true, fromTabId: 'source' },
      { tool: 'switch_tab', ok: true, tabId: 'new1' },
    ];
    expect(
      completionGap(
        `${P}从一个页面打开3个链接到新标签，分别读标题后回到第一个`,
        '最后已切换回第一个新标签 new1。',
        opened as never,
        false,
      ),
    ).toContain('起始标签是 source');
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

/** Results page in tab r1; a weather page opens in tab w1 (click newTab) or by navigate. */
function weatherBrowser() {
  const SEARCH = 'https://search-results.holaday.invalid/search?q=%E6%96%B0%E5%8A%A0%E5%9D%A1';
  const WEATHER = 'https://www.weather.gov.sg/home/';
  let tab = 'r1';
  const url = () => (tab === 'r1' ? SEARCH : WEATHER);
  const execute = async (action: {
    tool: string;
    url?: string;
    newTab?: boolean;
    targetTabId?: string;
  }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') {
      tab = action.url === SEARCH ? 'r1' : 'w1';
      return { ok: true, text: '已打开', url: url(), tabId: tab };
    }
    if (action.tool === 'click' && action.newTab) {
      tab = 'w1';
      return { ok: true, text: '已打开新标签 w1', tabId: 'w1', openedTab: true, url: WEATHER };
    }
    if (action.tool === 'switch_tab') {
      tab = action.targetTabId!;
      return { ok: true, text: '已切换', tabId: tab, url: url() };
    }
    const tree =
      tab === 'r1'
        ? '结果 10 Yahoo 氣象：当前温度 31° 局部雷雨\n天气卡片 风速 10 公里/小時'
        : '24-hour Forecast Thundery showers\n34°C 25°C\nHumidity 60% - 95%';
    return {
      ok: true,
      text: JSON.stringify({ tabId: tab, sourceURL: url(), tree }),
      url: url(),
      tabId: tab,
    };
  };
  return { execute, SEARCH, WEATHER, currentPageUrl: url };
}

describe('3. core-02: the weather returns come first and say what to do', () => {
  it('sa: snippet values + a suggested site get the "open a weather page" return, then complete', async () => {
    const b = weatherBrowser();
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: b.SEARCH } },
      { name: 'read_page', input: {} },
      { name: 'finish', input: { status: 'completed', summary: answers.saCore02[0]! } },
      { name: 'navigate', input: { url: b.WEATHER } },
      { name: 'read_page', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary:
            '已打开 weather.gov.sg 读取：24 小时预报 Thundery showers，34°C / 25°C，湿度 60% - 95%。',
        },
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: WEATHER,
      adapter,
      maxSteps: 10,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    const log = seen.join('\n');
    expect(log).toContain('这些天气数值来自搜索结果页的摘要');
    expect(log).not.toContain('答案说打开/访问了');
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('sb: a value bound to an unread new tab, then to the wrong page, is corrected without the general return', async () => {
    const b = weatherBrowser();
    const field = (name: string, value: string, tabId: string) => ({ name, value, tabId });
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: b.SEARCH } },
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e5', newTab: true } },
      // Submitted before reading the new tab.
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '新加坡天气如下。',
          fields: [field('湿度', '60% - 95%', 'w1')],
        },
      },
      { name: 'read_page', input: {} },
      // The results card's wind speed bound to the weather tab.
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '新加坡天气如下。',
          fields: [field('湿度', '60% - 95%', 'w1'), field('风速', '10 公里/小時', 'w1')],
        },
      },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '新加坡天气如下。',
          fields: [field('湿度', '60% - 95%', 'w1'), field('风速', '10 公里/小時', 'r1')],
        },
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: WEATHER,
      adapter,
      maxSteps: 12,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    const log = seen.join('\n');
    // The unread new tab: the snippet-only weather return names reading the page.
    expect(log).toContain('请打开结果里的一个天气来源页面');
    expect(log).toContain('风速「10 公里/小時」 → 标签 r1');
    expect(log).toContain('请把出处改绑到读到它的那一页');
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('a value read nowhere is still a contradiction for the general return', async () => {
    const b = weatherBrowser();
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: b.WEATHER } },
      { name: 'read_page', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '湿度如下。',
          fields: [{ name: '湿度', value: '61% - 97%', tabId: 'w1' }],
        },
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: WEATHER,
      adapter,
      maxSteps: 6,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    expect(seen.join('\n')).not.toContain('请把出处改绑');
    expect(outcome.status).toBe('failed');
  });
});

describe('3b. a field bound to a tab that was opened but not read', () => {
  it('is told to read that tab first, without spending the general return', async () => {
    const b = weatherBrowser();
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: b.SEARCH } },
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e5', newTab: true } },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '页面湿度如下。',
          fields: [{ name: '湿度', value: '60% - 95%', tabId: 'w1' }],
        },
      },
      { name: 'read_page', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '页面湿度如下。',
          fields: [{ name: '湿度', value: '60% - 95%', tabId: 'w1' }],
        },
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: `${P}打开搜索结果里的气象局页面，读出湿度`,
      adapter,
      maxSteps: 10,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    expect(seen.join('\n')).toContain(
      '标签 w1 打开后还没有读取：请先 read_page / get_page_text 读取它',
    );
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});
