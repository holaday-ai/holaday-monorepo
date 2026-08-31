import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMysqlFromCwd, parseEnvironmentFile } from './account-closure-rollout-preflight.mjs';

const MODES = new Set(['dormant', 'canary-ready', 'canary-running', 'observe']);
const LIFECYCLE_TABLE_COUNT = 14;
const CANARY_USER_COUNT = 4;
const CANARY_ORGANIZATION_COUNT = 2;
const QA_RECEIPT_SOURCE = 'holaday-team-task-lifecycle-qa-v1';
const QA_RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CANARY_ROLE_NAMES = ['creatorApprover', 'claimantA', 'claimantB', 'arbitrator'];
const CANARY_MANIFEST_SOURCE = 'holaday-team-task-lifecycle-canary-manifest-v1';
const CANARY_CONFIRMATION_SOURCE = 'holaday-team-task-lifecycle-dual-operator-confirmation-v1';
const CANARY_ATTESTATION_SOURCE = 'holaday-team-task-lifecycle-operator-attestation-v1';
const CANARY_TRUSTED_SIGNERS_SOURCE = 'holaday-team-task-lifecycle-trusted-signers-v1';
const QA_SCENARIO_NAMES = [
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
];
const LIFECYCLE_TABLES = [
  'team_milestones',
  'team_work_items',
  'team_work_item_assignments',
  'team_work_item_dependencies',
  'acceptance_contract_versions',
  'team_work_item_submissions',
  'team_work_item_reviews',
  'team_task_review_delegations',
  'team_work_item_appeals',
  'team_arbitration_decisions',
  'team_work_item_events',
  'team_project_planning_events',
  'team_evidence_bindings',
  'team_ai_contributions',
];
const CONFIGURATION_KEYS = [
  'TEAM_PROJECTS_ENABLED',
  'TEAM_PROJECTS_ALLOWLIST',
  'TEAM_TASK_LIFECYCLE_ENABLED',
  'TEAM_TASK_LIFECYCLE_ALLOWLIST',
  'TEAM_TASK_LIFECYCLE_CANARY_MANIFEST_FILE',
  'TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE',
  'TEAM_TASK_LIFECYCLE_TRUSTED_SIGNERS_FILE',
];

function enabled(value) {
  return value === true || value === 'true';
}

function parseBoundedCsv(value) {
  if (value === '') return { count: 0, allowAll: true, values: new Set() };
  if (typeof value !== 'string') return { count: 0, allowAll: false, values: new Set() };
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry === '')) {
    return { count: 0, allowAll: false, values: new Set() };
  }
  const values = new Set(entries);
  return { count: values.size, allowAll: false, values };
}

function equalSets(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function parseExternalIdCsv(value, prefix) {
  if (typeof value !== 'string' || value === '') return [];
  const entries = value.split(',').map((entry) => entry.trim());
  const expectedLength = prefix.length + 1 + 21;
  if (
    entries.some(
      (entry) =>
        entry.length !== expectedLength ||
        !entry.startsWith(`${prefix}_`) ||
        !/^[A-Za-z0-9_]+$/.test(entry),
    )
  ) {
    return [];
  }
  return [...new Set(entries)];
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function validExternalId(value, prefix) {
  return (
    typeof value === 'string' &&
    value.length === prefix.length + 22 &&
    value.startsWith(`${prefix}_`) &&
    /^[A-Za-z0-9_]+$/.test(value)
  );
}

export function computeTeamTaskLifecycleBoundaryDigest(scopes) {
  if (!Array.isArray(scopes) || scopes.length !== 2) return '';
  const boundary = scopes.map((scope) => ({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    actors: Object.fromEntries(
      CANARY_ROLE_NAMES.map((role) => [
        role,
        {
          userId: scope.actors[role].userId,
          organizationMemberId: scope.actors[role].organizationMemberId,
          projectMemberId: scope.actors[role].projectMemberId,
        },
      ]),
    ),
  }));
  return createHash('sha256')
    .update(JSON.stringify({ version: 1, scopes: boundary }), 'utf8')
    .digest('hex');
}

function invalidCanaryManifestSummary() {
  return { manifestValid: false, boundaryDigest: '' };
}

function parseCanaryAttestation(value) {
  if (
    !exactKeys(value, [
      'boundaryDigest',
      'confirmedAt',
      'confirmedSyntheticBoundary',
      'operatorPrincipal',
      'operatorSlot',
      'schemaVersion',
      'signature',
      'source',
    ]) ||
    value.schemaVersion !== 1 ||
    value.source !== CANARY_ATTESTATION_SOURCE ||
    !['primary', 'secondary'].includes(value.operatorSlot) ||
    typeof value.operatorPrincipal !== 'string' ||
    !/^[A-Za-z0-9._:@-]{3,128}$/.test(value.operatorPrincipal) ||
    !/^[0-9a-f]{64}$/.test(value.boundaryDigest) ||
    value.confirmedSyntheticBoundary !== true ||
    typeof value.signature !== 'string'
  ) {
    return null;
  }
  const confirmedAtMs = Date.parse(value.confirmedAt);
  const signature = Buffer.from(value.signature, 'base64');
  if (
    !Number.isFinite(confirmedAtMs) ||
    new Date(confirmedAtMs).toISOString() !== value.confirmedAt ||
    signature.length !== 64 ||
    signature.toString('base64') !== value.signature
  ) {
    return null;
  }
  return value;
}

function attestationSigningPayload(attestation) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: attestation.schemaVersion,
      source: attestation.source,
      operatorSlot: attestation.operatorSlot,
      operatorPrincipal: attestation.operatorPrincipal,
      boundaryDigest: attestation.boundaryDigest,
      confirmedAt: attestation.confirmedAt,
      confirmedSyntheticBoundary: attestation.confirmedSyntheticBoundary,
    }),
    'utf8',
  );
}

