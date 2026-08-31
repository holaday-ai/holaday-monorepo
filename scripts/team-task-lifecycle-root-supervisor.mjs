import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  closeSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_SUPERVISOR_MARKER = 'holaday-team-task-lifecycle-root-supervisor-v1\n';
export const ROOT_SUPERVISOR_CONSUMED_MARKER =
  'holaday-team-task-lifecycle-consumed-authorization-v1\n';
const MAX_RECEIPT_BYTES = 32 * 1024;
const RECEIPT_SOURCE = 'holaday-team-task-lifecycle-qa-v1';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function receiptAuthorizationDigest(contents) {
  let receipt;
  try {
    receipt = JSON.parse(contents.toString('utf8'));
  } catch {
    throw new Error('invalid prepare receipt');
  }
  if (
    !isRecord(receipt) ||
    receipt.schemaVersion !== 1 ||
    receipt.source !== RECEIPT_SOURCE ||
    receipt.receiptKind !== 'prepare' ||
    typeof receipt.revision !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(receipt.revision) ||
    typeof receipt.boundaryDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(receipt.boundaryDigest)
  ) {
    throw new Error('invalid prepare receipt');
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: receipt.schemaVersion,
        source: receipt.source,
        receiptKind: receipt.receiptKind,
        revision: receipt.revision,
        boundaryDigest: receipt.boundaryDigest,
      }),
    )
    .digest('hex');
}

