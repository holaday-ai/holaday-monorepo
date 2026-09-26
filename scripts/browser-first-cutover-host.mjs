import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  candidatePreparationSystem,
  maintenanceCandidateEnvironment,
  parseMaintenanceCandidateConfig,
  stageReleaseCandidate,
} from './browser-maintenance-host.mjs';

const system = { ...fs, platform: process.platform, uid: process.getuid?.(), now: Date.now };
const directory = '/var/lib/holaday-deploy/maintenance';
const approvalPath = `${directory}/first-cutover-approved.json`;
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;
const fields = [
  'schemaVersion',
  'kind',
  'attempt',
  'branch',
  'candidate',
  'configDigest',
  'migrationDigest',
  'inventoryDigest',
  'legacyDigest',
  'maintenanceEndsAtMs',
  'reconcileByMs',
  'operatorRef',
];
const privateFile = (stat) =>
  stat.isFile() && stat.uid === 0 && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1;
const privateDirectory = (stat) =>
  stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o7777) === 0o700;

/** Preparation segment of the first host, not a deploy command or readiness
 * proof. Real source classification is mandatory and has no permissive default.
 * A successful return retains the actual journal for the remaining lifecycle;
 * failure closes handles only, preserving the lock and any staged candidate.
 */
export async function prepareFirstCutoverCandidate(options, overrides = {}) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    ...overrides,
  };
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (!options || Object.keys(options).length !== 1 || !uuid(options.attempt))
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  if (typeof io.inspectLegacySource !== 'function')
    throw new Error('CUTOVER_HOST_OBSERVER_REQUIRED');
  const approval = structuredClone(await io.readApproval(options));
  const binding = Object.fromEntries(
    ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map((key) => [
      key,
      approval[key],
    ]),
  );
  const root = `/opt/holaday-releases/${approval.candidate}`;
  const sourceRoot = '/opt/holaday-monorepo';
  let journal;
  let lastTime = -1;
  const guard = async () => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now < lastTime ||
      now >= approval.maintenanceEndsAtMs
    )
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = now;
    if (!isDeepStrictEqual(await io.readApproval(options), approval))
      throw new Error('CUTOVER_APPROVAL_UNPROVEN');
    if (journal && !isDeepStrictEqual(await journal.assertOwnership(), binding))
      throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    const after = io.now();
    if (!Number.isSafeInteger(after) || after < now || after >= approval.maintenanceEndsAtMs)
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = after;
  };
  const source = async () => {
    const observed = await io.inspectLegacySource(structuredClone(approval));
    const now = io.now();
    if (
      !/^[a-f0-9]{40}$/.test(observed?.sourceCandidate ?? '') ||
      observed.legacyDigest !== approval.legacyDigest ||
      !Number.isSafeInteger(observed.observedAtMs) ||
      observed.observedAtMs < 0 ||
      observed.observedAtMs > now ||
      now - observed.observedAtMs > 60000
    )
      throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
    return observed.sourceCandidate;
  };
  try {
    await guard();
    const sourceCandidate = await source();
    const config = Buffer.from(await io.readConfig());
    if (createHash('sha256').update(config).digest('hex') !== approval.configDigest)
      throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
    const parsed = parseMaintenanceCandidateConfig(config, sourceRoot, io);
    if ((await io.exec('id', ['-u', 'holaday'])).trim() !== '998')
      throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
    const gidText = (await io.exec('id', ['-g', 'holaday'])).trim();
    const gid = Number(gidText);
    if (!/^[1-9][0-9]*$/.test(gidText) || !Number.isSafeInteger(gid))
      throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
    await io.targetAbsent(root);
    await guard();
    journal = await io.journal(directory, {
      ...binding,
      kind: 'first-cutover',
      legacyDigest: approval.legacyDigest,
    });
    await guard();
    await stageReleaseCandidate(
      {
        branch: approval.branch,
        candidate: approval.candidate,
        sourceRoot,
        sourceCandidate,
        config,
        configDigest: approval.configDigest,
        migrationDigest: approval.migrationDigest,
        gid,
        env: maintenanceCandidateEnvironment(parsed, approval.candidate),
      },
      {
        ...io,
        assertOwnership: guard,
        bindManifest: async (manifest) => {
          if (
            (await source()) !== sourceCandidate ||
            createHash('sha256')
              .update(await io.readConfig())
              .digest('hex') !== approval.configDigest
          )
            throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
          await guard();
          await journal.bindManifest(manifest);
        },
      },
    );
    return { approval, binding, root, sourceCandidate, applicationGid: gid, journal };
  } catch (error) {
    await journal?.close();
    throw error;
  }
}

