import { describe, expect, it } from 'vitest';
import { type BrowserTrace, asksForVideoPage, completionGap } from './browser-completion.js';

/**
 * FIX-61B P1-8 (Deploy-61 online core-03): 「YouTube 公开视频页读标题/频道/播放量/发布日期」 answered
 * from a search results page was judged complete. It completes only from a video page.
 */
const CORE_03 = '请使用云端浏览器，YouTube 公开视频页读标题/频道/播放量/发布日期（不播放）';
const SEARCH: BrowserTrace = {
  tool: 'navigate',
  ok: true,
  url: 'https://www.youtube.com/results?search_query=public+video',
};
const WATCH: BrowserTrace = {
  tool: 'click',
  ok: true,
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};
const ANSWER = '标题：…；频道：…；播放量：…；发布日期：…';

describe('FIX-61B P1-8: a video-page task completes only from a video page', () => {
  it('core-03 read only the search results: not complete', () => {
    expect(completionGap(CORE_03, ANSWER, [SEARCH], true)).toMatch(/没有进入任何视频页/);
  });
  it('once a video page was opened it may complete', () => {
    expect(completionGap(CORE_03, ANSWER, [SEARCH, WATCH], true)).toBeNull();
  });
  it('an honest 「部分完成：」 still ends', () => {
    expect(
      completionGap(
        CORE_03,
        '部分完成：YouTube 视频页这次没能打开，只读到了搜索结果。',
        [SEARCH],
        true,
      ),
    ).toBeNull();
  });
  it('searches and lists of videos are not asked to open one', () => {
    expect(
      asksForVideoPage('请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题'),
    ).toBe(false);
    expect(asksForVideoPage('B站热门榜前 10 个视频')).toBe(false);
    expect(asksForVideoPage(CORE_03)).toBe(true);
  });
});
