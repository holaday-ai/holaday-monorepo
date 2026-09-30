import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cutoverRegistrationConfigDigest } from './browser-cutover-evidence.mjs';
import {
  captureLegacyRuntime,
  createLegacyProducerEffects,
  createLegacyRuntimeEffects,
  initializeFirstMaintenanceState,
  retireLegacyProducers,
  retireLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';
import * as firstRuntime from './browser-first-cutover-runtime.mjs';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';

function cloudRestartFixture() {
  const f = cloudRecoveryObservationFixture();
  const manager = structuredClone(f.manager);
  manager.pid = 0;
  Object.assign(manager.pm2_env, {
    pm_id: 7,
    status: 'stopped',
    pm_exec_path: '/opt/holaday-headed/start.sh',
    args: [],
    exec_mode: 'fork_mode',
    autorestart: true,
    restart_time: 12,
    max_memory_restart: 1572864000,
  });
  const launchDigest = createHash('sha256')
    .update(
      JSON.stringify(
        firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({ attempt: f.input.attempt }),
      ),
    )
    .digest('hex');
  const scope = [
    { name: 'holaday-vnc', pmId: 6, scopeDigest: 'a'.repeat(64), recoveryDigest: 'b'.repeat(64) },
    { name: manager.name, pmId: 7, scopeDigest: 'c'.repeat(64), recoveryDigest: launchDigest },
  ];
  const binding = {
    attempt: f.input.attempt,
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: 'd'.repeat(64),
  };
  const record = {
    ...binding,
    phase: 'verified',
    executionSiteDigest: 'e'.repeat(64),
    cloudMaintenanceScope: scope,
    cloudMaintenanceEvents: scope.flatMap((entry) =>
      ['cloud-stop-intent', 'cloud-stopped'].map((phase) => ({
        ...entry,
        attempt: binding.attempt,
        inventoryDigest: binding.inventoryDigest,
        host: 'vultr',
        phase,
      })),
    ),
  };
  const input = {
    ...f.input,
    stoppedConfigDigest: cutoverRegistrationConfigDigest(manager.pm2_env),
    maintenanceEndsAtMs: 8000,
  };
  const calls = [];
  let now = 1000;
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => now,
    journal: {
      assertOwnership: async () => structuredClone(binding),
      readFirstCutoverEffects: async () => structuredClone(record),
      recordCloudMaintenanceEvent: async (event) => {
        assert.equal(record.cloudMaintenanceEvents.length, 4);
        assert.equal(event.phase, 'cloud-restore-intent');
        record.cloudMaintenanceEvents.push(structuredClone(event));
      },
    },
    assertRecoveryScope: async (actual) => {
      assert.deepEqual(actual, input);
    },
    rpc: async (method, args, beforeSend) => {
      if (method === 'getMonitorData') return structuredClone([manager]);
      if (beforeSend) await beforeSend();
      calls.push({ method, args });
      assert.equal(record.cloudMaintenanceEvents.length, 5, 'durable intent precedes RPC');
      assert.equal(method, 'restartProcessId');
      assert.equal(args.id, 7);
      assert.equal(args.env.current_conf.pm_exec_path, '/usr/bin/unshare');
      assert.equal(args.env.current_conf.autorestart, false);
      assert.equal(args.env.current_conf.max_memory_restart, 'null');
      assert.equal(args.env.current_conf.watch, false);
      assert.equal(args.env.current_conf.cron_restart, '');
      return {};
    },
  };
  return {
    input,
    io,
    record,
    manager,
    binding,
    calls,
    setTime: (v) => {
      now = v;
    },
  };
}

test('cloud browser same-ID restore records one original-journal intent before fixed RPC and never retries it', async () => {
  const f = cloudRestartFixture();
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudBrowser, 'function');
  await firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io);
  assert.equal(f.calls.length, 1);
  assert.equal(
    JSON.parse(JSON.stringify(f.calls[0].args)).env.current_conf.max_memory_restart,
    'null',
  );
  assert.equal(f.record.cloudMaintenanceEvents.length, 5, 'RPC ACK is not physical recovery proof');
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 1);
});

test('cloud browser same-ID restore rejects missing scope, drift, partial stops and deadline before dispatch', async () => {
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudBrowser, 'function');
  for (const fault of [
    (f) => {
      f.io.assertRecoveryScope = undefined;
    },
    (f) => {
      f.io.assertRecoveryScope = async () => false;
    },
    (f) => {
      f.io.assertRecoveryScope = async () => {
        throw Error('unknown writer');
      };
    },
    (f) => {
      f.manager.pid = 40;
      f.manager.pm2_env.status = 'online';
    },
    (f) => {
      f.manager.pm2_env.args = ['old-action'];
    },
    (f) => {
      f.record.cloudMaintenanceEvents.pop();
    },
    (f) => {
      f.record.phase = 'candidate_started';
    },
    (f) => {
      f.record.maintenanceEndsAtMs = 7000;
    },
    (f) => {
      f.record.failureObservation = {};
    },
    (f) => {
      f.binding.attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
    (f) => {
      f.record.cloudMaintenanceScope[1].recoveryDigest = '0'.repeat(64);
    },
    (f) => {
      f.setTime(8000);
    },
    (f) => {
      f.input.command = '/bin/sh';
    },
    (f) => {
      f.io.uid = 998;
    },
  ]) {
    const f = cloudRestartFixture();
    fault(f);
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 0);
  }
});

test('cloud browser same-ID restore rechecks live scope after connection delay before sending', async () => {
  const f = cloudRestartFixture();
  const rpc = f.io.rpc;
  f.io.rpc = async (method, args, beforeSend) => {
    if (method === 'restartProcessId') f.setTime(8000);
    return rpc(method, args, beforeSend);
  };
  await assert.rejects(
    firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io),
    /UNPROVEN|UNCERTAIN/,
  );
  assert.equal(f.calls.length, 0, 'deadline expired while connecting, do not send the write');
  assert.equal(f.record.cloudMaintenanceEvents.length, 5);
});

test('cloud browser same-ID restore keeps uncertain intent and refuses late drift without retry', async () => {
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudBrowser, 'function');
  for (const kind of ['lost-ack', 'expired', 'drift', 'scope']) {
    const f = cloudRestartFixture();
    if (kind === 'scope')
      f.io.assertRecoveryScope = async () => {
        if (f.record.cloudMaintenanceEvents.length === 5) throw Error('unproven');
      };
    if (kind === 'lost-ack') {
      const rpc = f.io.rpc;
      f.io.rpc = async (...args) => {
        const result = await rpc(...args);
        if (args[0] === 'restartProcessId') throw Error('secret raw error');
        return result;
      };
    } else {
      const record = f.io.journal.recordCloudMaintenanceEvent;
      f.io.journal.recordCloudMaintenanceEvent = async (event) => {
        await record(event);
        if (kind === 'expired') f.setTime(8000);
        if (kind === 'drift') f.manager.pm2_env.args.push('unsafe');
      };
    }
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io),
      kind === 'lost-ack' ? /^Error: CUTOVER_CLOUD_RESTORE_UNCERTAIN$/ : /UNPROVEN/,
    );
    assert.equal(f.record.cloudMaintenanceEvents.length, 5);
    assert.equal(f.calls.length, kind === 'lost-ack' ? 1 : 0);
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, kind === 'lost-ack' ? 1 : 0);
  }
});

function expectedVncRecoveryMaterial(attempt) {
  return {
    attempt,
    command: '/opt/holaday-vnc/start.sh',
    exec_interpreter: 'bash',
    current_conf: {
      autorestart: false,
      watch: false,
      cron_restart: '',
      max_memory_restart: 'null',
    },
  };
}

function cloudVncRestartFixture() {
  const f = cloudRestartFixture();
  f.input.pmId = 6;
  f.manager.name = 'holaday-vnc';
  f.manager.pm_id = 6;
  Object.assign(f.manager.pm2_env, {
    name: 'holaday-vnc',
    pm_id: 6,
    pm_exec_path: '/opt/holaday-vnc/start.sh',
    exec_interpreter: 'bash',
    autorestart: true,
    max_memory_restart: 524288000,
    pm_cwd: '/root',
    uid: 0,
    gid: 0,
    env: { DISPLAY: ':98', PRIVATE_VALUE: 'must-not-escape' },
    originalUnknownField: { retained: true },
  });
  const recoveryDigest = createHash('sha256')
    .update(JSON.stringify(expectedVncRecoveryMaterial(f.input.attempt)))
    .digest('hex');
  f.record.cloudMaintenanceScope[0].recoveryDigest = recoveryDigest;
  for (const event of f.record.cloudMaintenanceEvents)
    if (event.name === 'holaday-vnc') event.recoveryDigest = recoveryDigest;
  f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
  const headed = f.record.cloudMaintenanceEvents[2];
  f.record.cloudMaintenanceEvents.push(
    { ...headed, phase: 'cloud-restore-intent' },
    { ...headed, phase: 'cloud-restored' },
  );
  const guardInputs = [];
  f.io.assertRecoveryScope = async (input) => {
    guardInputs.push(structuredClone(input));
    assert.deepEqual(input, f.input);
  };
  f.io.journal.recordCloudMaintenanceEvent = async (event) => {
    assert.equal(f.record.cloudMaintenanceEvents.length, 6);
    f.record.cloudMaintenanceEvents.push(structuredClone(event));
  };
  f.io.rpc = async (method, args, beforeSend) => {
    if (method === 'getMonitorData') return structuredClone([f.manager]);
    assert.equal(method, 'restartProcessId', 'no delete/start/save or other mutation');
    await beforeSend();
    assert.equal(f.record.cloudMaintenanceEvents.length, 7, 'intent precedes dispatch');
    f.calls.push({ method, args: structuredClone(args) });
    return {};
  };
  return { ...f, guardInputs };
}

