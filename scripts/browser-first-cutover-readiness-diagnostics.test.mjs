import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { observeCutoverChild } from './browser-first-cutover-bridge-output.mjs';
import { firstCutoverExecutionFailureFields } from './browser-first-cutover-host.mjs';
import {
  ingressDiagnosticError,
  readinessDiagnosticError,
  readinessDiagnosticFields,
} from './browser-first-cutover-ingress-diagnostics.mjs';
import { performFirstCutover } from './browser-first-cutover-transition.mjs';

for (const [name, original] of [
  ['secret', Error('password=SECRET SQL select email from users')],
  ['prefix', Error('CUTOVER_PRIVATE_SECRET_UNPROVEN')],
  [
    'getter',
    Object.defineProperty({}, 'message', {
      get() {
        throw Error('getter invoked');
      },
    }),
  ],
  [
    'proxy',
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Error('proxy secret');
        },
      },
    ),
  ],
]) {
  test(`readiness fixed diagnostic rejects arbitrary ${name}`, () => {
    const error = readinessDiagnosticError(original, 'READINESS_HOST_WORK_BEFORE_FACTS');
    assert.equal(error.message, 'CUTOVER_SITE_UNPROVEN');
    assert.equal(error.cause.ingressCause, 'UNCLASSIFIED');
    assert(!JSON.stringify(error.cause).includes('SECRET'));
  });
}

test('readiness never invokes getters/toJSON/coercion and preserves deepest fixed labels independently', () => {
  let invoked = 0;
  const hostile = {
    get message() {
      invoked++;
      return undefined;
    },
    get cause() {
      invoked++;
      return undefined;
    },
    toJSON() {
      invoked++;
      return undefined;
    },
    toString() {
      invoked++;
      return undefined;
    },
  };
  const label = {
    toString() {
      invoked++;
      return 'READINESS_HOST_BODY';
    },
  };
  const refusal = readinessDiagnosticError(hostile, label);
  assert.deepEqual(readinessDiagnosticFields(refusal, true), { ingressCause: 'UNCLASSIFIED' });
  assert.equal(invoked, 0);
  const inner = ingressDiagnosticError(
    'CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN',
    'PAIR_SCOPE',
  );
  const error = readinessDiagnosticError(inner, 'READINESS_HOST_OBSERVER');
  const final = ingressDiagnosticError(
    'CUTOVER_SITE_UNPROVEN',
    'RECOVERY_SITE_RUN',
    readinessDiagnosticError(error, 'READINESS_HOST_BODY'),
  );
  assert.deepEqual(final.cause, {
    ingressStage: 'PAIR_SCOPE',
    readinessStage: 'READINESS_HOST_OBSERVER',
    ingressCause: 'CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN',
  });
  assert.deepEqual(
    readinessDiagnosticFields({ readinessStage: 'PRIVATE', ingressCause: 'CUTOVER_SECRET' }),
    {},
  );
});

test('actual transition preserves safe readiness metadata and original preflight outcome', async () => {
  const calls = [];
  const result = await performFirstCutover({
    candidate: 'a'.repeat(40),
    clock: () => 1000,
    window: { maintenanceEndsAtMs: 2000, reconcileByMs: 3000, operatorRef: 'fixture' },
    adapter: {
      ...Object.fromEntries(
        [
          'preflight',
          'stage',
          'fenceOrders',
          'settleLegacy',
          'stopProducers',
          'fenceAll',
          'stopLegacy',
          'backupAndRestoreCheck',
          'initializeState',
          'persist',
          'migrate',
          'start',
          'verify',
          'beforeOpen',
          'open',
          'status',
          'afterOpen',
          'resumeWorker',
          'close',
          'holdMaintenance',
          'reconcile',
        ].map((key) => [key, async () => assert.fail(`unexpected effect ${key}`)]),
      ),
      preflight: async () => calls.push('preflight'),
      stage: async () => {
        calls.push('stage');
        throw readinessDiagnosticError(
          Error('CUTOVER_WORK_OBSERVATION_UNPROVEN'),
          'READINESS_HOST_WORK_BEFORE_PERSISTED',
        );
      },
      persist: async () => assert.fail('must not advance'),
      fenceOrders: async () => assert.fail('must not fence'),
    },
  });
  assert.deepEqual(calls, ['preflight', 'stage']);
  assert.equal(result.ok, false);
  assert.equal(result.phase, 'preflight');
  assert.equal(result.action, 'abort_without_mutation');
  assert.equal(result.code, 'CUTOVER_SITE_UNPROVEN');
  const retained = firstCutoverExecutionFailureFields(result);
  assert.equal(retained.readinessStage, 'READINESS_HOST_WORK_BEFORE_PERSISTED');
  assert.equal(retained.ingressCause, 'CUTOVER_WORK_OBSERVATION_UNPROVEN');
});