function restrictedDirectory(path, ownerUid, mode) {
  const metadata = lstatSync(path);
  return (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    metadata.uid === ownerUid &&
    (metadata.mode & 0o777) === mode
  );
}

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function claimLifecycleCanaryPrepareReceipt({
  receiptPath,
  supervisorDirectory,
  expectedReceiptOwnerUid = 998,
  expectedSupervisorOwnerUid = 0,
  expectedSupervisorOwnerGid = 0,
}) {
  if (
    !isAbsolute(receiptPath) ||
    !isAbsolute(supervisorDirectory) ||
    receiptPath === '/' ||
    supervisorDirectory === '/'
  ) {
    throw new Error('invalid root supervisor path');
  }
  const resolvedReceiptPath = resolve(receiptPath);
  const resolvedSupervisorDirectory = resolve(supervisorDirectory);
  const receiptDirectory = dirname(resolvedReceiptPath);
  if (!restrictedDirectory(receiptDirectory, expectedReceiptOwnerUid, 0o700)) {
    throw new Error('invalid receipt directory');
  }
  if (!restrictedDirectory(resolvedSupervisorDirectory, expectedSupervisorOwnerUid, 0o700)) {
    throw new Error('invalid supervisor directory');
  }

  const sourceFd = openSync(resolvedReceiptPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let claimedPath = null;
  try {
    const source = fstatSync(sourceFd);
    if (
      !source.isFile() ||
      source.isSymbolicLink() ||
      source.uid !== expectedReceiptOwnerUid ||
      (source.mode & 0o777) !== 0o600 ||
      source.nlink !== 1 ||
      source.size < 2 ||
      source.size > MAX_RECEIPT_BYTES
    ) {
      throw new Error('invalid prepare receipt');
    }
    const contents = readFileSync(sourceFd);
    const authorizationDigest = receiptAuthorizationDigest(contents);
    const current = lstatSync(resolvedReceiptPath);
    if (
      current.dev !== source.dev ||
      current.ino !== source.ino ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1
    ) {
      throw new Error('prepare receipt changed while claiming');
    }

    const consumedPath = join(resolvedSupervisorDirectory, `consumed.${authorizationDigest}`);
    let consumedFd;
    try {
      consumedFd = openSync(
        consumedPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
    } catch (error) {
      if (isRecord(error) && error.code === 'EEXIST') {
        throw new Error('prepare receipt already consumed');
      }
      throw error;
    }
    try {
      fchownSync(consumedFd, expectedSupervisorOwnerUid, expectedSupervisorOwnerGid);
      fchmodSync(consumedFd, 0o600);
      writeFileSync(consumedFd, ROOT_SUPERVISOR_CONSUMED_MARKER);
      fsyncSync(consumedFd);
    } finally {
      closeSync(consumedFd);
    }
    syncDirectory(resolvedSupervisorDirectory);

    claimedPath = join(resolvedSupervisorDirectory, `claimed.${randomBytes(16).toString('hex')}`);
    const claimedFd = openSync(
      claimedPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      fchownSync(claimedFd, expectedSupervisorOwnerUid, expectedSupervisorOwnerGid);
      fchmodSync(claimedFd, 0o600);
      writeFileSync(claimedFd, ROOT_SUPERVISOR_MARKER);
      writeFileSync(claimedFd, contents);
      fsyncSync(claimedFd);
    } finally {
      closeSync(claimedFd);
    }

    unlinkSync(resolvedReceiptPath);
    syncDirectory(receiptDirectory);
    syncDirectory(resolvedSupervisorDirectory);
    return claimedPath;
  } catch (error) {
    if (claimedPath) {
      try {
        unlinkSync(claimedPath);
      } catch {
        // The claim either never became visible or has already been removed.
      }
      try {
        syncDirectory(resolvedSupervisorDirectory);
      } catch {
        // The durable consumed marker remains fail-closed even if cleanup sync fails.
      }
    }
    throw error;
  } finally {
    closeSync(sourceFd);
  }
}

export function removeLifecycleCanaryClaim({
  claimedPath,
  supervisorDirectory,
  expectedSupervisorOwnerUid = 0,
}) {
  if (
    !isAbsolute(claimedPath) ||
    !isAbsolute(supervisorDirectory) ||
    claimedPath === '/' ||
    supervisorDirectory === '/'
  ) {
    throw new Error('invalid root supervisor path');
  }
  const resolvedClaimedPath = resolve(claimedPath);
  const resolvedSupervisorDirectory = resolve(supervisorDirectory);
  if (
    dirname(resolvedClaimedPath) !== resolvedSupervisorDirectory ||
    !resolvedClaimedPath.startsWith(join(resolvedSupervisorDirectory, 'claimed.')) ||
    !restrictedDirectory(resolvedSupervisorDirectory, expectedSupervisorOwnerUid, 0o700)
  ) {
    throw new Error('invalid root supervisor claim');
  }
  const metadata = lstatSync(resolvedClaimedPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== expectedSupervisorOwnerUid ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.nlink !== 1
  ) {
    throw new Error('invalid root supervisor claim');
  }
  unlinkSync(resolvedClaimedPath);
  syncDirectory(resolvedSupervisorDirectory);
}

export function parseLinuxProcessRecord(statContents, expectedPid) {
  if (!Number.isSafeInteger(expectedPid) || expectedPid < 2) {
    throw new Error('invalid canary process');
  }
  const closingParenthesis = statContents.lastIndexOf(')');
  if (closingParenthesis < 2) throw new Error('invalid canary process identity');
  const recordedPid = Number(statContents.slice(0, statContents.indexOf(' ')));
  const fields = statContents
    .slice(closingParenthesis + 2)
    .trim()
    .split(/\s+/u);
  const state = fields[0];
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  const startTimeTicks = fields[19];
  if (
    recordedPid !== expectedPid ||
    typeof state !== 'string' ||
    !/^[A-Za-z]$/u.test(state) ||
    !Number.isSafeInteger(parentPid) ||
    parentPid < 0 ||
    !Number.isSafeInteger(processGroupId) ||
    processGroupId < 1 ||
    !Number.isSafeInteger(sessionId) ||
    sessionId < 1 ||
    typeof startTimeTicks !== 'string' ||
    !/^[0-9]+$/u.test(startTimeTicks)
  ) {
    throw new Error('invalid canary process identity');
  }
  return { pid: expectedPid, state, parentPid, processGroupId, sessionId, startTimeTicks };
}

function formatCanaryProcessIdentity(record) {
  return `${record.pid}:${record.processGroupId}:${record.sessionId}:${record.startTimeTicks}`;
}

function parseCanaryProcessIdentity(identity) {
  const match = /^(\d+):(\d+):(\d+):(\d+)$/u.exec(identity);
  if (!match) throw new Error('invalid canary process identity');
  const pid = Number(match[1]);
  const processGroupId = Number(match[2]);
  const sessionId = Number(match[3]);
  if (!Number.isSafeInteger(pid) || pid < 2 || processGroupId !== pid || sessionId !== pid) {
    throw new Error('invalid canary process identity');
  }
  return { pid, processGroupId, sessionId, startTimeTicks: match[4] };
}

export function parseLinuxProcessIdentity(statContents, expectedPid) {
  const record = parseLinuxProcessRecord(statContents, expectedPid);
  if (record.processGroupId !== expectedPid || record.sessionId !== expectedPid) {
    throw new Error('invalid canary process identity');
  }
  return formatCanaryProcessIdentity(record);
}

export function discoverLifecycleCanaryChildIdentityFromProc({
  supervisorPid,
  childrenContents,
  childStatContents,
}) {
  if (!Number.isSafeInteger(supervisorPid) || supervisorPid < 2) {
    throw new Error('invalid canary supervisor');
  }
  const childPids = childrenContents.trim().split(/\s+/u).filter(Boolean);
  if (childPids.length !== 1 || !/^[1-9][0-9]*$/u.test(childPids[0])) {
    throw new Error('invalid canary supervisor children');
  }
  const childPid = Number(childPids[0]);
  const child = parseLinuxProcessRecord(childStatContents, childPid);
  if (
    child.parentPid !== supervisorPid ||
    child.processGroupId !== childPid ||
    child.sessionId !== childPid
  ) {
    throw new Error('invalid canary supervisor child');
  }
  return formatCanaryProcessIdentity(child);
}

export function lifecycleCanaryProcessGroupStateFromProc(identity, statContentsList) {
  const expected = parseCanaryProcessIdentity(identity);
  let active = false;
  for (const statContents of statContentsList) {
    const closingParenthesis = statContents.lastIndexOf(')');
    const firstSpace = statContents.indexOf(' ');
    if (closingParenthesis < 2 || firstSpace < 1) continue;
    const pid = Number(statContents.slice(0, firstSpace));
    if (!Number.isSafeInteger(pid) || pid < 2) continue;
    let processRecord;
    try {
      processRecord = parseLinuxProcessRecord(statContents, pid);
    } catch {
      continue;
    }
    if (processRecord.pid === expected.pid) {
      if (
        processRecord.startTimeTicks !== expected.startTimeTicks ||
        processRecord.processGroupId !== expected.processGroupId ||
        processRecord.sessionId !== expected.sessionId
      ) {
        return 'reused';
      }
    }
    if (
      processRecord.processGroupId === expected.processGroupId &&
      processRecord.sessionId === expected.sessionId
    ) {
      active = true;
    }
  }
  return active ? 'active' : 'empty';
}

function readProcStatContents() {
  const statContents = [];
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[1-9][0-9]*$/u.test(entry.name)) continue;
    try {
      statContents.push(readFileSync(`/proc/${entry.name}/stat`, 'utf8'));
    } catch {
      // Processes may disappear while /proc is enumerated.
    }
  }
  return statContents;
}