test('cloud VNC same-ID restore requests only bound PM2 safety overrides with one dispatch and no restored ACK', async () => {
  const f = cloudVncRestartFixture();
  const prior = structuredClone(f.record.cloudMaintenanceEvents);
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
  assert.equal(await firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), undefined);
  // This proves the requested payload only; the double does not execute PM2.
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), f.calls);
  assert.deepEqual(f.calls, [
    {
      method: 'restartProcessId',
      args: {
        id: 6,
        env: {
          current_conf: {
            autorestart: false,
            watch: false,
            cron_restart: '',
            max_memory_restart: 'null',
          },
        },
      },
    },
  ]);
  assert.deepEqual(f.record.cloudMaintenanceEvents, [
    ...prior,
    {
      name: 'holaday-vnc',
      pmId: 6,
      scopeDigest: 'a'.repeat(64),
      recoveryDigest: f.record.cloudMaintenanceScope[0].recoveryDigest,
      attempt: '12345678-1234-4234-8234-123456789abc',
      inventoryDigest: 'd'.repeat(64),
      host: 'vultr',
      phase: 'cloud-restore-intent',
    },
  ]);
  assert.equal(f.guardInputs.length, 3, 'live site guard runs again immediately before send');
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 1);
});

test('cloud VNC recovery material binds only the fixed source and explicit PM2 safety override', () => {
  const build = firstRuntime.firstCutoverCloudVncRecoveryMaterial;
  assert.equal(typeof build, 'function');
  const attempt = '12345678-1234-4234-8234-123456789abc';
  assert.deepEqual(build({ attempt }), expectedVncRecoveryMaterial(attempt));
  for (const input of [
    undefined,
    null,
    [],
    { attempt: 'bad' },
    { attempt, args: [] },
    { attempt, command: '/bin/sh' },
    { attempt, current_conf: { autorestart: true } },
  ])
    assert.throws(() => build(input), /UNPROVEN/);
  const material = build({ attempt });
  material.current_conf.max_memory_restart = 0;
  assert.deepEqual(build({ attempt }), expectedVncRecoveryMaterial(attempt));
});

test('cloud VNC refuses a coherently journaled material that does not approve the fixed safety override', async () => {
  const f = cloudVncRestartFixture();
  f.record.cloudMaintenanceScope[0].recoveryDigest = 'b'.repeat(64);
  for (const event of f.record.cloudMaintenanceEvents)
    if (event.name === 'holaday-vnc') event.recoveryDigest = 'b'.repeat(64);
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.record.cloudMaintenanceEvents.length, 6);
  assert.equal(f.calls.length, 0);
});

for (const value of [524288000, 0, null, false, 'null', undefined]) {
  test(`cloud VNC explicitly overrides pre-bound stopped PM2 policy with memory=${JSON.stringify(value)}`, async () => {
    const f = cloudVncRestartFixture();
    Object.assign(f.manager.pm2_env, {
      autorestart: true,
      cron_restart: '* * * * *',
      max_memory_restart: value,
    });
    f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
    await firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io);
    assert.deepEqual(f.calls, [
      {
        method: 'restartProcessId',
        args: {
          id: 6,
          env: {
            current_conf: {
              autorestart: false,
              watch: false,
              cron_restart: '',
              max_memory_restart: 'null',
            },
          },
        },
      },
    ]);
    assert.equal(f.record.cloudMaintenanceEvents.length, 7);
  });
}

for (const role of ['headed', 'VNC']) {
  for (const value of [524288000, 0, null, false, 'null', undefined]) {
    test(`cloud ${role} refuses nested environment memory=${JSON.stringify(value)} before intent`, async () => {
      const f = role === 'headed' ? cloudRestartFixture() : cloudVncRestartFixture();
      f.manager.pm2_env.env = { max_memory_restart: value };
      f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
      const restore =
        role === 'headed'
          ? firstRuntime.restoreFirstCutoverCloudBrowser
          : firstRuntime.restoreFirstCutoverCloudVnc;
      await assert.rejects(restore(f.input, f.io), /UNPROVEN/);
      assert.equal(f.record.cloudMaintenanceEvents.length, role === 'headed' ? 4 : 6);
      assert.equal(f.calls.length, 0);
    });
  }
}

test('cloud VNC refuses an array carrying the four approved input fields', async () => {
  const f = cloudVncRestartFixture();
  f.input = Object.assign([], f.input);
  f.io.assertRecoveryScope = async () => {};
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.record.cloudMaintenanceEvents.length, 6);
});

for (const role of ['headed', 'VNC']) {
  for (const [field, value] of [
    ['autorestart', true],
    ['watch', true],
    ['cron_restart', '* * * * *'],
    ['pm_exec_path', '/opt/holaday-headed/start.sh'],
    ['args', ['https://example.invalid/old-action']],
    ['exec_interpreter', role === 'headed' ? 'bash' : 'node'],
    ['exec_mode', 'cluster_mode'],
  ]) {
    test(`cloud ${role} refuses conflicting nested ${field} before intent or restart`, async () => {
      const f = role === 'headed' ? cloudRestartFixture() : cloudVncRestartFixture();
      f.manager.pm2_env.env = { PRIVATE_VALUE: 'retained', [field]: value };
      f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
      const restore =
        role === 'headed'
          ? firstRuntime.restoreFirstCutoverCloudBrowser
          : firstRuntime.restoreFirstCutoverCloudVnc;
      await assert.rejects(restore(f.input, f.io), /UNPROVEN/);
      assert.equal(f.record.cloudMaintenanceEvents.length, role === 'headed' ? 4 : 6);
      assert.equal(f.calls.length, 0);
    });
  }
  test(`cloud ${role} permits matching nested safety fields and unrelated environment values`, async () => {
    const f = role === 'headed' ? cloudRestartFixture() : cloudVncRestartFixture();
    const launch = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({
      attempt: f.input.attempt,
    });
    if (role === 'VNC') f.manager.pm2_env.args = ['--approved', 'literal value'];
    f.manager.pm2_env.env = {
      PRIVATE_VALUE: 'retained',
      autorestart: false,
      watch: false,
      cron_restart: '',
      ...(role === 'headed'
        ? {
            pm_exec_path: launch.command,
            args: structuredClone(launch.args),
            exec_interpreter: 'none',
            exec_mode: 'fork_mode',
            DISPLAY: ':77',
          }
        : {
            pm_exec_path: '/opt/holaday-vnc/start.sh',
            args: ['--approved', 'literal value'],
            exec_interpreter: 'bash',
            exec_mode: 'fork_mode',
          }),
    };
    f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
    const restore =
      role === 'headed'
        ? firstRuntime.restoreFirstCutoverCloudBrowser
        : firstRuntime.restoreFirstCutoverCloudVnc;
    await restore(f.input, f.io);
    assert.equal(f.calls.length, 1);
    assert.equal(f.record.cloudMaintenanceEvents.length, role === 'headed' ? 5 : 7);
    assert.equal(Object.hasOwn(f.calls[0].args.env, 'PRIVATE_VALUE'), false);
    if (role === 'headed') assert.equal(f.calls[0].args.env.DISPLAY, ':98');
  });
}

test('cloud VNC refuses an absent existing daemon socket without invoking a CLI or recording recovery', async () => {
  const f = cloudVncRestartFixture();
  f.io.rpc = undefined;
  f.io.lstat = async (path) => {
    assert.equal(path, '/root/.pm2/rpc.sock');
    throw Error('ENOENT');
  };
  f.io.exec = async () => assert.fail('no daemon autostart or CLI fallback');
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.record.cloudMaintenanceEvents.length, 6);
});

