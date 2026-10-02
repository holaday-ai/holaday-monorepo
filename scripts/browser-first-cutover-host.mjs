import { createHash, randomUUID } from 'node:crypto';
import { constants, writeSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  ingressDiagnosticError,
  ingressDiagnosticStage,
} from './browser-first-cutover-ingress-diagnostics.mjs';
import { probeFirstCutoverRecoveredBrowser } from './browser-first-cutover-browser-probe.mjs';
import {
  collectCutoverEvidence,
  cutoverExactNavigationDeferral,
  cutoverWorkScopeReady,
  compareCutoverCloudBrowserRecoveryConfig,
  compareCutoverCloudVncRecoveryConfig,
  cutoverCloudStopConfigDigest,
  cutoverLegacyInterruptionRisk,
  cutoverRegistrationConfigDigest,
  readCutoverDatabaseScope,
  readCutoverHostSnapshot,
  validateReviewedLegacyLoggerPatch,
  readCutoverWorkScope,
  validateFirstCutoverCloudSources,
} from './browser-cutover-evidence.mjs';
import { backupAndRestoreCheck, encryptMysqlAgeBackup } from './browser-first-cutover-backup.mjs';
import {
  applyCutoverFence,
  restoreCutoverIngress,
  verifyCutoverFence,
} from './browser-first-cutover-fence.mjs';
import { createCutoverIngressFiles } from './browser-first-cutover-ingress-files.mjs';
import {
  classifyFirstCutoverHostPair,
  classifyFirstCutoverRetirementPair,
  firstCutoverCloudStopScope,
  validateFirstCutoverOwnedDisplayObservation,
} from './browser-first-cutover-inventory.mjs';
import {
  readCutoverMysqlSessionOwners,
  readCutoverMysqlSnapshot,
  readCutoverMysqlWriters,
} from './browser-first-cutover-mysql.mjs';
import {
  captureLegacyRuntime,
  firstCutoverCloudBrowserRecoveryLaunch,
  firstCutoverCloudVncRecoveryMaterial,
  readFirstCutoverCloudRecovery,
  reobserveFirstCutoverCloudRecovery,
  restoreFirstCutoverCloudBrowser,
  restoreFirstCutoverCloudVnc,
  initializeFirstMaintenanceState,
  prepareFirstCutoverCloudBrowserPolicy,
  readFirstCutoverCloudBrowserRecovery,
  readFirstCutoverCloudManagers,
  readFirstCutoverCloudOwnedDisplay,
  readFirstCutoverCloudOldBrowserAssociations,
  readFirstCutoverCloudRecoveryCensus,
  readFirstCutoverCloudRecoverySources,
  readFirstCutoverCloudRecoveryVacancy,
  retireLegacyRuntime,
  validateLegacyWorkBoundary,
  validateOwnedLegacyFence,
} from './browser-first-cutover-runtime.mjs';
import { persistCandidateStartupEntries } from './browser-first-cutover-startup.mjs';
import {
  candidatePreparationSystem,
  maintenanceCandidateEnvironment,
  parseMaintenanceCandidateConfig,
  stageReleaseCandidate,
} from './browser-maintenance-host.mjs';

import { readFirstCutoverCloudNativePreflight } from './browser-first-cutover-native-preflight.mjs';

const system = {
  ...fs,
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
};
const directory = '/var/lib/holaday-deploy/maintenance';
const approvalPath = `${directory}/first-cutover-approved.json`;
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;
const fields = [
  'schemaVersion',
  'kind',
  'attempt',
  'branch',
  'candidate',
  'configDigest',
  'migrationDigest',
  'inventoryDigest',
  'legacyDigest',
  'maintenanceEndsAtMs',
  'reconcileByMs',
  'operatorRef',
];
const privateFile = (stat) =>
  stat.isFile() && stat.uid === 0 && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1;
const privateDirectory = (stat) =>
  stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o7777) === 0o700;

// Closed coordinator/site/transition module set, including their session
// clients. Remote tools and native helpers have separate protected identities;
// importing this bundle is not readiness evidence or cutover authorization.
const coordinatorModules = [
  'browser-backup-age.mjs',
  'browser-cutover-evidence.mjs',
  'browser-first-cutover-backup.mjs',
  'browser-first-cutover-fence.mjs',
  'browser-first-cutover-gateway-session.mjs',
  'browser-first-cutover-host.mjs',
  'browser-first-cutover-ingress-diagnostics.mjs',
  'browser-first-cutover-ingress-files.mjs',
  'browser-first-cutover-ingress-session.mjs',
  'browser-first-cutover-inventory.mjs',
  'browser-first-cutover-mysql.mjs',
  'browser-first-cutover-native-preflight.mjs',
  'browser-first-cutover-native-preflight.py',
  'browser-first-cutover-nginx.mjs',
  'browser-first-cutover-payments.mjs',
  'browser-first-cutover-production-facts.mjs',
  'browser-first-cutover-browser-probe.mjs',
  'browser-first-cutover-recovery-session.mjs',
  'browser-first-cutover-registrations.mjs',
  'browser-first-cutover-runtime.mjs',
  'browser-first-cutover-site.mjs',
  'browser-first-cutover-startup.mjs',
  'browser-first-cutover-transition.mjs',
  'browser-maintenance-host.mjs',
  'browser-maintenance-journal.mjs',
  'browser-maintenance-linux.mjs',
  'browser-maintenance-manifest.mjs',
  'browser-maintenance-policy.mjs',
  'browser-maintenance-release-tail.mjs',
  'browser-maintenance-runtime-system.mjs',
  'browser-maintenance-runtime.mjs',
  'browser-maintenance-transition.mjs',
  'browser-payment-port-fence.mjs',
];

/** Own fixed-entry Linux identity, pinned to protected approval and actual Git
 * candidate bytes. The trusted site holds this handle; no caller-provided PID
 * or receipt is accepted by the command entry. Any failed read ends its lifetime.
 */
export async function createFirstCutoverCoordinatorIdentity(input, overrides = {}) {
  const io = {
    fs,
    platform: process.platform,
    uid: process.getuid?.(),
    pid: process.pid,
    entry: fileURLToPath(import.meta.url),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    exec: candidatePreparationSystem().exec,
    ...overrides,
  };
  let closed = false;
  let initial;
  let originalApproval;
  let lastTime = -1;
  const reject = () => {
    throw new Error('CUTOVER_COORDINATOR_UNPROVEN');
  };
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const read = async () => {
    try {
      if (
        closed ||
        io.platform !== 'linux' ||
        io.uid !== 0 ||
        !input ||
        Object.keys(input).length !== 2 ||
        !uuid(input.attempt) ||
        !['check', 'execute', 'diagnose-prepare'].includes(input.mode) ||
        !Number.isSafeInteger(io.pid) ||
        io.pid <= 1
      )
        reject();
      const late = originalApproval && io.now() >= originalApproval.maintenanceEndsAtMs;
      let reconciliationRecord;
      if (late) {
        if (typeof io.readReconciliationJournal !== 'function') reject();
        reconciliationRecord = await assertFirstCutoverReconciliationRead(
          {
            binding: Object.fromEntries(
              ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map(
                (k) => [k, originalApproval[k]],
              ),
            ),
            ...originalApproval,
          },
          await io.readReconciliationJournal(),
          io.now(),
        );
      }
      const approval = await (late
        ? (io.readReconciliationApproval ?? readFirstCutoverReconciliationApproval)
        : io.readApproval)({ attempt: input.attempt });
      const identityDeadline = late ? approval.reconcileByMs : approval.maintenanceEndsAtMs;
      const now = io.now();
      if (
        (originalApproval && !isDeepStrictEqual(originalApproval, approval)) ||
        approval.attempt !== input.attempt ||
        !/^[a-f0-9]{40}$/.test(approval.candidate ?? '') ||
        !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(approval.branch ?? '') ||
        !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) =>
          /^[a-f0-9]{64}$/.test(approval[k] ?? ''),
        ) ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < lastTime ||
        !Number.isSafeInteger(approval.maintenanceEndsAtMs) ||
        now >= identityDeadline
      )
        reject();
      const folder = `/var/lib/holaday-deploy/first-cutover/${approval.candidate}`;
      const entry = `${folder}/browser-first-cutover-host.mjs`;
      if (io.entry !== entry) reject();
      const dir = await io.fs.lstat(folder);
      if (!privateDirectory(dir) || (await io.fs.realpath(folder)) !== folder) reject();
      const readPrivate = async (path) => {
        const handle = await io.fs.open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const a = await handle.stat();
          if (!privateFile(a) || a.size < 1 || a.size > 1024 * 1024) reject();
          const bytes = await handle.readFile();
          const b = await handle.stat();
          const c = await io.fs.lstat(path);
          if (
            ![b, c].every(
              (s) =>
                privateFile(s) &&
                sameFile(a, s) &&
                s.size === a.size &&
                s.mtimeMs === a.mtimeMs &&
                s.ctimeMs === a.ctimeMs,
            ) ||
            bytes.length !== a.size
          )
            reject();
          return bytes;
        } finally {
          await handle.close();
        }
      };
      const manifestBytes = await readPrivate(`${folder}/bundle.json`);
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      if (
        !isDeepStrictEqual(Object.keys(manifest).sort(), ['candidate', 'files', 'schemaVersion']) ||
        manifest.schemaVersion !== 1 ||
        manifest.candidate !== approval.candidate ||
        !isDeepStrictEqual(Object.keys(manifest.files).sort(), [...coordinatorModules].sort()) ||
        !isDeepStrictEqual(
          (await io.fs.readdir(folder)).sort(),
          [...coordinatorModules, 'bundle.json'].sort(),
        )
      )
        reject();
      const git = ['--no-replace-objects', '-C', '/opt/holaday-monorepo'];
      await io.exec('git', [
        ...git,
        'merge-base',
        '--is-ancestor',
        approval.candidate,
        `refs/remotes/origin/${approval.branch}`,
      ]);
      for (const name of coordinatorModules) {
        const bytes = await readPrivate(`${folder}/${name}`);
        const source = await io.exec('git', [
          ...git,
          'show',
          `${approval.candidate}:scripts/${name}`,
        ]);
        if (sha(bytes) !== manifest.files[name] || !bytes.equals(Buffer.from(source))) reject();
      }
      // Existing port-fence adapter reads this fixed module-relative resource.
      const policyRoot = '/var/lib/holaday-deploy/first-cutover/ops';
      for (const path of [policyRoot, `${policyRoot}/aliyun-edge`])
        if (!privateDirectory(await io.fs.lstat(path)) || (await io.fs.realpath(path)) !== path)
          reject();
      const policy = await readPrivate(`${policyRoot}/aliyun-edge/holaday-payment-ingress.nft`);
      if (
        sha(policy) !== 'de27f46f3bdad7d0c239c18a44e2775ef5c27e936d1a859f3f81d8fb8ee1cdb2' ||
        !policy.equals(
          Buffer.from(
            await io.exec('git', [
              ...git,
              'show',
              `${approval.candidate}:ops/aliyun-edge/holaday-payment-ingress.nft`,
            ]),
          ),
        )
      )
        reject();
      const currentDir = await io.fs.lstat(folder);
      if (
        !privateDirectory(currentDir) ||
        !sameFile(dir, currentDir) ||
        (await io.fs.realpath(folder)) !== folder ||
        !manifestBytes.equals(await readPrivate(`${folder}/bundle.json`))
      )
        reject();
      const processIdentity = async () => {
        const root = `/proc/${io.pid}`;
        const stat = await io.fs.readFile(`${root}/stat`, 'utf8');
        if (!stat.startsWith(`${io.pid} (`)) reject();
        const fields = stat
          .slice(stat.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/);
        const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m
          .exec(await io.fs.readFile(`${root}/status`, 'utf8'))
          ?.slice(1)
          .map(Number);
        const cmdline = await io.fs.readFile(`${root}/cmdline`);
        const bootId = (await io.fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
        const process = {
          pid: io.pid,
          ppid: Number(fields[1]),
          start: fields[19],
          uids,
          cwd: await io.fs.readlink(`${root}/cwd`),
          exe: await io.fs.readlink(`${root}/exe`),
          argvDigest: sha(cmdline),
          cgroup: await io.fs.readFile(`${root}/cgroup`, 'utf8'),
        };
        if (
          fields[0] === 'Z' ||
          !Number.isSafeInteger(process.ppid) ||
          process.ppid < 1 ||
          !/^[0-9]+$/.test(process.start ?? '') ||
          !isDeepStrictEqual(uids, [0, 0, 0, 0]) ||
          process.cwd !== '/' ||
          process.exe !== '/opt/node22/bin/node' ||
          !Buffer.from(
            `/opt/node22/bin/node\0${entry}\0--${input.mode}\0${input.attempt}\0`,
          ).equals(cmdline) ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId) ||
          !process.cgroup ||
          process.cgroup.length > 65536
        )
          reject();
        return { bootId, process };
      };
      const self = await processIdentity();
      if (
        !isDeepStrictEqual(self, await processIdentity()) ||
        !isDeepStrictEqual(
          approval,
          await (late
            ? (io.readReconciliationApproval ?? readFirstCutoverReconciliationApproval)
            : io.readApproval)({ attempt: input.attempt }),
        ) ||
        io.now() < now ||
        io.now() >= identityDeadline
      )
        reject();
      const finished = io.now();
      if (
        closed ||
        !Number.isSafeInteger(finished) ||
        finished < now ||
        finished >= identityDeadline
      )
        reject();
      if (
        late &&
        !isDeepStrictEqual(
          reconciliationRecord,
          await assertFirstCutoverReconciliationRead(
            {
              binding: Object.fromEntries(
                ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map(
                  (k) => [k, approval[k]],
                ),
              ),
              ...approval,
            },
            await io.readReconciliationJournal(),
            io.now(),
          ),
        )
      )
        reject();
      const result = {
        host: 'vultr',
        role: 'coordinator',
        binding: Object.fromEntries(
          ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map(
            (k) => [k, approval[k]],
          ),
        ),
        toolDigest: sha(manifestBytes),
        ...self,
      };
      if (initial && !isDeepStrictEqual(initial, result)) reject();
      initial ??= result;
      originalApproval ??= structuredClone(approval);
      lastTime = finished;
      return structuredClone(result);
    } catch {
      closed = true;
      reject();
    }
  };
  await read();
  return {
    readExecutionIdentity: read,
    close: () => {
      closed = true;
    },
  };
}

/** Diagnostic identities only: no command, environment or source text. */
export function summarizeLegacySourceUnknowns(rows) {
  if (!Array.isArray(rows)) return [];
  const kinds = [
    'invalid-process-review',
    'listener',
    'listener-owner',
    'manager-root',
    'missing-registration',
    'missing-source',
    'preserved-writer',
    'process',
    'registration',
    'retirement',
    'source',
    'unapproved-port',
  ];
  return rows.slice(0, 256).flatMap((row) => {
    const own = (key) => Object.getOwnPropertyDescriptor(row ?? {}, key)?.value;
    const host = own('host'),
      kind = own('kind'),
      id = own('id'),
      keySha256 = own('keySha256');
    if (!['aliyun', 'vultr'].includes(host) || !kinds.includes(kind)) return [];
    if (Number.isSafeInteger(id) && id >= 0) return [{ host, kind, id }];
    if (typeof keySha256 === 'string' && /^[a-f0-9]{64}$/.test(keySha256))
      return [{ host, kind, keySha256 }];
    return typeof id === 'string'
      ? [{ host, kind, keySha256: createHash('sha256').update(id).digest('hex') }]
      : [];
  });
}

/** Runs the original read-only prefix, with a non-overridable journal barrier.
 * A successful diagnosis means only that preparation reached this barrier. */
export async function diagnoseFirstCutoverPreparation(options, site, overrides = {}) {
  const report = {
    kind: 'first-cutover-preparation-diagnostic',
    attempt: options.attempt,
    observationOnly: true,
    releaseAcceptance: false,
    journalAcquisitions: 0,
    stageCalls: 0,
    serviceEffects: 0,
    barrierReached: false,
    steps: [],
  };
  const original = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    ...site,
    ...overrides,
  };
  const code = (error) => {
    const value = Object.getOwnPropertyDescriptor(error ?? {}, 'message')?.value;
    return typeof value === 'string' && /^(?:CUTOVER|MAINTENANCE)_[A-Z_]+$/.test(value)
      ? value
      : 'CUTOVER_PREPARATION_DIAGNOSTIC_UNPROVEN';
  };
  const trace = async (stage, fn) => {
    const row = { stage };
    report.steps.push(row);
    try {
      const value = await fn();
      row.passed = true;
      return value;
    } catch (error) {
      row.passed = false;
      row.code = code(error);
      const cause = Object.getOwnPropertyDescriptor(error ?? {}, 'cause')?.value;
      const step = Object.getOwnPropertyDescriptor(cause ?? {}, 'legacySourceStage')?.value;
      if (
        [
          'REVIEW',
          'IDENTITY_BEFORE',
          'PAIR',
          'IDENTITY_AFTER',
          'EXECUTION',
          'SOURCE',
          'PATCH',
          'CLASSIFY',
          'UNREVIEWED',
          'DIGEST',
        ].includes(step)
      )
        row.legacySourceStage = step;
      const unknowns = Object.getOwnPropertyDescriptor(cause ?? {}, 'legacySourceUnknowns')?.value;
      if (Array.isArray(unknowns)) row.unknownLaunchers = summarizeLegacySourceUnknowns(unknowns);
      const ingress = ingressDiagnosticStage(error);
      if (ingress) row.cause = ingress;
      throw error;
    }
  };
  const io = {
    ...original,
    readApproval: (...args) => trace('APPROVAL', () => original.readApproval(...args)),
    inspectLegacySource: (...args) =>
      trace('LEGACY_SOURCE', () => original.inspectLegacySource(...args)),
    readConfig: (...args) => trace('CONFIG', () => original.readConfig(...args)),
    parseConfig: (...args) => {
      const row = { stage: 'CONFIG_PARSE' };
      report.steps.push(row);
      try {
        const value = original.parseConfig(...args);
        row.passed = true;
        return value;
      } catch (error) {
        row.passed = false;
        row.code = code(error);
        throw error;
      }
    },
    exec: (command, args, settings) =>
      trace('USER', async () => {
        if (
          command !== 'id' ||
          !['-u', '-g'].includes(args?.[0]) ||
          args?.[1] !== 'holaday' ||
          args.length !== 2
        )
          throw new Error('CUTOVER_PREPARATION_DIAGNOSTIC_UNPROVEN');
        return original.exec(command, args, settings);
      }),
    targetAbsent: (...args) => trace('TARGET_ABSENT', () => original.targetAbsent(...args)),
    onPreparationFailure: (stage, error) => {
      report.failedPreparationStage = stage;
      report.failedPreparationCode = code(error);
    },
    journal: async () => {
      report.barrierReached = true;
      throw new Error('CUTOVER_PREPARATION_READONLY_BARRIER');
    },
  };
  try {
    const approval = await io.readApproval(options);
    report.candidate = approval.candidate;
    const adapter = createFirstCutoverHostAdapter(options, io);
    await trace('PREFLIGHT', () => adapter.preflight(approval.candidate));
    await prepareFirstCutoverCandidate(options, io);
    throw new Error('CUTOVER_PREPARATION_DIAGNOSTIC_UNPROVEN');
  } catch (error) {
    report.code = code(error);
    report.preparationPrefixPassed =
      report.barrierReached && report.code === 'CUTOVER_PREPARATION_READONLY_BARRIER';
  }
  return report;
}

