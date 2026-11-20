import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { DB } from '../db/client.js';
import type { FileService } from '../files/file-service.js';
import {
  type IsolatedMysqlProbe,
  openIsolatedMysqlProbe,
} from '../testing/isolated-mysql-probe.js';

const enabled =
  process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1' &&
  process.env.HOLADAY_HOME_CONTINUITY_PROBE === '1';
let probe: IsolatedMysqlProbe;
let sql: mysql.Pool;
let db: DB;
let pool: BrowserPool | undefined;
let server: Server;
let root: string;
let artifacts: string;
let origin: string;
let releaseSave: (() => void) | undefined;
let denyIdentity = false;
let identityBarrier: Promise<void> | undefined;
let releaseIdentity: (() => void) | undefined;
let identityStarted: (() => void) | undefined;
let identityReads = 0;
let exports = 0;
const alice = newExternalId('user');
const bob = newExternalId('user');
const cookieValue = 'SYNTHETIC_HOME_SQL_OWNER';
const csv = 'channel,amount\nweb,10.00\n';
const evidence: Record<string, unknown> = {
  modelCalls: 0,
  provider: 'ephemeral TestKeyProvider, not production KMS',
  account: 'synthetic loopback account, not immutable external-account proof',
  pool: 'real Darwin BrowserPool spawn/CDP/executor/egress; no spawn or pool method mocks',
  delay:
    'first fully received download pauses before the real FileService write; original arguments retained',
};

async function freePort() {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No test CDP port');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return address.port;
}

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
}

