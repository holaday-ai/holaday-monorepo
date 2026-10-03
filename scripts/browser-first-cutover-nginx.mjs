import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const fail = () => {
  throw new Error('CUTOVER_NGINX_UNPROVEN');
};
const executable = '/usr/sbin/nginx';
const pidValue = (value) => /^[1-9][0-9]{0,9}$/.test(String(value)) && Number(value) <= 2147483647;
const identity = (p) => `${p.pid}:${p.start}`;
const system = {
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
  sleep,
  exec: (file, args, options) =>
    new Promise((resolve, reject) => {
      // Reload is a one-shot effect: never timeout-kill and replay an uncertain signal.
      execFile(
        file,
        args,
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    }),
  readRuntime: () => readCutoverNginxRuntime(),
};
async function readPidFile() {
  const path = '/run/nginx.pid';
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.uid !== 0 ||
      before.nlink !== 1 ||
      before.mode & 0o7022 ||
      before.size < 1 ||
      before.size > 64
    )
      fail();
    const bytes = Buffer.alloc(65);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    const current = await fs.lstat(path);
    if (
      bytesRead !== before.size ||
      !['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(
        (k) => before[k] === after[k] && before[k] === current[k],
      )
    )
      fail();
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Local Linux process observation only; never signals a PID or trusts a CLI's
 * claimed worker list. A vanished child is retired; unknown live children refuse.
 */
export async function readCutoverNginxRuntime(overrides = {}) {
  const io = { ...fs, platform: process.platform, readPidFile, ...overrides };
  try {
    if (io.platform !== 'linux') fail();
    const parseStat = (bytes) => {
      const match = String(bytes).match(/^([1-9][0-9]*) \(.*\) ([A-Z]) ([\s\S]+)$/);
      const rest = match?.[3].trim().split(/\s+/);
      if (!match || !pidValue(match[1]) || !rest || rest.length < 19 || !/^[0-9]+$/.test(rest[18]))
        fail();
      return { pid: Number(match[1]), state: match[2], parent: Number(rest[0]), start: rest[18] };
    };
    const readProcess = async (pid, optional = false) => {
      try {
        const before = parseStat(await io.readFile(`/proc/${pid}/stat`, 'utf8'));
        if (before.pid !== pid) fail();
        if (before.state === 'Z') return null;
        const status = await io.readFile(`/proc/${pid}/status`, 'utf8');
        const uids = status
          .match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m)
          ?.slice(1)
          .map(Number);
        const exe = await io.readlink(`/proc/${pid}/exe`);
        const command = (await io.readFile(`/proc/${pid}/cmdline`, 'utf8'))
          .replaceAll('\0', ' ')
          .trim();
        const after = parseStat(await io.readFile(`/proc/${pid}/stat`, 'utf8'));
        if (
          !uids ||
          !uids.every((v) => v === uids[0]) ||
          exe !== executable ||
          before.start !== after.start ||
          after.state === 'Z'
        )
          fail();
        return { pid, start: before.start, uid: uids[0], exe, command, parent: before.parent };
      } catch (error) {
        if (optional && error.code === 'ENOENT') return null;
        throw error;
      }
    };
    const pidText = (await io.readPidFile()).trim();
    if (!pidValue(pidText)) fail();
    const pid = Number(pidText);
    const before = await readProcess(pid);
    if (!before || before.uid !== 0 || !before.command.startsWith('nginx: master process ')) fail();
    const children = (await io.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8'))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      children.length > 1024 ||
      children.some((p) => !pidValue(p)) ||
      new Set(children).size !== children.length
    )
      fail();
    const workers = [];
    for (const child of children) {
      const p = await readProcess(Number(child), true);
      if (!p) continue;
      if (
        p.parent !== pid ||
        !['nginx: worker process', 'nginx: worker process is shutting down'].includes(p.command)
      )
        fail();
      workers.push({
        pid: p.pid,
        start: p.start,
        uid: p.uid,
        exe: p.exe,
        shuttingDown: p.command.endsWith('is shutting down'),
      });
    }
    if (
      (await io.readPidFile()).trim() !== pidText ||
      !isDeepStrictEqual(before, await readProcess(pid))
    )
      fail();
    const { parent: _parent, ...master } = before;
    return { master, workers: workers.sort((a, b) => a.pid - b.pid) };
  } catch {
    fail();
  }
}

/** The existing fence's test/reload I/O. One construction per apply/restore;
 * journal and durable receipt are supplied by the same protected host context.
 * Worker turnover is not a substitute for subsequent HTTP/writer verification.
 */
