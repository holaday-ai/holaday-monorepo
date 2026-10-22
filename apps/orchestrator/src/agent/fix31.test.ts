import { describe, expect, it } from 'vitest';
import { matchExpertWorkflow } from '../execution/expert-workflow-registry.js';
import { explainExecutionMode } from './intent-classifier.js';
import { answerNotObtained } from './scrape-runner.js';

/**
 * FIX-31 (Deploy-31 rollback) — routing pieces that are not in the A-share,
 * gate, contract or playback suites.
 */
const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = async (intent: string) => (await explainExecutionMode({ intent, logger })).mode;

describe('ct-create: writing for a platform is writing, not reading it', () => {
  it.each([
    '帮我写 3 条小红书露营文案',
    '给抖音写一段母婴好物的口播文案',
    '帮我写一篇知乎风格的回答',
  ])('%s → generate', async (intent) => {
    expect(await route(intent)).toBe('generate');
  });
  it.each([
    ['小红书上搜 杭州西湖攻略 第一条笔记标题和作者', 'browser'],
    [
      '打开 https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8 读这篇笔记的标题',
      'scrape',
    ],
    ['QQ音乐热歌榜第一名是啥', 'scrape'],
    // PR #293 review: reworking text that is on the platform needs that text.
    ['翻译知乎上问题《为什么天空是蓝的》的最高赞回答', 'scrape'],
    ['改写小红书上某博主最新一篇笔记', 'scrape'],
  ])('reading a platform still reads it: %s → %s', async (intent, mode) => {
    expect(await route(intent)).toBe(mode);
  });
  it('content-topic still takes topic planning', () => {
    expect(
      matchExpertWorkflow({ intent: '帮我想 5 个小红书爆款选题，品类是护肤' } as never)?.workflowId,
    ).toBe('content-topic');
  });
});

describe('v06: 「在抓取的数据中未显示」 is not obtained (retried in the browser)', () => {
  it.each([
    '根据 QQ音乐热歌榜（2026-10-22 更新）的数据，第1名的歌手是 **A2O LITE / A2O**，时长 03:28，但歌曲名称在抓取的数据中未显示。',
    '抓取的内容里没有显示具体价格。',
  ])('%s', (answer) => {
    expect(answerNotObtained(answer)).toBe(true);
  });
  it('a full answer is not', () => {
    expect(answerNotObtained('QQ音乐热歌榜第一名是《NEON》，演唱者 A2O LITE / A2O。')).toBe(false);
  });
});

describe('v06: the one value asked for is the one the answer could not see', () => {
  it('「第一名是啥」 answered with 「歌曲名称页面未显示」 is not obtained', () => {
    expect(
      answerNotObtained(
        'QQ音乐热歌榜（2026-10-22）第一名的歌手是 **A2O LITE / A2O**，时长 03:28，但歌曲名称页面未显示。',
        'QQ音乐热歌榜第一名是啥',
      ),
    ).toBe(true);
  });
  it('a full one-value answer, or a list answer with one field missing, is not', () => {
    expect(
      answerNotObtained('**3658.03点**，跌55.00点（2026-10-22 15:00 收盘）', '上证指数现在多少点'),
    ).toBe(false);
    expect(
      answerNotObtained(
        '- 标题：西湖一日游攻略\n- 作者：Clara\n- 点赞数：页面未显示',
        '打开 https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8 读这篇笔记的标题、作者和点赞数',
      ),
    ).toBe(false);
  });
});
