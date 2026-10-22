import { describe, expect, it } from 'vitest';
import { matchExpertWorkflow } from '../execution/expert-workflow-registry.js';
import { explainExecutionMode } from './intent-classifier.js';

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
  ])('reading a platform still reads it: %s → %s', async (intent, mode) => {
    expect(await route(intent)).toBe(mode);
  });
  it('content-topic still takes topic planning', () => {
    expect(
      matchExpertWorkflow({ intent: '帮我想 5 个小红书爆款选题，品类是护肤' } as never)?.workflowId,
    ).toBe('content-topic');
  });
});
