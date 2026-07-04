import { describe, expect, it } from 'vitest';
import { expertResultUsageCopy } from './expert-result-usage';

describe('expertResultUsageCopy', () => {
  it('names typed expert workflows when metadata has a workflow id', () => {
    expect(expertResultUsageCopy({ expertWorkflowId: 'content-topic' })).toBe(
      '本次使用了 1 个技能（选题分析）',
    );
  });

  it('keeps unknown workflow ids visible without inventing a label', () => {
    expect(expertResultUsageCopy({ expertWorkflowId: 'custom-workflow' })).toBe(
      '本次使用了 1 个技能',
    );
  });

  it('surfaces forced expert mode even when no workflow matched', () => {
    expect(expertResultUsageCopy({ expertMode: 'expert' })).toBe(
      '本次按专家模式处理',
    );
  });

  it('does not show expert usage for normal or automatic tasks without a workflow', () => {
    expect(expertResultUsageCopy({ expertMode: 'normal' })).toBeNull();
    expect(expertResultUsageCopy({ expertMode: 'auto' })).toBeNull();
    expect(expertResultUsageCopy({})).toBeNull();
  });
});
