import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingressDiagnosticError,
  ingressDiagnosticStage,
} from './browser-first-cutover-ingress-diagnostics.mjs';
test('ingress refusal carries fixed stage only and preserves its public code', () => {
  const original = new Error('private payload');
  const refusal = ingressDiagnosticError('CUTOVER_INGRESS_PAIR_UNPROVEN', 'PAIR_SCOPE', original);
  assert.equal(refusal.message, 'CUTOVER_INGRESS_PAIR_UNPROVEN');
  assert.deepEqual(refusal.cause, { ingressStage: 'PAIR_SCOPE' });
  assert(Object.isFrozen(refusal.cause));
  assert.equal(
    ingressDiagnosticStage(
      ingressDiagnosticError('CUTOVER_INGRESS_PAIR_UNPROVEN', 'PAIR_ENTRY', refusal),
    ),
    'PAIR_SCOPE',
  );
  assert.equal(
    ingressDiagnosticStage(
      ingressDiagnosticError('CUTOVER_INGRESS_PAIR_UNPROVEN', '/private/path', original),
    ),
    undefined,
  );
});
test('diagnostic extraction never invokes arbitrary getters or retains exception payloads', () => {
  let reads = 0;
  const original = {
    get cause() {
      reads++;
      throw Error('private payload');
    },
  };
  assert.equal(ingressDiagnosticStage(original), undefined);
  const e = ingressDiagnosticError('CUTOVER_FENCE_RECORD_UNPROVEN', 'STORE_CONTENT', original);
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(e.cause), '{"ingressStage":"STORE_CONTENT"}');
  assert.equal(
    ingressDiagnosticStage({
      cause: {
        get ingressStage() {
          reads++;
          return 'PAIR_ENTRY';
        },
      },
    }),
    undefined,
  );
  assert.equal(reads, 0);
});
