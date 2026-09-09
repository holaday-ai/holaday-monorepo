import { describe, expect, it } from 'vitest';
import { runIntake } from '../execution/expert-workflow-intake.js';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
import { prepareCoreContinuation } from './core-task-continuation.js';
import { readCoreTaskRecord } from './core-task-record.js';
import { resolveFixedExpertWorkflow } from './supercar/expert-workflows.js';

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
  function legacyInput() {
    const initialRequest = '帮我复盘抖音直播';
    const match = resolveFixedExpertWorkflow('douyin-livestream-review', initialRequest);
    if (!match || match.routeOverride !== 'generate') throw new Error('SYNTHETIC_MATCH_MISSING');
    const input = fixture({
      initialRequest,
      userTurns: [],
      phase: 'direct',
      fileIds: [],
      legacyWorkflow: {
        id: match.id,
        promptPreamble: match.promptPreamble,
        missingInputs: match.missingInputs,
        routeOverride: match.routeOverride,
      },
      resume: {
        schemaVersion: 1,
        expertMode: 'auto',
        skillId: null,
        legacyWorkflowId: match.id,
        intakeBindings: [],
      },
    });
    input.fileIds = [];
    return input;
  }
  it('refreshes fixed legacy intake from complete raw history without replacing lineage', () => {
    const input = legacyInput();
    input.message = '  昨天，数据在电商罗盘后台；也参考小红书观点。  ';
    const prepared = prepareCoreContinuation(input);
    expect(prepared.requirements.userTurns).toEqual([input.message]);
    expect(prepared.requirements.legacyWorkflow).toMatchObject({
      id: 'douyin-livestream-review',
      missingInputs: [],
      routeOverride: 'browser',
    });
    expect(prepared.requirements.workflow).toBeNull();
    expect(prepared.requirements.phase).toBe('direct');
  });
  it('combines distinct actual metrics supplied across separate raw replies', () => {
    const input = legacyInput();
    input.message = '昨天\nGMV: 100';
    const first = prepareCoreContinuation(input);
    const result = { coreRequirements: first.requirements };
    const record = readCoreTaskRecord({ head: input.record.head, result });
    if (record.kind !== 'core') throw new Error('SYNTHETIC_RECORD_REJECTED');
    const prepared = prepareCoreContinuation({
      record,
      result,
      awaitingQuestion: null,
      message: 'UV: 200\n来源：电商罗盘导出',
    });
    expect(prepared.requirements.legacyWorkflow).toMatchObject({
      missingInputs: [],
      routeOverride: 'generate',
    });
    expect(prepared.requirements.userTurns).toEqual([input.message, 'UV: 200\n来源：电商罗盘导出']);
  });
  it.each(['promptPreamble', 'routeOverride', 'missingInputs'] as const)(
    'refuses a changed saved legacy policy field: %s',
    (field) => {
      const input = legacyInput();
      const result = {
        coreRequirements: {
          ...input.record.requirements,
          legacyWorkflow: {
            ...input.record.requirements.legacyWorkflow,
            ...(field === 'routeOverride' ? { missingInputs: [] } : {}),
            [field]:
              field === 'promptPreamble'
                ? 'changed policy'
                : field === 'routeOverride'
                  ? 'browser'
                  : [],
          },
        },
      };
      const record = readCoreTaskRecord({ head: input.record.head, result });
      if (record.kind !== 'core') throw new Error('SYNTHETIC_RECORD_REJECTED');
      expect(() => prepareCoreContinuation({ ...input, record, result })).toThrow('无法完整恢复');
    },
  );
  it('uses newly attached data while an intent to upload stays missing', () => {
    const input = legacyInput();
    input.message = '昨天，我稍后上传数据';
    expect(prepareCoreContinuation(input).requirements.legacyWorkflow?.missingInputs).toEqual([
      'dataSource',
    ]);
    input.fileIds = ['fil_new'];
    expect(prepareCoreContinuation(input).requirements.legacyWorkflow).toMatchObject({
      missingInputs: [],
      routeOverride: 'generate',
    });
  });
  it('keeps a bare session answer across a second real saved continuation', () => {
    const input = legacyInput();
    input.message = '昨天';
    const first = prepareCoreContinuation(input);
    const next = fixture(JSON.parse(JSON.stringify(first.requirements)));
    next.message = '数据在罗盘';
    next.fileIds = [];
    const second = prepareCoreContinuation(next);
    expect(second.requirements.userTurns).toEqual(['昨天', '数据在罗盘']);
    expect(second.requirements.legacyWorkflow).toMatchObject({
      missingInputs: [],
      routeOverride: 'browser',
    });
  });
  it('uses explicit pasted metrics as data, not as a request to open the named platform', () => {
    const input = legacyInput();
    input.message = '昨天\nGMV: 100\nUV: 200\n订单: 10\n来源：罗盘导出';
    expect(prepareCoreContinuation(input).requirements.legacyWorkflow).toMatchObject({
      missingInputs: [],
      routeOverride: 'generate',
    });
  });
  it('does not treat a future upload or repeated single metric as complete pasted data', () => {
    const input = legacyInput();
    input.message = '昨天，我稍后上传数据如下\nGMV: 100\nGMV: 200';
    expect(prepareCoreContinuation(input).requirements.legacyWorkflow?.missingInputs).toEqual([
      'dataSource',
    ]);
  });
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
