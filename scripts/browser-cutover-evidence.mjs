import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';
const publicationSystem = {
  ...fs,
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
};
/** Integrity reader, not a provider verifier: receipts must be produced by the
 * separately authorized provider rehearsal, never a CLI success/approval flag. */
export async function readCutoverRehearsalArtifacts(
  { binding, merchants },
  io = publicationSystem,
) {
  try {
    checkBinding(binding);
    if (io.platform !== 'linux' || io.uid !== 0 || !Array.isArray(merchants))
      throw new Error('input');
    const directory = '/var/lib/holaday-deploy/evidence-private';
    const folder = await io.lstat(directory);
    if (
      !folder.isDirectory() ||
      folder.uid !== 0 ||
      (folder.mode & 0o7777) !== 0o700 ||
      (await io.realpath(directory)) !== directory
    )
      throw new Error('directory');
    const read = async (name) => {
      const path = `${directory}/${name}`;
      const handle = await io.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (
          !before.isFile() ||
          before.uid !== 0 ||
          (before.mode & 0o7777) !== 0o600 ||
          before.nlink !== 1 ||
          before.size < 1 ||
          before.size > 2 * 1024 * 1024
        )
          throw new Error('file');
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const current = await io.lstat(path);
        const currentFolder = await io.lstat(directory);
        if (
          bytes.length !== before.size ||
          !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
          before.ino !== after.ino ||
          before.dev !== after.dev ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          after.ino !== current.ino ||
          after.dev !== current.dev ||
          after.mode !== current.mode ||
          current.uid !== 0 ||
          current.nlink !== 1 ||
          folder.ino !== currentFolder.ino ||
          folder.dev !== currentFolder.dev ||
          currentFolder.uid !== 0 ||
          (currentFolder.mode & 0o7777) !== 0o700 ||
          (await io.realpath(directory)) !== directory
        )
          throw new Error('changed');
        return bytes;
      } finally {
        await handle.close();
      }
    };
    const record = JSON.parse(
      (await read(`rehearsal-${binding.configDigest}.json`)).toString('utf8'),
    );
    if (
      record.schemaVersion !== 1 ||
      record.configDigest !== binding.configDigest ||
      record.inventoryDigest !== binding.inventoryDigest ||
      record.candidate !== binding.candidate ||
      !Number.isSafeInteger(record.observedAtMs) ||
      record.observedAtMs < 0 ||
      record.observedAtMs > io.now() ||
      !Number.isSafeInteger(record.recoveryUntilMs) ||
      record.recoveryUntilMs <= io.now() ||
      !['retry-proven', 'query-and-existing-settlement-proven'].includes(record.recovery) ||
      !Array.isArray(record.artifacts) ||
      record.artifacts.length !== merchants.length
    )
      throw new Error('record');
    const seen = new Set();
    for (const artifact of record.artifacts) {
      const key = JSON.stringify([
        artifact.provider,
        artifact.environment,
        artifact.merchantDigest,
      ]);
      const merchant = merchants.find(
        (m) =>
          m.provider === artifact.provider &&
          m.environment === artifact.environment &&
          m.merchantDigest === artifact.merchantDigest,
      );
      if (
        seen.has(key) ||
        !merchant ||
        !hash(artifact.codeDigest) ||
        artifact.codeDigest !== merchant.codeDigest
      )
        throw new Error('binding');
      seen.add(key);
      for (const field of [
        'transcriptDigest',
        ...(record.recovery === 'retry-proven'
          ? ['retryDigest']
          : ['queryDigest', 'settlementDigest']),
      ]) {
        const expected = artifact[field];
        if (!hash(expected)) throw new Error('digest');
        const bytes = await read(`${expected}.json`);
        if (createHash('sha256').update(bytes).digest('hex') !== expected)
          throw new Error('digest mismatch');
      }
    }
    const { schemaVersion: _schemaVersion, ...result } = record;
    return result;
  } catch {
    fail('MAINTENANCE_REHEARSAL_UNPROVEN');
  }
}

/** Called only by the collector's host adapter, under the shared release journal lock.
 * Fixed pre-provisioned directories; raw evidence is never application-readable. */
