import { describe, expect, it } from 'vitest';
import { parseBatchPromptItems, parseBatchPrompts } from './batch-prompts';

describe('parseBatchPrompts', () => {
  it('trims blank lines and preserves first occurrence order', () => {
    expect(parseBatchPrompts('  A  \n\nB\nA\nC', 50)).toEqual({
      prompts: ['A', 'B', 'C'],
      rawCount: 4,
      duplicateCount: 1,
      overLimit: false,
    });
  });

  it('checks the limit after de-duplication', () => {
    expect(parseBatchPrompts('A\nA\nB', 1)).toEqual({
      prompts: ['A', 'B'],
      rawCount: 3,
      duplicateCount: 1,
      overLimit: true,
    });
  });

  it('keeps multi-line task cards as one prompt each', () => {
    expect(
      parseBatchPromptItems(
        [
          '查 OpenAI 最新动态\n步骤：先搜新闻，再整理成三点',
          '',
          '查 Manus 最新动态\n步骤：关注产品更新',
          '查 OpenAI 最新动态\n步骤：先搜新闻，再整理成三点',
        ],
        50,
      ),
    ).toEqual({
      prompts: [
        '查 OpenAI 最新动态\n步骤：先搜新闻，再整理成三点',
        '查 Manus 最新动态\n步骤：关注产品更新',
      ],
      rawCount: 3,
      duplicateCount: 1,
      overLimit: false,
    });
  });
});
