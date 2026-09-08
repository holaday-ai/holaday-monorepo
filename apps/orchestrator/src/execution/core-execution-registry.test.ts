import { describe, expect, it } from 'vitest';
import { CoreExecutionRegistry } from './core-execution-registry.js';
import { getLedger } from './evidence-ledger.js';
import { getContract } from './execution-pipeline.js';
import { createTaskVerificationContext } from './task-verification-context.js';

function input(revision = 1, taskId = 'synthetic_task') {
  return {
    taskId,
    verificationContext: createTaskVerificationContext({
      schemaVersion: 1,
      executionId: `exec_${taskId}_${revision}`,
      executionRevision: revision,
      initialRequest: `合成要求第${revision}轮`,
      userTurns: [],
      phase: 'direct',
      workflow: null,
      referencePlan: null,
      materials: [],
    }),
  };
}

const fact = (text: string) => ({
  fact: text,
  sourceType: 'tool_result' as const,
  sourceDetail: 'synthetic',
  confidence: 'observed' as const,
});

describe('core execution ownership', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid capacity %s instead of disabling its memory bound',
    (capacity) => {
      expect(() => new CoreExecutionRegistry(capacity)).toThrow('CORE_EXECUTION_CAPACITY');
    },
  );

  it('treats a missing handle as unavailable rather than a successful lookup', () => {
    const registry = new CoreExecutionRegistry();
    expect(
      registry.read(undefined as unknown as Parameters<CoreExecutionRegistry['read']>[0]),
    ).toBeNull();
  });
  it('keeps the new context after an old finally releases the same task', () => {
    const registry = new CoreExecutionRegistry();
    const old = registry.begin(input(1));
    const next = registry.begin(input(2));
    registry.release(old);
    expect(registry.read(next)?.context.initialRequest).toBe('合成要求第2轮');
    expect(registry.read(next)?.contract.goal).toBe('合成要求第2轮');
    expect(registry.read(old)).toBeNull();
  });

  it('does not let old evidence enter the new ledger or any legacy registry', () => {
    const registry = new CoreExecutionRegistry();
    const old = registry.begin(input(1));
    registry.record(old, fact('旧轮证据'));
    const next = registry.begin(input(2));
    expect(registry.record(old, fact('迟到证据'))).toBe(false);
    expect(registry.record(next, fact('新轮证据'))).toBe(true);
    expect(registry.read(next)?.ledger.entries.map((entry) => entry.fact)).toEqual([
      '合成要求第2轮',
      '新轮证据',
    ]);
    expect(getLedger('synthetic_task')).toBeUndefined();
    expect(getContract('synthetic_task')).toBeUndefined();
  });

  it('rejects copied and foreign handles without releasing the original', () => {
    const registry = new CoreExecutionRegistry();
    const other = new CoreExecutionRegistry();
    const handle = registry.begin(input());
    const copy = { ...handle };
    expect(registry.read(copy)).toBeNull();
    expect(registry.record(copy, fact('伪造句柄'))).toBe(false);
    expect(registry.release(copy)).toBe(false);
    expect(other.read(handle)).toBeNull();
    expect(other.release(handle)).toBe(false);
    expect(registry.read(handle)?.context.initialRequest).toBe('合成要求第1轮');
  });

  it.each([1, 2])('rejects non-increasing revision %i while the next run is active', (revision) => {
    const registry = new CoreExecutionRegistry();
    const next = registry.begin(input(2));
    const candidate = input(revision);
    candidate.verificationContext = createTaskVerificationContext({
      ...candidate.verificationContext,
      executionId: 'conflicting_id',
    });
    expect(() => registry.begin(candidate)).toThrow('VERIFICATION_CONTEXT_INVALID');
    expect(registry.read(next)?.context.executionId).toBe('exec_synthetic_task_2');
  });

  it('rejects a reused execution id even with a higher revision', () => {
    const registry = new CoreExecutionRegistry();
    const old = registry.begin(input(1));
    const next = input(2);
    next.verificationContext = createTaskVerificationContext({
      ...next.verificationContext,
      executionId: old.executionId,
    });
    expect(() => registry.begin(next)).toThrow('VERIFICATION_CONTEXT_INVALID');
    expect(registry.read(old)?.context.executionRevision).toBe(1);
  });

  it('rejects malformed input without replacing a valid active run', () => {
    const registry = new CoreExecutionRegistry();
    const next = registry.begin(input(2));
    expect(() =>
      registry.begin({
        ...input(3),
        verificationContext: null as unknown as ReturnType<typeof input>['verificationContext'],
      }),
    ).toThrow('VERIFICATION_CONTEXT_INVALID');
    expect(() => registry.begin(input(3, ''))).toThrow('VERIFICATION_CONTEXT_INVALID');
    expect(registry.read(next)?.context.executionRevision).toBe(2);
  });

  it('copies caller constraints and freezes the authority handle', () => {
    const registry = new CoreExecutionRegistry();
    const constraints = ['no_form_submit'];
    const handle = registry.begin({ ...input(), constraints });
    constraints.length = 0;
    expect(registry.read(handle)?.contract.constraints).toContain('no_form_submit');
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(registry.read(handle)?.contract.constraints)).toBe(true);
  });

  it('refuses capacity overflow without evicting active tasks and frees a released slot', () => {
    const registry = new CoreExecutionRegistry(2);
    const old = registry.begin(input(1, 'a'));
    const b = registry.begin(input(1, 'b'));
    const next = registry.begin(input(2, 'a'));
    registry.release(old);
    expect(() => registry.begin(input(1, 'c'))).toThrow('CORE_EXECUTION_CAPACITY');
    expect(registry.read(b)?.context.initialRequest).toBe('合成要求第1轮');
    expect(registry.release(next)).toBe(true);
    expect(registry.release(next)).toBe(false);
    const c = registry.begin(input(1, 'c'));
    expect(registry.read(c)?.context.initialRequest).toBe('合成要求第1轮');
  });
});
