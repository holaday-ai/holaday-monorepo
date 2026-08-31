import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildSchemaVerificationEnvironment,
  collectTeamTaskLifecycleSnapshot,
  computeTeamTaskLifecycleBoundaryDigest,
  countTeamTaskRelevantErrors,
  evaluateTeamTaskLifecyclePreflight,
  formatTeamTaskLifecyclePreflight,
  inspectTeamTaskLifecycleDatabase,
  loadTeamTaskLifecycleCanaryManifestSummary,
  loadTeamTaskQaReceipt,
  summarizeTeamTaskLifecycleEnvironment,
  summarizeTeamTaskObservationLogs,
  summarizeTeamTaskQaReceipt,
  summarizeTeamTaskRuntime,
} from './team-task-lifecycle-production-preflight.mjs';

test('schema verification preserves operator PATH and HOME while taking only the runtime database URL', () => {
  const localEnvironment = {
    PATH: '/trusted/pnpm/bin:/usr/bin',
    HOME: '/trusted/operator-home',
    NODE_OPTIONS: '--enable-source-maps',
    LOCAL_ONLY: 'kept',
    DATABASE_URL: 'mysql://local-database',
  };
  const runtimeEnvironment = {
    PATH: '/polluted/runtime/bin',
    HOME: '/polluted/runtime-home',
    NODE_OPTIONS: '--require=/untrusted/runtime-hook.js',
    DATABASE_URL: 'mysql://production-database',
    PRIVATE_RUNTIME_SECRET: 'never-forwarded',
    TEAM_TASK_LIFECYCLE_ALLOWLIST: 'usr_private',
  };

  const environment = buildSchemaVerificationEnvironment(localEnvironment, runtimeEnvironment);

  assert.deepEqual(environment, {
    PATH: '/trusted/pnpm/bin:/usr/bin',
    HOME: '/trusted/operator-home',
    DATABASE_URL: 'mysql://production-database',
  });
  assert.equal(JSON.stringify(environment).includes('never-forwarded'), false);
  assert.equal(JSON.stringify(environment).includes('usr_private'), false);
});

function readySnapshot() {
  return {
    health: { holaday: true, orangebench: true },
    deployment: { revisionPresent: true, revisionMatchesExpected: true },
    database: {
      migration0056ContractVerified: true,
      lifecycleTableCount: 14,
      schemaVerified: true,
      relevantErrorCount: 0,
      lifecycleRowCount: 0,
      logCoverageComplete: true,
      conflictCount: 0,
      latencySampleCount: 2,
      latencyP95Ms: 40,
    },
    orchestrator: {
      processCount: 1,
      uid: 998,
      configurationMatchesFile: true,
      observationWindowSeconds: 86_400,
      teamProjectsEnabled: true,
      teamProjectsAllowAll: false,
      teamProjectsAllowlistCount: 4,
      lifecycleEnabled: false,
      lifecycleAllowAll: false,
      lifecycleAllowlistCount: 4,
      allowlistsMatch: true,
    },
    canary: {
      qaReceiptValid: true,
      receiptKind: 'prepare',
      syntheticBoundaryConfirmed: true,
      activeSyntheticUserCount: 4,
      effectiveCanaryUserCount: 4,
      enabledSyntheticOrganizationCount: 2,
      effectiveCanaryOrganizationCount: 2,
      nonSyntheticEnabledOrganizationCount: 0,
      scenarioChecksPassed: 0,
      scenarioChecksExpected: 13,
    },
    smoke: {
      disabledPersonalProjects: true,
      disabledTeamProjects: true,
      disabledFilePath: true,
      enabledPersonalProjects: false,
      enabledTeamProjects: false,
      enabledFilePath: false,
    },
  };
}

