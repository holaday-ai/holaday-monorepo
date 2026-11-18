import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Connection } from 'mysql2/promise';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { users } from '../db/schema/users.js';
import {
  type IsolatedMysqlProbe,
  openIsolatedMysqlProbe,
} from '../testing/isolated-mysql-probe.js';
import { TestKeyProvider } from './crypto.js';
import { SqlVaultStore } from './sql-store.js';
import { LEASE_TTL, PROFILE_IDLE_TTL, SessionVault } from './vault.js';
import { VaultBrowserWorker, type VaultTask } from './worker.js';

const enabled =
  process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1' &&
  process.env.HOLADAY_VAULT_CONTINUITY_PROBE === '1';
const alice = newExternalId('user');
const bob = newExternalId('user');
const secretCookie = 'SYNTHETIC_SQL_CLOUD_SESSION';
const secretStorage = 'SYNTHETIC_SQL_PRIVATE_ACCOUNT';
let probe: IsolatedMysqlProbe;
let browser: Browser;
let server: Server;
let root: string;
let artifacts: string;
let origin: string;
let now = Date.now();
let keys: TestKeyProvider;
let writes = 0;
const clients = new Set<Connection>();
const opened: VaultTask[] = [];
const evidence: Record<string, unknown> = {
  modelCalls: 0,
  provider: 'ephemeral TestKeyProvider shared only within this test process; not a production KMS',
  site: 'owned loopback identity fixture; not a real external account',
  startup:
    'new SqlVaultStore/SessionVault and real Chromium contexts, not a backend process restart',
  connectionIds: [],
};

function state() {
  return {
    cookies: [
      {
        name: 'sid',
        value: secretCookie,
        domain: '127.0.0.1',
        path: '/',
        secure: false,
        httpOnly: true,
        hostOnly: true,
        sameSite: 'lax' as const,
        session: true,
      },
    ],
    storage: [{ name: 'account', value: secretStorage }],
  };
}

async function client() {
  const connection = await mysql.createConnection(process.env.HOLADAY_SQL_TEST_URL!);
  clients.add(connection);
  (evidence.connectionIds as number[]).push(connection.threadId);
  const store = new SqlVaultStore(drizzle(connection) as DB);
  const vault = new SessionVault({
    store,
    keys,
    cloudHomeEnabled: true,
    importEnabled: false,
    profileEnabled: false,
    now: () => now,
  });
  const worker = new VaultBrowserWorker(vault, {
    context: (config) => browser.newContext(config),
    probes: new Map([[origin, { path: '/home', selector: '#signed-in' }]]),
    networkPolicy: {
      check: async (url) =>
        new URL(url).origin === origin
          ? { allowed: true as const, url, addresses: ['127.0.0.1'] }
          : {
              allowed: false as const,
              reason: 'private_network' as const,
              message: 'Fixture origin only',
            },
    },
    checkpointMs: 60_000,
    statusPollMs: 40,
    statusTimeoutMs: 200,
    maxUnverifiedMs: 800,
  });
  return { connection, store, vault, worker };
}

async function capture(c: Awaited<ReturnType<typeof client>>) {
  return c.vault.captureCloudProfile(
    alice,
    {
      consent: 'cloud-browser-profile-v1',
      origin,
      storageKeys: ['account', 'preference'],
    },
    async () => ({ origin, state: state() }),
  );
}

async function open(
  c: Awaited<ReturnType<typeof client>>,
  id: string,
  onInterrupted?: (reason: string) => void,
) {
  const task = await c.worker.open(alice, id, undefined, {
    access: 'cloud-home-v1',
    workspace: true,
    onInterrupted,
  });
  opened.push(task);
  return task;
}

