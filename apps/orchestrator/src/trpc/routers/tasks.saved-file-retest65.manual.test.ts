/** Opt-in GitHub saved-input retest; requires the explicit eight-call policy and new upload binding. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import express from 'express';
import { afterAll, expect, it, vi } from 'vitest';
import { signAccessToken } from '../../auth/jwt.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { DB } from '../../db/client.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import * as storage from '../../files/storage-provider.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { openIsolatedMysqlProbe } from '../../testing/isolated-mysql-probe.js';
import { captureTaskHistoryCloseout } from '../../testing/task-history-closeout.js';
import * as extensionWs from '../../ws/server.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
// Preserve the actual WS server/handlers; limit this fixture's listener to loopback.
vi.mock('ws', async (original) => {
  const actual = await original<typeof import('ws')>();
  return {
    ...actual,
    WebSocketServer: class extends actual.WebSocketServer {
      constructor(options?: ConstructorParameters<typeof actual.WebSocketServer>[0]) {
        super({ ...options, host: '127.0.0.1' });
      }
    },
  };
});
vi.mock('../../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('Preparation SQL is not ready');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));
const root = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const originalEnv = { ...env };
let close: (() => Promise<void>) | undefined;
afterAll(async () => {
  await close?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Object.assign(env, originalEnv);
  reloadFeatureFlagsForTest();
});

it.runIf(process.env.HOLADAY_SAVED_FILE_RETEST65 === '1')(
  'serves the frozen candidate with explicitly approved real saved-material tasks',
  async () => {
    const runtime = resolve(process.env.HOLADAY_REAL_SITE_RUNTIME ?? '');
    expect(runtime.startsWith(join(root, '.superpowers/sdd/'))).toBe(true);
    const attempt = process.env.HOLADAY_REAL_SITE_ATTEMPT ?? '';
    expect(attempt).toMatch(/^joint-app-saved-files-[a-z0-9-]+$/);
    const out = join(runtime, attempt);
    await mkdir(out, { recursive: true, mode: 0o700 });
    await writeFile(
      join(out, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        startedAtUTC: new Date().toISOString(),
        preparationOnly: false,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
    const manifestPath = resolve(process.env.HOLADAY_PREPARE_CANDIDATE ?? '');
    expect(manifestPath.startsWith('/private/tmp/pr360-readiness/candidate-')).toBe(true);
    const candidate = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(candidate.executionAllowed).toBe(false);
    expect(candidate.sourceCommit).toBe('4639355e3b76fd9a224f93522738f495d8f67577');
    const candidateRoot = dirname(manifestPath);
    const inputBytes = await readFile(join(candidateRoot, candidate.runtimeInputs));
    expect(hash(inputBytes)).toBe(candidate.runtimeInputsSHA256);
    const inputs = JSON.parse(inputBytes.toString()) as Array<{ path: string; sha256: string }>;
    expect(inputs.length).toBe(1832);
    for (const input of inputs) {
      const path = resolve(root, input.path);
      expect(path.startsWith(`${root}/`)).toBe(true);
      expect(hash(await readFile(path)), input.path).toBe(input.sha256);
    }
    const ui = candidate.artifacts.workbench;
    const archive = join(candidateRoot, ui.archive);
    expect(hash(await readFile(archive))).toBe(ui.sha256);
    const uiManifest = await readFile(join(candidateRoot, ui.fileManifest));
    expect(hash(uiManifest)).toBe(ui.fileManifestSHA256);
    const uiDir = join(out, 'workbench');
    const extracted = spawnSync(
      'python3',
      [
        '-c',
        "from pathlib import PurePosixPath\nimport sys,zipfile,stat\nwith zipfile.ZipFile(sys.argv[1]) as z:\n es=z.infolist()\n assert len(es)<5000 and sum(e.file_size for e in es)<256*1024*1024\n for e in es:\n  p=PurePosixPath(e.filename)\n  assert not p.is_absolute() and '..' not in p.parts and chr(92) not in e.filename and not stat.S_ISLNK(e.external_attr>>16)\n assert z.testzip() is None\n z.extractall(sys.argv[2])",
        archive,
        uiDir,
      ],
      { encoding: 'utf8' },
    );
    expect(extracted.status, extracted.stderr).toBe(0);
    for (const file of JSON.parse(uiManifest.toString()) as Array<{
      path: string;
      sha256: string;
    }>) {
      const path = resolve(uiDir, file.path);
      expect(path.startsWith(`${uiDir}/`)).toBe(true);
      expect(hash(await readFile(path)), file.path).toBe(file.sha256);
    }
    const ledger = join(runtime, 'model-relay/requests.json');
    const baselineLedger = JSON.parse(await readFile(ledger, 'utf8'));
    expect(baselineLedger.maxAttempts).toBe(65);
    expect(baselineLedger.attempts).toHaveLength(57);
    const policyPath = join(runtime, 'model-relay/provider-audit-policy.json');
    const initialPolicy = JSON.parse(await readFile(policyPath, 'utf8'));
    expect(initialPolicy.retestExtension.approved).toBe(true);
    expect(initialPolicy.retestExtension.automaticRetries).toBe(0);
    expect(initialPolicy.retestExtension.runtimeSourceCommit).toBe(candidate.sourceCommit);
    const descriptor = JSON.parse(
      await readFile(
        join(runtime, 'saved65-activation-20261119-v1/provider-descriptor.json'),
        'utf8',
      ),
    );
    const { createExistingModelFetch } = await import(
      /* @vite-ignore */ new URL(`file://${join(runtime, 'helpers/existing-model-fetch.mjs')}`).href
    );
    let scope = 'github-pr360' as const;
    const relayFetch = createExistingModelFetch(descriptor, () => scope);
    let actualModelCalls = 0;
    let transportFailed = false;
    const originalAdapter = messages.createQwenMessagesAdapter;
    const probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      artifactPath: join(out, 'mysql-evidence.json'),
    });
    close = () => probe.close();
    boundary.current = probe.db;
    const identities = { github: 'usr_saved65_app_github' };
    await probe.db.insert(users).values(
      Object.values(identities).map((externalId, index) => ({
        id: 7 + index,
        externalId,
        email: `${externalId}@example.test`,
        passwordHash: 'not-a-login-credential',
        plan: 'pro' as const,
        modelDataRegion: 'cn' as const,
      })),
    );
    const fileRoot = join(out, 'files');
    vi.spyOn(storage, 'getSharedStorageProvider').mockReturnValue(
      new storage.LocalStorageProvider(fileRoot, logger),
    );
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation((input) => {
      const adapter = originalAdapter({ ...input, fetchImpl: relayFetch });
      return {
        ...adapter,
        create: async (request, options) => {
          if (transportFailed) throw new Error('AUTOMATIC_MODEL_RETRY_DISABLED');
          if (actualModelCalls >= 8) throw new Error('APPROVED_EIGHT_CALL_BUDGET_EXHAUSTED');
          const started = Date.now();
          actualModelCalls++;
          const record = async (phase: string) =>
            appendFile(
              join(out, 'model-observations.ndjson'),
              `${JSON.stringify({
                phase,
                scope,
                atUTC: new Date().toISOString(),
                call: actualModelCalls,
                elapsedMs: Date.now() - started,
              })}\n`,
              { mode: 0o600 },
            );
          await record('started');
          try {
            const response = await adapter.create(
              { ...request, maxTokens: Math.min(request.maxTokens, 4096) },
              { ...options, maxRetries: 0 },
            );
            await record('received');
            return response;
          } catch (error) {
            transportFailed = true;
            await record('failed');
            throw error;
          }
        },
      };
    });
    Object.assign(env, descriptor.models, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      BROWSER_EXECUTOR: 'unified',
      BROWSER_TASK_FILES_V1: true,
      TOOL_ROUTER_V2: false,
      QWEN_CORE_ALLOWLIST: Object.values(identities).join(','),
      QWEN_CORE_ROLLOUT_MODE: 'internal',
      QWEN_CORE_ENABLED_LANES: 'browser',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'remote-credential-reference-only',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL: descriptor.baseURL,
      DASHSCOPE_API_KEY: '',
    });
    for (const key of [
      'USER_BROWSER_ROUTING_V2',
      'BROWSER_HOME_ENABLED',
      'BROWSER_SESSION_VAULT_ENABLED',
    ])
      vi.stubEnv(key, 'false');
    reloadFeatureFlagsForTest();
    const nativeFetch = globalThis.fetch;
    const externalFetches: string[] = [];
    vi.stubGlobal(
      'fetch',
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? String(input) : input.url,
        );
        if (url.hostname !== '127.0.0.1') {
          externalFetches.push(url.origin);
          throw new Error('External request forbidden');
        }
        return nativeFetch(input, init);
      },
    );
    const drain = new ExecutionDrain();
    drain.open();
    const admission = {
      drain,
      tick() {},
      runRoot: <T>(action: (life: OperationLifetime) => Promise<T>) =>
        startOwnedOperation(drain, 'request', (owner) => action({ drain, owner }), {
          errorOutcome: 'unknown',
        }),
    };
    const ws = extensionWs.createWsServer(0, { executionDrain: admission });
    await ws.ready;
    const wsAddress = ws.wss.address();
    if (!wsAddress || typeof wsAddress === 'string') throw new Error('Missing owned WS');
    const wsPort = wsAddress.port;
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:*; worker-src 'self' blob:",
      );
      next();
    });
    let armed = false;
    const submissions: unknown[] = [];
    const submittedScopes = new Set<string>();
    app.use('/api/trpc', express.json(), async (req, res, next) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      const batched = req.query.batch === '1';
      const reject = (message: string) => {
        const payload = {
          error: {
            message,
            code: -32012,
            data: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
          },
        };
        return res.status(412).json(batched ? [payload] : payload);
      };
      const inputs = batched ? Object.values(req.body ?? {}) : [req.body];
      if (!armed || req.path !== '/tasks.create' || inputs.length !== 1) {
        reject('本机验收尚未准入或超出本项任务范围。输入和附件已保留。');
        return;
      }
      const data = inputs[0] as { fileIds?: unknown; intent?: unknown };
      const policy = JSON.parse(await readFile(policyPath, 'utf8'));
      const match = Object.entries(policy.inputBindings).find(
        ([, value]) =>
          Array.isArray(data.fileIds) &&
          data.fileIds.length === 1 &&
          (value as { fileId: string }).fileId === data.fileIds[0],
      );
      if (!match || submittedScopes.has(match[0]) || typeof data.intent !== 'string') {
        reject('仅接受已核实的原件，每项任务只提交一次。');
        return;
      }
      const active = (await probe.db.select().from(tasks)).some(
        (task) => !['completed', 'failed', 'cancelled'].includes(task.status),
      );
      if (active) {
        reject('前一任务仍在执行或结果未知，禁止并发与重放。');
        return;
      }
      scope = match[0] as typeof scope;
      submittedScopes.add(scope);
      const entry = {
        atUTC: new Date().toISOString(),
        scope,
        procedures: req.path,
        input: data,
        executionAllowed: true,
      };
      submissions.push(entry);
      await appendFile(join(out, 'submissions.ndjson'), `${JSON.stringify(entry)}\n`, {
        mode: 0o600,
      });
      next();
    });
    app.use('/api', createHttpApp({ planner: {} as never, executionDrain: admission }));
    app.use(express.static(uiDir));
    const tokens = Object.fromEntries(
      await Promise.all(
        Object.entries(identities).map(async ([key, sub]) => [
          key,
          await signAccessToken({ sub, plan: 'pro' }),
        ]),
      ),
    );
    app.get('/operator-bootstrap/:site', (req, res) => {
      const token = tokens[req.params.site];
      if (!token) {
        res.sendStatus(404);
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res
        .type('html')
        .send(
          `<!doctype html><script>localStorage.setItem('holaday.access_token',${JSON.stringify(token)});location.replace('/');</script>`,
        );
    });
    app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: uiDir }));
    const server = createServer(app);
    const ingress = new Set<ReturnType<typeof connect>>();
    server.on('upgrade', (req, socket, head) => {
      socket.on('error', () => socket.destroy());
      if (req.url !== '/ws') {
        socket.destroy();
        return;
      }
      const upstream = connect(wsPort, '127.0.0.1', () => {
        upstream.write(
          `${req.method} / HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((s, h, i) => s + h + (i % 2 ? '\r\n' : ': '), '')}\r\n`,
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      ingress.add(upstream);
      upstream.on('close', () => {
        ingress.delete(upstream);
        socket.destroy();
      });
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing owned HTTP');
    const origin = `http://127.0.0.1:${address.port}`;
    async function snapshot(phase: string) {
      const [counts] = await probe.db.execute(
        sql`SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM task_events) AS events, (SELECT COUNT(*) FROM task_steps) AS steps, (SELECT COALESCE(SUM(tasks_used),0) FROM task_quotas) AS tasksUsed`,
      );
      const rows = await probe.db.select().from(taskFiles);
      const files = await Promise.all(
        rows.map(async (row) => {
          expect(row.storagePath.startsWith(`${fileRoot}/`)).toBe(true);
          return { ...row, actualSHA256: hash(await readFile(row.storagePath)) };
        }),
      );
      const state = {
        phase,
        atUTC: new Date().toISOString(),
        pid: process.pid,
        origin,
        wsPort,
        candidateSource: candidate.sourceCommit,
        runtimeInputs: inputs.length,
        workbenchSHA256: ui.sha256,
        files,
        counts,
        submissions,
        taskRows: await probe.db.select().from(tasks),
        taskSteps: (await probe.db.execute(sql`SELECT * FROM task_steps`))[0],
        taskEvents: (await probe.db.execute(sql`SELECT * FROM task_events`))[0],
        externalFetches,
        drain: drain.snapshot(),
        modelExecutionEnabled: armed,
        actualModelCalls,
        ledger: JSON.parse(await readFile(ledger, 'utf8')),
        websiteExports: 0,
        productionChanged: false,
      };
      await writeFile(join(out, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
      });
      return state;
    }
    close = async () => {
      await snapshot('closing');
      for (const upstream of ingress) upstream.destroy();
      await ws.close();
      await new Promise<void>((done, no) => server.close((error) => (error ? no(error) : done())));
      await probe.close();
    };
    await snapshot('live-app-awaiting-uploads');
    await writeFile(
      join(out, 'ready.json'),
      `${JSON.stringify(
        {
          origin,
          bootstrap: Object.fromEntries(
            Object.keys(identities).map((key) => [key, `${origin}/operator-bootstrap/${key}`]),
          ),
          preparationOnly: false,
          candidateSource: candidate.sourceCommit,
          runtimeInputs: inputs.length,
          workbenchSHA256: ui.sha256,
          indexSHA256: hash(await readFile(join(uiDir, 'index.html'))),
          modelExecutionEnabled: false,
          requiresOperatorArmAfterBindings: true,
          extensionRebuilt: false,
          productionChanged: false,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    console.log('SAVED_FILE_LIVE_APP_READY; see owned ready.json');
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 1000));
      const command = await readFile(join(out, 'command.json'), 'utf8').catch(() => '');
      if (command && JSON.parse(command).op === 'arm' && !armed) {
        const policy = JSON.parse(await readFile(policyPath, 'utf8'));
        expect(policy.retestExtension.approved).toBe(true);
        expect(Object.keys(policy.inputBindings)).toEqual(['github-pr360']);
        const rows = await probe.db.select().from(taskFiles);
        expect(rows).toHaveLength(1);
        for (const [key, value] of Object.entries(policy.inputBindings)) {
          const binding = value as {
            fileId: string;
            name: string;
            sizeBytes: number;
            sha256: string;
          };
          const row = rows.find((file) => file.externalId === binding.fileId);
          expect(row).toBeDefined();
          expect(key).toBe('github-pr360');
          expect(row!.userId).toBe(7);
          expect(row!.filename).toBe(binding.name);
          expect(row!.sizeBytes).toBe(binding.sizeBytes);
          expect(hash(await readFile(row!.storagePath))).toBe(binding.sha256);
        }
        armed = true;
        await snapshot('operator-armed');
      }
      if (command && JSON.parse(command).op === 'stop') {
        const state = await snapshot('operator-stopped');
        expect(state.externalFetches).toEqual([]);
        expect(state.ledger.maxAttempts).toBe(65);
        expect(state.ledger.attempts.length).toBeLessThanOrEqual(65);
        expect(state.ledger.attempts.slice(0, 57)).toEqual(baselineLedger.attempts);
        await writeFile(join(out, 'final-live.json'), `${JSON.stringify(state, null, 2)}\n`, {
          mode: 0o600,
        });
        return;
      }
      const observed = await snapshot(
        armed ? 'real-model-saved-file-acceptance' : 'awaiting-bindings-no-tasks',
      );
      if (
        armed &&
        observed.taskRows.length === 1 &&
        ['completed', 'failed', 'cancelled'].includes(observed.taskRows[0]!.status) &&
        observed.drain.active === 0 &&
        observed.drain.unknown === 0
      ) {
        const task = observed.taskRows[0]!;
        // Close the owned live observer before opening the history browser: one Chrome lane.
        await writeFile(join(out, 'ui-command.json'), '{"op":"stop"}\n', { mode: 0o600 });
        const uiDeadline = Date.now() + 10_000;
        let uiClosed = false;
        while (Date.now() < uiDeadline) {
          uiClosed = await readFile(join(out, 'ui-closed.json'), 'utf8')
            .then(JSON.parse)
            .then((value) => value.ownedBrowserClosed === true)
            .catch(() => false);
          if (uiClosed) break;
          await new Promise((done) => setTimeout(done, 100));
        }
        expect(uiClosed).toBe(true);
        await captureTaskHistoryCloseout({
          out,
          origin,
          token: tokens.github!,
          taskId: task.externalId,
          expectedStatus: task.status,
          files: observed.files.map((file) => ({
            fileId: file.externalId,
            filename: file.filename,
            bytes: file.sizeBytes,
            sha256: file.actualSHA256,
          })),
          readFromNewConnection: async () => {
            const beforeConnectionId = (probe.evidence.connectionIds as number[]).at(-1)!;
            await probe.reconnect((db) => {
              boundary.current = db;
            });
            const rows = await probe.db.select().from(tasks);
            expect(rows).toHaveLength(1);
            return {
              beforeConnectionId,
              afterConnectionId: (probe.evidence.connectionIds as number[]).at(-1)!,
              status: rows[0]!.status,
            };
          },
        });
        const final = await snapshot('terminal-evidence-captured-before-cleanup');
        expect(final.ledger.attempts.slice(0, 57)).toEqual(baselineLedger.attempts);
        expect(final.ledger.attempts.length).toBeLessThanOrEqual(65);
        await writeFile(join(out, 'final-live.json'), JSON.stringify(final, null, 2), {
          mode: 0o600,
        });
        return;
      }
    }
    throw new Error('Live acceptance deadline reached; preserve state and never replay');
  },
  32 * 60_000,
);
