import { describe, expect, it } from 'vitest';
import { type CoreTaskHead, assertPreparedCoreAdmission } from './core-task-admission.js';
import { readCoreTaskRecord } from './core-task-record.js';

const legacy: CoreTaskHead = {
  status: 'awaiting_user',
  executionId: null,
  executionRevision: 0,
  recordVersion: 0,
};
const current: CoreTaskHead = {
  ...legacy,
  executionId: 'synthetic-execution',
  executionRevision: 2,
  recordVersion: 4,
};
function requirements() {
  return {
    initialRequest: '原始合成请求',
    userTurns: ['第一轮', '第二轮', '确认'],
    phase: 'revise',
    workflow: null,
    referencePlan: '参考方案',
    fileIds: ['file_synthetic'],
  };
}
const invalid = { kind: 'invalid', code: 'CORE_RECORD_INVALID' };

describe('core record decoding', () => {
  it.each([null, [], 'historical', {}, { planMode: 'awaiting_approval' }])(
    'leaves identity-less historical results to the legacy reader',
    (result) => {
      expect(readCoreTaskRecord({ head: legacy, result })).toEqual({ kind: 'legacy' });
    },
  );

  it.each(['executing', 'awaiting_user', 'completed', 'partial_success', 'failed', 'cancelled'])(
    'reads requirements from %s without granting permission to resume',
    (status) => {
      const result = readCoreTaskRecord({
        head: { ...current, status },
        result: {
          coreRequirements: requirements(),
          summary: 'DO_NOT_PROJECT',
          planMode: 'wrong-legacy-hint',
        },
      });
      expect(result).toMatchObject({
        kind: 'core',
        head: { executionRevision: 2, recordVersion: 4 },
        requirements: { userTurns: ['第一轮', '第二轮', '确认'], workflow: null, phase: 'revise' },
      });
      expect(JSON.stringify(result)).not.toContain('DO_NOT_PROJECT');
      expect(() => assertPreparedCoreAdmission(result)).toThrow('CORE_ADMISSION_INVALID');
    },
  );

  it.each([
    null,
    [],
    'text',
    {},
    { planMode: 'awaiting_approval' },
    { coreRequirements: null },
    { coreRequirements: [] },
    { coreRequirements: { ...requirements(), initialRequest: '字'.repeat(22_000) } },
    { coreRequirements: { ...requirements(), unexpected: 'SYNTHETIC_PRIVATE' } },
  ])('never treats missing or corrupt new requirements as legacy', (result) => {
    expect(readCoreTaskRecord({ head: current, result })).toEqual(invalid);
  });

  it.each([
    { ...legacy, recordVersion: 1 },
    { ...current, recordVersion: 0 },
    { ...current, executionId: null },
    { ...current, executionRevision: 0 },
    { ...current, executionRevision: -1 },
    { ...current, recordVersion: Number.NaN },
  ])('refuses inconsistent head identity instead of guessing a format', (head) => {
    expect(readCoreTaskRecord({ head, result: { coreRequirements: requirements() } })).toEqual(
      invalid,
    );
  });

  it('refuses any explicit core marker without its transactional identity', () => {
    expect(
      readCoreTaskRecord({ head: legacy, result: { coreRequirements: requirements() } }),
    ).toEqual(invalid);
    expect(readCoreTaskRecord({ head: legacy, result: { coreRequirements: undefined } })).toEqual(
      invalid,
    );
  });

  it('does not accept an inherited marker as a persisted own property', () => {
    expect(
      readCoreTaskRecord({
        head: current,
        result: Object.create({ coreRequirements: requirements() }),
      }),
    ).toEqual(invalid);
  });

  it('returns an immutable copy of both head and original ordered requirements', () => {
    const head = { ...current };
    const source = requirements();
    const read = readCoreTaskRecord({ head, result: { coreRequirements: source } });
    head.executionRevision = 100;
    source.userTurns.push('late');
    expect(read).toMatchObject({
      kind: 'core',
      head: { executionRevision: 2 },
      requirements: { userTurns: ['第一轮', '第二轮', '确认'] },
    });
    expect(Object.isFrozen(read)).toBe(true);
  });
});
