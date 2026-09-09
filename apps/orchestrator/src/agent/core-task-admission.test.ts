import { describe, expect, it } from 'vitest';
import { assertPreparedCoreAdmission, prepareCoreAdmission } from './core-task-admission.js';

function input() {
  return {
    scope: { taskId: 'tsk_synthetic', userId: 7 },
    before: { status: 'awaiting_user', executionId: null, executionRevision: 0, recordVersion: 0 },
    requirements: {
      initialRequest: '整理合成资料',
      userTurns: ['补充条件'],
      phase: 'revise' as const,
      workflow: null,
      referencePlan: '合成方案',
      fileIds: ['file_synthetic'],
    },
  };
}

describe('core admission preparation', () => {
  it('freezes the bounded legacy snapshot and does not permit it on a new core round', () => {
    const legacySnapshot = { resultJson: '{"planText":"synthetic"}', roleId: null, origin: 'user' };
    const op = prepareCoreAdmission({ ...input(), legacySnapshot });
    legacySnapshot.resultJson = '{}';
    expect(op.legacySnapshot?.resultJson).toBe('{"planText":"synthetic"}');
    expect(Object.isFrozen(op.legacySnapshot)).toBe(true);
    expect(() =>
      prepareCoreAdmission({
        ...input(),
        legacySnapshot,
        before: {
          status: 'awaiting_user',
          executionId: 'core_existing',
          executionRevision: 1,
          recordVersion: 1,
        },
      }),
    ).toThrow('CORE_ADMISSION_INVALID');
  });
  it.each(['[]', 'null', 'invalid-json', JSON.stringify({ text: '长'.repeat(65536) })])(
    'rejects invalid legacy snapshot JSON',
    (resultJson) => {
      expect(() =>
        prepareCoreAdmission({
          ...input(),
          legacySnapshot: { resultJson, roleId: null, origin: 'user' },
        }),
      ).toThrow('CORE_ADMISSION_INVALID');
    },
  );
  it('allocates a distinct server execution and increments the observed database versions', () => {
    const first = prepareCoreAdmission(input());
    const second = prepareCoreAdmission(input());
    expect(first.executionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(second.executionId).not.toBe(first.executionId);
    expect(first.executionRevision).toBe(1);
    expect(first.recordVersion).toBe(1);
    const subsequent = prepareCoreAdmission({
      ...input(),
      before: {
        status: 'awaiting_user',
        executionId: first.executionId,
        executionRevision: 8,
        recordVersion: 17,
      },
    });
    expect(subsequent.executionRevision).toBe(9);
    expect(subsequent.recordVersion).toBe(18);
  });

  it('allows initial identity-less executing rows but not an already-admitted execution', () => {
    expect(
      prepareCoreAdmission({ ...input(), before: { ...input().before, status: 'executing' } })
        .executionRevision,
    ).toBe(1);
    expect(() =>
      prepareCoreAdmission({
        ...input(),
        before: {
          status: 'executing',
          executionId: 'old_exec',
          executionRevision: 1,
          recordVersion: 1,
        },
      }),
    ).toThrow('CORE_ADMISSION_INVALID');
  });

  it('snapshots caller-owned requirements and rejects copied operation capabilities', () => {
    const candidate = input();
    const op = prepareCoreAdmission(candidate);
    candidate.scope.userId = 42;
    candidate.before.status = 'cancelled';
    candidate.requirements.userTurns.push('后来才写的');
    candidate.requirements.fileIds.length = 0;
    expect(op.scope.userId).toBe(7);
    expect(op.before.status).toBe('awaiting_user');
    expect(op.requirements.userTurns).toEqual(['补充条件']);
    expect(op.requirements.fileIds).toEqual(['file_synthetic']);
    expect(Object.isFrozen(op.requirements.userTurns)).toBe(true);
    expect(Object.isFrozen(op.before)).toBe(true);
    expect(() => assertPreparedCoreAdmission(op)).not.toThrow();
    expect(() => assertPreparedCoreAdmission({ ...op })).toThrow('CORE_ADMISSION_INVALID');
    expect(() => assertPreparedCoreAdmission(null)).toThrow('CORE_ADMISSION_INVALID');
  });

  it.each(['completed', 'failed', 'cancelled', 'paused', 'planning', 'queued', 'pending'])(
    'refuses admission from %s',
    (status) => {
      expect(() =>
        prepareCoreAdmission({ ...input(), before: { ...input().before, status } }),
      ).toThrow('CORE_ADMISSION_INVALID');
    },
  );

  it.each([
    { executionId: null, executionRevision: 1 },
    { executionId: 'old_exec', executionRevision: 0 },
    { executionId: '', executionRevision: 1 },
    { executionRevision: -1 },
    { executionRevision: 1.5 },
    { executionRevision: Number.MAX_SAFE_INTEGER },
    { recordVersion: Number.MAX_SAFE_INTEGER },
    { recordVersion: -1 },
    { recordVersion: Number.NaN },
  ])('rejects incoherent or overflowing database versions: %j', (patch) => {
    expect(() =>
      prepareCoreAdmission({ ...input(), before: { ...input().before, ...patch } }),
    ).toThrow('CORE_ADMISSION_INVALID');
  });

  it.each([
    { scope: { taskId: '', userId: 7 } },
    { scope: { taskId: 'tsk_synthetic', userId: 0 } },
    { executionId: 'client_supplied' },
    { requirements: { ...input().requirements, fileIds: Array(6).fill('file_synthetic') } },
    { requirements: { ...input().requirements, fileIds: ['file_synthetic', 'file_synthetic'] } },
    { requirements: { ...input().requirements, fileIds: ['x'.repeat(33)] } },
    { requirements: { ...input().requirements, parsedBody: 'must not persist' } },
  ])('rejects invalid or over-broad inputs without reflecting their values: %j', (patch) => {
    expect(() => prepareCoreAdmission({ ...input(), ...patch })).toThrow('CORE_ADMISSION_INVALID');
  });

  it('refuses oversized accepted requirements without truncating their tail', () => {
    const requirements = { ...input().requirements, initialRequest: '合成'.repeat(12_000) };
    expect(() => prepareCoreAdmission({ ...input(), requirements })).toThrow(
      'VERIFICATION_INPUT_LIMIT',
    );
  });
});
