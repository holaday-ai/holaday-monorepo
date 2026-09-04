import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateQwenInitialCutover } from './qwen-initial-cutover-policy.mjs';

describe('Qwen initial cutover policy', () => {
  it('uses the normal path when the rollback revision is already Qwen-only', () => {
    assert.deepEqual(
      evaluateQwenInitialCutover({
        allowInitialCutover: false,
        rollbackQwenOnly: true,
        candidateQwenOnly: true,
        rolloutMode: 'synthetic',
      }),
      {
        status: 'pass',
        mode: 'normal',
        allowLegacyEmergencyRollback: false,
        failures: [],
      },
    );
  });

  it('fails closed when the first cutover was not explicitly authorized', () => {
    const result = evaluateQwenInitialCutover({
      allowInitialCutover: false,
      rollbackQwenOnly: false,
      candidateQwenOnly: true,
      rolloutMode: 'off',
    });

    assert.equal(result.status, 'fail');
    assert.deepEqual(result.failures, ['qwen_only_rollback_missing']);
  });

  it('permits one initial cutover only with a Qwen-only candidate and rollout off', () => {
    assert.deepEqual(
      evaluateQwenInitialCutover({
        allowInitialCutover: true,
        rollbackQwenOnly: false,
        candidateQwenOnly: true,
        rolloutMode: 'off',
      }),
      {
        status: 'pass',
        mode: 'initial',
        allowLegacyEmergencyRollback: true,
        failures: [],
      },
    );
  });

  it('rejects an initial cutover that would expose traffic or a legacy candidate', () => {
    const result = evaluateQwenInitialCutover({
      allowInitialCutover: true,
      rollbackQwenOnly: false,
      candidateQwenOnly: false,
      rolloutMode: 'synthetic',
    });

    assert.equal(result.status, 'fail');
    assert.deepEqual(result.failures, [
      'candidate_not_qwen_only',
      'initial_cutover_requires_rollout_off',
    ]);
  });
});
