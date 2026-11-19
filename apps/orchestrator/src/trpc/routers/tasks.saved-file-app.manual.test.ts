/** Opt-in candidate UI preparation. Task mutations and model calls remain disabled. */
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
import { users } from '../../db/schema/users.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import * as storage from '../../files/storage-provider.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { openIsolatedMysqlProbe } from '../../testing/isolated-mysql-probe.js';
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

it.runIf(process.env.HOLADAY_SAVED_FILE_APP_PREPARE === '1')(
  'serves the exact frozen candidate for upload preparation without creating tasks',
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
        preparationOnly: true,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
    const manifestPath = resolve(process.env.HOLADAY_PREPARE_CANDIDATE ?? '');
    expect(manifestPath.startsWith('/private/tmp/pr360-readiness/candidate-')).toBe(true);
    const candidate = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(candidate.executionAllowed).toBe(false);
    expect(candidate.sourceCommit).toBe('bbcf442204e860aff2caceb41fa867a7e6cdfdcd');
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
    const ledgerBefore = hash(await readFile(ledger));
    const probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      artifactPath: join(out, 'mysql-evidence.json'),
    });
    close = () => probe.close();
    boundary.current = probe.db;
    const identities = { github: 'usr_saved_app_github', sheets: 'usr_saved_app_sheets' };
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
    let blockedModelCalls = 0;
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
      metadata: {
        provider: 'alibaba-model-studio',
        model: 'preparation-disabled',
        region: 'cn',
        deploymentScope: 'china_mainland',
        endpointKind: 'public',
        protocol: 'messages',
      },
      async create() {
        blockedModelCalls++;
        throw new Error('Model execution disabled in preparation');
      },
    }));
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      BROWSER_EXECUTOR: 'unified',
      BROWSER_TASK_FILES_V1: true,
      TOOL_ROUTER_V2: false,
      QWEN_CORE_ALLOWLIST: Object.values(identities).join(','),
      QWEN_CORE_ROLLOUT_MODE: 'internal',
      QWEN_CORE_ENABLED_LANES: 'browser',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: '',
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
    const blockedMutations: unknown[] = [];
    app.use('/api/trpc', express.json(), async (req, res, next) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      const body = req.body as Record<string, unknown>;
      const values = req.query.batch === '1' ? Object.values(body ?? {}) : [body];
      const safe = values.map((value) => {
        if (!value || typeof value !== 'object') return {};
        const data = value as Record<string, unknown>;
        return Object.fromEntries(
          [
            'intent',
            'fileIds',
            'localChrome',
            'browserHomeSession',
            'mode',
            'expertMode',
            'clientRequestId',
            'viewportProfile',
          ].flatMap((key) => (key in data ? [[key, data[key]]] : [])),
        );
      });
      const record = {
        atUTC: new Date().toISOString(),
        procedures: req.path,
        inputs: safe,
        executionAllowed: false,
      };
      blockedMutations.push(record);
      await appendFile(join(out, 'blocked-mutations.ndjson'), `${JSON.stringify(record)}\n`, {
        mode: 0o600,
      });
      const error = {
        error: {
          message: '验收准备中，暂不提交任务。输入和附件已保留。',
          code: -32012,
          data: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
        },
      };
      res.status(412).json(req.query.batch === '1' ? values.map(() => error) : error);
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
        blockedMutations,
        blockedModelCalls,
        externalFetches,
        drain: drain.snapshot(),
        modelExecutionEnabled: false,
        actualModelCalls: 0,
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
    await snapshot('preparation-ready');
    await writeFile(
      join(out, 'ready.json'),
      `${JSON.stringify(
        {
          origin,
          bootstrap: Object.fromEntries(
            Object.keys(identities).map((key) => [key, `${origin}/operator-bootstrap/${key}`]),
          ),
          preparationOnly: true,
          candidateSource: candidate.sourceCommit,
          runtimeInputs: inputs.length,
          workbenchSHA256: ui.sha256,
          indexSHA256: hash(await readFile(join(uiDir, 'index.html'))),
          modelExecutionEnabled: false,
          createsRejectedBeforeRouter: true,
          extensionRebuilt: false,
          productionChanged: false,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    console.log('SAVED_FILE_APP_PREPARATION_READY; see owned ready.json');
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 1000));
      const command = await readFile(join(out, 'command.json'), 'utf8').catch(() => '');
      if (command && JSON.parse(command).op === 'stop') {
        const state = await snapshot('operator-stopped');
        expect(state.blockedModelCalls).toBe(0);
        expect(state.externalFetches).toEqual([]);
        expect(hash(await readFile(ledger))).toBe(ledgerBefore);
        expect(state.drain).toMatchObject({ active: 0, unknown: 0 });
        const counts = state.counts as unknown as Array<{
          tasks: number;
          events: number;
          steps: number;
          tasksUsed: number;
        }>;
        expect(Number(counts[0]!.tasks)).toBe(0);
        expect(Number(counts[0]!.events)).toBe(0);
        expect(Number(counts[0]!.steps)).toBe(0);
        expect(Number(counts[0]!.tasksUsed)).toBe(0);
        await writeFile(
          join(out, 'final-preparation.json'),
          `${JSON.stringify({ ...state, ledgerUnchanged: true }, null, 2)}\n`,
          { mode: 0o600 },
        );
        return;
      }
      await snapshot('preparing-no-tasks');
    }
    throw new Error('Preparation deadline reached; do not restart without inspection');
  },
  12 * 60_000,
);
