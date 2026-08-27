import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODES = new Set(['dormant', 'canary-ready', 'canary-running']);
const WORKER_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
const ORCHESTRATOR_CONFIG_KEYS = [
  'ACCOUNT_CLOSURE_ENABLED',
  'ACCOUNT_CLOSURE_WORKER_ENABLED',
  'ACCOUNT_CLOSURE_ALLOWLIST',
  'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED',
  'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED',
  'ACCOUNT_CLOSURE_HMAC_SECRET',
  'RESEND_API_KEY',
  'ALIYUN_SMS_URL',
  'INTERNAL_SHARED_SECRET',
];
const WORKER_CONFIG_KEYS = [...ORCHESTRATOR_CONFIG_KEYS];
const CN_PAYMENT_CONFIG_KEYS = [
  'ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED',
  'ALIYUN_ACCESS_KEY_ID',
  'ALIYUN_ACCESS_KEY_SECRET',
  'ALIYUN_SMS_SIGN_NAME',
  'ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE',
  'ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE',
  'INTERNAL_SHARED_SECRET',
];

function enabled(value) {
  return value === true || value === 'true';
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function countAllowlist(value) {
  if (typeof value !== 'string') return 0;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean).length;
}

export function environmentKeysMatch(left, right, keys) {
  return keys.every((key) => String(left?.[key] ?? '') === String(right?.[key] ?? ''));
}

/**
 * Reduce orchestrator environment values to presence, length, counts, and
 * booleans. Secret and identity values are deliberately not retained.
 */
export function summarizeOrchestratorEnvironment(
  env,
  { syntheticAllowlistConfirmed = false } = {},
) {
  const hmac =
    typeof env.ACCOUNT_CLOSURE_HMAC_SECRET === 'string'
      ? env.ACCOUNT_CLOSURE_HMAC_SECRET.trim()
      : '';
  return {
    accountClosureEnabled: enabled(env.ACCOUNT_CLOSURE_ENABLED),
    accountClosureWorkerEnabled: enabled(env.ACCOUNT_CLOSURE_WORKER_ENABLED),
    legacyFeedbackSanitized: enabled(env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED),
    legacyAnalyticsLogsSanitized: enabled(env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED),
    hmacPresent: hmac.length > 0,
    hmacLength: hmac.length,
    allowlistCount: countAllowlist(env.ACCOUNT_CLOSURE_ALLOWLIST),
    syntheticAllowlistConfirmed: syntheticAllowlistConfirmed === true,
    privateEmailReady: present(env.RESEND_API_KEY),
  };
}

/** Reduce CN-payment environment values without retaining credentials or template IDs. */
export function summarizeCnPaymentEnvironment(env) {
  return {
    accountClosureSmsEnabled: enabled(env.ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED),
    credentialsPresent: present(env.ALIYUN_ACCESS_KEY_ID) && present(env.ALIYUN_ACCESS_KEY_SECRET),
    signPresent: present(env.ALIYUN_SMS_SIGN_NAME),
    verifyTemplatePresent: present(env.ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE),
    completeTemplatePresent: present(env.ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE),
    internalSecretPresent: present(env.INTERNAL_SHARED_SECRET),
  };
}

export function parseEnvironmentFile(content) {
  const environment = {};
  for (const sourceLine of String(content).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error('invalid environment file');
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0];
      if (value.length < 2 || !value.endsWith(quote)) throw new Error('invalid environment file');
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\(n|r|t|\\|")/g, (_match, escaped) => {
          if (escaped === 'n') return '\n';
          if (escaped === 'r') return '\r';
          if (escaped === 't') return '\t';
          return escaped;
        });
      }
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    environment[key] = value;
  }
  return environment;
}