describe.runIf(enabled)('SQL-backed cloud profile continuity with real Chromium', () => {
  beforeAll(async () => {
    if (process.version !== 'v22.23.3') throw new Error('Use production-matching Node22.23.3');
    vi.stubEnv('NODE_ENV', 'test');
    root = await realpath(await mkdtemp(join(tmpdir(), 'ba-vault-sql-')));
    artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(root, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      includeVaultSchema: true,
      artifactPath: join(artifacts, 'mysql-evidence.json'),
    });
    await probe.db.insert(users).values([
      {
        id: 7,
        externalId: alice,
        email: 'vault-sql-alice@example.test',
        passwordHash: 'synthetic',
      },
      { id: 8, externalId: bob, email: 'vault-sql-bob@example.test', passwordHash: 'synthetic' },
    ]);
    keys = new TestKeyProvider();
    server = createServer((req, res) => {
      if (!req.headers.cookie?.includes(`sid=${secretCookie}`)) {
        res.writeHead(401, { 'content-type': 'text/html' });
        res.end('<title>Sign in</title><main>Sign in required</main>');
        return;
      }
      if (req.method === 'POST') writes++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<title>Private account</title><main id="signed-in" data-account="alice">Account Alice</main>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No owned fixture listener');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
    Object.assign(evidence, { node: process.version, chromium: browser.version() });
  });

  afterAll(async () => {
    try {
      for (const task of opened) await task.close(false).catch(() => {});
      await browser?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      for (const connection of clients) await connection.end().catch(() => {});
    } finally {
      try {
        await probe?.close();
      } finally {
        if (artifacts)
          await writeFile(
            join(artifacts, 'vault-evidence.json'),
            JSON.stringify(evidence, null, 2),
          );
        if (root) await rm(root, { recursive: true, force: true });
        vi.unstubAllEnvs();
      }
    }
  });

  it('restores authenticated state through a new SQL connection and browser context, preserves write-back and rejects another owner', async () => {
    const first = await client();
    const grant = await capture(first);
    await first.vault.selectCloudHomeProfile(alice, grant.id);
    const task = await open(first, grant.id);
    await task.page.goto(`${origin}/home`);
    expect(await task.page.locator('#signed-in').getAttribute('data-account')).toBe('alice');
    expect(await task.page.evaluate(() => localStorage.getItem('account'))).toBe(secretStorage);
    await task.page.evaluate(() => localStorage.setItem('preference', 'SYNTHETIC_SAVED_CHANGE'));
    await task.close();
    expect(task.context.pages()).toEqual([]);
    await first.connection.end();
    clients.delete(first.connection);
    await probe.reconnect();

    const rebuilt = await client();
    const settings = await rebuilt.vault.cloudHomeSettings(alice);
    expect(settings.selectedProfileId).toBe(grant.id);
    expect((await rebuilt.vault.list(alice)).some((row) => row.id === grant.id)).toBe(true);
    const restored = await open(rebuilt, grant.id);
    await restored.page.goto(`${origin}/home`);
    expect(await restored.page.locator('#signed-in').getAttribute('data-account')).toBe('alice');
    expect(await restored.page.evaluate(() => localStorage.getItem('preference'))).toBe(
      'SYNTHETIC_SAVED_CHANGE',
    );
    await restored.page.screenshot({ path: join(artifacts, 'sql-profile-restored.png') });
    await restored.close();
    const checkout = await rebuilt.vault.checkout(alice, grant.id, { access: 'cloud-home-v1' });
    expect(await rebuilt.worker.verify(alice, checkout.state, checkout.grant)).toBe('connected');
    await rebuilt.vault.release(alice, grant.id, checkout);
    await expect(
      rebuilt.vault.checkout(bob, grant.id, { access: 'cloud-home-v1' }),
    ).rejects.toThrow('grant_unavailable');
    const document = await rebuilt.store.read(alice, (doc) => JSON.stringify(doc));
    for (const value of [secretCookie, secretStorage, 'SYNTHETIC_SAVED_CHANGE'])
      expect(document).not.toContain(value);
    evidence.persistence = {
      newConnection: true,
      newVaultAndChromiumContext: true,
      identityObserved: 'synthetic alice',
      ownedLoginProbe: 'connected',
      writeBackRestored: true,
      otherOwnerDenied: true,
      documentSHA256: createHash('sha256').update(document).digest('hex'),
      plaintextAbsent: true,
      selectedProfileId: settings.selectedProfileId,
    };
  }, 30_000);

  it('serializes cross-connection revocation, refuses an old writer and invalidates pending saves and active contexts after clear', async () => {
    const older = await client();
    const newer = await client();
    const grant = await capture(older);
    const stale = await older.vault.checkout(alice, grant.id, { access: 'cloud-home-v1' });
    await newer.vault.revoke(alice, grant.id);
    await expect(older.vault.save(alice, grant.id, stale, state())).rejects.toThrow(
      'grant_unavailable',
    );
    expect((await newer.vault.list(alice)).find((row) => row.id === grant.id)?.status).toBe(
      'revoked',
    );

    const running = await capture(older);
    const interruptions: string[] = [];
    const task = await open(older, running.id, (reason) => interruptions.push(reason));
    await task.page.goto(`${origin}/home`);
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = older.vault.captureCloudProfile(
      alice,
      {
        consent: 'cloud-browser-profile-v1',
        origin,
        storageKeys: ['account'],
      },
      async () => {
        start();
        await gate;
        return { origin, state: state() };
      },
    );
    const rejected = expect(pending).rejects.toThrow('grant_unavailable');
    await started;
    await newer.vault.clear(alice);
    release();
    await rejected;
    await vi.waitFor(() => expect(task.context.pages()).toEqual([]), {
      timeout: 2500,
      interval: 25,
    });
    await expect(task.page.evaluate(() => fetch('/write', { method: 'POST' }))).rejects.toThrow();
    expect(interruptions).toContain('session_revoked');
    expect(writes).toBe(0);
    expect((await newer.vault.list(alice)).filter((row) => row.status === 'connected')).toEqual([]);
    evidence.revocation = {
      oldWriterRefused: true,
      pendingCaptureRefused: true,
      crossConnectionContextClosed: true,
      writes,
    };
  }, 30_000);

  it('fences expired writer leases, expires saved identities and blocks a closed owner on every read/decrypt/save', async () => {
    const older = await client();
    const newer = await client();
    const grant = await capture(older);
    const stale = await older.vault.checkout(alice, grant.id, { access: 'cloud-home-v1' });
    now += LEASE_TTL + 1;
    const current = await newer.vault.checkout(alice, grant.id, { access: 'cloud-home-v1' });
    expect(current.token).not.toBe(stale.token);
    await expect(older.vault.save(alice, grant.id, stale, state())).rejects.toThrow('cas_conflict');
    await newer.vault.release(alice, grant.id, current);
    now += PROFILE_IDLE_TTL + 1;
    expect((await newer.vault.list(alice)).find((row) => row.id === grant.id)?.status).toBe(
      'expired',
    );
    await expect(
      older.vault.checkout(alice, grant.id, { access: 'cloud-home-v1' }),
    ).rejects.toThrow('grant_unavailable');

    const final = await capture(newer);
    const writer = await newer.vault.checkout(alice, final.id, { access: 'cloud-home-v1' });
    await probe.db.update(users).set({ status: 'closed' }).where(eq(users.externalId, alice));
    await expect(
      newer.vault.checkout(alice, final.id, { access: 'cloud-home-v1' }),
    ).rejects.toThrow('user_unavailable');
    await expect(older.vault.save(alice, final.id, writer, state())).rejects.toThrow(
      'user_unavailable',
    );
    evidence.expiryAndClosure = {
      supersededWriterRefused: true,
      expiryRetained: true,
      closedOwnerReadAndSaveRefused: true,
    };
  }, 30_000);
});