for (const [name, fault] of [
  [
    'missing guard',
    (f) => {
      f.io.assertRecoveryScope = undefined;
    },
  ],
  [
    'false guard',
    (f) => {
      f.io.assertRecoveryScope = async () => false;
    },
  ],
  [
    'true guard',
    (f) => {
      f.io.assertRecoveryScope = async () => true;
    },
  ],
  [
    'site source/tools/display/fences not proven',
    (f) => {
      f.io.assertRecoveryScope = async () => {
        throw Error('private source mismatch');
      };
    },
  ],
  [
    'wrong input ID',
    (f) => {
      f.input.pmId = 7;
    },
  ],
  [
    'string input ID',
    (f) => {
      f.input.pmId = '6';
    },
  ],
  [
    'unsafe input ID',
    (f) => {
      f.input.pmId = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'unknown input field',
    (f) => {
      f.input.command = '/bin/sh';
    },
  ],
  [
    'invalid attempt',
    (f) => {
      f.input.attempt = 'not-an-attempt';
    },
  ],
  [
    'invalid stopped digest',
    (f) => {
      f.input.stoppedConfigDigest = 'bad';
    },
  ],
  [
    'non-root caller',
    (f) => {
      f.io.uid = 998;
    },
  ],
  [
    'non-Linux caller',
    (f) => {
      f.io.platform = 'darwin';
    },
  ],
  [
    'wrong phase',
    (f) => {
      f.record.phase = 'candidate_started';
    },
  ],
  [
    'failed attempt',
    (f) => {
      f.record.failureObservation = {};
    },
  ],
  [
    'wrong owner attempt',
    (f) => {
      f.binding.attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
  ],
  [
    'wrong record binding',
    (f) => {
      f.record.inventoryDigest = 'f'.repeat(64);
    },
  ],
  [
    'missing site binding',
    (f) => {
      f.record.executionSiteDigest = undefined;
    },
  ],
  [
    'wrong approved window',
    (f) => {
      f.record.maintenanceEndsAtMs = 7000;
    },
  ],
  [
    'expired window',
    (f) => {
      f.setTime(8000);
    },
  ],
  [
    'excessive window',
    (f) => {
      f.input.maintenanceEndsAtMs = 901001;
    },
  ],
  [
    'wrong scope name',
    (f) => {
      f.record.cloudMaintenanceScope[0].name = 'other-vnc';
    },
  ],
  [
    'wrong scope ID',
    (f) => {
      f.record.cloudMaintenanceScope[0].pmId = 8;
    },
  ],
  [
    'duplicate scope ID',
    (f) => {
      f.record.cloudMaintenanceScope[1].pmId = 6;
    },
  ],
  [
    'wrong headed scope name',
    (f) => {
      f.record.cloudMaintenanceScope[1].name = 'other';
    },
  ],
  [
    'wrong headed recovery material',
    (f) => {
      f.record.cloudMaintenanceScope[1].recoveryDigest = 'f'.repeat(64);
    },
  ],
  [
    'missing VNC recovery material',
    (f) => {
      f.record.cloudMaintenanceScope[0].recoveryDigest = undefined;
    },
  ],
  [
    'unknown scope field',
    (f) => {
      f.record.cloudMaintenanceScope[0].command = '/bin/sh';
    },
  ],
  [
    'missing headed restored observation',
    (f) => {
      f.record.cloudMaintenanceEvents.pop();
    },
  ],
  [
    'intent substituted for headed observation',
    (f) => {
      f.record.cloudMaintenanceEvents[5].phase = 'cloud-restore-intent';
    },
  ],
  [
    'prior event wrong service',
    (f) => {
      f.record.cloudMaintenanceEvents[5].name = 'holaday-vnc';
    },
  ],
  [
    'prior event wrong ID',
    (f) => {
      f.record.cloudMaintenanceEvents[0].pmId = 8;
    },
  ],
  [
    'prior event wrong source digest',
    (f) => {
      f.record.cloudMaintenanceEvents[5].recoveryDigest = 'f'.repeat(64);
    },
  ],
  [
    'prior event wrong attempt',
    (f) => {
      f.record.cloudMaintenanceEvents[5].attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
  ],
  [
    'prior event wrong host',
    (f) => {
      f.record.cloudMaintenanceEvents[5].host = 'aliyun';
    },
  ],
  [
    'unknown prior event field',
    (f) => {
      f.record.cloudMaintenanceEvents[5].command = '/bin/sh';
    },
  ],
  [
    'swapped prior events',
    (f) => {
      f.record.cloudMaintenanceEvents.reverse();
    },
  ],
  [
    'wrong manager name',
    (f) => {
      f.manager.name = 'holaday-chromium-headed';
    },
  ],
  [
    'wrong manager ID',
    (f) => {
      f.manager.pm_id = 8;
    },
  ],
  [
    'wrong nested manager ID',
    (f) => {
      f.manager.pm2_env.pm_id = 8;
    },
  ],
  [
    'wrong nested manager name',
    (f) => {
      f.manager.pm2_env.name = 'other';
    },
  ],
  [
    'live VNC process',
    (f) => {
      f.manager.pid = 40;
    },
  ],
  [
    'non-stopped VNC registration',
    (f) => {
      f.manager.pm2_env.status = 'online';
    },
  ],
  [
    'command drift',
    (f) => {
      f.manager.pm2_env.pm_exec_path = '/opt/holaday-headed/start.sh';
    },
  ],
  [
    'arguments drift',
    (f) => {
      f.manager.pm2_env.args.push('unsafe');
    },
  ],
  [
    'environment drift',
    (f) => {
      f.manager.pm2_env.env.PRIVATE_VALUE = 'changed';
    },
  ],
  [
    'unknown configuration drift',
    (f) => {
      f.manager.pm2_env.originalUnknownField.retained = false;
    },
  ],
  [
    'historical restart-count drift',
    (f) => {
      f.manager.pm2_env.restart_time = 13;
    },
  ],
]) {
  test(`cloud VNC refuses ${name} before any restore intent or dispatch`, async () => {
    const f = cloudVncRestartFixture();
    fault(f);
    const events = structuredClone(f.record.cloudMaintenanceEvents);
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.deepEqual(f.record.cloudMaintenanceEvents, events);
    assert.equal(f.calls.length, 0);
  });
}

for (const [field, value] of [
  ['pm_exec_path', '/opt/holaday-headed/start.sh'],
  ['pm_exec_path', '/bin/sh'],
  ['exec_interpreter', 'node'],
  ['watch', true],
  ['watch', []],
  ['watch', undefined],
  ['exec_mode', 'cluster_mode'],
  ['exec_mode', undefined],
  ['restart_time', -1],
  ['restart_time', undefined],
]) {
  test(`cloud VNC refuses reviewed unsafe or missing manager policy ${field}=${value} without rewriting it`, async () => {
    const f = cloudVncRestartFixture();
    f.manager.pm2_env[field] = value;
    f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
    const original = structuredClone(f.manager.pm2_env);
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.deepEqual(f.manager.pm2_env, original);
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, 6);
  });
}

test('cloud VNC refuses duplicate numeric-ID or fixed-name manager rows', async () => {
  for (const duplicate of [
    { pm_id: 6, name: 'other' },
    { pm_id: 8, name: 'holaday-vnc' },
  ]) {
    const f = cloudVncRestartFixture();
    const rpc = f.io.rpc;
    f.io.rpc = async (method, ...args) =>
      method === 'getMonitorData' ? structuredClone([f.manager, duplicate]) : rpc(method, ...args);
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, 6);
  }
});

for (const [name, fault] of [
  ['deadline', (f) => f.setTime(8000)],
  ['clock rollback', (f) => f.setTime(999)],
  [
    'owner',
    (f) => {
      f.binding.candidate = 'f'.repeat(40);
    },
  ],
  [
    'config',
    (f) => {
      f.manager.pm2_env.env.PRIVATE_VALUE = 'drift';
    },
  ],
  [
    'prior observation',
    (f) => {
      f.record.cloudMaintenanceEvents[5].phase = 'cloud-restore-intent';
    },
  ],
  [
    'site scope',
    (f) => {
      f.record.executionSiteDigest = 'f'.repeat(64);
    },
  ],
  [
    'coherent VNC scope change',
    (f) => {
      f.record.cloudMaintenanceScope[0].recoveryDigest = 'f'.repeat(64);
      for (const event of f.record.cloudMaintenanceEvents)
        if (event.name === 'holaday-vnc') event.recoveryDigest = 'f'.repeat(64);
    },
  ],
]) {
  for (const boundary of ['intent', 'connection']) {
    test(`cloud VNC rechecks ${name} after ${boundary}, retains seventh intent and never sends or retries`, async () => {
      const f = cloudVncRestartFixture();
      if (boundary === 'intent') {
        const append = f.io.journal.recordCloudMaintenanceEvent;
        f.io.journal.recordCloudMaintenanceEvent = async (event) => {
          await append(event);
          fault(f);
        };
      } else {
        const rpc = f.io.rpc;
        f.io.rpc = async (method, ...args) => {
          if (method === 'restartProcessId') fault(f);
          return rpc(method, ...args);
        };
      }
      assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
      await assert.rejects(
        firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
        /UNPROVEN|UNCERTAIN/,
      );
      assert.equal(f.calls.length, 0);
      assert.equal(f.record.cloudMaintenanceEvents.length, 7);
      await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
      assert.equal(f.calls.length, 0);
    });
  }
}

test('cloud VNC requires the same live site guard before intent, after intent and immediately before dispatch', async () => {
  for (const refusedCall of [1, 2, 3]) {
    const f = cloudVncRestartFixture();
    let calls = 0;
    f.io.assertRecoveryScope = async () => {
      if (++calls === refusedCall) throw Error('source/tools/display/fences changed');
    };
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
      /UNPROVEN|UNCERTAIN/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, refusedCall === 1 ? 6 : 7);
  }
});

for (const change of ['deadline', 'ownership']) {
  test(`cloud VNC refuses ${change} lost while awaiting the final journal read before dispatch`, async () => {
    const f = cloudVncRestartFixture();
    let reads = 0;
    const read = f.io.journal.readFirstCutoverEffects;
    f.io.journal.readFirstCutoverEffects = async () => {
      const record = await read();
      if (++reads === 6) {
        if (change === 'deadline') f.setTime(8000);
        else f.binding.candidate = 'f'.repeat(40);
      }
      return record;
    };
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
      /UNPROVEN|UNCERTAIN/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, 7);
  });
}

