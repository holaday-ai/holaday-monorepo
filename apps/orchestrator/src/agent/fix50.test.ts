import { describe, expect, it } from 'vitest';
import { answerNotObtained } from './scrape-answer-check.js';

/** The Deploy-49 dy prompts (dy-2 / reg-dy-2). */
const DY =
  '打开 https://www.douyin.com/video/7377304298310389027 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
const READ =
  '- 标题：柠檬巴巴露亚\n- 作者：小喵麻麻\n- 点赞数：4741\n- 评论数：215\n- 收藏数：4369\n- 分享数：1652';

describe('FIX-50 #2 · 「点赞等数据均无法提供」', () => {
  it('a count stem ending a list cut short with 等 is the asked counts unprovided', () => {
    expect(answerNotObtained('标题：A。作者：B。点赞等数据均无法提供。', DY)).toBe(true);
    expect(answerNotObtained('标题：A。作者：B。评论等互动数据无法提供。', DY)).toBe(true);
  });

  it('every asked count given: 「点赞等数据」 said read is still complete', () => {
    expect(answerNotObtained(`点赞等互动数据均已读取。\n${READ}`, DY)).toBe(false);
    expect(answerNotObtained(`${READ}\n（推荐视频的点赞等数据无法提供）`, DY)).toBe(false);
  });
});