export async function publishCutoverEvidence(evidence, options, io = publicationSystem) {
  const handles = [];
  try {
    const report = evidence?.report;
    const binding = Object.fromEntries(bindingKeys.map((k) => [k, report?.[k]]));
    checkBinding(binding);
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(options?.applicationGid) ||
      options.applicationGid <= 0 ||
      !['prepare', 'preopen'].includes(report.stage) ||
      !fresh(report.observedAtMs, io.now()) ||
      !evidence.raw
    )
      throw new Error('input');
    const assertJournal = async () => {
      const current = await options.assertJournalOwnership();
      if (!bindingKeys.every((key) => current?.[key] === binding[key])) throw new Error('journal');
    };
    await assertJournal();
    const folders = [
      { path: '/var/lib/holaday-deploy/evidence-private', mode: 0o700 },
      { path: '/var/lib/holaday-deploy/evidence', mode: 0o750 },
    ];
    for (const folder of folders) {
      const before = await io.lstat(folder.path);
      if (
        !before.isDirectory() ||
        before.uid !== 0 ||
        (before.mode & 0o7777) !== folder.mode ||
        (folder.mode === 0o750 && before.gid !== options.applicationGid) ||
        (await io.realpath(folder.path)) !== folder.path
      )
        throw new Error('directory');
      folder.stat = before;
      folder.handle = await io.open(
        folder.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
      );
      handles.push(folder.handle);
      const opened = await folder.handle.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev)
        throw new Error('directory changed');
    }
    const assertFolders = async () => {
      for (const folder of folders) {
        const current = await io.lstat(folder.path);
        if (
          current.ino !== folder.stat.ino ||
          current.dev !== folder.stat.dev ||
          current.uid !== 0 ||
          current.gid !== folder.stat.gid ||
          (current.mode & 0o7777) !== folder.mode ||
          (await io.realpath(folder.path)) !== folder.path
        )
          throw new Error('directory changed');
      }
    };
    const atomic = async (folder, name, bytes, mode) => {
      await assertFolders();
      const destination = `${folder.path}/${name}`;
      try {
        const existing = await io.lstat(destination);
        if (
          !existing.isFile() ||
          existing.uid !== 0 ||
          existing.nlink !== 1 ||
          (existing.mode & 0o7777) !== mode ||
          (mode === 0o640 && existing.gid !== options.applicationGid)
        )
          throw new Error('existing');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const temporary = `${folder.path}/${report.attempt}.${randomUUID()}.tmp`;
      const file = await io.open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const created = await file.stat();
        if (
          !created.isFile() ||
          created.uid !== 0 ||
          created.nlink !== 1 ||
          (created.mode & 0o7777) !== 0o600
        )
          throw new Error('file');
        await file.writeFile(bytes);
        if (mode === 0o640) await file.chown(0, options.applicationGid);
        await file.chmod(mode);
        await file.sync();
      } finally {
        await file.close();
      }
      await assertFolders();
      await assertJournal();
      await io.rename(temporary, destination);
      await folder.handle.sync();
    };
    const rawBytes = Buffer.from(`${JSON.stringify(evidence.raw)}\n`);
    const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
    if (rawBytes.length > 32 * 1024 * 1024 || reportBytes.length > 256 * 1024)
      throw new Error('size');
    await atomic(
      folders[0],
      `${report.attempt}.${report.stage}.${randomUUID()}.json`,
      rawBytes,
      0o600,
    );
    await atomic(folders[1], `${report.attempt}.json`, reportBytes, 0o640);
    const reportDigest = createHash('sha256').update(reportBytes).digest('hex');
    const index = {
      ...binding,
      stage: report.stage,
      ...(report.identity ? { identity: report.identity } : {}),
      reportDigest,
    };
    if (!fresh(report.observedAtMs, io.now())) throw new Error('expired');
    await atomic(folders[1], 'active.json', Buffer.from(`${JSON.stringify(index)}\n`), 0o640);
    return { reportDigest, rawDigest: createHash('sha256').update(rawBytes).digest('hex') };
  } catch {
    fail('MAINTENANCE_EVIDENCE_PUBLICATION_UNPROVEN');
  } finally {
    for (const handle of handles.reverse()) await handle.close();
  }
}

const execFileAsync = promisify(execFile);
const hostSystem = {
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
  readFile,
  readlink,
  readdir,
  exec: async (command, args) => {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PM2_HOME: '/root/.pm2', LC_ALL: 'C' },
    });
    return result.stdout + (command === 'nginx' ? result.stderr : '');
  },
};

