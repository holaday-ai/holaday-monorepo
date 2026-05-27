import { describe, expect, it } from 'vitest';
import {
  batchTaskDraftHasReusableDetail,
  batchTaskDraftHasContent,
  batchTaskDraftFromPrompt,
  batchTaskDraftMissingGoal,
  batchTaskDraftProgress,
  composeBatchTaskPrompt,
  firstBatchTaskDraftMissingGoal,
} from './batch-task-draft.js';

describe('batch task draft helpers', () => {
  it('composes a structured task prompt from separate fields', () => {
    expect(
      composeBatchTaskPrompt({
        goal: '查 OpenAI 最新动态',
        steps: '1. 找官方来源\n2. 总结三条',
        output: '给出链接和判断',
      }),
    ).toBe('目标：查 OpenAI 最新动态\n步骤：1. 找官方来源\n2. 总结三条\n输出：给出链接和判断');
  });

  it('imports existing labelled prompts without nesting labels', () => {
    expect(
      batchTaskDraftFromPrompt('目标：查 Manus 更新\n步骤：看官网和新闻\n输出：三条摘要'),
    ).toEqual({
      goal: '查 Manus 更新',
      steps: '看官网和新闻',
      output: '三条摘要',
    });
  });

  it('uses unlabelled prompts as the goal field', () => {
    expect(batchTaskDraftFromPrompt('查竞品最新价格')).toEqual({
      goal: '查竞品最新价格',
      steps: '',
      output: '',
    });
  });

  it('summarizes field completion', () => {
    expect(
      batchTaskDraftProgress({
        goal: '查资料',
        steps: '',
        output: '表格',
      }),
    ).toEqual({
      hasGoal: true,
      hasSteps: false,
      hasOutput: true,
      missingGoal: false,
      count: 2,
    });
  });

  it('detects partially filled cards without a goal', () => {
    const drafts = [
      { goal: '', steps: '', output: '' },
      { goal: '', steps: '1. 先搜索', output: '' },
      { goal: '查价格', steps: '', output: '' },
    ];

    expect(batchTaskDraftHasContent(drafts[0])).toBe(false);
    expect(batchTaskDraftMissingGoal(drafts[1])).toBe(true);
    expect(firstBatchTaskDraftMissingGoal(drafts)).toBe(1);
    expect(batchTaskDraftProgress(drafts[1]).missingGoal).toBe(true);
  });

  it('detects cards with reusable steps or output details', () => {
    expect(
      batchTaskDraftHasReusableDetail({ goal: '查价格', steps: '', output: '' }),
    ).toBe(false);
    expect(
      batchTaskDraftHasReusableDetail({
        goal: '查价格',
        steps: '1. 找官网',
        output: '',
      }),
    ).toBe(true);
    expect(
      batchTaskDraftHasReusableDetail({
        goal: '',
        steps: '',
        output: '给出来源',
      }),
    ).toBe(true);
  });
});