test('cloud VNC preserves the seventh intent on uncertain RPC failure without leaking or retrying', async () => {
  for (const failure of ['lost-ack', 'post-dispatch-window', 'post-dispatch-binding']) {
    const f = cloudVncRestartFixture();
    const rpc = f.io.rpc;
    f.io.rpc = async (method, ...args) => {
      const result = await rpc(method, ...args);
      if (method === 'restartProcessId') {
        if (failure === 'lost-ack') throw Error('secret raw environment');
        if (failure === 'post-dispatch-window') f.setTime(8000);
        if (failure === 'post-dispatch-binding') f.binding.configDigest = 'f'.repeat(64);
      }
      return result;
    };
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
      /^Error: CUTOVER_CLOUD_RESTORE_UNCERTAIN$/,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.record.cloudMaintenanceEvents.length, 7);
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 1);
  }
});

const digest = 'a'.repeat(64);
function cloudRecoveryObservationFixture() {
  const input = { attempt: '12345678-1234-4234-8234-123456789abc', pmId: 7 };
  const launch = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({ attempt: input.attempt });
  const policy = '/etc/brave/policies/managed';
  const source = `/var/lib/holaday-deploy/maintenance/${input.attempt}/cloud-browser-policy`;
  const privatePolicy = `/proc/40/root${policy}`;
  const files = new Map([
    ['/proc/sys/kernel/random/boot_id', '12345678-1234-4234-8234-123456789def\n'],
    ['/proc/40/stat', `40 (brave) S 20 ${Array(17).fill('0').join(' ')} 1234 0`],
    [
      '/proc/40/cmdline',
      `${launch.args.slice(launch.args.indexOf('/opt/brave.com/brave/brave')).join('\0')}\0`,
    ],
    ['/proc/40/environ', 'DISPLAY=:98\0PRIVATE_VALUE=never-exported\0'],
    [
      '/proc/40/status',
      'Uid:\t0\t0\t0\t0\nCapInh:\t00000000\nCapPrm:\t00000000\nCapEff:\t00000000\nCapBnd:\t00000000\nCapAmb:\t00000000\nNoNewPrivs:\t1\n',
    ],
    ['/proc/40/mountinfo', `23 21 0:1 /private ${policy} ro,relatime - ext4 /dev/qa rw\n`],
  ]);
  for (const path of [policy, source, privatePolicy]) {
    files.set(`${path}/existing.json`, '{"HomepageLocation":"about:blank"}');
    if (path !== policy) files.set(`${path}/recovery.json`, '{"RestoreOnStartup":5}');
  }
  const links = new Map([
    ['/proc/40/exe', '/opt/brave.com/brave/brave'],
    ['/proc/40/ns/mnt', 'mnt:[2]'],
    ['/proc/self/ns/mnt', 'mnt:[1]'],
  ]);
  const manager = {
    name: 'holaday-chromium-headed',
    pm_id: 7,
    pid: 40,
    pm2_env: {
      name: 'holaday-chromium-headed',
      status: 'online',
      pm_exec_path: launch.command,
      args: launch.args,
      exec_interpreter: 'none',
      autorestart: false,
      watch: false,
      restart_time: 0,
      exec_mode: 'fork_mode',
      cron_restart: '',
      DISPLAY: ':98',
    },
  };
  const stat = (path) => ({
    uid: 0,
    mode: files.has(path) ? 0o100644 : 0o40755,
    dev: 1,
    ino: path.includes('recovery.json') ? 4 : path.endsWith('.json') ? 3 : 2,
    size: Buffer.byteLength(files.get(path) ?? ''),
    mtimeMs: 1,
    ctimeMs: 1,
    nlink: 1,
  });
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    readManagers: async () => structuredClone([manager]),
    exec: async () => {
      throw new Error('read-only observation must never launch the PM2 CLI');
    },
    readFile: async (path) => {
      assert.ok(files.has(path), path);
      return files.get(path);
    },
    readlink: async (path) => {
      assert.ok(links.has(path), path);
      return links.get(path);
    },
    readdir: async (path) =>
      path === policy ? ['existing.json'] : ['existing.json', 'recovery.json'],
    lstat: async (path) => stat(path),
  };
  return { input, io, manager, files, links, source, privatePolicy, policy };
}
test('cloud recovery observation reads actual fixed manager, process and private policy without returning configuration contents', async () => {
  const f = cloudRecoveryObservationFixture();
  assert.equal(typeof firstRuntime.readFirstCutoverCloudBrowserRecovery, 'function');
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.pid, 40);
  assert.equal(proof.start, '1234');
  assert.equal(proof.pmId, 7);
  assert.equal(proof.observedAtMs, 1000);
  assert.equal(proof.purpose, 'cloud-browser-runtime-observation');
  assert.match(proof.policyDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(proof).includes('HomepageLocation'), false);
  assert.equal('unknownWriters' in proof, false);
});
test('cloud recovery observation retains historical PM2 restart count without treating it as a new recovery retry', async () => {
  const f = cloudRecoveryObservationFixture();
  f.manager.pm2_env.restart_time = 12;
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.restartCount, 12);
});
test('cloud recovery observation binds the full stable manager config while excluding monitoring counters', async () => {
  const f = cloudRecoveryObservationFixture();
  f.manager.pm2_env.env = { PRIVATE_VALUE: 'must-not-escape' };
  let calls = 0;
  const read = f.io.readManagers;
  f.io.readManagers = async () => {
    f.manager.pm2_env.axm_monitor = { changing: calls++ };
    return read();
  };
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.configDigest, cutoverRegistrationConfigDigest(f.manager.pm2_env));
  assert.equal(JSON.stringify(proof).includes('must-not-escape'), false);
});
for (const [field, value] of [
  ['cron_restart', '* * * * *'],
  ['max_memory_restart', 1024],
  ['max_memory_restart', 0],
  ['max_memory_restart', null],
  ['max_memory_restart', false],
  ['max_memory_restart', 'null'],
  ['exec_mode', 'cluster_mode'],
  ['cron_restart', undefined],
  ['max_memory_restart', undefined],
  ['exec_mode', undefined],
])
  test(`cloud recovery refuses mismatched fixed lifecycle field ${field}=${JSON.stringify(value)}`, async () => {
    const f = cloudRecoveryObservationFixture();
    f.manager.pm2_env[field] = value;
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
    );
  });
test('cloud recovery memory policy accepts only actual field absence', async () => {
  const f = cloudRecoveryObservationFixture();
  assert.equal(Object.hasOwn(f.manager.pm2_env, 'max_memory_restart'), false);
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.pmId, 7);
});
for (const value of [524288000, 0, null, false, 'null', undefined]) {
  test(`cloud recovery refuses nested environment memory=${JSON.stringify(value)} even when outer field is absent`, async () => {
    const f = cloudRecoveryObservationFixture();
    f.manager.pm2_env.env = { max_memory_restart: value };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /UNPROVEN/,
    );
  });
}
for (const field of ['env', 'pm_cwd', 'unknown_future_option'])
  test(`cloud recovery refuses full config drift during observation: ${field}`, async () => {
    const f = cloudRecoveryObservationFixture();
    let calls = 0;
    const read = f.io.readManagers;
    f.io.readManagers = async () => {
      if (calls++) f.manager.pm2_env[field] = { changed: true };
      return read();
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
    );
  });
