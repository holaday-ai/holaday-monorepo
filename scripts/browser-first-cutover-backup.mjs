import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual, promisify } from 'node:util';
import { decryptAgeBackupToFile, receiveAgeBackup } from './browser-backup-age.mjs';

export {
  decryptAgeBackupToFile,
  encryptAgeBackup,
  encryptMysqlAgeBackup,
  hashAgeBackupArtifact,
  inspectAgeBackupArtifact,
  inspectAgeBackupFacility,
  receiveAgeBackup,
  streamAgeBackupArtifact,
} from './browser-backup-age.mjs';

const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys = (value, names) =>
  value &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const identityValid = (value) =>
  keys(value, ['serverUuid', 'database']) &&
  uuid(value.serverUuid) &&
  typeof value.database === 'string' &&
  /^[a-zA-Z0-9_]{1,64}$/.test(value.database);

const targetValid = (target) =>
  keys(target, ['containerId', 'imageId', 'volume', 'attempt', 'identity']) &&
  hash(target.containerId) &&
  /^sha256:[a-f0-9]{64}$/.test(target.imageId ?? '') &&
  uuid(target.attempt) &&
  target.volume === `holaday-cutover-restore-${target.attempt}` &&
  identityValid(target.identity);
const mysqlTargetArgs = (target) => [
  'exec',
  '--user',
  '0',
  '--env',
  'MYSQL_TEST_LOGIN_FILE=/dev/null',
  '-i',
  target.containerId,
  '/usr/bin/mysql',
  '--no-defaults',
  '--protocol=SOCKET',
  '--socket=/var/run/mysqld/mysqld.sock',
  '-uroot',
  '--binary-mode=1',
  '--local-infile=0',
  '--skip-reconnect',
  `--database=${target.identity.database}`,
];

/** Recovery-machine observation of an already approved dedicated container.
 * Never creates, empties, stops or removes a database/container. Identity and
 * volume are pinned; no host mounts, shared volume, network or other databases.
 */
