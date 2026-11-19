/**
 * Explicit operator entry for the two approved real-site acceptance cases.
 * Uses actual SQL, quota, routing, model responses and extension WS registry.
 * It never launches/copies a browser profile or manufactures tool/model results.
 * Keep credentials and mutable receipts in the ignored, private runtime directory.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { afterAll, expect, it, vi } from 'vitest';
import { SelectedChromeClient } from '../../agent/supercar/selected-chrome-client.js';
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
import * as extensionWs from '../../ws/server.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock('../../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('Operator SQL boundary is not ready');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));

const enabled = process.env.HOLADAY_REAL_SITE_MANUAL === '1';
const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const originalEnv = { ...env };
let close: (() => Promise<void>) | undefined;
afterAll(async () => {
  await close?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.assign(env, originalEnv);
  reloadFeatureFlagsForTest();
});

it.runIf(enabled)(
  'serves the approved real-site App with real SQL/model/extension transport',
  async () => {
    expect(process.env.HOLADAY_SQL_PERSISTENCE_PROBE).toBe('1');
    const runtime = resolve(process.env.HOLADAY_REAL_SITE_RUNTIME ?? '');
    expect(runtime.startsWith(`${join(root, '.superpowers/sdd')}/`)).toBe(true);
    const attempt = process.env.HOLADAY_REAL_SITE_ATTEMPT ?? 'joint-app';
    expect(/^joint-app(?:-[a-z0-9]+)*$/.test(attempt)).toBe(true);
    const artifacts = join(runtime, attempt);
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    // An existing attempt must be inspected, never silently reset or replayed.
    await writeFile(
      join(artifacts, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        productionChanged: false,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    const downloadAudit = join(artifacts, 'native-download-operation-audit.ndjson');
    await writeFile(downloadAudit, '', { flag: 'wx', mode: 0o600 });
    let downloadAuditWriteFailed = false;
    const actualOpenDownload = SelectedChromeClient.prototype.openFileDownload;
    vi.spyOn(SelectedChromeClient.prototype, 'openFileDownload').mockImplementation(async function (
      this: SelectedChromeClient,
      ...args
    ) {
      const reply = await actualOpenDownload.call(this, ...args);
      const selector = JSON.stringify('selector' in args[0] ? (args[0].selector ?? null) : null);
      const state = reply.ok ? reply.downloadState : undefined;
      const error = reply.ok ? undefined : reply.error;
      await appendFile(
        downloadAudit,
        `${JSON.stringify({
          at: new Date().toISOString(),
          actualResultUnmodified: true,
          selectorSHA256: createHash('sha256').update(selector).digest('hex'),
          mentionsDownloadRawFile: selector.includes('Download raw file'),
          expectedRevision: args[1],
          ok: reply.ok,
          actionOutcome: reply.actionOutcome,
          error: error && /^[a-z0-9_]{1,80}$/.test(error) ? error : undefined,
          state: state?.status,
          reason: state && 'reason' in state ? state.reason : undefined,
          capturedBytes: state?.status === 'captured' ? state.metadata.sizeBytes : undefined,
          capturedSHA256: state?.status === 'captured' ? state.metadata.sha256 : undefined,
        })}\n`,
      ).catch(() => {
        downloadAuditWriteFailed = true;
      });
      return reply;
    });
    const descriptor = JSON.parse(
      await readFile(join(runtime, 'model-relay/descriptor.json'), 'utf8'),
    );
    const relay = await import(
      /* @vite-ignore */ pathToFileURL(join(runtime, 'helpers/existing-model-fetch.mjs')).href
    );
    const relayFetch = relay.createExistingModelFetch(descriptor, () => scope);
    let scope: 'github-pr360' | 'sheets-synthetic' = 'github-pr360';
    let lastDrainUncertainty = '';
    const probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      artifactPath: join(artifacts, 'mysql-evidence.json'),
    });
    close = () => probe.close();
    boundary.current = probe.db;
    const identities = { github: 'usr_acceptance_github', sheets: 'usr_acceptance_sheets' };
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
    const fileRoot = join(artifacts, 'files');
    await mkdir(fileRoot, { recursive: true, mode: 0o700 });
    vi.spyOn(storage, 'getSharedStorageProvider').mockReturnValue(
      new storage.LocalStorageProvider(fileRoot, logger),
    );
    Object.assign(env, descriptor.models, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      BROWSER_EXECUTOR: 'unified',
      BROWSER_TASK_FILES_V1: true,
      QWEN_CORE_ALLOWLIST: Object.values(identities).join(','),
      QWEN_CORE_ROLLOUT_MODE: 'internal',
      QWEN_CORE_ENABLED_LANES: 'browser',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'remote-credential-reference-only',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL: descriptor.baseURL,
      DASHSCOPE_API_KEY: '',
    });
    for (const [key, value] of Object.entries({
      USER_BROWSER_ROUTING_V2: 'true',
      BROWSER_TASK_TABS_ENABLED: 'true',
      BROWSER_LAUNCH_RECOVERY_ENABLED: 'false',
      BROWSER_SESSION_VAULT_ENABLED: 'false',
    }))
      vi.stubEnv(key, value);
    reloadFeatureFlagsForTest();
    const originalAdapter = messages.createQwenMessagesAdapter;
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation((input) => {
      const adapter = originalAdapter({ ...input, fetchImpl: relayFetch });
      return {
        ...adapter,
        create: (request, options) =>
          adapter.create(
            { ...request, maxTokens: Math.min(request.maxTokens, 4096) },
            { ...options, maxRetries: 0 },
          ),
      };
    });
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
    if (!wsAddress || typeof wsAddress === 'string') throw new Error('No owned WS listener');
    const wsPort = wsAddress.port;
    const uiDir = join(artifacts, 'workbench');
    const app = express();
    app.use('/api', createHttpApp({ planner: {} as never, executionDrain: admission }));
    app.use(express.static(uiDir));
    app.use(express.static(join(root, 'apps/web-workbench/public')));
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
    // Transparent localhost WS ingress; dispatch/auth remain the production server's.
    const ingress = new Set<ReturnType<typeof connect>>();
    server.on('upgrade', (req, socket, head) => {
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
    if (!address || typeof address === 'string') throw new Error('No owned App listener');
    const origin = `http://127.0.0.1:${address.port}`;
    close = async () => {
      await snapshot('closing');
      // Preserve local files/receipts. Close only this entry's owned listeners/schema.
      for (const upstream of ingress) upstream.destroy();
      await ws.close();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await probe.close();
    };
    async function build(
      cwd: string,
      args: string[],
      label: string,
      extra: Record<string, string> = {},
    ) {
      const run = spawnSync(process.execPath, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production', ...extra },
      });
      await writeFile(join(artifacts, `${label}.log`), (run.stdout ?? '') + (run.stderr ?? ''));
      expect(run.status, `See private ${label}.log`).toBe(0);
    }
    const extension = join(root, 'apps/extension');
    // A stable unpacked path preserves the extension ID across attempts. Keep
    // incident receipts in their original directory; replace only QA code.
    const extensionDir = join(runtime, 'joint-app/extension');
    await build(
      extension,
      [
        join(extension, 'node_modules/vite/bin/vite.js'),
        'build',
        '--outDir',
        extensionDir,
        '--emptyOutDir',
      ],
      'extension-build',
      {
        VITE_LOCAL_CHROME_QA: '1',
        VITE_LOCAL_CHROME_QA_REAL_SITES: 'github-sheets',
        VITE_WORKBENCH_URL: origin,
        VITE_ORCHESTRATOR_HTTP: origin,
        VITE_ORCHESTRATOR_WS: `ws://127.0.0.1:${wsPort}`,
      },
    );
    // Unsafe CDP loading may reuse a previous worker at the same unpacked
    // path/version. Bind the QA entry URL to its bytes; actual loaded assets
    // must still be verified against disk before any acceptance task is sent.
    const qaManifestPath = join(extensionDir, 'manifest.json');
    const qaManifest = JSON.parse(await readFile(qaManifestPath, 'utf8'));
    expect(qaManifest.name).toBe('HOLA DAY · Local QA');
    expect(qaManifest.version).toBe('0.0.3');
    expect(qaManifest.background.service_worker).toBe('service-worker-loader.js');
    const qaWorker = await readFile(join(extensionDir, 'service-worker-loader.js'));
    const qaEntry = `qa-worker-${createHash('sha256').update(qaWorker).digest('hex').slice(0, 16)}.js`;
    await writeFile(join(extensionDir, qaEntry), qaWorker, { flag: 'wx', mode: 0o600 });
    qaManifest.background.service_worker = qaEntry;
    await writeFile(qaManifestPath, `${JSON.stringify(qaManifest, null, 2)}\n`);
    const web = join(root, 'apps/web-workbench');
    const entry = join(artifacts, 'ui-entry');
    await mkdir(entry, { recursive: true });
    await writeFile(
      join(entry, 'index.html'),
      '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Holaday 验收</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
    );
    await writeFile(join(entry, 'entry.tsx'), `import '${web}/src/main.tsx';`);
    const config = join(entry, 'vite.config.mjs');
    await writeFile(
      config,
      `import app from '${web}/vite.config.ts';export default {...app,root:${JSON.stringify(entry)},resolve:{alias:{'@':${JSON.stringify(join(web, 'src'))},'react':${JSON.stringify(join(web, 'node_modules/react'))},'react-dom':${JSON.stringify(join(web, 'node_modules/react-dom'))}}},css:{postcss:${JSON.stringify(web)}},build:{...app.build,outDir:${JSON.stringify(uiDir)},emptyOutDir:true}};`,
    );
    await build(
      web,
      [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--config', config],
      'workbench-build',
    );
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    async function snapshot(phase = 'ready') {
      const taskRows = await probe.db
        .select({
          taskId: tasks.externalId,
          status: tasks.status,
          userId: tasks.userId,
          result: tasks.result,
        })
        .from(tasks);
      const files = await probe.db
        .select({
          fileId: taskFiles.externalId,
          taskId: taskFiles.taskId,
          filename: taskFiles.filename,
          sizeBytes: taskFiles.sizeBytes,
          status: taskFiles.status,
          browserSource: taskFiles.browserSource,
        })
        .from(taskFiles);
      const executionDrainSnapshot = drain.snapshot();
      const uncertainty = JSON.stringify({
        mode: executionDrainSnapshot.mode,
        unknown: executionDrainSnapshot.unknown,
      });
      if (uncertainty !== lastDrainUncertainty) {
        await appendFile(
          join(artifacts, 'drain-observations.ndjson'),
          `${JSON.stringify({ at: new Date().toISOString(), phase, ...executionDrainSnapshot })}\n`,
          { mode: 0o600 },
        );
        lastDrainUncertainty = uncertainty;
      }
      const mask = (text: string) => text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]');
      await writeFile(
        join(artifacts, 'state.json'),
        mask(
          JSON.stringify(
            {
              phase,
              pid: process.pid,
              updatedAt: new Date().toISOString(),
              scope,
              executionDrainSnapshot,
              origin,
              wsPort,
              extensions: Object.fromEntries(
                Object.entries(identities).map(([key, user]) => [
                  key,
                  extensionWs.getConnectedExtensionClientIds(user),
                ]),
              ),
              downloadAuditWriteFailed,
              taskRows,
              files,
            },
            null,
            2,
          ),
        ),
        { mode: 0o600 },
      );
    }
    await snapshot();
    await writeFile(
      join(artifacts, 'ready.json'),
      JSON.stringify(
        {
          origin,
          extensionDir,
          bootstrap: Object.fromEntries(
            Object.keys(identities).map((key) => [key, `${origin}/operator-bootstrap/${key}`]),
          ),
          actualSql: true,
          scriptedModel: false,
          actualExtensionRegistry: true,
          quotaMocked: false,
          classifierMocked: false,
          credentialsCopied: false,
          productionChanged: false,
          uiSHA256: digest(await readFile(join(uiDir, 'index.html'))),
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    console.log('REAL_SITE_APP_READY; see private joint-app/ready.json');
    const deadline = Date.now() + 90 * 60_000;
    let lastCommand = '';
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 1000));
      let command: string;
      try {
        command = await readFile(join(artifacts, 'command.json'), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await snapshot();
          continue;
        }
        throw error;
      }
      if (command !== lastCommand) {
        const input = JSON.parse(command);
        if (input.op === 'stop') {
          await snapshot('operator-stopped');
          return;
        }
        if (
          input.op !== 'select-case' ||
          !['github-pr360', 'sheets-synthetic'].includes(input.scope)
        )
          throw new Error('Unsupported operator command');
        const active = (await probe.db.select().from(tasks)).some(
          (task) => !['completed', 'failed', 'cancelled'].includes(task.status),
        );
        if (active)
          throw new Error('Cannot change model scope while a task remains active/unknown');
        scope = input.scope;
        lastCommand = command;
      }
      await snapshot();
    }
    throw new Error('Bounded operator session ended; inspect receipts before continuing');
  },
  95 * 60_000,
);
