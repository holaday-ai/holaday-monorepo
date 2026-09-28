import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectCutoverEvidence, publishCutoverEvidence } from './browser-cutover-evidence.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';
import {
  createMaintenanceStopEffects,
  inspectMaintenanceSystem,
  observeMaintenanceRuntime,
} from './browser-maintenance-linux.mjs';
import { buildMaintenanceMigrationManifest } from './browser-maintenance-manifest.mjs';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';
import { performMaintenanceRelease } from './browser-maintenance-transition.mjs';

const node = '/opt/node22/bin/node';
const storage = '/var/lib/holaday-deploy/maintenance';
const configPath = '/var/lib/holaday-deploy/maintenance-target.env';
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) =>
  sha(a?.candidate) &&
  /^[a-f0-9]{32}$/.test(a?.bootId ?? '') &&
  a.candidate === b?.candidate &&
  a.bootId === b?.bootId;
const rootFor = (candidate) => `/opt/holaday-releases/${candidate}`;
const stable = (error) =>
  /^(MAINTENANCE_[A-Z_]+|LEGACY_DRAIN_UNSUPPORTED)$/.test(error?.message)
    ? error.message
    : 'MAINTENANCE_RELEASE_FAILED';

const system = {
  platform: process.platform,
  uid: process.getuid?.(),
  now: () => performance.now(),
  wallNow: Date.now,
  publishEvidence: publishCutoverEvidence,
  sleep,
  exec: async (command, args, options = {}) => {
    try {
      // Do not timeout/kill an uncertain migration or build and retry it.
      const { input, ...settings } = options;
      return await new Promise((resolve, reject) => {
        const child = execFile(
          command,
          args,
          { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...settings },
          (error, stdout, stderr) => {
            if (error) {
              error.stderr = stderr;
              reject(error);
            } else resolve(stdout);
          },
        );
        child.stdin.on('error', () => {});
        child.stdin.end(input);
      });
    } catch (error) {
      const code = String(error.stderr ?? '').trim();
      throw new Error(/^MAINTENANCE_[A-Z_]+$/.test(code) ? code : 'MAINTENANCE_COMMAND_FAILED');
    }
  },
  readConfig: async () => {
    const handle = await fs.open(
      configPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== 0 ||
        (stat.mode & 0o7777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size < 1 ||
        stat.size > 1024 * 1024
      )
        throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
      const bytes = await handle.readFile();
      if (bytes.length !== stat.size) throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
      return bytes;
    } finally {
      await handle.close();
    }
  },
  parseConfig: (bytes, oldRoot) =>
    createRequire(`${oldRoot}/apps/orchestrator/package.json`)('dotenv').parse(bytes),
  stageConfig: async (root, bytes, gid) => {
    if ((await fs.realpath(`${root}/apps/orchestrator`)) !== `${root}/apps/orchestrator`)
      throw new Error('MAINTENANCE_TARGET_UNPROVEN');
    const handle = await fs.open(`${root}/apps/orchestrator/.env.local`, 'wx', 0o640);
    try {
      await handle.writeFile(bytes);
      await handle.chown(0, Number(gid));
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  targetAbsent: async (root) => {
    try {
      await fs.lstat(root);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    throw new Error('MAINTENANCE_TARGET_EXISTS');
  },
  journal: acquireReleaseJournal,
  manifest: buildMaintenanceMigrationManifest,
  observe: observeMaintenanceRuntime,
  stopEffects: createMaintenanceStopEffects,
  retire: retireMaintenanceRuntime,
  assertStopped: async (captured) => {
    const effects = createMaintenanceStopEffects();
    if (
      (await effects.readProcess(captured.main.pid)) ||
      (captured.worker && (await effects.readProcess(captured.worker.pid))) ||
      !(await effects.managerStopped('main', captured.main)) ||
      !(await effects.managerStopped('worker', captured.worker)) ||
      !(await effects.portsFree())
    )
      throw new Error('MAINTENANCE_STOP_UNPROVEN');
    const observed = await inspectMaintenanceSystem();
    if (observed.processes.length) throw new Error('MAINTENANCE_STOP_UNPROVEN');
  },
};

export function candidatePreparationSystem() {
  return { ...system };
}

export function parseMaintenanceCandidateConfig(bytes, sourceRoot, io) {
  const parsed = io.parseConfig(bytes, sourceRoot);
  if (
    parsed.MODEL_RUNTIME_POLICY !== 'qwen_only' ||
    [
      'QWEN_CORE_ENABLED_LANES',
      'DASHSCOPE_INTL_API_KEY',
      'DASHSCOPE_INTL_ANTHROPIC_BASE_URL',
      'DASHSCOPE_INTL_RESPONSES_BASE_URL',
    ].some((key) => !parsed[key]?.trim()) ||
    !['off', 'synthetic', 'internal', 'all'].includes(parsed.QWEN_CORE_ROLLOUT_MODE) ||
    parsed.TEAM_TASK_LIFECYCLE_ENABLED !== 'false' ||
    !['true', 'false'].includes(parsed.ACCOUNT_CLOSURE_WORKER_ENABLED) ||
    parsed.HOLADAY_POOL_BOOT !== undefined ||
    parsed.HOLADAY_POOL_CANDIDATE !== undefined ||
    (parsed.BROWSER_VNC_WS_ENABLED ?? 'false') !== 'false'
  )
    throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
  return parsed;
}

export function maintenanceCandidateEnvironment(parsed, candidate) {
  return {
    ...parsed,
    // runuser is installed in /usr/sbin on supported Debian/Ubuntu hosts.
    // Keep a fixed system-only path for both readiness and candidate control.
    PATH: '/opt/node22/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/var/lib/holaday',
    USER: 'holaday',
    LOGNAME: 'holaday',
    PM2_HOME: '/root/.pm2',
    XDG_RUNTIME_DIR: '/var/lib/holaday/.runtime',
    NODE_ENV: 'production',
    HOLADAY_ORDINARY_MAINTENANCE: '1',
    HOLADAY_ORDINARY_CANDIDATE: candidate,
    ORCHESTRATOR_REPO_ROOT: rootFor(candidate),
    ORCHESTRATOR_NODE_BIN: node,
  };
}

/** Shared preparation only: neither stops services nor migrates the database.
 * The caller owns the journal, verifies the source identity, and proves the
 * destination absent before calling. First cutover never invents oldIdentity.
 */
export async function stageReleaseCandidate(input, io) {
  const { branch, candidate, sourceRoot, sourceCandidate, configDigest, migrationDigest, gid } =
    input;
  const config = Buffer.from(input.config);
  const env = { ...input.env };
  const root = rootFor(candidate);
  if (
    !sha(candidate) ||
    !sha(sourceCandidate) ||
    candidate === sourceCandidate ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(branch ?? '') ||
    !['/opt/holaday-monorepo', rootFor(sourceCandidate)].includes(sourceRoot) ||
    !digest(migrationDigest) ||
    !digest(configDigest) ||
    createHash('sha256').update(config).digest('hex') !== configDigest ||
    !Number.isSafeInteger(gid) ||
    gid < 1
  )
    throw new Error('MAINTENANCE_TARGET_UNPROVEN');
  const run = async (command, args, settings) => {
    await io.assertOwnership();
    const result = await io.exec(command, args, settings);
    await io.assertOwnership();
    return result;
  };
  const manifest = () => {
    const result = io.manifest(root);
    if (result.sha256 !== migrationDigest) throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
    return result.manifest;
  };
  const origin = (await run('git', ['-C', sourceRoot, 'remote', 'get-url', 'origin'])).trim();
  if (!origin || /[\r\n\0]/.test(origin)) throw new Error('MAINTENANCE_TARGET_UNPROVEN');
  await run('git', ['clone', '--no-hardlinks', '--no-checkout', '--', sourceRoot, root]);
  await run('git', ['-C', root, 'remote', 'set-url', 'origin', origin]);
  await run('git', ['-C', root, 'fetch', 'origin', `refs/heads/${branch}`]);
  if (
    (await run('git', ['-C', root, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).trim() !==
    candidate
  )
    throw new Error('MAINTENANCE_TARGET_UNPROVEN');
  try {
    await run('git', ['-C', root, 'merge-base', '--is-ancestor', sourceCandidate, candidate]);
  } catch (error) {
    if (/^MAINTENANCE_/.test(error?.message)) throw error;
    throw new Error('MAINTENANCE_ANCESTRY_UNPROVEN');
  }
  await run('git', ['-C', root, 'checkout', '--detach', candidate]);
  manifest();
  await io.assertOwnership();
  await io.stageConfig(root, config, gid);
  await run('pnpm', ['install', '--frozen-lockfile'], { cwd: root, env });
  await run('pnpm', ['--filter', '@holaday/orchestrator', 'build'], { cwd: root, env });
  if (
    (await run('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}'])).trim() !==
      candidate ||
    (await run('git', ['-C', root, 'branch', '--show-current'])).trim() !== ''
  )
    throw new Error('MAINTENANCE_TARGET_UNPROVEN');
  await io.assertOwnership();
  await io.bindManifest(manifest());
  await io.assertOwnership();
  return root;
}

/** Effects for one exact, locked host release. No production commands run at
 * import time. First bootstrap of a legacy host is deliberately unsupported. */
export function createHostReleaseAdapter(options, io = system) {
  const { branch, candidate, configDigest, migrationDigest, inventoryDigest, oldIdentity } =
    options;
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(branch ?? '') ||
    !sha(candidate) ||
    !digest(configDigest) ||
    !digest(migrationDigest) ||
    !digest(inventoryDigest) ||
    !same(oldIdentity, oldIdentity)
  )
    throw new Error('MAINTENANCE_TARGET_REQUIRED');
  const oldRoot = rootFor(oldIdentity.candidate);
  const root = rootFor(candidate);
  let journal;
  let captured;
  let receipt;
  let config;
  let parsed;
  let gid;
  let binding;
  let evidenceWindow;
  let lastWallTime = -1;
  let activeRoot = oldRoot;
  const effects = io.stopEffects();
  const control = async (op, identity, discovery = false) => {
    const args = [
      '-u',
      'holaday',
      '--',
      node,
      '--import',
      'tsx',
      `${activeRoot}/scripts/browser-maintenance-control.mjs`,
      op,
    ];
    if (!discovery) args.push(identity.candidate, identity.bootId);
    let result;
    try {
      result = JSON.parse(
        await io.exec('runuser', args, { cwd: `${activeRoot}/apps/orchestrator` }),
      );
    } catch (error) {
      throw new Error(stable(error));
    }
    if (result?.protocol !== 1 || (!discovery && !same(result.identity, identity)))
      throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    return result;
  };
  const maintenanceEnv = () => maintenanceCandidateEnvironment(parsed, candidate);
  const pm2 = (args) => io.exec('pm2', args, { cwd: root, env: maintenanceEnv() });
  const assertEvidenceWindow = () => {
    const now = io.wallNow();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now < lastWallTime ||
      !Number.isSafeInteger(evidenceWindow?.maintenanceEndsAtMs) ||
      !Number.isSafeInteger(evidenceWindow?.reconcileByMs) ||
      evidenceWindow.reconcileByMs < evidenceWindow.maintenanceEndsAtMs ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(evidenceWindow?.operatorRef ?? '') ||
      now >= evidenceWindow.maintenanceEndsAtMs
    )
      throw new Error('MAINTENANCE_EVIDENCE_WINDOW_EXPIRED');
    lastWallTime = now;
  };
  const assertEvidenceOwnership = async () => {
    const current = await journal.assertOwnership();
    if (
      !current ||
      current.candidate !== candidate ||
      current.configDigest !== configDigest ||
      current.migrationDigest !== migrationDigest ||
      current.inventoryDigest !== inventoryDigest ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        current.attempt ?? '',
      ) ||
      (binding && current.attempt !== binding.attempt)
    )
      throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    return { attempt: current.attempt, candidate, configDigest, migrationDigest, inventoryDigest };
  };
  const readiness = async (identity, serviceOnly = false) => {
    await assertEvidenceOwnership();
    assertEvidenceWindow();
    const context = {
      binding: { ...binding },
      stage: serviceOnly ? 'prepare' : 'preopen',
      window: { ...evidenceWindow },
      ...(serviceOnly ? {} : { identity: { ...identity } }),
    };
    // These readers must observe hosts/DB/providers, not accept operator success
    // JSON. The site-specific default assembly is deliberately not installed yet.
    await collectCutoverEvidence(context, {
      now: io.wallNow,
      assertJournalOwnership: assertEvidenceOwnership,
      readHostInventory: () => io.evidence.readHostInventory(structuredClone(context)),
      readDatabaseScope: () => io.evidence.readDatabaseScope(structuredClone(context)),
      queryOrders: (scope) => io.evidence.queryOrders(scope, structuredClone(context)),
      readRehearsalArtifacts: () => io.evidence.readRehearsalArtifacts(structuredClone(context)),
      readFenceState: () => io.evidence.readFenceState(structuredClone(context)),
      publishPrivate: (evidence) =>
        io.publishEvidence(evidence, {
          applicationGid: Number(gid),
          assertJournalOwnership: assertEvidenceOwnership,
        }),
    });
    await assertEvidenceOwnership();
    assertEvidenceWindow();
    await io.exec(
      'runuser',
      [
        '-u',
        'holaday',
        '--',
        node,
        '--import',
        'tsx',
        `${root}/apps/orchestrator/scripts/browser-maintenance-readiness.ts`,
        serviceOnly ? 'services' : 'verify',
        binding.attempt,
        candidate,
        configDigest,
        migrationDigest,
        inventoryDigest,
        ...(serviceOnly ? [] : [identity.bootId]),
      ],
      { cwd: `${root}/apps/orchestrator`, env: maintenanceEnv() },
    );
    await assertEvidenceOwnership();
    assertEvidenceWindow();
  };
  const assertManifest = () => {
    const result = io.manifest(root);
    if (result.sha256 !== migrationDigest) throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
    return result.manifest;
  };
  const adapter = {
    capability: async () => {
      const status = await control('status', oldIdentity);
      if (!same(status.identity, oldIdentity)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
      return status;
    },
    preflight: async (identity) => {
      if (!same(identity, oldIdentity) || candidate === oldIdentity.candidate)
        throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
      if (
        ![
          'readWindow',
          'readHostInventory',
          'readDatabaseScope',
          'queryOrders',
          'readRehearsalArtifacts',
          'readFenceState',
        ].every((key) => typeof io.evidence?.[key] === 'function') ||
        typeof io.wallNow !== 'function' ||
        typeof io.publishEvidence !== 'function'
      )
        throw new Error('MAINTENANCE_EVIDENCE_ADAPTER_REQUIRED');
      config = await io.readConfig();
      if (createHash('sha256').update(config).digest('hex') !== configDigest)
        throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
      parsed = parseMaintenanceCandidateConfig(config, oldRoot, io);
      if ((await io.exec('id', ['-u', 'holaday'])).trim() !== '998')
        throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
      gid = (await io.exec('id', ['-g', 'holaday'])).trim();
      if (!/^[1-9][0-9]*$/.test(gid)) throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
      await io.exec('/usr/bin/python3', [
        fileURLToPath(new URL('./browser-maintenance-signal.py', import.meta.url)),
        '--check',
      ]);
      await io.targetAbsent(root);
      journal = await io.journal(storage, {
        candidate,
        configDigest,
        migrationDigest,
        inventoryDigest,
        oldIdentity,
      });
      binding = await assertEvidenceOwnership();
      evidenceWindow = structuredClone(await io.evidence.readWindow({ ...binding }));
      assertEvidenceWindow();
      await adapter.capability();
      captured = await io.observe(identity);
    },
    stage: async () => {
      await stageReleaseCandidate(
        {
          branch,
          candidate,
          sourceRoot: oldRoot,
          sourceCandidate: oldIdentity.candidate,
          config,
          configDigest,
          migrationDigest,
          gid: Number(gid),
          env: maintenanceEnv(),
        },
        {
          ...io,
          assertOwnership: async () => {
            await assertEvidenceOwnership();
            assertEvidenceWindow();
          },
          bindManifest: (manifest) => journal.bindManifest(manifest),
        },
      );
      // Candidate tools exist only after staging/build. Prepare evidence and
      // readiness still precede the transition's first service-closing intent.
      await readiness(undefined, true);
    },
    persist: (phase, detail) => journal.persist(phase, detail),
    close: (identity) => control('close', identity),
    stopWorker: async () => {
      const deadline = io.now() + 660000;
      if (captured.worker)
        for (;;) {
          const current = await effects.readProcess(captured.worker.pid);
          if (!current) break;
          if (
            current.start !== captured.worker.start ||
            current.cwd !== captured.worker.cwd ||
            current.uid !== 998
          )
            throw new Error('MAINTENANCE_PROCESS_IDENTITY');
          if (io.now() >= deadline) throw new Error('MAINTENANCE_WORKER_BUSY');
          await io.sleep(100);
        }
      return effects.managerStopped('worker', captured.worker);
    },
    wait: async (identity) => {
      receipt = await control('wait', identity);
      return receipt;
    },
    stop: () => io.retire({ ...captured, receipt, deadlineMs: 660000, effects }),
    migrate: async () => {
      assertManifest();
      await io.exec('pnpm', ['--filter', '@holaday/orchestrator', 'db:migrate:numbered'], {
        cwd: root,
        env: maintenanceEnv(),
      });
      await io.exec('pnpm', ['--filter', '@holaday/orchestrator', 'db:verify'], {
        cwd: root,
        env: maintenanceEnv(),
      });
    },
    start: async () => {
      await io.assertStopped(captured);
      await pm2(['delete', 'holaday-orchestrator']);
      if (captured.worker) await pm2(['delete', 'holaday-account-closure-worker']);
      activeRoot = root;
      await pm2([
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
        gid,
        '--no-autorestart',
      ]);
      const deadline = io.now() + 60000;
      for (;;) {
        try {
          const status = await control('status', undefined, true);
          if (
            status.identity?.candidate !== candidate ||
            status.identity?.bootId === oldIdentity.bootId ||
            !same(status.identity, status.identity) ||
            status.mode !== 'closed' ||
            status.needsReconciliation !== false ||
            status.idle !== true
          )
            throw new Error('MAINTENANCE_START_UNPROVEN');
          return status.identity;
        } catch (error) {
          if (io.now() >= deadline) throw error;
          await io.sleep(100);
        }
      }
    },
    verify: async (identity) => {
      await io.observe(identity);
      await readiness(identity);
    },
    beforeOpen: async (identity) => {
      await io.observe(identity);
      await readiness(identity);
    },
    afterOpen: async (identity) => {
      const status = await control('status', identity);
      if (status.mode !== 'serving' || status.needsReconciliation !== true || status.idle !== false)
        throw new Error('MAINTENANCE_OPEN_UNPROVEN');
    },
    open: (identity) => control('open', identity),
    status: (identity) => control('status', identity),
    resumeWorker: async (identity) => {
      if (parsed.ACCOUNT_CLOSURE_WORKER_ENABLED === 'true') {
        await pm2([
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
          gid,
          '--no-autorestart',
        ]);
      }
      const deadline = io.now() + 60000;
      for (;;) {
        try {
          const observed = await io.observe(identity);
          if ((parsed.ACCOUNT_CLOSURE_WORKER_ENABLED === 'true') !== Boolean(observed.worker))
            throw new Error('MAINTENANCE_WORKER_UNPROVEN');
          break;
        } catch (error) {
          if (io.now() >= deadline) throw error;
          await io.sleep(100);
        }
      }
      const names = [
        'holaday-orchestrator',
        ...(parsed.ACCOUNT_CLOSURE_WORKER_ENABLED === 'true'
          ? ['holaday-account-closure-worker']
          : []),
      ];
      await io.exec(node, [`${root}/scripts/secure-pm2-logs.mjs`, ...names], {
        cwd: root,
        env: maintenanceEnv(),
        input: await pm2(['jlist']),
      });
      await pm2(['save', '--force']);
    },
    finish: async (result) => {
      if (!journal) return;
      try {
        if (result.ok) await journal.finish();
      } catch (error) {
        try {
          await control('close', result.identity);
        } catch {
          /* original ambiguity remains */
        }
        throw error;
      } finally {
        await journal.close();
      }
    },
  };
  return adapter;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let adapter;
  try {
    const [
      branch,
      candidate,
      configDigest,
      migrationDigest,
      inventoryDigest,
      oldCandidate,
      bootId,
    ] = process.argv.slice(2);
    if (process.argv.length !== 9) throw new Error('MAINTENANCE_TARGET_REQUIRED');
    adapter = createHostReleaseAdapter({
      branch,
      candidate,
      configDigest,
      migrationDigest,
      inventoryDigest,
      oldIdentity: { candidate: oldCandidate, bootId },
    });
    const result = await performMaintenanceRelease({ candidate, adapter });
    await adapter.finish(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${stable(error)}\n`);
    process.exitCode = 1;
  }
}
