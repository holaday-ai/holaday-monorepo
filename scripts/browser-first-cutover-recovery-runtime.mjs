import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { readCutoverMysqlSnapshot } from './browser-first-cutover-mysql.mjs';
import { buildMaintenanceMigrationManifest } from './browser-maintenance-manifest.mjs';

const fail = () => {
  throw new Error('CUTOVER_RECOVERY_RUNTIME_UNPROVEN');
};
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fixedFiles = [
  'node',
  'recovery-tool.mjs',
  'apps/orchestrator/scripts/apply-numbered-migrations.mjs',
  'apps/orchestrator/scripts/apply-numbered-migrations.ts',
  'apps/orchestrator/scripts/release-db-contract.mjs',
];
const directories = [
  '',
  'apps',
  'apps/orchestrator',
  'apps/orchestrator/scripts',
  'apps/orchestrator/drizzle',
];
const sameStat = (a, b) =>
  ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeMs', 'ctimeMs'].every(
    (k) => a[k] === b[k],
  );
const privateFile = (s) =>
  s.isFile() && s.uid === process.getuid() && !(s.mode & 0o7077) && s.nlink === 1;

async function readPrivate(path, maxBytes, content = false) {
  const fd = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!privateFile(before) || before.size <= 0 || before.size > maxBytes) fail();
    const digest = createHash('sha256');
    const chunks = [];
    let count = 0;
    for await (const chunk of fd.createReadStream({ autoClose: false })) {
      count += chunk.length;
      if (count > maxBytes) fail();
      digest.update(chunk);
      if (content) chunks.push(chunk);
    }
    if (
      count !== before.size ||
      !sameStat(before, await fd.stat()) ||
      !sameStat(before, await fs.lstat(path))
    )
      fail();
    return { digest: digest.digest('hex'), bytes: content ? Buffer.concat(chunks) : undefined };
  } finally {
    await fd.close();
  }
}

/** Validate the deliberately small, copied recovery tool closure. No install,
 * network, dependencies, source checkout or dotenv loading occurs here. Both
 * compiled bytes AND original raw runner/SQL are bound, not interchangeable.
 */
export async function readFirstCutoverRecoveryRuntime({ root, runtimeDigest, migrationDigest }) {
  try {
    if (
      typeof root !== 'string' ||
      !isAbsolute(root) ||
      /[\r\n\0]/.test(root) ||
      !hash(runtimeDigest) ||
      !hash(migrationDigest) ||
      (await fs.realpath(root)) !== root
    )
      fail();
    const observedDirs = new Map();
    for (const dir of directories) {
      const path = join(root, dir);
      const stat = await fs.lstat(path);
      if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700)
        fail();
      observedDirs.set(path, stat);
    }
    const metadata = await readPrivate(join(root, 'runtime.json'), 1024 * 1024, true);
    if (
      metadata.digest !== runtimeDigest ||
      !Buffer.from(metadata.bytes.toString('utf8')).equals(metadata.bytes)
    )
      fail();
    const manifest = JSON.parse(metadata.bytes.toString('utf8'));
    if (
      !equal(Object.keys(manifest).sort(), ['files', 'migrationDigest', 'schemaVersion']) ||
      manifest.schemaVersion !== 1 ||
      manifest.migrationDigest !== migrationDigest ||
      !manifest.files ||
      Array.isArray(manifest.files) ||
      typeof manifest.files !== 'object'
    )
      fail();
    const files = Object.keys(manifest.files).sort();
    if (
      !fixedFiles.every((p) => files.includes(p)) ||
      !files.every(
        (p) =>
          fixedFiles.includes(p) ||
          /^apps\/orchestrator\/drizzle\/\d{4}_[A-Za-z0-9_-]+\.sql$/.test(p),
      ) ||
      !Object.values(manifest.files).every(hash)
    )
      fail();
    const actual = [];
    for (const dir of directories) {
      for (const name of await fs.readdir(join(root, dir))) {
        const relative = dir ? `${dir}/${name}` : name;
        if (!directories.includes(relative)) actual.push(relative);
      }
    }
    if (actual.includes('migration-started.json')) {
      await readPrivate(join(root, 'migration-started.json'), 1024);
      actual.splice(actual.indexOf('migration-started.json'), 1);
    }
    if (!equal(actual.sort(), [...files, 'runtime.json'].sort())) fail();
    for (const file of files) {
      const read = await readPrivate(
        join(root, file),
        file === 'node' ? 256 * 1024 * 1024 : 16 * 1024 * 1024,
      );
      if (read.digest !== manifest.files[file]) fail();
    }
    if (buildMaintenanceMigrationManifest(root).sha256 !== migrationDigest) fail();
    for (const [path, stat] of observedDirs) if (!sameStat(stat, await fs.lstat(path))) fail();
    if ((await readPrivate(join(root, 'runtime.json'), 1024 * 1024)).digest !== runtimeDigest)
      fail();
    return manifest;
  } catch {
    fail();
  }
}