test('cloud recovery observation refuses unsafe launch, missing protection, conflicting policy and identity races', async () => {
  assert.equal(typeof firstRuntime.readFirstCutoverCloudBrowserRecovery, 'function');
  const faults = {
    platform: (f) => {
      f.io.platform = 'darwin';
    },
    uid: (f) => {
      f.io.uid = 998;
    },
    arbitraryInput: (f) => {
      f.input.pid = 40;
    },
    manager: (f) => {
      f.manager.pm_id++;
    },
    restart: (f) => {
      f.manager.pm2_env.autorestart = true;
    },
    replay: (f) => {
      f.manager.pm2_env.args = [...f.manager.pm2_env.args, 'https://example.invalid/action'];
    },
    script: (f) => {
      f.manager.pm2_env.pm_exec_path = '/opt/holaday-headed/start.sh';
    },
    display: (f) => {
      f.manager.pm2_env.DISPLAY = ':0';
    },
    actualDisplay: (f) => {
      f.files.set('/proc/40/environ', 'DISPLAY=:0\0');
    },
    environmentDisplayDuplicate: (f) => {
      f.files.set('/proc/40/environ', 'DISPLAY=:98\0DISPLAY=:0\0');
    },
    actualArgv: (f) => {
      f.files.set('/proc/40/cmdline', '/opt/brave.com/brave/brave\0--restore-last-session\0');
    },
    actualExe: (f) => {
      f.links.set('/proc/40/exe', '/usr/bin/sleep');
    },
    sameNamespace: (f) => {
      f.links.set('/proc/40/ns/mnt', 'mnt:[1]');
    },
    writableMount: (f) => {
      f.files.set('/proc/40/mountinfo', f.files.get('/proc/40/mountinfo').replace(' ro,', ' rw,'));
    },
    privilege: (f) => {
      f.files.set(
        '/proc/40/status',
        f.files.get('/proc/40/status').replace('CapBnd:\t00000000', 'CapBnd:\t00000001'),
      );
    },
    newPrivileges: (f) => {
      f.files.set(
        '/proc/40/status',
        f.files.get('/proc/40/status').replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0'),
      );
    },
    policyOverride: (f) => {
      f.files.set(`${f.privatePolicy}/recovery.json`, '{"RestoreOnStartup":1}');
    },
    sourceDrift: (f) => {
      f.files.set(`${f.source}/recovery.json`, '{"RestoreOnStartup":1}');
    },
    parentDrift: (f) => {
      f.files.set(`${f.policy}/existing.json`, '{"RestoreOnStartup":1}');
    },
    symlink: (f) => {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => ({ ...(await stat(p)), mode: 0o120777 });
    },
    writable: (f) => {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => ({ ...(await stat(p)), mode: (await stat(p)).mode | 0o002 });
    },
    identityRace: (f) => {
      const read = f.io.readFile;
      let n = 0;
      f.io.readFile = async (p) =>
        p === '/proc/40/stat' && n++ ? (await read(p)).replace('1234', '1235') : read(p);
    },
    managerRace: (f) => {
      const readManagers = f.io.readManagers;
      let n = 0;
      f.io.readManagers = async () => {
        if (n++) f.manager.pid++;
        return readManagers();
      };
    },
    restartRace: (f) => {
      const readManagers = f.io.readManagers;
      let n = 0;
      f.io.readManagers = async () => {
        if (n++) f.manager.pm2_env.restart_time++;
        return readManagers();
      };
    },
    policyRace: (f) => {
      const read = f.io.readFile;
      let n = 0;
      f.io.readFile = async (p) =>
        p === `${f.source}/recovery.json` && n++ ? '{"RestoreOnStartup":1}' : read(p);
    },
  };
  for (const [name, mutate] of Object.entries(faults)) {
    const f = cloudRecoveryObservationFixture();
    mutate(f);
    await assert.rejects(
      () => firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
      name,
    );
  }
});
test('cloud recovery launch cannot select another profile, command, policy directory or restart behavior', () => {
  const build = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch;
  assert.equal(typeof build, 'function');
  const attempt = '12345678-1234-4234-8234-123456789abc';
  for (const input of [
    undefined,
    { attempt: '../other' },
    { attempt, profile: '/another/profile' },
    { attempt, command: '/bin/sh' },
    { attempt, policyDirectory: '/etc/brave/policies/managed' },
    { attempt, autorestart: true },
    { attempt, args: ['https://example.invalid/action'] },
  ])
    assert.throws(() => build(input), /UNPROVEN/);
  const launch = build({ attempt });
  assert.equal(launch.command, '/usr/bin/unshare');
  assert.deepEqual(launch.env, { DISPLAY: ':98' });
  assert.equal(launch.autorestart, false);
  assert.ok(launch.args.includes('--user-data-dir=/var/lib/holaday-headed-brave'));
  assert.ok(launch.args.includes('--remote-debugging-port=9223'));
  assert.ok(launch.args.includes('--no-startup-window'));
  assert.ok(
    launch.args.includes(`/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy`),
  );
  launch.args.push('https://example.invalid/action');
  launch.env.DISPLAY = ':0';
  assert.equal(build({ attempt }).args.includes('https://example.invalid/action'), false);
  assert.deepEqual(build({ attempt }).env, { DISPLAY: ':98' });
});

function interruptionWork() {
  const approval = {
    schemaVersion: 2,
    kind: 'first-cutover',
    attempt: '12345678-1234-4234-8234-123456789abc',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: digest,
    legacyDigest: 'd'.repeat(64),
    maintenanceEndsAtMs: 2000,
    reconcileByMs: 3000,
    operatorRef: 'qa-operator',
    legacyInterruption: {
      mode: 'controlled-interruption',
      scope: 'legacy-non-payment-memory',
      approvalRef: 'legacy-interruption-20260928',
      capabilityDigest: '7'.repeat(64),
      observeUntilMs: 1800,
      noAutomaticReplay: true,
    },
  };
  return {
    approval,
    phase: 'before-stop',
    nowMs: 1000,
    observation: {
      schemaVersion: 2,
      inventoryDigest: digest,
      observedAtMs: 999,
      unsettledWork: 0,
      unknownWriters: 0,
      knownExternalWork: [],
      activeRequests: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      capabilityDigest: '7'.repeat(64),
      replaySourcesDigest: '8'.repeat(64),
      pendingReplay: 0,
    },
  };
}
test('legacy work boundary distinguishes approved unobservable from zero, positive, malformed and expired observations', () => {
  assert.equal(typeof firstRuntime.validateLegacyWorkBoundary, 'function');
  const input = interruptionWork();
  const result = firstRuntime.validateLegacyWorkBoundary(input);
  assert.equal(result.mode, 'controlled-interruption');
  assert.match(result.riskDigest, /^[a-f0-9]{64}$/);
  for (const field of ['activeRequests', 'externalWork']) {
    const zero = structuredClone(input);
    zero.observation[field] = { kind: 'observed', count: 0 };
    assert.deepEqual(firstRuntime.validateLegacyWorkBoundary(zero), result);
    for (const value of [
      null,
      undefined,
      0,
      { kind: 'observed', count: 1 },
      { kind: 'observed', count: -1 },
      { kind: 'unobservable', reason: 'timeout' },
      { kind: 'unobservable', reason: 'legacy-no-inflight-api', count: 0 },
    ]) {
      const bad = structuredClone(input);
      bad.observation[field] = value;
      assert.throws(() => firstRuntime.validateLegacyWorkBoundary(bad), /CUTOVER_/);
    }
  }
  for (const [key, value] of [
    ['unsettledWork', 1],
    ['unknownWriters', 1],
    ['knownExternalWork', ['known-action']],
    ['pendingReplay', 1],
    ['replaySourcesDigest', null],
    ['capabilityDigest', '0'.repeat(64)],
    ['inventoryDigest', '0'.repeat(64)],
    ['observedAtMs', 1001],
    ['schemaVersion', 1],
  ]) {
    const bad = structuredClone(input);
    bad.observation[key] = value;
    assert.throws(() => firstRuntime.validateLegacyWorkBoundary(bad), /CUTOVER_/, key);
  }
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 1801 }),
    /CUTOVER_/,
  );
  assert.deepEqual(
    firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 1801, phase: 'after-stop' }),
    result,
  );
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 2000, phase: 'preopen' }),
    /CUTOVER_/,
  );
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, phase: 'unknown' }),
    /CUTOVER_/,
  );
  assert.throws(
    () =>
      firstRuntime.validateLegacyWorkBoundary({
        ...input,
        approval: { ...input.approval, kind: 'ordinary' },
      }),
    /CUTOVER_/,
  );
  const strict = {
    ...input,
    approval: { schemaVersion: 1, inventoryDigest: digest },
    observation: {
      inventoryDigest: digest,
      observedAtMs: 999,
      unsettledWork: 0,
      externalWork: 0,
      activeRequests: 0,
      unknownWriters: 0,
    },
  };
  assert.deepEqual(firstRuntime.validateLegacyWorkBoundary(strict), { mode: 'drained' });
  strict.observation.externalWork = null;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(strict), /CUTOVER_/);
  strict.observation.externalWork = 0;
  strict.approval.schemaVersion = 3;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(strict), /CUTOVER_/);
});
test('runtime preserves the actual mixed-case kernel hostname in captured targets', async () => {
  const f = fixture();
  f.inventory.host = 'iZbp1ActualNodeZ';
  f.inventory.processes[0].host = f.inventory.host;
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.inventory.processes },
    f.io,
  );
  assert.equal(captured.targets[0].host, f.inventory.host);
});
const manager = {
  kind: 'pm2',
  pid: 50,
  start: '200',
  exe: '/opt/node22/bin/node',
  argvDigest: 'b'.repeat(64),
  pm2Home: '/root/.pm2',
  version: '6.0.14',
  pmId: 2,
  name: 'holaday-orchestrator',
  configDigest: 'c'.repeat(64),
  killTimeoutMs: 1600,
  killSignal: 'SIGINT',
  watch: false,
  cron: false,
  memoryRestart: 0,
};
const target = {
  host: 'vultr',
  bootId: 'd'.repeat(32),
  pid: 100,
  ppid: 50,
  start: '300',
  uids: [998, 998, 998, 998],
  exe: '/opt/node22/bin/node',
  cwd: '/opt/holaday-monorepo/apps/orchestrator',
  argvDigest: 'e'.repeat(64),
  role: 'main',
  managerIdentity: manager,
};
function fixture() {
  let now = 1000;
  const inventory = {
    inventoryDigest: digest,
    host: 'vultr',
    bootId: target.bootId,
    observedAtMs: now,
    processes: [structuredClone(target)],
    unknownLaunchers: [],
    managers: [{ ...manager, status: 'online', rootPid: 100 }],
    listeners: [{ port: 4001, pid: 100 }],
    ports: [4001, 4002],
  };
  const events = [];
  const io = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    readInventory: async () => structuredClone({ ...inventory, observedAtMs: now }),
    assertJournalOwnership: async () => ({ inventoryDigest: digest }),
    verifyFence: async () => ({
      inventoryDigest: digest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    pm2Stop: async (p) => {
      events.push(['pm2', p.pid, p.managerIdentity.pmId]);
      inventory.processes = [];
      inventory.listeners = [];
      inventory.managers[0].status = 'stopped';
      inventory.managers[0].rootPid = 0;
    },
    signalPinned: async (p) => {
      events.push(['pidfd', p.pid]);
      inventory.processes = [];
      inventory.listeners = [];
    },
  };
  return { inventory, io, events };
}
const capture = (f) =>
  captureLegacyRuntime(
    { inventory: structuredClone(f.inventory), approvedTargets: [structuredClone(target)] },
    f.io,
  );

// Registration deletion must use the real scheduler settings; treating memory
// restart as zero or inventing a PID for a stopped cron job hides a live source.
test('registration capture preserves memory restart and stopped cron without weakening stop capture', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  const f = fixture();
  const workerManager = {
    ...manager,
    name: 'holaday-account-closure-worker',
    memoryRestart: 536870912,
    killTimeoutMs: 660000,
  };
  const worker = { ...target, role: 'worker', managerIdentity: workerManager };
  const cron = {
    ...manager,
    pmId: 5,
    name: 'holaday-files-cron',
    cron: '0 * * * *',
    status: 'stopped',
    rootPid: 0,
  };
  f.inventory.processes = [worker];
  f.inventory.managers = [{ ...workerManager, status: 'online', rootPid: 100 }, cron];
  await assert.rejects(
    captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [worker] }, f.io),
    /CUTOVER_/,
  );
  const captured = await firstRuntime.captureLegacyRegistrations(
    {
      inventory: f.inventory,
      approvedTargets: [worker],
      approvedRegistrations: f.inventory.managers,
    },
    f.io,
  );
  assert.equal(captured.retirement, 'delete-registration');
  assert.equal(captured.managers[0].memoryRestart, 536870912);
  assert.equal(captured.managers[1].rootPid, 0);
  assert.deepEqual(captured.targets, [worker]);
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 900000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});