/** Public failure details are fixed protocol codes/actions only. */
export function firstCutoverExecutionFailureFields(result) {
  const fields = {};
  for (const key of ['code', 'action']) {
    const value = Object.getOwnPropertyDescriptor(result ?? {}, key)?.value;
    if (
      key === 'code' &&
      typeof value === 'string' &&
      /^(?:CUTOVER|MAINTENANCE)_[A-Z_]+$/.test(value)
    )
      fields.code = value;
    if (key === 'action' && ['abort_without_mutation', 'hold_maintenance'].includes(value))
      fields.action = value;
  }
  return fields;
}

// Check inspects source identity only. Execute uses the same protected binding,
// original site, journal lock, independent observations and absolute deadlines.
async function runFirstCutoverCoordinatorCli() {
  try {
    const [mode, attempt, ...extra] = process.argv.slice(2);
    if (
      extra.length ||
      !uuid(attempt) ||
      !['--check', '--execute', '--diagnose-prepare'].includes(mode)
    )
      throw new Error('CUTOVER_COORDINATOR_USAGE');
    let executionJournal;
    const handle = await createFirstCutoverCoordinatorIdentity(
      { mode: mode.slice(2), attempt },
      {
        readReconciliationJournal: async () => {
          if (!executionJournal) throw new Error('CUTOVER_COORDINATOR_UNPROVEN');
          return executionJournal;
        },
      },
    );
    try {
      const value = await handle.readExecutionIdentity();
      if (mode === '--check') {
        process.stdout.write(
          `${JSON.stringify({ kind: 'coordinator-source-inspection', candidate: value.binding.candidate, toolDigest: value.toolDigest, releaseReady: false })}\n`,
        );
      } else {
        const approval = await readFirstCutoverApproval({ attempt });
        const { createFirstCutoverExecutionSite } = await import(
          './browser-first-cutover-site.mjs'
        );
        const { performFirstCutover } = await import('./browser-first-cutover-transition.mjs');
        const site = createFirstCutoverExecutionSite(
          { attempt },
          {
            readCoordinatorIdentity: () => handle.readExecutionIdentity(),
            bindCoordinatorJournal: (journal) => {
              if (executionJournal && executionJournal !== journal)
                throw new Error('CUTOVER_COORDINATOR_UNPROVEN');
              executionJournal = journal;
            },
          },
        );
        if (mode === '--diagnose-prepare') {
          const diagnostic = await diagnoseFirstCutoverPreparation({ attempt }, site);
          process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
          if (!diagnostic.preparationPrefixPassed) process.exitCode = 1;
          return;
        }
        const adapter = createFirstCutoverHostAdapter({ attempt }, site);
        const result = await performFirstCutover({
          candidate: value.binding.candidate,
          adapter,
          window: approval,
        });
        await adapter.finish(result);
        process.stdout.write(
          `${JSON.stringify({ kind: 'first-cutover-execution-result', candidate: value.binding.candidate, attempt, ok: result.ok === true, phase: result.phase, ...firstCutoverExecutionFailureFields(result) })}\n`,
        );
        if (!result.ok) process.exitCode = 1;
      }
    } finally {
      handle.close();
    }
  } catch (error) {
    process.stderr.write(
      `${/^CUTOVER_COORDINATOR_[A-Z_]+$/.test(error.message) ? error.message : 'CUTOVER_COORDINATOR_UNPROVEN'}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Finish module evaluation before the site imports this host back.
  void runFirstCutoverCoordinatorCli();
}

/** Real read-only transport for the two reviewed deployment hosts. Linux root
 * uses the dedicated Vultr channel and a local observer; the Mac audit path
 * retains existing administrator SSH/askpass. Raw snapshots contain private
 * configuration: return them to the trusted caller, never log them. No host
 * classification, approval, readiness, lock, remote file or service mutation is
 * implied. Both reads settle before return, including a failed pair; no retry.
 */
export async function readFirstCutoverHostPair(overrides = {}) {
  const io = {
    now: Date.now,
    randomUUID,
    readObserverSource: () =>
      fs.readFile(new URL('./browser-cutover-evidence.mjs', import.meta.url)),
    exec: candidatePreparationSystem().exec,
    transport:
      process.platform === 'linux' && process.getuid?.() === 0 ? 'root-channel' : 'administrator',
    platform: process.platform,
    uid: process.getuid?.(),
    ...overrides,
  };
  try {
    if (
      !['administrator', 'root-channel'].includes(io.transport) ||
      (io.transport === 'root-channel' && (io.platform !== 'linux' || io.uid !== 0))
    )
      throw new Error('transport');
    const rootChannel = io.transport === 'root-channel';
    const began = io.now();
    const requestUuid = io.randomUUID();
    if (!uuid(requestUuid)) throw new Error('request');
    const requestId = rootChannel ? requestUuid.replaceAll('-', '') : requestUuid;
    const source = Buffer.from(await io.readObserverSource());
    if (
      !Number.isSafeInteger(began) ||
      began < 0 ||
      source.length < 1 ||
      source.length > 1024 * 1024 ||
      !Buffer.from(source.toString('utf8')).equals(source)
    )
      throw new Error('input');
    const sourceDigest = createHash('sha256').update(source).digest('hex');
    const common = [
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ForwardAgent=no',
      '-o',
      'ClearAllForwardings=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=10',
      '-o',
      'ServerAliveCountMax=2',
      '-T',
    ];
    const requests = rootChannel
      ? [
          {
            host: 'aliyun',
            command: '/usr/bin/ssh',
            channel: true,
            args: [
              '-F',
              '/dev/null',
              ...common,
              '-o',
              'BatchMode=yes',
              '-o',
              'IdentitiesOnly=yes',
              '-o',
              'IdentityAgent=none',
              '-o',
              'PreferredAuthentications=publickey',
              '-o',
              'PasswordAuthentication=no',
              '-o',
              'KbdInteractiveAuthentication=no',
              '-o',
              'UserKnownHostsFile=/var/lib/holaday-deploy/channel/known_hosts',
              '-o',
              'GlobalKnownHostsFile=/dev/null',
              '-o',
              'HostKeyAlgorithms=ssh-ed25519',
              '-i',
              '/var/lib/holaday-deploy/channel/identity',
              'root@47.99.169.186',
              `holaday-cutover-v1 observe ${requestId}`,
            ],
          },
          {
            host: 'vultr',
            command: '/opt/node22/bin/node',
            args: ['--input-type=module'],
          },
        ]
      : [
          {
            host: 'aliyun',
            args: [...common, 'root@47.99.169.186', '/usr/bin/node --input-type=module'],
          },
          {
            host: 'vultr',
            args: [
              ...common,
              '-o',
              'ProxyCommand=ssh -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ConnectTimeout=15 -W %h:%p root@47.99.169.186',
              'root@207.148.70.106',
              '/opt/node22/bin/node --input-type=module',
            ],
          },
        ];
    const read = async ({ host, args, command = 'ssh', channel = false }) => {
      // This self-contained, existing collector is sent only through stdin; no
      // arbitrary operation/target parameter or remote installation is accepted.
      const envelope = { protocol: 1, requestId, host, sourceDigest };
      const input = `${source.toString('utf8')}\ntry {
  process.env.GIT_OPTIONAL_LOCKS = '0';
  const readSource = async () => ${JSON.stringify(host)} === 'vultr' ? readReviewedLegacyCheckout() : {sourceCandidate:null};
  const sourceProof = await readSource();
  const {sourceCandidate} = sourceProof;
  const snapshot = await readCutoverHostSnapshot();
  if (sourceCandidate === legacyCapability.sourceCandidate) {
    snapshot.legacyCapability = await readCutoverLegacyCapability({ sourceCandidate });
  }
  snapshot.observer = snapshot.processes.find(row => row.pid === process.pid);
  if (!snapshot.observer || !isDeepStrictEqual(await readSource(), sourceProof)) throw new Error('observer');
  process.stdout.write(JSON.stringify({...${JSON.stringify(envelope)}, sourceCandidate, ...(sourceProof.reviewedPatch ? {reviewedPatch:sourceProof.reviewedPatch} : {}), snapshot}));
} catch {
  process.stderr.write('CUTOVER_HOST_PAIR_UNPROVEN\\n'); process.exitCode = 1;
}\n`;
      const output = await io.exec(command, args, {
        ...(channel ? {} : { input }),
        shell: false,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (typeof output !== 'string' || Buffer.byteLength(output) > 16 * 1024 * 1024)
        throw new Error('output');
      const result = JSON.parse(output);
      if (
        !Object.entries(envelope).every(([key, value]) => result?.[key] === value) ||
        (host === 'vultr'
          ? !/^[a-f0-9]{40}$/.test(result.sourceCandidate ?? '')
          : result.sourceCandidate !== null)
      )
        throw new Error('response');
      validateReviewedLegacyLoggerPatch(result.reviewedPatch, result.sourceCandidate);
      return {
        host,
        ...(result.reviewedPatch ? { reviewedPatch: result.reviewedPatch } : {}),
        sourceCandidate: result.sourceCandidate,
        snapshot: result.snapshot,
      };
    };
    const results = [];
    if (rootChannel) {
      // The local collector follows descendants of this coordinator. Finish
      // the transient observe SSH first so it cannot appear/disappear midway
      // through that snapshot. Still settle both reads once, never retry.
      for (const request of requests) results.push(...(await Promise.allSettled([read(request)])));
    } else {
      results.push(...(await Promise.allSettled(requests.map(read))));
    }
    if (results.some((result) => result.status !== 'fulfilled')) throw new Error('transport');
    const hosts = results.map((result) => result.value);
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < began) throw new Error('clock');
    for (const { snapshot } of hosts) {
      if (
        !Number.isSafeInteger(snapshot?.observedAtMs) ||
        snapshot.observedAtMs < 0 ||
        snapshot.observedAtMs > now ||
        now - snapshot.observedAtMs > 60000 ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(snapshot.bootId ?? '') ||
        !Number.isSafeInteger(snapshot.observer?.pid) ||
        snapshot.observer.pid <= 1 ||
        !Array.isArray(snapshot.processes) ||
        snapshot.processes.filter((p) => p.pid === snapshot.observer.pid).length !== 1 ||
        !isDeepStrictEqual(
          snapshot.processes.find((p) => p.pid === snapshot.observer.pid),
          snapshot.observer,
        )
      )
        throw new Error('snapshot');
    }
    return {
      sourceDigest,
      sourceCandidate: hosts.find(({ host }) => host === 'vultr').sourceCandidate,
      ...(hosts.find(({ host }) => host === 'vultr').reviewedPatch
        ? { reviewedPatch: hosts.find(({ host }) => host === 'vultr').reviewedPatch }
        : {}),
      observedAtMs: Math.min(...hosts.map(({ snapshot }) => snapshot.observedAtMs)),
      hosts,
    };
  } catch {
    // Do not expose process/config contents or SSH diagnostics to public output.
    throw new Error('CUTOVER_HOST_PAIR_UNPROVEN');
  }
}

/** Source proof for prepareFirstCutoverCandidate's existing inspectLegacySource
 * boundary. Reviews must come from the protected site inventory: this function
 * never creates or approves them. A fresh two-host read must match every review.
 * Hash physical identities and reviewed source fingerprints, not transient
 * observation time or the collector process. No raw environment leaves here.
 */
export async function readReviewedFirstCutoverLegacySource(input, overrides = {}) {
  const io = {
    readPair: readFirstCutoverHostPair,
    readExecutionIdentities: async () => [],
    now: Date.now,
    ...overrides,
  };
  let legacySourceStage = 'REVIEW';
  let legacySourceUnknowns;
  try {
    const { reviews, inventoryDigest, binding } = structuredClone(input);
    if (
      !/^[a-f0-9]{64}$/.test(inventoryDigest ?? '') ||
      !reviews ||
      Object.keys(reviews).length !== 2 ||
      !reviews.aliyun ||
      !reviews.vultr
    )
      throw new Error('review');
    const began = io.now();
    legacySourceStage = 'IDENTITY_BEFORE';
    const execution = structuredClone(await io.readExecutionIdentities());
    legacySourceStage = 'PAIR';
    const pair = await io.readPair();
    legacySourceStage = 'EXECUTION';
    if (
      !Array.isArray(execution) ||
      !isDeepStrictEqual(
        execution,
        await (async () => {
          legacySourceStage = 'IDENTITY_AFTER';
          const value = await io.readExecutionIdentities();
          legacySourceStage = 'EXECUTION';
          return value;
        })(),
      ) ||
      execution.some((receipt) => !binding || !isDeepStrictEqual(receipt.binding, binding)) ||
      (execution.length &&
        (Object.keys(binding).length !== 5 ||
          !uuid(binding.attempt) ||
          !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
          !/^[a-f0-9]{64}$/.test(binding.configDigest ?? '') ||
          !/^[a-f0-9]{64}$/.test(binding.migrationDigest ?? '') ||
          binding.inventoryDigest !== inventoryDigest))
    )
      throw new Error('execution');
    legacySourceStage = 'SOURCE';
    const now = io.now();
    if (
      !Number.isSafeInteger(began) ||
      began < 0 ||
      !Number.isSafeInteger(now) ||
      now < began ||
      !/^[a-f0-9]{40}$/.test(pair?.sourceCandidate ?? '') ||
      pair.hosts?.find((h) => h.host === 'vultr')?.sourceCandidate !== pair.sourceCandidate ||
      pair.hosts?.find((h) => h.host === 'aliyun')?.sourceCandidate !== null
    )
      throw new Error('source');
    legacySourceStage = 'PATCH';
    validateReviewedLegacyLoggerPatch(pair.reviewedPatch, pair.sourceCandidate);
    if (
      !isDeepStrictEqual(
        pair.reviewedPatch,
        pair.hosts.find((h) => h.host === 'vultr')?.reviewedPatch,
      ) ||
      pair.hosts.find((h) => h.host === 'aliyun')?.reviewedPatch !== undefined
    )
      throw new Error('patch');
    legacySourceStage = 'CLASSIFY';
    const actual = classifyFirstCutoverHostPair(
      { pair, reviews, inventoryDigest, execution },
      { now: () => now },
    );
    legacySourceStage = 'UNREVIEWED';
    if (actual.unknownLaunchers.length) {
      legacySourceUnknowns = summarizeLegacySourceUnknowns(actual.unknownLaunchers);
      throw new Error('unreviewed');
    }
    legacySourceStage = 'DIGEST';
    const byNumber = (key) => (a, b) => a[key] - b[key];
    const canonical = (value) =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
            )
          : value;
    const scope = (s) => ({
      host: s.host,
      bootId: s.bootId,
      ports: [...s.ports].sort((a, b) => a - b),
      processes: [...s.processes].sort(byNumber('pid')),
      managers: [...s.managers].sort(byNumber('pmId')),
      listeners: [...s.listeners].sort((a, b) => a.port - b.port || a.pid - b.pid),
    });
    const physical = actual.hosts.map((host) => ({
      host: host.host,
      registered: scope(host.registered),
      unmanaged: scope(host.unmanaged),
      preservedProcesses: [...host.preservedProcesses].sort(byNumber('pid')),
      preservedManagers: [...host.preservedManagers].sort(byNumber('pmId')),
      sources: host.sources,
    }));
    const legacyDigest = createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            inventoryDigest,
            sourceCandidate: pair.sourceCandidate,
            collectorDigest: pair.sourceDigest,
            ...(pair.reviewedPatch ? { reviewedPatch: pair.reviewedPatch } : {}),
            hosts: physical,
          }),
        ),
      )
      .digest('hex');
    return {
      sourceCandidate: pair.sourceCandidate,
      legacyDigest,
      ...(pair.reviewedPatch ? { reviewedPatch: pair.reviewedPatch } : {}),
      observedAtMs: actual.observedAtMs,
    };
  } catch {
    throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN', {
      cause: Object.freeze({
        legacySourceStage,
        ...(legacySourceUnknowns ? { legacySourceUnknowns } : {}),
      }),
    });
  }
}

/** Read the candidate's real control socket as the application user, bracketing
 * the existing full local runtime observer. Read-only and fixed argv only. */
export async function readFirstCutoverCandidateRuntime(identity, overrides = {}) {
  const io = { ...candidatePreparationSystem(), ...overrides };
  const fail = () => {
    throw new Error('CUTOVER_CANDIDATE_OBSERVATION_UNPROVEN');
  };
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !identity ||
      Object.keys(identity).length !== 2 ||
      !/^[a-f0-9]{40}$/.test(identity.candidate ?? '') ||
      !/^[a-f0-9]{32}$/.test(identity.bootId ?? '')
    )
      fail();
    const root = `/opt/holaday-releases/${identity.candidate}`;
    const read = async () => {
      const status = JSON.parse(
        await io.exec(
          'runuser',
          [
            '-u',
            'holaday',
            '--',
            '/opt/node22/bin/node',
            `${root}/scripts/browser-maintenance-control.mjs`,
            'status',
            identity.candidate,
            identity.bootId,
          ],
          {
            cwd: `${root}/apps/orchestrator`,
            env: {
              PATH: '/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
              PM2_HOME: '/root/.pm2',
            },
          },
        ),
      );
      if (
        status.protocol !== 1 ||
        !isDeepStrictEqual(status.identity, identity) ||
        !['closed', 'serving'].includes(status.mode) ||
        typeof status.idle !== 'boolean' ||
        typeof status.needsReconciliation !== 'boolean'
      )
        fail();
      return {
        identity: status.identity,
        mode: status.mode,
        idle: status.idle,
        needsReconciliation: status.needsReconciliation,
      };
    };
    const before = await read();
    const runtime = await io.observe(identity);
    if (
      !isDeepStrictEqual(before, await read()) ||
      !isDeepStrictEqual(runtime.identity, identity) ||
      runtime.root !== root
    )
      fail();
    return { ...before, runtime };
  } catch {
    fail();
  }
}

/** Resume only the selected worker and persist candidate entries through the
 * original atomic editor. Caller supplies the same live two-host observer; no
 * global save, restart, recovery of an unknown start or old worker reuse. */
export async function resumeFirstCutoverCandidateWorker(
  context,
  identity,
  approvedFiles,
  overrides = {},
) {
  const bindingKeys = [
    'attempt',
    'candidate',
    'configDigest',
    'migrationDigest',
    'inventoryDigest',
  ];
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readCandidate: readFirstCutoverCandidateRuntime,
    persistStartup: persistCandidateStartupEntries,
    ...overrides,
  };
  const fail = () => {
    throw new Error('CUTOVER_CANDIDATE_WORKER_UNPROVEN');
  };
  try {
    const { binding, root, applicationGid } = context;
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      typeof io.assertNoLegacy !== 'function' ||
      root !== `/opt/holaday-releases/${binding?.candidate}` ||
      identity?.candidate !== binding.candidate ||
      !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '') ||
      !Number.isSafeInteger(applicationGid) ||
      applicationGid < 1
    )
      fail();
    let last = -1;
    const guard = async () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < last ||
        now < 0 ||
        now >= context.approval.maintenanceEndsAtMs ||
        !Number.isSafeInteger(context.approval.maintenanceEndsAtMs) ||
        !bindingKeys.every((k) => context.approval[k] === binding[k]) ||
        !isDeepStrictEqual(await context.journal.assertOwnership(), binding)
      )
        fail();
      last = now;
      const record = await context.journal.readFirstCutoverEffects();
      if (
        record.phase !== 'verified' ||
        !isDeepStrictEqual(record.identity, identity) ||
        !bindingKeys.every((k) => record[k] === binding[k])
      )
        fail();
      const config = await io.readConfig();
      if (createHash('sha256').update(config).digest('hex') !== binding.configDigest) fail();
      return { record, config };
    };
    const initial = await guard();
    if (initial.record.candidateStartupEvents?.length) fail();
    const parsed = io.parseConfig(initial.config, root);
    const enabled = parsed.ACCOUNT_CLOSURE_WORKER_ENABLED === 'true';
    const env = maintenanceCandidateEnvironment(parsed, binding.candidate);
    const read = async (starting = false) => {
      await guard();
      let actual;
      try {
        actual = await io.readCandidate(identity);
      } catch (error) {
        // PM2 acknowledges the shell before its preflight execs the Node entry.
        // Poll read-only observations after this one acknowledged start only;
        // never repeat start or accept an unproven runtime for persistence.
        if (!starting || error?.message !== 'CUTOVER_CANDIDATE_OBSERVATION_UNPROVEN') throw error;
        await guard();
        return null;
      }
      if (
        !isDeepStrictEqual(actual.identity, identity) ||
        actual.mode !== 'serving' ||
        actual.idle !== false ||
        actual.needsReconciliation !== true ||
        !isDeepStrictEqual(actual.runtime?.identity, identity) ||
        actual.runtime.root !== root
      )
        fail();
      await guard();
      return actual.runtime;
    };
    await io.assertNoLegacy(identity);
    const before = await read();
    if (!before.main || before.worker !== null) fail();
    if (enabled) {
      await guard();
      await io.exec(
        'pm2',
        [
          'start',
          `${root}/scripts/start-account-closure-worker-production.sh`,
          '--name',
          'holaday-account-closure-worker',
          '--interpreter',
          '/usr/bin/bash',
          '--cwd',
          `${root}/apps/orchestrator`,
          '--uid',
          '998',
          '--gid',
          String(applicationGid),
          '--no-autorestart',
        ],
        { cwd: root, env },
      );
      await guard();
    }
    let runtime;
    const deadline = Math.min(io.now() + 60000, context.approval.maintenanceEndsAtMs);
    for (;;) {
      runtime = await read(enabled);
      if (io.now() >= deadline) fail();
      if (runtime) {
        if (!isDeepStrictEqual(runtime.main, before.main)) fail();
        if (Boolean(runtime.worker) === enabled) break;
      }
      await io.sleep(100);
    }
    const wanted = ['holaday-orchestrator', ...(enabled ? ['holaday-account-closure-worker'] : [])];
    const registrations = async () => {
      const observed = await read();
      if (!isDeepStrictEqual(observed, runtime)) fail();
      const output = await io.exec('pm2', ['jlist'], { cwd: root, env });
      if (typeof output !== 'string' || Buffer.byteLength(output) > 16 * 1024 * 1024) fail();
      const list = JSON.parse(output);
      if (!Array.isArray(list)) fail();
      const rows = wanted.map((name, i) => {
        const matches = list.filter((r) => r.name === name);
        if (
          matches.length !== 1 ||
          matches[0].pid !== (i ? runtime.worker : runtime.main).pid ||
          !matches[0].pm2_env
        )
          fail();
        return matches[0].pm2_env;
      });
      if (!isDeepStrictEqual(await read(), runtime)) fail();
      return { rows, output };
    };
    await io.assertNoLegacy(identity);
    const { output } = await registrations();
    await io.exec('/opt/node22/bin/node', [`${root}/scripts/secure-pm2-logs.mjs`, ...wanted], {
      cwd: root,
      env,
      input: output,
    });
    const effects = (await guard()).record;
    const backed = effects.startupEvents.filter(
      (e) => e.host === 'vultr' && e.phase === 'startup-backed-up',
    );
    if (!Array.isArray(approvedFiles) || approvedFiles.length !== 2 || backed.length > 1) fail();
    const files = approvedFiles.map((f, i) => {
      if (f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}`) fail();
      const change = backed[0]?.files[i];
      if (change && (change.path !== f.path || change.beforeDigest !== f.digest)) fail();
      if (!change && f.remove?.length) fail();
      return {
        path: f.path,
        digest: change ? change.afterDigest : f.digest,
        remove: [],
      };
    });
    await io.persistStartup(
      {
        binding: {
          attempt: binding.attempt,
          inventoryDigest: binding.inventoryDigest,
        },
        identity,
        applicationGid,
        workerEnabled: enabled,
        files,
        maintenanceEndsAtMs: context.approval.maintenanceEndsAtMs,
      },
      {
        fs: io.startupFs,
        platform: io.platform,
        uid: io.uid,
        now: io.now,
        assertOwnership: async () => {
          await guard();
          return {
            attempt: binding.attempt,
            inventoryDigest: binding.inventoryDigest,
          };
        },
        assertCandidate: async () => (await registrations()).rows,
        persist: (event) => context.journal.recordCandidateStartupEvent(event),
      },
    );
    await guard();
    await io.assertNoLegacy(identity);
  } catch {
    fail();
  }
}

