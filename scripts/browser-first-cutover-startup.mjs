import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const home = '/root/.pm2';
const archive = '/var/lib/holaday-deploy/maintenance';
const paths = [`${home}/dump.pm2`, `${home}/dump.pm2.bak`];
const names = new Set([
  'holaday-orchestrator',
  'holaday-account-closure-worker',
  'holaday-files-cron',
  'holaday-cn-payment',
]);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const fail = () => {
  throw new Error('CUTOVER_STARTUP_UNPROVEN');
};
const same = (a, b) => a.ino === b.ino && a.dev === b.dev;
const fileOK = (s) => s.isFile() && s.uid === 0 && s.nlink === 1 && !(s.mode & 0o7022);

// Keep every retained object byte-for-byte, not JSON.stringify(parsedRows): saved
// environments may contain numeric literals which JSON.parse cannot round-trip.
function rows(text) {
  const result = [];
  let i = 0;
  const whitespace = () => {
    while (/[ \t\r\n]/.test(text[i] ?? '') && i < text.length) i++;
  };
  whitespace();
  if (text[i++] !== '[') fail();
  whitespace();
  while (text[i] !== ']') {
    if (text[i] !== '{' || result.length >= 10000) fail();
    const start = i;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    do {
      const c = text[i++];
      if (c === undefined) fail();
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
    } while (depth > 0 || quoted);
    const raw = text.slice(start, i);
    const value = JSON.parse(raw);
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      typeof value.name !== 'string'
    )
      fail();
    result.push({ raw, name: value.name, digest: sha(raw) });
    whitespace();
    if (text[i] === ']') break;
    if (text[i++] !== ',') fail();
    whitespace();
    if (text[i] === ']') fail();
  }
  i++;
  whitespace();
  if (i !== text.length) fail();
  return result;
}

/** First-only protected saved-entry removal. This does not stop live processes.
 * Caller holds the shared journal and supplies the protected approved inventory.
 * No CLI, no automatic retry, no restore-on-error, no whole-daemon save. */