export async function inspectFirstCutoverRecoveryTarget(input, overrides = {}) {
  try {
    const target = structuredClone(input);
    if (!targetValid(target)) throw new Error('target');
    const run = overrides.execFile ?? promisify(execFile);
    const command = async (args) =>
      (await run('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000 }))
        .stdout;
    const inspect = async () => {
      const rows = JSON.parse(await command(['inspect', target.containerId]));
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('inspect');
      const c = rows[0];
      const h = c.HostConfig;
      if (
        c.Id !== target.containerId ||
        c.Image !== target.imageId ||
        !c.State.Running ||
        c.State.Paused ||
        c.State.Restarting ||
        c.State.OOMKilled ||
        c.Config.Labels?.['holaday.cutover.attempt'] !== target.attempt ||
        !Array.isArray(c.Config.Env) ||
        c.Config.Env.some(
          (v) =>
            ![
              'PATH',
              'GOSU_VERSION',
              'MYSQL_MAJOR',
              'MYSQL_VERSION',
              'MYSQL_SHELL_VERSION',
              'MYSQL_ALLOW_EMPTY_PASSWORD',
              'MYSQL_DATABASE',
            ].includes(v.split('=')[0]),
        ) ||
        h.NetworkMode !== 'none' ||
        h.Privileged ||
        h.PidMode ||
        h.IpcMode !== 'private' ||
        h.CapAdd?.length ||
        h.Devices?.length ||
        h.DeviceRequests?.length ||
        h.Binds?.length ||
        Object.keys(h.PortBindings ?? {}).length ||
        h.RestartPolicy?.Name !== 'no' ||
        !(h.Memory > 0 && h.Memory <= 1073741824) ||
        !(h.NanoCpus > 0 && h.NanoCpus <= 1000000000) ||
        !(h.PidsLimit > 0 && h.PidsLimit <= 256) ||
        !isDeepStrictEqual(Object.keys(c.NetworkSettings.Networks), ['none']) ||
        Object.values(c.NetworkSettings.Ports ?? {}).some((v) => v?.length) ||
        c.Mounts.length !== 1 ||
        c.Mounts[0].Type !== 'volume' ||
        c.Mounts[0].Name !== target.volume ||
        c.Mounts[0].Destination !== '/var/lib/mysql' ||
        !c.Mounts[0].RW
      )
        throw new Error('isolation');
      const volumes = JSON.parse(await command(['volume', 'inspect', target.volume]));
      if (!Array.isArray(volumes) || volumes.length !== 1) throw new Error('volume');
      const v = volumes[0];
      if (
        v.Name !== target.volume ||
        v.Driver !== 'local' ||
        v.Scope !== 'local' ||
        Object.keys(v.Options ?? {}).length ||
        v.Labels?.['holaday.cutover.attempt'] !== target.attempt
      )
        throw new Error('volume');
      if (
        (
          await command(['ps', '-aq', '--no-trunc', '--filter', `volume=${target.volume}`])
        ).trim() !== target.containerId
      )
        throw new Error('shared volume');
    };
    await inspect();
    const sql = `SELECT JSON_OBJECT('serverUuid',@@server_uuid,'database',DATABASE(),'eventScheduler',@@event_scheduler,'foreignSchemas',(SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql','sys','information_schema','performance_schema',DATABASE())),'connections',(SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID()),'objects',(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE())+(SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE())+(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()))`;
    const row = JSON.parse(
      (
        await command([
          ...mysqlTargetArgs(target),
          '--batch',
          '--skip-column-names',
          '--raw',
          '--execute',
          sql,
        ])
      ).trim(),
    );
    if (
      !isDeepStrictEqual({ serverUuid: row.serverUuid, database: row.database }, target.identity) ||
      row.eventScheduler !== 'OFF' ||
      row.foreignSchemas !== 0 ||
      row.connections !== 0 ||
      !Number.isSafeInteger(row.objects) ||
      row.objects < 0 ||
      (overrides.requireEmpty !== false && row.objects !== 0)
    )
      throw new Error('database');
    await inspect();
    return structuredClone(target.identity);
  } catch {
    throw new Error('CUTOVER_RECOVERY_TARGET_UNPROVEN');
  }
}

/** Mac-side fixed invocation of the copied target tool. Never installs it or
 * kills/retries a running migration. The caller supplies the original live
 * coordinator scope check; all errors stay sanitized, including child output.
 */
export async function executeFirstCutoverRecoveryTargetTool(input, overrides = {}) {
  try {
    const { target, runtime, migrationDigest, action, projection } = structuredClone(input);
    if (
      !keys(
        input,
        action === 'verify'
          ? ['target', 'runtime', 'migrationDigest', 'action', 'projection']
          : ['target', 'runtime', 'migrationDigest', 'action'],
      ) ||
      !targetValid(target) ||
      !keys(runtime, ['manifestDigest', 'nodeDigest', 'toolDigest']) ||
      !Object.values(runtime).every(hash) ||
      !hash(migrationDigest) ||
      !['snapshot', 'migrate', 'verify'].includes(action) ||
      (action === 'verify' && (!Array.isArray(projection) || projection.length === 0)) ||
      typeof overrides.assertScope !== 'function'
    )
      throw new Error('input');
    const run = overrides.execFile ?? promisify(execFile);
    const inspect = overrides.inspectTarget ?? inspectFirstCutoverRecoveryTarget;
    const guard = async () => {
      await overrides.assertScope();
      if (!isDeepStrictEqual(await inspect(target, { requireEmpty: false }), target.identity))
        throw new Error('identity');
      const expected = `${runtime.nodeDigest}  /opt/holaday-recovery/node\n${runtime.toolDigest}  /opt/holaday-recovery/recovery-tool.mjs\n${runtime.manifestDigest}  /opt/holaday-recovery/runtime.json\n`;
      const observed = await run(
        'docker',
        [
          'exec',
          '--user',
          '0',
          target.containerId,
          '/usr/bin/sha256sum',
          '/opt/holaday-recovery/node',
          '/opt/holaday-recovery/recovery-tool.mjs',
          '/opt/holaday-recovery/runtime.json',
        ],
        { encoding: 'utf8', maxBuffer: 4096, timeout: 15000 },
      );
      if (observed.stdout !== expected) throw new Error('runtime');
      await overrides.assertScope();
    };
    await guard();
    const child = (overrides.spawn ?? spawn)(
      'docker',
      [
        'exec',
        '-i',
        '--user',
        '0',
        target.containerId,
        '/usr/bin/env',
        '-i',
        '/opt/holaday-recovery/node',
        '/opt/holaday-recovery/recovery-tool.mjs',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const chunks = [];
    let bytes = 0;
    let invalid = false;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) invalid = true;
      else chunks.push(chunk);
    });
    child.stderr.on('data', () => {
      invalid = true;
    });
    child.stdin.on('error', () => {
      invalid = true;
    });
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    child.stdin.end(
      JSON.stringify({
        identity: target.identity,
        runtimeDigest: runtime.manifestDigest,
        migrationDigest,
        action,
        ...(action === 'verify' ? { projection } : {}),
      }),
    );
    const { code, signal } = await exited;
    if (code !== 0 || signal || invalid) throw new Error('tool');
    const content = Buffer.concat(chunks);
    if (!Buffer.from(content.toString('utf8')).equals(content)) throw new Error('encoding');
    const result = JSON.parse(content.toString('utf8'));
    if (action === 'migrate' && !isDeepStrictEqual(result, { migrationDigest }))
      throw new Error('migration');
    if (
      action === 'verify' &&
      (!keys(result, ['schemaDigest', 'businessDigest']) || !Object.values(result).every(hash))
    )
      throw new Error('verification');
    if (
      action === 'snapshot' &&
      (!keys(result, [
        'identity',
        'objects',
        'projection',
        'schemaDigest',
        'sourceDigest',
        'businessDigest',
      ]) ||
        !isDeepStrictEqual(result.identity, target.identity) ||
        !['schemaDigest', 'sourceDigest', 'businessDigest'].every((k) => hash(result[k])) ||
        !Array.isArray(result.objects) ||
        !result.objects.length ||
        !Array.isArray(result.projection) ||
        !result.projection.length)
    )
      throw new Error('snapshot');
    await guard();
    return result;
  } catch {
    throw new Error('CUTOVER_RECOVERY_TARGET_TOOL_UNPROVEN');
  }
}

/** Actual Mac/recovery-side import. The original coordinator must supply a live
 * scope/ownership/stop check over its existing session. No uploaded receipt or
 * "restored" flag. This only imports; full comparison/migrations remain required.
 */
export async function restoreFirstCutoverAgeBackup(input, overrides = {}) {
  try {
    const request = structuredClone(input);
    if (
      !keys(request, ['transfer', 'identityFile', 'target']) ||
      !targetValid(request.target) ||
      request.target.attempt !== request.transfer?.destination?.attempt ||
      typeof overrides.assertScope !== 'function'
    )
      throw new Error('scope');
    const io = {
      inspectTarget: inspectFirstCutoverRecoveryTarget,
      pull: pullFirstCutoverAgeBackup,
      decrypt: decryptAgeBackupToFile,
      importDescriptor: async (target, fd) => {
        const child = spawn('docker', mysqlTargetArgs(target), {
          shell: false,
          stdio: [fd, 'ignore', 'ignore'],
        });
        await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(new Error('import exit')),
          );
        });
      },
      ...overrides,
    };
    const guard = async (requireEmpty) => {
      await io.assertScope();
      const actual = await io.inspectTarget(request.target, { requireEmpty });
      if (!isDeepStrictEqual(actual, request.target.identity)) throw new Error('identity');
      await io.assertScope();
    };
    await guard(true);
    const artifact = await io.pull(request.transfer);
    await guard(true);
    await io.decrypt(
      {
        ...request.transfer.destination,
        artifact,
        expectedBackupDigest: request.transfer.expectedBackupDigest,
        identityFile: request.identityFile,
      },
      async (fd) => {
        await guard(true);
        await io.importDescriptor(request.target, fd);
        await guard(false);
      },
    );
    await guard(false);
    return structuredClone(request.target.identity);
  } catch {
    throw new Error('CUTOVER_RECOVERY_IMPORT_UNPROVEN');
  }
}