/** Failure observation uses only the held journal and the original fixed status
 * command. It remains available after either deadline; it never opens, retries
 * close, settles work, changes ingress, clears dirty state or releases the lock.
 */
export async function recordFirstCutoverFailure(context, result, overrides = {}) {
  const io = { ...candidatePreparationSystem(), now: Date.now, ...overrides };
  const fail = () => {
    throw new Error('CUTOVER_HOLD_UNPROVEN');
  };
  try {
    const { binding, approval, journal, root } = context;
    const keys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      root !== `/opt/holaday-releases/${binding?.candidate}` ||
      !keys.every((k) => binding[k] === approval[k]) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(approval.operatorRef ?? '') ||
      !Number.isSafeInteger(approval.reconcileByMs)
    )
      fail();
    const before = io.now();
    const guard = async () => {
      if (
        !Number.isSafeInteger(before) ||
        before < 0 ||
        !Number.isSafeInteger(io.now()) ||
        io.now() < before ||
        !isDeepStrictEqual(await journal.assertOwnership(), binding)
      )
        fail();
      const record = await journal.readFirstCutoverEffects();
      if (!keys.every((k) => record[k] === binding[k]) || record.failureObservation) fail();
      return record;
    };
    const record = await guard();
    const identity = result.identity;
    if (
      identity &&
      (!isDeepStrictEqual(Object.keys(identity).sort(), ['bootId', 'candidate']) ||
        identity.candidate !== binding.candidate ||
        !/^[a-f0-9]{32}$/.test(identity.bootId ?? '') ||
        identity.bootId === record.bootstrapSeed ||
        (record.identity && !isDeepStrictEqual(identity, record.identity)))
    )
      fail();
    let status = {
      mode:
        !identity &&
        !['candidate_started', 'verified', 'opened', 'reconciled'].includes(record.phase)
          ? 'not-started'
          : 'unknown',
      closeAcknowledged: false,
    };
    if (identity) {
      try {
        const output = await io.exec(
          'runuser',
          [
            '-u',
            'holaday',
            '--',
            '/opt/node22/bin/node',
            `${root}/scripts/browser-maintenance-control.mjs`,
            'status',
            identity.candidate,
            identity.bootId,
          ],
          {
            cwd: `${root}/apps/orchestrator`,
            env: {
              PATH: '/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
              PM2_HOME: '/root/.pm2',
            },
          },
        );
        if (typeof output !== 'string' || Buffer.byteLength(output) > 8192) fail();
        const actual = JSON.parse(output);
        const c = actual.counts;
        if (
          actual.protocol !== 1 ||
          !isDeepStrictEqual(actual.identity, identity) ||
          !['closed', 'draining', 'blocked', 'serving'].includes(actual.mode) ||
          typeof actual.idle !== 'boolean' ||
          typeof actual.needsReconciliation !== 'boolean' ||
          actual.idle !== c?.idle ||
          ![c?.active, c?.unknown].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 65536) ||
          c.mode !==
            (actual.mode === 'serving'
              ? 'open'
              : actual.mode === 'blocked'
                ? 'blocked'
                : 'closed') ||
          actual.idle !== (c.mode === 'closed' && c.active === 0 && c.unknown === 0) ||
          (actual.mode === 'closed' && !actual.idle)
        )
          fail();
        status = {
          mode: actual.mode,
          closeAcknowledged: actual.mode === 'closed',
          idle: actual.idle,
          active: c.active,
          unknown: c.unknown,
          needsReconciliation: actual.needsReconciliation,
        };
      } catch {
        /* Lost/foreign/invalid status remains unknown, never a clean claim. */
      }
    }
    if (!isDeepStrictEqual(record, await guard())) fail();
    const code = result.errorCode ?? result.code;
    await journal.recordFirstCutoverFailure({
      phase: record.phase,
      ...(identity ? { identity } : {}),
      observedAtMs: io.now(),
      operatorRef: approval.operatorRef,
      reconcileByMs: approval.reconcileByMs,
      errorCode: /^(CUTOVER|MAINTENANCE)_[A-Z_]{1,100}$/.test(code ?? '') ? code : 'CUTOVER_FAILED',
      status,
    });
    return { closeAcknowledged: status.closeAcknowledged };
  } catch {
    fail();
  }
}

/** Use the already staged candidate and protected approved configuration. Each
 * read owns one dedicated connection, never a pool or an application's session.
 * No dotenv auto-loading, provider API call, lease cleanup or status mutation.
 */
export function firstCutoverReadinessArguments(scope, binding, target) {
  const first = scope.kind === 'first-cutover';
  if (
    scope.deferredWorkSetFingerprint !== undefined &&
    (!first ||
      scope.deferredWorkSetFingerprint !==
        '192900b8bbd82d0456952f07f66cffe145f7131e738ab1c74f97ee327205f446')
  )
    throw new Error('MAINTENANCE_READINESS_INPUT');
  return [
    `${target ? 'verify' : 'services'}${first ? '-first-cutover' : ''}`,
    binding.attempt,
    binding.candidate,
    binding.configDigest,
    binding.migrationDigest,
    binding.inventoryDigest,
    ...(target ? [target.bootId] : []),
    ...(first ? [scope.riskDigest] : []),
    ...(scope.deferredWorkSetFingerprint ? [scope.deferredWorkSetFingerprint] : []),
  ];
}

export async function readFirstCutoverPersistedWork(context, overrides = {}) {
  return withApprovedCutoverDatabase(
    context,
    overrides,
    'CUTOVER_WORK_OBSERVATION_UNPROVEN',
    (connection, io) =>
      readCutoverWorkScope(connection, {
        now: io.now,
        includeReplaySources: context.approval.schemaVersion === 2,
        firstCutoverApproval: context.approval,
      }),
  );
}

/** One independent source for the eventual writer facts, not their substitute.
 * Uses the approved DB connection and refuses insufficient metadata privileges.
 * Never creates an observer account, grants privileges, or fills unknownWriters.
 */
export async function readFirstCutoverDatabaseWriters(context, expectedIdentity, overrides = {}) {
  return withApprovedCutoverDatabase(
    context,
    overrides,
    'CUTOVER_DATABASE_WRITERS_UNPROVEN',
    (connection, io) => readCutoverMysqlWriters(connection, expectedIdentity, { now: io.now }),
  );
}

/** Separately approved metadata connection. Never substitute administrative
 * credentials into the application's runtime/backup configuration or infer a
 * stopped writer from this observation. The fixed existing Debian client file
 * stays on its original host and is pinned by the protected inventory. */
export async function readFirstCutoverAdministrativeWriters(context, input, overrides = {}) {
  const code = 'CUTOVER_DATABASE_WRITERS_UNPROVEN';
  const reject = () => {
    throw new Error(code);
  };
  const io = {
    observerFs: fs,
    connectObserverDatabase: (options, root) =>
      createRequire(`${root}/apps/orchestrator/package.json`)('mysql2/promise').createConnection({
        ...options,
        connectTimeout: 5000,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        jsonStrings: true,
        timezone: 'Z',
      }),
    ...overrides,
  };
  try {
    const inventory = structuredClone(input);
    const metadata = inventory?.databaseObserver;
    if (
      createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
        context?.binding?.inventoryDigest ||
      !metadata ||
      !isDeepStrictEqual(Object.keys(metadata).sort(), ['configDigest', 'sourceIdentity']) ||
      !/^[a-f0-9]{64}$/.test(metadata.configDigest ?? '') ||
      !metadata.sourceIdentity ||
      !isDeepStrictEqual(Object.keys(metadata.sourceIdentity).sort(), ['database', 'serverUuid']) ||
      !/^[A-Za-z0-9_]{1,64}$/.test(metadata.sourceIdentity.database ?? '') ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        metadata.sourceIdentity.serverUuid ?? '',
      )
    )
      reject();
    const path = '/etc/mysql/debian.cnf';
    const readPrivate = async () => {
      if ((await io.observerFs.realpath(path)) !== path) reject();
      const handle = await io.observerFs.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (!privateFile(before) || before.size < 1 || before.size > 65536) reject();
        // Bounded even if a privileged concurrent writer grows the file.
        const buffer = Buffer.alloc(before.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const after = await handle.stat();
        const current = await io.observerFs.lstat(path);
        if (
          bytesRead !== before.size ||
          [after, current].some(
            (s) =>
              !privateFile(s) ||
              ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some(
                (k) => s[k] !== before[k],
              ),
          ) ||
          (await io.observerFs.realpath(path)) !== path
        )
          reject();
        const bytes = buffer.subarray(0, bytesRead);
        if (
          createHash('sha256').update(bytes).digest('hex') !== metadata.configDigest ||
          !Buffer.from(bytes.toString('utf8')).equals(bytes)
        )
          reject();
        return bytes;
      } finally {
        await handle.close();
      }
    };
    let original;
    return await withApprovedCutoverDatabase(
      context,
      {
        ...io,
        connectWorkDatabase: async (uri, root) => {
          const url = new URL(uri);
          if (
            !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            decodeURIComponent(url.pathname.slice(1)) !== metadata.sourceIdentity.database
          )
            reject();
          original = await readPrivate();
          // Deliberately support only the verified unquoted Debian format.
          // Includes, escapes, duplicates and unfamiliar options fail closed.
          const groups = new Map();
          let section;
          for (const raw of original.toString('utf8').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || /^[#;]/.test(line)) continue;
            const group = /^\[(client|mysql_upgrade)\]$/.exec(line);
            if (group) {
              if (groups.has(group[1])) reject();
              section = new Map();
              groups.set(group[1], section);
              continue;
            }
            const option = /^(host|user|password|socket|port)\s*=\s*([^\s'"\\#;]+)$/.exec(line);
            if (!section || !option || section.has(option[1])) reject();
            section.set(option[1], option[2]);
          }
          const config = Object.fromEntries(groups.get('client') ?? []);
          if (
            !config.user ||
            !config.password ||
            !['localhost', '127.0.0.1', '::1'].includes(config.host) ||
            !/^\/(?:var\/)?run\/mysqld\/[A-Za-z0-9_.-]+\.sock$/.test(config.socket ?? '') ||
            (config.port !== undefined && config.port !== (url.port || '3306'))
          )
            reject();
          return io.connectObserverDatabase(
            {
              user: config.user,
              password: config.password,
              socketPath: config.socket,
              database: metadata.sourceIdentity.database,
            },
            root,
          );
        },
      },
      code,
      async (connection, activeIO) => {
        const proof = await (io.readAdministrativeObservation ?? readCutoverMysqlWriters)(
          connection,
          metadata.sourceIdentity,
          {
            now: activeIO.now,
          },
        );
        if (!original.equals(await readPrivate())) reject();
        return proof;
      },
    );
  } catch {
    reject();
  }
}

/** Same protected local administrative connection, plus the existing local
 * process/TCP collector. No SSH recursion from an ingress writer callback.
 * Session attribution still does not prove future-writer exclusion. */
export function readFirstCutoverAttributedWriters(context, inventory, overrides = {}) {
  return readFirstCutoverAdministrativeWriters(context, inventory, {
    ...overrides,
    readAdministrativeObservation: (connection, identity, options) =>
      readCutoverMysqlSessionOwners(
        connection,
        identity,
        overrides.readSessionHost ?? readCutoverHostSnapshot,
        options,
      ),
  });
}

/** This maps only explicit approved metadata. It does not prove historical
 * merchant ownership, query a provider, or manufacture a recovery receipt. */
export async function readFirstCutoverPaymentScope(context, input, overrides = {}) {
  const code = 'CUTOVER_PAYMENT_OBSERVATION_UNPROVEN';
  try {
    const inventory = structuredClone(input);
    if (
      !inventory ||
      createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
        context?.binding?.inventoryDigest ||
      !Number.isSafeInteger(inventory.paymentWindowStartMs) ||
      inventory.paymentWindowStartMs < 0 ||
      inventory.paymentWindowStartMs >= context.approval.maintenanceEndsAtMs ||
      !Array.isArray(inventory.merchants)
    )
      throw new Error(code);
    const merchants = new Map();
    for (const m of inventory.merchants) {
      if (
        !['wechat', 'alipay'].includes(m?.provider) ||
        !['sandbox', 'production'].includes(m.environment) ||
        !/^[a-f0-9]{64}$/.test(m.merchantDigest ?? '') ||
        merchants.has(m.provider)
      )
        throw new Error(code);
      merchants.set(m.provider, {
        merchantDigest: m.merchantDigest,
        environment: m.environment,
      });
    }
    const paymentRecord = await context.journal.readFirstCutoverEffects();
    const afterOpen = paymentRecord.phase === 'reconciled';
    if (afterOpen)
      await assertFirstCutoverReconciliationRead(
        { binding: context.binding, ...context.approval },
        context.journal,
        (overrides.now ?? Date.now)(),
        paymentRecord.identity,
      );
    return await withApprovedCutoverDatabase(context, overrides, code, (connection, io) =>
      readCutoverDatabaseScope(connection, {
        now: io.now,
        windowStartMs: inventory.paymentWindowStartMs,
        ...(afterOpen
          ? {
              windowEndMs: Math.min(context.approval.maintenanceEndsAtMs, io.now()),
            }
          : {}),
        deferredSandboxPayment: inventory.deferredSandboxPayment,
        deferredAlipayPayments: inventory.deferredAlipayPayments,
        firstCutoverApproval: context.approval,
        resolveMerchant: (provider, row) => {
          const merchant = merchants.get(provider);
          const metadata =
            typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          if (!merchant || (metadata?.env !== undefined && metadata.env !== merchant.environment))
            throw new Error(code);
          return structuredClone(merchant);
        },
      }),
    );
  } catch {
    throw new Error(code);
  }
}

/** Select the original backup plan only after physical stop has been checked by
 * the site. This verifies the connected SOURCE, not target isolation or restore;
 * the existing backup coordinator must independently verify both databases. */
export async function readFirstCutoverBackupPlan(context, input, overrides = {}) {
  const code = 'CUTOVER_BACKUP_PLAN_UNPROVEN';
  try {
    const inventory = structuredClone(input);
    const plan = inventory?.backupPlan;
    const validIdentity = (v) =>
      v &&
      isDeepStrictEqual(Object.keys(v).sort(), ['database', 'serverUuid']) &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.serverUuid ?? '') &&
      /^[a-zA-Z0-9_]{1,64}$/.test(v.database ?? '');
    if (
      !inventory ||
      createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
        context?.binding?.inventoryDigest ||
      !plan ||
      !isDeepStrictEqual(Object.keys(plan).sort(), ['isolatedTarget', 'sourceIdentity']) ||
      !validIdentity(plan.sourceIdentity) ||
      !validIdentity(plan.isolatedTarget) ||
      plan.sourceIdentity.serverUuid === plan.isolatedTarget.serverUuid
    )
      throw new Error(code);
    const record = structuredClone(await context.journal.readFirstCutoverEffects());
    const assertPhase = async () => {
      if (
        record.phase !== 'backup_verified' ||
        !['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].every(
          (k) => record[k] === context.binding[k],
        ) ||
        !isDeepStrictEqual(record, await context.journal.readFirstCutoverEffects())
      )
        throw new Error(code);
    };
    await assertPhase();
    return await withApprovedCutoverDatabase(context, overrides, code, async (connection) => {
      for (let sample = 0; sample < 2; sample++) {
        await assertPhase();
        const [rows] = await connection.query(
          'SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`',
        );
        if (
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          !isDeepStrictEqual(rows[0], plan.sourceIdentity)
        )
          throw new Error(code);
      }
      await assertPhase();
      return plan;
    });
  } catch {
    throw new Error(code);
  }
}

/** Original full reader, on a dedicated approved SOURCE connection. No sampled
 * rows or hashes supplied by a caller. Raw business/DDL data never leaves it.
 */
export async function readFirstCutoverSourceSnapshot(context, input, overrides = {}) {
  const code = 'CUTOVER_SOURCE_SNAPSHOT_UNPROVEN';
  try {
    if (typeof overrides.assertWritersStopped !== 'function') throw new Error(code);
    const plan = await readFirstCutoverBackupPlan(context, input, overrides);
    const record = structuredClone(await context.journal.readFirstCutoverEffects());
    return await withApprovedCutoverDatabase(
      context,
      overrides,
      code,
      async (connection, _io, _config, checkConfig) => {
        const verify = async () => {
          await checkConfig();
          if (
            record.phase !== 'backup_verified' ||
            !isDeepStrictEqual(record, await context.journal.readFirstCutoverEffects())
          )
            throw new Error(code);
          await overrides.assertWritersStopped();
          await checkConfig();
          if (!isDeepStrictEqual(record, await context.journal.readFirstCutoverEffects()))
            throw new Error(code);
        };
        await verify();
        const snapshot = await readCutoverMysqlSnapshot(connection, plan.sourceIdentity);
        await verify();
        return snapshot;
      },
    );
  } catch {
    throw new Error(code);
  }
}

/** Actual source export, using the same approved configuration as the original
 * source identity reader. The site's physical stopped observer is mandatory;
 * an artifact here is not a restore result or a journal backup receipt. */
export async function exportFirstCutoverSourceBackup(context, input, overrides = {}) {
  const code = 'CUTOVER_SOURCE_BACKUP_UNPROVEN';
  try {
    if (typeof overrides.assertWritersStopped !== 'function') throw new Error(code);
    const inventory = structuredClone(input);
    const plan = await readFirstCutoverBackupPlan(context, inventory, overrides);
    const source = inventory.backupSource;
    if (
      !source ||
      !isDeepStrictEqual(Object.keys(source).sort(), [
        'directory',
        'executable',
        'executableDigest',
        'facility',
      ])
    )
      throw new Error(code);
    const record = structuredClone(await context.journal.readFirstCutoverEffects());
    return await withApprovedCutoverDatabase(
      context,
      overrides,
      code,
      async (connection, io, config, checkConfig) => {
        const verify = async () => {
          await checkConfig();
          if (
            record.phase !== 'backup_verified' ||
            !isDeepStrictEqual(record, await context.journal.readFirstCutoverEffects())
          )
            throw new Error(code);
          await overrides.assertWritersStopped();
          const [rows] = await connection.query(
            'SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`',
          );
          if (
            !Array.isArray(rows) ||
            rows.length !== 1 ||
            !isDeepStrictEqual(rows[0], plan.sourceIdentity)
          )
            throw new Error(code);
          await checkConfig();
          if (!isDeepStrictEqual(record, await context.journal.readFirstCutoverEffects()))
            throw new Error(code);
        };
        await verify();
        return (io.encryptMysqlAgeBackup ?? encryptMysqlAgeBackup)(
          {
            facility: source.facility,
            directory: source.directory,
            attempt: context.binding.attempt,
          },
          {
            executable: source.executable,
            executableDigest: source.executableDigest,
            databaseUrl: config.DATABASE_URL,
            database: plan.sourceIdentity.database,
          },
          verify,
        );
      },
    );
  } catch {
    throw new Error(code);
  }
}

async function withApprovedCutoverDatabase(context, overrides, errorCode, read) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    connectWorkDatabase: (uri, root) =>
      createRequire(`${root}/apps/orchestrator/package.json`)('mysql2/promise').createConnection({
        uri,
        connectTimeout: 5000,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        jsonStrings: true,
        timezone: 'Z',
      }),
    ...overrides,
  };
  const fail = () => {
    throw new Error(errorCode);
  };
  let connection;
  let firstTime;
  try {
    const binding = structuredClone(context?.binding);
    const guard = async () => {
      const now = io.now();
      const maintenanceDeadline = context.approval.maintenanceEndsAtMs;
      const deadline =
        now < maintenanceDeadline
          ? maintenanceDeadline
          : (await context.journal.readFirstCutoverEffects?.())?.phase === 'reconciled'
            ? context.approval.reconcileByMs
            : maintenanceDeadline;
      if (
        io.platform !== 'linux' ||
        io.uid !== 0 ||
        !/^[a-f0-9]{40}$/.test(binding?.candidate ?? '') ||
        !/^[a-f0-9]{64}$/.test(binding?.configDigest ?? '') ||
        context.root !== `/opt/holaday-releases/${binding.candidate}` ||
        !['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].every(
          (k) => context.approval?.[k] === binding[k],
        ) ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        (firstTime !== undefined && now < firstTime) ||
        !Number.isSafeInteger(context.approval.maintenanceEndsAtMs) ||
        !Number.isSafeInteger(deadline) ||
        now >= deadline ||
        !isDeepStrictEqual(await context.journal.assertOwnership(), binding)
      )
        fail();
      firstTime ??= now;
      const bytes = await io.readConfig();
      if (createHash('sha256').update(bytes).digest('hex') !== binding.configDigest) fail();
      return bytes;
    };
    const bytes = await guard();
    const config = io.parseConfig(bytes, context.root);
    const url = new URL(config.DATABASE_URL);
    if (url.protocol !== 'mysql:' || !url.hostname || url.pathname.length < 2) fail();
    connection = await io.connectWorkDatabase(config.DATABASE_URL, context.root);
    const work = await read(connection, io, config, guard);
    await guard();
    return work;
  } catch {
    fail();
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        fail();
      }
    }
  }
}

