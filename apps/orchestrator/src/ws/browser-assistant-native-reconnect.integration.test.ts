import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { type BrowserContext, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  type IsolatedMysqlProbe,
  openIsolatedMysqlProbe,
} from '../testing/isolated-mysql-probe.js';
import {
  type RecoveryBackend,
  type RecoveryReady,
  spawnRecoveryBackend,
} from '../testing/ws-recovery-process.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from './server.js';

const enabled =
  process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1' &&
  process.env.HOLADAY_PROCESS_RECOVERY_PROBE === '1';
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const extension = join(repoRoot, 'apps/extension');
let probe: IsolatedMysqlProbe;
let root: string;
let artifacts: string;
let context: BrowserContext | undefined;
let siteServer: Server | undefined;
let releaseExport: (() => void) | undefined;
let profilePath: string | undefined;
let recordedBrowserPid: number | undefined;
const backends: RecoveryBackend[] = [];
const sockets: WebSocket[] = [];
const evidence: Record<string, unknown> = {
  modelAPICalls: 0,
  accounts: 'synthetic SQL owner',
  boot: 'legacy startup SQL sweep + HTTP/WS modules, not full production maintenance boot',
  input: 'Playwright/native Chromium, not physical OS input',
};
async function backend(ports?: RecoveryReady) {
  const process = spawnRecoveryBackend({
    probe,
    logPath: join(artifacts, `backend-${backends.length + 1}.log`),
    filesRoot: join(root, 'files'),
    ports,
  });
  backends.push(process);
  return { process, ready: await process.ready };
}
async function tool(process: RecoveryBackend, userId: string, options: ExtensionToolCallOptions) {
  return process.request<ExtensionToolCallOutcome>({ op: 'tool', userId, options });
}
function result(outcome: ExtensionToolCallOutcome): Record<string, unknown> {
  if (!outcome.result || typeof outcome.result !== 'object')
    throw new Error(`No native tool response: ${JSON.stringify(outcome)}`);
  return outcome.result as Record<string, unknown>;
}
async function ownerWebsocket(ready: RecoveryReady, token: string) {
  const frames: Array<Record<string, unknown>> = [];
  const socket = new WebSocket(`ws://127.0.0.1:${ready.wsPort}`, ['holaday.v1', `jwt.${token}`]);
  sockets.push(socket);
  socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'client.hello', token, extensionVersion: 'web-workbench' }));
  return frames;
}
describe.runIf(enabled)(
  'loaded Chrome reconnect through real backend default authentication',
  () => {
    beforeAll(async () => {
      if (!process.version.startsWith('v22.')) throw new Error('Native recovery requires Node22');
      root = await realpath(await mkdtemp(join(tmpdir(), 'ba-native-recovery-')));
      artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(root, 'artifacts');
      await mkdir(artifacts, { recursive: true });
      vi.stubEnv('DATABASE_URL', process.env.HOLADAY_SQL_TEST_URL!);
      vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379/0');
      vi.stubEnv('JWT_SECRET', randomBytes(48).toString('hex'));
      vi.stubEnv('NODE_ENV', 'test');
      probe = await openIsolatedMysqlProbe({
        allTableStructures: true,
        artifactPath: join(artifacts, 'mysql-evidence.json'),
      });
    });
    afterAll(async () => {
      releaseExport?.();
      try {
        for (const socket of sockets) socket.terminate();
        for (const handle of backends) await handle.stop();
        if (siteServer) {
          siteServer.closeAllConnections();
          await new Promise<void>((resolve) => siteServer!.close(() => resolve()));
        }
      } finally {
        try {
          await probe?.close();
        } finally {
          if (artifacts)
            await writeFile(
              join(artifacts, 'native-evidence.json'),
              JSON.stringify(evidence, null, 2),
            );
        }
      }
      try {
        if (context) {
          const closing = context.close().then(
            () => true,
            () => false,
          );
          async function settleWithin(ms: number) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                closing,
                new Promise<false>((resolve) => {
                  timer = setTimeout(() => resolve(false), ms);
                }),
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          }
          if (!(await settleWithin(10_000))) {
            if (!recordedBrowserPid || !profilePath)
              throw new Error('Test browser cleanup has no recorded owner PID');
            const inspected = spawnSync(
              'ps',
              ['-p', String(recordedBrowserPid), '-o', 'command='],
              { encoding: 'utf8' },
            );
            const current = inspected.stdout.trim();
            if (current) {
              if (
                !current.includes(`--user-data-dir=${profilePath}`) ||
                current.includes('--type=')
              )
                throw new Error('Refusing to signal a browser without this test profile');
              process.kill(recordedBrowserPid, 'SIGKILL');
              evidence.browserCleanup =
                'forced only recorded test browser PID after graceful deadline';
            } else evidence.browserCleanup = 'recorded test browser already exited';
            await settleWithin(2000);
          } else evidence.browserCleanup = 'graceful';
        }
        if (artifacts)
          await writeFile(
            join(artifacts, 'native-evidence.json'),
            JSON.stringify(evidence, null, 2),
          );
        if (root) await rm(root, { recursive: true, force: true });
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it('automatically reconnects with a new client, refuses stale authority and avoids replay after an applied export loses its receipt; human edits and cancellation stop stale actions', async () => {
      const {
        newExternalId,
        USER_BROWSER_PROTOCOL,
        USER_BROWSER_ACTIVITY_CAPABILITY,
        USER_BROWSER_DOWNLOAD_CAPABILITY,
      } = await import('@holaday/shared-types');
      const { users } = await import('../db/schema/users.js');
      const { tasks } = await import('../db/schema/tasks.js');
      const { TaskRepository } = await import('../agent/task-repository.js');
      const { signAccessToken } = await import('../auth/jwt.js');
      const { LocalChromeTaskSessions } = await import(
        '../agent/supercar/local-chrome-task-session.js'
      );
      const owner = newExternalId('user');
      await probe.db.insert(users).values({
        id: 7,
        externalId: owner,
        email: 'native-owner@example.test',
        passwordHash: 'synthetic-only',
        plan: 'pro',
      });
      const token = await signAccessToken({ sub: owner, plan: 'pro' });
      const first = await backend();
      const extensionDir = join(artifacts, 'extension');
      const built = spawnSync(
        process.execPath,
        [
          join(extension, 'node_modules/vite/bin/vite.js'),
          'build',
          '--outDir',
          extensionDir,
          '--emptyOutDir',
        ],
        {
          cwd: extension,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            VITE_LOCAL_CHROME_QA: '1',
            VITE_WORKBENCH_URL: `http://localhost:${first.ready.httpPort}`,
            VITE_ORCHESTRATOR_HTTP: `http://127.0.0.1:${first.ready.httpPort}`,
            VITE_ORCHESTRATOR_WS: `ws://127.0.0.1:${first.ready.wsPort}/ws`,
          },
        },
      );
      await writeFile(
        join(artifacts, 'extension-build.log'),
        (built.stdout ?? '') + (built.stderr ?? ''),
      );
      expect(built.status, built.stderr).toBe(0);
      if (process.env.HOLADAY_NATIVE_PUBLIC_FORM === '1') {
        // The QA package normally grants only loopback. Grant this one public
        // test origin in the owned build artifact (production uses <all_urls>).
        const manifestPath = join(extensionDir, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        manifest.host_permissions.push('https://httpbin.org/*');
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        evidence.qaPublicHostGrant = 'https://httpbin.org/*; test artifact only';
      }

      context = await chromium.launchPersistentContext(join(root, 'profile'), {
        channel: 'chromium',
        headless: true,
        downloadsPath: join(root, 'downloads'),
        args: [
          '--renderer-process-limit=2',
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
        ],
      });
      profilePath = await realpath(join(root, 'profile'));
      const processRows = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split(
        '\n',
      );
      const browserRow = processRows.find(
        (line) => line.includes(`--user-data-dir=${profilePath}`) && !line.includes('--type='),
      );
      if (browserRow) recordedBrowserPid = Number(browserRow.trim().split(/\s+/)[0]);
      Object.assign(evidence, { profilePath, recordedBrowserPid, childPids: [first.ready.pid] });
      await writeFile(join(artifacts, 'native-evidence.json'), JSON.stringify(evidence, null, 2));
      const logs: string[] = [];
      context.on('console', (message) => logs.push(message.text()));
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const bootStarted = performance.now();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Native worker readiness timed out')),
          45_000,
        );
        void worker
          .evaluate(() => chrome.runtime.id)
          .then(
            () => {
              clearTimeout(timer);
              resolve();
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            },
          );
      });
      const workerReadyMs = Math.round(performance.now() - bootStarted);
      let firstClient = '';
      await vi.waitFor(
        async () => {
          await worker.evaluate(async (value) => {
            const stored = await chrome.storage.local.get('holaday.access_token');
            if (stored['holaday.access_token'] !== value)
              await chrome.storage.local.set({ 'holaday.access_token': value });
          }, token);
          const ids = await first.process.request<string[]>({ op: 'extensions', userId: owner });
          expect(ids).toHaveLength(1);
          firstClient = ids[0]!;
        },
        { timeout: 25_000, interval: 250 },
      );
      let exports = 0;
      let effects = 0;
      let exportStarted!: () => void;
      const exporting = new Promise<void>((resolve) => {
        exportStarted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseExport = resolve;
      });
      siteServer = createServer(async (req, res) => {
        if (req.url === '/export') {
          exports++;
          exportStarted();
          await gate;
          if (!res.destroyed) {
            res.writeHead(200, {
              'content-type': 'text/csv',
              'content-disposition': 'attachment; filename="report.csv"',
            });
            res.end('channel,amount\nweb,10.00\n');
          }
        } else if (req.url === '/effect' && req.method === 'POST') {
          effects++;
          res.writeHead(200);
          res.end('applied');
        } else {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(
            `<title>Native recovery target</title><label>Notes <input id="notes" value="keep original"></label><label>Edit <input id="edit" value="before"></label><a id="export" href="/export">Export report</a><button id="effect" onclick="fetch('/effect',{method:'POST'}).then(()=>document.querySelector('#status').textContent='applied')">Apply test action</button><p id="status">ready</p>`,
          );
        }
      });
      await new Promise<void>((resolve) => siteServer!.listen(0, '127.0.0.1', resolve));
      const address = siteServer.address();
      if (!address || typeof address === 'string') throw new Error('No native site address');
      const site = `http://127.0.0.1:${address.port}`;
      const target = await context.newPage();
      await target.goto(`${site}/target`);
      const normal = await context.newPage();
      await normal.goto(`${site}/normal`);
      await normal.locator('#notes').fill('normal user input preserved');
      await normal.bringToFront();
      const userTab = await worker.evaluate(
        async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
      );
      const repo = new TaskRepository(probe.db);
      const unknown = newExternalId('task');
      await repo.insertTask(
        { taskId: unknown, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
        {
          userId: 7,
          intent: 'Export one report, do not repeat it after uncertainty',
          sourceContext: { browserSource: 'local-chrome' },
        },
      );
      await probe.db
        .update(tasks)
        .set({ createdAt: new Date(Date.now() - 180_000) })
        .where(eq(tasks.externalId, unknown));
      const listed = result(
        await tool(first.process, owner, {
          taskId: unknown,
          kind: 'tabs',
          extensionClientId: firstClient,
        }),
      );
      const tabs = listed.tabs as Array<{ tabId: number; selectionId: string; url?: string }>;
      const targetId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
        target.url(),
      );
      const selected = tabs.find((tab) => tab.tabId === targetId)!;
      expect(selected).toBeDefined();
      let oldSessionId = '';
      const sessions = new LocalChromeTaskSessions();
      const session = sessions.start(
        owner,
        unknown,
        {
          tabId: selected.tabId,
          expectedUrl: target.url(),
          selectionId: selected.selectionId,
          extensionClientId: firstClient,
        },
        async (userId, options) => {
          const reply = await tool(first.process, userId, options);
          if (options.args?.session?.op === 'open' && reply.ok)
            oldSessionId = String((reply.result as { sessionId?: string }).sessionId ?? '');
          return reply;
        },
        undefined,
        {
          viewportV2: false,
          observationV2: true,
          replayV1: false,
          routingV2: true,
          collaborationV2: true,
        },
        { taskFilesV1: true },
      );
      expect(await session.client.open(session.selection)).toMatchObject({ ok: true });
      if (process.env.HOLADAY_NATIVE_STALE_BINDING_PROBE === '1') {
        const stalePreparedAction = {
          kind: 'click' as const,
          selector: {
            description: 'Apply test action',
            strategies: [{ kind: 'css' as const, value: '#effect' }],
            selfHeal: false,
            scope: { timeoutMs: 5000 },
          },
        };
        const prepared = await session.client.describe(
          stalePreparedAction,
          session.client.revision,
        );
        expect(prepared.ok).toBe(true);
        const oldBinding = prepared.ok ? prepared.target : undefined;
        expect(oldBinding).toBeDefined();
        const crashed = await first.process.stop();
        const restarted = await backend(first.ready);
        let newConnection = '';
        await vi.waitFor(
          async () => {
            const ids = await restarted.process.request<string[]>({
              op: 'extensions',
              userId: owner,
            });
            expect(ids).toHaveLength(1);
            newConnection = ids[0]!;
            expect(newConnection).not.toBe(firstClient);
          },
          { timeout: 45_000, interval: 250 },
        );
        const oldAction = await tool(restarted.process, owner, {
          taskId: unknown,
          kind: 'session',
          extensionClientId: newConnection,
          args: {
            session: {
              op: 'act',
              sessionId: oldSessionId,
              action: stalePreparedAction,
              binding: {
                token: oldBinding!.token,
                observationRevision: oldBinding!.observationRevision,
              },
            },
          },
        });
        Object.assign(evidence, {
          mode: 'unconsumed-binding-across-new-connection',
          node: process.version,
          firstClient,
          nextClient: newConnection,
          childPids: [first.ready.pid, restarted.ready.pid],
          crash: crashed,
          oldAction,
          effects,
          exports,
        });
        await writeFile(join(artifacts, 'native-evidence.json'), JSON.stringify(evidence, null, 2));
        expect(oldAction.result ?? oldAction).toMatchObject({
          ok: false,
          actionOutcome: 'not_applied',
        });
        expect(effects).toBe(0);
        return;
      }
      const click = {
        kind: 'click' as const,
        selector: {
          description: 'Export report',
          strategies: [{ kind: 'css' as const, value: '#export' }],
          selfHeal: false,
          scope: { timeoutMs: 5000 },
        },
      };
      expect(await session.client.describe(click, session.client.revision)).toMatchObject({
        ok: true,
      });
      const held = session.client.openFileDownload(click, session.client.revision).then(
        (reply) => ({ lost: false, reply }),
        (error: unknown) => ({
          lost: true,
          reason: error instanceof Error ? error.message : 'transport error',
        }),
      );
      await exporting;
      expect(exports).toBe(1);
      await normal.locator('#notes').fill('typing while export result is unknown');
      const crash = await first.process.stop();
      expect(crash.signal).toBe('SIGKILL');
      const receipt = await held;
      Object.assign(evidence, { receipt, exports, crash });
      await writeFile(join(artifacts, 'native-evidence.json'), JSON.stringify(evidence, null, 2));
      expect(receipt).toMatchObject({
        lost: false,
        reply: { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' },
      });
      releaseExport!();
      const second = await backend(first.ready);
      expect(second.ready.pid).not.toBe(first.ready.pid);
      expect(second.ready.wsPort).toBe(first.ready.wsPort);
      const reconnectStarted = performance.now();
      let nextClient = '';
      // No token writes or explicit reconnect nudges after the crash.
      await vi.waitFor(
        async () => {
          const ids = await second.process.request<string[]>({ op: 'extensions', userId: owner });
          expect(ids).toHaveLength(1);
          nextClient = ids[0]!;
          expect(nextClient).not.toBe(firstClient);
        },
        { timeout: 45_000, interval: 250 },
      );
      const reconnectMs = Math.round(performance.now() - reconnectStarted);
      const staleConnection = await tool(second.process, owner, {
        taskId: unknown,
        kind: 'session',
        extensionClientId: firstClient,
        args: { session: { op: 'observe', sessionId: oldSessionId } },
      });
      expect(staleConnection).toMatchObject({
        ok: false,
        error: { code: 'target_extension_unavailable' },
      });
      const staleSession = result(
        await tool(second.process, owner, {
          taskId: unknown,
          kind: 'session',
          extensionClientId: nextClient,
          args: { session: { op: 'observe', sessionId: oldSessionId } },
        }),
      );
      expect(staleSession).toMatchObject({ ok: false, error: 'session_unavailable' });
      const frames = await ownerWebsocket(second.ready, token);
      await vi.waitFor(() =>
        expect(frames).toContainEqual(
          expect.objectContaining({
            type: 'server.supercar.awaiting_user',
            taskId: unknown,
            awaitingKind: 'browser_action',
            question: expect.stringContaining('结果尚未核实'),
          }),
        ),
      );
      expect(frames.some((frame) => frame.type === 'server.task.dispatch')).toBe(false);
      expect(exports).toBe(1);
      expect(await normal.locator('#notes').inputValue()).toBe(
        'typing while export result is unknown',
      );
      expect(await target.locator('#notes').inputValue()).toBe('keep original');
      expect(
        await worker.evaluate(
          async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
        ),
      ).toBe(userTab);
      const freshTask = newExternalId('task');
      await repo.insertTask(
        { taskId: freshTask, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
        {
          userId: 7,
          intent: 'Verify human edit blocks stale actions',
          sourceContext: { browserSource: 'local-chrome' },
        },
      );
      const freshTabs = result(
        await tool(second.process, owner, {
          taskId: freshTask,
          kind: 'tabs',
          extensionClientId: nextClient,
        }),
      ).tabs as typeof tabs;
      const freshTarget = freshTabs.find((tab) => tab.tabId === targetId)!;
      const command = async (
        taskId: string,
        value: NonNullable<ExtensionToolCallOptions['args']>['session'],
      ) =>
        result(
          await tool(second.process, owner, {
            taskId,
            kind: 'session',
            extensionClientId: nextClient,
            args: { session: value },
          }),
        );
      const open = async (
        taskId: string,
        tabId: number,
        selectionId: string,
        url: string,
        grantedOrigins: string[] = [site],
      ) => {
        const deadline = Date.now() + 12_000;
        for (;;) {
          const opened = await command(taskId, {
            op: 'open',
            target: { tabId, selectionId, expectedUrl: url },
            protocol: {
              ...USER_BROWSER_PROTOCOL,
              capabilities: [
                ...USER_BROWSER_PROTOCOL.capabilities,
                USER_BROWSER_ACTIVITY_CAPABILITY,
                USER_BROWSER_DOWNLOAD_CAPABILITY,
              ],
            },
            grantedOrigins,
          });
          if (opened.ok === true) return opened;
          if (opened.error !== 'browser_busy' || Date.now() >= deadline)
            throw new Error(`Fresh session refused: ${JSON.stringify(opened)}`);
          // Only an acknowledged pre-dispatch busy response is safe to retry.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      };
      const fresh = await open(freshTask, freshTarget.tabId, freshTarget.selectionId, target.url());
      const action = {
        kind: 'click' as const,
        selector: {
          description: 'Apply test action',
          strategies: [{ kind: 'css' as const, value: '#effect' }],
          selfHeal: false,
          scope: { timeoutMs: 5000 },
        },
      };
      const observed = fresh.observation as { observationRevision: number };
      const described = await command(freshTask, {
        op: 'describe',
        sessionId: String(fresh.sessionId),
        action,
        observationRevision: observed.observationRevision,
      });
      expect(described.ok).toBe(true);
      const binding = described.target as { token: string; observationRevision: number };
      await target.locator('#edit').fill('human changed this page');
      const staleAction = await command(freshTask, {
        op: 'act',
        sessionId: String(fresh.sessionId),
        action,
        binding: { token: binding.token, observationRevision: binding.observationRevision },
      });
      expect(staleAction).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
      expect(effects).toBe(0);
      expect(
        await command(freshTask, { op: 'close', sessionId: String(fresh.sessionId) }),
      ).toMatchObject({ ok: true });
      await repo.persistVisionOutcome(freshTask, { status: 'cancelled', tickCount: 0 });
      const cancelTask = newExternalId('task');
      await repo.insertTask(
        { taskId: cancelTask, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
        {
          userId: 7,
          intent: 'Verify cancel blocks a previously prepared action',
          sourceContext: { browserSource: 'local-chrome' },
        },
      );
      const cancelPage = await context.newPage();
      await cancelPage.goto(`${site}/cancel`);
      await normal.bringToFront();
      const cancelTabId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
        cancelPage.url(),
      );
      const cancelTabs = result(
        await tool(second.process, owner, {
          taskId: cancelTask,
          kind: 'tabs',
          extensionClientId: nextClient,
        }),
      ).tabs as typeof tabs;
      const cancelTarget = cancelTabs.find((tab) => tab.tabId === cancelTabId)!;
      const cancelSession = await open(
        cancelTask,
        cancelTarget.tabId,
        cancelTarget.selectionId,
        cancelPage.url(),
      );
      const cancelObserved = cancelSession.observation as { observationRevision: number };
      const cancelDescription = await command(cancelTask, {
        op: 'describe',
        sessionId: String(cancelSession.sessionId),
        action,
        observationRevision: cancelObserved.observationRevision,
      });
      expect(cancelDescription.ok).toBe(true);
      expect(
        await second.process.request({ op: 'cancel', userId: owner, taskId: cancelTask }),
      ).toEqual({ persisted: true });
      const cancelBinding = cancelDescription.target as typeof binding;
      const logBoundary = logs.length;
      const cancelledAction = await tool(second.process, owner, {
        taskId: cancelTask,
        timeoutMs: 1000,
        kind: 'session',
        extensionClientId: nextClient,
        args: {
          session: {
            op: 'act',
            sessionId: String(cancelSession.sessionId),
            action,
            binding: {
              token: cancelBinding.token,
              observationRevision: cancelBinding.observationRevision,
            },
          },
        },
      });
      // Stopped tasks intentionally emit no tool receipt: a late reply must not
      // resurrect cancelled work. Check the drop and a live connection as well
      // as the bounded timeout, rather than inventing a task_stopped wire code.
      expect(cancelledAction).toMatchObject({ ok: false, error: { code: 'timeout' } });
      await vi.waitFor(() =>
        expect(
          logs
            .slice(logBoundary)
            .some((line) => line.includes('[holaday] dropped controlled extension tool result')),
        ).toBe(true),
      );
      expect(
        await tool(second.process, owner, {
          taskId: newExternalId('task'),
          kind: 'tabs',
          extensionClientId: nextClient,
        }),
      ).toMatchObject({ ok: true });
      expect(effects).toBe(0);
      expect(
        await repo.persistVisionOutcome(cancelTask, {
          status: 'completed',
          summary: 'late callback',
          tickCount: 1,
        }),
      ).toEqual({ persisted: false });
      const [cancelled] = await probe.db
        .select()
        .from(tasks)
        .where(eq(tasks.externalId, cancelTask));
      expect(cancelled?.status).toBe('cancelled');
      if (process.env.HOLADAY_NATIVE_PUBLIC_FORM === '1') {
        const publicTask = newExternalId('task');
        await repo.insertTask(
          { taskId: publicTask, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
          {
            userId: 7,
            intent: 'Prepare a public form without submitting',
            sourceContext: { browserSource: 'local-chrome' },
          },
        );
        const publicPage = await context.newPage();
        let postAttempts = 0;
        await publicPage.route('**/*', async (route) => {
          if (route.request().method() === 'POST') {
            postAttempts++;
            await route.abort();
          } else await route.continue();
        });
        await publicPage.goto('https://httpbin.org/forms/post', {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await publicPage.locator('input[name="custname"]').waitFor();
        await normal.bringToFront();
        const publicTabId = await worker.evaluate(
          async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
          publicPage.url(),
        );
        const publicTab = (
          result(
            await tool(second.process, owner, {
              taskId: publicTask,
              kind: 'tabs',
              extensionClientId: nextClient,
            }),
          ).tabs as typeof tabs
        ).find((tab) => tab.tabId === publicTabId)!;
        expect(publicTab).toBeDefined();
        const opened = await open(
          publicTask,
          publicTab.tabId,
          publicTab.selectionId,
          publicPage.url(),
          ['https://httpbin.org'],
        );
        const publicAction = {
          kind: 'type' as const,
          selector: {
            description: 'Customer name',
            scope: { timeoutMs: 5000 },
            strategies: [{ kind: 'css' as const, value: 'input[name="custname"]' }],
            selfHeal: false,
          },
          payload: { text: 'HOLA DAY recovery QA' },
        };
        const publicDescription = await command(publicTask, {
          op: 'describe',
          sessionId: String(opened.sessionId),
          action: publicAction,
          observationRevision: (opened.observation as typeof observed).observationRevision,
        });
        expect(publicDescription.ok).toBe(true);
        const publicBinding = publicDescription.target as typeof binding;
        const prepared = await command(publicTask, {
          op: 'act',
          sessionId: String(opened.sessionId),
          action: publicAction,
          binding: {
            token: publicBinding.token,
            observationRevision: publicBinding.observationRevision,
          },
        });
        expect(prepared).toMatchObject({ ok: true });
        expect(await publicPage.locator('input[name="custname"]').inputValue()).toBe(
          'HOLA DAY recovery QA',
        );
        expect(postAttempts).toBe(0);
        await publicPage.screenshot({
          path: join(artifacts, 'public-form-prepared-not-submitted.png'),
          fullPage: true,
        });
        expect(
          await command(publicTask, { op: 'close', sessionId: String(opened.sessionId) }),
        ).toMatchObject({ ok: true });
        await repo.persistVisionOutcome(publicTask, { status: 'cancelled', tickCount: 0 });
        evidence.publicForm = {
          url: publicPage.url(),
          boundInputVerified: true,
          postAttempts,
          modelCalls: 0,
          submitted: false,
        };
      }
      await target.screenshot({ path: join(artifacts, 'native-target-after-reconnect.png') });
      await normal.screenshot({ path: join(artifacts, 'normal-input-preserved.png') });
      await writeFile(join(artifacts, 'browser-console.json'), JSON.stringify(logs, null, 2));
      Object.assign(evidence, {
        node: process.version,
        chromium: context.browser()?.version(),
        childPids: [first.ready.pid, second.ready.pid],
        crash,
        firstClient,
        nextClient,
        automaticReconnect: true,
        reconnectMs,
        workerReadyMs,
        exports,
        effects,
        staleConnection,
        staleSession,
        interruptedReceipt: 'unknown; never replayed',
        humanEditRejected: staleAction,
        cancellation: {
          droppedAfterStop: true,
          receipt: cancelledAction,
          connectionStillLive: true,
        },
        lateCompletionRefused: true,
        normalInputPreserved: true,
        inputStillTargetsOriginalTab: true,
      });
    }, 180_000);
  },
);
