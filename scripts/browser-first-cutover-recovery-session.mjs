import { ingressDiagnosticError } from './browser-first-cutover-ingress-diagnostics.mjs';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  executeFirstCutoverRecoveryTargetTool,
  inspectFirstCutoverRecoveryTarget,
  restoreFirstCutoverAgeBackup,
} from './browser-first-cutover-backup.mjs';
import { createFirstCutoverSessionWire } from './browser-first-cutover-ingress-session.mjs';

const fail = (stage, previous) => {
  throw ingressDiagnosticError('CUTOVER_RECOVERY_SESSION_UNPROVEN', stage, previous);
};
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const keys = (v, names) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  equal(Object.keys(v).sort(), [...names].sort());
const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
const identity = (v) =>
  keys(v, ['serverUuid', 'database']) &&
  typeof v.serverUuid === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.serverUuid) &&
  /^[a-zA-Z0-9_]{1,64}$/.test(v.database);
const absolute = (v) => typeof v === 'string' && isAbsolute(v) && !/[\r\n\0]/.test(v);
function resultValid(name, value, approved) {
  if (name === 'snapshot')
    return (
      keys(value, [
        'identity',
        'objects',
        'projection',
        'schemaDigest',
        'sourceDigest',
        'businessDigest',
      ]) &&
      equal(value.identity, approved.isolatedTarget) &&
      ['schemaDigest', 'sourceDigest', 'businessDigest'].every((k) => hash(value[k])) &&
      Array.isArray(value.objects) &&
      value.objects.length > 0 &&
      Array.isArray(value.projection) &&
      value.projection.length > 0
    );
  if (name === 'migrate')
    return equal(value, { migrationDigest: approved.binding.migrationDigest });
  if (name === 'verify')
    return keys(value, ['schemaDigest', 'businessDigest']) && Object.values(value).every(hash);
  return equal(
    value,
    name === 'attach' ? approved : name === 'detach' ? null : approved.isolatedTarget,
  );
}
function publicValid(v, now) {
  if (
    !keys(v, [
      'binding',
      'maintenanceEndsAtMs',
      'scopeDigest',
      'sourceIdentity',
      'isolatedTarget',
    ]) ||
    !keys(v.binding, bindingKeys) ||
    !uuid(v.binding.attempt) ||
    !/^[a-f0-9]{40}$/.test(v.binding.candidate) ||
    !bindingKeys.slice(2).every((k) => hash(v.binding[k])) ||
    !hash(v.scopeDigest) ||
    !identity(v.sourceIdentity) ||
    !identity(v.isolatedTarget) ||
    v.sourceIdentity.serverUuid === v.isolatedTarget.serverUuid ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(v.maintenanceEndsAtMs) ||
    now >= v.maintenanceEndsAtMs
  )
    fail();
}
const publicScope = (scope, scopeDigest) => ({
  binding: scope.binding,
  maintenanceEndsAtMs: scope.maintenanceEndsAtMs,
  scopeDigest,
  sourceIdentity: scope.sourceIdentity,
  isolatedTarget: scope.target.identity,
});
function optionsValid(v, attempt) {
  if (
    !keys(v, ['facility', 'directory', 'attempt']) ||
    v.attempt !== attempt ||
    !absolute(v.directory) ||
    !keys(v.facility, ['executable', 'executableDigest', 'recipientFile', 'recipientDigest']) ||
    !absolute(v.facility.executable) ||
    !absolute(v.facility.recipientFile) ||
    !hash(v.facility.executableDigest) ||
    !hash(v.facility.recipientDigest)
  )
    fail();
}

/** Local Mac custody metadata. No discovery, secret reading or approval creation.
 * Caller supplies the reviewed digest; observing this file does not approve it.
 */
