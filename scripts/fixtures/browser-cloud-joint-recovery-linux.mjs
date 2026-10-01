// Helpers for the original --scoped-pm2 fixture's genuine headed + VNC mode.
// Only disposable containers. Backup/candidate/business prerequisites remain synthetic.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  compareCutoverCloudVncRecoveryConfig,
  cutoverRegistrationConfigDigest,
} from '../browser-cutover-evidence.mjs';
import {
  firstCutoverCloudVncRecoveryMaterial,
  readFirstCutoverCloudManagers,
  readFirstCutoverCloudRecovery,
  readFirstCutoverCloudRecoveryCensus,
  readFirstCutoverCloudRecoverySources,
  restoreFirstCutoverCloudVnc,
} from '../browser-first-cutover-runtime.mjs';

const nativeSockets = [];
const qaError = (e) => ({
  code: String(e?.code ?? ''),
  message: String(e?.message ?? '').slice(0, 512),
});
async function until(check) {
  const end = performance.now() + 10000;
  do {
    if (await check()) return;
    await sleep(50);
  } while (performance.now() < end);
  throw Error('QA_JOINT_WAIT_EXPIRED');
}
async function webReady() {
  // Passive readiness: an HTTP probe would itself create a websockify handler
  // and race the zero-handler/census assertions this fixture is meant to test.
  const rows = (await fs.readFile('/proc/net/tcp', 'utf8'))
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/));
  return ['0100007F:170D', '0100007F:17C0'].every((address) =>
    rows.some((fields) => fields[1] === address && fields[3] === '0A'),
  );
}
export async function prepareJointVnc(pm2, { deferStop = false } = {}) {
  await fs.access('/.dockerenv');
  assert.equal(process.getuid(), 0);
  assert.equal(await fs.realpath('/usr/bin/python3'), '/usr/bin/python3.10');
  await fs.mkdir('/opt/holaday-vnc', { mode: 0o755 });
  await fs.writeFile(
    '/opt/holaday-vnc/start.sh',
    `#!/bin/bash
set -u
cleanup() { pkill -P $$ 2>/dev/null || true; }
trap cleanup EXIT TERM INT
(
 while true; do
  x11vnc -display :98 -forever -nopw -shared -noxdamage -listen 127.0.0.1 -rfbport 5901
  sleep 2
 done
) &
sleep 2
while true; do
 websockify --heartbeat 30 --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5901
 sleep 2
done
`,
    { flag: 'wx', mode: 0o700 },
  );
  await pm2(
    'start',
    '/opt/holaday-vnc/start.sh',
    '--name',
    'holaday-vnc',
    '--interpreter',
    'bash',
    '--cwd',
    '/opt/holaday-vnc',
    '--no-autorestart',
    '--kill-timeout',
    '1600',
  );
  await until(webReady);
  const row = JSON.parse(await pm2('jlist')).find((r) => r.name === 'holaday-vnc');
  assert.ok(row?.pid > 1);
  assert.equal(Object.hasOwn(row.pm2_env, 'DISPLAY'), false);
  assert.equal(Object.hasOwn(row.pm2_env.env, 'DISPLAY'), false);
  const firstCensus = await readFirstCutoverCloudRecoveryCensus();
  const originalRoot = firstCensus.processes.find((p) => p.pid === row.pid);
  assert.ok(originalRoot);
  const stop = async (beforeStop) => {
    await until(webReady);
    const live = JSON.parse(await pm2('jlist')).find((r) => r.pm_id === row.pm_id);
    assert.equal(live.pid, row.pid);
    assert.equal(
      cutoverRegistrationConfigDigest(live.pm2_env),
      cutoverRegistrationConfigDigest(row.pm2_env),
    );
    await beforeStop?.();
    const census = await readFirstCutoverCloudRecoveryCensus();
    assert.deepEqual(
      census.processes.find((p) => p.pid === row.pid),
      originalRoot,
    );
    const ids = new Set([row.pid]);
    for (let i = 0; i < census.processes.length; i++)
      for (const p of census.processes) if (ids.has(p.ppid)) ids.add(p.pid);
    const oldTree = census.processes.filter((p) => ids.has(p.pid));
    assert.ok(oldTree.some((p) => p.exe === '/usr/bin/x11vnc'));
    assert.ok(oldTree.some((p) => p.exe === '/usr/bin/python3.10'));
    await pm2('stop', String(row.pm_id));
    await until(async () => {
      const after = await readFirstCutoverCloudRecoveryCensus();
      return oldTree.every(
        (old) => !after.processes.some((p) => p.pid === old.pid && p.start === old.start),
      );
    });
    const stopped = JSON.parse(await pm2('jlist')).find((r) => r.pm_id === row.pm_id);
    assert.equal(stopped.pid, 0);
    assert.equal(await webReady(), false);
    return { stopped, oldTree };
  };
  return deferStop ? { stop } : stop();
}