function parseTrustedSigners(value) {
  if (
    !exactKeys(value, ['schemaVersion', 'signers', 'source']) ||
    value.schemaVersion !== 1 ||
    value.source !== CANARY_TRUSTED_SIGNERS_SOURCE ||
    !Array.isArray(value.signers) ||
    value.signers.length !== 2
  ) {
    return null;
  }
  const signers = [];
  try {
    for (const signer of value.signers) {
      if (
        !exactKeys(signer, ['operatorPrincipal', 'operatorSlot', 'publicKeyPem']) ||
        !['primary', 'secondary'].includes(signer.operatorSlot) ||
        typeof signer.operatorPrincipal !== 'string' ||
        !/^[A-Za-z0-9._:@-]{3,128}$/.test(signer.operatorPrincipal) ||
        typeof signer.publicKeyPem !== 'string' ||
        signer.publicKeyPem.length > 8 * 1024
      ) {
        return null;
      }
      const publicKey = createPublicKey(signer.publicKeyPem);
      if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') return null;
      signers.push({ ...signer, publicKey });
    }
  } catch {
    return null;
  }
  if (
    new Set(signers.map((signer) => signer.operatorSlot)).size !== 2 ||
    new Set(signers.map((signer) => signer.operatorPrincipal)).size !== 2
  ) {
    return null;
  }
  return signers;
}

function validCanaryScopes(scopes, expectedBoundary) {
  if (!Array.isArray(scopes) || scopes.length !== 2) return false;
  const userIds = new Set();
  const organizationIds = new Set();
  const projectIds = new Set();
  const organizationMemberIds = new Set();
  const projectMemberIds = new Set();
  for (const [scopeIndex, scope] of scopes.entries()) {
    if (
      !exactKeys(scope, ['actors', 'organizationId', 'projectId']) ||
      !validExternalId(scope.organizationId, 'org') ||
      !validExternalId(scope.projectId, 'prj') ||
      !exactKeys(scope.actors, CANARY_ROLE_NAMES)
    ) {
      return false;
    }
    organizationIds.add(scope.organizationId);
    projectIds.add(scope.projectId);
    for (const role of CANARY_ROLE_NAMES) {
      const actor = scope.actors[role];
      if (
        !exactKeys(actor, ['organizationMemberId', 'projectMemberId', 'userId']) ||
        !validExternalId(actor.userId, 'usr') ||
        !validExternalId(actor.organizationMemberId, 'omem') ||
        !validExternalId(actor.projectMemberId, 'pmem') ||
        (scopeIndex === 1 && actor.userId !== scopes[0].actors[role].userId)
      ) {
        return false;
      }
      userIds.add(actor.userId);
      organizationMemberIds.add(actor.organizationMemberId);
      projectMemberIds.add(actor.projectMemberId);
    }
  }
  return (
    userIds.size === CANARY_USER_COUNT &&
    organizationIds.size === CANARY_ORGANIZATION_COUNT &&
    projectIds.size === CANARY_ORGANIZATION_COUNT &&
    organizationMemberIds.size === CANARY_USER_COUNT * CANARY_ORGANIZATION_COUNT &&
    projectMemberIds.size === CANARY_USER_COUNT * CANARY_ORGANIZATION_COUNT &&
    equalSets(userIds, new Set(expectedBoundary.userExternalIds)) &&
    equalSets(organizationIds, new Set(expectedBoundary.organizationExternalIds))
  );
}

function summarizeCanaryManifest(manifest, trustedSigners, expectedBoundary) {
  if (
    !exactKeys(manifest, ['confirmation', 'schemaVersion', 'scopes', 'source']) ||
    manifest.schemaVersion !== 1 ||
    manifest.source !== CANARY_MANIFEST_SOURCE ||
    !validCanaryScopes(manifest.scopes, expectedBoundary) ||
    !exactKeys(manifest.confirmation, [
      'boundaryDigest',
      'distinctHumanOperatorsConfirmed',
      'primaryAttestation',
      'secondaryAttestation',
      'source',
    ]) ||
    manifest.confirmation.source !== CANARY_CONFIRMATION_SOURCE ||
    manifest.confirmation.distinctHumanOperatorsConfirmed !== true
  ) {
    return invalidCanaryManifestSummary();
  }
  const boundaryDigest = computeTeamTaskLifecycleBoundaryDigest(manifest.scopes);
  const primary = parseCanaryAttestation(manifest.confirmation.primaryAttestation);
  const secondary = parseCanaryAttestation(manifest.confirmation.secondaryAttestation);
  if (
    !primary ||
    !secondary ||
    primary.operatorSlot !== 'primary' ||
    secondary.operatorSlot !== 'secondary' ||
    primary.operatorPrincipal === secondary.operatorPrincipal ||
    primary.boundaryDigest !== boundaryDigest ||
    secondary.boundaryDigest !== boundaryDigest ||
    manifest.confirmation.boundaryDigest !== boundaryDigest ||
    Date.parse(secondary.confirmedAt) < Date.parse(primary.confirmedAt)
  ) {
    return invalidCanaryManifestSummary();
  }
  for (const attestation of [primary, secondary]) {
    const signer = trustedSigners.find(
      (candidate) =>
        candidate.operatorSlot === attestation.operatorSlot &&
        candidate.operatorPrincipal === attestation.operatorPrincipal,
    );
    if (
      !signer ||
      !verifySignature(
        null,
        attestationSigningPayload(attestation),
        signer.publicKey,
        Buffer.from(attestation.signature, 'base64'),
      )
    ) {
      return invalidCanaryManifestSummary();
    }
  }
  return { manifestValid: true, boundaryDigest };
}