/** Recovery-side transport, called with already approved source/destination
 * facilities by the site adapter. No CLI parameters select an arbitrary host,
 * no plaintext/private key crosses SSH, and no backup_verified receipt is made.
 * Production remains responsible for source stop/isolation and ownership proofs.
 */
export async function pullFirstCutoverAgeBackup(input, overrides = {}) {
  const io = {
    spawn,
    readSource: () => readFile(new URL('./browser-backup-age.mjs', import.meta.url)),
    ...overrides,
  };
  try {
    const request = structuredClone(input);
    const { source, destination, expectedBackupDigest, expectedBytes } = request;
    const validOptions = (options) =>
      keys(options, ['facility', 'directory', 'attempt']) &&
      uuid(options.attempt) &&
      typeof options.directory === 'string' &&
      isAbsolute(options.directory) &&
      keys(options.facility, [
        'executable',
        'executableDigest',
        'recipientFile',
        'recipientDigest',
      ]) &&
      ['executable', 'recipientFile'].every(
        (k) => typeof options.facility[k] === 'string' && isAbsolute(options.facility[k]),
      ) &&
      ['executableDigest', 'recipientDigest'].every((k) => hash(options.facility[k]));
    if (
      !keys(request, ['source', 'destination', 'expectedBackupDigest', 'expectedBytes']) ||
      !keys(source, ['options', 'artifact']) ||
      !validOptions(source.options) ||
      !validOptions(destination) ||
      source.options.attempt !== destination.attempt ||
      source.options.facility.recipientDigest !== destination.facility.recipientDigest ||
      !keys(source.artifact, ['reference', 'encryptionProfileDigest']) ||
      source.artifact.reference !==
        join(source.options.directory, `${source.options.attempt}.sql.age`) ||
      !hash(source.artifact.encryptionProfileDigest) ||
      !hash(expectedBackupDigest) ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes <= 0
    )
      throw new Error('binding');
    const code = Buffer.from(await io.readSource());
    if (
      code.length < 1 ||
      code.length > 1024 * 1024 ||
      !Buffer.from(code.toString('utf8')).equals(code)
    )
      throw new Error('reader');
    // Only these explicit public source fields are serialized. In particular,
    // the recovery machine's configuration or identity file is never sent.
    const remoteInput = `${code.toString('utf8')}\ntry {
  await streamAgeBackupArtifact(${JSON.stringify(source.artifact)}, ${JSON.stringify(source.options)}, ${JSON.stringify(expectedBackupDigest)}, ${expectedBytes}, process.stdout);
} catch {
  process.stderr.write('CUTOVER_BACKUP_TRANSFER_UNPROVEN\\n'); process.exitCode = 1;
}\n`;
    return await receiveAgeBackup(
      { ...destination, expectedBackupDigest, expectedBytes },
      async (sink) => {
        const child = io.spawn(
          'ssh',
          [
            '-o',
            'StrictHostKeyChecking=yes',
            '-o',
            'ForwardAgent=no',
            '-o',
            'ClearAllForwardings=yes',
            '-o',
            'ConnectTimeout=15',
            '-o',
            'ServerAliveInterval=10',
            '-o',
            'ServerAliveCountMax=2',
            '-o',
            'ProxyCommand=ssh -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ConnectTimeout=15 -W %h:%p root@47.99.169.186',
            '-T',
            'root@207.148.70.106',
            '/opt/node22/bin/node --input-type=module',
          ],
          { shell: false, stdio: ['pipe', 'pipe', 'ignore'] },
        );
        child.stdin.on('error', () => {});
        const exited = new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (status) =>
            status === 0 ? resolve() : reject(new Error('transport exit')),
          );
        });
        try {
          await Promise.all([
            exited,
            pipeline(child.stdout, sink),
            new Promise((resolve, reject) =>
              child.stdin.end(remoteInput, (error) => (error ? reject(error) : resolve())),
            ),
          ]);
        } catch (error) {
          child.stdin.destroy();
          child.stdout.destroy();
          // Only our read-only SSH client, never a database/process on the host.
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          await exited.catch(() => {});
          throw error;
        }
      },
    );
  } catch {
    throw new Error('CUTOVER_BACKUP_TRANSFER_UNPROVEN');
  }
}

