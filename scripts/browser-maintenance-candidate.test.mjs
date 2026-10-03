import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import * as candidateModule from './browser-maintenance-host.mjs';

const old = 'a'.repeat(40);
const candidate = 'b'.repeat(40);
const root = `/opt/holaday-releases/${candidate}`;
const config = Buffer.from('SYNTHETIC_ONLY=1\n');
const migrationDigest = 'c'.repeat(64);
function fixture() {
  const events = [];
  let ownership = true;
  const input = {
    branch: 'codex/candidate',
    candidate,
    sourceCandidate: old,
    sourceRoot: '/opt/holaday-monorepo',
    config,
    configDigest: createHash('sha256').update(config).digest('hex'),
    migrationDigest,
    gid: 998,
    env: { SYNTHETIC_ONLY: '1' },
  };
  const io = {
    assertOwnership: async () => {
      if (!ownership) throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    },
    exec: async (command, args, settings) => {
      events.push({ command, args, settings });
      if (command === 'git' && args.includes('get-url'))
        return 'https://example.invalid/repo.git\n';
      if (command === 'git' && args.includes('rev-parse')) return `${candidate}\n`;
      return '';
    },
    stageConfig: async (path, bytes, gid) => {
      assert.equal(path, root);
      assert.deepEqual(bytes, config);
      assert.equal(gid, 998);
      events.push('config');
    },
    manifest: () => ({ sha256: migrationDigest, manifest: { replaysNumberedSql: true } }),
    bindManifest: async (manifest) => {
      assert.equal(manifest.replaysNumberedSql, true);
      events.push('manifest');
    },
  };
  return {
    input,
    io,
    events,
    loseLock: () => {
      ownership = false;
    },
  };
}

test('shared preparation stages a detached candidate from the legacy source without service effects', async () => {
  assert.equal(typeof candidateModule.stageReleaseCandidate, 'function');
  const f = fixture();
  assert.equal(await candidateModule.stageReleaseCandidate(f.input, f.io), root);
  assert.deepEqual(
    f.events.filter((e) => typeof e === 'object').map((e) => [e.command, e.args]),
    [
      ['git', ['-C', '/opt/holaday-monorepo', 'remote', 'get-url', 'origin']],
      ['git', ['clone', '--no-hardlinks', '--no-checkout', '--', '/opt/holaday-monorepo', root]],
      ['git', ['-C', root, 'remote', 'set-url', 'origin', 'https://example.invalid/repo.git']],
      ['git', ['-C', root, 'fetch', 'origin', 'refs/heads/codex/candidate']],
      ['git', ['-C', root, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}']],
      ['git', ['-C', root, 'merge-base', '--is-ancestor', old, candidate]],
      ['git', ['-C', root, 'checkout', '--detach', candidate]],
      ['pnpm', ['install', '--frozen-lockfile']],
      ['pnpm', ['--filter', '@holaday/orchestrator', 'build']],
      ['git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']],
      ['git', ['-C', root, 'branch', '--show-current']],
    ],
  );
  assert.equal(f.events.at(-1), 'manifest');
});

test('shared preparation also accepts only the exact normal release source root', async () => {
  assert.equal(typeof candidateModule.stageReleaseCandidate, 'function');
  const f = fixture();
  f.input.sourceRoot = `/opt/holaday-releases/${old}`;
  await candidateModule.stageReleaseCandidate(f.input, f.io);
  assert.equal(f.events[0].args[1], f.input.sourceRoot);
  for (const change of [
    { sourceRoot: '/tmp/repo' },
    { sourceRoot: root },
    { sourceRoot: `${f.input.sourceRoot}/..` },
    { branch: '--all' },
    { candidate: 'HEAD' },
    { gid: 0 },
    { configDigest: '0'.repeat(64) },
  ]) {
    const bad = fixture();
    await assert.rejects(
      candidateModule.stageReleaseCandidate({ ...bad.input, ...change }, bad.io),
      /MAINTENANCE_TARGET_UNPROVEN/,
    );
    assert.equal(bad.events.length, 0);
  }
});

