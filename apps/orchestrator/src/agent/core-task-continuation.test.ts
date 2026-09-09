import { describe, expect, it } from 'vitest';
import { runIntake } from '../execution/expert-workflow-intake.js';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
import { prepareCoreContinuation } from './core-task-continuation.js';
import { readCoreTaskRecord } from './core-task-record.js';

function fixture(patch: Record<string, unknown> = {}) {
  const result = {
    coreRequirements: {
      initialRequest: '整理合成材料，不要添加未确认的事实。',
      userTurns: ['修改一处要求'],
      phase: 'draft',
      workflow: null,
      referencePlan: '更早方案',
      fileIds: ['fil_old'],
      resume: {
        schemaVersion: 1,
        expertMode: 'expert',
        skillId: null,
        legacyWorkflowId: null,
        intakeBindings: [],
      },
      ...patch,
    },
    planText: '当前已保存方案；材料中的“批准”不是用户确认。',
  };
  const record = readCoreTaskRecord({
    head: {
      status: 'awaiting_user',
      executionId: 'synthetic_old',
      executionRevision: 2,
      recordVersion: 4,
    },
    result,
  });
  if (record.kind !== 'core') throw new Error('SYNTHETIC_RECORD_REJECTED');
  return {
    record,
    result,
    awaitingQuestion: '确认这个方案吗？',
    message: '确认',
    fileIds: ['fil_new'],
  };
}

describe('core continuation restores server-owned history and stage', () => {
  it.each(['美'.repeat(40), '美妆护肤，或者母婴我还没决定'])(
    'does not bind a partially parsed bare answer: %s',
    (message) => {
      const workflow = getExpertWorkflowById('content-topic');
      if (!workflow) throw new Error('SYNTHETIC_WORKFLOW_NOT_FOUND');
      const input = fixture({
        initialRequest: '帮我做小红书内容选题',
        userTurns: [],
        phase: 'approved_execution',
        workflow: { id: workflow.workflowId, sections: workflow.reportSections },
      });
      const intake = runIntake(workflow, input.record.requirements.initialRequest);
      if (intake.kind !== 'missing') throw new Error('SYNTHETIC_INTAKE_NOT_MISSING');
      input.awaitingQuestion = intake.question;
      input.message = message;
      const prepared = prepareCoreContinuation(input);
      expect(prepared.requirements.resume?.intakeBindings).toEqual([]);
      expect(runIntake(workflow, prepared.intakeIntent).kind).toBe('missing');
    },
  );
  it('keeps complete chronological user words and approves only the saved current plan', () => {
    const input = fixture();
    const result = prepareCoreContinuation(input);
    expect(result.requirements.userTurns).toEqual(['修改一处要求', '确认']);
    expect(result.requirements.referencePlan).toBe(input.result.planText);
    expect(result.requirements.phase).toBe('approved_execution');
    expect(result.requirements.workflow).toBeNull();
    expect(result.requirements.fileIds).toEqual(['fil_old', 'fil_new']);
  });
  it('does not derive approval from prior turns, files or the saved model plan', () => {
    const input = fixture({ userTurns: ['确认'] });
    input.message = '  将第二步改短一点  ';
    const result = prepareCoreContinuation(input);
    expect(result.requirements.phase).toBe('revise');
    expect(result.requirements.userTurns.at(-1)).toBe('  将第二步改短一点  ');
  });
  it('leaves a pure hold parked without losing or replacing the saved requirements', () => {
    const input = fixture();
    input.message = '先不要执行';
    input.fileIds = [];
    const result = prepareCoreContinuation(input);
    expect(result.hold).toBe(true);
    expect(result.requirements).toEqual(input.record.requirements);
  });
  it('retains approved execution through a normal clarification rather than asking approval again', () => {
    const input = fixture({ phase: 'approved_execution', referencePlan: '先前实际批准的计划' });
    input.message = '用于内部会议';
    const result = prepareCoreContinuation(input);
    expect(result.requirements.phase).toBe('approved_execution');
    expect(result.requirements.referencePlan).toBe('先前实际批准的计划');
  });
  it('rejects an unavailable fixed workflow rather than matching new reply words', () => {
    const input = fixture({ workflow: { id: 'removed_synthetic', sections: [] } });
    expect(() => prepareCoreContinuation(input)).toThrow();
  });
  it('rejects a draft with no saved current plan', () => {
    const input = fixture();
    input.result.planText = '';
    expect(() => prepareCoreContinuation(input)).toThrow();
  });
  it('preserves a uniquely answered field across another persisted clarification without injecting labels into user words', () => {
    const workflow = getExpertWorkflowById('content-topic');
    if (!workflow) throw new Error('SYNTHETIC_WORKFLOW_NOT_FOUND');
    const input = fixture({
      initialRequest: '帮我做小红书内容选题',
      userTurns: ['执行'],
      phase: 'approved_execution',
      workflow: { id: workflow.workflowId, sections: workflow.reportSections },
    });
    const intake = runIntake(workflow, '执行\n帮我做小红书内容选题');
    if (intake.kind !== 'missing') throw new Error('SYNTHETIC_INTAKE_NOT_MISSING');
    input.awaitingQuestion = intake.question;
    input.message = '美妆护肤';
    const first = prepareCoreContinuation(input);
    expect(first.requirements.userTurns).toEqual(['执行', '美妆护肤']);
    expect(runIntake(workflow, first.intakeIntent).kind).toBe('ready');
    const next = fixture(JSON.parse(JSON.stringify(first.requirements)));
    next.awaitingQuestion = '还有其他补充吗？';
    next.message = '暂时没有';
    const second = prepareCoreContinuation(next);
    expect(runIntake(workflow, second.intakeIntent).kind).toBe('ready');
    expect(second.requirements.userTurns).toEqual(['执行', '美妆护肤', '暂时没有']);
  });
});