/** Read-only approval metadata, not evidence that hosts/payments are safe.
 * The future host adapter must still collect live facts under its real journal.
 * Importing this module never starts a service, opens a database, or reads secrets. */
export async function readFirstCutoverApproval(options, io = system) {
  let handle;
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !options ||
      Object.keys(options).length !== 1 ||
      !uuid(options.attempt)
    )
      throw new Error('input');
    const began = io.now();
    if (!Number.isSafeInteger(began) || began < 0) throw new Error('clock');
    const folder = await io.lstat(directory);
    if (!privateDirectory(folder) || (await io.realpath(directory)) !== directory)
      throw new Error('directory');
    handle = await io.open(
      approvalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!privateFile(before) || before.size < 1 || before.size > 64 * 1024) throw new Error('file');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await io.lstat(approvalPath);
    const currentFolder = await io.lstat(directory);
    if (
      !privateFile(after) ||
      !privateFile(current) ||
      !sameFile(before, after) ||
      !sameFile(after, current) ||
      before.size !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.size !== current.size ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs ||
      !privateDirectory(currentFolder) ||
      !sameFile(folder, currentFolder) ||
      (await io.realpath(directory)) !== directory ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)
    )
      throw new Error('changed');
    const record = JSON.parse(bytes.toString('utf8'));
    const now = io.now();
    if (
      !record ||
      Object.keys(record).length !== fields.length ||
      !fields.every((k) => Object.hasOwn(record, k)) ||
      record.schemaVersion !== 1 ||
      record.kind !== 'first-cutover' ||
      record.attempt !== options.attempt ||
      typeof record.branch !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(record.branch) ||
      typeof record.candidate !== 'string' ||
      !/^[a-f0-9]{40}$/.test(record.candidate) ||
      !['configDigest', 'migrationDigest', 'inventoryDigest', 'legacyDigest'].every(
        (k) => typeof record[k] === 'string' && /^[a-f0-9]{64}$/.test(record[k]),
      ) ||
      !Number.isSafeInteger(record.maintenanceEndsAtMs) ||
      !Number.isSafeInteger(record.reconcileByMs) ||
      record.reconcileByMs < record.maintenanceEndsAtMs ||
      !Number.isSafeInteger(now) ||
      now < began ||
      now >= record.maintenanceEndsAtMs ||
      typeof record.operatorRef !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(record.operatorRef)
    )
      throw new Error('binding');
    return { ...record, approvalDigest: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  } finally {
    await handle?.close();
  }
}

/** Durable local-host receipts for the existing fence protocol. Caller supplies
 * the real shared journal and protected file scope. Never resumes an old attempt,
 * proves isolation, reloads nginx or grants permission to restore on its own.
 * The journal excludes cooperative concurrent deployment; this is not root-adversary CAS.
 */