/** Capture the approved baseline BEFORE effects and keep it private for later
 * observations. The same live journal is read on both sides of each fresh pair;
 * no uploaded event log, automatic baseline refresh, or "all stopped" fallback.
 * This does not by itself verify fences or authorize advancement of the release.
 */
export async function createFirstCutoverRetirementObserver(input, overrides = {}) {
  const io = {
    readPair: readFirstCutoverHostPair,
    readCloudManagers: readFirstCutoverCloudManagers,
    readCloudOwnedDisplay: readFirstCutoverCloudOwnedDisplay,
    readCloudRecoveryCensus: readFirstCutoverCloudRecoveryCensus,
    readCloudRecoverySources: readFirstCutoverCloudRecoverySources,
    readCloudRecoveryVacancy: readFirstCutoverCloudRecoveryVacancy,
    readCloudOldBrowserAssociations: readFirstCutoverCloudOldBrowserAssociations,
    readCloudNativePreflight: readFirstCutoverCloudNativePreflight,
    readCloudRecovery: readFirstCutoverCloudRecovery,
    reobserveCloudRecovery: reobserveFirstCutoverCloudRecovery,
    restoreCloudBrowser: restoreFirstCutoverCloudBrowser,
    restoreCloudVnc: restoreFirstCutoverCloudVnc,
    readFenceReceipts: async () => [],
    // Trusted live session handles, never a CLI/uploaded process allowlist.
    readExecutionIdentities: async () => [],
    readCandidateRuntime: readFirstCutoverCandidateRuntime,
    now: Date.now,
    reportRejection: (event) => writeSync(2, `${JSON.stringify(event)}\n`),
    ...overrides,
  };
  const fail = () => {
    throw new Error('CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN');
  };
  // Keep this at the observer boundary: outer site/transport errors intentionally
  // redact their causes. Never emit the input, raw error, stack, argv or business
  // payload. Diagnostics must not turn a refusal into a retry or a success.
  const report = async (error, operation, step) => {
    let code = 'UNCLASSIFIED';
    try {
      const value = Object.getOwnPropertyDescriptor(error, 'message')?.value;
      if (
        [
          'CUTOVER_HOST_PAIR_UNPROVEN',
          'CUTOVER_LEGACY_SOURCE_UNPROVEN',
          'CUTOVER_CANDIDATE_OBSERVATION_UNPROVEN',
          'CUTOVER_INVENTORY_UNPROVEN',
          'CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN',
          'CUTOVER_CLOUD_VNC_NATIVE_SOURCE_UNPROVEN',
          'CUTOVER_CLOUD_NATIVE_PREFLIGHT_UNPROVEN',
          'CUTOVER_CLOUD_RECOVERY_CENSUS_UNPROVEN',
          'CUTOVER_CLOUD_SOURCES_UNPROVEN',
          'CUTOVER_CLOUD_VACANCY_UNPROVEN',
          'CUTOVER_CLOUD_DISPLAY_SCOPE_UNPROVEN',
        ].includes(value)
      )
        code = value;
    } catch {
      // Do not invoke error getters or serialize arbitrary thrown objects.
    }
    try {
      await io.reportRejection({
        schemaVersion: 1,
        component: 'cutover-retirement-observer',
        operation,
        step,
        code,
      });
    } catch {
      // A broken diagnostic sink cannot suppress or replace the original refusal.
    }
  };
  let initialStep = 'input';
  try {
    const { reviews, binding, legacyDigest, executionSite } = structuredClone(input);
    const siteDigest =
      executionSite === undefined
        ? undefined
        : createHash('sha256').update(JSON.stringify(executionSite)).digest('hex');
    let last = io.now();
    const checkClock = () => {
      const now = io.now();
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(last) || last < 0 || now < last)
        fail();
      last = now;
      return now;
    };
    initialStep = 'initial-clock';
    checkClock();
    let scopeCaptured = false;
    const effects = async () => {
      if (!isDeepStrictEqual(await io.journal.assertOwnership(), binding)) fail();
      const record = await io.journal.readFirstCutoverEffects();
      if (
        !Object.entries(binding).every(([key, value]) => record[key] === value) ||
        record.legacyDigest !== legacyDigest ||
        (siteDigest !== undefined && record.executionSiteDigest !== siteDigest) ||
        (scopeCaptured && !isDeepStrictEqual(record.cloudMaintenanceScope, originalCloudScope))
      )
        fail();
      return record;
    };
    initialStep = 'initial-effects';
    const first = await effects();
    const originalCloudScope = structuredClone(first.cloudMaintenanceScope);
    scopeCaptured = true;
    initialStep = 'execution-site';
    if (
      (originalCloudScope && !executionSite) ||
      (executionSite &&
        (!isDeepStrictEqual(executionSite.binding, binding) ||
          !isDeepStrictEqual(executionSite.reviews, reviews) ||
          executionSite.legacyDigest !== legacyDigest ||
          !isDeepStrictEqual(executionSite.cloudMaintenanceScope, originalCloudScope) ||
          !Number.isSafeInteger(executionSite.maintenanceEndsAtMs) ||
          executionSite.maintenanceEndsAtMs <= checkClock()))
    )
      fail();
    if (!originalCloudScope && executionSite?.cloudRecoverySources !== undefined) fail();
    if (originalCloudScope)
      validateFirstCutoverCloudSources(executionSite.cloudRecoverySources, {
        scope: originalCloudScope,
      });
    initialStep = 'initial-state';
    if (
      !['preflight', 'prepared'].includes(first.phase) ||
      first.startupEvents.length ||
      first.registrationEvents.length ||
      first.unmanagedEvents?.length ||
      first.cloudMaintenanceEvents?.length ||
      !isDeepStrictEqual(await io.readFenceReceipts(), [])
    )
      fail();
    let baseline;
    let baselineExecution;
    // Private, immutable-by-convention originals. No raw getter, journal field
    // or recovered-state recapture. A lost observer must re-establish the
    // original pre-effect review, never adopt a post-effect registration.
    const cloudConfigs = new Map();
    const cloudRecoveries = {};
    const compareSources = async (rows, pair) => {
      const reject = () => {
        throw new Error('CUTOVER_CLOUD_SOURCES_UNPROVEN');
      };
      const began = checkClock();
      const late = began >= executionSite.maintenanceEndsAtMs;
      const reconciliation = late
        ? await assertFirstCutoverReconciliationRead(executionSite, io.journal, began)
        : undefined;
      const sourceDeadline = late ? executionSite.reconcileByMs : executionSite.maintenanceEndsAtMs;
      const configs = rows.map((row) => ({
        name: row.name,
        pmId: row.pm_id,
        config: structuredClone(row.pm2_env),
      }));
      const observed = structuredClone(
        await io.readCloudRecoverySources({
          attempt: binding.attempt,
          configs,
        }),
      );
      validateFirstCutoverCloudSources(observed, {
        scope: originalCloudScope,
        observed: true,
      });
      const now = checkClock();
      const host = pair.hosts.find((h) => h.host === 'vultr').snapshot;
      if (
        !Number.isSafeInteger(began) ||
        began < 0 ||
        !Number.isSafeInteger(now) ||
        now < began ||
        now >= sourceDeadline ||
        observed.observedAtMs < began ||
        observed.observedAtMs > now ||
        now - observed.observedAtMs > 60000 ||
        observed.hostname !== host.hostname ||
        observed.bootId !== host.bootId ||
        observed.roles.some(
          (r, i) => r.configDigest !== cutoverRegistrationConfigDigest(configs[i].config),
        )
      )
        reject();
      const { observedAtMs: _time, ...material } = observed;
      material.roles = material.roles.map(({ configDigest: _config, ...role }) => role);
      if (!isDeepStrictEqual(material, executionSite.cloudRecoverySources)) reject();
      const path = '/opt/holaday-vnc/start.sh';
      const source = observed.files.find((f) => f.path === path);
      const wrapper = host.startup.files.filter((f) => f.path === path);
      if (
        wrapper.length !== 1 ||
        !wrapper[0].present ||
        wrapper[0].resolved !== source.resolvedPath ||
        wrapper[0].digest !== source.digest ||
        !wrapper[0].stat ||
        ['uid', 'gid', 'size'].some((k) => wrapper[0].stat[k] !== source[k]) ||
        (wrapper[0].stat.mode & 0o7777) !== source.mode
      )
        reject();
      const { content: _content, ...metadata } = wrapper[0];
      const approved = reviews.vultr.review.sources.filter((r) => r.key === `startup:${path}`);
      if (
        approved.length !== 1 ||
        approved[0].digest !== createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
      )
        reject();
      if (
        late &&
        !isDeepStrictEqual(
          reconciliation,
          await assertFirstCutoverReconciliationRead(executionSite, io.journal, checkClock()),
        )
      )
        reject();
      return observed;
    };
    const bindCloudRows = (rows, pair, captureStoppedPmId) => {
      if (!originalCloudScope) return [];
      const original = baseline.hosts.find((h) => h.host === 'vultr').snapshot;
      const current = pair.hosts.find((h) => h.host === 'vultr').snapshot;
      if (
        !Array.isArray(rows) ||
        rows.length !== 2 ||
        !Array.isArray(originalCloudScope) ||
        originalCloudScope.length !== 2 ||
        current.hostname !== original.hostname ||
        current.bootId !== original.bootId ||
        !isDeepStrictEqual(current.pm2Runtime, original.pm2Runtime) ||
        !isDeepStrictEqual(
          current.processes.find((p) => p.pid === current.pm2Runtime.pid),
          original.processes.find((p) => p.pid === original.pm2Runtime.pid),
        )
      )
        fail();
      return originalCloudScope.map((declaration, i) => {
        const name = ['holaday-vnc', 'holaday-chromium-headed'][i];
        const old = original.managers.filter((m) => m.name === name || m.pmId === declaration.pmId);
        const live = current.managers.filter((m) => m.name === name || m.pmId === declaration.pmId);
        const row = rows[i];
        const config = row?.pm2_env;
        const manager = live[0];
        const retainedRecovery = cloudConfigs.get(declaration.pmId)?.recovered;
        if (retainedRecovery) {
          if (
            row?.name !== name ||
            row.pm_id !== declaration.pmId ||
            row.pid !== manager?.pid ||
            config?.status !== 'online' ||
            manager.status !== 'online' ||
            cutoverRegistrationConfigDigest(config) !==
              cutoverRegistrationConfigDigest(retainedRecovery) ||
            manager.configDigest !== cutoverRegistrationConfigDigest(config) ||
            manager.stopConfigDigest !== cutoverCloudStopConfigDigest(config) ||
            manager.restartCount !== old[0].restartCount ||
            config.restart_time !== old[0].restartCount
          )
            fail();
          return { pmId: declaration.pmId, config: structuredClone(config) };
        }
        if (
          declaration.name !== name ||
          old.length !== 1 ||
          live.length !== 1 ||
          old[0].name !== name ||
          old[0].pmId !== declaration.pmId ||
          old[0].status !== 'online' ||
          reviews.vultr.review.registrations.find((r) => r.pmId === declaration.pmId)
            ?.configDigest !== old[0].configDigest ||
          manager.name !== name ||
          manager.pmId !== declaration.pmId ||
          row?.name !== name ||
          row.pm_id !== declaration.pmId ||
          row.pid !== manager.pid ||
          config?.name !== name ||
          config.pm_id !== declaration.pmId ||
          config.status !== manager.status ||
          !['online', 'stopped'].includes(config.status) ||
          !Number.isSafeInteger(config.restart_time) ||
          config.restart_time < 0 ||
          config.restart_time !== old[0].restartCount ||
          config.restart_time !== manager.restartCount ||
          cutoverRegistrationConfigDigest(config) !== manager.configDigest ||
          cutoverCloudStopConfigDigest(config) !== manager.stopConfigDigest ||
          manager.stopConfigDigest !== old[0].stopConfigDigest
        )
          fail();
        const retained = cloudConfigs.get(declaration.pmId);
        const expected = config.status === 'online' ? retained?.online : retained?.stopped;
        if (expected) {
          if (cutoverRegistrationConfigDigest(config) !== cutoverRegistrationConfigDigest(expected))
            fail();
        } else if (config.status === 'stopped') {
          if (!retained || captureStoppedPmId !== declaration.pmId) fail();
        } else if (retained || manager.configDigest !== old[0].configDigest) fail();
        return { pmId: declaration.pmId, config: structuredClone(config) };
      });
    };
    let displayRequired = false;
    let originalDisplayObservation;
    let originalAssociationObservation;
    let associationsRequired = false;
    const observeAssociations = async (sources, display, pair) => {
      if (!associationsRequired) return undefined;
      const snapshot = pair.hosts.find((h) => h.host === 'vultr').snapshot;
      const headed = snapshot.managers.find((m) => m.name === 'holaday-chromium-headed');
      if (headed?.status === 'stopped' || cloudConfigs.get(headed?.pmId)?.recovered)
        return undefined;
      const value = structuredClone(
        await io.readCloudOldBrowserAssociations({
          sources,
          displayObservation: display,
          maintenanceEndsAtMs: executionSite.maintenanceEndsAtMs,
        }),
      );
      firstCutoverCloudStopScope({
        snapshot,
        name: 'holaday-chromium-headed',
        association: value,
        display,
        review: reviews.vultr.review,
        now: checkClock(),
      });
      if (
        originalAssociationObservation &&
        (!isDeepStrictEqual(value.members, originalAssociationObservation.members) ||
          value.contextDigest !== originalAssociationObservation.contextDigest ||
          value.socketDigest !== originalAssociationObservation.socketDigest)
      )
        fail();
      return value;
    };
    const observeDisplay = async (sources, pair) => {
      if (!displayRequired) return undefined;
      const snapshot = pair.hosts.find((h) => h.host === 'vultr').snapshot;
      const headed = snapshot.managers.find((m) => m.name === 'holaday-chromium-headed');
      if (headed?.status === 'stopped' || cloudConfigs.get(headed?.pmId)?.recovered)
        return undefined;
      const observation = structuredClone(
        await io.readCloudOwnedDisplay({
          sources,
          maintenanceEndsAtMs: executionSite.maintenanceEndsAtMs,
        }),
      );
      const { observedAtMs: _time, ...material } = sources;
      if (
        observation?.sourcesDigest !==
        createHash('sha256').update(JSON.stringify(material)).digest('hex')
      )
        fail();
      validateFirstCutoverOwnedDisplayObservation({
        observation,
        snapshot,
        now: checkClock(),
      });
      if (
        originalDisplayObservation &&
        (observation.contextDigest !== originalDisplayObservation.contextDigest ||
          observation.roots.some(
            (r, i) =>
              r.status === 'online' &&
              observation.treeDigests[i] !== originalDisplayObservation.treeDigests[i],
          ))
      )
        fail();
      if (checkClock() >= executionSite.maintenanceEndsAtMs) fail();
      return observation;
    };
    let originalCloudConfigs;
    initialStep = 'reviewed-source';
    const proof = await readReviewedFirstCutoverLegacySource(
      { reviews, inventoryDigest: binding.inventoryDigest, binding },
      {
        readPair: async () => {
          const raw = originalCloudScope
            ? structuredClone(await io.readCloudManagers())
            : undefined;
          baseline = structuredClone(await io.readPair());
          if (originalCloudScope) {
            bindCloudRows(raw, baseline);
            initialStep = 'cloud-sources';
            try {
              const sources = await compareSources(raw, baseline);
              const snapshot = baseline.hosts.find((h) => h.host === 'vultr').snapshot;
              const roots = new Set(
                originalCloudScope.map(
                  (d) => snapshot.managers.find((m) => m.name === d.name)?.pid,
                ),
              );
              for (let i = 0; i < snapshot.processes.length; i++)
                for (const p of snapshot.processes) if (roots.has(p.ppid)) roots.add(p.pid);
              displayRequired = snapshot.processes.some(
                (p) => roots.has(p.pid) && /\/(?:Xvfb|Xorg|openbox)$/.test(p.exe),
              );
              originalDisplayObservation = await observeDisplay(sources, baseline);
              associationsRequired = snapshot.processes.some((p) =>
                /^\/opt\/brave\.com\/brave\/chrome_crashpad_handler(?: \(deleted\))?$/.test(p.exe),
              );
              if (associationsRequired && !displayRequired) fail();
              originalAssociationObservation = await observeAssociations(
                sources,
                originalDisplayObservation,
                baseline,
              );
              // The protected scope must already include these exact reviewed members.
              if (
                associationsRequired &&
                originalCloudScope[1].scopeDigest !==
                  createHash('sha256')
                    .update(
                      JSON.stringify(
                        firstCutoverCloudStopScope({
                          snapshot,
                          name: 'holaday-chromium-headed',
                          association: originalAssociationObservation,
                          display: originalDisplayObservation,
                          review: reviews.vultr.review,
                          now: checkClock(),
                        }),
                      ),
                    )
                    .digest('hex')
              )
                fail();
            } catch (error) {
              await report(error, 'initialization', 'cloud-sources');
              throw error;
            }
            originalCloudConfigs = bindCloudRows(
              structuredClone(await io.readCloudManagers()),
              baseline,
            );
          }
          return baseline;
        },
        readExecutionIdentities: async () => {
          baselineExecution = structuredClone(await io.readExecutionIdentities());
          return baselineExecution;
        },
        now: checkClock,
      },
    );
    initialStep = 'initial-stability';
    if (
      proof.legacyDigest !== legacyDigest ||
      !isDeepStrictEqual(first, await effects()) ||
      !isDeepStrictEqual(baselineExecution, await io.readExecutionIdentities()) ||
      !isDeepStrictEqual(await io.readFenceReceipts(), [])
    )
      fail();
    for (const { pmId, config } of originalCloudConfigs ?? [])
      cloudConfigs.set(pmId, { online: config });
    initialStep = 'initial-clock';
    checkClock();
    const sourceGate = async () => {
      try {
        const before = await effects();
        const raw = structuredClone(await io.readCloudManagers());
        const pair = structuredClone(await io.readPair());
        bindCloudRows(raw, pair);
        const observed = await compareSources(raw, pair);
        const display = await observeDisplay(observed, pair);
        await observeAssociations(observed, display, pair);
        const observedAtMs = observed.observedAtMs;
        bindCloudRows(structuredClone(await io.readCloudManagers()), pair);
        if (!isDeepStrictEqual(before, await effects())) fail();
        const now = checkClock();
        const age = now - observedAtMs;
        if (age < 0 || age > 60000 || now >= executionSite.maintenanceEndsAtMs) fail();
        return observed;
      } catch (error) {
        await report(error, 'cloud-sources', 'native-source-gate');
        fail();
      }
    };
    const read = async (
      requestedRegistrationHost,
      requestedUnmanagedHost,
      candidateIdentity,
      fenceProgress = false,
      cloudProgress = false,
      captureStoppedPmId = null,
    ) => {
      const operation = fenceProgress
        ? 'fence-progress'
        : candidateIdentity !== undefined
          ? 'candidate'
          : requestedRegistrationHost !== undefined
            ? 'registration-progress'
            : requestedUnmanagedHost !== undefined
              ? 'unmanaged-progress'
              : 'read';
      let step = 'clock';
      try {
        checkClock();
        step = 'effects-before';
        const before = await effects();
        let registrationProgressHost = requestedRegistrationHost;
        let unmanagedProgressHost = requestedUnmanagedHost;
        if (fenceProgress) {
          // Read-only in-flight fence checks use the existing progress classifier,
          // with scope selected by THIS owned journal, never caller-supplied host.
          // Strict completion reads below keep their original semantics.
          if (before.phase === 'producers_stopped') registrationProgressHost = 'vultr';
          else if (['all_fenced', 'stopped'].includes(before.phase)) {
            if (before.unmanagedEvents?.length === 1) unmanagedProgressHost = 'aliyun';
            else registrationProgressHost = 'aliyun';
          }
        }
        step = 'execution-before';
        const execution = structuredClone(await io.readExecutionIdentities());
        step = 'fences-before';
        const fences = structuredClone(await io.readFenceReceipts());
        step = 'candidate-before';
        const candidate =
          candidateIdentity === undefined
            ? undefined
            : await io.readCandidateRuntime(candidateIdentity);
        if (
          candidateIdentity !== undefined &&
          !isDeepStrictEqual(candidate?.identity, candidateIdentity)
        )
          fail();
        step = 'host-pair';
        const raw = originalCloudScope ? structuredClone(await io.readCloudManagers()) : undefined;
        const pair = structuredClone(await io.readPair());
        let captured;
        let currentDisplayObservation;
        let currentAssociationObservation;
        let cloudCensus;
        if (originalCloudScope) {
          step = 'cloud-config';
          bindCloudRows(raw, pair, captureStoppedPmId);
          if (
            displayRequired &&
            pair.hosts
              .find((h) => h.host === 'vultr')
              .snapshot.managers.find((m) => m.name === 'holaday-chromium-headed')?.status ===
              'online'
          ) {
            step = 'cloud-display';
            const sources = await compareSources(raw, pair);
            currentDisplayObservation = await observeDisplay(sources, pair);
            currentAssociationObservation = await observeAssociations(
              sources,
              currentDisplayObservation,
              pair,
            );
          }
          captured = bindCloudRows(
            structuredClone(await io.readCloudManagers()),
            pair,
            captureStoppedPmId,
          );
        }
        if (Object.keys(cloudRecoveries).length) {
          step = 'cloud-recovery-current-native';
          const sources = await compareSources(raw, pair);
          for (const index of [1, 0]) {
            const declaration = originalCloudScope[index],
              retained = cloudRecoveries[declaration.name];
            if (!retained) continue;
            const observed = await io.reobserveCloudRecovery(
              {
                attempt: binding.attempt,
                name: declaration.name,
                pmId: declaration.pmId,
                beforeCensus: retained.beforeCensus,
                restoreStartedAtMs: retained.restoreStartedAtMs,
                ...(index
                  ? {}
                  : {
                      headedRecovery: cloudRecoveries[originalCloudScope[1].name].origin,
                      sources,
                    }),
              },
              structuredClone(retained.origin),
            );
            if (
              !observed ||
              observed.observedAtMs < checkClock() - 60000 ||
              observed.observedAtMs > checkClock()
            )
              fail();
            retained.native = structuredClone(observed);
          }
        }
        if (
          originalCloudScope &&
          pair.hosts
            .find((h) => h.host === 'vultr')
            .snapshot.managers.some(
              (m) =>
                originalCloudScope.some((d) => d.pmId === m.pmId) &&
                (m.status === 'stopped' || cloudConfigs.get(m.pmId)?.recovered),
            )
        ) {
          cloudCensus = structuredClone(await io.readCloudRecoveryCensus());
          const host = pair.hosts.find((h) => h.host === 'vultr').snapshot;
          const now = checkClock();
          if (
            cloudCensus.hostname !== host.hostname ||
            cloudCensus.bootId !== host.bootId ||
            !Number.isSafeInteger(cloudCensus.observedAtMs) ||
            cloudCensus.observedAtMs > now ||
            now - cloudCensus.observedAtMs > 60000 ||
            !Array.isArray(cloudCensus.processes) ||
            cloudCensus.processes.length > 16384 ||
            new Set(cloudCensus.processes.map((p) => p.pid)).size !== cloudCensus.processes.length
          )
            fail();
        }
        step = 'stability';
        if (
          !isDeepStrictEqual(before, await effects()) ||
          !isDeepStrictEqual(execution, await io.readExecutionIdentities()) ||
          !isDeepStrictEqual(fences, await io.readFenceReceipts()) ||
          (candidateIdentity !== undefined &&
            !isDeepStrictEqual(candidate, await io.readCandidateRuntime(candidateIdentity))) ||
          pair.sourceCandidate !== baseline.sourceCandidate ||
          pair.sourceDigest !== baseline.sourceDigest ||
          !['aliyun', 'vultr'].every(
            (host) =>
              pair.hosts.find((h) => h.host === host)?.sourceCandidate ===
              baseline.hosts.find((h) => h.host === host)?.sourceCandidate,
          )
        )
          fail();
        step = 'classification';
        const result = classifyFirstCutoverRetirementPair(
          {
            baseline,
            baselineExecution,
            pair,
            reviews,
            inventoryDigest: binding.inventoryDigest,
            effects: before,
            fences,
            registrationProgressHost,
            unmanagedProgressHost,
            candidate,
            execution,
            cloudProgress: cloudProgress || (fenceProgress && before.phase === 'producers_stopped'),
            ...(cloudCensus ? { cloudCensus } : {}),
            ...(Object.keys(cloudRecoveries).length ? { cloudRecovery: cloudRecoveries } : {}),
            ...(associationsRequired
              ? {
                  cloudAssociations: {
                    original: originalAssociationObservation,
                    current: currentAssociationObservation,
                  },
                }
              : {}),
            ...(displayRequired
              ? {
                  cloudDisplay: {
                    original: originalDisplayObservation,
                    current: currentDisplayObservation,
                  },
                }
              : {}),
          },
          { now: checkClock },
        );
        step = 'unknown-launchers';
        if (result.unknownLaunchers.length) fail();
        // Only this private post-effect read may retain a new stopped config,
        // after independent tree/port/config classification and the full bracket.
        if (captureStoppedPmId !== null) {
          const stopped = captured?.find((row) => row.pmId === captureStoppedPmId);
          if (stopped?.config.status !== 'stopped' || cloudConfigs.get(captureStoppedPmId)?.stopped)
            fail();
          cloudConfigs.get(captureStoppedPmId).stopped = stopped.config;
        }
        if (fenceProgress) return { purpose: 'fence-progress', pair: result };
        if (registrationProgressHost !== undefined)
          return {
            purpose: 'registration-progress',
            host: registrationProgressHost,
            inventory: result.hosts.find((h) => h.host === registrationProgressHost).registered,
          };
        if (unmanagedProgressHost !== undefined)
          return {
            purpose: 'unmanaged-progress',
            host: unmanagedProgressHost,
            inventory: result.hosts.find((h) => h.host === unmanagedProgressHost).unmanaged,
          };
        return result;
      } catch (error) {
        await report(error, operation, step);
        fail();
      }
    };
    let unmanagedAttempted = false;
    let cloudAttempted = false;
    let cloudRecoveryAttempted = false;
    return {
      read: () => read(),
      readFenceProgress: () => read(undefined, undefined, undefined, true),
      readRegistrationProgress: (host) => read(host ?? 'invalid'),
      readUnmanagedProgress: (host) => read(undefined, host ?? 'invalid'),
      readWithCandidate: (identity) => read(undefined, undefined, structuredClone(identity ?? {})),
      probeBrowser: async (identity) => {
        const record = await assertFirstCutoverReconciliationRead(
          executionSite,
          io.journal,
          checkClock(),
          identity,
        );
        const before = await read(undefined, undefined, structuredClone(identity));
        const headed = cloudRecoveries['holaday-chromium-headed'];
        if (
          !headed ||
          before.unknownLaunchers.length ||
          record.cloudMaintenanceEvents?.length !== 8
        )
          fail();
        const anchor = structuredClone(headed.origin);
        const result = await (io.probeBrowser ?? probeFirstCutoverRecoveredBrowser)(
          structuredClone(headed.native),
          executionSite.reconcileByMs,
        );
        const after = await read(undefined, undefined, structuredClone(identity));
        if (
          !isDeepStrictEqual(anchor, headed.origin) ||
          after.unknownLaunchers.length ||
          !isDeepStrictEqual(before.candidate, after.candidate) ||
          !isDeepStrictEqual(
            record,
            await assertFirstCutoverReconciliationRead(
              executionSite,
              io.journal,
              checkClock(),
              identity,
            ),
          )
        )
          fail();
        return result;
      },
      restoreCloudServices: async (input, operations = {}) => {
        if (cloudRecoveryAttempted) fail();
        cloudRecoveryAttempted = true;
        let step = 'recovery-input';
        try {
          if (
            !isDeepStrictEqual(Object.keys(input ?? {}).sort(), [
              'identity',
              'maintenanceEndsAtMs',
            ]) ||
            !isDeepStrictEqual(Object.keys(operations), ['readRecoveryFacts']) ||
            typeof operations.readRecoveryFacts !== 'function'
          )
            fail();
          const { identity, maintenanceEndsAtMs } = structuredClone(input);
          const record = await effects();
          const left = maintenanceEndsAtMs - checkClock();
          if (
            !Number.isSafeInteger(maintenanceEndsAtMs) ||
            left <= 0 ||
            left > 900000 ||
            record.phase !== 'verified' ||
            record.failureObservation ||
            !isDeepStrictEqual(record.identity, identity) ||
            !originalCloudScope ||
            record.cloudMaintenanceEvents?.length !== 4 ||
            originalCloudScope.some(({ pmId }) => !cloudConfigs.get(pmId)?.stopped)
          )
            fail();
          step = 'recovery-leaves';
          const { work, persisted, fence } = await operations.readRecoveryFacts();
          const disposition = validateLegacyWorkBoundary({
            observation: work,
            approval: record,
            phase: 'preopen',
            nowMs: checkClock(),
          });
          if (
            disposition.mode === 'controlled-interruption' &&
            (record.riskDigest !== disposition.riskDigest ||
              record.interruptionObservation?.riskDigest !== disposition.riskDigest)
          )
            fail();
          const fresh = (value) =>
            Number.isSafeInteger(value) &&
            value >= 0 &&
            value <= checkClock() &&
            checkClock() - value <= 60000;
          if (
            work?.inventoryDigest !== binding.inventoryDigest ||
            !fresh(work.observedAtMs) ||
            !fresh(persisted?.observedAtMs) ||
            !cutoverWorkScopeReady(persisted, record) ||
            fence?.inventoryDigest !== binding.inventoryDigest ||
            !fresh(fence.observedAtMs) ||
            fence.stage !== 'all-writers' ||
            ['existingSockets', 'internalWriters', 'producersRunning'].some((k) => fence[k] !== 0)
          )
            fail();
          step = 'recovery-stopped-baseline';
          const stopped = await read(undefined, undefined, identity);
          if (
            stopped.candidate?.mode !== 'closed' ||
            stopped.candidate.idle !== true ||
            stopped.candidate.needsReconciliation !== false ||
            stopped.candidate.runtime?.worker !== null ||
            !isDeepStrictEqual(record, await effects()) ||
            checkClock() >= maintenanceEndsAtMs
          )
            fail();
          step = 'recovery-census';
          if (typeof io.readCloudRecoveryCensus !== 'function') fail();
          const beforeCensus = structuredClone(await io.readCloudRecoveryCensus());
          const originalHost = baseline.hosts.find((h) => h.host === 'vultr').snapshot;
          if (
            beforeCensus.hostname !== originalHost.hostname ||
            beforeCensus.bootId !== originalHost.bootId ||
            !fresh(beforeCensus.observedAtMs) ||
            !isDeepStrictEqual(record, await effects()) ||
            checkClock() >= maintenanceEndsAtMs
          )
            fail();
          step = 'recovery-native-prerequisites';
          const sources = await sourceGate();
          const vacancyBegan = checkClock();
          const vacancy = structuredClone(
            await io.readCloudRecoveryVacancy({ sources, maintenanceEndsAtMs }),
          );
          const { observedAtMs: _sourceTime, ...sourceMaterial } = sources;
          if (
            !vacancy ||
            Object.keys(vacancy).sort().join(',') !==
              'bootId,contextDigest,hostname,observationDigest,observedAtMs,purpose,sourcesDigest' ||
            vacancy.purpose !== 'cloud-recovery-vacancy-observation' ||
            vacancy.hostname !== originalHost.hostname ||
            vacancy.bootId !== originalHost.bootId ||
            !fresh(vacancy.observedAtMs) ||
            vacancy.observedAtMs < vacancyBegan ||
            vacancy.sourcesDigest !==
              createHash('sha256').update(JSON.stringify(sourceMaterial)).digest('hex') ||
            !/^[a-f0-9]{64}$/.test(vacancy.contextDigest ?? '') ||
            !/^[a-f0-9]{64}$/.test(vacancy.observationDigest ?? '') ||
            !isDeepStrictEqual(record, await effects()) ||
            checkClock() >= maintenanceEndsAtMs
          )
            throw new Error('CUTOVER_CLOUD_VACANCY_UNPROVEN');
          step = 'recovery-native-preflight';
          const nativeBegan = checkClock();
          const preflight = await io.readCloudNativePreflight({
            attempt: binding.attempt,
            sources,
            vacancy,
            maintenanceEndsAtMs,
          });
          if (
            !preflight ||
            Object.keys(preflight).sort().join(',') !==
              'bootId,contextDigest,hostname,observationDigest,observedAtMs,purpose,roles,sourcesDigest,vacancyDigest' ||
            preflight.purpose !== 'cloud-recovery-native-preflight-observation' ||
            preflight.hostname !== originalHost.hostname ||
            preflight.bootId !== originalHost.bootId ||
            preflight.sourcesDigest !== vacancy.sourcesDigest ||
            preflight.contextDigest !== vacancy.contextDigest ||
            preflight.vacancyDigest !== vacancy.observationDigest ||
            !/^[a-f0-9]{64}$/.test(preflight.observationDigest ?? '') ||
            !isDeepStrictEqual(preflight.roles, ['holaday-chromium-headed', 'holaday-vnc']) ||
            !fresh(preflight.observedAtMs) ||
            preflight.observedAtMs < nativeBegan ||
            !isDeepStrictEqual(record, await effects())
          )
            fail();
          const recoverGuard = async () => {
            const before = await effects();
            if (
              before.phase !== 'verified' ||
              before.failureObservation ||
              !isDeepStrictEqual(before.identity, identity) ||
              checkClock() >= maintenanceEndsAtMs
            )
              fail();
            const { work, persisted, fence } = await operations.readRecoveryFacts();
            validateLegacyWorkBoundary({
              observation: work,
              approval: before,
              phase: 'preopen',
              nowMs: checkClock(),
            });
            if (
              !fresh(work.observedAtMs) ||
              !fresh(persisted?.observedAtMs) ||
              !cutoverWorkScopeReady(persisted, before) ||
              !fresh(fence?.observedAtMs) ||
              fence.inventoryDigest !== binding.inventoryDigest ||
              fence.stage !== 'all-writers' ||
              ['existingSockets', 'internalWriters', 'producersRunning'].some((k) => fence[k] !== 0)
            )
              fail();
            await read(undefined, undefined, identity, false, true);
            await sourceGate();
            if (!isDeepStrictEqual(before, await effects()) || checkClock() >= maintenanceEndsAtMs)
              fail();
          };
          for (const index of [1, 0]) {
            const declaration = originalCloudScope[index];
            step = `recovery-${index ? 'headed' : 'vnc'}-intent`;
            await recoverGuard();
            const census = structuredClone(await io.readCloudRecoveryCensus());
            const restoreStartedAtMs = checkClock();
            if (
              census.hostname !== originalHost.hostname ||
              census.bootId !== originalHost.bootId ||
              !fresh(census.observedAtMs)
            )
              fail();
            const stoppedConfig = cloudConfigs.get(declaration.pmId).stopped;
            const payload = {
              attempt: binding.attempt,
              pmId: declaration.pmId,
              stoppedConfigDigest: cutoverRegistrationConfigDigest(stoppedConfig),
              maintenanceEndsAtMs,
            };
            await (index ? io.restoreCloudBrowser : io.restoreCloudVnc)(payload, {
              journal: io.journal,
              now: checkClock,
              assertRecoveryScope: recoverGuard,
            });
            step = `recovery-${index ? 'headed' : 'vnc'}-native-proof`;
            const native = await io.readCloudRecovery({
              attempt: binding.attempt,
              name: declaration.name,
              pmId: declaration.pmId,
              beforeCensus: census,
              restoreStartedAtMs,
              ...(index
                ? {}
                : {
                    headedRecovery: cloudRecoveries[originalCloudScope[1].name].native,
                    sources: await compareSources(
                      structuredClone(await io.readCloudManagers()),
                      structuredClone(await io.readPair()),
                    ),
                  }),
            });
            const rows = structuredClone(await io.readCloudManagers());
            const matches = rows.filter(
              (r) => r.pm_id === declaration.pmId || r.name === declaration.name,
            );
            if (matches.length !== 1) fail();
            const config = matches[0].pm2_env;
            const configuration = (
              index
                ? compareCutoverCloudBrowserRecoveryConfig
                : compareCutoverCloudVncRecoveryConfig
            )({
              attempt: binding.attempt,
              pmId: declaration.pmId,
              pm2Version: '6.0.14',
              stoppedConfig,
              recoveredConfig: config,
              launch: index
                ? firstCutoverCloudBrowserRecoveryLaunch({
                    attempt: binding.attempt,
                  })
                : firstCutoverCloudVncRecoveryMaterial({
                    attempt: binding.attempt,
                  }),
              expectedLaunchDigest: declaration.recoveryDigest,
              restoreStartedAtMs,
              observedAtMs: checkClock(),
            });
            if (
              native.configDigest !== configuration.recoveredConfigDigest ||
              native.restartCount !== configuration.restartCount ||
              native.beforeCensusDigest !==
                createHash('sha256').update(JSON.stringify(census)).digest('hex')
            )
              fail();
            cloudConfigs.get(declaration.pmId).recovered = structuredClone(config);
            cloudRecoveries[declaration.name] = {
              native: structuredClone(native),
              origin: structuredClone(native),
              configuration,
              beforeCensus: census,
              restoreStartedAtMs,
            };
            await recoverGuard();
            await io.journal.recordCloudMaintenanceEvent({
              ...declaration,
              attempt: binding.attempt,
              inventoryDigest: binding.inventoryDigest,
              host: 'vultr',
              phase: 'cloud-restored',
            });
            await read(undefined, undefined, identity);
          }
          if ((await effects()).cloudMaintenanceEvents?.length !== 8) fail();
        } catch (error) {
          await report(error, 'cloud-recovery', step);
          fail();
        }
      },
      // The owned declaration selects the fixed pair; callers cannot supply a
      // name, PID, argv, environment, timeout or retry policy. A failed attempt
      // stays consumed even when the PM2 result is unknown.
      stopCloudServices: async ({ maintenanceEndsAtMs }, operations = {}) => {
        if (
          cloudAttempted ||
          !Number.isSafeInteger(maintenanceEndsAtMs) ||
          (operations.platform ?? process.platform) !== 'linux' ||
          (operations.uid ?? process.getuid?.()) !== 0 ||
          typeof operations.verifyFence !== 'function'
        )
          fail();
        cloudAttempted = true;
        const guard = async (refreshSources = false) => {
          const left = maintenanceEndsAtMs - checkClock();
          const record = await effects();
          if (
            left <= 0 ||
            left > 900000 ||
            record.phase !== 'producers_stopped' ||
            record.failureObservation ||
            !record.cloudMaintenanceScope
          )
            fail();
          // A bounded native hash read can still consume the fence's whole
          // freshness window. Read the fence afterwards, then age both proofs
          // after the last asynchronous journal check, immediately before use.
          const sourceTime = refreshSources ? (await sourceGate()).observedAtMs : null;
          const fence = await operations.verifyFence();
          const interrupted = await validateOwnedLegacyFence(fence, {
            now: checkClock,
            assertJournalOwnership: () => io.journal.assertOwnership(),
            readFirstCutoverEffects: effects,
          });
          const current = await effects();
          const now = checkClock();
          if (
            fence?.stage !== 'orders' ||
            fence.inventoryDigest !== binding.inventoryDigest ||
            fence.unsettledWork !== 0 ||
            fence.unknownWriters !== 0 ||
            (!interrupted && (fence.externalWork !== 0 || fence.activeRequests !== 0)) ||
            !Number.isSafeInteger(fence.observedAtMs) ||
            fence.observedAtMs > now ||
            now - fence.observedAtMs > 60000 ||
            (sourceTime !== null && (now - sourceTime < 0 || now - sourceTime > 60000)) ||
            !isDeepStrictEqual(record, current) ||
            now >= maintenanceEndsAtMs ||
            now >= executionSite.maintenanceEndsAtMs
          )
            fail();
          return record;
        };
        const first = await guard();
        if (first.cloudMaintenanceEvents?.length) fail();
        for (const declaration of first.cloudMaintenanceScope) {
          await guard();
          const state = await read();
          if (state.cloudMaintenance?.find((s) => s.name === declaration.name)?.status !== 'online')
            fail();
          await guard(true);
          const base = {
            attempt: binding.attempt,
            inventoryDigest: binding.inventoryDigest,
            host: 'vultr',
            ...declaration,
          };
          await io.journal.recordCloudMaintenanceEvent({
            ...base,
            phase: 'cloud-stop-intent',
          });
          const recorded = await guard();
          const checked = await read(undefined, undefined, undefined, false, true);
          if (
            checked.cloudMaintenance?.find((s) => s.name === declaration.name)?.status !==
              'online' ||
            !isDeepStrictEqual(recorded, await effects()) ||
            checkClock() >= maintenanceEndsAtMs
          )
            fail();
          if (!isDeepStrictEqual(recorded, await guard(true))) fail();
          try {
            await (operations.exec ?? candidatePreparationSystem().exec)(
              'pm2',
              ['stop', String(declaration.pmId), '--watch'],
              {
                cwd: '/',
                env: {
                  PATH: '/opt/node22/bin:/usr/local/bin:/usr/bin:/bin',
                  HOME: '/root',
                  PM2_HOME: '/root/.pm2',
                  LC_ALL: 'C',
                },
              },
            );
          } catch {
            throw new Error('CUTOVER_CLOUD_STOP_UNCERTAIN');
          }
          const observed = await read(
            undefined,
            undefined,
            undefined,
            false,
            true,
            declaration.pmId,
          );
          if (
            observed.cloudMaintenance?.find((s) => s.name === declaration.name)?.status !==
            'stopped'
          )
            fail();
          const beforeAck = await guard();
          await read(undefined, undefined, undefined, false, true);
          if (!isDeepStrictEqual(beforeAck, await effects()) || checkClock() >= maintenanceEndsAtMs)
            fail();
          await io.journal.recordCloudMaintenanceEvent({
            ...base,
            phase: 'cloud-stopped',
          });
          await read();
        }
      },
      // Signal execution is a trusted, fixed-host I/O seam; production supplies
      // createLegacyRuntimeEffects on that host, never a command from approval.
      retireUnmanaged: async ({ maintenanceEndsAtMs }, operations) => {
        if (
          unmanagedAttempted ||
          !Number.isSafeInteger(maintenanceEndsAtMs) ||
          ['verifyFence', 'sleep', 'signalPinned'].some(
            (k) => typeof operations?.[k] !== 'function',
          )
        )
          fail();
        unmanagedAttempted = true;
        const remaining = maintenanceEndsAtMs - checkClock();
        if (remaining <= 0 || remaining > 900000 || (await effects()).phase !== 'stopped') fail();
        const inventory = (await read()).hosts.find((h) => h.host === 'aliyun').unmanaged;
        const captured = await captureLegacyRuntime(
          { inventory, approvedTargets: inventory.processes },
          { now: checkClock },
        );
        const original = baseline.hosts.find((h) => h.host === 'aliyun').snapshot;
        const base = {
          attempt: binding.attempt,
          inventoryDigest: binding.inventoryDigest,
          host: 'aliyun',
          targets: captured.targets
            .map((p) => ({
              pid: p.pid,
              identityDigest: createHash('sha256')
                .update(JSON.stringify(original.processes.find((r) => r.pid === p.pid)))
                .digest('hex'),
            }))
            .sort((a, b) => a.pid - b.pid),
        };
        await io.journal.recordUnmanagedEvent({
          ...base,
          phase: 'unmanaged-stop-intent',
        });
        const left = maintenanceEndsAtMs - checkClock();
        if (left <= 0) fail();
        const result = await retireLegacyRuntime(
          { captured, deadlineMs: left },
          {
            now: checkClock,
            sleep: operations.sleep,
            verifyFence: operations.verifyFence,
            signalPinned: operations.signalPinned,
            assertJournalOwnership: () => io.journal.assertOwnership(),
            readFirstCutoverEffects: () => io.journal.readFirstCutoverEffects(),
            readInventory: async () => (await read(undefined, 'aliyun')).inventory,
          },
        );
        await io.journal.recordUnmanagedEvent({
          ...base,
          phase: 'unmanaged-stopped',
        });
        await read();
        return result;
      },
    };
  } catch (error) {
    await report(error, 'initialize', initialStep);
    fail();
  }
}

