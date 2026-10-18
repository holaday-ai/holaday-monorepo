import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completionGap } from './browser-completion.js';

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
