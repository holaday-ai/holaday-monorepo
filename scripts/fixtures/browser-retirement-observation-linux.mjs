// Disposable root Linux container only. Physical startup files + owned journal;
// host/process/PM2 snapshots (including the distinct second host) are synthetic.
// No SSH, PM2 commands, payment actions, credentials, or whole-host proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import {
  createFirstCutoverRetirementObserver,
  readReviewedFirstCutoverLegacySource,
} from '../browser-first-cutover-host.mjs';
import { firstCutoverSourceBindings } from '../browser-first-cutover-inventory.mjs';
import { removeSavedStartupEntries } from '../browser-first-cutover-startup.mjs';
import { acquireReleaseJournal } from '../browser-maintenance-journal.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = (value) => sha(JSON.stringify(value));
const paths = ['/root/.pm2/dump.pm2', '/root/.pm2/dump.pm2.bak'];
const directory = '/var/lib/holaday-deploy/maintenance';
const inventoryDigest = 'a'.repeat(64);
const privateMarker = 'qa-private-environment-never-output';
const retired = JSON.stringify({ name: 'holaday-files-cron', env: { QA_ONLY: privateMarker } });
// A retained numeric literal that JSON.parse/stringify cannot round-trip.
const retained = `{"name":"qa-unrelated","env":{"QA_ONLY":"${privateMarker}"},"n":9007199254740993}`;
const original = `[${retired},${retained}]\n`;
const expected = `[${retained}]\n`;
const statKeys = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
const metadata = (s) => Object.fromEntries(statKeys.map((k) => [k, s[k]]));

async function readStartup(path) {
  let link;
  try {
    link = await fs.lstat(path);
  } catch (e) {
    if (e.code === 'ENOENT') return { path, present: false };
    throw e;
  }
  assert.ok(link.isFile() && !link.isSymbolicLink());
  const resolved = await fs.realpath(path);
  const bytes = await fs.readFile(path);
  const stat = await fs.stat(path);
  assert.deepEqual(metadata(link), metadata(stat));
  return {
    path,
    present: true,
    resolved,
    content: bytes.toString('utf8'),
    digest: sha(bytes),
    stat: metadata(stat),
    link: metadata(link),
  };
}

