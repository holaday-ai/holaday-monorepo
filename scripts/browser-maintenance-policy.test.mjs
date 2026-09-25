import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateMaintenanceCutover, recoveryAction } from './browser-maintenance-policy.mjs';

const ready = {
  protocol: 1,
  mode: 'closed',
  idle: true,
  needsReconciliation: false,
  candidateMatches: true,
  workerStopped: true,
};
test('missing and legacy protocols cannot authorize stopping', () => {
  for (const value of [undefined, null, {}, { protocol: 0 }, { protocol: '1' }, { protocol: 2 }])
    assert.deepEqual(evaluateMaintenanceCutover(value), {
      allowed: false,
      code: 'LEGACY_DRAIN_UNSUPPORTED',
    });
});
test('every independent proof is mandatory, exact and not truthy', () => {
  assert.deepEqual(evaluateMaintenanceCutover(ready), { allowed: true, code: 'READY_TO_STOP' });
  for (const key of ['mode', 'idle', 'needsReconciliation', 'candidateMatches', 'workerStopped']) {
    const absent = { ...ready };
    delete absent[key];
    assert.equal(evaluateMaintenanceCutover(absent).allowed, false, key);
    for (const bad of [
      null,
      0,
      1,
      '',
      'true',
      'false',
      key === 'needsReconciliation' ? true : false,
    ])
      assert.equal(
        evaluateMaintenanceCutover({ ...ready, [key]: bad }).allowed,
        false,
        `${key}:${bad}`,
      );
  }
});
test('no irreversible or unknown phase requests automatic rollback', () => {
  assert.equal(recoveryAction('preflight'), 'abort_without_mutation');
  for (const phase of [
    'closed',
    'stopped',
    'migration_started',
    'candidate_started',
    'verified',
    'opened',
    '',
    undefined,
  ])
    assert.equal(recoveryAction(phase), 'hold_maintenance');
});