export async function observeJointVnc({
  attempt,
  pm2,
  journal,
  headed,
  stoppedVnc,
  maintenanceEndsAtMs,
  checkOutside,
}) {
  const binding = await journal.assertOwnership();
  const original = await journal.readFirstCutoverEffects();
  assert.equal(original.cloudMaintenanceEvents.length, 5);
  assert.equal(original.cloudMaintenanceScope[0].pmId, stoppedVnc.pm_id);
  const sources = () => readJointSources(attempt);
  await sources();
  // This acknowledgement follows the caller's actual native headed/config/tree proof.
  // It still does not establish the synthetic whole-site prerequisites as real.
  await journal.recordCloudMaintenanceEvent({
    ...original.cloudMaintenanceScope[1],
    attempt,
    inventoryDigest: binding.inventoryDigest,
    host: 'vultr',
    phase: 'cloud-restored',
  });
  const beforeCensus = await readFirstCutoverCloudRecoveryCensus();
  const input = {
    attempt,
    pmId: stoppedVnc.pm_id,
    stoppedConfigDigest: cutoverRegistrationConfigDigest(stoppedVnc.pm2_env),
    maintenanceEndsAtMs,
  };
  const restoreStartedAtMs = Date.now();
  try {
    await restoreFirstCutoverCloudVnc(input, {
      journal,
      assertRecoveryScope: async (actual) => {
        assert.deepEqual(actual, input);
        assert.ok(Date.now() < maintenanceEndsAtMs);
        await checkOutside();
        const managers = await readFirstCutoverCloudManagers();
        assert.equal(managers[0].pid, 0);
        assert.equal(
          cutoverRegistrationConfigDigest(managers[0].pm2_env),
          input.stoppedConfigDigest,
        );
        assert.equal(managers[1].pid, headed.pid);
        assert.equal(cutoverRegistrationConfigDigest(managers[1].pm2_env), headed.configDigest);
        assert.deepEqual(
          (await readFirstCutoverCloudRecoveryCensus()).processes,
          beforeCensus.processes,
        );
        await sources();
      },
    });
    await until(webReady);
    const observe = async () => {
      const sourceFacts = await sources();
      const recoveryInput = {
        attempt,
        name: 'holaday-vnc',
        pmId: stoppedVnc.pm_id,
        beforeCensus,
        restoreStartedAtMs,
        headedRecovery: headed,
        sources: sourceFacts,
      };
      const proof = await readFirstCutoverCloudRecovery(recoveryInput);
      const manager = (await readFirstCutoverCloudManagers())[0];
      const config = compareCutoverCloudVncRecoveryConfig({
        attempt,
        pmId: stoppedVnc.pm_id,
        pm2Version: '6.0.14',
        stoppedConfig: stoppedVnc.pm2_env,
        recoveredConfig: manager.pm2_env,
        launch: firstCutoverCloudVncRecoveryMaterial({ attempt }),
        expectedLaunchDigest: original.cloudMaintenanceScope[0].recoveryDigest,
        restoreStartedAtMs,
        observedAtMs: Date.now(),
      });
      assert.equal(proof.configDigest, config.recoveredConfigDigest);
      assert.equal(proof.restartCount, stoppedVnc.pm2_env.restart_time);
      await checkOutside();
      return proof;
    };
    const idle = await observe();
    assert.equal(idle.vnc.handlers.length, 0);
    const held = await openNativeRfb();
    const connected = await observe();
    assert.equal(connected.vnc.handlers.length, 1);
    assert.equal(connected.pid, idle.pid);
    const record = await journal.readFirstCutoverEffects();
    assert.equal(record.cloudMaintenanceEvents.length, 7);
    const began = performance.now();
    await sleep(35000);
    const stable = await observe();
    assert.ok(performance.now() - began >= 30000);
    assert.equal(held.failure, null);
    assert.equal(held.socket.readyState, WebSocket.OPEN);
    assert.deepEqual(stable.processes, connected.processes);
    assert.equal(stable.configDigest, connected.configDigest);
    assert.deepEqual(await journal.readFirstCutoverEffects(), record);
    await journal.recordCloudMaintenanceEvent({
      ...original.cloudMaintenanceScope[0],
      attempt,
      inventoryDigest: binding.inventoryDigest,
      host: 'vultr',
      phase: 'cloud-restored',
    });
    assert.equal((await journal.readFirstCutoverEffects()).cloudMaintenanceEvents.length, 8);
    console.log(
      JSON.stringify({
        marker: 'CLOUD_JOINT_NATIVE_RECOVERY_PASS',
        headedPid: headed.pid,
        vncPid: stable.pid,
        actualDefaultSources: true,
        handlersWithoutConnection: 0,
        handlersWithConnection: 1,
        workerIntervalStable: true,
        wholeSiteAcceptance: false,
        actualEightEventRecoveryAcknowledgements: true,
        candidateOpen: false,
      }),
    );
  } finally {
    for (const session of nativeSockets) {
      session.closing = true;
      session.socket.close();
    }
    await pm2('stop', String(stoppedVnc.pm_id)); // Disposable fixture cleanup only.
  }
}