/** The fixed backup stage, not a production CLI or a default success adapter.
 * Host I/O must observe identities, prove isolation, export using its approved
 * encrypted facility, restore ONLY to the isolated target, compare ALL objects
 * and data, and persist a private receipt. No booleans, retries, SQL rollback,
 * cleanup or implicit encryption/key generation substitute for those effects.
 * Missing host I/O rejects before export. Failure retains artifacts for review.
 */
export async function backupAndRestoreCheck(input, io) {
  try {
    const { binding, sourceIdentity, isolatedTarget, maintenanceEndsAtMs } = structuredClone(input);
    if (
      !keys(input, ['binding', 'sourceIdentity', 'isolatedTarget', 'maintenanceEndsAtMs']) ||
      !keys(binding, [
        'attempt',
        'candidate',
        'configDigest',
        'migrationDigest',
        'inventoryDigest',
      ]) ||
      !uuid(binding.attempt) ||
      !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
      !['configDigest', 'migrationDigest', 'inventoryDigest'].every((name) =>
        hash(binding[name]),
      ) ||
      !identityValid(sourceIdentity) ||
      !identityValid(isolatedTarget) ||
      isDeepStrictEqual(sourceIdentity, isolatedTarget) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      maintenanceEndsAtMs <= 0 ||
      ![
        'now',
        'assertOwnership',
        'assertWritersStopped',
        'readDatabaseIdentity',
        'inspectBackupFacility',
        'exportDatabase',
        'hashArtifact',
        'restoreIsolated',
        'compareInventoryAndData',
        'runApprovedMigrations',
        'verifySchema',
        'readSourceDigest',
        'sealReceipt',
      ].every((name) => typeof io?.[name] === 'function')
    )
      throw new Error('input');

    let lastTime = -1;
    let facility;
    const clock = () => {
      const now = io.now();
      if (!Number.isSafeInteger(now) || now < 0 || now < lastTime || now >= maintenanceEndsAtMs)
        throw new Error('window');
      lastTime = now;
      return now;
    };
    const context = { binding, sourceIdentity, isolatedTarget, maintenanceEndsAtMs };
    const guard = async () => {
      clock();
      if (!isDeepStrictEqual(await io.assertOwnership(), binding)) throw new Error('ownership');
      await io.assertWritersStopped(structuredClone(context));
      for (const identity of [sourceIdentity, isolatedTarget]) {
        const actual = await io.readDatabaseIdentity(structuredClone(identity));
        if (!isDeepStrictEqual(actual, identity)) throw new Error('database identity');
      }
      const observed = await io.inspectBackupFacility(structuredClone(context));
      if (
        !keys(observed, ['encryptionProfileDigest']) ||
        !hash(observed.encryptionProfileDigest) ||
        (facility && !isDeepStrictEqual(facility, observed))
      )
        throw new Error('facility');
      facility = structuredClone(observed);
      clock(); // Asynchronous checks may have crossed the deadline.
    };
    await guard();
    const artifact = structuredClone(
      await io.exportDatabase(
        structuredClone(sourceIdentity),
        structuredClone({ binding, facility }),
      ),
    );
    if (
      !keys(artifact, ['reference', 'encryptionProfileDigest']) ||
      typeof artifact.reference !== 'string' ||
      !artifact.reference ||
      artifact.reference.length > 4096 ||
      artifact.encryptionProfileDigest !== facility.encryptionProfileDigest
    )
      throw new Error('artifact');
    await guard();
    const backupDigest = await io.hashArtifact(structuredClone(artifact));
    if (!hash(backupDigest)) throw new Error('digest');
    const unchangedArtifact = async () => {
      if ((await io.hashArtifact(structuredClone(artifact))) !== backupDigest)
        throw new Error('artifact changed');
      await guard();
    };
    await unchangedArtifact();
    await io.restoreIsolated(structuredClone(artifact), structuredClone(isolatedTarget));
    await unchangedArtifact();
    const comparison = structuredClone(await io.compareInventoryAndData(structuredClone(context)));
    if (
      !keys(comparison, ['comparisonDigest', 'sourceDigest', 'businessDigest']) ||
      !Object.values(comparison).every(hash)
    )
      throw new Error('comparison');
    await guard();
    await io.runApprovedMigrations(structuredClone(isolatedTarget), binding.migrationDigest);
    await unchangedArtifact();
    const verified = await io.verifySchema(structuredClone(isolatedTarget));
    if (
      !keys(verified, ['schemaDigest', 'businessDigest']) ||
      !hash(verified.schemaDigest) ||
      verified.businessDigest !== comparison.businessDigest
    )
      throw new Error('business drift');
    if ((await io.readSourceDigest(structuredClone(sourceIdentity))) !== comparison.sourceDigest)
      throw new Error('source changed');
    await unchangedArtifact();
    const receipt = {
      ...binding,
      backupDigest,
      databaseIdentityDigest: digest(sourceIdentity),
      isolatedTargetDigest: digest(isolatedTarget),
      encryptionProfileDigest: facility.encryptionProfileDigest,
      comparisonDigest: comparison.comparisonDigest,
      schemaDigest: verified.schemaDigest,
      businessDigest: comparison.businessDigest,
      restoredAtMs: clock(),
    };
    const sealed = await io.sealReceipt(structuredClone(receipt));
    if (!isDeepStrictEqual(sealed, receipt)) throw new Error('receipt');
    await guard();
    return receipt;
  } catch {
    throw new Error('CUTOVER_BACKUP_UNPROVEN');
  }
}