export function discoverLifecycleCanaryChildIdentity(supervisorPid) {
  if (process.platform !== 'linux') throw new Error('canary child discovery requires Linux');
  const childrenContents = readFileSync(
    `/proc/${supervisorPid}/task/${supervisorPid}/children`,
    'utf8',
  );
  const childPid = Number(childrenContents.trim());
  return discoverLifecycleCanaryChildIdentityFromProc({
    supervisorPid,
    childrenContents,
    childStatContents: readFileSync(`/proc/${childPid}/stat`, 'utf8'),
  });
}

export function readLifecycleCanaryProcessGroupState(identity) {
  if (process.platform !== 'linux') throw new Error('canary group state requires Linux');
  return lifecycleCanaryProcessGroupStateFromProc(identity, readProcStatContents());
}

export function readLifecycleSupervisorIdentity(pid) {
  if (process.platform !== 'linux') throw new Error('canary supervisor identity requires Linux');
  const record = parseLinuxProcessRecord(readFileSync(`/proc/${pid}/stat`, 'utf8'), pid);
  return `${record.pid}:${record.startTimeTicks}`;
}

function parseSupervisorIdentity(identity) {
  const match = /^(\d+):(\d+)$/u.exec(identity);
  if (!match) throw new Error('invalid canary supervisor identity');
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid < 2) {
    throw new Error('invalid canary supervisor identity');
  }
  return { pid, startTimeTicks: match[2] };
}