test('actual transition to host CLI frame expression to real child EOF to bridge summary', async () => {
  // Reuse the actual host CLI JSON expression, not a separately recreated frame.
  const host = await readFile(new URL('./browser-first-cutover-host.mjs', import.meta.url), 'utf8');
  const frame = host.match(
    /JSON\.stringify\(\{ kind: 'first-cutover-execution-result', candidate: value\.binding\.candidate, attempt, ok: result\.ok === true, phase: result\.phase, \.\.\.firstCutoverExecutionFailureFields\(result\) \}\)/,
  )?.[0];
  assert(frame);
  const module = (name) => new URL(`./${name}`, import.meta.url).href;
  const program = `
    import { performFirstCutover } from ${JSON.stringify(module('browser-first-cutover-transition.mjs'))};
    import { firstCutoverExecutionFailureFields } from ${JSON.stringify(module('browser-first-cutover-host.mjs'))};
    import { readinessDiagnosticError } from ${JSON.stringify(module('browser-first-cutover-ingress-diagnostics.mjs'))};
    const value={binding:{candidate:'a'.repeat(40)}}; const attempt='synthetic';
    const result=await performFirstCutover({candidate:value.binding.candidate,clock:()=>1000,
      window:{maintenanceEndsAtMs:2000,reconcileByMs:3000,operatorRef:'fixture'},
      adapter:{...Object.fromEntries(["preflight", "stage", "fenceOrders", "settleLegacy", "stopProducers", "fenceAll", "stopLegacy", "backupAndRestoreCheck", "initializeState", "persist", "migrate", "start", "verify", "beforeOpen", "open", "status", "afterOpen", "resumeWorker", "close", "holdMaintenance", "reconcile"].map(key=>[key,async()=>{throw Error('unexpected effect')} ])),preflight:async()=>{},stage:async()=>{throw readinessDiagnosticError(
        Error('CUTOVER_DATABASE_WRITERS_UNPROVEN'),'READINESS_HOST_DB_WRITERS_AFTER_DATABASE')}}});
    process.stdout.write(${frame}+'\\n'); process.exitCode=1;
  `;
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=192', '--v8-pool-size=1', '--input-type=module', '--eval', program],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, UV_THREADPOOL_SIZE: '1' } },
  );
  child.stdin.end();
  const observed = observeCutoverChild(child);
  const exit = await observed.exited;
  const summary = observed.summary();
  assert.equal(exit.code, 1);
  assert.equal(summary.outputUnproven, false);
  assert.equal(summary.protocolFrames, 0);
  assert.equal(summary.stderrBytes, 0);
  assert.equal(summary.final.readinessStage, 'READINESS_HOST_DB_WRITERS_AFTER_DATABASE');
  assert.equal(summary.final.ingressCause, 'CUTOVER_DATABASE_WRITERS_UNPROVEN');
  assert.equal(summary.final.code, 'CUTOVER_SITE_UNPROVEN');
});