/** Read facts only; callers must classify every process/startup/route before acceptance.
 * No environment-variable absence or missing PM2 row establishes non-writer status. */
export async function readCutoverHostSnapshot(io = hostSystem) {
  if (io.platform !== 'linux' || io.uid !== 0) fail('MAINTENANCE_HOST_OBSERVATION_UNPROVEN');
  try {
    const observedAtMs = io.now();
    const bootId = String(await io.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    if (!/^[a-f0-9-]{36}$/.test(bootId)) throw new Error('boot identity');
    const processes = [];
    const start = (raw, pid) => {
      const value = String(raw);
      if (!value.startsWith(`${pid} (`)) throw new Error('pid');
      const stamp = value
        .slice(value.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/)[19];
      if (!/^\d+$/.test(stamp ?? '')) throw new Error('start');
      return stamp;
    };
    for (const name of (await io.readdir('/proc')).filter((p) => /^[1-9]\d*$/.test(p)).sort()) {
      const pid = Number(name);
      const root = `/proc/${pid}`;
      try {
        const cmdline = String(await io.readFile(`${root}/cmdline`, 'utf8'));
        if (!cmdline) continue;
        const status = String(await io.readFile(`${root}/status`, 'utf8'));
        const match = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
        if (!match) throw new Error('uid');
        const uids = match.slice(1).map(Number);
        // Capture every service UID process, every Holaday argv and all Node runtimes.
        // Unknown Node/worker runtimes remain visible to the approval classifier.
        if (!uids.includes(998) && !/holaday|(?:^|\/)node(?:\0|$)/i.test(cmdline)) continue;
        const before = start(await io.readFile(`${root}/stat`, 'utf8'), pid);
        const cwd = await io.readlink(`${root}/cwd`);
        const exe = await io.readlink(`${root}/exe`);
        const cgroup = String(await io.readFile(`${root}/cgroup`, 'utf8'));
        const after = start(await io.readFile(`${root}/stat`, 'utf8'), pid);
        const ppid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
        if (!Number.isSafeInteger(ppid) || ppid < 0) throw new Error('parent');
        const afterStatus = String(await io.readFile(`${root}/status`, 'utf8'));
        const afterUids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m
          .exec(afterStatus)
          ?.slice(1)
          .map(Number);
        if (
          before !== after ||
          cmdline !== String(await io.readFile(`${root}/cmdline`, 'utf8')) ||
          !same(uids, afterUids) ||
          ppid !== Number(/^PPid:\s+(\d+)/m.exec(afterStatus)?.[1]) ||
          cwd !== (await io.readlink(`${root}/cwd`)) ||
          exe !== (await io.readlink(`${root}/exe`))
        )
          throw new Error('changed');
        processes.push({
          pid,
          start: before,
          ppid,
          uids,
          cwd,
          exe,
          argvDigest: digest(cmdline),
          cgroup,
        });
      } catch (error) {
        // Process churn is not a stable, exhaustive observation; recollect once externally.
        throw new Error('MAINTENANCE_HOST_OBSERVATION_UNPROVEN');
      }
    }
    const rows = JSON.parse(await io.exec('pm2', ['jlist']));
    if (!Array.isArray(rows)) throw new Error('manager');
    const managers = rows.map((row) => ({
      pid: row.pid,
      name: row.name,
      pmId: row.pm_id,
      cwd: row.pm2_env?.pm_cwd,
      execPath: row.pm2_env?.pm_exec_path,
      interpreter: row.pm2_env?.exec_interpreter,
      argsDigest: digest(row.pm2_env?.args ?? []),
      status: row.pm2_env?.status,
      autorestart: row.pm2_env?.autorestart,
      watch: row.pm2_env?.watch,
      maxMemoryRestart: row.pm2_env?.max_memory_restart,
      cronRestart: row.pm2_env?.cron_restart,
    }));
    const listeners = await io.exec('ss', ['-H', '-ltnp']);
    const nginx = await io.exec('nginx', ['-T']);
    const systemd = await io.exec('systemctl', [
      'list-units',
      '--type=service',
      '--all',
      '--no-pager',
      '--no-legend',
    ]);
    const unitFiles = await io.exec('systemctl', [
      'list-unit-files',
      '--type=service',
      '--no-pager',
      '--no-legend',
    ]);
    const timers = await io.exec('systemctl', [
      'list-timers',
      '--all',
      '--no-pager',
      '--no-legend',
    ]);
    const cron = await io.exec('crontab', ['-l']);
    if (
      String(await io.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() !== bootId ||
      !fresh(observedAtMs, io.now())
    )
      throw new Error('changed');
    return {
      observedAtMs,
      bootId,
      processes,
      managers,
      listeners,
      nginx,
      systemd,
      unitFiles,
      timers,
      cron,
    };
  } catch {
    fail('MAINTENANCE_HOST_OBSERVATION_UNPROVEN');
  }
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fresh = (stamp, now) =>
  Number.isSafeInteger(stamp) && stamp >= 0 && stamp <= now && now - stamp <= 60_000;
const fail = (code = 'MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN') => {
  throw new Error(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
function checkBinding(value) {
  if (
    !value ||
    Object.keys(value).length !== bindingKeys.length ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.attempt ?? '',
    ) ||
    !/^[a-f0-9]{40}$/.test(value.candidate ?? '') ||
    !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) => hash(value[k]))
  )
    fail();
}
const orderKey = (row) =>
  JSON.stringify([row.provider, row.environment, row.merchantDigest, row.orderRef]);
function checkScope(scope, now) {
  if (
    !scope ||
    !fresh(scope.observedAtMs, now) ||
    !Array.isArray(scope.orders) ||
    scope.orders.length > 10_000 ||
    !Array.isArray(scope.unsettled) ||
    scope.unsettled.length
  )
    fail();
  const keys = new Set();
  for (const row of scope.orders) {
    if (
      !['alipay', 'wechat', 'paypal'].includes(row.provider) ||
      !['sandbox', 'production'].includes(row.environment) ||
      !hash(row.merchantDigest) ||
      !hash(row.orderRef) ||
      !hash(row.fieldsDigest) ||
      keys.has(orderKey(row))
    )
      fail();
    keys.add(orderKey(row));
  }
}

/** All IO is a named fact reader owned by the root host adapter. No success JSON CLI. */
export async function collectCutoverEvidence(input, io) {
  const { binding, stage, identity, window } = input ?? {};
  checkBinding(binding);
  if (
    !['prepare', 'preopen'].includes(stage) ||
    (stage === 'prepare'
      ? identity !== undefined
      : identity?.candidate !== binding.candidate ||
        !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '')) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(window?.operatorRef ?? '') ||
    !Number.isSafeInteger(window?.maintenanceEndsAtMs) ||
    !Number.isSafeInteger(window?.reconcileByMs) ||
    window.reconcileByMs < window.maintenanceEndsAtMs
  )
    fail();
  const journal = await io.assertJournalOwnership();
  if (!bindingKeys.every((key) => journal?.[key] === binding[key]))
    fail('MAINTENANCE_JOURNAL_UNPROVEN');
  const host = structuredClone(await io.readHostInventory());
  const before = structuredClone(await io.readDatabaseScope());
  checkScope(before, io.now());
  const observations = structuredClone(await io.queryOrders(before));
  const after = structuredClone(await io.readDatabaseScope());
  checkScope(after, io.now());
  if (!same(before.orders, after.orders) || !same(before.unsettled, after.unsettled))
    fail('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
  const rehearsal = structuredClone(await io.readRehearsalArtifacts());
  const fence = structuredClone(await io.readFenceState());
  const lastHost = structuredClone(await io.readHostInventory());
  const now = io.now();
  for (const snapshot of [host, lastHost]) {
    if (
      !fresh(snapshot?.observedAtMs, now) ||
      digest(snapshot.inventory) !== binding.inventoryDigest ||
      !['unknownWriters', 'externalWork', 'producersRunning'].every(
        (k) => Array.isArray(snapshot[k]) && snapshot[k].length === 0,
      )
    )
      fail();
  }
  if (
    !fresh(before.observedAtMs, now) ||
    !fresh(after.observedAtMs, now) ||
    !fresh(fence?.observedAtMs, now) ||
    fence.inventoryDigest !== binding.inventoryDigest ||
    fence.stage !== (stage === 'prepare' ? 'orders' : 'all-writers') ||
    !Array.isArray(fence.uncovered) ||
    fence.uncovered.length ||
    (stage === 'preopen' &&
      !['liveLegacy', 'regeneratedLegacy'].every(
        (k) => Array.isArray(fence[k]) && fence[k].length === 0,
      )) ||
    now >= window.maintenanceEndsAtMs
  )
    fail();
  const merchants = host.inventory.merchants;
  if (
    !Array.isArray(merchants) ||
    !Array.isArray(host.inventory.configurationDigests) ||
    !host.inventory.configurationDigests.length ||
    !host.inventory.configurationDigests.every(hash) ||
    !rehearsal ||
    rehearsal.candidate !== binding.candidate ||
    rehearsal.configDigest !== binding.configDigest ||
    rehearsal.inventoryDigest !== binding.inventoryDigest ||
    !Number.isSafeInteger(rehearsal.observedAtMs) ||
    rehearsal.observedAtMs < 0 ||
    rehearsal.observedAtMs > now ||
    !['retry-proven', 'query-and-existing-settlement-proven'].includes(rehearsal.recovery) ||
    !Number.isSafeInteger(rehearsal.recoveryUntilMs) ||
    rehearsal.recoveryUntilMs < window.reconcileByMs ||
    !Array.isArray(rehearsal.artifacts) ||
    rehearsal.artifacts.length !== merchants.length
  )
    fail();
  const merchantKey = (row) => JSON.stringify([row.provider, row.environment, row.merchantDigest]);
  const merchantKeys = new Set(merchants.map(merchantKey));
  const artifactKeys = new Set(rehearsal.artifacts.map(merchantKey));
  if (merchantKeys.size !== merchants.length || artifactKeys.size !== merchants.length) fail();
  for (const artifact of rehearsal.artifacts) {
    const merchant = merchants.find((row) => merchantKey(row) === merchantKey(artifact));
    if (
      !merchantKeys.has(merchantKey(artifact)) ||
      !hash(artifact.codeDigest) ||
      artifact.codeDigest !== merchant?.codeDigest ||
      !hash(artifact.transcriptDigest) ||
      (rehearsal.recovery === 'query-and-existing-settlement-proven'
        ? !hash(artifact.queryDigest) || !hash(artifact.settlementDigest)
        : !hash(artifact.retryDigest))
    )
      fail();
  }
  if (!Array.isArray(observations) || observations.length !== before.orders.length)
    fail('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
  const map = new Map();
  for (const row of observations) {
    if (
      !fresh(row.observedAtMs, now) ||
      !hash(row.rawDigest) ||
      map.has(orderKey(row)) ||
      !['settled', 'closed', 'unpaid-valid'].includes(row.state)
    )
      fail();
    map.set(orderKey(row), row);
  }
  for (const row of before.orders)
    if (!map.has(orderKey(row)) || !merchantKeys.has(merchantKey(row)))
      fail('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
  const scopeDigest = digest(before.orders);
  const rehearsalDigest = digest(rehearsal);
  const followup = observations
    .filter((row) => row.state === 'unpaid-valid')
    .map((row) => row.orderRef)
    .sort();
  const report = {
    schemaVersion: 1,
    ...binding,
    stage,
    ...(identity ? { identity } : {}),
    observedAtMs: now,
    ...window,
    sources: [
      {
        kind: 'host',
        digest: binding.inventoryDigest,
        targetDigest: binding.inventoryDigest,
        observedAtMs: Math.min(host.observedAtMs, lastHost.observedAtMs, fence.observedAtMs),
      },
      {
        kind: 'database',
        digest: scopeDigest,
        targetDigest: binding.configDigest,
        observedAtMs: before.observedAtMs,
      },
      {
        kind: 'provider-query',
        digest: scopeDigest,
        targetDigest: binding.configDigest,
        observedAtMs: observations.length
          ? Math.min(...observations.map((row) => row.observedAtMs))
          : after.observedAtMs,
      },
      {
        kind: 'provider-rehearsal',
        digest: rehearsalDigest,
        targetDigest: binding.configDigest,
        observedAtMs: rehearsal.observedAtMs,
      },
    ],
    host: {
      inventoryDigest: binding.inventoryDigest,
      unknownWriters: 0,
      unsettledWork: 0,
      phase: stage === 'prepare' ? 'prepared' : 'fenced-stopped',
    },
    payments: {
      scopeDigest,
      queriedScopeDigest: scopeDigest,
      unresolved: 0,
      validUnpaid: followup.length,
      followupDigest: digest(followup),
      recovery: rehearsal.recovery,
      recoveryUntilMs: rehearsal.recoveryUntilMs,
      rehearsalDigest,
    },
  };
  const finalJournal = await io.assertJournalOwnership();
  if (!bindingKeys.every((key) => finalJournal?.[key] === binding[key]))
    fail('MAINTENANCE_JOURNAL_UNPROVEN');
  await io.publishPrivate({
    report,
    raw: { host, lastHost, before, after, observations, rehearsal, fence, followup },
  });
  return report;
}
/** mysql2 connection must be dedicated; queries never enter a write transaction. */
export async function readCutoverDatabaseScope(
  db,
  { windowStartMs, now = Date.now, resolveMerchant } = {},
) {
  if (!Number.isSafeInteger(windowStartMs) || windowStartMs < 0 || windowStartMs > now())
    fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
  let transaction = false;
  try {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    transaction = true;
    const observedAtMs = now();
    const orders = [];
    const unsettled = [];
    const since = new Date(windowStartMs);
    for (const table of ['payments', 'partner_recharge_orders']) {
      const amountColumn = table === 'payments' ? 'amount_cents' : 'amount_cny_cents';
      const currencyColumn = table === 'payments' ? 'currency' : "'CNY'";
      const where =
        "(status NOT IN ('completed','failed','refunded','cancelled') OR created_at >= ? OR updated_at >= ?)";
      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`, [
        since,
        since,
      ]);
      const count = Number(countRows?.[0]?.total);
      if (
        countRows?.length !== 1 ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count >= 10_000 ||
        orders.length + count >= 10_000
      )
        fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
      let cursor = 0;
      let found = 0;
      for (let page = 0; page < 100; page++) {
        const [rows] = await db.query(
          `SELECT id, external_id, provider, provider_order_id, provider_capture_id, ${amountColumn} AS amount_cents, ${currencyColumn} AS currency, status, metadata, created_at, updated_at FROM ${table} WHERE ${where} AND id > ? ORDER BY id LIMIT 100`,
          [since, since, cursor],
        );
        if (!Array.isArray(rows) || rows.length > 100) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
        for (const row of rows) {
          const id = Number(row.id);
          if (
            !Number.isSafeInteger(id) ||
            id <= cursor ||
            !row.external_id ||
            !row.provider_order_id ||
            !['alipay', 'wechat', 'paypal'].includes(row.provider) ||
            !Number.isSafeInteger(Number(row.amount_cents)) ||
            Number(row.amount_cents) <= 0 ||
            !['USD', 'CNY'].includes(row.currency) ||
            typeof resolveMerchant !== 'function'
          )
            fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
          const merchant = resolveMerchant(row.provider, row, table);
          if (
            !hash(merchant?.merchantDigest) ||
            !['sandbox', 'production'].includes(merchant?.environment)
          )
            fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
          const orderRef = digest([merchant.merchantDigest, row.provider_order_id]);
          orders.push({ ...row, table, orderRef, ...merchant, fieldsDigest: digest(row) });
          cursor = id;
          found++;
        }
        if (rows.length < 100) break;
        if (page === 99) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
      }
      if (found !== count) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
    }
    const work = [
      [
        'tasks',
        "status NOT IN ('completed','partial_success','failed','cancelled','paused','awaiting_user')",
      ],
      ['scheduled_tasks', "status = 'running'"],
      ['planned_task_runs', "status IN ('pending','running')"],
      ['batch_tasks', "status IN ('pending','running')"],
    ];
    for (const [table, where] of work) {
      const [rows] = await db.query(
        `SELECT id, status FROM ${table} WHERE ${where} ORDER BY id LIMIT 100`,
      );
      if (!Array.isArray(rows) || rows.length >= 100) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
      unsettled.push(...rows.map((row) => ({ table, ...row })));
    }
    return { observedAtMs, orders, unsettled };
  } catch {
    fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
  } finally {
    if (transaction) await db.query('ROLLBACK');
  }
}
