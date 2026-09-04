import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateQwenCorePreflight } from './qwen-core-production-preflight.mjs';

const PASSING = {
  runtimePolicy: 'qwen_only',
  healthChecks: [
    { target: 'public', httpStatus: 200, status: 'ok' },
    { target: 'origin', httpStatus: 200, status: 'ok' },
  ],
  legacyProviderRequests: 0,
  crossRegionRequests: 0,
  coreProbeFailures: 0,
  stuckTasks: 0,
  p95ShortCallLatencyMs: 4_900,
  verifierMetrics: {
    severeIssueRecall: 0.96,
    correctAnswerFalseRejectionRate: 0.01,
    deterministicFailToPass: 0,
    structuredOutputValidity: 0.995,
  },
};

describe('Qwen core production preflight', () => {
  it('passes only when every rollout gate is green', () => {
    assert.deepEqual(evaluateQwenCorePreflight(PASSING), {
      status: 'pass',
      failures: [],
    });
  });

  it('fails production preflight when any observed legacy request exists', () => {
    assert.equal(
      evaluateQwenCorePreflight({ ...PASSING, legacyProviderRequests: 1 }).status,
      'fail',
    );
  });

  it('fails closed on cross-region traffic, stuck tasks, probe errors or slow p95', () => {
    const result = evaluateQwenCorePreflight({
      ...PASSING,
      crossRegionRequests: 1,
      stuckTasks: 1,
      coreProbeFailures: 1,
      p95ShortCallLatencyMs: 5_001,
    });
    assert.equal(result.status, 'fail');
    assert.deepEqual(result.failures, [
      'cross_region_requests',
      'core_probe_failures',
      'stuck_tasks',
      'short_call_p95_latency',
    ]);
  });
});