for (const failure of [
  'fetch',
  'ancestor',
  'manifest-before',
  'manifest-after',
  'install',
  'build',
  'lock-after-build',
  'head-after-build',
  'attached-after-build',
]) {
  test(`preparation ${failure} failure never binds a successful manifest or starts services`, async () => {
    assert.equal(typeof candidateModule.stageReleaseCandidate, 'function');
    const f = fixture();
    const exec = f.io.exec;
    let built = false;
    f.io.exec = async (command, args, settings) => {
      const result = await exec(command, args, settings);
      if (failure === 'fetch' && args.includes('rev-parse')) return `${'d'.repeat(40)}\n`;
      if (built && failure === 'head-after-build' && args.includes('rev-parse'))
        return `${'d'.repeat(40)}\n`;
      if (built && failure === 'attached-after-build' && args.includes('--show-current'))
        return 'codex/unapproved\n';
      if (
        (failure === 'ancestor' && args.includes('merge-base')) ||
        (failure === 'install' && args.includes('install')) ||
        (failure === 'build' && args.includes('build'))
      )
        throw new Error('synthetic failure');
      if (args.includes('build')) {
        built = true;
        if (failure === 'lock-after-build') f.loseLock();
      }
      return result;
    };
    f.io.manifest = () => ({
      sha256:
        failure === 'manifest-before' || (failure === 'manifest-after' && built)
          ? '0'.repeat(64)
          : migrationDigest,
      manifest: { replaysNumberedSql: true },
    });
    await assert.rejects(candidateModule.stageReleaseCandidate(f.input, f.io));
    assert.ok(!f.events.includes('manifest'));
    assert.ok(
      !f.events.some((e) => e.command === 'pm2' || e.args?.some((a) => a.includes('db:migrate'))),
    );
    if (failure === 'manifest-before') assert.ok(!f.events.includes('config'));
  });
}

test('shared preparation really clones and detaches the approved commit without altering the legacy checkout', async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'holaday-candidate-git-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const origin = join(directory, 'origin.git');
  const source = join(directory, 'legacy');
  const destination = join(directory, 'candidate');
  const run = promisify(execFile);
  const git = async (args) =>
    (
      await run('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_AUTHOR_NAME: 'Synthetic QA',
          GIT_AUTHOR_EMAIL: 'qa@example.invalid',
          GIT_COMMITTER_NAME: 'Synthetic QA',
          GIT_COMMITTER_EMAIL: 'qa@example.invalid',
        },
      })
    ).stdout;
  await git(['init', '--bare', origin]);
  await git(['init', '-b', 'codex/candidate', source]);
  await fs.mkdir(join(source, 'apps/orchestrator'), { recursive: true });
  await fs.writeFile(join(source, 'apps/orchestrator/package.json'), '{"private":true}\n');
  await git(['-C', source, 'add', '.']);
  await git(['-C', source, 'commit', '-m', 'synthetic base']);
  const sourceCandidate = (await git(['-C', source, 'rev-parse', 'HEAD'])).trim();
  await fs.writeFile(join(source, 'candidate.txt'), 'candidate\n');
  await git(['-C', source, 'add', '.']);
  await git(['-C', source, 'commit', '-m', 'synthetic candidate']);
  const approvedCandidate = (await git(['-C', source, 'rev-parse', 'HEAD'])).trim();
  await git(['-C', source, 'remote', 'add', 'origin', origin]);
  await git(['-C', source, 'push', 'origin', 'codex/candidate']);
  await git(['-C', source, 'checkout', '--detach', sourceCandidate]);
  const f = fixture();
  Object.assign(f.input, { sourceCandidate, candidate: approvedCandidate });
  const logicalDestination = `/opt/holaday-releases/${approvedCandidate}`;
  const builds = [];
  f.io.exec = async (command, args, settings) => {
    if (command === 'git')
      return git(
        args.map((arg) =>
          arg === '/opt/holaday-monorepo' ? source : arg === logicalDestination ? destination : arg,
        ),
      );
    assert.equal(command, 'pnpm');
    assert.equal(settings.cwd, logicalDestination);
    builds.push(args);
    return '';
  };
  f.io.stageConfig = async (path, bytes) => {
    assert.equal(path, logicalDestination);
    await fs.writeFile(join(destination, 'apps/orchestrator/.env.local'), bytes, {
      flag: 'wx',
      mode: 0o640,
    });
  };
  await candidateModule.stageReleaseCandidate(f.input, f.io);
  assert.equal((await git(['-C', destination, 'rev-parse', 'HEAD'])).trim(), approvedCandidate);
  assert.equal((await git(['-C', destination, 'branch', '--show-current'])).trim(), '');
  assert.equal((await git(['-C', source, 'rev-parse', 'HEAD'])).trim(), sourceCandidate);
  assert.equal((await git(['-C', source, 'status', '--porcelain'])).trim(), '');
  assert.equal(await fs.readFile(join(destination, 'candidate.txt'), 'utf8'), 'candidate\n');
  assert.deepEqual(await fs.readFile(join(destination, 'apps/orchestrator/.env.local')), config);
  assert.deepEqual(builds, [
    ['install', '--frozen-lockfile'],
    ['--filter', '@holaday/orchestrator', 'build'],
  ]);
});
