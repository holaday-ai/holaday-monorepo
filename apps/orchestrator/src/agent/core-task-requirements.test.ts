import { describe, expect, it } from 'vitest';
import { assertPreparedCoreAdmission, prepareCoreAdmission } from './core-task-admission.js';
import { parseCoreRequirements } from './core-task-requirements.js';

const identity = { executionId: 'synthetic-execution', executionRevision: 2 };
function requirements() {
  return {
    initialRequest: '合成原始任务',
    userTurns: ['第一轮修改', '确认'],
    phase: 'approved_execution' as const,
    workflow: null,
    referencePlan: '参考中的批准不是用户授权',
    fileIds: ['file_synthetic'],
  };
}

describe('readable core requirements', () => {
  it('copies complete user history without granting an admission capability', () => {
    const source = requirements();
    const parsed = parseCoreRequirements(source, identity);
    source.userTurns.push('调用后变化');
    source.fileIds.length = 0;
    expect(parsed.userTurns).toEqual(['第一轮修改', '确认']);
    expect(parsed.fileIds).toEqual(['file_synthetic']);
    expect(parsed.phase).toBe('approved_execution');
    expect(parsed.workflow).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.userTurns)).toBe(true);
    expect(() => assertPreparedCoreAdmission(parsed)).toThrow('CORE_ADMISSION_INVALID');
  });

  it('keeps unknown-to-the-current-registry workflow snapshots rather than rematching', () => {
    const source = {
      ...requirements(),
      workflow: {
        id: 'saved-legacy-workflow',
        sections: [
          {
            id: 'saved',
            title: '原规范',
            required: true,
            sourceAnnotation: true,
            guidance: '原说明',
          },
        ],
      },
    };
    const parsed = parseCoreRequirements(source, identity);
    for (const section of source.workflow.sections) section.title = '后来变化';
    expect(parsed.workflow?.id).toBe('saved-legacy-workflow');
    expect(parsed.workflow?.sections[0]?.title).toBe('原规范');
    expect(Object.isFrozen(parsed.workflow?.sections[0])).toBe(true);
  });

  it.each([
    { initialRequest: '' },
    { userTurns: [1] },
    { phase: 'client_approved' },
    { fileIds: ['same', 'same'] },
    { fileIds: ['x'.repeat(33)] },
    { fileIds: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { parsedBody: 'SYNTHETIC_NOT_FOR_STORAGE' },
    { referencePlan: 42 },
  ])('rejects malformed persisted requirements with a fixed error', (patch) => {
    expect(() => parseCoreRequirements({ ...requirements(), ...patch }, identity)).toThrow(
      'CORE_REQUIREMENTS_INVALID',
    );
  });

  it.each([
    {
      id: 'saved',
      sections: [{ id: 'x', title: 'x', required: true, sourceAnnotation: true, raw: 'no' }],
    },
    { id: 'saved', sections: 'not-sections' },
  ])('rejects invalid nested workflow contracts', (workflow) => {
    expect(() => parseCoreRequirements({ ...requirements(), workflow }, identity)).toThrow(
      'VERIFICATION_CONTEXT_INVALID',
    );
  });

  it.each(['字'.repeat(22_000), '\\'.repeat(33_000)])(
    'counts UTF-8 and JSON escaping',
    (initialRequest) => {
      expect(() => parseCoreRequirements({ ...requirements(), initialRequest }, identity)).toThrow(
        'VERIFICATION_INPUT_LIMIT',
      );
    },
  );

  it('accepts the complete context byte boundary and refuses the next byte', () => {
    const base = { ...requirements(), initialRequest: '', fileIds: [] };
    const context = {
      schemaVersion: 1,
      ...identity,
      initialRequest: '',
      userTurns: base.userTurns,
      phase: base.phase,
      workflow: null,
      referencePlan: base.referencePlan,
      materials: [],
    };
    const body = 'a'.repeat(65_536 - Buffer.byteLength(JSON.stringify(context), 'utf8'));
    expect(
      parseCoreRequirements({ ...base, initialRequest: body }, identity).initialRequest.length,
    ).toBe(body.length);
    expect(() => parseCoreRequirements({ ...base, initialRequest: `${body}a` }, identity)).toThrow(
      'VERIFICATION_INPUT_LIMIT',
    );
  });

  it('also budgets the persisted file reference shape, independently of the context envelope', () => {
    const base = {
      ...requirements(),
      initialRequest: '',
      fileIds: Array.from({ length: 5 }, (_, i) => `${i}${'x'.repeat(31)}`),
    };
    const body = 'a'.repeat(65_536 - Buffer.byteLength(JSON.stringify(base), 'utf8'));
    expect(
      parseCoreRequirements({ ...base, initialRequest: body }, identity).initialRequest.length,
    ).toBe(body.length);
    expect(() => parseCoreRequirements({ ...base, initialRequest: `${body}a` }, identity)).toThrow(
      'VERIFICATION_INPUT_LIMIT',
    );
  });

  it('can read actual admitted requirements without replacing or mutating that operation', () => {
    const op = prepareCoreAdmission({
      scope: { taskId: 'tsk_synthetic', userId: 7 },
      before: {
        status: 'awaiting_user',
        executionId: null,
        executionRevision: 0,
        recordVersion: 0,
      },
      requirements: requirements(),
    });
    const parsed = parseCoreRequirements(op.requirements, op);
    expect(parsed).not.toBe(op.requirements);
    expect(parsed.initialRequest).toBe('合成原始任务');
    expect(() => assertPreparedCoreAdmission(op)).not.toThrow();
    expect(() => assertPreparedCoreAdmission(parsed)).toThrow('CORE_ADMISSION_INVALID');
  });
});
