import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/** Effects for one exact, locked host release. No production commands run at
 * import time. First bootstrap of a legacy host is deliberately unsupported. */
export function createHostReleaseAdapter(options, io = system) {
  const { branch, candidate, configDigest, migrationDigest, oldIdentity } = options;
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(branch ?? '') ||
    !sha(candidate) ||
    !digest(configDigest) ||
    !digest(migrationDigest) ||
    !same(oldIdentity, oldIdentity)
  )
    throw new Error('MAINTENANCE_TARGET_REQUIRED');
  const oldRoot = rootFor(oldIdentity.candidate),
    root = rootFor(candidate);
  let journal,
    captured,
    receipt,
    config,
    parsed,
    gid,
    activeRoot = oldRoot;
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
  const maintenanceEnv = () => ({
    ...parsed,
    PATH: '/opt/node22/bin:/usr/local/bin:/usr/bin:/bin',
    HOME: '/var/lib/holaday',
    USER: 'holaday',
    LOGNAME: 'holaday',
    PM2_HOME: '/root/.pm2',
    XDG_RUNTIME_DIR: '/var/lib/holaday/.runtime',
    NODE_ENV: 'production',
    HOLADAY_ORDINARY_MAINTENANCE: '1',
    HOLADAY_ORDINARY_CANDIDATE: candidate,
    ORCHESTRATOR_REPO_ROOT: root,
    ORCHESTRATOR_NODE_BIN: node,
  });
  const pm2 = (args) => io.exec('pm2', args, { cwd: root, env: maintenanceEnv() });
  const readiness = async (identity, serviceOnly = false) => {
    await io.exec(
      'runuser',
      [
        '-u',
        'holaday',
        '--',
        node,
        '--import',
        'tsx',
        `${activeRoot}/apps/orchestrator/scripts/browser-maintenance-readiness.ts`,
        ...(serviceOnly ? ['services'] : [identity.candidate, identity.bootId]),
      ],
      { cwd: `${activeRoot}/apps/orchestrator`, ...(serviceOnly ? {} : { env: maintenanceEnv() }) },
    );
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
      config = await io.readConfig();
      if (createHash('sha256').update(config).digest('hex') !== configDigest)
        throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
      parsed = io.parseConfig(config, oldRoot);
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
      if ((await io.exec('id', ['-u', 'holaday'])).trim() !== '998')
        throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
      gid = (await io.exec('id', ['-g', 'holaday'])).trim();
      if (!/^[1-9][0-9]*$/.test(gid)) throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
      await io.exec('/usr/bin/python3', [
        fileURLToPath(new URL('./browser-maintenance-signal.py', import.meta.url)),
        '--check',
      ]);
      // This currently refuses: an order-creation preflight/flag is not proof
      // of callback retry or independent-writer boundaries during downtime.
      await readiness(identity, true);
      await io.targetAbsent(root);
      journal = await io.journal(storage, {
        candidate,
        configDigest,
        migrationDigest,
        oldIdentity,
      });
      await adapter.capability();
      captured = await io.observe(identity);
    },
    stage: async () => {
      const origin = (await io.exec('git', ['-C', oldRoot, 'remote', 'get-url', 'origin'])).trim();
      if (!origin || /[\r\n\0]/.test(origin)) throw new Error('MAINTENANCE_TARGET_UNPROVEN');
      await io.exec('git', ['clone', '--no-hardlinks', '--no-checkout', '--', oldRoot, root]);
      await io.exec('git', ['-C', root, 'remote', 'set-url', 'origin', origin]);
      await io.exec('git', ['-C', root, 'fetch', 'origin', `refs/heads/${branch}`]);
      if (
        (
          await io.exec('git', ['-C', root, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
        ).trim() !== candidate
      )
        throw new Error('MAINTENANCE_TARGET_UNPROVEN');
      try {
        await io.exec('git', [
          '-C',
          root,
          'merge-base',
          '--is-ancestor',
          oldIdentity.candidate,
          candidate,
        ]);
      } catch {
        throw new Error('MAINTENANCE_ANCESTRY_UNPROVEN');
      }
      await io.exec('git', ['-C', root, 'checkout', '--detach', candidate]);
      assertManifest();
      await io.stageConfig(root, config, gid);
      await io.exec('pnpm', ['install', '--frozen-lockfile'], { cwd: root, env: maintenanceEnv() });
      await io.exec('pnpm', ['--filter', '@holaday/orchestrator', 'build'], {
        cwd: root,
        env: maintenanceEnv(),
      });
      await journal.bindManifest(assertManifest());
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
    const [branch, candidate, configDigest, migrationDigest, oldCandidate, bootId] =
      process.argv.slice(2);
    if (process.argv.length !== 8) throw new Error('MAINTENANCE_TARGET_REQUIRED');
    adapter = createHostReleaseAdapter({
      branch,
      candidate,
      configDigest,
      migrationDigest,
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
