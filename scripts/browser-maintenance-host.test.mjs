import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createHostReleaseAdapter,
  maintenanceCandidateEnvironment,
} from './browser-maintenance-host.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';
import { performMaintenanceRelease } from './browser-maintenance-transition.mjs';

const old = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const next = { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) };
const root = `/opt/holaday-releases/${next.candidate}`;
const oldRoot = `/opt/holaday-releases/${old.candidate}`;
const attempt = '11111111-1111-4111-8111-111111111111';
test('candidate environment resolves Linux system administration tools without inheriting an untrusted PATH', () => {
  const env = maintenanceCandidateEnvironment({ PATH: '/tmp/untrusted-bin' }, next.candidate);
  assert.equal(env.PATH, '/opt/node22/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.HOLADAY_ORDINARY_CANDIDATE, next.candidate);
});
const inventory = {
  configurationDigests: ['1'.repeat(64)],
  merchants: [],
  targets: [],
};
const config = Buffer.from(
  'MODEL_RUNTIME_POLICY=qwen_only\nQWEN_CORE_ROLLOUT_MODE=off\nTEAM_TASK_LIFECYCLE_ENABLED=false\nACCOUNT_CLOSURE_WORKER_ENABLED=false\n',
);
const options = {
  branch: 'codex/release',
  candidate: next.candidate,
  configDigest: createHash('sha256').update(config).digest('hex'),
  migrationDigest: 'f'.repeat(64),
  inventoryDigest: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  oldIdentity: old,
};
function fixture(fault) {
  const events = [];
  const published = [];
  const binding = {
    attempt,
    candidate: options.candidate,
    configDigest: options.configDigest,
    migrationDigest: options.migrationDigest,
    inventoryDigest: options.inventoryDigest,
  };
  let started = false;
  let mode = 'serving';
  let clock = 0;
  const snapshot = () => ({
    protocol: 1,
    identity: started ? next : old,
    mode,
    idle: mode === 'closed',
    needsReconciliation: mode === 'serving',
  });
  const captured = {
    identity: old,
    root: oldRoot,
    main: {
      pid: 101,
      start: '1234',
      uid: 998,
      cwd: `${oldRoot}/apps/orchestrator`,
      command: 'main',
      autorestart: false,
    },
    worker: null,
  };
  const io = {
    platform: 'linux',
    uid: 0,
    wallNow: () => 100_000,
    evidence: {
      readWindow: async (current) => {
        assert.deepEqual(current, binding);
        events.push('evidence-window');
        return { maintenanceEndsAtMs: 150_000, reconcileByMs: 200_000, operatorRef: 'qa' };
      },
      readHostInventory: async () => {
        events.push('host-facts');
        return {
          inventory,
          observedAtMs: 100_000,
          unknownWriters: fault === 'unknown-writer' ? ['unknown'] : [],
          externalWork: [],
          producersRunning: [],
        };
      },
      readDatabaseScope: async () => {
        events.push('database-facts');
        return { observedAtMs: 100_000, orders: [], unsettled: [] };
      },
      queryOrders: async () => [],
      readRehearsalArtifacts: async () => ({
        ...binding,
        observedAtMs: 1,
        recovery: 'retry-proven',
        recoveryUntilMs: 250_000,
        artifacts: [],
      }),
      readFenceState: async ({ stage }) => ({
        inventoryDigest: options.inventoryDigest,
        observedAtMs: 100_000,
        stage: stage === 'prepare' ? 'observed' : 'all-writers',
        uncovered: [],
        liveLegacy: [],
        regeneratedLegacy: [],
      }),
    },
    publishEvidence: async (evidence, settings) => {
      assert.equal(settings.applicationGid, 998);
      assert.deepEqual(await settings.assertJournalOwnership(), binding);
      events.push(`publish:${evidence.report.stage}`);
      if (fault === 'publish') throw new Error('MAINTENANCE_EVIDENCE_UNPROVEN');
      published.push(structuredClone(evidence));
    },
    readConfig: async () => config,
    parseConfig: () => ({
      MODEL_RUNTIME_POLICY: 'qwen_only',
      QWEN_CORE_ROLLOUT_MODE: 'off',
      QWEN_CORE_ENABLED_LANES: 'browser',
      DASHSCOPE_INTL_API_KEY: 'synthetic-only',
      DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic',
      DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://example.invalid/responses',
      TEAM_TASK_LIFECYCLE_ENABLED: 'false',
      ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
    }),
    stageConfig: async (path, bytes) => {
      assert.equal(path, root);
      assert.deepEqual(bytes, config);
      events.push('config-staged');
    },
    targetAbsent: async () => {
      if (fault === 'existing-target') throw new Error('MAINTENANCE_TARGET_EXISTS');
    },
    manifest: () => ({
      sha256: fault === 'manifest' ? '0'.repeat(64) : options.migrationDigest,
      manifest: { replaysNumberedSql: true },
    }),
    journal: async (_directory, metadata) => {
      assert.equal(metadata.candidate, next.candidate);
      assert.equal(metadata.inventoryDigest, options.inventoryDigest);
      events.push('lock');
      return {
        assertOwnership: async () => {
          events.push('ownership');
          return { ...binding };
        },
        bindManifest: async (manifest) => {
          assert.equal(manifest.replaysNumberedSql, true);
          events.push('manifest-bound');
        },
        persist: async (phase) => {
          events.push(`phase:${phase}`);
          if (fault === `phase:${phase}`) throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
        },
        finish: async () => events.push('unlock'),
        close: async () => events.push('journal-close'),
      };
    },
    observe: async (identity) => {
      assert.deepEqual(identity, started ? next : old);
      events.push(started ? 'verify-new-runtime' : 'capture-old-runtime');
      if (started && fault === 'new-runtime') throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
      return started
        ? {
            ...captured,
            identity: next,
            root,
            main: { ...captured.main, pid: 201, cwd: `${root}/apps/orchestrator` },
            worker: null,
          }
        : captured;
    },
    stopEffects: () => ({
      now: () => 0,
      sleep: async () => {},
      readProcess: async () => null,
      managerStopped: async () => true,
      portsFree: async () => true,
    }),
    retire: async (input) => {
      assert.deepEqual(input.identity, old);
      events.push('retire');
      if (fault === 'stop') throw new Error('MAINTENANCE_PROCESS_BUSY');
    },
    assertStopped: async () => {
      events.push('verify-stopped');
      if (fault === 'reappeared') throw new Error('MAINTENANCE_STOP_UNPROVEN');
    },
    now: () => clock,
    sleep: async () => {
      clock += 10000;
    },
    exec: async (command, args, settings = {}) => {
      const line = `${command} ${args.join(' ')}`;
      events.push(line);
      if (
        command === 'runuser' &&
        args.some((arg) => arg.endsWith('/browser-maintenance-control.mjs'))
      ) {
        const at = args.findIndex((arg) => arg.endsWith('/browser-maintenance-control.mjs'));
        const op = args[at + 1];
        if (op === 'close') mode = 'closed';
        if (op === 'open') {
          mode = 'serving';
          if (fault === 'open-ack') throw new Error('lost');
        }
        return JSON.stringify(snapshot());
      }
      if (
        command === 'runuser' &&
        args.some((arg) => arg.endsWith('/browser-maintenance-readiness.ts'))
      ) {
        const at = args.findIndex((arg) => arg.endsWith('/browser-maintenance-readiness.ts'));
        const op = args[at + 1];
        if (fault === 'services' || (fault === 'readiness' && op !== 'services'))
          throw new Error('MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN');
        return '';
      }
      if (command === '/usr/bin/python3') {
        assert.equal(args.at(-1), '--check');
        return '';
      }
      if (command === 'id') return args[0] === '-u' ? '998\n' : '998\n';
      if (command === 'git') {
        if (args.includes('get-url')) return 'https://example.invalid/repo.git\n';
        if (args.includes('rev-parse')) return `${next.candidate}\n`;
        if (args.includes('merge-base') && fault === 'ancestor') throw new Error('divergent');
        return '';
      }
      if (command === 'pnpm') {
        assert.equal(settings.cwd, root);
        assert.equal(settings.env.MODEL_RUNTIME_POLICY, 'qwen_only');
        assert.equal(settings.env.HOLADAY_ORDINARY_CANDIDATE, next.candidate);
        if (args.includes('db:migrate:numbered') && fault === 'migration')
          throw new Error('sql failure secret');
        return '';
      }
      if (command === 'pm2') {
        assert.equal(settings.env.PM2_HOME, '/root/.pm2');
        if (args[0] === 'start') {
          assert.ok(args.includes('--no-autorestart'));
          assert.equal(args[args.indexOf('--uid') + 1], '998');
          assert.equal(args[args.indexOf('--cwd') + 1], `${root}/apps/orchestrator`);
          assert.equal(settings.env.HOLADAY_ORDINARY_CANDIDATE, next.candidate);
          if (fault === 'start') throw new Error('start failed');
          started = true;
          mode = 'closed';
        }
        return args[0] === 'jlist' ? '[{"name":"holaday-orchestrator"}]' : '';
      }
      if (command === '/opt/node22/bin/node' && args[0].endsWith('/secure-pm2-logs.mjs')) {
        assert.equal(settings.input, '[{"name":"holaday-orchestrator"}]');
        return '';
      }
      throw new Error(`UNEXPECTED_COMMAND ${line}`);
    },
  };
  return { events, io, published, binding };
}
test('candidate readiness consumes freshly collected evidence bound to the locked attempt', async () => {
  const f = fixture();
  const exec = f.io.exec;
  const commands = [];
  f.io.exec = async (command, args, settings) => {
    if (args.some((a) => a.endsWith('/browser-maintenance-readiness.ts'))) {
      commands.push(args);
      assert.equal(settings.cwd, `${root}/apps/orchestrator`);
      assert.equal(settings.env.HOLADAY_ORDINARY_CANDIDATE, next.candidate);
      assert.equal(f.published.length, commands.length);
    }
    return exec(command, args, settings);
  };
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  assert.equal(result.ok, true, JSON.stringify(result));
  await adapter.finish(result);
  const command = [
    '-u',
    'holaday',
    '--',
    '/opt/node22/bin/node',
    '--import',
    'tsx',
    `${root}/apps/orchestrator/scripts/browser-maintenance-readiness.ts`,
  ];
  const bound = [
    attempt,
    next.candidate,
    options.configDigest,
    options.migrationDigest,
    options.inventoryDigest,
  ];
  assert.deepEqual(commands, [
    [...command, 'services', ...bound],
    [...command, 'verify', ...bound, next.bootId],
    [...command, 'verify', ...bound, next.bootId],
  ]);
  const at = (event) => f.events.findIndex((e) => e.includes(event));
  assert.ok(at('lock') < at('evidence-window'));
  assert.ok(at('manifest-bound') < at('host-facts'));
  assert.ok(at('publish:prepare') < at('readiness.ts services'));
  assert.ok(at('readiness.ts services') < at('control.mjs close'));
  assert.equal(f.events.filter((e) => e === 'database-facts').length, 6);
  assert.equal(f.events.filter((e) => e === 'evidence-window').length, 1);
  assert.deepEqual(
    f.published.map((p) => p.report.identity),
    [undefined, next, next],
  );
});

for (const fault of ['unknown-writer', 'publish']) {
  test(`${fault} evidence prevents closing, migrating or unlocking the release`, async () => {
    const f = fixture(fault);
    const adapter = createHostReleaseAdapter(options, f.io);
    const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
    await adapter.finish(result);
    assert.equal(result.ok, false);
    assert.equal(
      f.events.some((e) => /control.mjs close|db:migrate:numbered|unlock/.test(e)),
      false,
    );
    assert.equal(
      f.events.some((e) => e.includes('readiness.ts')),
      false,
    );
    assert.equal(f.events.at(-1), 'journal-close');
  });
}

test('missing real evidence readers refuses before staging or acquiring a release lock', async () => {
  const f = fixture();
  f.io.evidence = undefined;
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  assert.equal(result.code, 'MAINTENANCE_EVIDENCE_ADAPTER_REQUIRED');
  assert.equal(
    f.events.some((e) => /git clone|lock|control.mjs close/.test(e)),
    false,
  );
});

test('an expired approval window refuses before cloning the candidate', async () => {
  const f = fixture();
  f.io.evidence.readWindow = async () => ({
    maintenanceEndsAtMs: 99_999,
    reconcileByMs: 200_000,
    operatorRef: 'qa',
  });
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  await adapter.finish(result);
  assert.equal(result.ok, false);
  assert.equal(
    f.events.some((e) => e.includes('git clone')),
    false,
  );
  assert.equal(f.events.includes('unlock'), false);
});

test('readiness crossing the approved deadline cannot open the candidate', async () => {
  const f = fixture();
  let now = 100_000;
  let verifies = 0;
  f.io.wallNow = () => now;
  const exec = f.io.exec;
  f.io.exec = async (command, args, settings) => {
    const result = await exec(command, args, settings);
    if (args.includes('verify') && ++verifies === 2) now = 150_000;
    return result;
  };
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  await adapter.finish(result);
  assert.equal(result.ok, false);
  assert.equal(
    f.events.some((e) => e.includes('control.mjs open')),
    false,
  );
  assert.equal(f.events.includes('unlock'), false);
  assert.equal(result.closeAcknowledged, true);
});

test('real journal supplies the same generated attempt to every evidence report and readiness call', async (t) => {
  const f = fixture();
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-host-journal-')));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const manifest = { replaysNumberedSql: true };
  const migrationDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const boundOptions = { ...options, migrationDigest };
  f.io.manifest = () => ({ sha256: migrationDigest, manifest });
  f.io.journal = (_unused, metadata) => acquireReleaseJournal(directory, metadata);
  f.io.evidence.readWindow = async (binding) => {
    Object.assign(f.binding, binding);
    return { maintenanceEndsAtMs: 150_000, reconcileByMs: 200_000, operatorRef: 'qa' };
  };
  const adapter = createHostReleaseAdapter(boundOptions, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  assert.equal(result.ok, true, JSON.stringify(result));
  const record = JSON.parse(
    await fs.readFile(join(directory, `${f.binding.attempt}.json`), 'utf8'),
  );
  assert.equal(record.phase, 'opened');
  assert.equal(record.inventoryDigest, options.inventoryDigest);
  assert.equal(f.published.length, 3);
  for (const evidence of f.published) {
    assert.equal(evidence.report.attempt, record.attempt);
    assert.equal(evidence.report.migrationDigest, migrationDigest);
  }
  for (const command of f.events.filter((e) => e.includes('readiness.ts'))) {
    assert.ok(command.includes(record.attempt));
    assert.ok(command.includes(migrationDigest));
  }
  await adapter.finish(result);
  await assert.rejects(fs.stat(join(directory, 'release.lock')), { code: 'ENOENT' });
});

test('losing the journal after readiness holds maintenance instead of opening', async () => {
  const f = fixture();
  let changed = false;
  const journal = f.io.journal;
  f.io.journal = async (...args) => {
    const result = await journal(...args);
    const ownership = result.assertOwnership;
    result.assertOwnership = async () => ({
      ...(await ownership()),
      ...(changed ? { attempt: '22222222-2222-4222-8222-222222222222' } : {}),
    });
    return result;
  };
  const exec = f.io.exec;
  f.io.exec = async (command, args, settings) => {
    const result = await exec(command, args, settings);
    if (args.includes('verify')) changed = true;
    return result;
  };
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  await adapter.finish(result);
  assert.equal(result.code, 'MAINTENANCE_JOURNAL_UNPROVEN');
  assert.equal(result.closeAcknowledged, true);
  assert.equal(
    f.events.some((e) => e.includes('control.mjs open')),
    false,
  );
});
test('real host adapter stages exact descendant separately, retires before SQL, starts non-root closed and never rolls back', async () => {
  const f = fixture();
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  assert.equal(result.ok, true, JSON.stringify(result));
  await adapter.finish(result);
  const e = f.events;
  const index = (text) => e.findIndex((event) => event.includes(text));
  assert.ok(index('lock') < index('git clone'));
  assert.ok(index('merge-base --is-ancestor') < index('pnpm install'));
  assert.ok(index('retire') < index('db:migrate:numbered'));
  assert.ok(index('manifest-bound') >= 0 && index('manifest-bound') < index('phase:closed'));
  assert.ok(index('phase:migration_started') < index('db:migrate:numbered'));
  assert.ok(index('verify-stopped') < index('pm2 delete'));
  assert.ok(index('phase:candidate_started') < index('pm2 start'));
  assert.ok(index('verify-new-runtime') < index('control.mjs open'));
  assert.ok(index('secure-pm2-logs.mjs') < index('phase:opened'));
  assert.ok(index('phase:opened') < index('unlock'));
  assert.equal(
    e.some((event) => /reset --hard|pm2 restart|rollback|kill -KILL/.test(event)),
    false,
  );
});

for (const key of [
  'QWEN_CORE_ENABLED_LANES',
  'DASHSCOPE_INTL_API_KEY',
  'DASHSCOPE_INTL_ANTHROPIC_BASE_URL',
  'DASHSCOPE_INTL_RESPONSES_BASE_URL',
]) {
  test(`missing Qwen process contract ${key} blocks before staging or closing`, async () => {
    const f = fixture();
    const original = f.io.parseConfig;
    f.io.parseConfig = () => {
      const env = original();
      delete env[key];
      return env;
    };
    const adapter = createHostReleaseAdapter(options, f.io);
    const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
    await adapter.finish(result);
    assert.equal(result.code, 'MAINTENANCE_CONFIG_UNPROVEN');
    assert.deepEqual(
      f.events.filter(
        (e) => e === 'lock' || e.includes('git clone') || e.includes('control.mjs close'),
      ),
      [],
    );
  });
}
for (const fault of [
  'services',
  'existing-target',
  'ancestor',
  'manifest',
  'phase:closed',
  'stop',
  'reappeared',
  'migration',
  'start',
  'new-runtime',
  'readiness',
]) {
  test(`host failure ${fault} does not repeat migration or start an old checkout`, async () => {
    const f = fixture(fault);
    const adapter = createHostReleaseAdapter(options, f.io);
    const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
    await adapter.finish(result);
    assert.equal(result.ok, false);
    assert.equal(f.events.filter((e) => e.includes('db:migrate:numbered')).length <= 1, true);
    assert.equal(
      f.events.some((e) => e.startsWith('pm2 start') && e.includes(oldRoot)),
      false,
    );
    assert.equal(f.events.includes('unlock'), false);
    if (['services', 'existing-target', 'ancestor', 'manifest'].includes(fault))
      assert.equal(
        f.events.some((e) => e.includes('control.mjs close')),
        false,
      );
    if (fault === 'ancestor')
      assert.equal(
        f.events.some((e) => e.startsWith('pnpm install')),
        false,
      );
    if (['phase:closed', 'stop'].includes(fault))
      assert.equal(
        f.events.some((e) => e.includes('db:migrate:numbered')),
        false,
      );
  });
}
test('lost open ACK results in one status check and no repeated open command', async () => {
  const f = fixture('open-ack');
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  await adapter.finish(result);
  assert.equal(result.ok, true);
  assert.equal(f.events.filter((e) => e.includes('control.mjs open')).length, 1);
  assert.equal(
    f.events.filter((e) => e.includes(`control.mjs status ${next.candidate}`)).length >= 1,
    true,
  );
});

test('normal host refreshes runtime/readiness immediately before open and proves status after open', async () => {
  const f = fixture();
  const adapter = createHostReleaseAdapter(options, f.io);
  const result = await performMaintenanceRelease({ candidate: next.candidate, adapter });
  assert.equal(result.ok, true);
  const open = f.events.findIndex((e) => e.includes('control.mjs open'));
  const verifies = f.events
    .map((e, i) => (e === 'verify-new-runtime' ? i : -1))
    .filter((i) => i >= 0);
  const ready = f.events
    .map((e, i) => (e.includes('browser-maintenance-readiness.ts') ? i : -1))
    .filter((i) => i >= 0);
  assert.equal(ready.length, 3); // One prepare and two independent pre-open checks.
  assert.ok(verifies[1] < ready[2] && ready[2] < open);
  assert.ok(f.events[open + 1].includes(`control.mjs status ${next.candidate}`));
});

test('normal host refuses a foreign post-open status and closes the intended candidate', async () => {
  const f = fixture();
  const exec = f.io.exec;
  let opened = false;
  f.io.exec = async (command, args, settings) => {
    const out = await exec(command, args, settings);
    if (command === 'runuser' && args.includes('open')) opened = true;
    if (opened && command === 'runuser' && args.includes('status'))
      return JSON.stringify({
        protocol: 1,
        identity: old,
        mode: 'serving',
        needsReconciliation: true,
        idle: false,
      });
    return out;
  };
  const result = await performMaintenanceRelease({
    candidate: next.candidate,
    adapter: createHostReleaseAdapter(options, f.io),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MAINTENANCE_IDENTITY_MISMATCH');
  assert.ok(f.events.at(-1).includes(`control.mjs close ${next.candidate}`));
  assert.equal(result.closeAcknowledged, true);
  assert.equal(f.events.includes('phase:opened'), false);
});