function markRunning(snapshot) {
  snapshot.orchestrator.lifecycleEnabled = true;
  snapshot.canary.receiptKind = 'run';
  snapshot.canary.scenarioChecksPassed = 13;
  snapshot.smoke.enabledPersonalProjects = true;
  snapshot.smoke.enabledTeamProjects = true;
  snapshot.smoke.enabledFilePath = true;
  return snapshot;
}

test('dormant requires healthy deployed schema and keeps lifecycle disabled', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.lifecycleAllowlistCount = 0;
  snapshot.canary.syntheticBoundaryConfirmed = false;
  snapshot.canary.activeSyntheticUserCount = 0;
  snapshot.canary.enabledSyntheticOrganizationCount = 0;
  snapshot.canary.effectiveCanaryOrganizationCount = 0;

  const result = evaluateTeamTaskLifecyclePreflight('dormant', snapshot);

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('canary-ready accepts exactly four confirmed synthetic users and two organizations while off', () => {
  const result = evaluateTeamTaskLifecyclePreflight('canary-ready', readySnapshot());

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('canary-ready rejects the former two-user boundary as insufficient', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.lifecycleAllowlistCount = 2;
  snapshot.canary.activeSyntheticUserCount = 2;
  snapshot.canary.effectiveCanaryUserCount = 2;

  const result = evaluateTeamTaskLifecyclePreflight('canary-ready', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['bounded-user-allowlist']);
});

test('canary-ready rejects allow-all, non-synthetic reachability, and pre-enabled lifecycle', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.teamProjectsAllowAll = true;
  snapshot.orchestrator.lifecycleAllowAll = true;
  snapshot.orchestrator.lifecycleEnabled = true;
  snapshot.canary.effectiveCanaryUserCount = 1;
  snapshot.canary.nonSyntheticEnabledOrganizationCount = 1;

  const result = evaluateTeamTaskLifecyclePreflight('canary-ready', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, [
    'lifecycle-disabled',
    'bounded-user-allowlist',
    'synthetic-organization-boundary',
  ]);
});

test('canary-ready requires the phase-one and lifecycle allowlists to be the same four users', () => {
  const snapshot = readySnapshot();
  snapshot.orchestrator.teamProjectsAllowlistCount = 5;
  snapshot.orchestrator.allowlistsMatch = false;

  const result = evaluateTeamTaskLifecyclePreflight('canary-ready', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['bounded-user-allowlist']);
});

test('canary-ready requires all four allowlisted synthetic users to reach the bounded organizations', () => {
  const snapshot = readySnapshot();
  snapshot.canary.effectiveCanaryUserCount = 1;

  const result = evaluateTeamTaskLifecyclePreflight('canary-ready', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['bounded-user-allowlist']);
});

test('canary-running requires the complete bounded scenario matrix with the lifecycle on', () => {
  const snapshot = readySnapshot();
  markRunning(snapshot);

  const result = evaluateTeamTaskLifecyclePreflight('canary-running', snapshot);

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('canary-running rejects a hand-filled count without a current restricted QA receipt', () => {
  const snapshot = readySnapshot();
  markRunning(snapshot);
  snapshot.canary.qaReceiptValid = false;

  const result = evaluateTeamTaskLifecyclePreflight('canary-running', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['phase-one-smoke', 'canary-scenario-matrix']);
});

test('observe keeps the same four-by-two boundary without replaying destructive scenarios', () => {
  const snapshot = readySnapshot();
  markRunning(snapshot);
  snapshot.database.lifecycleRowCount = 9;

  const result = evaluateTeamTaskLifecyclePreflight('observe', snapshot);

  assert.equal(result.ready, true);
  assert.deepEqual(result.failedChecks, []);
});

test('observe fails closed before 24 hours or without complete stdout and stderr coverage', () => {
  const snapshot = readySnapshot();
  markRunning(snapshot);
  snapshot.orchestrator.observationWindowSeconds = 86_399;
  snapshot.database.logCoverageComplete = false;
  snapshot.database.latencySampleCount = 0;
  snapshot.database.latencyP95Ms = -1;

  const result = evaluateTeamTaskLifecyclePreflight('observe', snapshot);

  assert.equal(result.ready, false);
  assert.deepEqual(result.failedChecks, ['observation-window', 'observation-telemetry']);
});

test('migration, phase-one smoke, runtime identity, revision, and aggregate errors fail closed', () => {
  const snapshot = readySnapshot();
  snapshot.database.migration0056ContractVerified = false;
  snapshot.database.lifecycleTableCount = 13;
  snapshot.database.relevantErrorCount = 1;
  snapshot.orchestrator.uid = 0;
  snapshot.deployment.revisionMatchesExpected = false;
  snapshot.smoke.disabledPersonalProjects = false;

  const result = evaluateTeamTaskLifecyclePreflight('canary-ready', snapshot);

  assert.deepEqual(result.failedChecks, [
    'deployed-revision',
    'lifecycle-schema',
    'orchestrator-process',
    'relevant-errors-zero',
    'phase-one-smoke',
  ]);
});

test('environment and runtime summaries retain only booleans and counts', () => {
  const privateUserId = 'usr_private_synthetic_user';
  const privateSecret = 'private-database-secret';
  const environment = summarizeTeamTaskLifecycleEnvironment({
    TEAM_PROJECTS_ENABLED: 'true',
    TEAM_PROJECTS_ALLOWLIST: `${privateUserId},usr_second_private_user`,
    TEAM_TASK_LIFECYCLE_ENABLED: 'false',
    TEAM_TASK_LIFECYCLE_ALLOWLIST: `${privateUserId},usr_second_private_user`,
    DATABASE_URL: privateSecret,
  });
  const runtime = summarizeTeamTaskRuntime(
    [
      {
        name: 'holaday-orchestrator',
        pid: 101,
        pm2_env: { status: 'online', env: { DATABASE_URL: privateSecret } },
      },
    ],
    () => ({ uid: 998 }),
  );

  assert.deepEqual(environment, {
    teamProjectsEnabled: true,
    teamProjectsAllowAll: false,
    teamProjectsAllowlistCount: 2,
    lifecycleEnabled: false,
    lifecycleAllowAll: false,
    lifecycleAllowlistCount: 2,
    allowlistsMatch: true,
  });
  assert.deepEqual(runtime, { processCount: 1, uid: 998, observationWindowSeconds: -1 });
  assert.equal(JSON.stringify({ environment, runtime }).includes(privateUserId), false);
  assert.equal(JSON.stringify({ environment, runtime }).includes(privateSecret), false);
});

test('QA receipt summary requires the fixed 13 checks, current revision, recent time, and restricted file', () => {
  const revision = 'a'.repeat(40);
  const boundaryDigest = 'd'.repeat(64);
  const nowMs = Date.parse('2026-08-31T02:00:00.000Z');
  const checks = Object.fromEntries(
    [
      'directLifecycle',
      'firstComeRace',
      'validRevision',
      'vagueRevisionRejected',
      'revisionLimit',
      'appeal',
      'independentArbitration',
      'crossTenantHidden',
      'inactiveRejected',
      'idempotentRetry',
      'aiCannotAccept',
      'onTimeIndependent',
      'phaseOneRegression',
    ].map((name) => [name, true]),
  );
  const receipt = {
    schemaVersion: 1,
    source: 'holaday-team-task-lifecycle-qa-v1',
    receiptKind: 'run',
    revision,
    boundaryDigest,
    completedAt: '2026-08-31T01:00:00.000Z',
    phaseOne: {
      disabled: { personalProjects: true, teamProjects: true, filePath: true },
      enabled: { personalProjects: true, teamProjects: true, filePath: true },
    },
    checks,
    privateIdentity: 'usr_private-never-output',
  };

  const summary = summarizeTeamTaskQaReceipt(receipt, {
    expectedRevision: revision,
    nowMs,
    fileSecure: true,
    expectedBoundaryDigest: boundaryDigest,
  });

  assert.deepEqual(summary, {
    qaReceiptValid: true,
    receiptKind: 'run',
    disabledPersonalProjects: true,
    disabledTeamProjects: true,
    disabledFilePath: true,
    enabledPersonalProjects: true,
    enabledTeamProjects: true,
    enabledFilePath: true,
    scenarioChecksPassed: 13,
    scenarioChecksExpected: 13,
  });
  assert.equal(JSON.stringify(summary).includes(receipt.privateIdentity), false);
  assert.equal(
    summarizeTeamTaskQaReceipt(receipt, {
      expectedRevision: 'b'.repeat(40),
      nowMs,
      fileSecure: true,
      expectedBoundaryDigest: boundaryDigest,
    }).qaReceiptValid,
    false,
  );
  assert.equal(
    summarizeTeamTaskQaReceipt(receipt, {
      expectedRevision: revision,
      nowMs,
      fileSecure: false,
      expectedBoundaryDigest: boundaryDigest,
    }).qaReceiptValid,
    false,
  );
  assert.equal(
    summarizeTeamTaskQaReceipt(receipt, {
      expectedRevision: revision,
      nowMs,
      fileSecure: true,
      expectedBoundaryDigest: 'e'.repeat(64),
    }).qaReceiptValid,
    false,
  );
});

test('QA receipt loader rejects group-readable files and returns only a safe summary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-team-task-receipt-'));
  const receiptPath = join(directory, 'receipt.json');
  const revision = 'c'.repeat(40);
  const boundaryDigest = 'f'.repeat(64);
  const completedAt = '2026-08-31T01:00:00.000Z';
  const nowMs = Date.parse('2026-08-31T02:00:00.000Z');
  const checks = Object.fromEntries(
    [
      'directLifecycle',
      'firstComeRace',
      'validRevision',
      'vagueRevisionRejected',
      'revisionLimit',
      'appeal',
      'independentArbitration',
      'crossTenantHidden',
      'inactiveRejected',
      'idempotentRetry',
      'aiCannotAccept',
      'onTimeIndependent',
      'phaseOneRegression',
    ].map((name) => [name, true]),
  );
  writeFileSync(
    receiptPath,
    JSON.stringify({
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-qa-v1',
      receiptKind: 'run',
      revision,
      boundaryDigest,
      completedAt,
      phaseOne: {
        disabled: { personalProjects: true, teamProjects: true, filePath: true },
        enabled: { personalProjects: true, teamProjects: true, filePath: true },
      },
      checks,
      privateIdentity: 'usr_private-never-output',
    }),
    { mode: 0o600 },
  );

  try {
    const summary = loadTeamTaskQaReceipt(receiptPath, revision, nowMs, boundaryDigest);
    assert.equal(summary.qaReceiptValid, true);
    assert.equal(JSON.stringify(summary).includes('private'), false);

    chmodSync(receiptPath, 0o640);
    assert.equal(
      loadTeamTaskQaReceipt(receiptPath, revision, nowMs, boundaryDigest).qaReceiptValid,
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manifest summary requires two trusted Ed25519 principals over the full role-keyed 4 x 2 boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-team-task-manifest-'));
  const manifestPath = join(directory, 'manifest.json');
  const trustedSignersPath = join(directory, 'trusted-signers.json');
  const externalId = (prefix, fill) => `${prefix}_${fill.repeat(21).slice(0, 21)}`;
  const users = {
    creatorApprover: externalId('usr', 'A'),
    claimantA: externalId('usr', 'B'),
    claimantB: externalId('usr', 'C'),
    arbitrator: externalId('usr', 'D'),
  };
  const scope = (suffix) => ({
    organizationId: externalId('org', suffix),
    projectId: externalId('prj', suffix),
    actors: Object.fromEntries(
      Object.entries(users).map(([role, userId], index) => [
        role,
        {
          userId,
          organizationMemberId: externalId('omem', `${suffix}${index}`),
          projectMemberId: externalId('pmem', `${suffix}${index}`),
        },
      ]),
    ),
  });
  const scopes = [scope('E'), scope('F')];
  const boundaryDigest = computeTeamTaskLifecycleBoundaryDigest(scopes);
  const primaryKeys = generateKeyPairSync('ed25519');
  const secondaryKeys = generateKeyPairSync('ed25519');
  const attestation = (operatorSlot, operatorPrincipal, confirmedAt, privateKey) => {
    const unsigned = {
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-operator-attestation-v1',
      operatorSlot,
      operatorPrincipal,
      boundaryDigest,
      confirmedAt,
      confirmedSyntheticBoundary: true,
    };
    return {
      ...unsigned,
      signature: sign(null, Buffer.from(JSON.stringify(unsigned), 'utf8'), privateKey).toString(
        'base64',
      ),
    };
  };
  const manifest = {
    schemaVersion: 1,
    source: 'holaday-team-task-lifecycle-canary-manifest-v1',
    confirmation: {
      source: 'holaday-team-task-lifecycle-dual-operator-confirmation-v1',
      boundaryDigest,
      primaryAttestation: attestation(
        'primary',
        'ops:primary-human',
        '2026-08-31T05:00:00.000Z',
        primaryKeys.privateKey,
      ),
      secondaryAttestation: attestation(
        'secondary',
        'ops:secondary-human',
        '2026-08-31T05:05:00.000Z',
        secondaryKeys.privateKey,
      ),
      distinctHumanOperatorsConfirmed: true,
    },
    scopes,
  };
  const trustedSigners = {
    schemaVersion: 1,
    source: 'holaday-team-task-lifecycle-trusted-signers-v1',
    signers: [
      {
        operatorSlot: 'primary',
        operatorPrincipal: 'ops:primary-human',
        publicKeyPem: primaryKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      {
        operatorSlot: 'secondary',
        operatorPrincipal: 'ops:secondary-human',
        publicKeyPem: secondaryKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    ],
  };

  try {
    writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    writeFileSync(trustedSignersPath, JSON.stringify(trustedSigners), { mode: 0o600 });
    if (process.geteuid() !== 0) {
      assert.deepEqual(
        loadTeamTaskLifecycleCanaryManifestSummary(manifestPath, trustedSignersPath, {
          userExternalIds: Object.values(users),
          organizationExternalIds: scopes.map((entry) => entry.organizationId),
        }),
        { manifestValid: false, boundaryDigest: '' },
      );
    }
    assert.deepEqual(
      loadTeamTaskLifecycleCanaryManifestSummary(
        manifestPath,
        trustedSignersPath,
        {
          userExternalIds: Object.values(users),
          organizationExternalIds: scopes.map((entry) => entry.organizationId),
        },
        process.geteuid(),
      ),
      { manifestValid: true, boundaryDigest },
    );

    manifest.scopes[0].actors.claimantA.projectMemberId = externalId('pmem', 'Z');
    writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    assert.deepEqual(
      loadTeamTaskLifecycleCanaryManifestSummary(
        manifestPath,
        trustedSignersPath,
        {
          userExternalIds: Object.values(users),
          organizationExternalIds: scopes.map((entry) => entry.organizationId),
        },
        process.geteuid(),
      ),
      { manifestValid: false, boundaryDigest: '' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('collector uses private allowlists internally but returns only aggregate inventory', async () => {
  const privateUserIds = ['usr_AAAAAAAAAAAAAAAAAAAAA', 'usr_BBBBBBBBBBBBBBBBBBBBB'];
  const privateOrganizationIds = ['org_CCCCCCCCCCCCCCCCCCCCC', 'org_DDDDDDDDDDDDDDDDDDDDD'];
  const secret = 'mysql://private-secret';
  const processStartedAtMs = Date.parse('2026-08-31T00:00:00.000Z');
  const nowMs = processStartedAtMs + 60_000;
  const snapshot = await collectTeamTaskLifecycleSnapshot({
    runtimeEnvironment: {
      TEAM_PROJECTS_ENABLED: 'true',
      TEAM_PROJECTS_ALLOWLIST: privateUserIds.join(','),
      TEAM_TASK_LIFECYCLE_ENABLED: 'false',
      TEAM_TASK_LIFECYCLE_ALLOWLIST: privateUserIds.join(','),
      DATABASE_URL: secret,
    },
    configuredEnvironment: {
      TEAM_PROJECTS_ENABLED: 'true',
      TEAM_PROJECTS_ALLOWLIST: privateUserIds.join(','),
      TEAM_TASK_LIFECYCLE_ENABLED: 'false',
      TEAM_TASK_LIFECYCLE_ALLOWLIST: privateUserIds.join(','),
    },
    syntheticOrganizationAllowlist: privateOrganizationIds.join(','),
    syntheticBoundaryConfirmed: true,
    pm2Rows: [
      {
        name: 'holaday-orchestrator',
        pid: 101,
        pm2_env: { status: 'online', pm_uptime: processStartedAtMs },
      },
    ],
    inspectProcess: () => ({ uid: 998 }),
    health: { holaday: true, orangebench: true },
    revision: { present: true, matchesExpected: true },
    inspectDatabase: async ({ userExternalIds, organizationExternalIds }) => {
      assert.deepEqual(userExternalIds, privateUserIds);
      assert.deepEqual(organizationExternalIds, privateOrganizationIds);
      return {
        migration0056ContractVerified: true,
        lifecycleTableCount: 14,
        schemaVerified: true,
        lifecycleRowCount: 0,
        activeSyntheticUserCount: 2,
        effectiveCanaryUserCount: 2,
        enabledSyntheticOrganizationCount: 2,
        effectiveCanaryOrganizationCount: 2,
        nonSyntheticEnabledOrganizationCount: 0,
      };
    },
    relevantLogText: [
      JSON.stringify({
        time: processStartedAtMs + 100,
        reqId: 'private-request',
        req: { url: '/api/trpc/teamTasks.list' },
      }),
      JSON.stringify({
        time: processStartedAtMs + 200,
        reqId: 'private-request',
        level: 50,
        err: { code: 'ER_LOCK_DEADLOCK' },
      }),
      JSON.stringify({ time: nowMs, msg: 'health request completed' }),
    ].join('\n'),
    qaReceiptSummary: {
      qaReceiptValid: true,
      receiptKind: 'prepare',
      disabledPersonalProjects: true,
      disabledTeamProjects: true,
      disabledFilePath: true,
      enabledPersonalProjects: false,
      enabledTeamProjects: false,
      enabledFilePath: false,
      scenarioChecksPassed: 0,
      scenarioChecksExpected: 13,
    },
    nowMs,
  });

  assert.equal(snapshot.database.relevantErrorCount, 1);
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  for (const privateId of [...privateUserIds, ...privateOrganizationIds]) {
    assert.equal(JSON.stringify(snapshot).includes(privateId), false);
  }
});

test('relevant log aggregation counts matching error lines without returning their text', () => {
  const privateText = 'team_work_items ER_LOCK_DEADLOCK private evidence text';
  const count = countTeamTaskRelevantErrors(
    [
      'unrelated error',
      privateText,
      'team task lifecycle warning',
      'teamTasks ERROR failed',
      'account closure ERROR team work item cleanup failed',
      '0056_team_work_item_lifecycle migration ERROR',
    ].join('\n'),
  );

  assert.equal(count, 4);
  assert.equal(typeof count, 'number');
  assert.equal(String(count).includes(privateText), false);
});

test('observation aggregation joins stdout requests to completion latency and proves time coverage', () => {
  const processStartedAtMs = Date.parse('2026-08-30T00:00:00.000Z');
  const nowMs = Date.parse('2026-08-31T00:01:00.000Z');
  const rows = [
    JSON.stringify({
      time: processStartedAtMs - 60_000,
      reqId: 'old-process-request',
      req: { url: '/api/trpc/teamTasks.claim' },
      msg: 'incoming request',
    }),
    JSON.stringify({
      level: 50,
      time: processStartedAtMs - 59_000,
      reqId: 'old-process-request',
      res: { statusCode: 500 },
      responseTime: 999,
      msg: 'old process error',
    }),
    JSON.stringify({ time: processStartedAtMs + 500, msg: 'orchestrator online' }),
    JSON.stringify({
      time: processStartedAtMs + 1000,
      reqId: 'private-request-one',
      req: { url: '/api/trpc/teamTasks.list' },
      msg: 'incoming request',
    }),
    JSON.stringify({
      time: processStartedAtMs + 1040,
      reqId: 'private-request-one',
      res: { statusCode: 200 },
      responseTime: 40,
      msg: 'request completed',
    }),
    JSON.stringify({
      time: processStartedAtMs + 2000,
      reqId: 'private-request-two',
      req: { url: '/api/trpc/teamTasks.claim' },
      msg: 'incoming request',
    }),
    JSON.stringify({
      time: processStartedAtMs + 2020,
      reqId: 'private-request-two',
      res: { statusCode: 409 },
      responseTime: 20,
      code: 'CONFLICT',
      msg: 'request completed',
    }),
    JSON.stringify({ time: nowMs - 1000, msg: 'health request completed' }),
  ];

  const summary = summarizeTeamTaskObservationLogs(rows.join('\n'), {
    processStartedAtMs,
    nowMs,
  });

  assert.deepEqual(summary, {
    relevantErrorCount: 0,
    conflictCount: 1,
    latencySampleCount: 2,
    latencyP95Ms: 40,
    logCoverageComplete: true,
  });
  assert.equal(JSON.stringify(summary).includes('private-request'), false);
});

test('observation aggregation fails closed for missing or truncated logs', () => {
  const summary = summarizeTeamTaskObservationLogs(null, {
    processStartedAtMs: 1,
    nowMs: 86_400_001,
  });

  assert.deepEqual(summary, {
    relevantErrorCount: -1,
    conflictCount: -1,
    latencySampleCount: -1,
    latencyP95Ms: -1,
    logCoverageComplete: false,
  });
});

test('observation aggregation counts structured Pino errors from stdout by request correlation', () => {
  const startedAtMs = Date.parse('2026-08-30T00:00:00.000Z');
  const nowMs = startedAtMs + 1000;
  const rows = [
    JSON.stringify({
      level: 30,
      time: startedAtMs,
      reqId: 'private-request-one',
      req: { url: '/api/trpc/teamTasks.submit' },
      msg: 'incoming request',
    }),
    JSON.stringify({
      level: 50,
      time: nowMs,
      reqId: 'private-request-one',
      err: { code: 'ER_LOCK_DEADLOCK' },
      msg: 'request failed',
    }),
  ];

  const summary = summarizeTeamTaskObservationLogs(rows.join('\n'), {
    processStartedAtMs: startedAtMs,
    nowMs,
  });

  assert.equal(summary.relevantErrorCount, 1);
  assert.equal(JSON.stringify(summary).includes('private-request-one'), false);
});

test('database inspection returns only schema and synthetic-boundary counts', async () => {
  const results = [14, 9, 2, 2, 2, 2, 0];
  const queries = [];
  const connection = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      return [[{ count: results.shift() }]];
    },
  };

  const summary = await inspectTeamTaskLifecycleDatabase({
    connection,
    databaseName: 'holaday_test',
    userExternalIds: ['usr_AAAAAAAAAAAAAAAAAAAAA', 'usr_BBBBBBBBBBBBBBBBBBBBB'],
    organizationExternalIds: ['org_CCCCCCCCCCCCCCCCCCCCC', 'org_DDDDDDDDDDDDDDDDDDDDD'],
    migration0056FilePresent: true,
    schemaVerified: true,
  });

  assert.deepEqual(summary, {
    migration0056ContractVerified: true,
    lifecycleTableCount: 14,
    schemaVerified: true,
    lifecycleRowCount: 9,
    activeSyntheticUserCount: 2,
    effectiveCanaryUserCount: 2,
    enabledSyntheticOrganizationCount: 2,
    effectiveCanaryOrganizationCount: 2,
    nonSyntheticEnabledOrganizationCount: 0,
  });
  assert.equal(queries.length, 7);
  assert.equal(JSON.stringify(summary).includes('usr_'), false);
  assert.equal(JSON.stringify(summary).includes('org_'), false);
});

test('database inspection skips identity queries when either private allowlist is absent', async () => {
  let calls = 0;
  const connection = {
    async query() {
      calls += 1;
      return [[{ count: calls === 1 ? 14 : 0 }]];
    },
  };

  const summary = await inspectTeamTaskLifecycleDatabase({
    connection,
    databaseName: 'holaday_test',
    userExternalIds: [],
    organizationExternalIds: [],
    migration0056FilePresent: true,
    schemaVerified: true,
  });

  assert.equal(calls, 2);
  assert.equal(summary.activeSyntheticUserCount, 0);
  assert.equal(summary.effectiveCanaryUserCount, 0);
  assert.equal(summary.enabledSyntheticOrganizationCount, 0);
  assert.equal(summary.effectiveCanaryOrganizationCount, 0);
  assert.equal(summary.nonSyntheticEnabledOrganizationCount, 0);
});

test('database inspection does not claim the 0056 contract from checkout presence alone', async () => {
  let calls = 0;
  const connection = {
    async query() {
      calls += 1;
      return [[{ count: calls === 1 ? 14 : 0 }]];
    },
  };

  const summary = await inspectTeamTaskLifecycleDatabase({
    connection,
    databaseName: 'holaday_test',
    userExternalIds: [],
    organizationExternalIds: [],
    migration0056FilePresent: true,
    schemaVerified: false,
  });

  assert.equal(summary.migration0056ContractVerified, false);
});

test('formatted output is a fixed boolean and count-only summary', () => {
  const secret = 'private-secret-never-print';
  const identity = 'usr_private-never-print';
  const snapshot = readySnapshot();
  snapshot.privateSecret = secret;
  snapshot.privateIdentity = identity;
  const output = formatTeamTaskLifecyclePreflight(
    evaluateTeamTaskLifecyclePreflight('canary-ready', snapshot),
  );

  assert.match(
    output,
    /^TEAM_TASK_LIFECYCLE_PREFLIGHT mode=canary-ready status=ready checks=\d+\/\d+ failed=none healthHoladay=true healthOrangebench=true revisionMatch=true processCount=1 uid=998 migration0056Contract=true lifecycleTables=14 lifecycleEnabled=false teamAllowAll=false teamAllowlistCount=4 allowlistsMatch=true allowAll=false allowlistCount=4 syntheticUsers=4 effectiveUsers=4 syntheticOrganizations=2 effectiveOrganizations=2 nonSyntheticOrganizations=0 lifecycleRows=0 relevantErrors=0 observationSeconds=86400 logCoverage=true conflicts=0 latencySamples=2 latencyP95Ms=40 qaReceipt=true disabledPersonalSmoke=true disabledTeamSmoke=true disabledFileSmoke=true enabledPersonalSmoke=false enabledTeamSmoke=false enabledFileSmoke=false scenarioChecks=0\/13$/,
  );
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(identity), false);
});

test('unknown rollout mode is rejected', () => {
  assert.throws(
    () => evaluateTeamTaskLifecyclePreflight('general-availability', readySnapshot()),
    /Unsupported team task lifecycle rollout mode/,
  );
});
