import assert from 'node:assert/strict';
import test from 'node:test';

import {
  environmentKeysMatch,
  evaluateAccountClosureRollout,
  formatAccountClosureRolloutResult,
  loadMysqlFromCwd,
  summarizeCnPaymentEnvironment,
  summarizeOrchestratorEnvironment,
  summarizePm2Runtime,
} from './account-closure-rollout-preflight.mjs';

const MiB = 1024 * 1024;

function readySnapshot() {
  return {
    health: {
      holaday: true,
      orangebench: true,
    },
    database: {
      verified: true,
      closureTableCount: 5,
      queueTotal: 0,
    },
    orchestrator: {
      processCount: 1,
      uid: 998,
      rssBytes: 360 * MiB,
      accountClosureEnabled: false,
      accountClosureWorkerEnabled: false,
      legacyFeedbackSanitized: true,
      legacyAnalyticsLogsSanitized: true,
      hmacPresent: true,
      hmacLength: 40,
      allowlistCount: 1,
      syntheticAllowlistConfirmed: true,
      privateEmailReady: true,
      workerCount: 0,
      workerUid: null,
      workerRssBytes: 0,
      workerListenerCount: 0,
      workerManaged: true,
      workerConfigurationMatchesOrchestrator: true,
      configurationMatchesFile: true,
    },
    cnPayment: {
      processCount: 1,
      configurationMatchesFile: true,
      accountClosureSmsEnabled: true,
      credentialsPresent: true,
      signPresent: true,
      verifyTemplatePresent: true,
      completeTemplatePresent: true,
    },
  };
}

test('dormant passes only with both flags off, no worker, healthy schema, and an empty queue', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.legacyFeedbackSanitized = false;
  snapshot.orchestrator.legacyAnalyticsLogsSanitized = false;
  snapshot.orchestrator.hmacPresent = false;
  snapshot.orchestrator.hmacLength = 0;
  snapshot.orchestrator.allowlistCount = 0;
  snapshot.orchestrator.syntheticAllowlistConfirmed = false;
  snapshot.orchestrator.privateEmailReady = false;
  snapshot.cnPayment.accountClosureSmsEnabled = false;
  snapshot.cnPayment.verifyTemplatePresent = false;
  snapshot.cnPayment.completeTemplatePresent = false;

  const result = evaluateAccountClosureRollout('dormant', snapshot);

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('dormant rejects either legacy sanitation flag being pre-enabled', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.legacyAnalyticsLogsSanitized = false;

  const result = evaluateAccountClosureRollout('dormant', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['dormant-flags-disabled']);
});

test('canary-ready passes with reviewed prerequisites while API and worker remain off', () => {
  const result = evaluateAccountClosureRollout('canary-ready', readySnapshot());

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('canary-ready rejects configuration-file drift from either live process', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.configurationMatchesFile = false;
  snapshot.cnPayment.configurationMatchesFile = false;

  const result = evaluateAccountClosureRollout('canary-ready', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['orchestrator-config-consistent', 'closure-sms-ready']);
});

test('canary-running requires one uid 998, portless worker below 512 MiB and both flags on', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.accountClosureEnabled = true;
  snapshot.orchestrator.accountClosureWorkerEnabled = true;
  snapshot.orchestrator.workerCount = 1;
  snapshot.orchestrator.workerUid = 998;
  snapshot.orchestrator.workerRssBytes = 479 * MiB;

  const result = evaluateAccountClosureRollout('canary-running', snapshot);

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('canary-running rejects unmanaged or stale-config worker processes', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.accountClosureEnabled = true;
  snapshot.orchestrator.accountClosureWorkerEnabled = true;
  snapshot.orchestrator.workerCount = 1;
  snapshot.orchestrator.workerUid = 998;
  snapshot.orchestrator.workerRssBytes = 479 * MiB;
  snapshot.orchestrator.workerManaged = false;
  snapshot.orchestrator.workerConfigurationMatchesOrchestrator = false;

  const result = evaluateAccountClosureRollout('canary-running', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['worker-managed', 'worker-config-consistent']);
});

test('canary-running rejects active queue entries before synthetic exercise begins', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.accountClosureEnabled = true;
  snapshot.orchestrator.accountClosureWorkerEnabled = true;
  snapshot.orchestrator.workerCount = 1;
  snapshot.orchestrator.workerUid = 998;
  snapshot.orchestrator.workerRssBytes = 479 * MiB;
  snapshot.database.queueTotal = 1;

  const result = evaluateAccountClosureRollout('canary-running', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['queue-empty']);
});

test('canary-running rejects exactly 512 MiB and never rounds a passing RSS up to 512', () => {
  const blockedSnapshot = readySnapshot();
  blockedSnapshot.orchestrator.accountClosureEnabled = true;
  blockedSnapshot.orchestrator.accountClosureWorkerEnabled = true;
  blockedSnapshot.orchestrator.workerCount = 1;
  blockedSnapshot.orchestrator.workerUid = 998;
  blockedSnapshot.orchestrator.workerRssBytes = 512 * MiB;
  const blocked = evaluateAccountClosureRollout('canary-running', blockedSnapshot);

  const passingSnapshot = structuredClone(blockedSnapshot);
  passingSnapshot.orchestrator.workerRssBytes = 512 * MiB - 1;
  const passing = evaluateAccountClosureRollout('canary-running', passingSnapshot);

  assert.deepEqual(blocked.failedChecks, ['worker-memory-ceiling']);
  assert.equal(passing.ready, true);
  assert.equal(passing.summary.workerRssMiB, 511);
});