test('stopped cron alone can be captured only with zero physical processes and listeners', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  const f = fixture();
  f.inventory.processes = [];
  f.inventory.listeners = [];
  f.inventory.managers = [
    {
      ...manager,
      name: 'holaday-files-cron',
      pmId: 5,
      cron: '0 * * * *',
      status: 'stopped',
      rootPid: 0,
    },
  ];
  const input = {
    inventory: f.inventory,
    approvedTargets: [],
    approvedRegistrations: f.inventory.managers,
  };
  const result = await firstRuntime.captureLegacyRegistrations(input, f.io);
  assert.equal(result.targets.length, 0);
  for (const change of [
    (s) => {
      s.managers[0].name = 'unrelated';
    },
    (s) => {
      s.managers[0].rootPid = 999;
    },
    (s) => {
      s.managers[0].status = 'online';
    },
    (s) => {
      s.managers[0].version = '6.0.13';
    },
    (s) => {
      s.managers[0].watch = true;
    },
    (s) => {
      s.managers[0].memoryRestart = -1;
    },
    (s) => {
      s.managers[0].cron = '* * * * *';
    },
    (s) => {
      s.managers.push(structuredClone(s.managers[0]));
    },
    (s) => {
      s.listeners = [{ pid: 999, port: 4001 }];
    },
    (s) => {
      s.unknownLaunchers = ['unexpected'];
    },
  ]) {
    const inventory = structuredClone(f.inventory);
    change(inventory);
    await assert.rejects(
      firstRuntime.captureLegacyRegistrations(
        { inventory, approvedTargets: [], approvedRegistrations: inventory.managers },
        f.io,
      ),
      /CUTOVER_/,
    );
  }
});

test('registration capture refuses omitted, drifted and role-mismatched managed scopes', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  for (const change of [
    (i) => {
      i.approvedRegistrations = [];
    },
    (i) => {
      i.approvedRegistrations[0].configDigest = 'f'.repeat(64);
    },
    (i) => {
      i.inventory.managers[0].rootPid = 999;
    },
    (i) => {
      i.approvedTargets[0].managerIdentity.name = 'holaday-cn-payment';
      i.inventory.processes = structuredClone(i.approvedTargets);
      i.inventory.managers[0].name = 'holaday-cn-payment';
      i.approvedRegistrations[0].name = 'holaday-cn-payment';
    },
  ]) {
    const f = fixture();
    const input = structuredClone({
      inventory: f.inventory,
      approvedTargets: f.inventory.processes,
      approvedRegistrations: f.inventory.managers,
    });
    change(input);
    await assert.rejects(firstRuntime.captureLegacyRegistrations(input, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
});

function producerFixture() {
  const f = fixture();
  f.io.verifyFence = async () => ({
    inventoryDigest: digest,
    stage: 'orders',
    observedAtMs: f.io.now(),
    unsettledWork: 0,
    externalWork: 0,
    activeRequests: 0,
    unknownWriters: 0,
    producersRunning: f.inventory.processes.length,
    runningProducers: structuredClone(f.inventory.processes),
  });
  return f;
}
test('interrupted producer stop needs the live owned receipt and rejects replay on the post-stop read', async () => {
  for (const fault of [
    undefined,
    'missing-reader',
    'missing-receipt',
    'wrong-risk',
    'wrong-owner',
    'wrong-phase',
    'failure',
    'known-work',
    'stripped',
    'post-stop-replay',
  ]) {
    const f = producerFixture();
    const input = interruptionWork();
    const riskDigest = firstRuntime.validateLegacyWorkBoundary(input).riskDigest;
    const effects = {
      ...input.approval,
      riskDigest,
      recordDigest: '1'.repeat(64),
      phase: 'producers_stopped',
      interruptionObservation: {
        riskDigest,
        sourceDigest: '2'.repeat(64),
        fenceDigest: '3'.repeat(64),
        observedAtMs: 999,
      },
    };
    if (fault === 'missing-receipt') effects.interruptionObservation = undefined;
    if (fault === 'wrong-risk') effects.riskDigest = '0'.repeat(64);
    if (fault === 'wrong-phase') effects.phase = 'orders_fenced';
    if (fault === 'failure') effects.failureObservation = {};
    if (fault !== 'missing-reader')
      f.io.readFirstCutoverEffects = async () => structuredClone(effects);
    f.io.assertJournalOwnership = async () => ({
      inventoryDigest: digest,
      attempt: fault === 'wrong-owner' ? 'other' : effects.attempt,
    });
    const base = f.io.verifyFence;
    f.io.verifyFence = async () => {
      const observation = structuredClone(input.observation);
      if (fault === 'known-work') observation.knownExternalWork = ['identified-action'];
      if (fault === 'post-stop-replay' && f.events.length) observation.pendingReplay = 1;
      if (fault === 'stripped') return base();
      return {
        ...(await base()),
        activeRequests: observation.activeRequests,
        externalWork: observation.externalWork,
        riskDigest,
        legacyWork: { before: observation, after: structuredClone(observation) },
      };
    };
    const captured = await capture(f);
    if (fault) {
      await assert.rejects(
        retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io),
        /CUTOVER_/,
        fault,
      );
      assert.equal(f.events.length, fault === 'post-stop-replay' ? 1 : 0, fault);
    } else {
      assert.equal(
        (await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io)).phase,
        'producers-stopped',
      );
      assert.deepEqual(f.events, [['pm2', 100, 2]]);
    }
  }
});
test('producer-first stop accepts observed running producers only after orders isolation and work checks', async () => {
  const f = producerFixture();
  const captured = await capture(f);
  const receipt = await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io);
  assert.equal(receipt.phase, 'producers-stopped');
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
  assert.equal(f.inventory.processes.length, 0);
  await assert.rejects(
    retireLegacyRuntime({ captured, producerReceipt: receipt, deadlineMs: 5000 }, f.io),
    /CUTOVER_/,
  );
  f.io.verifyFence = fixture().io.verifyFence;
  const stopped = await retireLegacyRuntime(
    { captured, producerReceipt: receipt, deadlineMs: 5000 },
    f.io,
  );
  assert.equal(stopped.phase, 'stopped');
  assert.equal(f.events.length, 1); // Never signal an already-retired producer again.
});
test('producer-first work, source age and complete producer identity independently guard every stop', async () => {
  for (const bad of [
    { activeRequests: 1 },
    { unsettledWork: 1 },
    { externalWork: 1 },
    { unknownWriters: 1 },
    { observedAtMs: -60000 },
    { observedAtMs: 1001 },
    { producersRunning: 0 },
    { runningProducers: [] },
    { stage: 'unfenced' },
    { runningProducers: [{ ...target, pid: 999 }] },
  ]) {
    const f = producerFixture();
    const verify = f.io.verifyFence;
    f.io.verifyFence = async () => ({ ...(await verify()), ...bad });
    await assert.rejects(
      retireLegacyProducers({ captured: await capture(f), deadlineMs: 5000 }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});
test('producer-first gateway or unapproved host process is never silently treated as a producer', async () => {
  const f = producerFixture();
  const gateway = {
    ...target,
    role: 'gateway',
    cwd: '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641',
  };
  f.inventory.processes = [gateway];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [gateway] },
    f.io,
  );
  await assert.rejects(retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});
test('producer receipt cannot be copied, altered or used after a producer respawns', async () => {
  for (const change of ['copy', 'alter', 'respawn', 'manager', 'port']) {
    const f = producerFixture();
    const captured = await capture(f);
    let receipt = await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io);
    if (change === 'copy') receipt = structuredClone(receipt);
    if (change === 'alter') receipt.inventoryDigest = 'f'.repeat(64);
    if (change === 'respawn') f.inventory.processes = [{ ...target, start: '999' }];
    if (change === 'manager') f.inventory.managers[0].status = 'online';
    if (change === 'port') f.inventory.listeners = [{ pid: 999, port: 4001 }];
    f.io.verifyFence = fixture().io.verifyFence;
    await assert.rejects(
      retireLegacyRuntime({ captured, producerReceipt: receipt, deadlineMs: 5000 }, f.io),
      /CUTOVER_/,
    );
    assert.equal(f.events.length, 1);
  }
});
test('producer command boundary accepts orders stage without weakening the ordinary first-stop factory', async () => {
  const f = producerFixture();
  const captured = await capture(f);
  const calls = [];
  const system = {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => {
      calls.push(args);
    },
  };
  const producer = createLegacyProducerEffects(f.io, captured, system);
  await producer.pm2Stop(target);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '2', '--watch']]);
  await assert.rejects(createLegacyRuntimeEffects(f.io, system).pm2Stop(target), /CUTOVER_/);
  f.io.verifyFence = async () => ({
    stage: 'orders',
    unsettledWork: 0,
    externalWork: 0,
    producersRunning: 0,
  });
  await assert.rejects(producer.pm2Stop(target), /CUTOVER_/);
  assert.equal(calls.length, 1);
});

