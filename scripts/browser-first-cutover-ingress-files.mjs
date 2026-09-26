import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describeCutoverSite } from './browser-first-cutover-fence.mjs';

const archive = '/var/lib/holaday-deploy/maintenance';
const generatedRoot = '/etc/nginx/holaday-maintenance';
const enabledRoot = '/etc/nginx/sites-enabled';
const availableRoot = '/etc/nginx/sites-available';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fail = () => {
  throw new Error('CUTOVER_INGRESS_FILES_UNPROVEN');
};
const same = (a, b) =>
  ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].every(
    (k) => a[k] === b[k],
  );
const sameNode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const names = ['holaday', 'hd-app.orangebench.tech', 'hd-pay.orangebench.tech'];

/** Filesystem methods for the EXISTING apply/verify/restore fence protocol.
 * Host supplies protected approval/journal/receipt readers and the full ingress
 * classifier. This is not a CLI or a host-wide isolation claim. No replay/rollback.
 * Only sites-enabled links move: original configs and release ownership stay intact.
 */
export async function createCutoverIngressFiles(input, io) {
  const disk = io.fs ?? fs;
  const wrap =
    (operation) =>
    async (...args) => {
      try {
        return await operation(...args);
      } catch {
        fail();
      }
    };
  return wrap(async () => {
    const { binding, files, maintenanceEndsAtMs } = structuredClone(input);
    if (
      (io.platform ?? process.platform) !== 'linux' ||
      (io.uid ?? process.getuid?.()) !== 0 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        binding?.attempt ?? '',
      ) ||
      !digest(binding.inventoryDigest) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      !Array.isArray(files) ||
      !files.length ||
      files.length > 3 ||
      new Set(files.map((f) => f.path)).size !== files.length
    )
      fail();
    let last = -1;
    const guard = async () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < last ||
        now >= maintenanceEndsAtMs ||
        !isDeepStrictEqual(await io.assertJournalOwnership(), binding)
      )
        fail();
      const checkedAt = io.now();
      if (!Number.isSafeInteger(checkedAt) || checkedAt < now || checkedAt >= maintenanceEndsAtMs)
        fail();
      last = checkedAt;
    };
    await guard();
    const directory = async (path, privateOnly = false) => {
      const stat = await disk.lstat(path);
      if (
        !stat.isDirectory() ||
        stat.uid !== 0 ||
        stat.mode & 0o7022 ||
        (privateOnly && (stat.mode & 0o777) !== 0o700) ||
        (await disk.realpath(path)) !== path
      )
        fail();
      return stat;
    };
    const directories = new Map();
    for (const path of ['/etc/nginx', enabledRoot, availableRoot, archive])
      directories.set(path, await directory(path, path === archive));
    const checkDirectories = async () => {
      for (const [path, stat] of directories)
        if (
          !sameNode(
            stat,
            await directory(
              path,
              path === archive || path.startsWith(generatedRoot) || path.startsWith(`${archive}/`),
            ),
          )
        )
          fail();
    };
    const read = async (path, { uid = 0, gid, mode = 0o600 } = {}) => {
      if ((await disk.realpath(path)) !== path) fail();
      const h = await disk.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await h.stat();
        if (
          !before.isFile() ||
          before.uid !== uid ||
          (gid !== undefined && before.gid !== gid) ||
          before.nlink !== 1 ||
          (before.mode & 0o7777) !== mode ||
          before.size < 1 ||
          before.size > 1024 * 1024
        )
          fail();
        const buffer = Buffer.alloc(before.size + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await h.read(buffer, size, buffer.length - size, null);
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (
          size !== before.size ||
          !same(before, await h.stat()) ||
          !same(before, await disk.lstat(path)) ||
          (await disk.realpath(path)) !== path
        )
          fail();
        const bytes = buffer.subarray(0, size);
        if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) fail();
        return { bytes: bytes.toString('utf8'), stat: before };
      } finally {
        await h.close();
      }
    };
    const link = async (path, target, expected) => {
      const before = await disk.lstat(path);
      if (
        !before.isSymbolicLink() ||
        before.uid !== 0 ||
        before.nlink !== 1 ||
        (expected && !same(before, expected)) ||
        (await disk.readlink(path)) !== target ||
        !same(before, await disk.lstat(path))
      )
        fail();
      return before;
    };
    const states = new Map();
    for (const file of files) {
      const name = posix.basename(file.path);
      if (
        !names.includes(name) ||
        file.path !== `${availableRoot}/${name}` ||
        file.enabledPath !== `${enabledRoot}/${name}` ||
        !digest(file.digest) ||
        !Array.isArray(file.links) ||
        ![1, 2].includes(file.links.length) ||
        !Number.isSafeInteger(file.sourceUid) ||
        file.sourceUid < 0 ||
        !Number.isSafeInteger(file.sourceGid) ||
        file.sourceGid < 0 ||
        file.sourceMode !== 0o644
      )
        fail();
      const release =
        name === 'hd-app.orangebench.tech' &&
        /^\/opt\/holaday-edge\/releases\/[0-9]{14}-[a-zA-Z0-9]+\/ops\/aliyun-edge\/nginx-hd-app\.conf$/.test(
          file.sourcePath,
        );
      if (!(file.sourcePath === file.path || release) || file.links.length !== (release ? 2 : 1))
        fail();
      for (let i = 0; i < file.links.length; i++) {
        const item = file.links[i];
        const next = file.links[i + 1]?.path ?? file.sourcePath;
        if (
          item.path !== (i ? file.path : file.enabledPath) ||
          typeof item.target !== 'string' ||
          /[\r\n\0]/.test(item.target) ||
          posix.resolve(posix.dirname(item.path), item.target) !== next
        )
          fail();
        item.stat = await link(item.path, item.target);
      }
      const source = await read(file.sourcePath, {
        uid: file.sourceUid,
        gid: file.sourceGid,
        mode: file.sourceMode,
      });
      const description = describeCutoverSite(source.bytes, file.profile);
      if (
        description.digest !== file.digest ||
        !isDeepStrictEqual(description.locations, file.locations) ||
        (await disk.realpath(file.enabledPath)) !== file.sourcePath
      )
        fail();
      states.set(file.path, {
        file,
        name,
        sourceStat: source.stat,
        currentLink: file.links[0].target,
        currentStat: file.links[0].stat,
        currentDigest: file.digest,
        stage: null,
      });
    }
    const stateFor = (path) => {
      const s = states.get(path);
      if (!s) fail();
      return s;
    };
    const verifySources = async () => {
      await guard();
      await checkDirectories();
      for (const s of states.values()) {
        const f = s.file;
        for (const item of f.links.slice(1)) await link(item.path, item.target, item.stat);
        const source = await read(f.sourcePath, {
          uid: f.sourceUid,
          gid: f.sourceGid,
          mode: f.sourceMode,
        });
        if (!same(source.stat, s.sourceStat) || sha(source.bytes) !== f.digest) fail();
        await link(f.enabledPath, s.currentLink, s.currentStat);
        const resolved = s.stage ? s.currentLink : f.sourcePath;
        if ((await disk.realpath(f.enabledPath)) !== resolved) fail();
        if (s.stage && sha((await read(resolved)).bytes) !== s.currentDigest) fail();
      }
      await guard();
      await checkDirectories();
    };
    await verifySources();
    const folder = `${generatedRoot}/${binding.attempt}`;
    const backups = `${archive}/ingress-${binding.attempt}`;
    const inventoryBytes = `${JSON.stringify({
      schemaVersion: 1,
      ...binding,
      files: files.map((f) => ({
        path: f.path,
        enabledPath: f.enabledPath,
        sourcePath: f.sourcePath,
        sourceUid: f.sourceUid,
        sourceGid: f.sourceGid,
        sourceMode: f.sourceMode,
        digest: f.digest,
        links: f.links.map(({ path, target }) => ({ path, target })),
      })),
    })}\n`;
    let prepared = false;
    let sequence = 0;
    const sync = async (path) => {
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
    const prepare = async () => {
      if (prepared) return;
      await verifySources();
      try {
        await disk.mkdir(generatedRoot, { mode: 0o700 });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      directories.set(generatedRoot, await directory(generatedRoot, true));
      // Exclusive per-attempt directories: interruptions require inspection, not replay.
      await disk.mkdir(folder, { mode: 0o700 });
      await disk.mkdir(backups, { mode: 0o700 });
      directories.set(folder, await directory(folder, true));
      directories.set(backups, await directory(backups, true));
      if (directories.get(folder).dev !== directories.get(enabledRoot).dev) fail();
      await sync(generatedRoot);
      await sync(archive);
      await write(`${backups}/inventory.json`, inventoryBytes);
      prepared = true;
    };
    const write = async (path, bytes) => {
      const h = await disk.open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await h.writeFile(bytes);
        await h.sync();
        if (!same(await h.stat(), await disk.lstat(path))) fail();
      } finally {
        await h.close();
      }
      if (sha((await read(path)).bytes) !== sha(bytes)) fail();
      await sync(posix.dirname(path));
    };
    const backupPath = (s) => `${backups}/${s.name}.original`;
    const verifyBackup = async (s) => {
      await checkDirectories();
      if ((await read(`${backups}/inventory.json`)).bytes !== inventoryBytes) fail();
      const source = await read(backupPath(s));
      if (sha(source.bytes) !== s.file.digest) fail();
      return source.bytes;
    };
    return {
      readConfig: wrap(async (path) => {
        await verifySources();
        const s = stateFor(path);
        return (
          await read(
            s.stage ? s.currentLink : s.file.sourcePath,
            s.stage
              ? undefined
              : { uid: s.file.sourceUid, gid: s.file.sourceGid, mode: s.file.sourceMode },
          )
        ).bytes;
      }),
      backupOriginal: wrap(async (record, bytes) => {
        const s = stateFor(record.path);
        if (record.originalDigest !== s.file.digest || sha(bytes) !== s.file.digest || s.stage)
          fail();
        await prepare();
        await verifySources();
        await write(backupPath(s), bytes);
        await verifySources();
        await verifyBackup(s);
        return s.file.digest;
      }),
      readBackup: wrap(async (record) => {
        const s = stateFor(record.path);
        if (!prepared || record.backupDigest !== s.file.digest) fail();
        await verifySources();
        return verifyBackup(s);
      }),
      replaceConfig: wrap(async (path, expected, bytes) => {
        const s = stateFor(path);
        if (
          !prepared ||
          typeof bytes !== 'string' ||
          Buffer.byteLength(bytes) > 1024 * 1024 ||
          expected !== s.currentDigest
        )
          fail();
        const receipt = structuredClone(await io.readFenceReceipt());
        if (
          receipt?.attempt !== binding.attempt ||
          receipt.inventoryDigest !== binding.inventoryDigest ||
          receipt.schemaVersion !== 1 ||
          !['installing', 'restoring'].includes(receipt.phase) ||
          !Array.isArray(receipt.files)
        )
          fail();
        const rows = receipt.files.filter((f) => f.path === path);
        if (
          rows.length !== 1 ||
          rows[0].originalDigest !== s.file.digest ||
          rows[0].backupDigest !== s.file.digest
        )
          fail();
        const restoring = receipt.phase === 'restoring';
        if (
          restoring
            ? receipt.stage !== 'all-writers' ||
              s.stage !== 'all-writers' ||
              rows[0].generatedDigest !== expected ||
              sha(bytes) !== s.file.digest
            : receipt.stage !== (s.stage === null ? 'orders' : 'all-writers') ||
              s.stage === 'all-writers' ||
              rows[0].generatedDigest !== sha(bytes)
        )
          fail();
        await verifySources();
        await verifyBackup(s);
        let target = s.file.links[0].target;
        if (!restoring) {
          target = `${folder}/${s.name}-${sha(bytes)}.conf`;
          await write(target, bytes);
        }
        const temporary = `${folder}/link-${s.name}-${++sequence}`;
        await disk.symlink(target, temporary);
        const tempStat = await link(temporary, target);
        await verifySources();
        await verifyBackup(s);
        if (!isDeepStrictEqual(await io.readFenceReceipt(), receipt)) fail();
        if (!restoring && sha((await read(target)).bytes) !== sha(bytes)) fail();
        await link(temporary, target, tempStat);
        await guard();
        await disk.rename(temporary, s.file.enabledPath);
        const installed = await link(s.file.enabledPath, target);
        // Our rename changes ctime. Retain inode/device and all other identity
        // fields here; subsequent observations again require the full metadata.
        if (
          !sameNode(installed, tempStat) ||
          ['uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs'].some(
            (k) => installed[k] !== tempStat[k],
          )
        )
          fail();
        s.currentLink = target;
        s.currentStat = installed;
        s.currentDigest = sha(bytes);
        s.stage = restoring ? null : receipt.stage;
        await sync(enabledRoot);
        await sync(folder);
        await verifySources();
      }),
    };
  })();
}
