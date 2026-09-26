import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeSavedStartupEntries } from './browser-first-cutover-startup.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const attempt = '11111111-1111-4111-8111-111111111111';
const binding = { attempt, inventoryDigest: 'a'.repeat(64) };
const home = '/root/.pm2';
const archive = '/var/lib/holaday-deploy/maintenance';
const target =
  '{"name":"holaday-files-cron","cron_restart":"0 * * * *","env":{"TOKEN":"test-only"}}';
// Preserve raw retained data, including integers JSON.parse/stringify would round.
const retained = '{ "name": "unrelated", "counter": 9007199254740993, "value": "a,}\\"b" }';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'startup-files-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = (p) => {
    assert(p === home || p.startsWith(`${home}/`) || p === archive || p.startsWith(`${archive}/`));
    return root + p;
  };
  await fs.mkdir(path(home), { recursive: true, mode: 0o700 });
  await fs.mkdir(path(archive), { recursive: true, mode: 0o700 });
  const primary = `[\n${target},\n${retained}\n]\n`;
  const fallbackRetained = '{"name":"backup-only-app","env":{"preserve":"yes"}}';
  const fallback = `[${fallbackRetained},${target}]`;
  await fs.writeFile(path(`${home}/dump.pm2`), primary, { mode: 0o600 });
  await fs.writeFile(path(`${home}/dump.pm2.bak`), fallback, { mode: 0o600 });
  const files = [primary, fallback].map((bytes, i) => ({
    path: `${home}/${i ? 'dump.pm2.bak' : 'dump.pm2'}`,
    digest: sha(bytes),
    remove: [{ name: 'holaday-files-cron', entryDigest: sha(target) }],
  }));
  const events = [];
  const disk = {
    ...fs,
    realpath: async (p) => (await fs.realpath(path(p))).slice(root.length),
    lstat: async (p) => Object.assign(await fs.lstat(path(p)), { uid: 0 }),
    mkdir: (p, opts) => fs.mkdir(path(p), opts),
    rename: async (a, b) => {
      events.push(`rename:${b}`);
      return fs.rename(path(a), path(b));
    },
    open: async (p, flags, mode) => {
      const handle = await fs.open(path(p), flags, mode);
      const stat = handle.stat.bind(handle);
      handle.stat = async () => Object.assign(await stat(), { uid: 0 });
      return handle;
    },
  };
  const io = {
    fs: disk,
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    assertOwnership: async () => ({ ...binding }),
    persist: async (event) => {
      events.push(event.phase);
    },
  };
  return {
    root,
    path,
    files,
    io,
    events,
    primary,
    fallback,
    fallbackRetained,
    input: { binding, files, maintenanceEndsAtMs: 5000 },
  };
}

test('backs up both originals and independently removes exact approved entries without altering retained bytes', async (t) => {
  const f = await fixture(t);
  const receipt = await removeSavedStartupEntries(f.input, f.io);
  assert.equal(await fs.readFile(f.path(`${home}/dump.pm2`), 'utf8'), `[${retained}]\n`);
  assert.equal(
    await fs.readFile(f.path(`${home}/dump.pm2.bak`), 'utf8'),
    `[${f.fallbackRetained}]\n`,
  );
  const folder = f.path(`${archive}/startup-${attempt}`);
  assert.equal(await fs.readFile(join(folder, 'dump.pm2.original'), 'utf8'), f.primary);
  assert.equal(await fs.readFile(join(folder, 'dump.pm2.bak.original'), 'utf8'), f.fallback);
  assert.equal((await fs.stat(folder)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(folder, 'dump.pm2.original'))).mode & 0o777, 0o600);
  assert.equal(receipt.files[0].beforeDigest, sha(f.primary));
  assert.equal(receipt.files[0].afterDigest, sha(`[${retained}]\n`));
  assert(!JSON.stringify(receipt).includes('test-only'));
  assert.deepEqual(f.events, [
    'startup-backup-intent',
    'startup-backed-up',
    'startup-file-intent',
    `rename:${home}/dump.pm2.bak`,
    'startup-file-written',
    'startup-file-intent',
    `rename:${home}/dump.pm2`,
    'startup-file-written',
  ]);
});