export async function readFirstCutoverRecoveryScope(request) {
  let handle;
  let stage = 'RECOVERY_SCOPE_ENTRY';
  try {
    if (
      !keys(request, ['directory', 'attempt', 'scopeDigest']) ||
      !absolute(request.directory) ||
      !uuid(request.attempt) ||
      !hash(request.scopeDigest)
    )
      fail();
    const directory = request.directory;
    const path = join(directory, `first-cutover-${request.attempt}.json`);
    const privateDir = (s) =>
      s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o7777) === 0o700;
    const privateFile = (s) =>
      s.isFile() &&
      s.uid === process.getuid() &&
      (s.mode & 0o7777) === 0o600 &&
      s.nlink === 1 &&
      s.size > 0 &&
      s.size <= 1024 * 1024;
    stage = 'RECOVERY_SCOPE_FOLDER';
    const beforeDirectory = await fs.lstat(directory);
    if (!privateDir(beforeDirectory) || (await fs.realpath(directory)) !== directory) fail();
    stage = 'RECOVERY_SCOPE_FILE';
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!privateFile(before)) fail();
    stage = 'RECOVERY_SCOPE_CONTENT';
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await fs.lstat(path);
    const currentDirectory = await fs.lstat(directory);
    if (
      !privateFile(after) ||
      !privateFile(current) ||
      !privateDir(currentDirectory) ||
      (await fs.realpath(directory)) !== directory ||
      ['dev', 'ino'].some((k) => beforeDirectory[k] !== currentDirectory[k]) ||
      ['dev', 'ino', 'size', 'uid', 'gid', 'mode', 'nlink', 'mtimeMs', 'ctimeMs'].some(
        (k) => before[k] !== after[k] || after[k] !== current[k],
      ) ||
      bytes.length !== before.size ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
      createHash('sha256').update(bytes).digest('hex') !== request.scopeDigest
    )
      fail();
    stage = 'RECOVERY_SCOPE_SHAPE';
    const scope = JSON.parse(bytes.toString('utf8'));
    if (
      !keys(scope, [
        'schemaVersion',
        'binding',
        'maintenanceEndsAtMs',
        'sourceOptions',
        'sourceIdentity',
        'destination',
        'identityFile',
        'target',
        ...(Object.hasOwn(scope, 'runtime') ? ['runtime'] : []),
      ]) ||
      scope.schemaVersion !== 1 ||
      scope.binding?.attempt !== request.attempt ||
      !absolute(scope.identityFile)
    )
      fail();
    stage = 'RECOVERY_SCOPE_RUNTIME';
    if (
      Object.hasOwn(scope, 'runtime') &&
      (!keys(scope.runtime, ['manifestDigest', 'nodeDigest', 'toolDigest']) ||
        !Object.values(scope.runtime).every(hash))
    )
      fail();
    stage = 'RECOVERY_SCOPE_TARGET';
    const target = scope.target;
    if (
      !keys(target, ['containerId', 'imageId', 'volume', 'attempt', 'identity']) ||
      !hash(target.containerId) ||
      !/^sha256:[a-f0-9]{64}$/.test(target.imageId) ||
      target.attempt !== request.attempt ||
      target.volume !== `holaday-cutover-restore-${request.attempt}`
    )
      fail();
    stage = 'RECOVERY_SCOPE_PUBLIC';
    publicValid(publicScope(scope, request.scopeDigest), Date.now());
    stage = 'RECOVERY_SCOPE_SOURCE_OPTIONS';
    optionsValid(scope.sourceOptions, request.attempt);
    stage = 'RECOVERY_SCOPE_DESTINATION_OPTIONS';
    optionsValid(scope.destination, request.attempt);
    stage = 'RECOVERY_SCOPE_RECIPIENT';
    if (scope.sourceOptions.facility.recipientDigest !== scope.destination.facility.recipientDigest)
      fail();
    return scope;
  } catch (error) {
    fail(stage, error);
  } finally {
    await handle?.close();
  }
}

/** Mac parent side of the EXISTING coordinator SSH pipes. Its local private
 * scope is never serialized. This endpoint does not launch SSH or a coordinator.
 * Final restore/migration evidence is still the original backup stage's job.
 */