/** Compose the first lifecycle around ONE real prepared journal. Site-specific
 * two-host observations/effects remain mandatory trusted I/O, not uploaded
 * success reports. No default site adapter, shell entry or old protocol identity.
 * Import/construction has no effects. Call finish with the transition result to
 * close handles; only completed reconciliation may release the persisted lock.
 */
export function createFirstCutoverHostAdapter(options, overrides = {}) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    readCloudBrowserRecovery: readFirstCutoverCloudBrowserRecovery,
    prepareCloudBrowserPolicy: prepareFirstCutoverCloudBrowserPolicy,
    ...overrides,
  };
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (!options || Object.keys(options).length !== 1 || !uuid(options.attempt))
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  const request = { attempt: options.attempt };
  const required = {
    lifecycle: [
      'attach',
      'detach',
      'fenceOrders',
      'settleLegacy',
      'stopProducers',
      'fenceAll',
      'stopLegacy',
      'assertStopped',
      'verifyFence',
      'restoreIngress',
      'resumeWorker',
      'reconcile',
      'holdMaintenance',
      'readBackupPlan',
    ],
    backup: [
      'readDatabaseIdentity',
      'inspectBackupFacility',
      'exportDatabase',
      'hashArtifact',
      'restoreIsolated',
      'compareInventoryAndData',
      'runApprovedMigrations',
      'verifySchema',
      'readSourceDigest',
      'finishRecovery',
    ],
    evidence: [
      'readHostInventory',
      'readDatabaseScope',
      'queryOrders',
      'readRehearsalArtifacts',
      'readFenceState',
    ],
  };
  if (
    typeof io.inspectLegacySource !== 'function' ||
    Object.entries(required).some(([group, names]) =>
      names.some((name) => typeof io[group]?.[name] !== 'function'),
    )
  )
    throw new Error('CUTOVER_HOST_OBSERVER_REQUIRED');
  // Retain methods, not caller-mutable groups. All are trusted host operations.
  for (const group of Object.keys(required)) io[group] = { ...io[group] };
  let approval;
  let prepared;
  let env;
  let phase = 'preflight';
  let identity;
  let stoppedEvidence;
  let seed;
  let migrated = false;
  let reconciled = false;
  let closeAttempted = false;
  let siteAttachStarted = false;
  let siteDetachStarted = false;
  let siteDetached = false;
  let lastTime = -1;
  const attempted = new Set();
  let holdAttempt;
  const reject = () => {
    throw new Error('CUTOVER_HOST_STATE_UNPROVEN');
  };
  const context = () => ({
    approval: structuredClone(approval),
    binding: structuredClone(prepared.binding),
    root: prepared.root,
    applicationGid: prepared.applicationGid,
    journal: prepared.journal,
  });
  const detachSite = async () => {
    if (siteDetached) return;
    if (siteDetachStarted) reject();
    siteDetachStarted = true;
    // Resource closure never authorizes another effect or clears the journal.
    // A failed/lost acknowledgement is not replayed by finish().
    await io.lifecycle.detach(context());
    siteDetached = true;
  };
  const clock = (reconciling = false) => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now < lastTime ||
      now >= (reconciling ? approval?.reconcileByMs : approval?.maintenanceEndsAtMs)
    )
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = now;
  };
  const ownership = async () => {
    const bound = await prepared.journal.assertOwnership();
    if (!isDeepStrictEqual(bound, prepared.binding))
      throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    return bound;
  };
  const guard = async (reconciling = false) => {
    clock(reconciling);
    if (prepared) await ownership();
    // Approval's maintenance expiry is deliberately not extended. Reconciliation
    // uses the original protected absolute reconcile deadline and retained lock.
    if (!reconciling && !isDeepStrictEqual(await io.readApproval(request), approval))
      throw new Error('CUTOVER_APPROVAL_UNPROVEN');
    clock(reconciling);
  };
  const once = async (name, expected, effect, reconciling = false) => {
    if (phase !== expected || attempted.has(name)) reject();
    attempted.add(name); // Uncertain effects cannot be replayed by this adapter.
    await guard(reconciling);
    const value = await effect();
    await guard(reconciling);
    return value;
  };
  const assertStopped = async () => {
    await guard();
    const actual = await io.lifecycle.assertStopped(context(), structuredClone(stoppedEvidence));
    const now = io.now();
    if (
      actual?.inventoryDigest !== prepared.binding.inventoryDigest ||
      actual.phase !== 'stopped' ||
      !Number.isSafeInteger(actual.observedAtMs) ||
      actual.observedAtMs < 0 ||
      actual.observedAtMs > now ||
      now - actual.observedAtMs > 60000 ||
      !['survivors', 'listeners', 'unknownLaunchers'].every(
        (k) => Array.isArray(actual[k]) && actual[k].length === 0,
      )
    )
      throw new Error('CUTOVER_RUNTIME_UNPROVEN');
    const fence = await io.lifecycle.verifyFence(context());
    const interrupted = await validateOwnedLegacyFence(fence, {
      now: io.now,
      assertJournalOwnership: ownership,
      readFirstCutoverEffects: prepared.journal.readFirstCutoverEffects,
    });
    const observedNow = io.now();
    if (
      fence?.inventoryDigest !== prepared.binding.inventoryDigest ||
      fence.stage !== 'all-writers' ||
      !Number.isSafeInteger(fence.observedAtMs) ||
      fence.observedAtMs < 0 ||
      fence.observedAtMs > observedNow ||
      observedNow - fence.observedAtMs > 60000 ||
      fence.existingSockets !== 0 ||
      fence.internalWriters !== 0 ||
      fence.unsettledWork !== 0 ||
      (!interrupted && fence.externalWork !== 0) ||
      fence.producersRunning !== 0
    )
      throw new Error('CUTOVER_FENCE_UNPROVEN');
    await guard();
    return structuredClone(actual);
  };
  const sameIdentity = (value) =>
    value?.candidate === approval?.candidate &&
    /^[a-f0-9]{32}$/.test(value?.bootId ?? '') &&
    (!identity || value.bootId === identity.bootId);
  let verifiedCloudRuntime;
  const assertCloudRecovered = async () => {
    const effects = await prepared.journal.readFirstCutoverEffects();
    if (!effects.cloudMaintenanceScope) return;
    if (effects.cloudMaintenanceEvents?.length !== 8)
      throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
    const declared = effects.cloudMaintenanceScope[1];
    const runtime = await io.readCloudBrowserRecovery({
      attempt: approval.attempt,
      pmId: declared.pmId,
    });
    const now = io.now();
    if (
      runtime?.purpose !== 'cloud-browser-runtime-observation' ||
      runtime.name !== declared.name ||
      runtime.pmId !== declared.pmId ||
      runtime.launchDigest !== declared.recoveryDigest ||
      !Number.isSafeInteger(runtime.pid) ||
      runtime.pid <= 1 ||
      !Number.isSafeInteger(runtime.ppid) ||
      runtime.ppid <= 1 ||
      !Number.isSafeInteger(runtime.restartCount) ||
      runtime.restartCount < 0 ||
      !/^[a-f0-9]{64}$/.test(runtime.configDigest ?? '') ||
      !/^\d+$/.test(runtime.start ?? '') ||
      !uuid(runtime.bootId) ||
      !/^[a-f0-9]{64}$/.test(runtime.policyDigest ?? '') ||
      !/^mnt:\[\d+\]$/.test(runtime.mountNamespace ?? '') ||
      !Number.isSafeInteger(runtime.observedAtMs) ||
      runtime.observedAtMs > now ||
      now - runtime.observedAtMs > 60000 ||
      !isDeepStrictEqual(effects, await prepared.journal.readFirstCutoverEffects())
    )
      throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
    // The expensive beforeOpen observation cannot be silently replaced by a
    // different, independently plausible runtime at the actual send boundary.
    // Fresh timestamps may advance; identity/config/policy must remain exact.
    const { observedAtMs: _observedAtMs, ...stable } = runtime;
    if (verifiedCloudRuntime && !isDeepStrictEqual(verifiedCloudRuntime, stable))
      throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
    verifiedCloudRuntime = structuredClone(stable);
  };
  const control = async (op, target, discovery = false) => {
    if (!prepared || (!discovery && !sameIdentity(target)))
      throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    if (op === 'open') {
      // `opened` is a post-effect journal phase. Reject incomplete temporary
      // recovery here, before issuing open, not only when persisting success.
      await assertCloudRecovered();
      // The read-only physical observation can itself consume the remaining
      // window. Revalidate authority/deadline before, not after, sending open.
      await guard();
    }
    if (op === 'close') {
      // A lost response cannot authorize replay by an outer cleanup layer.
      if (closeAttempted) throw new Error('MAINTENANCE_CLOSE_UNPROVEN');
      closeAttempted = true;
    }
    const args = [
      '-u',
      'holaday',
      '--',
      '/opt/node22/bin/node',
      '--import',
      'tsx',
      `${prepared.root}/scripts/browser-maintenance-control.mjs`,
      op,
    ];
    if (!discovery) args.push(target.candidate, target.bootId);
    const value = JSON.parse(
      await io.exec('runuser', args, {
        cwd: `${prepared.root}/apps/orchestrator`,
        env,
      }),
    );
    if (
      value?.protocol !== 1 ||
      !sameIdentity(value.identity) ||
      (!discovery && value.identity.bootId !== target.bootId)
    )
      throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    return value;
  };
  const readiness = async (target) => {
    await guard();
    const { binding, root, applicationGid } = prepared;
    const scope = {
      binding: { ...binding },
      ...(approval.schemaVersion === 2
        ? {
            kind: 'first-cutover',
            riskDigest: cutoverLegacyInterruptionRisk(approval),
            ...(cutoverExactNavigationDeferral(approval)
              ? {
                  deferredWorkSetFingerprint:
                    cutoverExactNavigationDeferral(approval).setFingerprint,
                }
              : {}),
          }
        : {}),
      stage: target ? 'preopen' : 'prepare',
      window: {
        maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
        reconcileByMs: approval.reconcileByMs,
        operatorRef: approval.operatorRef,
      },
      ...(target ? { identity: { ...target } } : {}),
    };
    await collectCutoverEvidence(scope, {
      now: io.now,
      assertJournalOwnership: ownership,
      readFirstCutoverEffects: prepared.journal.readFirstCutoverEffects,
      ...Object.fromEntries(
        ['readHostInventory', 'readDatabaseScope', 'readRehearsalArtifacts', 'readFenceState'].map(
          (name) => [name, () => io.evidence[name](structuredClone(scope))],
        ),
      ),
      queryOrders: (orders) => io.evidence.queryOrders(orders, structuredClone(scope)),
      publishPrivate: (evidence) =>
        io.publishEvidence(evidence, {
          applicationGid,
          assertJournalOwnership: ownership,
          readFirstCutoverEffects: prepared.journal.readFirstCutoverEffects,
        }),
    });
    await guard();
    await io.exec(
      'runuser',
      [
        '-u',
        'holaday',
        '--',
        '/opt/node22/bin/node',
        '--import',
        'tsx',
        `${root}/apps/orchestrator/scripts/browser-maintenance-readiness.ts`,
        ...firstCutoverReadinessArguments(scope, binding, target),
      ],
      { cwd: `${root}/apps/orchestrator`, env },
    );
    await guard();
  };
  const assertManifest = async () => {
    if (io.manifest(prepared.root).sha256 !== approval.migrationDigest)
      throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
    if (
      createHash('sha256')
        .update(await io.readConfig())
        .digest('hex') !== approval.configDigest
    )
      throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
    await guard();
  };
  const adapter = {
    preflight: async (candidate) => {
      if (approval) reject();
      approval = structuredClone(await io.readApproval(request));
      if (approval.candidate !== candidate || approval.attempt !== request.attempt)
        throw new Error('CUTOVER_APPROVAL_UNPROVEN');
      if (
        approval.schemaVersion === 2 &&
        ['readLegacyDisposition', 'acceptLegacyInterruption'].some(
          (key) => typeof io.lifecycle[key] !== 'function',
        )
      )
        throw new Error('CUTOVER_HOST_OBSERVER_REQUIRED');
      await guard();
    },
    stage: () =>
      once('stage', 'preflight', async () => {
        prepared = await prepareFirstCutoverCandidate(request, io);
        if (!isDeepStrictEqual(prepared.approval, approval))
          throw new Error('CUTOVER_APPROVAL_UNPROVEN');
        const bytes = await io.readConfig();
        if (createHash('sha256').update(bytes).digest('hex') !== approval.configDigest)
          throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
        env = maintenanceCandidateEnvironment(
          parseMaintenanceCandidateConfig(bytes, prepared.root, io),
          approval.candidate,
        );
        siteAttachStarted = true;
        await io.lifecycle.attach(context());
        await guard();
        if ((await prepared.journal.readFirstCutoverEffects()).cloudMaintenanceScope) {
          // Site attachment binds the approved recovery material before this
          // attempt-private write. The stage is single-use, including failures.
          await io.prepareCloudBrowserPolicy(
            {
              attempt: prepared.binding.attempt,
              maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
            },
            {
              journal: prepared.journal,
              now: io.now,
              platform: io.platform,
              uid: io.uid,
            },
          );
          await guard();
        }
        await readiness();
      }),
    persist: async (next, detail) => {
      await guard(next === 'reconciled');
      await prepared.journal.persist(next, detail);
      phase = next;
    },
    readLegacyDisposition: async () => {
      await guard();
      if (phase !== 'orders_fenced') reject();
      if (approval.schemaVersion !== 2) return { mode: 'drained' };
      const disposition = await io.lifecycle.readLegacyDisposition(context());
      const expected = {
        mode: 'controlled-interruption',
        riskDigest: cutoverLegacyInterruptionRisk(approval),
      };
      if (!isDeepStrictEqual(disposition, expected)) reject();
      await guard();
      return expected;
    },
    acceptLegacyInterruption: () =>
      once('acceptLegacyInterruption', 'legacy_interruption_accepted', async () => {
        if (approval.schemaVersion !== 2) reject();
        await io.lifecycle.acceptLegacyInterruption(context());
      }),
    ...Object.fromEntries(
      [
        ['fenceOrders', 'orders_fenced'],
        ['settleLegacy', 'legacy_settled'],
        ['stopProducers', 'producers_stopped'],
        ['fenceAll', 'all_fenced'],
      ].map(([name, at]) => [name, () => once(name, at, () => io.lifecycle[name](context()))]),
    ),
    stopLegacy: () =>
      once('stopLegacy', 'stopped', async () => {
        stoppedEvidence = structuredClone(await io.lifecycle.stopLegacy(context()));
        stoppedEvidence = await assertStopped();
      }),
    backupAndRestoreCheck: () =>
      once('backupAndRestoreCheck', 'backup_verified', async () => {
        const plan = await io.lifecycle.readBackupPlan(context());
        if (
          !plan ||
          Object.keys(plan).length !== 2 ||
          !Object.hasOwn(plan, 'sourceIdentity') ||
          !Object.hasOwn(plan, 'isolatedTarget')
        )
          throw new Error('CUTOVER_BACKUP_UNPROVEN');
        await backupAndRestoreCheck(
          {
            ...plan,
            binding: prepared.binding,
            maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
          },
          {
            ...io.backup,
            now: io.now,
            assertOwnership: ownership,
            assertWritersStopped: assertStopped,
            sealReceipt: (receipt) => prepared.journal.bindBackupReceipt(receipt),
          },
        );
        // The target session is bound to backup scope, not the subsequent
        // production migration. A lost final ACK must hold before that phase.
        await io.backup.finishRecovery(context());
      }),
    migrate: () =>
      once('migrate', 'migration_started', async () => {
        await assertStopped();
        await assertManifest();
        for (const script of ['db:migrate:numbered', 'db:verify']) {
          await guard();
          await io.exec('pnpm', ['--filter', '@holaday/orchestrator', script], {
            cwd: prepared.root,
            env,
          });
          await guard();
        }
        migrated = true;
      }),
    initializeState: () =>
      once('initializeState', 'migration_started', async () => {
        if (!migrated) reject();
        stoppedEvidence = await assertStopped();
        const result = await initializeFirstMaintenanceState(
          {
            candidate: approval.candidate,
            attempt: approval.attempt,
            stoppedEvidence,
          },
          {
            platform: io.platform,
            uid: io.uid,
            fs: io.stateFs,
            now: io.now,
            applicationGid: prepared.applicationGid,
            assertJournalOwnership: ownership,
            assertStopped,
            readFirstCutoverEffects: prepared.journal.readFirstCutoverEffects,
            verifyFence: () => io.lifecycle.verifyFence(context()),
            recordBootstrap: (value) => prepared.journal.bindBootstrapSeed(value),
          },
        );
        seed = result.bootstrapSeed;
      }),
    start: () =>
      once('start', 'candidate_started', async () => {
        if (!seed || !migrated) reject();
        await assertStopped();
        await assertManifest();
        const root = prepared.root;
        await io.exec(
          'pm2',
          [
            'start',
            `${root}/scripts/start-orchestrator-production.sh`,
            '--name',
            'holaday-orchestrator',
            '--interpreter',
            '/usr/bin/bash',
            '--cwd',
            `${root}/apps/orchestrator`,
            '--uid',
            '998',
            '--gid',
            String(prepared.applicationGid),
            '--no-autorestart',
          ],
          { cwd: root, env },
        );
        const until = Math.min(io.now() + 60000, approval.maintenanceEndsAtMs);
        for (;;) {
          await guard();
          let status;
          try {
            status = await control('status', undefined, true);
          } catch (error) {
            if (io.now() >= until) throw error;
            await io.sleep(100);
            continue;
          }
          identity = { ...status.identity }; // Retain known identity even on dirty-start failure.
          if (
            identity.bootId === seed ||
            status.mode !== 'closed' ||
            status.idle !== true ||
            status.needsReconciliation !== false
          )
            throw new Error('MAINTENANCE_START_UNPROVEN');
          await io.observe(identity);
          if (approval.schemaVersion === 2) await prepared.journal.bindCandidateIdentity(identity);
          return { ...identity };
        }
      }),
    verify: (target) =>
      once('verify', 'candidate_started', async () => {
        if (!sameIdentity(target)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
        await io.observe(target);
        await readiness(target);
      }),
    beforeOpen: (target) =>
      once('beforeOpen', 'verified', async () => {
        if (!sameIdentity(target)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
        await io.observe(target);
        if ((await prepared.journal.readFirstCutoverEffects()).cloudMaintenanceScope) {
          try {
            if (
              typeof io.lifecycle.restoreCloudServices !== 'function' ||
              (await io.lifecycle.restoreCloudServices(context(), target)) !== undefined
            )
              throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
          } catch {
            throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
          }
          await guard();
        }
        await readiness(target);
        // Fail outside the release tail's lost-open-ACK reconciliation branch.
        await assertCloudRecovered();
      }),
    open: (target) => once('open', 'verified', () => control('open', target)),
    status: async (target) => {
      await guard();
      return control('status', target);
    },
    close: (target) => control('close', target), // Protective close is never deadline-gated.
    afterOpen: (target) =>
      once('afterOpen', 'verified', async () => {
        const status = await control('status', target);
        if (
          status.mode !== 'serving' ||
          status.idle !== false ||
          status.needsReconciliation !== true
        )
          throw new Error('MAINTENANCE_OPEN_UNPROVEN');
        await io.lifecycle.restoreIngress(context(), target);
      }),
    resumeWorker: (target) =>
      once('resumeWorker', 'verified', async () => {
        await io.lifecycle.resumeWorker(context(), target);
        await guard();
      }),
    reconcile: (target) =>
      once(
        'reconcile',
        'reconciled',
        async () => {
          if (!sameIdentity(target)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
          await io.lifecycle.reconcile(context(), target);
          reconciled = true;
        },
        true,
      ),
    holdMaintenance: async (result) => {
      const persistedHold = async () => {
        if (!prepared || !holdAttempt) reject();
        await ownership();
        const record = await prepared.journal.readFirstCutoverEffects();
        const observation = record.failureObservation;
        if (
          !observation ||
          observation.phase !== holdAttempt.phase ||
          observation.operatorRef !== approval.operatorRef ||
          observation.reconcileByMs !== approval.reconcileByMs ||
          observation.errorCode !== holdAttempt.errorCode ||
          !isDeepStrictEqual(observation.identity, holdAttempt.identity) ||
          !Number.isSafeInteger(observation.observedAtMs) ||
          observation.observedAtMs < holdAttempt.startedAtMs ||
          observation.observedAtMs > io.now() ||
          (holdAttempt.record && !isDeepStrictEqual(record, holdAttempt.record))
        )
          reject();
        await ownership();
        if (!isDeepStrictEqual(record, await prepared.journal.readFirstCutoverEffects())) reject();
        return record;
      };
      if (holdAttempt) {
        const record = await persistedHold();
        // Observe the original acknowledgement; never resend close or replace
        // the first durable failure observation after a lost response.
        return {
          closeAcknowledged: record.failureObservation.status.closeAcknowledged,
        };
      }
      const before = prepared ? await prepared.journal.readFirstCutoverEffects() : undefined;
      if (before?.failureObservation) reject();
      const code = result.errorCode ?? result.code;
      holdAttempt = {
        phase: before?.phase,
        identity: identity ? structuredClone(identity) : undefined,
        startedAtMs: io.now(),
        errorCode: /^(CUTOVER|MAINTENANCE)_[A-Z_]{1,100}$/.test(code ?? '')
          ? code
          : 'CUTOVER_FAILED',
      };
      let closeAcknowledged = result.closeAcknowledged === true;
      if (identity && !closeAcknowledged) {
        try {
          closeAcknowledged = (await control('close', identity)).mode === 'closed';
        } catch {
          closeAcknowledged = false;
        }
      }
      if (prepared) {
        try {
          const held = await io.lifecycle.holdMaintenance(context(), {
            ...result,
            identity,
            closeAcknowledged,
          });
          closeAcknowledged = held?.closeAcknowledged === true;
        } finally {
          try {
            holdAttempt.record = structuredClone(await persistedHold());
          } catch {
            // Missing/foreign/unknown persistence cannot authorize a retry.
          }
        }
      }
      return { closeAcknowledged };
    },
    finish: async (result) => {
      if (!prepared) return;
      try {
        if (siteAttachStarted && !siteDetachStarted) await detachSite();
        if (result.ok) {
          if (
            !siteDetached ||
            !reconciled ||
            phase !== 'reconciled' ||
            !sameIdentity(result.identity)
          )
            reject();
          await guard(true);
          await prepared.journal.finish();
        }
      } catch (error) {
        await adapter.holdMaintenance({ phase, closeAcknowledged: false });
        throw error;
      } finally {
        await prepared.journal.close();
      }
    },
  };
  return adapter;
}

/** Preparation segment of the first host, not a deploy command or readiness
 * proof. Real source classification is mandatory and has no permissive default.
 * A successful return retains the actual journal for the remaining lifecycle;
 * failure closes handles only, preserving the lock and any staged candidate.
 */
export async function prepareFirstCutoverCandidate(options, overrides = {}) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    ...overrides,
  };
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (!options || Object.keys(options).length !== 1 || !uuid(options.attempt))
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  if (typeof io.inspectLegacySource !== 'function')
    throw new Error('CUTOVER_HOST_OBSERVER_REQUIRED');
  const approval = structuredClone(await io.readApproval(options));
  const binding = Object.fromEntries(
    ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map((key) => [
      key,
      approval[key],
    ]),
  );
  const root = `/opt/holaday-releases/${approval.candidate}`;
  const sourceRoot = '/opt/holaday-monorepo';
  let journal;
  let preparationStage = 'APPROVAL';
  let lastTime = -1;
  const guard = async () => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now < lastTime ||
      now >= approval.maintenanceEndsAtMs
    )
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = now;
    if (!isDeepStrictEqual(await io.readApproval(options), approval))
      throw new Error('CUTOVER_APPROVAL_UNPROVEN');
    if (journal && !isDeepStrictEqual(await journal.assertOwnership(), binding))
      throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    const after = io.now();
    if (!Number.isSafeInteger(after) || after < now || after >= approval.maintenanceEndsAtMs)
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = after;
  };
  const source = async () => {
    preparationStage = 'LEGACY_SOURCE';
    const observed = await io.inspectLegacySource(structuredClone(approval));
    preparationStage = 'SOURCE_RESULT';
    const now = io.now();
    if (
      !/^[a-f0-9]{40}$/.test(observed?.sourceCandidate ?? '') ||
      observed.legacyDigest !== approval.legacyDigest ||
      !Number.isSafeInteger(observed.observedAtMs) ||
      observed.observedAtMs < 0 ||
      observed.observedAtMs > now ||
      now - observed.observedAtMs > 60000
    )
      throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
    return observed.sourceCandidate;
  };
  try {
    preparationStage = 'INITIAL_GUARD';
    await guard();
    const sourceCandidate = await source();
    preparationStage = 'CONFIG_READ';
    const config = Buffer.from(await io.readConfig());
    preparationStage = 'CONFIG_DIGEST';
    if (createHash('sha256').update(config).digest('hex') !== approval.configDigest)
      throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
    preparationStage = 'CONFIG_POLICY';
    const parsed = parseMaintenanceCandidateConfig(config, sourceRoot, io);
    preparationStage = 'USER_UID';
    if ((await io.exec('id', ['-u', 'holaday'])).trim() !== '998')
      throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
    preparationStage = 'USER_GID';
    const gidText = (await io.exec('id', ['-g', 'holaday'])).trim();
    const gid = Number(gidText);
    if (!/^[1-9][0-9]*$/.test(gidText) || !Number.isSafeInteger(gid))
      throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
    preparationStage = 'TARGET_ABSENT';
    await io.targetAbsent(root);
    preparationStage = 'FINAL_GUARD';
    await guard();
    preparationStage = 'JOURNAL_BOUNDARY';
    journal = await io.journal(directory, {
      ...binding,
      kind: 'first-cutover',
      legacyDigest: approval.legacyDigest,
      ...(approval.schemaVersion === 2
        ? {
            schemaVersion: 2,
            legacyInterruption: approval.legacyInterruption,
            ...(approval.exactLegacyNavigationDeferral
              ? { exactLegacyNavigationDeferral: approval.exactLegacyNavigationDeferral }
              : {}),
            maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
            reconcileByMs: approval.reconcileByMs,
            operatorRef: approval.operatorRef,
            riskDigest: cutoverLegacyInterruptionRisk(approval),
          }
        : {}),
    });
    await guard();
    await stageReleaseCandidate(
      {
        branch: approval.branch,
        candidate: approval.candidate,
        sourceRoot,
        sourceCandidate,
        config,
        configDigest: approval.configDigest,
        migrationDigest: approval.migrationDigest,
        gid,
        env: maintenanceCandidateEnvironment(parsed, approval.candidate),
      },
      {
        ...io,
        assertOwnership: guard,
        bindManifest: async (manifest) => {
          if (
            (await source()) !== sourceCandidate ||
            createHash('sha256')
              .update(await io.readConfig())
              .digest('hex') !== approval.configDigest
          )
            throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
          await guard();
          await journal.bindManifest(manifest);
        },
      },
    );
    return {
      approval,
      binding,
      root,
      sourceCandidate,
      applicationGid: gid,
      journal,
    };
  } catch (error) {
    try {
      if (typeof io.onPreparationFailure === 'function')
        io.onPreparationFailure(preparationStage, error);
    } catch {
      // Diagnostic callbacks cannot replace the preparation failure.
    } finally {
      await journal?.close();
    }
    throw error;
  }
}