const executeOriginal = (program, args, options) =>
  new Promise((resolve, reject) => {
    // No timeout, kill-on-output-limit or retries: a lost observer must never
    // replay a migration whose database effects may already have happened.
    const child = spawn(program, args, { ...options, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code, signal) =>
      code === 0 && !signal ? resolve() : reject(new Error('runner')),
    );
  });

/** Runs only INSIDE the dedicated no-network recovery container. Its parent
 * owns target/scope checks. This is not a release approval or backup receipt.
 */
export async function runFirstCutoverRecoveryTool(input, overrides = {}) {
  const io = {
    root: '/opt/holaday-recovery',
    connect: async (options) =>
      (
        await import('../apps/orchestrator/node_modules/mysql2/promise.js')
      ).default.createConnection(options),
    execute: executeOriginal,
    checkSchema: async (query) =>
      (
        await import('../apps/orchestrator/src/execution/ordinary-maintenance-readiness.ts')
      ).checkMaintenanceSchema(query),
    ...overrides,
  };
  let db;
  try {
    const request = structuredClone(input);
    const fields = ['action', 'identity', 'migrationDigest', 'runtimeDigest'];
    if (request?.action === 'verify') fields.push('projection');
    if (
      !request ||
      !equal(Object.keys(request).sort(), fields.sort()) ||
      !['migrate', 'snapshot', 'verify'].includes(request.action) ||
      !request.identity ||
      !equal(Object.keys(request.identity).sort(), ['database', 'serverUuid']) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.identity.serverUuid) ||
      !/^[A-Za-z0-9_]{1,64}$/.test(request.identity.database) ||
      (request.action === 'verify' &&
        (!Array.isArray(request.projection) || request.projection.length === 0))
    )
      throw new Error('input');
    const validate = () =>
      readFirstCutoverRecoveryRuntime({
        root: io.root,
        runtimeDigest: request.runtimeDigest,
        migrationDigest: request.migrationDigest,
      });
    const assertIdentity = async (keep = false) => {
      db = await io.connect({
        socketPath: '/var/run/mysqld/mysqld.sock',
        user: 'root',
        database: request.identity.database,
        multipleStatements: false,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        jsonStrings: true,
        decimalNumbers: false,
      });
      const [rows] = await db.query('SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`');
      if (!equal(rows, [request.identity])) throw new Error('identity');
      if (!keep) {
        const close = db;
        db = null;
        await close.end();
      }
    };
    await validate();
    if (request.action !== 'migrate') {
      await assertIdentity(true);
      if (request.action === 'verify')
        await io.checkSchema(async (sql, values) => (await db.query(sql, values))[0]);
      const result = await readCutoverMysqlSnapshot(
        db,
        request.identity,
        request.action === 'verify' ? { projection: request.projection } : {},
      );
      const close = db;
      db = null;
      await close.end();
      await validate();
      return request.action === 'verify'
        ? { schemaDigest: result.schemaDigest, businessDigest: result.businessDigest }
        : result;
    }
    await assertIdentity();
    const marker = await fs.open(
      join(io.root, 'migration-started.json'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await marker.writeFile(
        JSON.stringify({
          runtimeDigest: request.runtimeDigest,
          migrationDigest: request.migrationDigest,
          identity: request.identity,
        }),
      );
      await marker.sync();
    } finally {
      await marker.close();
    }
    const parent = await fs.open(
      io.root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    await validate();
    const url = new URL(`mysql://root@localhost/${request.identity.database}`);
    url.searchParams.set('socketPath', '/var/run/mysqld/mysqld.sock');
    await io.execute(
      join(io.root, 'node'),
      [join(io.root, 'apps/orchestrator/scripts/apply-numbered-migrations.mjs')],
      {
        cwd: io.root,
        env: { PATH: '/usr/bin:/bin', TZ: 'UTC', DATABASE_URL: url.toString() },
      },
    );
    await assertIdentity();
    await validate();
    return { migrationDigest: request.migrationDigest };
  } catch {
    if (db) {
      try {
        await db.end();
      } catch {
        // The operation has already failed; never expose raw connection errors.
      }
    }
    throw new Error('CUTOVER_RECOVERY_TOOL_UNPROVEN');
  }
}