test('missing fallback remains absent and is not invented from the primary', async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.path(`${home}/dump.pm2.bak`));
  f.files[1] = { path: `${home}/dump.pm2.bak`, digest: null, remove: [] };
  const receipt = await removeSavedStartupEntries(f.input, f.io);
  await assert.rejects(fs.lstat(f.path(`${home}/dump.pm2.bak`)), { code: 'ENOENT' });
  assert.equal(receipt.files[1].afterDigest, null);
});

test('malformed, duplicate, unapproved or drifted entries are rejected before any write', async (t) => {
  for (const fault of ['digest', 'entry', 'name', 'duplicate', 'json', 'missing', 'path']) {
    const f = await fixture(t);
    if (fault === 'digest') f.files[0].digest = 'b'.repeat(64);
    if (fault === 'entry') f.files[0].remove[0].entryDigest = 'b'.repeat(64);
    if (fault === 'name') f.files[0].remove[0].name = 'unrelated';
    if (fault === 'path') f.files[0].path = `${home}/other.json`;
    if (['duplicate', 'json', 'missing'].includes(fault)) {
      const bytes =
        fault === 'duplicate' ? `[${target},${target}]` : fault === 'json' ? '[{' : `[${retained}]`;
      await fs.writeFile(f.path(`${home}/dump.pm2`), bytes);
      f.files[0].digest = sha(bytes);
    }
    await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
    assert.deepEqual(f.events, []);
  }
});

test('symlinks, hardlinks, writable source and foreign ownership are refused', async (t) => {
  for (const fault of ['symlink', 'hardlink', 'mode', 'owner']) {
    const f = await fixture(t);
    const source = f.path(`${home}/dump.pm2`);
    if (fault === 'symlink') {
      await fs.rename(source, `${source}.real`);
      await fs.symlink(`${source}.real`, source);
    }
    if (fault === 'hardlink') await fs.link(source, `${source}.link`);
    if (fault === 'mode') await fs.chmod(source, 0o666);
    if (fault === 'owner') {
      const open = f.io.fs.open;
      f.io.fs.open = async (...args) => {
        const h = await open(...args);
        const stat = h.stat;
        h.stat = async () => ({ ...(await stat()), uid: 998 });
        return h;
      };
    }
    await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
    assert.deepEqual(f.events, []);
  }
});

test('source drift after backup or intent does not overwrite the new file or retry', async (t) => {
  for (const phase of ['startup-backed-up', 'startup-file-intent']) {
    const f = await fixture(t);
    const persist = f.io.persist;
    f.io.persist = async (event) => {
      await persist(event);
      if (event.phase === phase)
        await fs.writeFile(f.path(`${home}/dump.pm2.bak`), '[{"name":"new-app"}]');
    };
    await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
    assert.equal(await fs.readFile(f.path(`${home}/dump.pm2`), 'utf8'), f.primary);
    assert.equal(await fs.readFile(f.path(`${home}/dump.pm2.bak`), 'utf8'), '[{"name":"new-app"}]');
    assert(!f.events.some((x) => x.startsWith('rename:')));
  }
});

test('expired window, lost ownership, journal failure or reused attempt never changes sources', async (t) => {
  for (const fault of ['deadline', 'owner', 'journal', 'repeat']) {
    const f = await fixture(t);
    if (fault === 'deadline') f.io.now = () => 5000;
    if (fault === 'owner') f.io.assertOwnership = async () => ({ ...binding, attempt: 'foreign' });
    if (fault === 'journal')
      f.io.persist = async () => {
        throw new Error('secret details');
      };
    if (fault === 'repeat') await fs.mkdir(f.path(`${archive}/startup-${attempt}`));
    await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
    assert.equal(await fs.readFile(f.path(`${home}/dump.pm2`), 'utf8'), f.primary);
    assert.equal(await fs.readFile(f.path(`${home}/dump.pm2.bak`), 'utf8'), f.fallback);
    assert(!f.events.some((x) => x.startsWith('rename:')));
  }
});