describe.runIf(enabled)('real Home pool continuity with SQL-backed profiles and files', () => {
  beforeAll(async () => {
    if (process.version !== 'v22.23.3' || process.platform !== 'darwin')
      throw new Error('This native candidate requires Node22.23.3 on Darwin');
    root = await realpath(await mkdtemp(join(tmpdir(), 'ba-home-sql-')));
    artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(root, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('HOLADAY_ENV', 'local-test');
    vi.stubEnv('DATABASE_URL', process.env.HOLADAY_SQL_TEST_URL!);
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379/0');
    vi.stubEnv('JWT_SECRET', randomBytes(48).toString('hex'));
    vi.stubEnv('HOLADAY_FILES_ROOT', join(root, 'files'));
    probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      includeVaultSchema: true,
      artifactPath: join(artifacts, 'mysql-evidence.json'),
    });
    const url = new URL(process.env.HOLADAY_SQL_TEST_URL!);
    sql = mysql.createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: 'holaday_it',
      connectionLimit: 2,
      connectTimeout: 2000,
    });
    db = drizzle(sql) as DB;
    server = createServer((req, res) => {
      const cookie = req.headers.cookie ?? '';
      const account = cookie.includes('sid=SYNTHETIC_OTHER_ACCOUNT')
        ? 'bob'
        : cookie.includes(`sid=${cookieValue}`) || cookie.includes('sid=SYNTHETIC_ROTATED_A')
          ? 'alice'
          : null;
      if (!account || (req.url === '/account-check' && denyIdentity)) {
        res.writeHead(401);
        res.end('Sign in required');
        return;
      }
      if (req.url === '/report.csv') {
        exports++;
        res.writeHead(200, {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="report.csv"',
        });
        res.end(csv);
      } else {
        const respond = () => {
          if (res.destroyed) return;
          res.writeHead(200, { 'content-type': 'text/html' });
          const subject = account === 'alice' ? 'PRIVATE_SITE_SUBJECT_A' : 'PRIVATE_SITE_SUBJECT_B';
          res.end(
            `<title>Owned account</title><main id="account" data-owner="${account}" data-subject="${subject}">Synthetic ${account === 'alice' ? 'Alice' : 'Bob'}</main><a id="export" href="/report.csv">Export</a>`,
          );
        };
        if (req.url === '/account-check') {
          identityReads++;
          identityStarted?.();
          if (identityBarrier) {
            void identityBarrier.then(respond);
            return;
          }
        }
        respond();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No owned site address');
    origin = `http://127.0.0.1:${address.port}`;
    // The existing local-test-only policy permits exactly this owned origin.
    vi.stubEnv('BROWSER_TEST_FIXTURE_ORIGINS', origin);
  });

  afterAll(async () => {
    releaseSave?.();
    releaseIdentity?.();
    try {
      await pool?.shutdown();
      for (const pid of (evidence.nativePids as number[] | undefined) ?? [])
        await vi.waitFor(() => expect(processGone(pid)).toBe(true), { timeout: 5000 });
      evidence.nativeProcessesGone = true;
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await sql?.end();
    } finally {
      try {
        await probe?.close();
      } finally {
        if (artifacts)
          await writeFile(join(artifacts, 'home-evidence.json'), JSON.stringify(evidence, null, 2));
        if (root) await rm(root, { recursive: true, force: true });
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
      }
    }
  });

  it('keeps a lent browser when its viewer leaves, rebuilds after explicit close, and preserves original download ownership across later tasks and instances', async () => {
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskFiles } = await import('../db/schema/task-files.js');
    const { TaskRepository } = await import('../agent/task-repository.js');
    const { BrowserPool: RealPool } = await import('../browser-pool/browser-pool.js');
    const { TestKeyProvider } = await import('../browser-session-vault/crypto.js');
    const { createVaultRuntime } = await import('../browser-session-vault/runtime.js');
    const { FileService: RealFiles } = await import('../files/file-service.js');
    const { LocalStorageProvider } = await import('../files/storage-provider.js');
    const { BrowserHomeSessions, browserHomeSessionId } = await import('./browser-home-session.js');
    const { BrowserHomeFiles } = await import('./browser-home-files.js');
    const { claimBrowserHomeTaskOrThrow, lendBrowserHomeToTask, finishBrowserHomeTask } =
      await import('./browser-home-task.js');
    await db.insert(users).values([
      { id: 7, externalId: alice, email: 'home-sql-alice@example.test', passwordHash: 'synthetic' },
      { id: 8, externalId: bob, email: 'home-sql-bob@example.test', passwordHash: 'synthetic' },
    ]);
    const logger = pino({ level: 'silent' });
    const runtime = createVaultRuntime({
      db,
      keys: new TestKeyProvider(),
      cloudHomeEnabled: true,
      importEnabled: false,
      profileEnabled: false,
      probes: new Map([[origin, { path: '/', selector: '#account' }]]),
    })!;
    const grant = await runtime.vault.captureCloudProfile(
      alice,
      {
        consent: 'cloud-browser-profile-v1',
        origin,
        storageKeys: ['account'],
      },
      async () => ({
        origin,
        state: {
          cookies: [
            {
              name: 'sid',
              value: cookieValue,
              domain: '127.0.0.1',
              path: '/',
              secure: false,
              httpOnly: true,
              hostOnly: true,
              sameSite: 'lax',
              session: true,
            },
          ],
          storage: [{ name: 'account', value: 'SYNTHETIC_ACCOUNT_ALICE' }],
        },
      }),
    );
    await runtime.vault.selectCloudHomeProfile(alice, grant.id);
    pool = new RealPool(
      {
        maxInstances: 2,
        idleTimeoutMs: 300_000,
        baseDir: join(root, 'browsers'),
        cdpPortStart: await freePort(),
        vncPortStart: 5900,
        wsPortStart: 6100,
        displayStart: 150,
        screenSize: '1280x800x24',
        vncEnabled: false,
        prepareSession: (userId, executor, session) => runtime.prepare(userId, executor, session),
        finishSession: (executor) => runtime.finish(executor),
      },
      logger,
    );
    const files = new RealFiles(db, logger, new LocalStorageProvider(join(root, 'files'), logger));
    const sessions = new BrowserHomeSessions({ closeGraceMs: 25 });
    const manager = new BrowserHomeFiles();
    let firstSource: Parameters<FileService['storeBrowserOutput']>[0]['source'] | undefined;
    let firstStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let firstSave = true;
    const setup = {
      onReady: async (instance: BrowserInstance) =>
        manager.attach({
          instance,
          pool: pool!,
          userIdInternal: 7,
          enabled: () => true,
          onIdle: (original) => sessions.backgroundOperationEnded(pool!, alice, original),
          fileService: {
            storeBrowserOutput: async (input) => {
              if (firstSave) {
                firstSave = false;
                firstSource = structuredClone(input.source);
                expect(input.buffer.toString()).toBe(csv);
                firstStarted();
                await saveGate;
              }
              return files.storeBrowserOutput(input);
            },
          },
        }),
    };
    const profile = { id: grant.id, origin };
    await sessions.open(pool, alice, logger, 'viewer-one', profile, setup);
    const first = sessions.instanceFor(pool, alice)!;
    const firstPage = await first.executor.getPage();
    expect(await firstPage.locator('#account').getAttribute('data-owner')).toBe('alice');
    expect(first.bravePid).toBeGreaterThan(0);
    evidence.nativePids = [first.bravePid];
    const repo = new TaskRepository(db);
    const taskA = newExternalId('task');
    const taskB = newExternalId('task');
    for (const taskId of [taskA, taskB])
      await repo.insertTask(
        { taskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
        {
          userId: 7,
          intent: 'Controlled Home loan lifecycle',
          sourceContext: { browserSource: 'personal_home' },
        },
      );
    const lend = async (taskId: string) =>
      lendBrowserHomeToTask({
        pool: pool!,
        userId: alice,
        taskId,
        claim: claimBrowserHomeTaskOrThrow({ pool: pool!, userId: alice, sessions }),
        sessions,
      });
    expect(await lend(taskA)).toBe(first);
    expect(sessions.claimTask(pool, alice).kind).toBe('busy');
    expect(sessions.claimTask(pool, bob).kind).toBe('closed');
    const closeSpy = vi.spyOn(sessions, 'close');
    expect(sessions.leave(pool, alice, 'viewer-one')).toBe('scheduled');
    await vi.waitFor(() =>
      expect(closeSpy).toHaveBeenCalledWith(pool, alice, { onlyIfUnused: true }),
    );
    expect(pool.peek(taskA)).toBe(first);
    expect(firstPage.isClosed()).toBe(false);
    await sessions.open(pool, alice, logger, 'viewer-two', profile, setup);

    const downloading = firstPage.waitForEvent('download');
    await firstPage.locator('#export').click();
    await downloading;
    await saveStarted;
    expect(firstSource?.taskId).toBe(taskA);
    await repo.persistVisionOutcome(taskA, { status: 'cancelled', tickCount: 0 });
    expect(
      await finishBrowserHomeTask({
        pool,
        taskId: taskA,
        userId: alice,
        retentionMs: 0,
        retainForReview: false,
        sessions,
      }),
    ).toBe('returned');
    expect(await lend(taskB)).toBe(first);
    expect(await sessions.close(pool, alice)).toBe(true);
    expect(pool.browserHomeHolder(alice)).toBeNull();
    expect(pool.peek(taskB)).toBe(first);
    expect(firstPage.isClosed()).toBe(false);
    await expect(
      runtime.vault.checkout(alice, grant.id, { access: 'cloud-home-v1' }),
    ).rejects.toThrow('writer_busy');
    await repo.persistVisionOutcome(taskB, { status: 'cancelled', tickCount: 0 });
    expect(
      await finishBrowserHomeTask({
        pool,
        taskId: taskB,
        userId: alice,
        retentionMs: 0,
        retainForReview: false,
        sessions,
      }),
    ).toBe('finished');
    expect(firstPage.isClosed()).toBe(true);
    await vi.waitFor(() => expect(processGone(first.bravePid!)).toBe(true), { timeout: 5000 });

    await sessions.open(pool, alice, logger, 'viewer-three', profile, setup);
    const replacement = sessions.instanceFor(pool, alice)!;
    expect(replacement).not.toBe(first);
    expect(replacement.bravePid).not.toBe(first.bravePid);
    evidence.nativePids = [first.bravePid, replacement.bravePid];
    const page = await replacement.executor.getPage();
    expect(await page.locator('#account').getAttribute('data-owner')).toBe('alice');
    expect(await page.evaluate(() => localStorage.getItem('account'))).toBe(
      'SYNTHETIC_ACCOUNT_ALICE',
    );
    const secondDownload = page.waitForEvent('download');
    await page.locator('#export').click();
    await secondDownload;
    await vi.waitFor(() =>
      expect(manager.recent(alice).filter((row) => row.state === 'saved')).toHaveLength(1),
    );
    releaseSave!();
    await vi.waitFor(() =>
      expect(manager.recent(alice).filter((row) => row.state === 'saved')).toHaveLength(2),
    );
    const rows = await db.select().from(taskFiles).where(eq(taskFiles.userId, 7));
    expect(rows).toHaveLength(2);
    const [taskRow] = await db.select().from(tasks).where(eq(tasks.externalId, taskA));
    const taskFile = rows.find((row) => row.browserSource?.taskId === taskA)!;
    const homeFile = rows.find((row) => row.browserSource?.taskId === null)!;
    expect(taskFile.taskId).toBe(taskRow?.id);
    expect(homeFile.taskId).toBeNull();
    const taskSource = taskFile.browserSource;
    const homeSource = homeFile.browserSource;
    if (taskSource?.kind !== 'personal_home' || homeSource?.kind !== 'personal_home')
      throw new Error('Home file provenance missing');
    expect(taskSource.instanceId).not.toBe(homeSource.instanceId);
    expect(rows.some((row) => row.browserSource?.taskId === taskB)).toBe(false);
    for (const row of rows) {
      expect((await files.loadForUser(row.externalId, 7))?.buffer.toString()).toBe(csv);
      expect(await files.loadForUser(row.externalId, 8)).toBeNull();
      if (row.browserSource?.kind !== 'personal_home') throw new Error('Wrong file source kind');
      expect(row.browserSource.sessionId).toBe(browserHomeSessionId(alice));
    }
    expect(exports).toBe(2);
    await page.screenshot({ path: join(artifacts, 'home-rebuilt-owned-profile.png') });
    Object.assign(evidence, {
      node: process.version,
      nativePids: [first.bravePid, replacement.bravePid],
      viewerLeaveKeptTask: true,
      explicitCloseEndedLoanOnly: true,
      selectedProfileRestored: true,
      oldContextClosed: true,
      writerBusyRefused: true,
      originalTaskFileRetained: true,
      newHomeFileTaskless: true,
      wrongOwnerReads: 0,
      wrongTaskFiles: 0,
      exports,
      deliveredFiles: rows.length,
      sourceInstanceIds: [taskSource.instanceId, homeSource.instanceId],
    });
  }, 120_000);

  it('waits before any model call when a restored profile has no trusted account-subject evidence', async () => {
    const { runUnifiedSupercarTask } = await import(
      '../agent/browser-tools/unified-supercar-runner.js'
    );
    const home = pool!.peek(`bhs_${alice}`)!;
    expect(home.executor.sessionInterruption).toBeNull();
    let fixtureModelAttempts = 0;
    const metadata = { provider: 'anthropic' as const, model: 'controlled-identity-probe' };
    const outcome = await runUnifiedSupercarTask({
      taskId: newExternalId('task'),
      intent: '读取原账号的信息，账号未核实则等待',
      executor: home.executor,
      maxIterations: 1,
      messagesAdapter: {
        metadata,
        create: async () => {
          fixtureModelAttempts++;
          return {
            id: 'identity-gate-fixture',
            metadata,
            content: [
              {
                type: 'tool_use',
                id: 'finish',
                name: 'finish',
                input: {
                  status: 'completed',
                  summary: 'Fixture answer',
                  evidence: 'Synthetic Alice',
                },
              },
            ],
            stopReason: 'tool_use',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              complete: true,
            },
          };
        },
      },
    });
    evidence.identityUnknown = {
      expected: 'awaiting_user before model',
      actual: outcome.status,
      fixtureModelAttempts,
      externalModelCalls: 0,
    };
    expect(fixtureModelAttempts).toBe(0);
    expect(outcome.status).toBe('awaiting_user');
  }, 30_000);

  it('uses a fresh trusted cookie-only subject, keeps token rotation writable and stops changed, invalid or late-revoked identity', async () => {
    const { BrowserPool: RealPool } = await import('../browser-pool/browser-pool.js');
    const { TestKeyProvider } = await import('../browser-session-vault/crypto.js');
    const { createVaultRuntime } = await import('../browser-session-vault/runtime.js');
    const { BrowserHomeSessions } = await import('./browser-home-session.js');
    const { prepareBrowserHomeProfileSave, saveBrowserHomeProfile } = await import(
      './browser-home-profile.js'
    );
    const { runUnifiedSupercarTask } = await import(
      '../agent/browser-tools/unified-supercar-runner.js'
    );
    await pool!.shutdown();
    const logger = pino({ level: 'silent' });
    const runtime = createVaultRuntime({
      db,
      keys: new TestKeyProvider(),
      cloudHomeEnabled: true,
      importEnabled: false,
      profileEnabled: false,
      probes: new Map([
        [
          origin,
          {
            path: '/account-check',
            selector: '#account',
            subject: {
              selector: '#account',
              attribute: 'data-subject',
              adapter: 'fixture-subject-v1',
            },
          },
        ],
      ]),
    })!;
    pool = new RealPool(
      {
        maxInstances: 1,
        idleTimeoutMs: 300_000,
        baseDir: join(root, 'subject-browsers'),
        cdpPortStart: await freePort(),
        vncPortStart: 5910,
        wsPortStart: 6110,
        displayStart: 160,
        screenSize: '1280x800x24',
        vncEnabled: false,
        prepareSession: (owner, executor, session) => runtime.prepare(owner, executor, session),
        finishSession: (executor) => runtime.finish(executor),
      },
      logger,
    );
    const sessions = new BrowserHomeSessions();
    const record = () => {
      const instance = sessions.instanceFor(pool!, alice)!;
      (evidence.nativePids as number[]).push(instance.bravePid!);
      return instance;
    };
    await sessions.open(pool, alice, logger, 'capture-viewer');
    const source = record();
    const sourcePage = await source.executor.getPage();
    const setCookie = async (page: typeof sourcePage, value: string) =>
      page.context().addCookies([
        {
          name: 'sid',
          value,
          domain: '127.0.0.1',
          path: '/',
          secure: false,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
    await setCookie(sourcePage, cookieValue);
    // Home's production restore path adapts the native Page to this legacy PageLike interface too.
    expect(
      (
        await source.executor.navigate(
          sourcePage as unknown as Parameters<typeof source.executor.navigate>[0],
          origin,
        )
      ).ok,
    ).toBe(true);
    const prepared = await prepareBrowserHomeProfileSave({ userId: alice, pool, sessions });
    expect(prepared).not.toBeNull();
    const settings = await runtime.vault.cloudHomeSettings(alice);
    const saved = await saveBrowserHomeProfile({
      userId: alice,
      pool,
      sessions,
      vault: runtime.vault,
      worker: runtime.worker,
      request: {
        consent: 'cloud-browser-profile-v1',
        origin,
        sourceId: prepared!.sourceId,
        includeStorage: false,
        requestId: randomUUID(),
        requestedAt: Date.now(),
        clearEpoch: settings.clearEpoch,
      },
    });
    expect(JSON.stringify(saved)).not.toContain('PRIVATE_SITE_SUBJECT_A');
    const savedState = await runtime.vault.checkout(alice, saved.id, { access: 'cloud-home-v1' });
    expect(savedState.identity?.subject).toBe('PRIVATE_SITE_SUBJECT_A');
    await runtime.vault.release(alice, saved.id, savedState);
    evidence.trustedCaptureBound = true;
    expect(await sessions.close(pool, alice)).toBe(true);
    const profile = { id: saved.id, origin };
    const reopen = async () => {
      await sessions.open(pool!, alice, logger, randomUUID(), profile);
      return record();
    };
    const verified = await reopen();
    expect(await verified.executor.verifySessionIdentity()).toBeNull();
    let attempts = 0;
    const metadata = { provider: 'anthropic' as const, model: 'controlled-identity-probe' };
    const adapter = {
      metadata,
      create: async () => {
        attempts++;
        const content =
          attempts === 1
            ? {
                type: 'tool_use' as const,
                id: 'navigate',
                name: 'navigate',
                input: { url: origin },
              }
            : attempts === 2
              ? { type: 'tool_use' as const, id: 'snapshot', name: 'snapshot', input: {} }
              : {
                  type: 'tool_use' as const,
                  id: 'finish',
                  name: 'finish',
                  input: {
                    status: 'completed',
                    summary: '页面显示 Synthetic Alice。',
                    evidence: 'Synthetic Alice',
                  },
                };
        return {
          id: randomUUID(),
          metadata,
          content: [content],
          stopReason: 'tool_use' as const,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            complete: true,
          },
        };
      },
    };
    const outcome = await runUnifiedSupercarTask({
      taskId: newExternalId('task'),
      intent: `打开 ${origin} 并读取页面上显示的账号名称`,
      executor: verified.executor,
      messagesAdapter: adapter,
      maxIterations: 4,
    });
    evidence.boundIdentity = { allowedFixtureModelAttempts: attempts, outcome: outcome.status };
    expect(attempts).toBeGreaterThan(0);
    expect(outcome.status).toBe('completed');
    await setCookie(await verified.executor.getPage(), 'SYNTHETIC_ROTATED_A');
    expect(await verified.executor.verifySessionIdentity()).toBeNull();
    expect(await sessions.close(pool, alice)).toBe(true);
    const checked = await runtime.vault.checkout(alice, saved.id, { access: 'cloud-home-v1' });
    expect(checked.identity?.subject).toBe('PRIVATE_SITE_SUBJECT_A');
    expect(checked.state.cookies.find((cookie) => cookie.name === 'sid')?.value).toBe(
      'SYNTHETIC_ROTATED_A',
    );
    await runtime.vault.release(alice, saved.id, checked);

    const boundaryStops: string[] = [];
    for (const boundary of ['navigate', 'finish'] as const) {
      const beforeAction = await reopen();
      let calls = 0;
      const beforeExports = exports;
      const result = await runUnifiedSupercarTask({
        taskId: newExternalId('task'),
        intent: '读取原账号信息，不导出或提交',
        executor: beforeAction.executor,
        messagesAdapter: {
          ...adapter,
          create: async () => {
            calls++;
            await setCookie(await beforeAction.executor.getPage(), 'SYNTHETIC_OTHER_ACCOUNT');
            return {
              id: randomUUID(),
              metadata,
              content: [
                {
                  type: 'tool_use' as const,
                  id: boundary,
                  name: boundary,
                  input:
                    boundary === 'navigate'
                      ? { url: `${origin}/report.csv` }
                      : {
                          status: 'completed',
                          summary: '页面显示 Synthetic Alice。',
                          evidence: 'Synthetic Alice',
                        },
                },
              ],
              stopReason: 'tool_use' as const,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                complete: true,
              },
            };
          },
        },
        maxIterations: 1,
      });
      expect(calls).toBe(1);
      expect(result.status).toBe('awaiting_user');
      expect(beforeAction.executor.sessionInterruption).toBe('account_changed');
      expect(exports).toBe(beforeExports);
      boundaryStops.push(boundary);
      await sessions.close(pool, alice);
    }
    evidence.postModelBoundaryStops = boundaryStops;

    let deniedCalls = 0;
    const deniedAdapter = {
      ...adapter,
      create: async (...args: Parameters<typeof adapter.create>) => {
        deniedCalls++;
        return adapter.create(...args);
      },
    };
    const invalid = await reopen();
    denyIdentity = true;
    const invalidOutcome = await runUnifiedSupercarTask({
      taskId: newExternalId('task'),
      intent: '读取原账号信息',
      executor: invalid.executor,
      messagesAdapter: deniedAdapter,
      maxIterations: 1,
    });
    denyIdentity = false;
    expect(invalidOutcome.status).toBe('awaiting_user');
    expect(deniedCalls).toBe(0);
    await sessions.close(pool, alice);
    const changed = await reopen();
    await setCookie(await changed.executor.getPage(), 'SYNTHETIC_OTHER_ACCOUNT');
    const changedOutcome = await runUnifiedSupercarTask({
      taskId: newExternalId('task'),
      intent: '读取原账号信息',
      executor: changed.executor,
      messagesAdapter: deniedAdapter,
      maxIterations: 1,
    });
    expect(changedOutcome.status).toBe('awaiting_user');
    expect(changed.executor.sessionInterruption).toBe('account_changed');
    expect(deniedCalls).toBe(0);
    await sessions.close(pool, alice);
    const unchanged = await runtime.vault.checkout(alice, saved.id, { access: 'cloud-home-v1' });
    expect(unchanged.identity?.subject).toBe('PRIVATE_SITE_SUBJECT_A');
    expect(unchanged.state.cookies.find((cookie) => cookie.name === 'sid')?.value).toBe(
      'SYNTHETIC_ROTATED_A',
    );
    await runtime.vault.release(alice, saved.id, unchanged);
    const switching = await reopen();
    let sawSwitchProbe!: () => void;
    const switchProbeStarted = new Promise<void>((resolve) => {
      sawSwitchProbe = resolve;
    });
    identityBarrier = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    identityStarted = sawSwitchProbe;
    const oldIdentityCheck = switching.executor.verifySessionIdentity();
    await switchProbeStarted;
    await setCookie(await switching.executor.getPage(), 'SYNTHETIC_OTHER_ACCOUNT');
    releaseIdentity!();
    expect(await oldIdentityCheck).not.toBeNull();
    const switchedOutcome = await runUnifiedSupercarTask({
      taskId: newExternalId('task'),
      intent: '读取原账号信息',
      executor: switching.executor,
      messagesAdapter: deniedAdapter,
      maxIterations: 1,
    });
    expect(switchedOutcome.status).toBe('awaiting_user');
    expect(deniedCalls).toBe(0);
    await sessions.close(pool, alice);
    identityBarrier = undefined;
    identityStarted = undefined;
    const revoked = await reopen();
    let started!: () => void;
    const sawProbe = new Promise<void>((resolve) => {
      started = resolve;
    });
    identityBarrier = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    identityStarted = started;
    const pending = revoked.executor.verifySessionIdentity();
    await sawProbe;
    await runtime.vault.revoke(alice, saved.id);
    releaseIdentity!();
    expect(await pending).not.toBeNull();
    expect(revoked.executor.sessionInterruption).not.toBeNull();
    expect((await runtime.vault.list(alice)).find((row) => row.id === saved.id)?.status).toBe(
      'revoked',
    );
    Object.assign(evidence, {
      identityReads,
      cookieOnlySubjectVerified: true,
      tokenRotationSaved: true,
      invalidPageWaited: true,
      changedAccountWaited: true,
      wrongAccountModelAttempts: deniedCalls,
      lateProofDidNotRestoreRevocation: true,
      inFlightAccountSwitchWaited: true,
    });
  }, 120_000);
});