function smsGatewayConfigured(env) {
  if (
    !present(env.ALIYUN_SMS_URL) ||
    !present(env.INTERNAL_SHARED_SECRET) ||
    env.INTERNAL_SHARED_SECRET.trim().length < 16
  ) {
    return false;
  }
  try {
    const url = new URL(env.ALIYUN_SMS_URL);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export async function probeAuthenticatedSmsGateway(env, fetchImpl = fetch) {
  if (!smsGatewayConfigured(env)) return false;
  try {
    const baseUrl = env.ALIYUN_SMS_URL.replace(/\/+$/, '');
    const response = await fetchImpl(`${baseUrl}/api/internal/account-closure/health`, {
      method: 'GET',
      redirect: 'error',
      headers: { 'x-internal-secret': env.INTERNAL_SHARED_SECRET },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === 'ok' && body?.accountClosureSms === 'ready';
  } catch {
    return false;
  }
}

function onlineProcesses(pm2Rows, name) {
  if (!Array.isArray(pm2Rows)) return [];
  return pm2Rows.filter(
    (row) => row?.name === name && row?.pm2_env?.status === 'online' && Number(row?.pid) > 0,
  );
}

/**
 * Reduce PM2's environment-heavy process list to the runtime facts permitted
 * in an account-closure release record.
 */
export function summarizePm2Runtime(
  pm2Rows,
  { inspectProcess, listenerPids, discoveredWorkerPids = new Set(), expectedWorkerCwd },
) {
  const orchestrators = onlineProcesses(pm2Rows, 'holaday-orchestrator');
  const managedWorkers = onlineProcesses(pm2Rows, 'holaday-account-closure-worker');
  const managedWorkerPids = new Set(managedWorkers.map((row) => Number(row.pid)));
  if (!(discoveredWorkerPids instanceof Set)) throw new Error('worker process scan failed');
  const orchestratorProcess =
    orchestrators.length === 1 ? inspectProcess(orchestrators[0].pid) : null;
  const workerPid = discoveredWorkerPids.size === 1 ? [...discoveredWorkerPids][0] : null;
  const workerProcess = workerPid === null ? null : inspectProcess(workerPid);
  const workerManaged =
    managedWorkerPids.size === discoveredWorkerPids.size &&
    [...managedWorkerPids].every((pid) => discoveredWorkerPids.has(pid));
  return {
    processCount: orchestrators.length,
    uid: orchestratorProcess?.uid ?? -1,
    rssBytes: orchestratorProcess?.rssBytes ?? -1,
    workerCount: discoveredWorkerPids.size,
    workerUid: workerProcess?.uid ?? null,
    workerRssBytes: workerProcess?.rssBytes ?? 0,
    workerListenerCount:
      workerPid === null || !(listenerPids instanceof Set)
        ? workerPid === null
          ? 0
          : -1
        : Number(listenerPids.has(workerPid)),
    workerManaged,
    workerCwdExpected: workerProcess === null || workerProcess.cwd === expectedWorkerCwd,
  };
}

function inspectLinuxProcess(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const uidMatch = status.match(/^Uid:\s+(\d+)/m);
  const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  return {
    uid: uidMatch ? Number(uidMatch[1]) : -1,
    rssBytes: rssMatch ? Number(rssMatch[1]) * 1024 : -1,
    cwd: realpathSync(`/proc/${pid}/cwd`),
  };
}

function readProcessEnvironment(pid) {
  const environment = {};
  const entries = readFileSync(`/proc/${pid}/environ`).toString('utf8').split('\0');
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

export function isExpectedEntrypoint(cwd, args, expectedEntry) {
  let canonicalExpected;
  try {
    canonicalExpected = realpathSync(expectedEntry);
  } catch {
    return false;
  }
  return args.some((argument) => {
    if (typeof argument !== 'string' || argument === '' || argument.startsWith('-')) return false;
    const candidate = isAbsolute(argument) ? argument : resolve(cwd, argument);
    try {
      return realpathSync(candidate) === canonicalExpected;
    } catch {
      return false;
    }
  });
}

function discoverClosureWorkerPids(repoRoot) {
  const expectedCwd = realpathSync(`${repoRoot}/apps/orchestrator`);
  const expectedEntry = `${expectedCwd}/dist/account-closure/worker-entry.js`;
  const pids = new Set();
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const cwd = realpathSync(`/proc/${pid}/cwd`);
      const args = readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0');
      if (isExpectedEntrypoint(cwd, args, expectedEntry)) pids.add(pid);
    } catch {
      // The process may exit during the read-only scan; absence is handled by
      // the PM2/discovered PID reconciliation below.
    }
  }
  return pids;
}

function readListenerPids() {
  const pids = new Set();
  for (const args of [
    ['-H', '-ltnp'],
    ['-H', '-lunp'],
  ]) {
    const result = spawnSync('ss', args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.status !== 0) throw new Error('listener inspection failed');
    for (const match of result.stdout.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
  }
  return pids;
}

function readPm2Rows() {
  const result = spawnSync('pm2', ['jlist'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('PM2 inspection failed');
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows)) throw new Error('PM2 inspection failed');
  return rows;
}

export function loadMysqlFromCwd(cwd) {
  const requireFromCwd = createRequire(`${realpathSync(cwd)}/apps/orchestrator/package.json`);
  return requireFromCwd('mysql2/promise');
}

function readConfiguredEnvironment(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('invalid environment file path');
  }
  return parseEnvironmentFile(readFileSync(path, 'utf8'));
}

async function inspectProductionDatabase(env) {
  const unavailable = { verified: false, closureTableCount: -1, queueTotal: -1 };
  if (!present(env.DATABASE_URL)) return unavailable;

  const verify = spawnSync('pnpm', ['--filter', '@holaday/orchestrator', 'db:verify'], {
    stdio: 'ignore',
    timeout: 120_000,
  });
  const verified = verify.status === 0;
  let connection;
  try {
    const mysql = loadMysqlFromCwd(process.cwd());
    connection = await mysql.createConnection({ uri: env.DATABASE_URL });
    const [[databaseRow]] = await connection.query('SELECT DATABASE() AS db');
    const database = databaseRow?.db;
    if (!database) return unavailable;
    const tableNames = [
      'account_closure_requests',
      'account_closure_steps',
      'account_closure_effects',
      'account_closure_challenges',
      'account_closure_receipts',
    ];
    const [[tableRow]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = ? AND table_name IN (?)`,
      [database, tableNames],
    );
    const [[queueRow]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM account_closure_requests
          WHERE status IN ('pending_grace', 'processing', 'needs_attention')) +
        (SELECT COUNT(*) FROM account_closure_steps
          WHERE status IN ('pending', 'running', 'retryable', 'blocked')) +
        (SELECT COUNT(*) FROM account_closure_challenges
          WHERE used_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)) AS total`,
    );
    return {
      verified,
      closureTableCount: Number(tableRow?.count ?? -1),
      queueTotal: Number(queueRow?.total ?? -1),
    };
  } catch {
    return unavailable;
  } finally {
    await connection?.end().catch(() => undefined);
  }
}

async function collectOrchestratorSnapshot(environmentFile) {
  const configuredEnvironment = readConfiguredEnvironment(environmentFile);
  const pm2Rows = readPm2Rows();
  const orchestrators = onlineProcesses(pm2Rows, 'holaday-orchestrator');
  const runtimeEnvironment =
    orchestrators.length === 1 ? readProcessEnvironment(orchestrators[0].pid) : {};
  const discoveredWorkerPids = discoverClosureWorkerPids(process.cwd());
  const environment = summarizeOrchestratorEnvironment(runtimeEnvironment);
  const runtime = summarizePm2Runtime(pm2Rows, {
    inspectProcess: inspectLinuxProcess,
    listenerPids: readListenerPids(),
    discoveredWorkerPids,
    expectedWorkerCwd: realpathSync(`${process.cwd()}/apps/orchestrator`),
  });
  let workerConfigurationMatchesOrchestrator = discoveredWorkerPids.size === 0;
  if (discoveredWorkerPids.size === 1 && orchestrators.length === 1) {
    const workerEnvironment = readProcessEnvironment([...discoveredWorkerPids][0]);
    workerConfigurationMatchesOrchestrator = environmentKeysMatch(
      runtimeEnvironment,
      workerEnvironment,
      WORKER_CONFIG_KEYS,
    );
  }
  const database = await inspectProductionDatabase(runtimeEnvironment);
  const gatewayConfigured = smsGatewayConfigured(runtimeEnvironment);
  const gatewayReady = await probeAuthenticatedSmsGateway(runtimeEnvironment);
  return {
    orchestrator: {
      ...environment,
      ...runtime,
      configurationMatchesFile:
        orchestrators.length === 1 &&
        environmentKeysMatch(configuredEnvironment, runtimeEnvironment, ORCHESTRATOR_CONFIG_KEYS),
      workerConfigurationMatchesOrchestrator,
      smsGatewayConfigured: gatewayConfigured,
      smsGatewayReady: gatewayReady,
    },
    database,
  };
}

function collectCnPaymentSnapshot(environmentFile) {
  const configuredEnvironment = readConfiguredEnvironment(environmentFile);
  const pm2Rows = readPm2Rows();
  const processes = onlineProcesses(pm2Rows, 'holaday-cn-payment');
  const runtimeEnvironment = processes.length === 1 ? readProcessEnvironment(processes[0].pid) : {};
  return {
    cnPayment: {
      ...summarizeCnPaymentEnvironment(runtimeEnvironment),
      processCount: processes.length,
      configurationMatchesFile:
        processes.length === 1 &&
        environmentKeysMatch(configuredEnvironment, runtimeEnvironment, CN_PAYMENT_CONFIG_KEYS),
    },
  };
}

function safeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : -1;
}

function addCheck(checks, name, ok) {
  checks.push({ name, ok: ok === true });
}

export function evaluateAccountClosureRollout(mode, snapshot) {
  if (!MODES.has(mode)) {
    throw new Error(`Unsupported account closure rollout mode: ${mode}`);
  }

  const health = snapshot?.health ?? {};
  const database = snapshot?.database ?? {};
  const orchestrator = snapshot?.orchestrator ?? {};
  const cnPayment = snapshot?.cnPayment ?? {};
  const checks = [];

  addCheck(checks, 'public-health', health.holaday === true && health.orangebench === true);
  addCheck(
    checks,
    'database-schema',
    database.verified === true && database.closureTableCount === 5,
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

  if (mode === 'dormant') {
    addCheck(
      checks,
      'dormant-flags-disabled',
      orchestrator.accountClosureEnabled === false &&
        orchestrator.accountClosureWorkerEnabled === false &&
        orchestrator.legacyFeedbackSanitized === false &&
        orchestrator.legacyAnalyticsLogsSanitized === false,
    );
    addCheck(checks, 'worker-absent', orchestrator.workerCount === 0);
    addCheck(checks, 'queue-empty', database.queueTotal === 0);
  } else {
    addCheck(
      checks,
      'sanitation-prerequisites',
      orchestrator.legacyFeedbackSanitized === true &&
        orchestrator.legacyAnalyticsLogsSanitized === true,
    );
    addCheck(
      checks,
      'hmac-secret-length',
      orchestrator.hmacPresent === true && safeNumber(orchestrator.hmacLength) >= 32,
    );
    addCheck(
      checks,
      'single-synthetic-allowlist',
      orchestrator.allowlistCount === 1 && orchestrator.syntheticAllowlistConfirmed === true,
    );
    addCheck(checks, 'private-email-ready', orchestrator.privateEmailReady === true);
    addCheck(
      checks,
      'closure-sms-ready',
      cnPayment.processCount === 1 &&
        cnPayment.configurationMatchesFile === true &&
        cnPayment.accountClosureSmsEnabled === true &&
        cnPayment.credentialsPresent === true &&
        cnPayment.signPresent === true &&
        cnPayment.verifyTemplatePresent === true &&
        cnPayment.completeTemplatePresent === true &&
        cnPayment.internalSecretPresent === true &&
        orchestrator.smsGatewayConfigured === true &&
        orchestrator.smsGatewayReady === true,
    );

    if (mode === 'canary-ready') {
      addCheck(
        checks,
        'feature-flags-disabled',
        orchestrator.accountClosureEnabled === false &&
          orchestrator.accountClosureWorkerEnabled === false,
      );
      addCheck(checks, 'worker-absent', orchestrator.workerCount === 0);
      addCheck(checks, 'queue-empty', database.queueTotal === 0);
    } else {
      addCheck(
        checks,
        'feature-flags-enabled',
        orchestrator.accountClosureEnabled === true &&
          orchestrator.accountClosureWorkerEnabled === true,
      );
      addCheck(checks, 'single-worker', orchestrator.workerCount === 1);
      addCheck(checks, 'worker-managed', orchestrator.workerManaged === true);
      addCheck(checks, 'worker-cwd', orchestrator.workerCwdExpected === true);
      addCheck(
        checks,
        'worker-config-consistent',
        orchestrator.workerConfigurationMatchesOrchestrator === true,
      );
      addCheck(checks, 'worker-uid', orchestrator.workerUid === 998);
      addCheck(
        checks,
        'worker-memory-ceiling',
        safeNumber(orchestrator.workerRssBytes) >= 0 &&
          orchestrator.workerRssBytes < WORKER_MEMORY_LIMIT_BYTES,
      );
      addCheck(checks, 'worker-portless', orchestrator.workerListenerCount === 0);
      addCheck(checks, 'queue-empty', database.queueTotal === 0);
    }
  }

  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    mode,
    ready: failedChecks.length === 0,
    checks,
    failedChecks,
    summary: {
      hmacPresent: orchestrator.hmacPresent === true,
      hmacLength: safeNumber(orchestrator.hmacLength),
      allowlistCount: safeNumber(orchestrator.allowlistCount),
      workerCount: safeNumber(orchestrator.workerCount),
      workerRssMiB:
        safeNumber(orchestrator.workerRssBytes) < 0
          ? -1
          : Math.floor(orchestrator.workerRssBytes / (1024 * 1024)),
      queueTotal: safeNumber(database.queueTotal),
    },
  };
}

export function formatAccountClosureRolloutResult(result) {
  const failed = result.failedChecks.length === 0 ? 'none' : result.failedChecks.join(',');
  const status = result.ready ? 'ready' : 'blocked';
  const hmac = result.summary.hmacPresent ? 'present' : 'absent';
  return [
    `ACCOUNT_CLOSURE_PREFLIGHT mode=${result.mode}`,
    `status=${status}`,
    `checks=${result.checks.length - result.failedChecks.length}/${result.checks.length}`,
    `failed=${failed}`,
    `hmac=${hmac}`,
    `hmacLength=${result.summary.hmacLength}`,
    `allowlistCount=${result.summary.allowlistCount}`,
    `workerCount=${result.summary.workerCount}`,
    `workerRssMiB=${result.summary.workerRssMiB}`,
    `queueTotal=${result.summary.queueTotal}`,
  ].join(' ');
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function evaluateMain() {
  try {
    const mode = process.argv[2] ?? '';
    const snapshot = JSON.parse(await readStdin());
    if (snapshot?.orchestrator) {
      snapshot.orchestrator.syntheticAllowlistConfirmed = enabled(
        process.env.ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED,
      );
    }
    const result = evaluateAccountClosureRollout(mode, snapshot);
    console.log(formatAccountClosureRolloutResult(result));
    if (!result.ready) process.exitCode = 1;
  } catch {
    console.error('ACCOUNT_CLOSURE_PREFLIGHT status=error reason=invalid-safe-snapshot');
    process.exitCode = 1;
  }
}

async function collectorMain(command) {
  try {
    const environmentFile = process.argv[3] ?? '';
    if (command === 'collect-orchestrator') {
      console.log(JSON.stringify(await collectOrchestratorSnapshot(environmentFile)));
      return;
    }
    if (command === 'collect-cn-payment') {
      console.log(JSON.stringify(collectCnPaymentSnapshot(environmentFile)));
      return;
    }
    throw new Error('unsupported collector');
  } catch {
    console.error('ACCOUNT_CLOSURE_PREFLIGHT status=error reason=remote-read-failed');
    process.exitCode = 1;
  }
}

function isDirectExecution() {
  if (!process.argv[1] || process.argv[1] === '-') return true;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const directExecution = isDirectExecution();
if (directExecution) {
  const command = process.argv[2] ?? '';
  if (command === 'collect-orchestrator' || command === 'collect-cn-payment') {
    await collectorMain(command);
  } else {
    await evaluateMain();
  }
}