test('bad canary configuration fails closed with fixed check names', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.hmacLength = 31;
  snapshot.orchestrator.allowlistCount = 2;
  snapshot.orchestrator.syntheticAllowlistConfirmed = false;
  snapshot.cnPayment.completeTemplatePresent = false;

  const result = evaluateAccountClosureRollout('canary-ready', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, [
    'hmac-secret-length',
    'single-synthetic-allowlist',
    'closure-sms-ready',
  ]);
});

test('environment summaries and formatted output never contain secret, ID, or template values', () => {
  const secret = 'private-hmac-value-that-must-never-leak';
  const syntheticId = 'usr_private_synthetic_identifier';
  const verifyTemplate = 'SMS_PRIVATE_VERIFY_TEMPLATE';
  const completeTemplate = 'SMS_PRIVATE_COMPLETE_TEMPLATE';
  const resendKey = 're_private_resend_key';
  const accessKey = 'private-aliyun-access-key';

  const orchestrator = summarizeOrchestratorEnvironment(
    {
      ACCOUNT_CLOSURE_ENABLED: 'false',
      ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
      ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED: 'true',
      ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED: 'true',
      ACCOUNT_CLOSURE_HMAC_SECRET: secret,
      ACCOUNT_CLOSURE_ALLOWLIST: syntheticId,
      RESEND_API_KEY: resendKey,
    },
    { syntheticAllowlistConfirmed: true },
  );
  const cnPayment = summarizeCnPaymentEnvironment({
    ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED: 'true',
    ALIYUN_ACCESS_KEY_ID: accessKey,
    ALIYUN_ACCESS_KEY_SECRET: 'private-aliyun-secret',
    ALIYUN_SMS_SIGN_NAME: 'private-sign-name',
    ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE: verifyTemplate,
    ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE: completeTemplate,
  });
  const snapshot = {
    ...readySnapshot(),
    orchestrator: { ...readySnapshot().orchestrator, ...orchestrator },
    cnPayment: { ...readySnapshot().cnPayment, ...cnPayment },
  };
  const output = formatAccountClosureRolloutResult(
    evaluateAccountClosureRollout('canary-ready', snapshot),
  );
  const serialized = JSON.stringify({ orchestrator, cnPayment, output });

  for (const value of [
    secret,
    syntheticId,
    verifyTemplate,
    completeTemplate,
    resendKey,
    accessKey,
  ]) {
    assert.equal(serialized.includes(value), false);
  }
  assert.match(output, /^ACCOUNT_CLOSURE_PREFLIGHT mode=canary-ready status=ready/);
});

test('unknown mode is rejected', () => {
  assert.throws(
    () => evaluateAccountClosureRollout('general-availability', readySnapshot()),
    /Unsupported account closure rollout mode/,
  );
});

test('PM2 runtime summary keeps only process count, uid, RSS, and listener count', () => {
  const pm2Secret = 'pm2-environment-secret-that-must-not-leak';
  const runtime = summarizePm2Runtime(
    [
      {
        name: 'holaday-orchestrator',
        pid: 101,
        pm2_env: { status: 'online', env: { DATABASE_URL: pm2Secret } },
      },
      {
        name: 'holaday-account-closure-worker',
        pid: 202,
        pm2_env: { status: 'online', env: { ACCOUNT_CLOSURE_HMAC_SECRET: pm2Secret } },
      },
    ],
    {
      inspectProcess(pid) {
        return pid === 101 ? { uid: 998, rssBytes: 360 * MiB } : { uid: 998, rssBytes: 470 * MiB };
      },
      listenerPids: new Set([101]),
      discoveredWorkerPids: new Set([202]),
    },
  );

  assert.deepEqual(runtime, {
    processCount: 1,
    uid: 998,
    rssBytes: 360 * MiB,
    workerCount: 1,
    workerUid: 998,
    workerRssBytes: 470 * MiB,
    workerListenerCount: 0,
    workerManaged: true,
  });
  assert.equal(JSON.stringify(runtime).includes(pm2Secret), false);
});

test('PM2 runtime summary detects a managed worker plus an unmanaged duplicate', () => {
  const runtime = summarizePm2Runtime(
    [
      { name: 'holaday-orchestrator', pid: 101, pm2_env: { status: 'online' } },
      { name: 'holaday-account-closure-worker', pid: 202, pm2_env: { status: 'online' } },
    ],
    {
      inspectProcess: () => ({ uid: 998, rssBytes: 100 * MiB }),
      listenerPids: new Set(),
      discoveredWorkerPids: new Set([202, 303]),
    },
  );

  assert.equal(runtime.workerCount, 2);
  assert.equal(runtime.workerManaged, false);
});

test('production MySQL dependency resolves from cwd when the collector runs through stdin', () => {
  const mysql = loadMysqlFromCwd(process.cwd());

  assert.equal(typeof mysql.createConnection, 'function');
});

test('environment drift compares exact whitelisted values without returning them', () => {
  const keys = ['ACCOUNT_CLOSURE_HMAC_SECRET', 'ACCOUNT_CLOSURE_ALLOWLIST'];
  const fileEnvironment = {
    ACCOUNT_CLOSURE_HMAC_SECRET: 'a'.repeat(40),
    ACCOUNT_CLOSURE_ALLOWLIST: 'usr_synthetic_file',
  };
  const runtimeEnvironment = {
    ACCOUNT_CLOSURE_HMAC_SECRET: 'b'.repeat(40),
    ACCOUNT_CLOSURE_ALLOWLIST: 'usr_synthetic_runtime',
  };

  const matches = environmentKeysMatch(fileEnvironment, runtimeEnvironment, keys);

  assert.equal(matches, false);
  assert.equal(typeof matches, 'boolean');
});
