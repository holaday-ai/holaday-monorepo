/**
 * Sprint #5 — image-generation lane routing. Pins the new 'image'
 * mode so text-to-image / image-edit asks reach the nano-banana lane,
 * while charts/diagrams and image-understanding stay out of it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { classifyExecutionMode } from './intent-classifier.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

const classify = (intent: string, skillId?: string) =>
  classifyExecutionMode({ intent, logger: fakeLogger(), ...(skillId ? { skillId } : {}) });

describe('classifyExecutionMode — image lane', () => {
  it.each([
    '画一只在草地上的橘猫',
    '帮我画张猫',
    '生成一张夏日防晒主题的海报',
    '生成图片：赛博朋克城市夜景',
    '做一个公司logo',
    '给这篇文章配图',
    '文生图：一杯冰美式',
    '设计一张杂志封面',
    '来张壁纸，星空主题',
  ])('routes "%s" → image', async (intent) => {
    expect(await classify(intent)).toBe('image');
  });

  it.each([
    '把这张图的背景换成海边',
    '帮我把图片背景去掉',
    '换个背景，改成纯白',
    'generate an image of a husky in snow',
    'draw me a poster',
    'edit this image and remove the watermark',
    'create a logo for my coffee shop',
  ])('routes "%s" → image (edit/english)', async (intent) => {
    expect(await classify(intent)).toBe('image');
  });

  it('image intent overrides an installed skill hint', async () => {
    // xiaohongshu skill normally forces 'browser'; an explicit image
    // ask is a STRONG signal and wins.
    expect(await classify('帮我画一张小红书封面图', 'xiaohongshu')).toBe('image');
  });

  it.each([
    ['画一个流程图', 'generate'],
    ['生成一张数据图表', 'generate'],
    ['做一个思维导图', 'generate'],
  ])('keeps diagrams/charts out of the image lane: "%s"', async (intent, expected) => {
    expect(await classify(intent)).toBe(expected);
  });

  it.each([
    '分析这张图片里的内容',
    '看看这张图说了什么',
    '帮我把这段话翻译成英文',
    '写一份周报',
  ])('does not over-trigger on understanding/normal asks: "%s"', async (intent) => {
    expect(await classify(intent)).not.toBe('image');
  });
});