function safeJsonFile(path, policy, trustedSignerOwnerUid = 0) {
  if (typeof path !== 'string' || path === '') return null;
  const stat = lstatSync(path);
  const currentUid = typeof process.geteuid === 'function' ? process.geteuid() : -1;
  const ownerAllowed =
    policy === 'trusted-signers'
      ? stat.uid === trustedSignerOwnerUid
      : stat.uid === currentUid || stat.uid === 0 || stat.uid === 998;
  const modeAllowed =
    policy === 'trusted-signers' ? (stat.mode & 0o022) === 0 : (stat.mode & 0o077) === 0;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 2 ||
    stat.size > 32 * 1024 ||
    !ownerAllowed ||
    !modeAllowed
  ) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadTeamTaskLifecycleCanaryManifestSummary(
  manifestPath,
  trustedSignersPath,
  expectedBoundary,
  trustedSignerOwnerUid = 0,
) {
  try {
    const manifest = safeJsonFile(manifestPath, 'manifest');
    const trustedSigners = parseTrustedSigners(
      safeJsonFile(trustedSignersPath, 'trusted-signers', trustedSignerOwnerUid),
    );
    if (!manifest || !trustedSigners) return invalidCanaryManifestSummary();
    return summarizeCanaryManifest(manifest, trustedSigners, expectedBoundary);
  } catch {
    return invalidCanaryManifestSummary();
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function addCheck(checks, name, ok) {
  checks.push({ name, ok: ok === true });
}

function invalidQaReceipt() {
  return {
    qaReceiptValid: false,
    receiptKind: 'invalid',
    disabledPersonalProjects: false,
    disabledTeamProjects: false,
    disabledFilePath: false,
    enabledPersonalProjects: false,
    enabledTeamProjects: false,
    enabledFilePath: false,
    scenarioChecksPassed: 0,
    scenarioChecksExpected: QA_SCENARIO_NAMES.length,
  };
}

export function summarizeTeamTaskQaReceipt(receipt, options = {}) {
  if (!receipt || typeof receipt !== 'object') return invalidQaReceipt();
  const expectedRevision = String(options.expectedRevision ?? '');
  const completedAtMs = Date.parse(String(receipt.completedAt ?? ''));
  const nowMs = Number(options.nowMs);
  const expectedBoundaryDigest = String(options.expectedBoundaryDigest ?? '');
  const checkNames =
    receipt.checks && typeof receipt.checks === 'object' ? Object.keys(receipt.checks).sort() : [];
  const expectedNames = [...QA_SCENARIO_NAMES].sort();
  const fixedChecks =
    checkNames.length === expectedNames.length &&
    checkNames.every((name, index) => name === expectedNames[index]) &&
    expectedNames.every((name) => typeof receipt.checks[name] === 'boolean');
  const disabledSmoke = receipt.phaseOne?.disabled;
  const enabledSmoke = receipt.phaseOne?.enabled;
  const validSmoke = (value) =>
    exactKeys(value, ['filePath', 'personalProjects', 'teamProjects']) &&
    typeof value.personalProjects === 'boolean' &&
    typeof value.teamProjects === 'boolean' &&
    typeof value.filePath === 'boolean';
  const receiptKindValid =
    (receipt.receiptKind === 'prepare' &&
      enabledSmoke === null &&
      expectedNames.every((name) => receipt.checks[name] === false)) ||
    (receipt.receiptKind === 'run' && validSmoke(enabledSmoke));
  const qaReceiptValid =
    options.fileSecure === true &&
    receipt.schemaVersion === 1 &&
    receipt.source === QA_RECEIPT_SOURCE &&
    /^[0-9a-f]{40}$/.test(expectedRevision) &&
    receipt.revision === expectedRevision &&
    /^[0-9a-f]{64}$/.test(expectedBoundaryDigest) &&
    receipt.boundaryDigest === expectedBoundaryDigest &&
    Number.isFinite(completedAtMs) &&
    Number.isFinite(nowMs) &&
    completedAtMs <= nowMs &&
    completedAtMs >= nowMs - QA_RECEIPT_MAX_AGE_MS &&
    exactKeys(receipt.phaseOne, ['disabled', 'enabled']) &&
    validSmoke(disabledSmoke) &&
    receiptKindValid &&
    fixedChecks;
  if (!qaReceiptValid) return invalidQaReceipt();
  return {
    qaReceiptValid: true,
    receiptKind: receipt.receiptKind,
    disabledPersonalProjects: disabledSmoke.personalProjects,
    disabledTeamProjects: disabledSmoke.teamProjects,
    disabledFilePath: disabledSmoke.filePath,
    enabledPersonalProjects: enabledSmoke?.personalProjects === true,
    enabledTeamProjects: enabledSmoke?.teamProjects === true,
    enabledFilePath: enabledSmoke?.filePath === true,
    scenarioChecksPassed: QA_SCENARIO_NAMES.filter((name) => receipt.checks[name] === true).length,
    scenarioChecksExpected: QA_SCENARIO_NAMES.length,
  };
}

export function loadTeamTaskQaReceipt(
  receiptPath,
  expectedRevision,
  nowMs,
  expectedBoundaryDigest,
) {
  try {
    if (typeof receiptPath !== 'string' || receiptPath === '') return invalidQaReceipt();
    const stat = lstatSync(receiptPath);
    const currentUid = typeof process.geteuid === 'function' ? process.geteuid() : -1;
    const allowedOwner = stat.uid === currentUid || stat.uid === 0 || stat.uid === 998;
    const fileSecure =
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size <= 32 * 1024 &&
      allowedOwner &&
      (stat.mode & 0o077) === 0;
    if (!fileSecure) return invalidQaReceipt();
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    return summarizeTeamTaskQaReceipt(receipt, {
      expectedRevision,
      nowMs,
      fileSecure,
      expectedBoundaryDigest,
    });
  } catch {
    return invalidQaReceipt();
  }
}

/** Reduce runtime configuration to booleans and counts without retaining IDs or secrets. */
export function summarizeTeamTaskLifecycleEnvironment(environment) {
  const teamProjectsAllowlist = parseBoundedCsv(environment?.TEAM_PROJECTS_ALLOWLIST);
  const lifecycleAllowlist = parseBoundedCsv(environment?.TEAM_TASK_LIFECYCLE_ALLOWLIST);
  return {
    teamProjectsEnabled: enabled(environment?.TEAM_PROJECTS_ENABLED),
    teamProjectsAllowAll: teamProjectsAllowlist.allowAll,
    teamProjectsAllowlistCount: teamProjectsAllowlist.count,
    lifecycleEnabled: enabled(environment?.TEAM_TASK_LIFECYCLE_ENABLED),
    lifecycleAllowAll: lifecycleAllowlist.allowAll,
    lifecycleAllowlistCount: lifecycleAllowlist.count,
    allowlistsMatch:
      !teamProjectsAllowlist.allowAll &&
      !lifecycleAllowlist.allowAll &&
      equalSets(teamProjectsAllowlist.values, lifecycleAllowlist.values),
  };
}

/** Keep only the one expected PM2 process count and its operating-system UID. */
export function summarizeTeamTaskRuntime(pm2Rows, inspectProcess) {
  const processes = Array.isArray(pm2Rows)
    ? pm2Rows.filter(
        (row) =>
          row?.name === 'holaday-orchestrator' &&
          row?.pm2_env?.status === 'online' &&
          Number(row?.pid) > 0,
      )
    : [];
  const process = processes.length === 1 ? inspectProcess(Number(processes[0].pid)) : null;
  return {
    processCount: processes.length,
    uid: Number.isSafeInteger(process?.uid) ? process.uid : -1,
    observationWindowSeconds:
      processes.length === 1 && Number.isFinite(Number(processes[0]?.pm2_env?.pm_uptime))
        ? Math.max(0, Math.floor((Date.now() - Number(processes[0].pm2_env.pm_uptime)) / 1000))
        : -1,
  };
}

export function countTeamTaskRelevantErrors(logText) {
  if (typeof logText !== 'string') return -1;
  return logText.split(/\r?\n/).filter((line) => {
    const lifecycleLine =
      /team[_ -]?(?:task|work item)|teamTasks|team_work_item|0056_team_work_item_lifecycle/i.test(
        line,
      );
    const errorLine = /\b(?:error|fatal|uncaught|unhandled|ER_[A-Z_]+)\b/i.test(line);
    return lifecycleLine && errorLine;
  }).length;
}

function parseLogRecord(line) {
  const start = line.indexOf('{');
  if (start === -1) return null;
  try {
    const record = JSON.parse(line.slice(start));
    return record && typeof record === 'object' ? record : null;
  } catch {
    return null;
  }
}

function logTimestampMs(line, record) {
  const candidate = record?.time ?? record?.timestamp ?? record?.ts;
  const timestamp =
    typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string'
        ? Date.parse(candidate)
        : Number.NaN;
  if (Number.isFinite(timestamp)) return timestamp;
  const iso = line.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/)?.[0];
  return iso ? Date.parse(iso) : Number.NaN;
}

function lifecycleRequest(value) {
  return (
    typeof value === 'string' &&
    /(?:^|[/\s])teamTasks(?:[./?]|$)|team[_ -]?(?:tasks?|work[_ -]?items?)/i.test(value)
  );
}

export function summarizeTeamTaskObservationLogs(logText, options = {}) {
  const empty = {
    relevantErrorCount: -1,
    conflictCount: -1,
    latencySampleCount: -1,
    latencyP95Ms: -1,
    logCoverageComplete: false,
  };
  if (typeof logText !== 'string') return empty;
  const nowMs = Number(options.nowMs);
  const processStartedAtMs = Number(options.processStartedAtMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(processStartedAtMs)) return empty;

  const relevantRequestIds = new Set();
  const timestamps = [];
  const latencies = [];
  let conflictCount = 0;
  let relevantErrorCount = 0;
  const lines = logText.split(/\r?\n/);
  for (const line of lines) {
    const record = parseLogRecord(line);
    const timestamp = logTimestampMs(line, record);
    const withinCurrentProcess =
      Number.isFinite(timestamp) && timestamp >= processStartedAtMs && timestamp <= nowMs + 60_000;
    if (!withinCurrentProcess) continue;
    timestamps.push(timestamp);
    const requestId = String(record?.reqId ?? '');
    const requestUrl = record?.req?.url ?? record?.url ?? record?.route;
    if (requestId && lifecycleRequest(requestUrl)) relevantRequestIds.add(requestId);
    const relevant =
      lifecycleRequest(line) || lifecycleRequest(requestUrl) || relevantRequestIds.has(requestId);
    if (!relevant) continue;

    const statusCode = Number(record?.res?.statusCode ?? record?.statusCode);
    const recordCode = String(record?.code ?? record?.err?.code ?? record?.error?.code ?? '');
    const expectedRejection =
      [403, 404, 409].includes(statusCode) ||
      ['CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(recordCode);
    const structuredError =
      Number(record?.level) >= 50 ||
      (record && ('err' in record || 'error' in record)) ||
      /\b(?:error|fatal|uncaught|unhandled|ER_[A-Z_]+)\b/i.test(line);
    if (structuredError && !expectedRejection) relevantErrorCount += 1;
    if (statusCode === 409 || recordCode === 'CONFLICT' || /\bCONFLICT\b/.test(line)) {
      conflictCount += 1;
    }
    const latency = Number(record?.responseTime ?? record?.durationMs ?? record?.elapsedMs);
    if (Number.isFinite(latency) && latency >= 0) latencies.push(latency);
  }

  latencies.sort((left, right) => left - right);
  const latencyP95Ms =
    latencies.length > 0 ? Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]) : -1;
  const hasStartCoverage = timestamps.some(
    (timestamp) =>
      timestamp >= processStartedAtMs && timestamp <= processStartedAtMs + 5 * 60 * 1000,
  );
  const hasEndCoverage = timestamps.some(
    (timestamp) => timestamp >= nowMs - 5 * 60 * 1000 && timestamp <= nowMs + 60_000,
  );
  const logCoverageComplete = hasStartCoverage && hasEndCoverage;

  return {
    relevantErrorCount,
    conflictCount,
    latencySampleCount: latencies.length,
    latencyP95Ms,
    logCoverageComplete,
  };
}