function syntheticHost(host) {
  const gateway = host === 'aliyun';
  const offset = gateway ? 100 : 0;
  const proc = (id, parent, cwd) => ({
    pid: id + offset,
    ppid: parent === 1 ? 1 : parent + offset,
    start: String((id + offset) * 100),
    uids: [0, 0, 0, 0],
    exe: gateway ? '/usr/bin/node' : '/opt/node22/bin/node',
    cwd,
    argvDigest: hash([host, id]),
    cgroup: '0::/user.slice',
  });
  const processes = [proc(10, 1, '/root'), proc(30, 10, '/root'), proc(99, 1, '/root')];
  const managers = [
    {
      pmId: 2,
      name: 'qa-unrelated',
      pid: 30 + offset,
      status: 'online',
      watch: false,
      configDigest: hash([host, 'unrelated']),
    },
  ];
  if (!gateway)
    managers.push({
      pmId: 3,
      name: 'holaday-files-cron',
      pid: 0,
      status: 'stopped',
      watch: false,
      cronRestart: '0 * * * *',
      configDigest: hash([host, 'cron']),
    });
  return {
    observedAtMs: Date.now(),
    bootId: gateway
      ? '22222222-2222-4222-8222-222222222222'
      : '11111111-1111-4111-8111-111111111111',
    processes,
    managers,
    observer: structuredClone(processes.at(-1)),
    pm2Runtime: {
      pid: 10 + offset,
      version: '6.0.14',
      killSignal: 'SIGINT',
      killTimeoutMs: 1600,
      sourceDigest: hash([host, 'synthetic-pm2-runtime']),
    },
    startup: {
      files: [
        {
          path: paths[0],
          present: true,
          content: '[{"name":"qa-second-host"}]\n',
          digest: sha('[{"name":"qa-second-host"}]\n'),
        },
        { path: paths[1], present: false },
      ],
      directories: [],
      pm2Unit: `ActiveState=active\nDescription=synthetic-${host}`,
    },
    nginxFiles: [],
    systemd: 'pm2-root.service loaded active running PM2\n',
    unitFiles: 'pm2-root.service enabled\n',
    timers: 'n/a n/a system.timer system.service\n',
    cron: '',
    rootCrontabPresent: false,
    listeners: '',
  };
}

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid?.(), 0);
  await fs.access('/.dockerenv');
  // Refuse pre-existing saved state; never erase a dump to make this fixture pass.
  for (const path of paths) await assert.rejects(fs.lstat(path), { code: 'ENOENT' });
  await fs.mkdir('/root/.pm2', { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(paths[0], original, { flag: 'wx', mode: 0o600 });
  await fs.chown(paths[0], 0, 998);
  const hosts = ['aliyun', 'vultr'].map((host) => ({
    host,
    sourceCandidate: host === 'vultr' ? 'c'.repeat(40) : null,
    snapshot: syntheticHost(host),
  }));
  let pairReads = 0;
  const readPair = async () => {
    pairReads++;
    const pair = {
      observedAtMs: Date.now(),
      sourceDigest: hash('synthetic-collector'),
      sourceCandidate: 'c'.repeat(40),
      hosts: structuredClone(hosts),
    };
    for (const h of pair.hosts) h.snapshot.observedAtMs = pair.observedAtMs;
    // Always collect genuine bytes, realpath, stat and lstat anew, never receipts.
    pair.hosts.find((h) => h.host === 'vultr').snapshot.startup.files = await Promise.all(
      paths.map(readStartup),
    );
    return pair;
  };
  const reviewedPair = await readPair();
  const reviews = Object.fromEntries(
    reviewedPair.hosts.map(({ host, snapshot: s }) => [
      host,
      {
        bootId: s.bootId,
        ports: host === 'aliyun' ? [4010, 4011] : [4001, 4002],
        review: {
          processes: [
            {
              pid: s.processes[1].pid,
              identityDigest: hash(s.processes[1]),
              disposition: 'preserve',
              reason: 'synthetic unrelated process',
            },
          ],
          registrations: s.managers.map((m) => ({
            pmId: m.pmId,
            configDigest: m.configDigest,
            disposition: m.name === 'holaday-files-cron' ? 'retire' : 'preserve',
            reason: 'synthetic registration review',
          })),
          sources: firstCutoverSourceBindings(s).map((source) => ({
            ...source,
            reason:
              host === 'vultr'
                ? 'test-owned original disk bytes and metadata'
                : 'distinct synthetic host',
          })),
        },
      },
    ]),
  );
  const proof = await readReviewedFirstCutoverLegacySource(
    { inventoryDigest, reviews },
    { readPair, now: Date.now },
  );
  const manifest = {
    replaysNumberedSql: true,
    runnerSha256: '1'.repeat(64),
    migrations: [{ name: '0042_core.sql', sha256: '2'.repeat(64) }],
  };
  const journal = await acquireReleaseJournal(directory, {
    kind: 'first-cutover',
    candidate: 'd'.repeat(40),
    configDigest: 'e'.repeat(64),
    migrationDigest: hash(manifest),
    inventoryDigest,
    legacyDigest: proof.legacyDigest,
  });
  try {
    const binding = await journal.assertOwnership();
    const observer = await createFirstCutoverRetirementObserver(
      { reviews, binding, legacyDigest: proof.legacyDigest },
      { journal, readPair, readFenceReceipts: async () => [], now: Date.now },
    );
    await journal.bindManifest(manifest);
    for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
      await journal.persist(phase, { candidate: binding.candidate });
    const startupBinding = { attempt: binding.attempt, inventoryDigest };
    const receipt = await removeSavedStartupEntries(
      {
        binding: startupBinding,
        maintenanceEndsAtMs: Date.now() + 60000,
        files: [
          {
            path: paths[0],
            digest: sha(original),
            remove: [{ name: 'holaday-files-cron', entryDigest: sha(retired) }],
          },
          { path: paths[1], digest: null, remove: [] },
        ],
      },
      {
        now: Date.now,
        assertOwnership: async () => {
          const owned = await journal.assertOwnership();
          return { attempt: owned.attempt, inventoryDigest: owned.inventoryDigest };
        },
        persist: (event) => journal.recordStartupEvent({ ...event, host: 'vultr' }),
      },
    );
    assert.equal(await fs.readFile(paths[0], 'utf8'), expected);
    await assert.rejects(fs.lstat(paths[1]), { code: 'ENOENT' });
    const after = await readStartup(paths[0]);
    const before = reviewedPair.hosts.find((h) => h.host === 'vultr').snapshot.startup.files[0];
    assert.equal(before.stat.gid, 998);
    assert.notEqual(after.stat.ino, before.stat.ino);
    assert.equal(after.stat.uid, 0);
    assert.equal(after.stat.gid, 998);
    assert.equal(after.stat.mode & 0o777, 0o600);
    assert.equal(after.stat.nlink, 1);
    assert.equal(after.stat.size, Buffer.byteLength(expected));
    assert.equal(after.digest, receipt.files[0].afterDigest);
    const backup = `${directory}/startup-${binding.attempt}/dump.pm2.original`;
    assert.equal(await fs.readFile(backup, 'utf8'), original);
    assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(backup)).uid, 0);
    const record = JSON.parse(await fs.readFile(journal.path, 'utf8'));
    assert.deepEqual(
      record.startupEvents.map((e) => e.phase),
      ['startup-backup-intent', 'startup-backed-up', 'startup-file-intent', 'startup-file-written'],
    );
    assert.ok(
      record.startupEvents.every(
        (e) =>
          e.host === 'vultr' &&
          e.attempt === binding.attempt &&
          e.inventoryDigest === inventoryDigest,
      ),
    );
    assert.deepEqual(record.startupEvents[1].files, receipt.files);
    const observed = await observer.read();
    assert.deepEqual(observed.unknownLaunchers, []);
    assert.equal(observed.hosts.find((h) => h.host === 'vultr').registered.managers.length, 1);
    assert.ok(!JSON.stringify({ proof, observed, record, receipt }).includes(privateMarker));
    // Actual disk tampering, not a changed snapshot or invented event.
    await fs.writeFile(paths[0], '[]\n');
    await assert.rejects(observer.read(), /CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN/);
    assert.equal(pairReads, 5); // review, legacy proof, observer baseline, postread, tamper.
    console.log(
      'PASS bounded Linux QA: real startup removal, four owned disk-journal events, fresh postread accepted, disk tamper rejected; host/process/PM2 synthetic',
    );
  } finally {
    await journal.close();
  }
}

// Do not print assertion payloads: snapshots contain test-owned raw environments.
await main().catch(() => {
  console.error('FAIL bounded Linux retirement observation QA (details suppressed)');
  process.exitCode = 1;
});
