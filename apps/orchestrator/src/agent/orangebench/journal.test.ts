import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { TaskJournal } from './journal.js';
it('recovers the same submitted intent after an owned child SIGKILL and expired lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hd-ob-crash-'));
  const marker = join(root, 'marker');
  const script = fileURLToPath(new URL('./fixtures/journal-crash.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', script, root, marker], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let error = '';
  child.stderr.on('data', (part: Buffer) => {
    error = (error + part.toString()).slice(-2000);
  });
  try {
    let path = '';
    for (let n = 0; n < 150; n++) {
      try {
        path = await readFile(marker, 'utf8');
        break;
      } catch {
        if (child.exitCode !== null) throw new Error(`fixture exited: ${error}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    expect(path).not.toBe('');
    child.kill('SIGKILL');
    const [, signal] = await once(child, 'exit');
    expect(signal).toBe('SIGKILL');
    // Expire only this dead fixture's lease; never age a live lock.
    const expired = new Date(Date.now() - 30000);
    await utimes(`${path}.lock`, expired, expired);
    const journal = await TaskJournal.open(root, {
      taskId: 'crash-task',
      accountId: 'fixture-account',
      keyId: 'fixture-key',
    });
    const intent = await journal.exclusive(async (state) => state.intents['fixture-quote']);
    expect(intent).toEqual({
      binding: 'fixture-binding',
      idempotencyKey: 'same-intent',
      maximum: 100,
      phase: 'submitting',
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
it('rejects a world-readable existing journal without reading or changing its metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hd-ob-perm-'));
  try {
    const journal = await TaskJournal.open(root, {
      taskId: 'private-task',
      accountId: 'fixture-account',
      keyId: 'fixture-key',
    });
    await journal.exclusive(async (state) => journal.save(state));
    await chmod(journal.path, 0o644);
    await expect(journal.exclusive(async () => true)).rejects.toThrow('journal_unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
