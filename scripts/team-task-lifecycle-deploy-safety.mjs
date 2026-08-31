import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAG_NAME = 'TEAM_TASK_LIFECYCLE_ENABLED';
const DISABLED_LINE = `${FLAG_NAME}=false`;
const FLAG_PATTERN = /^[ \t]*TEAM_TASK_LIFECYCLE_ENABLED[ \t]*=/;
const MAX_ENV_BYTES = 1024 * 1024;

const defaultOperations = {
  closeSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
};

export function rewriteLifecycleDisabled(content) {
  if (typeof content !== 'string') throw new TypeError('environment content must be a string');
  const trailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (trailingNewline) lines.pop();

  const output = [];
  let written = false;
  for (const line of lines) {
    const comparable = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (FLAG_PATTERN.test(comparable)) {
      if (!written) output.push(DISABLED_LINE);
      written = true;
      continue;
    }
    if (line !== '' || content !== '') output.push(line);
  }
  if (!written) output.push(DISABLED_LINE);
  return `${output.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function assertRegularOwnedFile(path, stats) {
  if (!stats.isFile() || stats.nlink !== 1) {
    throw new Error(`${path} must be a regular non-symlink file with one link`);
  }
  if (stats.size > MAX_ENV_BYTES) throw new Error(`${path} exceeds the deployment safety limit`);
}

function lifecycleLines(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => FLAG_PATTERN.test(line))
    .map((line) => line.replace(/[ \t]/g, ''));
}

function readDescriptor(operations, fd, size) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = operations.readSync(fd, buffer, offset, size - offset, offset);
    if (bytesRead === 0) throw new Error('environment file changed during safety read');
    offset += bytesRead;
  }
  return buffer.toString('utf8');
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export function persistLifecycleDisabled(envFile, operationOverrides = {}) {
  if (typeof envFile !== 'string' || !envFile.startsWith('/')) {
    throw new Error('environment file path must be absolute');
  }
  const operations = { ...defaultOperations, ...operationOverrides };
  const beforePath = operations.lstatSync(envFile);
  if (beforePath.isSymbolicLink()) {
    throw new Error(`${envFile} must be a regular non-symlink file with one link`);
  }

  let sourceFd;
  let tempFd;
  let directoryFd;
  let currentFd;
  let finalFd;
  let tempPath;
  try {
    sourceFd = operations.openSync(envFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = operations.fstatSync(sourceFd);
    assertRegularOwnedFile(envFile, before);
    if (!sameIdentity(before, beforePath)) {
      throw new Error('environment file changed during safety inspection');
    }
    const content = readDescriptor(operations, sourceFd, before.size);

    const directory = dirname(envFile);
    directoryFd = operations.openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    const directoryBefore = operations.fstatSync(directoryFd);
    tempPath = resolve(directory, `.${basename(envFile)}.team-task-lifecycle.${randomUUID()}`);
    tempFd = operations.openSync(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    operations.writeFileSync(tempFd, rewriteLifecycleDisabled(content), 'utf8');
    operations.fchownSync(tempFd, before.uid, before.gid);
    operations.fchmodSync(tempFd, before.mode & 0o7777);
    operations.fsyncSync(tempFd);

    const staged = operations.fstatSync(tempFd);
    const stagedPath = operations.lstatSync(tempPath);
    assertRegularOwnedFile(tempPath, stagedPath);
    if (!sameIdentity(staged, stagedPath)) {
      throw new Error('temporary file changed during safety update');
    }
    if (
      staged.uid !== before.uid ||
      staged.gid !== before.gid ||
      (staged.mode & 0o7777) !== (before.mode & 0o7777)
    ) {
      throw new Error('staged environment ownership or mode mismatch');
    }
    const stagedLines = lifecycleLines(readDescriptor(operations, tempFd, staged.size));
    if (stagedLines.length !== 1 || stagedLines[0] !== DISABLED_LINE) {
      throw new Error('staged lifecycle safety value is invalid');
    }

    const directoryPath = operations.lstatSync(directory);
    if (!sameIdentity(directoryBefore, directoryPath)) {
      throw new Error('environment directory changed during safety update');
    }
    const currentPath = operations.lstatSync(envFile);
    if (currentPath.isSymbolicLink() || !sameIdentity(before, currentPath)) {
      throw new Error('environment file changed during safety update');
    }
    currentFd = operations.openSync(envFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const current = operations.fstatSync(currentFd);
    assertRegularOwnedFile(envFile, current);
    if (
      !sameIdentity(before, current) ||
      readDescriptor(operations, currentFd, current.size) !== content
    ) {
      throw new Error('environment file changed during safety update');
    }
    operations.closeSync(currentFd);
    currentFd = undefined;
    const finalTempPath = operations.lstatSync(tempPath);
    if (!sameIdentity(staged, finalTempPath)) {
      throw new Error('temporary file changed during safety update');
    }

    operations.renameSync(tempPath, envFile);
    tempPath = undefined;
    operations.fsyncSync(directoryFd);

    const afterPath = operations.lstatSync(envFile);
    assertRegularOwnedFile(envFile, afterPath);
    if (!sameIdentity(staged, afterPath)) {
      throw new Error('activated environment identity mismatch');
    }
    if (
      afterPath.uid !== before.uid ||
      afterPath.gid !== before.gid ||
      (afterPath.mode & 0o7777) !== (before.mode & 0o7777)
    ) {
      throw new Error('activated environment ownership or mode mismatch');
    }
    finalFd = operations.openSync(envFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const finalStats = operations.fstatSync(finalFd);
    if (!sameIdentity(staged, finalStats)) {
      throw new Error('activated environment identity mismatch');
    }
    const finalLines = lifecycleLines(readDescriptor(operations, finalFd, finalStats.size));
    if (finalLines.length !== 1 || finalLines[0] !== DISABLED_LINE) {
      throw new Error('activated lifecycle safety value is invalid');
    }
    return { lifecycleDisabled: true };
  } finally {
    if (sourceFd !== undefined) operations.closeSync(sourceFd);
    if (tempFd !== undefined) operations.closeSync(tempFd);
    if (directoryFd !== undefined) operations.closeSync(directoryFd);
    if (currentFd !== undefined) operations.closeSync(currentFd);
    if (finalFd !== undefined) operations.closeSync(finalFd);
    if (tempPath !== undefined) operations.rmSync(tempPath, { force: true });
  }
}

export function assertLifecycleProcessDisabled(
  processes,
  readEnviron,
  appName = 'holaday-orchestrator',
) {
  const online = processes.filter(
    (process) => process?.name === appName && process?.pm2_env?.status === 'online',
  );
  if (
    online.length !== 1 ||
    !Number.isInteger(Number(online[0]?.pid)) ||
    Number(online[0].pid) < 1
  ) {
    throw new Error('process safety verification failed');
  }
  const environment = readEnviron(Number(online[0].pid))
    .toString()
    .split('\0')
    .filter((value) => value.startsWith(`${FLAG_NAME}=`));
  if (environment.length !== 1 || environment[0] !== DISABLED_LINE) {
    throw new Error('process safety verification failed');
  }
  return { lifecycleDisabled: true, onlineInstances: 1 };
}

function verifyProcess(appName) {
  const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
  return assertLifecycleProcessDisabled(
    processes,
    (pid) => readFileSync(`/proc/${pid}/environ`),
    appName,
  );
}

function main(argv) {
  const [command, value] = argv;
  if (command === 'persist' && value) {
    persistLifecycleDisabled(resolve(value));
    console.log('TEAM_TASK_LIFECYCLE_FILE_SAFETY=ready');
    return;
  }
  if (command === 'verify-process' && value) {
    verifyProcess(value);
    console.log('TEAM_TASK_LIFECYCLE_PROCESS_SAFETY=ready instances=1');
    return;
  }
  throw new Error('usage: team-task-lifecycle-deploy-safety.mjs <persist|verify-process> <value>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch {
    console.error('team task lifecycle deployment safety check failed');
    process.exitCode = 1;
  }
}