async function countQuery(connection, sql, values = []) {
  const [rows] = await connection.query(sql, values);
  return safeCount(Number(rows?.[0]?.count));
}

export async function inspectTeamTaskLifecycleDatabase(input) {
  const lifecycleTableCount = await countQuery(
    input.connection,
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?)',
    [input.databaseName, LIFECYCLE_TABLES],
  );
  const lifecycleRowCount = await countQuery(
    input.connection,
    `SELECT ${LIFECYCLE_TABLES.map((table) => `(SELECT COUNT(*) FROM \`${table}\`)`).join(
      ' + ',
    )} AS count`,
  );
  const hasPrivateCanaryBoundary =
    input.userExternalIds.length > 0 && input.organizationExternalIds.length > 0;
  if (!hasPrivateCanaryBoundary) {
    return {
      migration0056ContractVerified:
        input.migration0056FilePresent === true &&
        lifecycleTableCount === LIFECYCLE_TABLE_COUNT &&
        input.schemaVerified === true,
      lifecycleTableCount,
      schemaVerified: input.schemaVerified === true,
      lifecycleRowCount,
      activeSyntheticUserCount: 0,
      effectiveCanaryUserCount: 0,
      enabledSyntheticOrganizationCount: 0,
      effectiveCanaryOrganizationCount: 0,
      nonSyntheticEnabledOrganizationCount: 0,
    };
  }

  const activeSyntheticUserCount = await countQuery(
    input.connection,
    "SELECT COUNT(DISTINCT id) AS count FROM users WHERE status = 'active' AND external_id IN (?)",
    [input.userExternalIds],
  );
  const enabledSyntheticOrganizationCount = await countQuery(
    input.connection,
    "SELECT COUNT(DISTINCT id) AS count FROM organizations WHERE status = 'active' AND team_projects_enabled = 1 AND external_id IN (?)",
    [input.organizationExternalIds],
  );
  const membershipSql = `FROM organizations o
    INNER JOIN organization_members om
      ON om.organization_id = o.id AND om.status = 'active'
    INNER JOIN users u
      ON u.id = om.user_id AND u.status = 'active'
    WHERE o.status = 'active'
      AND o.team_projects_enabled = 1
      AND u.external_id IN (?)`;
  const effectiveCanaryUserCount = await countQuery(
    input.connection,
    `SELECT COUNT(DISTINCT u.id) AS count ${membershipSql} AND o.external_id IN (?)`,
    [input.userExternalIds, input.organizationExternalIds],
  );
  const effectiveCanaryOrganizationCount = await countQuery(
    input.connection,
    `SELECT COUNT(DISTINCT o.id) AS count ${membershipSql} AND o.external_id IN (?)`,
    [input.userExternalIds, input.organizationExternalIds],
  );
  const nonSyntheticEnabledOrganizationCount = await countQuery(
    input.connection,
    `SELECT COUNT(DISTINCT o.id) AS count ${membershipSql} AND o.external_id NOT IN (?)`,
    [input.userExternalIds, input.organizationExternalIds],
  );
  return {
    migration0056ContractVerified:
      input.migration0056FilePresent === true &&
      lifecycleTableCount === LIFECYCLE_TABLE_COUNT &&
      input.schemaVerified === true,
    lifecycleTableCount,
    schemaVerified: input.schemaVerified === true,
    lifecycleRowCount,
    activeSyntheticUserCount,
    effectiveCanaryUserCount,
    enabledSyntheticOrganizationCount,
    effectiveCanaryOrganizationCount,
    nonSyntheticEnabledOrganizationCount,
  };
}

function configurationMatches(left, right) {
  return CONFIGURATION_KEYS.every(
    (key) => String(left?.[key] ?? '') === String(right?.[key] ?? ''),
  );
}

export async function collectTeamTaskLifecycleSnapshot(input) {
  const environment = summarizeTeamTaskLifecycleEnvironment(input.runtimeEnvironment);
  const runtime = summarizeTeamTaskRuntime(input.pm2Rows, input.inspectProcess);
  const onlineProcesses = Array.isArray(input.pm2Rows)
    ? input.pm2Rows.filter(
        (row) =>
          row?.name === 'holaday-orchestrator' &&
          row?.pm2_env?.status === 'online' &&
          Number(row?.pid) > 0,
      )
    : [];
  const processStartedAtMs =
    onlineProcesses.length === 1 ? Number(onlineProcesses[0]?.pm2_env?.pm_uptime) : Number.NaN;
  const observation = summarizeTeamTaskObservationLogs(input.relevantLogText, {
    processStartedAtMs,
    nowMs: input.nowMs ?? Date.now(),
  });
  const userExternalIds = parseExternalIdCsv(
    input.runtimeEnvironment?.TEAM_TASK_LIFECYCLE_ALLOWLIST,
    'usr',
  );
  const organizationExternalIds = parseExternalIdCsv(input.syntheticOrganizationAllowlist, 'org');
  const database = await input.inspectDatabase({ userExternalIds, organizationExternalIds });
  const qaReceipt = input.qaReceiptSummary ?? invalidQaReceipt();
  return {
    health: {
      holaday: input.health?.holaday === true,
      orangebench: input.health?.orangebench === true,
    },
    deployment: {
      revisionPresent: input.revision?.present === true,
      revisionMatchesExpected: input.revision?.matchesExpected === true,
    },
    database: {
      migration0056ContractVerified: database?.migration0056ContractVerified === true,
      lifecycleTableCount: safeCount(database?.lifecycleTableCount),
      schemaVerified: database?.schemaVerified === true,
      relevantErrorCount: observation.relevantErrorCount,
      lifecycleRowCount: safeCount(database?.lifecycleRowCount),
      logCoverageComplete: observation.logCoverageComplete,
      conflictCount: safeCount(observation.conflictCount),
      latencySampleCount: safeCount(observation.latencySampleCount),
      latencyP95Ms: safeCount(observation.latencyP95Ms),
    },
    orchestrator: {
      ...runtime,
      ...environment,
      configurationMatchesFile: configurationMatches(
        input.configuredEnvironment,
        input.runtimeEnvironment,
      ),
    },
    canary: {
      qaReceiptValid: qaReceipt.qaReceiptValid === true,
      receiptKind: qaReceipt.receiptKind,
      syntheticBoundaryConfirmed: input.syntheticBoundaryConfirmed === true,
      activeSyntheticUserCount: safeCount(database?.activeSyntheticUserCount),
      effectiveCanaryUserCount: safeCount(database?.effectiveCanaryUserCount),
      enabledSyntheticOrganizationCount: safeCount(database?.enabledSyntheticOrganizationCount),
      effectiveCanaryOrganizationCount: safeCount(database?.effectiveCanaryOrganizationCount),
      nonSyntheticEnabledOrganizationCount: safeCount(
        database?.nonSyntheticEnabledOrganizationCount,
      ),
      scenarioChecksPassed: safeCount(qaReceipt.scenarioChecksPassed),
      scenarioChecksExpected: safeCount(qaReceipt.scenarioChecksExpected),
    },
    smoke: {
      disabledPersonalProjects: qaReceipt.disabledPersonalProjects === true,
      disabledTeamProjects: qaReceipt.disabledTeamProjects === true,
      disabledFilePath: qaReceipt.disabledFilePath === true,
      enabledPersonalProjects: qaReceipt.enabledPersonalProjects === true,
      enabledTeamProjects: qaReceipt.enabledTeamProjects === true,
      enabledFilePath: qaReceipt.enabledFilePath === true,
    },
  };
}

export function evaluateTeamTaskLifecyclePreflight(mode, snapshot) {
  if (!MODES.has(mode)) {
    throw new Error(`Unsupported team task lifecycle rollout mode: ${mode}`);
  }

  const health = snapshot?.health ?? {};
  const deployment = snapshot?.deployment ?? {};
  const database = snapshot?.database ?? {};
  const orchestrator = snapshot?.orchestrator ?? {};
  const canary = snapshot?.canary ?? {};
  const smoke = snapshot?.smoke ?? {};
  const checks = [];

  addCheck(checks, 'public-health', health.holaday === true && health.orangebench === true);
  addCheck(
    checks,
    'deployed-revision',
    deployment.revisionPresent === true && deployment.revisionMatchesExpected === true,
  );
  addCheck(
    checks,
    'lifecycle-schema',
    database.migration0056ContractVerified === true &&
      database.schemaVerified === true &&
      database.lifecycleTableCount === LIFECYCLE_TABLE_COUNT,
  );
  addCheck(
    checks,
    'orchestrator-process',
    orchestrator.processCount === 1 && orchestrator.uid === 998,
  );
  addCheck(
    checks,
    'orchestrator-config-consistent',
    orchestrator.configurationMatchesFile === true,
  );
  addCheck(checks, 'phase-one-team-gate', orchestrator.teamProjectsEnabled === true);
  addCheck(checks, 'relevant-errors-zero', database.relevantErrorCount === 0);
  addCheck(
    checks,
    'phase-one-smoke',
    canary.qaReceiptValid === true &&
      canary.receiptKind ===
        (mode === 'canary-running' || mode === 'observe' ? 'run' : 'prepare') &&
      smoke.disabledPersonalProjects === true &&
      smoke.disabledTeamProjects === true &&
      smoke.disabledFilePath === true,
  );

  if (mode === 'dormant') {
    addCheck(checks, 'lifecycle-disabled', orchestrator.lifecycleEnabled === false);
  } else {
    if (mode === 'canary-ready') {
      addCheck(checks, 'lifecycle-disabled', orchestrator.lifecycleEnabled === false);
    }
    addCheck(
      checks,
      'bounded-user-allowlist',
      orchestrator.teamProjectsAllowAll === false &&
        orchestrator.teamProjectsAllowlistCount === CANARY_USER_COUNT &&
        orchestrator.lifecycleAllowAll === false &&
        orchestrator.lifecycleAllowlistCount === CANARY_USER_COUNT &&
        orchestrator.allowlistsMatch === true &&
        canary.syntheticBoundaryConfirmed === true &&
        canary.activeSyntheticUserCount === CANARY_USER_COUNT &&
        canary.effectiveCanaryUserCount === CANARY_USER_COUNT,
    );
    addCheck(
      checks,
      'synthetic-organization-boundary',
      canary.syntheticBoundaryConfirmed === true &&
        canary.enabledSyntheticOrganizationCount === CANARY_ORGANIZATION_COUNT &&
        canary.effectiveCanaryOrganizationCount === CANARY_ORGANIZATION_COUNT &&
        canary.nonSyntheticEnabledOrganizationCount === 0,
    );
    if (mode !== 'canary-ready') {
      addCheck(checks, 'lifecycle-enabled', orchestrator.lifecycleEnabled === true);
      addCheck(
        checks,
        'phase-one-enabled-smoke',
        smoke.enabledPersonalProjects === true &&
          smoke.enabledTeamProjects === true &&
          smoke.enabledFilePath === true,
      );
      addCheck(
        checks,
        'canary-scenario-matrix',
        canary.qaReceiptValid === true &&
          canary.scenarioChecksExpected === 13 &&
          canary.scenarioChecksPassed === 13,
      );
      if (mode === 'observe') {
        addCheck(checks, 'observation-window', orchestrator.observationWindowSeconds >= 86_400);
        addCheck(
          checks,
          'observation-telemetry',
          database.logCoverageComplete === true &&
            database.conflictCount >= 0 &&
            database.latencySampleCount > 0 &&
            database.latencyP95Ms >= 0,
        );
      }
    }
  }

  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    mode,
    ready: failedChecks.length === 0,
    checks,
    failedChecks,
    summary: {
      healthHoladay: health.holaday === true,
      healthOrangebench: health.orangebench === true,
      revisionMatch: deployment.revisionMatchesExpected === true,
      processCount: safeCount(orchestrator.processCount),
      uid: safeCount(orchestrator.uid),
      migration0056Contract: database.migration0056ContractVerified === true,
      lifecycleTables: safeCount(database.lifecycleTableCount),
      lifecycleEnabled: orchestrator.lifecycleEnabled === true,
      teamAllowAll: orchestrator.teamProjectsAllowAll === true,
      teamAllowlistCount: safeCount(orchestrator.teamProjectsAllowlistCount),
      allowlistsMatch: orchestrator.allowlistsMatch === true,
      allowAll: orchestrator.lifecycleAllowAll === true,
      allowlistCount: safeCount(orchestrator.lifecycleAllowlistCount),
      syntheticUsers: safeCount(canary.activeSyntheticUserCount),
      effectiveUsers: safeCount(canary.effectiveCanaryUserCount),
      syntheticOrganizations: safeCount(canary.enabledSyntheticOrganizationCount),
      effectiveOrganizations: safeCount(canary.effectiveCanaryOrganizationCount),
      nonSyntheticOrganizations: safeCount(canary.nonSyntheticEnabledOrganizationCount),
      lifecycleRows: safeCount(database.lifecycleRowCount),
      relevantErrors: safeCount(database.relevantErrorCount),
      observationSeconds: safeCount(orchestrator.observationWindowSeconds),
      logCoverage: database.logCoverageComplete === true,
      conflicts: safeCount(database.conflictCount),
      latencySamples: safeCount(database.latencySampleCount),
      latencyP95Ms: safeCount(database.latencyP95Ms),
      qaReceipt: canary.qaReceiptValid === true,
      disabledPersonalSmoke: smoke.disabledPersonalProjects === true,
      disabledTeamSmoke: smoke.disabledTeamProjects === true,
      disabledFileSmoke: smoke.disabledFilePath === true,
      enabledPersonalSmoke: smoke.enabledPersonalProjects === true,
      enabledTeamSmoke: smoke.enabledTeamProjects === true,
      enabledFileSmoke: smoke.enabledFilePath === true,
      scenarioChecksPassed: safeCount(canary.scenarioChecksPassed),
      scenarioChecksExpected: safeCount(canary.scenarioChecksExpected),
    },
  };
}

export function formatTeamTaskLifecyclePreflight(result) {
  const summary = result.summary;
  const failed = result.failedChecks.length === 0 ? 'none' : result.failedChecks.join(',');
  return [
    `TEAM_TASK_LIFECYCLE_PREFLIGHT mode=${result.mode}`,
    `status=${result.ready ? 'ready' : 'blocked'}`,
    `checks=${result.checks.length - result.failedChecks.length}/${result.checks.length}`,
    `failed=${failed}`,
    `healthHoladay=${summary.healthHoladay}`,
    `healthOrangebench=${summary.healthOrangebench}`,
    `revisionMatch=${summary.revisionMatch}`,
    `processCount=${summary.processCount}`,
    `uid=${summary.uid}`,
    `migration0056Contract=${summary.migration0056Contract}`,
    `lifecycleTables=${summary.lifecycleTables}`,
    `lifecycleEnabled=${summary.lifecycleEnabled}`,
    `teamAllowAll=${summary.teamAllowAll}`,
    `teamAllowlistCount=${summary.teamAllowlistCount}`,
    `allowlistsMatch=${summary.allowlistsMatch}`,
    `allowAll=${summary.allowAll}`,
    `allowlistCount=${summary.allowlistCount}`,
    `syntheticUsers=${summary.syntheticUsers}`,
    `effectiveUsers=${summary.effectiveUsers}`,
    `syntheticOrganizations=${summary.syntheticOrganizations}`,
    `effectiveOrganizations=${summary.effectiveOrganizations}`,
    `nonSyntheticOrganizations=${summary.nonSyntheticOrganizations}`,
    `lifecycleRows=${summary.lifecycleRows}`,
    `relevantErrors=${summary.relevantErrors}`,
    `observationSeconds=${summary.observationSeconds}`,
    `logCoverage=${summary.logCoverage}`,
    `conflicts=${summary.conflicts}`,
    `latencySamples=${summary.latencySamples}`,
    `latencyP95Ms=${summary.latencyP95Ms}`,
    `qaReceipt=${summary.qaReceipt}`,
    `disabledPersonalSmoke=${summary.disabledPersonalSmoke}`,
    `disabledTeamSmoke=${summary.disabledTeamSmoke}`,
    `disabledFileSmoke=${summary.disabledFileSmoke}`,
    `enabledPersonalSmoke=${summary.enabledPersonalSmoke}`,
    `enabledTeamSmoke=${summary.enabledTeamSmoke}`,
    `enabledFileSmoke=${summary.enabledFileSmoke}`,
    `scenarioChecks=${summary.scenarioChecksPassed}/${summary.scenarioChecksExpected}`,
  ].join(' ');
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function readPm2Rows() {
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) return [];
  try {
    const rows = JSON.parse(result.stdout || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function readProcessEnvironment(pid) {
  const environment = {};
  for (const entry of readFileSync(`/proc/${pid}/environ`).toString('utf8').split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0) environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

function inspectLinuxProcess(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
  return { uid: Number.isSafeInteger(uid) ? uid : -1 };
}

async function healthReady(url) {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === 'ok';
  } catch {
    return false;
  }
}

function commandSucceeded(command, args, options = {}) {
  return (
    spawnSync(command, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
      ...options,
    }).status === 0
  );
}

/**
 * The verifier needs the production database URL, but it must keep the
 * operator process PATH/HOME so the local pnpm binary and package cache remain
 * resolvable. Never forward the PM2 process environment wholesale.
 */
export function buildSchemaVerificationEnvironment(localEnvironment, runtimeEnvironment) {
  const environment = {};
  for (const key of ['PATH', 'HOME']) {
    if (typeof localEnvironment?.[key] === 'string' && localEnvironment[key].length > 0) {
      environment[key] = localEnvironment[key];
    }
  }
  environment.DATABASE_URL =
    typeof runtimeEnvironment?.DATABASE_URL === 'string' &&
    runtimeEnvironment.DATABASE_URL.length > 0
      ? runtimeEnvironment.DATABASE_URL
      : 'invalid://missing-runtime-database-url';
  return environment;
}

async function collectProductionSnapshot(environmentFile) {
  const configuredEnvironment = parseEnvironmentFile(readFileSync(environmentFile, 'utf8'));
  const pm2Rows = readPm2Rows();
  const processRows = pm2Rows.filter(
    (row) =>
      row?.name === 'holaday-orchestrator' &&
      row?.pm2_env?.status === 'online' &&
      Number(row?.pid) > 0,
  );
  const runtimeEnvironment =
    processRows.length === 1 ? readProcessEnvironment(Number(processRows[0].pid)) : {};
  const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
  });
  const revision = String(revisionResult.stdout ?? '').trim();
  const expectedRevision = String(process.env.TEAM_TASK_LIFECYCLE_EXPECTED_REVISION ?? '').trim();
  const schemaVerified = commandSucceeded(
    'pnpm',
    ['--filter', '@holaday/orchestrator', 'db:verify'],
    { env: buildSchemaVerificationEnvironment(process.env, runtimeEnvironment) },
  );
  const mysql = loadMysqlFromCwd(process.cwd());
  let connection;
  let databaseInspection = {
    migration0056ContractVerified: false,
    lifecycleTableCount: -1,
    schemaVerified: false,
    lifecycleRowCount: -1,
    activeSyntheticUserCount: -1,
    effectiveCanaryUserCount: -1,
    enabledSyntheticOrganizationCount: -1,
    effectiveCanaryOrganizationCount: -1,
    nonSyntheticEnabledOrganizationCount: -1,
  };
  try {
    connection = await mysql.createConnection({ uri: runtimeEnvironment.DATABASE_URL });
    const [[databaseRow]] = await connection.query('SELECT DATABASE() AS databaseName');
    const databaseName = String(databaseRow?.databaseName ?? '');
    databaseInspection = await inspectTeamTaskLifecycleDatabase({
      connection,
      databaseName,
      userExternalIds: parseExternalIdCsv(runtimeEnvironment.TEAM_TASK_LIFECYCLE_ALLOWLIST, 'usr'),
      organizationExternalIds: parseExternalIdCsv(
        process.env.TEAM_TASK_LIFECYCLE_SYNTHETIC_ORGANIZATION_ALLOWLIST,
        'org',
      ),
      migration0056FilePresent: existsSync(
        resolve(process.cwd(), 'apps/orchestrator/drizzle/0056_team_work_item_lifecycle.sql'),
      ),
      schemaVerified,
    });
  } catch {
    // The fail-closed sentinel counts above are safe to emit.
  } finally {
    await connection?.end().catch(() => undefined);
  }
  const logResult = spawnSync(
    'pm2',
    ['logs', 'holaday-orchestrator', '--lines', '20000', '--nostream'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const nowMs = Date.now();
  const userExternalIds = parseExternalIdCsv(
    runtimeEnvironment.TEAM_TASK_LIFECYCLE_ALLOWLIST,
    'usr',
  );
  const organizationExternalIds = parseExternalIdCsv(
    process.env.TEAM_TASK_LIFECYCLE_SYNTHETIC_ORGANIZATION_ALLOWLIST,
    'org',
  );
  const canaryManifestSummary = loadTeamTaskLifecycleCanaryManifestSummary(
    runtimeEnvironment.TEAM_TASK_LIFECYCLE_CANARY_MANIFEST_FILE,
    runtimeEnvironment.TEAM_TASK_LIFECYCLE_TRUSTED_SIGNERS_FILE,
    { userExternalIds, organizationExternalIds },
  );
  const qaReceiptSummary = loadTeamTaskQaReceipt(
    runtimeEnvironment.TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE,
    revision,
    nowMs,
    canaryManifestSummary.boundaryDigest,
  );
  return collectTeamTaskLifecycleSnapshot({
    runtimeEnvironment,
    configuredEnvironment,
    syntheticOrganizationAllowlist:
      process.env.TEAM_TASK_LIFECYCLE_SYNTHETIC_ORGANIZATION_ALLOWLIST ?? '',
    syntheticBoundaryConfirmed: canaryManifestSummary.manifestValid,
    pm2Rows,
    inspectProcess: inspectLinuxProcess,
    health: {
      holaday: await healthReady('https://holaday.ai/api/healthz'),
      orangebench: await healthReady('https://hd-app.orangebench.tech/api/healthz'),
    },
    revision: {
      present: /^[0-9a-f]{40}$/.test(revision),
      matchesExpected: /^[0-9a-f]{40}$/.test(revision) && revision === expectedRevision,
    },
    inspectDatabase: async () => databaseInspection,
    relevantLogText:
      logResult.status === 0 ? `${logResult.stdout ?? ''}\n${logResult.stderr ?? ''}` : null,
    qaReceiptSummary,
    nowMs,
  });
}

function isDirectExecution() {
  if (!process.argv[1] || process.argv[1] === '-') return true;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  try {
    if (typeof process.geteuid !== 'function' || process.geteuid() !== 0) {
      throw new Error('production preflight requires root');
    }
    const command = process.argv[2] ?? '';
    if (command === 'collect') {
      const environmentFile = process.argv[3] ?? 'apps/orchestrator/.env';
      console.log(JSON.stringify(await collectProductionSnapshot(environmentFile)));
    } else {
      const snapshot = JSON.parse(await readStdin());
      const result = evaluateTeamTaskLifecyclePreflight(command, snapshot);
      console.log(formatTeamTaskLifecyclePreflight(result));
      if (!result.ready) process.exitCode = 1;
    }
  } catch {
    console.error('TEAM_TASK_LIFECYCLE_PREFLIGHT status=error reason=invalid-safe-snapshot');
    process.exitCode = 1;
  }
}
