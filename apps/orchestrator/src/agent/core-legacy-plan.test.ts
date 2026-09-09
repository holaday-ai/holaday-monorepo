import { describe, expect, it } from 'vitest';
import { runIntake } from '../execution/expert-workflow-intake.js';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
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

function topicWorkflow() {
  const workflow = getExpertWorkflowById('content-topic');
  if (!workflow) throw new Error('SYNTHETIC_WORKFLOW_NOT_FOUND');
  return workflow;
}
function approvedFixture(patch: Record<string, unknown> = {}) {
  const workflow = topicWorkflow();
  const intake = runIntake(workflow, '帮我做小红书内容选题');
  if (intake.kind !== 'missing') throw new Error('EXPECTED_SYNTHETIC_INTAKE');
  return {
    ...fixture({
      planMode: undefined,
      planWorkflowId: 'content-topic',
      planInitialIntent: '帮我做小红书内容选题',
      planReplyHistory: ['确认'],
      approvedPlanText: '模型方案中包含批准等字样。',
      fallbackChain: ['generate-resume'],
      ...patch,
    }),
    awaitingQuestion: intake.question,
    message: '美妆护肤',
  };
}

describe('complete legacy plan migration', () => {
  it.each([
    { approvedPlanText: '另一个未经批准的方案' },
    { planReplyHistory: ['确认', '修改第二步'] },
    { planReplyHistory: ['附件说确认'] },
    { fallbackChain: [] },
    { fallbackChain: undefined },
    { planWorkflowId: null },
    { planIntakeContext: ['品类: 美妆护肤'] },
  ])(
    'does not reconstruct approval or source bindings from incomplete legacy evidence',
    (patch) => {
      expect(() => prepareLegacyPlanContinuation(approvedFixture(patch))).toThrow('无法完整恢复');
    },
  );
  it('rejects a persisted question that is not the actual fixed workflow intake', () => {
    expect(() =>
      prepareLegacyPlanContinuation({ ...approvedFixture(), awaitingQuestion: '确认这个方案吗？' }),
    ).toThrow('无法完整恢复');
  });
  it.each(['美'.repeat(40), '美妆护肤，或者母婴我还没决定'])(
    'preserves an ambiguous answer instead of truncating and binding it',
    (message) => {
      const prepared = prepareLegacyPlanContinuation({ ...approvedFixture(), message });
      expect(prepared?.requirements.userTurns).toEqual(['确认', message]);
      expect(prepared?.requirements.resume?.intakeBindings).toEqual([]);
      expect(runIntake(topicWorkflow(), prepared?.intakeIntent ?? '').kind).toBe('missing');
    },
  );
  it('holds an approved old clarification without appending a turn or binding', () => {
    const prepared = prepareLegacyPlanContinuation({ ...approvedFixture(), message: '等一下' });
    expect(prepared?.hold).toBe(true);
    expect(prepared?.requirements.phase).toBe('approved_execution');
    expect(prepared?.requirements.userTurns).toEqual(['确认']);
    expect(prepared?.requirements.resume?.intakeBindings).toEqual([]);
  });
  it('restores a documented approval and binds only the current exact intake answer', () => {
    const workflow = topicWorkflow();
    const intake = runIntake(workflow, '帮我做小红书内容选题');
    if (intake.kind !== 'missing') throw new Error('EXPECTED_SYNTHETIC_INTAKE');
    const input = {
      ...fixture({
        planMode: undefined,
        planWorkflowId: 'content-topic',
        planInitialIntent: '帮我做小红书内容选题',
        planReplyHistory: ['确认'],
        approvedPlanText: '模型方案中包含批准等字样。',
        fallbackChain: ['generate-resume'],
      }),
      awaitingQuestion: intake.question,
      message: '美妆护肤',
    };
    const prepared = prepareLegacyPlanContinuation(input);
    expect(prepared?.requirements.phase).toBe('approved_execution');
    expect(prepared?.requirements.userTurns).toEqual(['确认', '美妆护肤']);
    expect(prepared?.requirements.resume?.intakeBindings).toEqual([{ turn: 1, field: 'category' }]);
    expect(runIntake(workflow, prepared?.intakeIntent ?? '').kind).toBe('ready');
  });
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