export async function createFirstCutoverFenceStore(input, io) {
  const disk = io.fs ?? fs;
  const reject = () => {
    throw new Error('CUTOVER_FENCE_RECORD_UNPROVEN');
  };
  const wrap =
    (operation) =>
    async (...args) => {
      try {
        return await operation(...args);
      } catch {
        reject();
      }
    };
  return wrap(async () => {
    const { binding, files, maintenanceEndsAtMs } = structuredClone(input);
    const bindingKeys = [
      'attempt',
      'candidate',
      'configDigest',
      'migrationDigest',
      'inventoryDigest',
    ];
    const hash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
    if (
      (io.platform ?? process.platform) !== 'linux' ||
      (io.uid ?? process.getuid?.()) !== 0 ||
      !binding ||
      Object.keys(binding).length !== bindingKeys.length ||
      !uuid(binding.attempt) ||
      !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
      !['configDigest', 'migrationDigest', 'inventoryDigest'].every((key) => hash(binding[key])) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      !Array.isArray(files) ||
      !files.length ||
      files.length > 3 ||
      new Set(files.map((f) => f.path)).size !== files.length ||
      files.some(
        (f) =>
          !/^\/etc\/nginx\/sites-available\/(?:holaday|hd-app\.orangebench\.tech|hd-pay\.orangebench\.tech)$/.test(
            f.path ?? '',
          ) || !hash(f.digest),
      )
    )
      reject();
    let lastTime = -1;
    let failed = false;
    let current;
    let currentStat;
    let currentBytes;
    let queue = Promise.resolve();
    const path = `${directory}/${binding.attempt}.ingress.json`;
    const sameStat = (a, b) =>
      ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].every(
        (key) => a[key] === b[key],
      );
    const guard = async () => {
      const now = io.now();
      if (
        failed ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < lastTime ||
        now >= maintenanceEndsAtMs
      )
        reject();
      const owner = await io.assertJournalOwnership();
      const after = io.now();
      if (
        !bindingKeys.every((key) => owner?.[key] === binding[key]) ||
        !Number.isSafeInteger(after) ||
        after < now ||
        after >= maintenanceEndsAtMs
      )
        reject();
      lastTime = after;
    };
    await guard();
    const folder = await disk.lstat(directory);
    const checkFolder = async () => {
      const current = await disk.lstat(directory);
      if (
        !privateDirectory(current) ||
        !sameFile(folder, current) ||
        (await disk.realpath(directory)) !== directory
      )
        reject();
    };
    await checkFolder();
    const absent = async () => {
      try {
        await disk.lstat(path);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      reject();
    };
    await absent(); // A partial/historical record is never an invitation to resume.
    const read = async () => {
      await guard();
      await checkFolder();
      if (!current) {
        await absent();
        return undefined;
      }
      const h = await disk.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await h.stat();
        if (!privateFile(before) || !sameStat(currentStat, before) || before.size > 16 * 1024)
          reject();
        const bytes = await h.readFile();
        if (
          !bytes.equals(currentBytes) ||
          !sameStat(before, await h.stat()) ||
          !sameStat(before, await disk.lstat(path))
        )
          reject();
      } finally {
        await h.close();
      }
      await checkFolder();
      await guard();
      return structuredClone(current);
    };
    const phase = (r) => (r ? `${r.stage}:${r.phase}` : 'new');
    const phases = [
      'new',
      'orders:installing',
      'orders:active',
      'all-writers:installing',
      'all-writers:active',
      'all-writers:restoring',
      'all-writers:restored',
    ];
    const validate = (r) => {
      const restoring = ['restoring', 'restored'].includes(r?.phase);
      const keys = [
        'schemaVersion',
        'attempt',
        'inventoryDigest',
        'stage',
        'phase',
        'files',
        ...(restoring ? ['identity'] : []),
      ];
      if (
        !r ||
        Object.keys(r).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(r, key)) ||
        r.schemaVersion !== 1 ||
        r.attempt !== binding.attempt ||
        r.inventoryDigest !== binding.inventoryDigest ||
        phases.indexOf(phase(r)) !== phases.indexOf(phase(current)) + 1 ||
        !Array.isArray(r.files) ||
        r.files.length !== files.length
      )
        reject();
      for (const [index, expected] of files.entries()) {
        const value = r.files[index];
        if (
          !value ||
          Object.keys(value).length !== 4 ||
          value.path !== expected.path ||
          value.originalDigest !== expected.digest ||
          value.backupDigest !== expected.digest ||
          !hash(value.generatedDigest)
        )
          reject();
      }
      // Only the start of the next isolation stage may change generated content.
      if (current && r.phase !== 'installing' && !isDeepStrictEqual(r.files, current.files))
        reject();
      if (
        restoring &&
        (!r.identity ||
          Object.keys(r.identity).length !== 2 ||
          r.identity.candidate !== binding.candidate ||
          !/^[a-f0-9]{32}$/.test(r.identity.bootId ?? '') ||
          (r.phase === 'restored' && !isDeepStrictEqual(r.identity, current.identity)))
      )
        reject();
    };
    const persist = async (r) => {
      validate(r);
      await read();
      const bytes = Buffer.from(`${JSON.stringify(r)}\n`);
      if (bytes.length > 16 * 1024) reject();
      const destination = current
        ? `${directory}/${binding.attempt}.${randomUUID()}.ingress.tmp`
        : path;
      let h;
      let folderHandle;
      try {
        await guard();
        await checkFolder();
        folderHandle = await disk.open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        if (!sameFile(folder, await folderHandle.stat())) reject();
        h = await disk.open(
          destination,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await h.writeFile(bytes);
        await h.sync();
        const written = await h.stat();
        if (!privateFile(written) || written.size !== bytes.length) reject();
        await h.close();
        h = undefined;
        if (current) await read();
        await checkFolder();
        if (!sameStat(written, await disk.lstat(destination))) reject();
        await guard();
        if (current) await disk.rename(destination, path);
        await folderHandle.sync();
        const installed = await disk.lstat(path);
        if (
          !privateFile(installed) ||
          !sameFile(written, installed) ||
          installed.size !== bytes.length
        )
          reject();
        current = structuredClone(r);
        currentBytes = bytes;
        currentStat = installed;
        await read();
      } catch (error) {
        failed = true; // Preserve uncertain files and stop; never retry or auto-clean.
        throw error;
      } finally {
        await h?.close();
        await folderHandle?.close();
      }
    };
    const serial = (operation) => {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    };
    return {
      readFenceReceipt: () => serial(wrap(read)),
      persistFenceReceipt: (value) => {
        const record = structuredClone(value);
        return serial(wrap(() => persist(record)));
      },
    };
  })();
}