async function openNativeRfb() {
  // Real binary WS/RFB negotiation, no screenshot or framebuffer requests.
  // Complete ServerInit so the handler stays connected past the Worker interval.
  const socket = new WebSocket('ws://127.0.0.1:6080', ['binary']);
  socket.binaryType = 'arraybuffer';
  const session = { socket, banner: null, failure: null, closing: false };
  nativeSockets.push(session);
  await new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    let receivedBytes = 0;
    let phase = 'version';
    let oldProtocol = false;
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
    });
    const timer = setTimeout(() => reject(Error('QA_NATIVE_RFB_TIMEOUT')), 5000);
    const fail = (event) => {
      // Intentional teardown occurs only after the held-session assertions.
      if (session.closing) {
        clearTimeout(timer);
        return;
      }
      if (session.failure === null)
        console.error(
          JSON.stringify({
            stage: 'QA_NATIVE_WS_FAILURE',
            phase: opened ? phase : 'http-upgrade',
            event: event?.type ?? 'protocol-error',
            ...qaError(event?.error ?? event),
            cause: qaError(event?.error?.cause ?? event?.cause),
            closeCode: event?.type === 'close' ? event.code : null,
            closeReason: String(event?.reason ?? '').slice(0, 1024),
          }),
        );
      session.failure = 'WS/RFB closed or invalid';
      clearTimeout(timer);
      reject(Error('QA_NATIVE_RFB_FAILED'));
    };
    socket.addEventListener('error', fail);
    socket.addEventListener('close', fail);
    socket.addEventListener('message', (event) => {
      try {
        receivedBytes += event.data.byteLength;
        assert.ok(receivedBytes <= 65536, 'bounded held RFB session');
        bytes = Buffer.concat([bytes, Buffer.from(event.data)]);
        assert.ok(bytes.length <= 65536);
        for (;;) {
          if (phase === 'version') {
            if (bytes.length < 12) return;
            session.banner = bytes.subarray(0, 12).toString('ascii');
            assert.match(session.banner, /^RFB 003\.00[38]\n$/);
            oldProtocol = session.banner === 'RFB 003.003\n';
            socket.send(bytes.subarray(0, 12));
            bytes = bytes.subarray(12);
            phase = 'security';
          } else if (phase === 'security') {
            if (oldProtocol) {
              if (bytes.length < 4) return;
              assert.equal(bytes.readUInt32BE(0), 1);
              bytes = bytes.subarray(4);
              socket.send(new Uint8Array([1]));
              phase = 'init';
            } else {
              if (!bytes.length || bytes.length < bytes[0] + 1) return;
              assert.ok(bytes[0] > 0 && bytes.subarray(1, bytes[0] + 1).includes(1));
              bytes = bytes.subarray(bytes[0] + 1);
              socket.send(new Uint8Array([1]));
              phase = 'security-result';
            }
          } else if (phase === 'security-result') {
            if (bytes.length < 4) return;
            assert.equal(bytes.readUInt32BE(0), 0);
            bytes = bytes.subarray(4);
            socket.send(new Uint8Array([1]));
            phase = 'init';
          } else if (phase === 'init') {
            if (bytes.length < 24) return;
            const length = bytes.readUInt32BE(20);
            assert.ok(length <= 4096);
            if (bytes.length < 24 + length) return;
            assert.ok(bytes.readUInt16BE(0) > 0 && bytes.readUInt16BE(2) > 0);
            bytes = bytes.subarray(24 + length);
            phase = 'held';
            clearTimeout(timer);
            resolve();
          } else {
            // Servers may send asynchronous bell/clipboard messages. No frame
            // requests are issued; discard bounded bytes without printing them.
            bytes = Buffer.alloc(0);
            return;
          }
        }
      } catch (error) {
        fail(error);
      }
    });
  });
  return session;
}

export async function readJointSources(attempt) {
  const managers = await readFirstCutoverCloudManagers();
  return readFirstCutoverCloudRecoverySources({
    attempt,
    configs: managers.map((r) => ({ name: r.name, pmId: r.pm_id, config: r.pm2_env })),
  });
}