export function abortLifecycleCanaryStart(identity) {
  if (process.platform !== 'linux') throw new Error('canary start abort requires Linux');
  const expected = parseSupervisorIdentity(identity);
  if (readLifecycleSupervisorIdentity(expected.pid) !== identity) {
    throw new Error('canary supervisor identity changed');
  }
  process.kill(expected.pid, 'SIGSTOP');
  if (readLifecycleSupervisorIdentity(expected.pid) !== identity) {
    throw new Error('canary supervisor identity changed');
  }

  const childIdentities = [];
  const childrenContents = readFileSync(
    `/proc/${expected.pid}/task/${expected.pid}/children`,
    'utf8',
  );
  const childPids = childrenContents.trim().split(/\s+/u).filter(Boolean);
  let abortError = null;
  try {
    for (const childPidText of childPids) {
      try {
        if (!/^[1-9][0-9]*$/u.test(childPidText)) {
          throw new Error('invalid canary supervisor child');
        }
        const childPid = Number(childPidText);
        const child = parseLinuxProcessRecord(
          readFileSync(`/proc/${childPid}/stat`, 'utf8'),
          childPid,
        );
        if (child.parentPid !== expected.pid) throw new Error('invalid canary supervisor child');
        if (child.processGroupId === child.pid && child.sessionId === child.pid) {
          childIdentities.push(formatCanaryProcessIdentity(child));
          process.kill(-child.pid, 'SIGKILL');
        } else {
          process.kill(child.pid, 'SIGKILL');
        }
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ESRCH') abortError ??= error;
      }
    }
    if (childPids.length > 1) {
      abortError ??= new Error('invalid canary supervisor children');
    }
  } finally {
    try {
      process.kill(expected.pid, 'SIGKILL');
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ESRCH') abortError ??= error;
    }
  }
  if (abortError) throw abortError;
  return childIdentities[0] ?? '';
}

export function readLifecycleCanaryProcessIdentity(pid) {
  if (process.platform !== 'linux') throw new Error('canary process identity requires Linux');
  return parseLinuxProcessIdentity(readFileSync(`/proc/${pid}/stat`, 'utf8'), pid);
}

async function main() {
  if (process.getuid?.() !== 0) {
    throw new Error('root supervisor helper requires root');
  }
  if (process.argv[2] === 'claim' && process.argv.length === 6) {
    const expectedReceiptOwnerUid = Number(process.argv[5]);
    if (!Number.isSafeInteger(expectedReceiptOwnerUid) || expectedReceiptOwnerUid < 0) {
      throw new Error('invalid receipt owner');
    }
    const claimedPath = claimLifecycleCanaryPrepareReceipt({
      receiptPath: process.argv[3],
      supervisorDirectory: process.argv[4],
      expectedReceiptOwnerUid,
    });
    process.stdout.write(`${claimedPath}\n`);
    return;
  }
  if (process.argv[2] === 'remove' && process.argv.length === 5) {
    removeLifecycleCanaryClaim({
      claimedPath: process.argv[3],
      supervisorDirectory: process.argv[4],
    });
    return;
  }
  if (process.argv[2] === 'identity' && process.argv.length === 4) {
    const pid = Number(process.argv[3]);
    process.stdout.write(`${readLifecycleCanaryProcessIdentity(pid)}\n`);
    return;
  }
  if (process.argv[2] === 'supervisor-identity' && process.argv.length === 4) {
    const pid = Number(process.argv[3]);
    process.stdout.write(`${readLifecycleSupervisorIdentity(pid)}\n`);
    return;
  }
  if (process.argv[2] === 'discover-child' && process.argv.length === 4) {
    const supervisorPid = Number(process.argv[3]);
    process.stdout.write(`${discoverLifecycleCanaryChildIdentity(supervisorPid)}\n`);
    return;
  }
  if (process.argv[2] === 'group-state' && process.argv.length === 4) {
    process.stdout.write(`${readLifecycleCanaryProcessGroupState(process.argv[3])}\n`);
    return;
  }
  if (process.argv[2] === 'abort-start' && process.argv.length === 4) {
    process.stdout.write(`${abortLifecycleCanaryStart(process.argv[3]) || 'none'}\n`);
    return;
  }
  throw new Error('invalid root supervisor helper command');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(() => {
    process.stderr.write('TEAM_TASK_LIFECYCLE_ROOT_SUPERVISOR status=error\n');
    process.exitCode = 1;
  });
}