test('failure after fallback replacement preserves backup and partial state without restoring or replaying', async (t) => {
  const f = await fixture(t);
  f.io.persist = async (e) => {
    f.events.push(e.phase);
    if (e.phase === 'startup-file-written') throw new Error('write journal failed');
  };
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
  assert.equal(
    await fs.readFile(f.path(`${home}/dump.pm2.bak`), 'utf8'),
    `[${f.fallbackRetained}]\n`,
  );
  assert.equal(await fs.readFile(f.path(`${home}/dump.pm2`), 'utf8'), f.primary);
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
  assert.equal(f.events.filter((e) => e.startsWith('rename:')).length, 1);
});

test('corrupted recovery copy refuses replacement even when original sources still match', async (t) => {
  const f = await fixture(t);
  f.io.persist = async (e) => {
    f.events.push(e.phase);
    if (e.phase === 'startup-backed-up')
      await fs.writeFile(f.path(`${archive}/startup-${attempt}/dump.pm2.original`), 'damaged');
  };
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
  assert.equal(await fs.readFile(f.path(`${home}/dump.pm2`), 'utf8'), f.primary);
  assert(!f.events.some((e) => e.startsWith('rename:')));
});

test('non-JSON whitespace is not accepted as a valid PM2 recovery file', async (t) => {
  const f = await fixture(t);
  const bytes = `\uFEFF[${target},${retained}]`;
  await fs.writeFile(f.path(`${home}/dump.pm2`), bytes);
  f.files[0].digest = sha(bytes);
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
  assert.deepEqual(f.events, []);
});

test('backup sync failure leaves originals untouched and a visible non-reusable attempt', async (t) => {
  const f = await fixture(t);
  const open = f.io.fs.open;
  f.io.fs.open = async (path, ...args) => {
    const h = await open(path, ...args);
    if (path.endsWith('.original'))
      h.sync = async () => {
        throw new Error('private disk details');
      };
    return h;
  };
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), {
    message: 'CUTOVER_STARTUP_UNPROVEN',
  });
  assert.equal(await fs.readFile(f.path(`${home}/dump.pm2`), 'utf8'), f.primary);
  assert.equal(await fs.readFile(f.path(`${home}/dump.pm2.bak`), 'utf8'), f.fallback);
  f.io.fs.open = open;
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
  assert(!f.events.some((e) => e.startsWith('rename:')));
});

test('an invalid initial clock sample is not erased by a subsequent valid sample', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.io.now = () => (calls++ === 0 ? Number.NaN : 1000);
  await assert.rejects(removeSavedStartupEntries(f.input, f.io), /CUTOVER_STARTUP_/);
  assert.deepEqual(f.events, []);
});

test('real release journal durably records each file intent and result before transition may continue', async (t) => {
  const f = await fixture(t);
  const journal = await acquireReleaseJournal(f.path(archive), {
    ...binding,
    kind: 'first-cutover',
    candidate: 'b'.repeat(40),
    configDigest: 'c'.repeat(64),
    migrationDigest: sha('[]'),
    legacyDigest: 'd'.repeat(64),
  });
  t.after(() => journal.close());
  await journal.bindManifest([]);
  for (const phase of ['prepared', 'orders_fenced', 'legacy_settled', 'producers_stopped'])
    await journal.persist(phase, { candidate: 'b'.repeat(40) });
  f.io.assertOwnership = async () => {
    const owned = await journal.assertOwnership();
    return { attempt: owned.attempt, inventoryDigest: owned.inventoryDigest };
  };
  f.io.persist = async (event) => {
    await journal.recordStartupEvent(event);
    const disk = JSON.parse(await fs.readFile(journal.path, 'utf8'));
    assert.deepEqual(disk.startupEvents.at(-1), event);
    if (event.phase === 'startup-file-intent')
      await assert.rejects(
        journal.persist('all_fenced', { candidate: 'b'.repeat(40) }),
        /JOURNAL_UNPROVEN/,
      );
  };
  await removeSavedStartupEntries(f.input, f.io);
  const saved = JSON.parse(await fs.readFile(journal.path, 'utf8'));
  assert.equal(saved.startupEvents.length, 6);
  assert.equal(saved.phase, 'producers_stopped');
  await assert.rejects(journal.recordStartupEvent(saved.startupEvents[0]), /JOURNAL_UNPROVEN/);
  await journal.persist('all_fenced', { candidate: 'b'.repeat(40) });
  assert.equal(JSON.parse(await fs.readFile(journal.path, 'utf8')).startupEvents.length, 6);
});