/** Read-only approval metadata, not evidence that hosts/payments are safe.
 * The future host adapter must still collect live facts under its real journal.
 * Importing this module never starts a service, opens a database, or reads secrets. */
export async function assertFirstCutoverReconciliationRead(
  { binding, maintenanceEndsAtMs, reconcileByMs },
  journal,
  now,
  identity,
) {
  const reject = () => {
    throw new Error('CUTOVER_RECONCILIATION_READ_UNPROVEN');
  };
  if (
    !Number.isSafeInteger(reconcileByMs) ||
    reconcileByMs < maintenanceEndsAtMs ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now >= reconcileByMs ||
    !isDeepStrictEqual(await journal.assertOwnership(), binding)
  )
    reject();
  const record = await journal.readFirstCutoverEffects();
  if (
    !binding ||
    !['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].every(
      (k) => record[k] === binding[k],
    ) ||
    record.phase !== 'reconciled' ||
    !record.identity ||
    record.identity.candidate !== binding.candidate ||
    !/^[a-f0-9]{32}$/.test(record.identity.bootId ?? '') ||
    record.identity.bootId === record.bootstrapSeed ||
    (identity && !isDeepStrictEqual(record.identity, identity)) ||
    (record.schemaVersion === 2 &&
      (record.maintenanceEndsAtMs !== maintenanceEndsAtMs ||
        record.reconcileByMs !== reconcileByMs))
  )
    reject();
  return structuredClone(record);
}