export async function serveFirstCutoverRecoverySession(request, overrides = {}) {
  const io = {
    now: Date.now,
    readScope: readFirstCutoverRecoveryScope,
    inspectTarget: inspectFirstCutoverRecoveryTarget,
    restore: restoreFirstCutoverAgeBackup,
    executeTool: executeFirstCutoverRecoveryTargetTool,
    ...overrides,
  };
  let channel;
  let stage = 'RECOVERY_SERVER_ENTRY';
  try {
    stage = 'RECOVERY_SERVER_SCOPE_READ';
    const scope = structuredClone(await io.readScope(request));
    const approved = publicScope(scope, request.scopeDigest);
    stage = 'RECOVERY_SERVER_PUBLIC';
    publicValid(approved, io.now());
    channel = createFirstCutoverSessionWire(io.input, io.output, scope.maintenanceEndsAtMs, io.now);
    const guardLocal = async () => {
      channel.assert();
      stage = 'RECOVERY_SERVER_SCOPE_RECHECK';
      if (!equal(await io.readScope(request), scope)) fail();
      stage = 'RECOVERY_SERVER_PUBLIC';
      publicValid(approved, io.now());
    };
    let sequence = 0;
    let attempted = false;
    let restored = false;
    let snapshot;
    let migrationAttempted = false;
    let migrated = false;
    for (;;) {
      stage = 'RECOVERY_SERVER_READ';
      const message = await channel.read();
      stage = 'RECOVERY_SERVER_ENVELOPE';
      const seq = ++sequence;
      if (
        !keys(message, ['protocol', 'type', 'seq', 'name', 'value']) ||
        message.protocol !== 1 ||
        message.type !== 'operation' ||
        message.seq !== seq ||
        !['attach', 'inspect', 'restore', 'snapshot', 'migrate', 'verify', 'detach'].includes(
          message.name,
        ) ||
        (seq === 1 ? message.name !== 'attach' : message.name === 'attach')
      )
        fail();
      await guardLocal();
      let scopeSeq = 0;
      const assertScope = async () => {
        await guardLocal();
        const check = ++scopeSeq;
        stage = 'RECOVERY_SERVER_SCOPE_SEND';
        await channel.write({
          protocol: 1,
          type: 'scope',
          seq,
          scopeSeq: check,
          binding: approved.binding,
        });
        stage = 'RECOVERY_SERVER_SCOPE_READ_ANSWER';
        const answer = await channel.read();
        stage = 'RECOVERY_SERVER_SCOPE_ANSWER';
        if (
          !keys(answer, ['protocol', 'type', 'seq', 'scopeSeq', 'binding']) ||
          answer.protocol !== 1 ||
          answer.type !== 'scope-result' ||
          answer.seq !== seq ||
          answer.scopeSeq !== check ||
          !equal(answer.binding, approved.binding)
        )
          fail();
        await guardLocal();
      };
      let value;
      if (message.name === 'attach') {
        stage = 'RECOVERY_SERVER_ATTACH_VALUE';
        if (!equal(message.value, approved)) fail();
        await assertScope();
        value = approved;
      } else if (message.name === 'detach') {
        if (message.value !== null) fail();
        value = null;
      } else if (['snapshot', 'migrate', 'verify'].includes(message.name)) {
        if (message.value !== null || !restored || !scope.runtime) fail();
        if (message.name === 'snapshot' && (snapshot || migrationAttempted)) fail();
        if (message.name === 'migrate') {
          if (!snapshot || migrationAttempted) fail();
          migrationAttempted = true;
        }
        if (message.name === 'verify' && !migrated) fail();
        await assertScope();
        value = await io.executeTool(
          {
            target: scope.target,
            runtime: scope.runtime,
            migrationDigest: scope.binding.migrationDigest,
            action: message.name,
            ...(message.name === 'verify' ? { projection: snapshot.projection } : {}),
          },
          { assertScope },
        );
        if (!resultValid(message.name, value, approved)) fail();
        if (message.name === 'snapshot') snapshot = structuredClone(value);
        if (message.name === 'migrate') migrated = true;
        if (message.name === 'verify' && value.businessDigest !== snapshot.businessDigest) fail();
        await assertScope();
      } else {
        await assertScope();
        if (message.name === 'inspect') {
          if (message.value !== null) fail();
          value = await io.inspectTarget(scope.target, { requireEmpty: !restored });
        } else {
          if (attempted) fail();
          attempted = true; // Failed or uncertain imports are never replayed.
          const v = message.value;
          if (
            !keys(v, ['artifact', 'expectedBackupDigest', 'expectedBytes']) ||
            !keys(v.artifact, ['reference', 'encryptionProfileDigest']) ||
            !hash(v.artifact.encryptionProfileDigest) ||
            v.artifact.reference !==
              join(scope.sourceOptions.directory, `${scope.binding.attempt}.sql.age`) ||
            !hash(v.expectedBackupDigest) ||
            !Number.isSafeInteger(v.expectedBytes) ||
            v.expectedBytes <= 0
          )
            fail();
          value = await io.restore(
            {
              transfer: {
                source: { options: scope.sourceOptions, artifact: v.artifact },
                destination: scope.destination,
                expectedBackupDigest: v.expectedBackupDigest,
                expectedBytes: v.expectedBytes,
              },
              identityFile: scope.identityFile,
              target: scope.target,
            },
            { assertScope },
          );
          restored = true;
        }
        if (!equal(value, scope.target.identity)) fail();
        await assertScope();
      }
      await guardLocal();
      stage = 'RECOVERY_SERVER_RESULT';
      await channel.write({ protocol: 1, type: 'result', seq, value });
      if (message.name === 'detach') {
        // Do not let the owning Mac process close coordinator stdin while its
        // final async journal/fence check is still pending after the result.
        const acknowledgment = await channel.read();
        if (!equal(acknowledgment, { protocol: 1, type: 'detached', seq })) fail();
        return;
      }
    }
  } catch (error) {
    channel?.close();
    fail(stage, error);
  }
}

