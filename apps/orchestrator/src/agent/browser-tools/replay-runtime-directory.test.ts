import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('records through the actual runner and API from a read-only release directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replay-release-'));
  const release = join(root, 'release');
  const runtime = join(root, 'browsers');
  await mkdir(release);
  await mkdir(runtime);
  await chmod(release, 0o555);
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/login-replay-repro.ts')],
      {
        cwd: release,
        timeout: 20000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          NODE_OPTIONS: '--max-old-space-size=1536',
          NODE_ENV: 'test',
          JWT_SECRET: 'local-placeholder-only-not-an-auth-secret-0000',
          DATABASE_URL: 'mysql://test:test@127.0.0.1:3306/test',
          REDIS_URL: 'redis://127.0.0.1:6379',
          BROWSER_POOL_DIR: runtime,
          BROWSER_V2_CANARY_USER_IDS: 'replay-owner',
        },
      },
    );
    expect(stdout).toContain('"pass":true');
    expect(stdout).toContain('"images":1');
  } finally {
    await chmod(release, 0o755);
    await rm(root, { recursive: true, force: true });
  }
});
