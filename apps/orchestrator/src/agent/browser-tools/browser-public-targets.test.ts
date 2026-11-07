import { expect, it } from 'vitest';
import { canReadOutsideWall } from './browser-public-targets.js';
const all = {
  title: true,
  channel: true,
  views: true,
  date: true,
  description: true,
  article: true,
};
it.each([
  ['读取标题、频道、播放量、发布日期，不播放', true],
  ['Read title, channel, view count and publication date without playing the video.', true],
  ['不只播放视频，还要读取标题', false],
  ['Do not play; read subtitles', false],
  ['读取标题和字幕，不播放', false],
  ['Read the title and play the video', false],
  ['总结视频内容', false],
  ['读取被遮挡的内容', false],
  ['读取评论区', false],
  ['读取元信息', true],
  ['阅读文章正文', true],
  ['完成任务', false],
])('classifies task target %s without claiming protected content', (intent, expected) => {
  expect(canReadOutsideWall(intent, all)).toBe(expected);
});
it('requires every requested field, and rejects unknown goals', () => {
  expect(canReadOutsideWall('读取标题、发布日期', { ...all, date: false })).toBe(false);
  expect(canReadOutsideWall('读取频道', { ...all, channel: false })).toBe(false);
  expect(canReadOutsideWall(undefined, all)).toBe(false);
});