export function createCutoverNginxIO(options, overrides = {}) {
  const io = { ...system, ...overrides };
  const input = structuredClone(options);
  if (
    io.platform !== 'linux' ||
    io.uid !== 0 ||
    !Number.isSafeInteger(input?.maintenanceEndsAtMs) ||
    !input.binding ||
    typeof io.assertJournalOwnership !== 'function' ||
    typeof io.readFenceReceipt !== 'function'
  )
    fail();
  let phase = 'fresh';
  let lastTime = -1;
  let tested;
  const clock = () => {
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < 0 || now < lastTime || now >= input.maintenanceEndsAtMs)
      fail();
    lastTime = now;
    return now;
  };
  clock(); // Fail before apply/restore can back up or replace a configuration file.
  const guard = async (expected) => {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(input?.maintenanceEndsAtMs) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        input.binding?.attempt ?? '',
      ) ||
      !/^[a-f0-9]{64}$/.test(input.binding?.inventoryDigest ?? '') ||
      !isDeepStrictEqual(await io.assertJournalOwnership(), input.binding)
    )
      fail();
    clock();
    const receipt = structuredClone(await io.readFenceReceipt());
    if (
      receipt?.attempt !== input.binding.attempt ||
      receipt.inventoryDigest !== input.binding.inventoryDigest ||
      !['orders', 'all-writers'].includes(receipt.stage) ||
      !['installing', 'restoring'].includes(receipt.phase) ||
      (receipt.phase === 'restoring' && receipt.stage !== 'all-writers') ||
      (expected && !isDeepStrictEqual(expected, receipt))
    )
      fail();
    clock();
    return receipt;
  };
  const command = (args) =>
    io.exec(executable, args, { env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' } });
  const config = async () => {
    const dump = await command(['-T']);
    if (typeof dump !== 'string' || !dump.length || Buffer.byteLength(dump) > 16 * 1024 * 1024)
      fail();
    return dump;
  };
  const runtime = async () => {
    const r = structuredClone(await io.readRuntime());
    const valid = (p) =>
      p &&
      pidValue(p.pid) &&
      /^[0-9]+$/.test(p.start) &&
      Number.isSafeInteger(p.uid) &&
      p.uid >= 0 &&
      p.exe === executable;
    if (
      !valid(r?.master) ||
      r.master.uid !== 0 ||
      typeof r.master.command !== 'string' ||
      !r.master.command.startsWith('nginx: master process ') ||
      !Array.isArray(r.workers) ||
      r.workers.some(
        (p) => !valid(p) || typeof p.shuttingDown !== 'boolean' || p.pid === r.master.pid,
      ) ||
      new Set(r.workers.map((p) => p.pid)).size !== r.workers.length
    )
      fail();
    r.workers.sort((a, b) => a.pid - b.pid);
    return r;
  };
  const wrap = (fn) => async () => {
    try {
      return await fn();
    } catch {
      phase = 'failed';
      fail();
    }
  };
  const serving = (r) => ({ master: r.master, workers: r.workers.filter((p) => !p.shuttingDown) });
  return {
    testNginx: wrap(async () => {
      if (phase !== 'fresh') fail();
      phase = 'testing';
      const receipt = await guard();
      const before = await runtime();
      if (!serving(before).workers.length) fail();
      await command(['-t']);
      const dump = await config();
      await guard(receipt);
      if (!isDeepStrictEqual(serving(before), serving(await runtime()))) fail();
      tested = { receipt, before, dump };
      phase = 'tested';
    }),
    reloadNginx: wrap(async () => {
      if (phase !== 'tested') fail();
      phase = 'reloading';
      await guard(tested.receipt);
      if (
        (await config()) !== tested.dump ||
        !isDeepStrictEqual(serving(tested.before), serving(await runtime()))
      )
        fail();
      await guard(tested.receipt);
      const began = clock();
      await command(['-s', 'reload']);
      const old = new Set(tested.before.workers.map(identity));
      let stable;
      while (true) {
        await guard(tested.receipt);
        if (clock() - began >= 30000) fail();
        const next = await runtime();
        if (!isDeepStrictEqual(next.master, tested.before.master)) fail();
        const newWorkers = next.workers.filter((p) => !old.has(identity(p)));
        const active =
          newWorkers.length > 0 &&
          next.workers.every((p) =>
            old.has(identity(p))
              ? p.shuttingDown
              : !p.shuttingDown && tested.before.workers.some((w) => w.uid === p.uid),
          );
        if (active && isDeepStrictEqual(newWorkers, stable)) break;
        stable = active ? newWorkers : undefined;
        await io.sleep(50);
      }
      if ((await config()) !== tested.dump) fail();
      await guard(tested.receipt);
      phase = 'done';
    }),
  };
}