// Protected approval reread only. This does not authorize effects or extend a
// deadline; live reconciliation callers separately prove owned journal identity.
export function readFirstCutoverReconciliationApproval(options, io = system) {
  return readProtectedFirstCutoverApproval(options, io, true);
}
export function readFirstCutoverApproval(options, io = system) {
  return readProtectedFirstCutoverApproval(options, io, false);
}
async function readProtectedFirstCutoverApproval(options, io, reconciliation) {
  let handle;
  let stage = 'APPROVAL_INPUT';
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !options ||
      Object.keys(options).length !== 1 ||
      !uuid(options.attempt)
    )
      throw new Error('input');
    stage = 'APPROVAL_CLOCK';
    const began = io.now();
    if (!Number.isSafeInteger(began) || began < 0) throw new Error('clock');
    stage = 'APPROVAL_FOLDER';
    const folder = await io.lstat(directory);
    if (!privateDirectory(folder) || (await io.realpath(directory)) !== directory)
      throw new Error('directory');
    stage = 'APPROVAL_FILE';
    handle = await io.open(
      approvalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!privateFile(before) || before.size < 1 || before.size > 64 * 1024) throw new Error('file');
    stage = 'APPROVAL_CONTENT';
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await io.lstat(approvalPath);
    const currentFolder = await io.lstat(directory);
    stage = 'APPROVAL_CHANGED';
    if (
      !privateFile(after) ||
      !privateFile(current) ||
      !sameFile(before, after) ||
      !sameFile(after, current) ||
      before.size !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.size !== current.size ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs ||
      !privateDirectory(currentFolder) ||
      !sameFile(folder, currentFolder) ||
      (await io.realpath(directory)) !== directory ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)
    )
      throw new Error('changed');
    stage = 'APPROVAL_JSON';
    const record = JSON.parse(bytes.toString('utf8'));
    const now = io.now();
    stage = 'APPROVAL_BINDING';
    const expectedFields =
      record?.schemaVersion === 2
        ? [
            ...fields,
            'legacyInterruption',
            ...(record.exactLegacyNavigationDeferral !== undefined
              ? ['exactLegacyNavigationDeferral']
              : []),
          ]
        : fields;
    if (
      !record ||
      Object.keys(record).length !== expectedFields.length ||
      !expectedFields.every((k) => Object.hasOwn(record, k)) ||
      ![1, 2].includes(record.schemaVersion) ||
      record.kind !== 'first-cutover' ||
      record.attempt !== options.attempt ||
      typeof record.branch !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(record.branch) ||
      typeof record.candidate !== 'string' ||
      !/^[a-f0-9]{40}$/.test(record.candidate) ||
      !['configDigest', 'migrationDigest', 'inventoryDigest', 'legacyDigest'].every(
        (k) => typeof record[k] === 'string' && /^[a-f0-9]{64}$/.test(record[k]),
      ) ||
      !Number.isSafeInteger(record.maintenanceEndsAtMs) ||
      !Number.isSafeInteger(record.reconcileByMs) ||
      record.reconcileByMs < record.maintenanceEndsAtMs ||
      (!Number.isSafeInteger(now) && ((stage = 'APPROVAL_CLOCK'), true)) ||
      (now < began && ((stage = 'APPROVAL_CLOCK'), true)) ||
      (now >= (reconciliation ? record.reconcileByMs : record.maintenanceEndsAtMs) &&
        ((stage = 'APPROVAL_DEADLINE'), true)) ||
      typeof record.operatorRef !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(record.operatorRef)
    )
      throw new Error('binding');
    stage = 'APPROVAL_RISK';
    const risk =
      record.schemaVersion === 2 ? { riskDigest: cutoverLegacyInterruptionRisk(record) } : {};
    return {
      ...record,
      ...risk,
      approvalDigest: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    throw ingressDiagnosticError('CUTOVER_APPROVAL_UNPROVEN', stage, error);
  } finally {
    await handle?.close();
  }
}