export async function removeSavedStartupEntries(input, io) {
  const disk = io.fs ?? fs;
  const open = [];
  try {
    const { binding, files, maintenanceEndsAtMs } = structuredClone(input);
    if (
      (io.platform ?? process.platform) !== 'linux' ||
      (io.uid ?? process.getuid?.()) !== 0 ||
      !uuid(binding?.attempt) ||
      !hash(binding.inventoryDigest) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      !Array.isArray(files) ||
      files.length !== 2 ||
      files.some(
        (f, i) =>
          f.path !== paths[i] ||
          !(hash(f.digest) || f.digest === null) ||
          !Array.isArray(f.remove) ||
          (f.digest === null && f.remove.length) ||
          f.remove.some((r) => !names.has(r.name) || !hash(r.entryDigest)) ||
          new Set(f.remove.map((r) => r.name)).size !== f.remove.length,
      ) ||
      !files.some((f) => f.remove.length)
    )
      fail();
    const began = io.now();
    if (!Number.isSafeInteger(began) || began < 0 || began >= maintenanceEndsAtMs) fail();
    let last = began;
    const guard = async () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < last ||
        now >= maintenanceEndsAtMs ||
        !isDeepStrictEqual(await io.assertOwnership(), binding)
      )
        fail();
      last = now;
    };
    const directory = async (path, privateOnly = false) => {
      const s = await disk.lstat(path);
      if (
        !s.isDirectory() ||
        s.uid !== 0 ||
        s.mode & 0o7022 ||
        (privateOnly && (s.mode & 0o777) !== 0o700) ||
        (await disk.realpath(path)) !== path
      )
        fail();
      return s;
    };
    const homeStat = await directory(home);
    const archiveStat = await directory(archive, true);
    const dirGuard = async () => {
      if (
        !same(homeStat, await directory(home)) ||
        !same(archiveStat, await directory(archive, true))
      )
        fail();
    };
    const read = async (path) => {
      await dirGuard();
      let h;
      try {
        let initial;
        try {
          initial = await disk.lstat(path);
        } catch (e) {
          if (e.code === 'ENOENT') return null;
          throw e;
        }
        if (!fileOK(initial)) fail();
        h = await disk.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const before = await h.stat();
        if (
          !fileOK(before) ||
          !same(initial, before) ||
          before.size > 8 * 1024 * 1024 ||
          before.size < 1
        )
          fail();
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await h.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        const after = await h.stat();
        const current = await disk.lstat(path);
        if (
          length !== before.size ||
          !fileOK(after) ||
          !fileOK(current) ||
          !same(before, current) ||
          !same(before, after) ||
          ['size', 'mtimeMs', 'ctimeMs', 'mode'].some(
            (k) => before[k] !== after[k] || after[k] !== current[k],
          )
        )
          fail();
        await dirGuard();
        const bytes = buffer.subarray(0, length);
        if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) fail();
        return { bytes, mode: before.mode & 0o777, digest: sha(bytes) };
      } finally {
        await h?.close();
      }
    };
    await guard();
    const planned = [];
    for (const f of files) {
      const source = await read(f.path);
      if ((source?.digest ?? null) !== f.digest) fail();
      let after = source?.bytes;
      if (source) {
        const entries = rows(source.bytes.toString('utf8'));
        for (const r of f.remove) {
          const matches = entries.filter((e) => e.name === r.name);
          if (matches.length !== 1 || matches[0].digest !== r.entryDigest) fail();
        }
        if (f.remove.length)
          after = Buffer.from(
            `[${entries
              .filter((e) => !f.remove.some((r) => r.name === e.name))
              .map((e) => e.raw)
              .join(',')}]\n`,
          );
      }
      planned.push({ ...f, source, after, afterDigest: after ? sha(after) : null });
    }
    const expected = planned.map((p) => p.digest);
    const verify = async () => {
      await guard();
      for (let i = 0; i < paths.length; i++)
        if ((await read(paths[i]))?.digest !== expected[i] && expected[i] !== null) fail();
      // Explicit absence is also an approved fact, not a missing check.
      for (let i = 0; i < paths.length; i++)
        if (expected[i] === null && (await read(paths[i])) !== null) fail();
    };
    const folder = `${archive}/startup-${binding.attempt}`;
    try {
      await disk.lstat(folder);
      fail();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await io.persist({ phase: 'startup-backup-intent', ...binding });
    await verify();
    await disk.mkdir(folder, { mode: 0o700 });
    const folderStat = await directory(folder, true);
    const privateGuard = async () => {
      await dirGuard();
      if (!same(folderStat, await directory(folder, true))) fail();
    };
    const verifyBackups = async () => {
      await privateGuard();
      for (const p of planned)
        if (p.source) {
          const path = `${folder}/${p.path.split('/').at(-1)}.original`;
          if ((await read(path))?.digest !== p.digest || (await disk.lstat(path)).mode & 0o077)
            fail();
        }
      await privateGuard();
    };
    const syncDirectory = async (path) => {
      const h = await disk.open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await h.sync();
      } finally {
        await h.close();
      }
    };
    for (const p of planned)
      if (p.source) {
        await privateGuard();
        const h = await disk.open(
          `${folder}/${p.path.split('/').at(-1)}.original`,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        open.push(h);
        await h.writeFile(p.source.bytes);
        await h.sync();
      }
    await privateGuard();
    await syncDirectory(folder);
    await syncDirectory(archive);
    const receipt = {
      ...binding,
      files: planned.map((p) => ({
        path: p.path,
        beforeDigest: p.digest,
        afterDigest: p.afterDigest,
      })),
    };
    await io.persist({ phase: 'startup-backed-up', ...receipt });
    await verify();
    await verifyBackups();
    // Fallback first: never leave an old fallback as the last recovery source.
    for (const i of [1, 0]) {
      const p = planned[i];
      if (p.afterDigest === p.digest) continue;
      await io.persist({ phase: 'startup-file-intent', ...binding, ...receipt.files[i] });
      await verify();
      await verifyBackups();
      const temp = `${home}/.holaday-startup-${binding.attempt}-${i}`;
      const h = await disk.open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        p.source.mode,
      );
      open.push(h);
      await h.writeFile(p.after);
      await h.sync();
      await verify();
      await verifyBackups();
      const tempStat = await h.stat();
      if (!fileOK(tempStat) || !same(tempStat, await disk.lstat(temp))) fail();
      await disk.rename(temp, p.path);
      await syncDirectory(home);
      expected[i] = p.afterDigest;
      await verify();
      await io.persist({ phase: 'startup-file-written', ...binding, ...receipt.files[i] });
    }
    await verify();
    await verifyBackups();
    return receipt;
  } catch {
    throw new Error('CUTOVER_STARTUP_UNPROVEN');
  } finally {
    await Promise.allSettled(open.map((h) => h.close()));
  }
}