test('PM2 capture accepts auto-restarting legacy app but records exact identity and stops only its id', async () => {
  const f = fixture();
  const captured = await capture(f);
  assert.equal(captured.targets[0].pid, 100);
  assert.equal(captured.inventoryDigest, digest);
  const stopped = await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
  assert.equal(stopped.inventoryDigest, digest);
  assert.equal(stopped.phase, 'stopped');
});

test('system Node PM2 manager is distinct from the UID998 Node22 application identity', async () => {
  const f = fixture();
  const approved = structuredClone(target);
  approved.managerIdentity.exe = '/usr/bin/node';
  f.inventory.processes = [structuredClone(approved)];
  f.inventory.managers[0].exe = '/usr/bin/node';
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [approved] },
    f.io,
  );
  assert.equal(captured.targets[0].exe, '/opt/node22/bin/node');
  assert.deepEqual(captured.targets[0].uids, [998, 998, 998, 998]);
  assert.equal(captured.managers[0].exe, '/usr/bin/node');
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).pm2Stop(approved);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '2', '--watch']]);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
});

test('system manager support does not accept a root application or arbitrary executable', async () => {
  for (const change of [
    (p) => {
      p.uids = [0, 0, 0, 0];
    },
    (p) => {
      p.exe = '/usr/bin/node';
    },
    (p) => {
      p.managerIdentity.exe = '/tmp/node';
    },
  ]) {
    const f = fixture();
    const p = structuredClone(target);
    p.managerIdentity.exe = '/usr/bin/node';
    change(p);
    f.inventory.processes = [p];
    f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [p] }, f.io),
      /CUTOVER_RUNTIME_UNPROVEN/,
    );
    assert.deepEqual(f.events, []);
  }
});

test('approved system manager replacement is refused immediately before the command', async () => {
  const f = fixture();
  const p = structuredClone(target);
  p.managerIdentity.exe = '/usr/bin/node';
  f.inventory.processes = [structuredClone(p)];
  f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  // Both are otherwise eligible executables; approval is still for one exact daemon.
  f.inventory.managers[0].exe = '/opt/node22/bin/node';
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  let calls = 0;
  await assert.rejects(
    createLegacyRuntimeEffects(f.io, {
      platform: 'linux',
      uid: 0,
      exec: async () => {
        calls++;
      },
    }).pm2Stop(p),
    /CUTOVER_/,
  );
  assert.equal(calls, 0);
});

test('explicit eleven-minute stop policy fits a bounded window without shortening PM2 timeout', async () => {
  const f = fixture();
  const p = structuredClone(target);
  p.role = 'worker';
  p.managerIdentity.killTimeoutMs = 660000;
  p.managerIdentity.name = 'holaday-account-closure-worker';
  f.inventory.processes = [p];
  f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  const stop = f.io.pm2Stop;
  f.io.pm2Stop = async (approved) => {
    assert.equal(approved.managerIdentity.killTimeoutMs, 660000);
    await f.io.sleep(660000);
    await stop(approved);
  };
  const receipt = await retireLegacyRuntime({ captured, deadlineMs: 720000 }, f.io);
  assert.equal(receipt.phase, 'stopped');
  assert.equal(receipt.observedAtMs, 661100);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
});

test('insufficient total stop budget refuses before stopping even the first approved process', async () => {
  const f = fixture();
  const worker = structuredClone(target);
  worker.pid = 101;
  worker.role = 'worker';
  worker.managerIdentity.pmId = 3;
  worker.managerIdentity.name = 'holaday-account-closure-worker';
  worker.managerIdentity.killTimeoutMs = 4000;
  f.inventory.processes.push(worker);
  f.inventory.managers.push({ ...worker.managerIdentity, status: 'online', rootPid: worker.pid });
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.inventory.processes },
    f.io,
  );
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});

test('unknown timeout and restart policies stay blocked instead of being silently normalized', async () => {
  for (const bad of [
    { killTimeoutMs: null },
    { killTimeoutMs: 660001 },
    { killTimeoutMs: 0 },
    { memoryRestart: 536870912 },
    { cron: '0 * * * *' },
    { watch: true },
  ]) {
    const f = fixture();
    const p = { ...target, managerIdentity: { ...manager, ...bad } };
    f.inventory.processes = [p];
    f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [p] }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});

function gatewayTreeFixture() {
  const f = fixture();
  const cwd = '/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820/apps/cn-payment';
  const m = { ...manager, exe: '/usr/bin/node', name: 'holaday-cn-payment', pmId: 1 };
  const executables = [
    '/usr/bin/node',
    '/usr/bin/dash',
    '/usr/bin/node',
    '/usr/bin/node',
    '/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820/node_modules/.pnpm/@esbuild+linux-x64@0.27.7/node_modules/@esbuild/linux-x64/bin/esbuild',
  ];
  const tree = executables.map((exe, i) => ({
    ...target,
    host: 'aliyun',
    pid: 100 + i,
    ppid: i ? 99 + i : 50,
    start: String(300 + i),
    exe,
    cwd,
    role: 'gateway',
    uids: [0, 0, 0, 0],
    managerIdentity: { ...m },
  }));
  Object.assign(f.inventory, {
    host: 'aliyun',
    processes: tree,
    managers: [{ ...m, status: 'online', rootPid: 100 }],
    ports: [4010],
    listeners: [{ port: 4010, pid: 103 }],
  });
  return { ...f, tree };
}

test('audited root gateway Node-shell-esbuild tree is captured whole and stopped by one PM2 id', async () => {
  const f = gatewayTreeFixture();
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.tree },
    f.io,
  );
  assert.equal(captured.targets.length, 5);
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).pm2Stop(f.tree[0], f.tree);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '1', '--watch']]);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 1]]);
});

test('root gateway exceptions never include another release, app, uid mix or executable', async () => {
  for (const change of [
    (tree) => {
      tree[4].exe = tree[4].exe.replace('604ddf17e84a', 'aaaaaaaaaaaa');
    },
    (tree) => {
      tree[1].exe = '/usr/bin/bash';
    },
    (tree) => {
      tree[3].cwd = '/opt/holaday-monorepo/apps/orchestrator';
    },
    (tree) => {
      tree[3].uids = [0, 998, 0, 0];
    },
    (tree) => {
      tree[3].role = 'worker';
    },
    (tree) => {
      tree[3].cwd = tree[3].cwd.replace('604ddf17e84a', 'aaaaaaaaaaaa');
    },
    (tree) => {
      for (const p of tree) p.managerIdentity.name = 'unrelated';
    },
    (tree) => {
      tree[0].exe = '/usr/bin/dash';
    },
    (tree) => {
      tree[3].ppid = 999;
    },
  ]) {
    const f = gatewayTreeFixture();
    change(f.tree);
    f.inventory.managers[0] = { ...f.tree[0].managerIdentity, status: 'online', rootPid: 100 };
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: f.tree }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});

test('unmanaged root gateway stays restricted to system Node and exact release application path', async () => {
  const f = gatewayTreeFixture();
  const p = { ...f.tree[0], ppid: 1, managerIdentity: { kind: 'unmanaged' } };
  f.inventory.processes = [p];
  f.inventory.managers = [];
  f.inventory.listeners = [{ pid: p.pid, port: 4010 }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).signalPinned(p);
  assert.deepEqual(JSON.parse(calls[0][2].input), p);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pidfd', 100]]);
  for (const change of [{ exe: '/usr/bin/dash' }, { cwd: p.cwd.replace('/apps/cn-payment', '') }]) {
    const invalid = { ...p, ...change };
    f.inventory.processes = [invalid];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [invalid] }, f.io),
      /CUTOVER_/,
    );
  }
});

test('a managed root gateway cannot mix the older UID998 profile into its approved tree', async () => {
  const f = gatewayTreeFixture();
  f.tree[3].uids = [998, 998, 998, 998];
  f.tree[3].exe = '/opt/node22/bin/node';
  // Keep a leaf so no other child's ancestry check hides the mixed-profile defect.
  f.tree.pop();
  await assert.rejects(
    captureLegacyRuntime({ inventory: f.inventory, approvedTargets: f.tree }, f.io),
    /CUTOVER_/,
  );
  assert.deepEqual(f.events, []);
});

test('command boundary independently refuses an orphan in an otherwise matching gateway tree', async () => {
  const f = gatewayTreeFixture();
  f.tree[4].ppid = 999;
  let calls = 0;
  await assert.rejects(
    createLegacyRuntimeEffects(f.io, {
      platform: 'linux',
      uid: 0,
      exec: async () => {
        calls++;
      },
    }).pm2Stop(f.tree[0], f.tree),
    /CUTOVER_/,
  );
  assert.equal(calls, 0);
});