/** Local ingress slice of the existing first-cutover lifecycle. The site owns
 * the protected approval reader and LIVE shared journal; these callbacks are
 * trusted code, not a deserialized authorization or a remote success report.
 * Construction observes only. Each mutation requires the persisted phase intent,
 * pins that journal revision throughout the operation, and is attempted once.
 * Files/store/nginx/TLS default to the actual local Linux implementations.
 * This does not replace business settlement, stop proof, or cross-host transport.
 */
export async function createFirstCutoverIngressLifecycle(input, overrides = {}) {
  const reject = (stage = 'LOCAL_ENTRY', previous) => {
    throw ingressDiagnosticError('CUTOVER_INGRESS_LIFECYCLE_UNPROVEN', stage, previous);
  };
  try {
    const io = {
      platform: process.platform,
      uid: process.getuid?.(),
      now: Date.now,
      ...overrides,
    };
    const { binding, maintenanceEndsAtMs, reconcileByMs } = structuredClone(input);
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      ['assertOwnership', 'readFirstCutoverEffects'].some(
        (k) => typeof io.journal?.[k] !== 'function',
      ) ||
      ['readApprovedIngress', 'observeWriters', 'verifyOpenedIdentity'].some(
        (k) => typeof io[k] !== 'function',
      )
    )
      reject();
    const journal = {
      assertOwnership: io.journal.assertOwnership.bind(io.journal),
      readFirstCutoverEffects: io.journal.readFirstCutoverEffects.bind(io.journal),
    };
    let last = -1;
    let approval = null;
    let revision;
    let busy = false;
    let failed = false;
    const attempted = new Set();
    const clock = (readOnly = false) => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < last ||
        now >= (readOnly ? (reconcileByMs ?? maintenanceEndsAtMs) : maintenanceEndsAtMs)
      )
        reject('LOCAL_CLOCK');
      last = now;
    };
    const guard = async (phases, readOnly = false) => {
      let reconciliation;
      if (readOnly && io.now() >= maintenanceEndsAtMs)
        reconciliation = await assertFirstCutoverReconciliationRead(
          { binding, maintenanceEndsAtMs, reconcileByMs },
          journal,
          io.now(),
        );
      clock(readOnly);
      let owner;
      try {
        owner = await journal.assertOwnership();
      } catch (error) {
        reject('LOCAL_OWNER', error);
      }
      if (!isDeepStrictEqual(owner, binding)) reject('LOCAL_OWNER');
      let record;
      try {
        record = await journal.readFirstCutoverEffects();
      } catch (error) {
        reject('LOCAL_EFFECTS', error);
      }
      if (
        !Object.entries(binding).every(([key, value]) => record[key] === value) ||
        !/^[a-f0-9]{64}$/.test(record.recordDigest ?? '') ||
        (revision !== undefined && revision !== record.recordDigest)
      )
        reject('LOCAL_REVISION');
      if (phases && !phases.includes(record.phase)) reject('LOCAL_PHASE');
      if (reconciliation && !isDeepStrictEqual(record, reconciliation)) reject();
      let current;
      try {
        current = structuredClone(await io.readApprovedIngress());
      } catch (error) {
        reject('LOCAL_SCOPE', error);
      }
      if (
        current?.inventoryDigest !== binding.inventoryDigest ||
        !Array.isArray(current.unknownIngress) ||
        current.unknownIngress.length ||
        (approval && !isDeepStrictEqual(current, approval))
      )
        reject('LOCAL_SCOPE');
      clock(readOnly);
      return { record, current };
    };
    const initial = await guard(['preflight', 'prepared']);
    approval = initial.current;
    revision = initial.record.recordDigest;
    const assertJournalOwnership = async () => {
      await guard();
      return structuredClone(binding);
    };
    const dependencies = {
      ...io,
      assertJournalOwnership,
      assertReconciliationRead: async () => {
        await guard(undefined, true);
        return structuredClone(binding);
      },
      readApprovedIngress: async () => {
        await guard();
        return structuredClone(approval);
      },
      nginx: { ...io.nginx, maintenanceEndsAtMs },
      ingressProbe: { ...io.ingressProbe, observeWriters: io.observeWriters },
      verifyOpenedIdentity: async (identity) => {
        const { record } = await guard(['verified']);
        if (
          !isDeepStrictEqual(record.identity, identity) ||
          identity.candidate !== binding.candidate
        )
          reject();
        const opened = await io.verifyOpenedIdentity(structuredClone(identity));
        if (
          !isDeepStrictEqual(opened?.identity, identity) ||
          opened.mode !== 'serving' ||
          opened.idle !== false ||
          opened.needsReconciliation !== true
        )
          reject();
        await guard(['verified']);
        return opened;
      },
    };
    const args = {
      binding,
      files: approval.files,
      maintenanceEndsAtMs,
      ...(reconcileByMs !== undefined ? { reconcileByMs } : {}),
    };
    Object.assign(dependencies, await createFirstCutoverFenceStore(args, dependencies));
    Object.assign(dependencies, await createCutoverIngressFiles(args, dependencies));
    await guard(['preflight', 'prepared']);
    revision = undefined;
    const run = async (name, phases, operation, mutation = false) => {
      if (busy || (mutation && (failed || attempted.has(name)))) reject();
      busy = true;
      if (mutation) attempted.add(name);
      try {
        const readOnly = name === 'receipt';
        const { record } = await guard(phases, readOnly);
        revision = record.recordDigest;
        const value = await operation();
        await guard(phases, readOnly);
        return value;
      } catch (error) {
        if (mutation) failed = true;
        reject(name === 'receipt' ? 'LOCAL_RECEIPT' : 'LOCAL_ENTRY', error);
      } finally {
        revision = undefined;
        busy = false;
      }
    };
    const verifyPhases = [
      'all_fenced',
      'stopped',
      'backup_verified',
      'migration_started',
      'candidate_started',
      'verified',
    ];
    return {
      fenceOrders: () =>
        run(
          'orders',
          ['orders_fenced'],
          () =>
            applyCutoverFence(
              { inventoryDigest: binding.inventoryDigest, stage: 'orders' },
              dependencies,
            ),
          true,
        ),
      fenceAll: () =>
        run(
          'all-writers',
          ['all_fenced'],
          () =>
            applyCutoverFence(
              {
                inventoryDigest: binding.inventoryDigest,
                stage: 'all-writers',
              },
              dependencies,
            ),
          true,
        ),
      verifyFence: () =>
        run('verify', verifyPhases, () =>
          verifyCutoverFence(
            { inventoryDigest: binding.inventoryDigest, stage: 'all-writers' },
            dependencies,
          ),
        ),
      verifyOrders: () =>
        run(
          'verify-orders',
          ['orders_fenced', 'legacy_settled', 'legacy_interruption_accepted', 'producers_stopped'],
          () =>
            verifyCutoverFence(
              { inventoryDigest: binding.inventoryDigest, stage: 'orders' },
              dependencies,
            ),
        ),
      restoreIngress: (identity) =>
        run(
          'restore',
          ['verified'],
          () =>
            restoreCutoverIngress(
              {
                inventoryDigest: binding.inventoryDigest,
                identity: structuredClone(identity),
              },
              dependencies,
            ),
          true,
        ),
      // Preserve read-only access to an uncertain installing/restoring receipt;
      // it is diagnostic evidence, never an instruction to replay the operation.
      readFenceReceipt: () => run('receipt', undefined, () => dependencies.readFenceReceipt()),
    };
  } catch (error) {
    reject('LOCAL_ENTRY', error);
  }
}

/** Durable local-host receipts for the existing fence protocol. Caller supplies
 * the real shared journal and protected file scope. Never resumes an old attempt,
 * proves isolation, reloads nginx or grants permission to restore on its own.
 * The journal excludes cooperative concurrent deployment; this is not root-adversary CAS.
 */
export async function createFirstCutoverFenceStore(input, io) {
  const disk = io.fs ?? fs;
  const reject = (stage = 'STORE_READ', previous) => {
    throw ingressDiagnosticError('CUTOVER_FENCE_RECORD_UNPROVEN', stage, previous);
  };
  const observe = async (stage, operation) => {
    try {
      return await operation();
    } catch (error) {
      reject(stage, error);
    }
  };
  const wrap =
    (operation) =>
    async (...args) => {
      try {
        return await operation(...args);
      } catch (error) {
        reject('STORE_READ', error);
      }
    };
  return wrap(async () => {
    const { binding, files, maintenanceEndsAtMs, reconcileByMs } = structuredClone(input);
    const bindingKeys = [
      'attempt',
      'candidate',
      'configDigest',
      'migrationDigest',
      'inventoryDigest',
    ];
    const hash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
    if (
      (io.platform ?? process.platform) !== 'linux' ||
      (io.uid ?? process.getuid?.()) !== 0 ||
      !binding ||
      Object.keys(binding).length !== bindingKeys.length ||
      !uuid(binding.attempt) ||
      !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
      !['configDigest', 'migrationDigest', 'inventoryDigest'].every((key) => hash(binding[key])) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      !Array.isArray(files) ||
      !files.length ||
      files.length > 3 ||
      new Set(files.map((f) => f.path)).size !== files.length ||
      files.some(
        (f) =>
          !/^\/etc\/nginx\/sites-available\/(?:holaday|hd-app\.orangebench\.tech|hd-pay\.orangebench\.tech)$/.test(
            f.path ?? '',
          ) || !hash(f.digest),
      )
    )
      reject();
    let lastTime = -1;
    let failed = false;
    let current;
    let currentStat;
    let currentBytes;
    let queue = Promise.resolve();
    const path = `${directory}/${binding.attempt}.ingress.json`;
    const sameStat = (a, b) =>
      ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].every(
        (key) => a[key] === b[key],
      );
    const guard = async (readOnly = false) => {
      const now = io.now();
      if (
        failed ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < lastTime ||
        now >= (readOnly ? (reconcileByMs ?? maintenanceEndsAtMs) : maintenanceEndsAtMs)
      )
        reject('STORE_CLOCK');
      const owner = await observe('STORE_OWNER', () =>
        readOnly && now >= maintenanceEndsAtMs
          ? typeof io.assertReconciliationRead === 'function'
            ? io.assertReconciliationRead()
            : reject('STORE_OWNER')
          : io.assertJournalOwnership(),
      );
      const after = io.now();
      if (
        !bindingKeys.every((key) => owner?.[key] === binding[key]) ||
        !Number.isSafeInteger(after) ||
        after < now ||
        after >= (readOnly ? (reconcileByMs ?? maintenanceEndsAtMs) : maintenanceEndsAtMs)
      )
        reject('STORE_OWNER');
      lastTime = after;
    };
    await guard();
    const folder = await observe('STORE_FOLDER', () => disk.lstat(directory));
    const checkFolder = async () => {
      const current = await observe('STORE_FOLDER', () => disk.lstat(directory));
      if (
        !privateDirectory(current) ||
        !sameFile(folder, current) ||
        (await observe('STORE_FOLDER', () => disk.realpath(directory))) !== directory
      )
        reject('STORE_FOLDER');
    };
    await checkFolder();
    const absent = async () => {
      try {
        await disk.lstat(path);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        reject('STORE_ABSENCE', error);
      }
      reject('STORE_ABSENCE');
    };
    await absent(); // A partial/historical record is never an invitation to resume.
    const read = async () => {
      await guard(true);
      await checkFolder();
      if (!current) {
        await absent();
        return undefined;
      }
      const h = await observe('STORE_FILE', () =>
        disk.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
      );
      try {
        const before = await observe('STORE_FILE', () => h.stat());
        if (!privateFile(before) || !sameStat(currentStat, before) || before.size > 16 * 1024)
          reject('STORE_FILE');
        const bytes = await observe('STORE_CONTENT', () => h.readFile());
        if (
          !bytes.equals(currentBytes) ||
          !sameStat(before, await observe('STORE_FILE', () => h.stat())) ||
          !sameStat(before, await observe('STORE_FILE', () => disk.lstat(path)))
        )
          reject('STORE_CONTENT');
      } finally {
        await observe('STORE_FILE', () => h.close());
      }
      await checkFolder();
      await guard(true);
      return structuredClone(current);
    };
    const phase = (r) => (r ? `${r.stage}:${r.phase}` : 'new');
    const phases = [
      'new',
      'orders:installing',
      'orders:active',
      'all-writers:installing',
      'all-writers:active',
      'all-writers:restoring',
      'all-writers:restored',
    ];
    const validate = (r) => {
      const restoring = ['restoring', 'restored'].includes(r?.phase);
      const keys = [
        'schemaVersion',
        'attempt',
        'inventoryDigest',
        'stage',
        'phase',
        'files',
        ...(restoring ? ['identity'] : []),
      ];
      if (
        !r ||
        Object.keys(r).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(r, key)) ||
        r.schemaVersion !== 1 ||
        r.attempt !== binding.attempt ||
        r.inventoryDigest !== binding.inventoryDigest ||
        phases.indexOf(phase(r)) !== phases.indexOf(phase(current)) + 1 ||
        !Array.isArray(r.files) ||
        r.files.length !== files.length
      )
        reject();
      for (const [index, expected] of files.entries()) {
        const value = r.files[index];
        if (
          !value ||
          Object.keys(value).length !== 4 ||
          value.path !== expected.path ||
          value.originalDigest !== expected.digest ||
          value.backupDigest !== expected.digest ||
          !hash(value.generatedDigest)
        )
          reject();
      }
      // Only the start of the next isolation stage may change generated content.
      if (current && r.phase !== 'installing' && !isDeepStrictEqual(r.files, current.files))
        reject();
      if (
        restoring &&
        (!r.identity ||
          Object.keys(r.identity).length !== 2 ||
          r.identity.candidate !== binding.candidate ||
          !/^[a-f0-9]{32}$/.test(r.identity.bootId ?? '') ||
          (r.phase === 'restored' && !isDeepStrictEqual(r.identity, current.identity)))
      )
        reject();
    };
    const persist = async (r) => {
      validate(r);
      await read();
      const bytes = Buffer.from(`${JSON.stringify(r)}\n`);
      if (bytes.length > 16 * 1024) reject();
      const destination = current
        ? `${directory}/${binding.attempt}.${randomUUID()}.ingress.tmp`
        : path;
      let h;
      let folderHandle;
      try {
        await guard();
        await checkFolder();
        folderHandle = await disk.open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        if (!sameFile(folder, await folderHandle.stat())) reject();
        h = await disk.open(
          destination,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await h.writeFile(bytes);
        await h.sync();
        const written = await h.stat();
        if (!privateFile(written) || written.size !== bytes.length) reject();
        await h.close();
        h = undefined;
        if (current) await read();
        await checkFolder();
        if (!sameStat(written, await disk.lstat(destination))) reject();
        await guard();
        if (current) await disk.rename(destination, path);
        await folderHandle.sync();
        const installed = await disk.lstat(path);
        if (
          !privateFile(installed) ||
          !sameFile(written, installed) ||
          installed.size !== bytes.length
        )
          reject();
        current = structuredClone(r);
        currentBytes = bytes;
        currentStat = installed;
        await read();
      } catch (error) {
        failed = true; // Preserve uncertain files and stop; never retry or auto-clean.
        throw error;
      } finally {
        await h?.close();
        await folderHandle?.close();
      }
    };
    const serial = (operation) => {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    };
    return {
      readFenceReceipt: () => serial(wrap(read)),
      persistFenceReceipt: (value) => {
        const record = structuredClone(value);
        return serial(wrap(() => persist(record)));
      },
    };
  })();
}
