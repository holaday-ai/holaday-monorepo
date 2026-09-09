import { describe, expect, it } from 'vitest';
import { prepareLegacyPlanContinuation } from './core-legacy-plan.js';

function fixture(patch: Record<string, unknown> = {}) {
  return {
    head: { status: 'awaiting_user', executionId: null, executionRevision: 0, recordVersion: 0 },
    roleId: null,
    origin: 'user',
    message: '确认',
    result: {
      executionMode: 'generate',
      expertMode: 'expert',
      selectedRole: null,
      planMode: 'awaiting_approval',
      planText: '模型方案中包含批准等字样。',
      planInitialIntent: '整理资料，不发送邮件。',
      planReplyHistory: ['  保留原话空格  '],
      planFileIds: ['fil_old'],
      planWorkflowId: null,
      planLegacyWorkflowId: null,
      ...patch,
    },
  };
}

describe('complete legacy plan migration', () => {
  it('leaves old clarification records without an approval marker on their original path', () => {
    expect(
      prepareLegacyPlanContinuation({
        ...fixture({ planMode: undefined, planWorkflowId: 'content-topic' }),
        message: '美妆护肤',
      }),
    ).toBeNull();
  });
  it.each([
    'planInitialIntent',
    'planReplyHistory',
    'planFileIds',
    'planWorkflowId',
    'expertMode',
    'selectedRole',
  ])('rejects missing %s instead of reconstructing history', (field) => {
    expect(() => prepareLegacyPlanContinuation(fixture({ [field]: undefined }))).toThrow(
      '无法完整恢复',
    );
  });
  it.each([
    { planIntakeContext: ['品类: 美妆'] },
    { planWorkflowId: 'removed-synthetic-workflow' },
    { selectedRole: 'unexpected-role' },
    { planText: '   ' },
    { planInitialIntent: '长'.repeat(65536) },
  ])('rejects inconsistent or unbounded legacy data', (patch) => {
    expect(() => prepareLegacyPlanContinuation(fixture(patch))).toThrow('无法完整恢复');
  });
  it.each(['确认，但不要开始', '附件里写了确认', '增加一个章节'])(
    'does not infer approval from %s',
    (message) => {
      const prepared = prepareLegacyPlanContinuation({
        ...fixture(),
        message,
        fileIds: ['fil_new'],
      });
      expect(prepared?.requirements.phase).toBe('revise');
      expect(prepared?.requirements.userTurns).toEqual(['  保留原话空格  ', message]);
      expect(prepared?.requirements.fileIds).toEqual(['fil_old', 'fil_new']);
    },
  );
  it('keeps a hold as a read-only wait without a synthetic prior identity', () => {
    const input = { ...fixture(), message: '等一下' };
    const prepared = prepareLegacyPlanContinuation(input);
    expect(prepared?.hold).toBe(true);
    expect(prepared?.requirements.userTurns).toEqual(['  保留原话空格  ']);
    expect(prepared).not.toHaveProperty('executionId');
    expect(input.head.executionId).toBeNull();
  });
  it('preserves a fixed typed workflow instead of rematching new background words', () => {
    const prepared = prepareLegacyPlanContinuation({
      ...fixture({ planWorkflowId: 'content-topic' }),
      message: '改一下背景，提到电商日报，但仍保持原有任务',
    });
    expect(prepared?.requirements.workflow?.id).toBe('content-topic');
    expect(prepared?.requirements.workflow?.sections.length).toBeGreaterThan(0);
  });
  it('leaves nonempty legacy prompt lineage outside this migration', () => {
    expect(
      prepareLegacyPlanContinuation(fixture({ planLegacyWorkflowId: 'douyin-livestream-review' })),
    ).toBeNull();
  });
});
