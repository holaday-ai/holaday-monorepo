import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertLifecycleProcessDisabled,
  persistLifecycleDisabled,
  rewriteLifecycleDisabled,
} from './team-task-lifecycle-deploy-safety.mjs';

function temporaryArtifacts(directory) {
  return readdirSync(directory).filter((name) => name.includes('.team-task-lifecycle.'));
}

test('rewrites missing, true, and duplicate lifecycle flags to one explicit false', () => {
  assert.equal(
    rewriteLifecycleDisabled('ALPHA=1\nOMEGA=2\n'),
    'ALPHA=1\nOMEGA=2\nTEAM_TASK_LIFECYCLE_ENABLED=false\n',
  );
  assert.equal(
    rewriteLifecycleDisabled('ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=true\nOMEGA=2\n'),
    'ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=false\nOMEGA=2\n',
  );
  assert.equal(
    rewriteLifecycleDisabled(
      'ALPHA=1\n TEAM_TASK_LIFECYCLE_ENABLED = true\nTEAM_TASK_LIFECYCLE_ENABLED=false\nOMEGA=2\n',
    ),
    'ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=false\nOMEGA=2\n',
  );
});

test('atomically persists one false value while preserving owner, group, mode, and other content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-safety-'));
  const envFile = join(directory, '.env');
  try {
    writeFileSync(envFile, 'ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=true\nOMEGA=2\n', {
      mode: 0o640,
    });
    chmodSync(envFile, 0o640);
    const before = statSync(envFile);

    const result = persistLifecycleDisabled(envFile);
    const after = statSync(envFile);

    assert.deepEqual(result, { lifecycleDisabled: true });
    assert.equal(
      readFileSync(envFile, 'utf8'),
      'ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=false\nOMEGA=2\n',
    );
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
    assert.equal(after.mode & 0o7777, before.mode & 0o7777);
    assert.equal(lstatSync(envFile).isSymbolicLink(), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a symlink without changing its target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-symlink-'));
  const target = join(directory, 'target.env');
  const envFile = join(directory, '.env');
  try {
    writeFileSync(target, 'TEAM_TASK_LIFECYCLE_ENABLED=true\n');
    symlinkSync(target, envFile);
    assert.throws(() => persistLifecycleDisabled(envFile), /regular non-symlink file/);
    assert.equal(readFileSync(target, 'utf8'), 'TEAM_TASK_LIFECYCLE_ENABLED=true\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const operation of ['fchownSync', 'fchmodSync', 'fsyncSync', 'renameSync', 'writeFileSync']) {
  test(`does not replace the original file when ${operation} fails before activation`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-failure-'));
    const envFile = join(directory, '.env');
    const original = 'ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=true\n';
    try {
      writeFileSync(envFile, original, { mode: 0o600 });
      assert.throws(
        () =>
          persistLifecycleDisabled(envFile, {
            [operation]: () => {
              throw new Error(`injected ${operation} failure`);
            },
          }),
        new RegExp(`injected ${operation} failure`),
      );
      assert.equal(readFileSync(envFile, 'utf8'), original);
      assert.deepEqual(temporaryArtifacts(directory), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('does not replace a concurrently updated source file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-race-'));
  const envFile = join(directory, '.env');
  const concurrentFile = join(directory, '.env.concurrent');
  try {
    writeFileSync(envFile, 'ALPHA=old\nTEAM_TASK_LIFECYCLE_ENABLED=true\n', { mode: 0o600 });
    writeFileSync(concurrentFile, 'ALPHA=new-secret\nTEAM_TASK_LIFECYCLE_ENABLED=true\n', {
      mode: 0o600,
    });
    let sourceInspections = 0;
    assert.throws(
      () =>
        persistLifecycleDisabled(envFile, {
          lstatSync: (path) => {
            if (path === envFile && ++sourceInspections === 2) renameSync(concurrentFile, envFile);
            return lstatSync(path);
          },
        }),
      /changed during safety update/,
    );
    assert.equal(
      readFileSync(envFile, 'utf8'),
      'ALPHA=new-secret\nTEAM_TASK_LIFECYCLE_ENABLED=true\n',
    );
    assert.deepEqual(temporaryArtifacts(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a substituted temporary path without replacing the source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-temp-race-'));
  const envFile = join(directory, '.env');
  const original = 'ALPHA=1\nTEAM_TASK_LIFECYCLE_ENABLED=true\n';
  try {
    writeFileSync(envFile, original, { mode: 0o600 });
    let substituted = false;
    assert.throws(
      () =>
        persistLifecycleDisabled(envFile, {
          lstatSync: (path) => {
            if (!substituted && path !== envFile && path.includes('.team-task-lifecycle.')) {
              substituted = true;
              rmSync(path, { force: true });
              writeFileSync(path, 'substituted');
            }
            return lstatSync(path);
          },
        }),
      /temporary file changed during safety update/,
    );
    assert.equal(readFileSync(envFile, 'utf8'), original);
    assert.deepEqual(temporaryArtifacts(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not replace the source when temporary file creation fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-open-failure-'));
  const envFile = join(directory, '.env');
  const original = 'TEAM_TASK_LIFECYCLE_ENABLED=true\n';
  try {
    writeFileSync(envFile, original, { mode: 0o600 });
    let opens = 0;
    assert.throws(
      () =>
        persistLifecycleDisabled(envFile, {
          openSync: (...args) => {
            opens += 1;
            if (opens === 3) throw new Error('injected temporary open failure');
            return openSync(...args);
          },
        }),
      /injected temporary open failure/,
    );
    assert.equal(readFileSync(envFile, 'utf8'), original);
    assert.deepEqual(temporaryArtifacts(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports directory fsync failure after activation while leaving the fail-closed value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holaday-lifecycle-directory-fsync-'));
  const envFile = join(directory, '.env');
  try {
    writeFileSync(envFile, 'TEAM_TASK_LIFECYCLE_ENABLED=true\n', { mode: 0o600 });
    let fsyncs = 0;
    assert.throws(
      () =>
        persistLifecycleDisabled(envFile, {
          fsyncSync: (_fd) => {
            fsyncs += 1;
            if (fsyncs === 2) throw new Error('injected directory fsync failure');
            return undefined;
          },
        }),
      /injected directory fsync failure/,
    );
    assert.equal(readFileSync(envFile, 'utf8'), 'TEAM_TASK_LIFECYCLE_ENABLED=false\n');
    assert.deepEqual(temporaryArtifacts(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts exactly one online process with one exact disabled environment value', () => {
  const summary = assertLifecycleProcessDisabled(
    [
      { name: 'holaday-orchestrator', pid: 1234, pm2_env: { status: 'online' } },
      { name: 'unrelated', pid: 9999, pm2_env: { status: 'online' } },
    ],
    () => Buffer.from('ALPHA=1\0TEAM_TASK_LIFECYCLE_ENABLED=false\0OMEGA=2\0'),
  );
  assert.deepEqual(summary, { lifecycleDisabled: true, onlineInstances: 1 });
});

for (const environment of [
  'ALPHA=1\0',
  'TEAM_TASK_LIFECYCLE_ENABLED=true\0',
  'TEAM_TASK_LIFECYCLE_ENABLED=false\0TEAM_TASK_LIFECYCLE_ENABLED=false\0',
]) {
  test('rejects a missing, enabled, or duplicate process environment value', () => {
    assert.throws(
      () =>
        assertLifecycleProcessDisabled(
          [{ name: 'holaday-orchestrator', pid: 1234, pm2_env: { status: 'online' } }],
          () => Buffer.from(environment),
        ),
      /process safety verification failed/,
    );
  });
}

test('rejects zero or multiple online orchestrator instances', () => {
  assert.throws(
    () => assertLifecycleProcessDisabled([], () => Buffer.alloc(0)),
    /process safety verification failed/,
  );
  assert.throws(
    () =>
      assertLifecycleProcessDisabled(
        [
          { name: 'holaday-orchestrator', pid: 1, pm2_env: { status: 'online' } },
          { name: 'holaday-orchestrator', pid: 2, pm2_env: { status: 'online' } },
        ],
        () => Buffer.alloc(0),
      ),
    /process safety verification failed/,
  );
});