for (const [field, value] of [
  ['pid', 101],
  ['start', '301'],
  ['uids', [998, 0, 998, 998]],
  ['exe', '/tmp/node'],
  ['cwd', '/opt/other'],
  ['argvDigest', 'f'.repeat(64)],
  ['bootId', 'f'.repeat(32)],
  ['managerIdentity', { ...manager, pmId: 3 }],
]) {
  test(`changed ${field} refuses before any stop`, async () => {
    const f = fixture();
    const captured = await capture(f);
    f.inventory.processes[0][field] = value;
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  });
}

test('unknown process, orphan child or launcher cannot disappear from approval scope', async () => {
  for (const change of [
    (f) => f.inventory.processes.push({ ...target, pid: 101, ppid: 1 }),
    (f) => f.inventory.unknownLaunchers.push('unmapped-systemd'),
    (f) => {
      f.inventory.managers[0].cron = '* * * * *';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(capture(f), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
});

test('busy work, invalid fence or lost journal prevents stop', async () => {
  for (const bad of [
    { unsettledWork: 1 },
    { externalWork: 1 },
    { producersRunning: 1 },
    { stage: 'orders' },
    { inventoryDigest: '0'.repeat(64) },
  ]) {
    const f = fixture();
    const captured = await capture(f);
    const verify = f.io.verifyFence;
    f.io.verifyFence = async () => ({ ...(await verify()), ...bad });
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
  const f = fixture();
  const captured = await capture(f);
  f.io.assertJournalOwnership = async () => {
    throw new Error('lost-lock');
  };
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io));
  assert.deepEqual(f.events, []);
});

test('original survivor times out, and a respawn is never signalled a second time', async () => {
  for (const respawn of [false, true]) {
    const f = fixture();
    const captured = await capture(f);
    f.io.pm2Stop = async () => {
      f.events.push('stop');
      if (respawn) f.inventory.processes[0].start = '500';
    };
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, ['stop']);
  }
});

test('remaining port owner or manager still online prevents stopped receipt', async () => {
  for (const which of ['port', 'manager']) {
    const f = fixture();
    const captured = await capture(f);
    f.io.pm2Stop = async () => {
      f.inventory.processes = [];
      if (which === 'manager') f.inventory.listeners = [];
      else {
        f.inventory.managers[0].status = 'stopped';
        f.inventory.managers[0].rootPid = 0;
      }
    };
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  }
});

test('unmanaged gateway uses pinned TERM, not PM2 or main identity', async () => {
  const f = fixture();
  const gateway = {
    ...target,
    ppid: 1,
    role: 'gateway',
    cwd: '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641',
    managerIdentity: { kind: 'unmanaged' },
  };
  f.inventory.processes = [gateway];
  f.inventory.managers = [];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [gateway] },
    f.io,
  );
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pidfd', 100]]);
});

test('first-cutover never relaxes normal runtime proof', async () => {
  await assert.rejects(
    retireMaintenanceRuntime({
      identity: { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
      main: {
        pid: 100,
        start: '123',
        uid: 998,
        command: 'main',
        autorestart: false,
        cwd: '/opt/holaday-monorepo/apps/orchestrator',
      },
      effects: {},
      deadlineMs: 1000,
    }),
    /MAINTENANCE_STOP_INPUT/,
  );
});

async function stateFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-first-state-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = '/var/lib/holaday';
  const path = (p) =>
    p === base || p.startsWith(`${base}/`)
      ? root + p.slice(base.length)
      : (() => {
          throw new Error('unexpected path');
        })();
  const changes = [];
  let seed;
  const io = {
    platform: 'linux',
    uid: 0,
    applicationGid: 998,
    now: () => 1000,
    assertJournalOwnership: async () => ({
      candidate: 'c'.repeat(40),
      attempt: '11111111-1111-4111-8111-111111111111',
      inventoryDigest: digest,
    }),
    assertStopped: async () => ({
      inventoryDigest: digest,
      observedAtMs: 1000,
      phase: 'stopped',
      survivors: [],
      listeners: [],
      unknownLaunchers: [],
    }),
    verifyFence: async () => ({
      inventoryDigest: digest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    recordBootstrap: async (value) => {
      seed = value;
      changes.push('journal');
    },
    fs: {
      ...fs,
      realpath: async (p) => (await fs.realpath(path(p))).replace(root, base),
      lstat: async (p) => Object.assign(await fs.lstat(path(p)), { uid: 998 }),
      mkdir: async (p, options) => {
        changes.push('mkdir');
        return fs.mkdir(path(p), options);
      },
      chown: async (p, uid, gid) => {
        changes.push(['chown', p, uid, gid]);
      },
      open: async (p, flags, mode) => {
        const handle = await fs.open(path(p), flags, mode);
        handle.chown = async (uid, gid) => {
          changes.push(['file-chown', uid, gid]);
        };
        return handle;
      },
    },
  };
  const input = {
    candidate: 'c'.repeat(40),
    attempt: '11111111-1111-4111-8111-111111111111',
    stoppedEvidence: { inventoryDigest: digest, observedAtMs: 1000, phase: 'stopped' },
  };
  return { io, input, root, changes, seed: () => seed };
}

test('first state is canonical closed state; seed is journaled before any filesystem creation', async (t) => {
  const f = await stateFixture(t);
  const result = await initializeFirstMaintenanceState(f.input, f.io);
  assert.match(result.bootstrapSeed, /^[a-f0-9]{32}$/);
  assert.equal(result.bootstrapSeed, f.seed());
  assert.deepEqual(f.changes.slice(0, 2), ['journal', 'mkdir']);
  const directory = join(f.root, 'ordinary-maintenance');
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(directory, 'state.json'))).mode & 0o777, 0o600);
  assert.equal(
    await fs.readFile(join(directory, 'state.json'), 'utf8'),
    `{"schemaVersion":1,"candidate":"${f.input.candidate}","bootId":"${result.bootstrapSeed}","mode":"closed","needsReconciliation":false}\n`,
  );
  assert(f.changes.some((x) => Array.isArray(x) && x[0] === 'file-chown' && x[1] === 998));
});

test('existing or half-written state directory is never overwritten', async (t) => {
  const f = await stateFixture(t);
  const directory = join(f.root, 'ordinary-maintenance');
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(join(directory, 'writer.lock'), 'uncertain');
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
  assert.deepEqual(f.changes, []);
  assert.equal(await fs.readFile(join(directory, 'writer.lock'), 'utf8'), 'uncertain');
});

test('stale stop proof, resumed writer or foreign journal prevents state creation', async (t) => {
  for (const kind of ['stale', 'live', 'journal', 'fence']) {
    const f = await stateFixture(t);
    if (kind === 'stale') f.input.stoppedEvidence.observedAtMs = -100000;
    if (kind === 'live') f.io.assertStopped = async () => ({ survivors: [100] });
    if (kind === 'journal') f.io.assertJournalOwnership = async () => ({ attempt: 'foreign' });
    if (kind === 'fence') f.io.verifyFence = async () => ({ stage: 'orders' });
    await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
    assert.deepEqual(await fs.readdir(f.root), []);
  }
});

test('failed state write leaves unmistakable incomplete directory and never permits retry overwrite', async (t) => {
  const f = await stateFixture(t);
  const open = f.io.fs.open;
  f.io.fs.open = async (p, ...args) => {
    if (p.endsWith('state.json')) throw new Error('disk-full');
    return open(p, ...args);
  };
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
  assert.deepEqual(await fs.readdir(join(f.root, 'ordinary-maintenance')), []);
  f.io.fs.open = open;
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
});

test('real command boundary uses fixed PM2 argv for exactly one observed id', async () => {
  const f = fixture();
  const calls = [];
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      return '';
    },
  });
  await effects.pm2Stop(target);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pm2');
  assert.deepEqual(calls[0].args, ['stop', '2', '--watch']);
  assert.equal(calls[0].options.env.PM2_HOME, '/root/.pm2');
  assert.equal(calls[0].options.env.PATH, '/opt/node22/bin:/usr/local/bin:/usr/bin:/bin');
  assert.equal(calls[0].options.env.DASHSCOPE_API_KEY, undefined);
});

test('command boundary rechecks tree after earlier runtime checks and sanitizes errors', async () => {
  const f = fixture();
  let calls = 0;
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async () => {
      calls++;
      throw new Error('secret command output');
    },
  });
  f.inventory.processes.push({ ...target, pid: 101, ppid: 100 });
  await assert.rejects(effects.pm2Stop(target, [target]), /CUTOVER_/);
  assert.equal(calls, 0);
  f.inventory.processes.pop();
  await assert.rejects(effects.pm2Stop(target), { message: 'CUTOVER_STOP_UNCERTAIN' });
  assert.equal(calls, 1);
});

test('unmanaged command target is JSON stdin, never a shell argument or PM2 stop', async () => {
  const f = fixture();
  const calls = [];
  const p = { ...target, ppid: 1, managerIdentity: { kind: 'unmanaged' } };
  f.inventory.processes = [p];
  f.inventory.managers = [];
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => {
      calls.push(args);
      return '';
    },
  });
  await effects.signalPinned(p);
  assert.equal(calls[0][0], '/usr/bin/python3');
  assert.equal(calls[0][1].at(-1), '--stdin');
  assert.deepEqual(JSON.parse(calls[0][2].input), p);
});