/** Vultr side of the same original coordinator connection. assertScope must
 * check its own live journal AND physical stopped facts, not a remote boolean.
 */
export async function connectFirstCutoverRecoverySession(input, overrides = {}) {
  const io = { now: Date.now, ...overrides };
  let channel;
  let stage = 'RECOVERY_CLIENT_ENTRY';
  try {
    const approved = structuredClone(input);
    publicValid(approved, io.now());
    if (typeof io.assertScope !== 'function') fail();
    channel = createFirstCutoverSessionWire(
      io.input,
      io.output,
      approved.maintenanceEndsAtMs,
      io.now,
    );
    let sequence = 0;
    let active = false;
    let failed = false;
    let closed = false;
    let attempted = false;
    const operation = async (name, value) => {
      try {
        if (active || failed || closed) fail();
        active = true;
        publicValid(approved, io.now());
        stage = 'RECOVERY_CLIENT_SCOPE_INITIAL';
        await io.assertScope();
        const seq = ++sequence;
        stage = 'RECOVERY_CLIENT_SEND';
        await channel.write({ protocol: 1, type: 'operation', seq, name, value });
        let scopeSeq = 0;
        for (;;) {
          stage = 'RECOVERY_CLIENT_READ';
          const answer = await channel.read();
          stage = 'RECOVERY_CLIENT_ENVELOPE';
          if (answer?.protocol !== 1 || answer.seq !== seq) fail();
          if (answer.type === 'scope') {
            stage = 'RECOVERY_CLIENT_SCOPE_MESSAGE';
            if (
              !keys(answer, ['protocol', 'type', 'seq', 'scopeSeq', 'binding']) ||
              answer.scopeSeq !== ++scopeSeq ||
              !equal(answer.binding, approved.binding)
            )
              fail();
            stage = 'RECOVERY_CLIENT_SCOPE_CHECK';
            await io.assertScope();
            channel.assert();
            stage = 'RECOVERY_CLIENT_SCOPE_SEND';
            await channel.write({
              protocol: 1,
              type: 'scope-result',
              seq,
              scopeSeq,
              binding: approved.binding,
            });
            continue;
          }
          stage = 'RECOVERY_CLIENT_RESULT';
          if (
            !keys(answer, ['protocol', 'type', 'seq', 'value']) ||
            answer.type !== 'result' ||
            !resultValid(name, answer.value, approved)
          )
            fail();
          stage = 'RECOVERY_CLIENT_SCOPE_FINAL';
          await io.assertScope();
          channel.assert();
          return structuredClone(answer.value);
        }
      } catch (error) {
        failed = true;
        channel.close();
        fail(stage, error);
      } finally {
        active = false;
      }
    };
    await operation('attach', approved);
    return {
      inspect: () => operation('inspect', null),
      snapshot: () => operation('snapshot', null),
      migrate: () => operation('migrate', null),
      verify: () => operation('verify', null),
      restore: async (value) => {
        if (attempted) {
          failed = true;
          channel.close();
          fail();
        }
        attempted = true;
        return operation('restore', structuredClone(value));
      },
      close: async () => {
        await operation('detach', null);
        await channel.write({ protocol: 1, type: 'detached', seq: sequence });
        closed = true;
        channel.close();
      },
    };
  } catch (error) {
    channel?.close();
    fail(stage, error);
  }
}
