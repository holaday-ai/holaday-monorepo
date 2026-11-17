import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import express from 'express';
import type { Connection } from 'mysql2/promise';
import { type BrowserContext, type Page, type Worker, chromium } from 'playwright';
import { afterAll, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { signAccessToken } from '../../auth/jwt.js';
import { env } from '../../config/env.js';
import type { DB } from '../../db/client.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import * as storage from '../../files/storage-provider.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import * as extensionWs from '../../ws/server.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock('../../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('No synthetic formal-task database installed');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));

interface Bridge {
  port: number;
  origin: string;
  connections: Array<{ clientId?: string }>;
  received: Array<{ type: string; kind?: string; args?: { session?: { op: string } } }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  waitForConnection(count: number, timeout: number): Promise<unknown>;
  call(
    task: string,
    kind: string,
    args?: unknown,
    timeout?: number,
  ): Promise<Record<string, unknown>>;
}
const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const web = join(root, 'apps/web-workbench');
const extension = join(root, 'apps/extension');
const payload = Buffer.from('sku,qty\nFORMAL-HTTP-731,31\n');
const hash = (buffer: Uint8Array) => createHash('sha256').update(buffer).digest('hex');
const originalEnv = { ...env };
let context: BrowserContext | undefined;
let bridge: Bridge | undefined;
let temp: string | undefined;
let filesRoot: string | undefined;
let releaseExport: (() => void) | undefined;
const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local candidate address');
  return `http://127.0.0.1:${address.port}`;
}
afterAll(async () => {
  releaseExport?.();
  await context?.close();
  await bridge?.stop();
  for (const server of servers)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (temp) await rm(temp, { recursive: true, force: true });
  if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.assign(env, originalEnv);
  reloadFeatureFlagsForTest();
});

it('creates an independent plugin file task over authenticated HTTP and downloads its exact bytes from the rendered Workbench result', async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'ba-formal-chrome-file-')));
  const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(temp, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const frozen = process.env.HOLADAY_SOURCE_FREEZE_JSON;
  if (frozen)
    for (const [path, expected] of Object.entries(JSON.parse(await readFile(frozen, 'utf8'))))
      expect(hash(await readFile(path))).toBe(expected);
  const loaded = (await import(
    new URL('../../../../extension/e2e/mock-orchestrator.mjs', import.meta.url).href
  )) as { MockOrchestrator: new () => Bridge };
  bridge = new loaded.MockOrchestrator();
  await bridge.start();
  const fixture = await browserOutputFixture();
  filesRoot = fixture.root;
  const writes: string[] = [];
  const nativeUserQueries: string[] = [];
  const mysql = {
    async query(query: { sql: string }, parameters: unknown[]) {
      expect(query.sql).toMatch(/^select .* from `users`/i);
      nativeUserQueries.push(query.sql);
      const records = [
        {
          id: 7,
          externalId: 'usr_alice',
          status: fixture.faults.ownerStatus,
          authVersion: 0,
          plan: 'pro',
          role: 'user',
          selectedRoles: [],
          selectedSkills: [],
          modelDataRegion: 'cn',
          createdAt: '2026-11-01 00:00:00',
          updatedAt: '2026-11-01 00:00:00',
        },
      ];
      const columns = query.sql
        .slice(7, query.sql.toLowerCase().indexOf(' from '))
        .split(',')
        .map((field) => [...field.split(/\s+as\s+/i)[0]!.matchAll(/`([^`]+)`/g)].at(-1)?.[1]);
      const predicates = [...query.sql.matchAll(/`(\w+)`\s*=\s*\?/g)];
      const property = (column: string) =>
        column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      const found = records.filter((row) =>
        predicates.every(
          (predicate, index) => Reflect.get(row, property(predicate[1]!)) === parameters[index],
        ),
      );
      return [
        found.map((row) => columns.map((column) => Reflect.get(row, property(column!)) ?? null)),
        [],
      ];
    },
  };
  // Keep the real fixed Drizzle prepare/execute and original-driver ownership
  // checks. Only the MySQL socket receipt is synthetic, not the auth gate.
  const userDatabase = drizzle(mysql as unknown as Connection);
  const database = {
    select(projection: Record<string, unknown> = {}) {
      return {
        from(table: unknown) {
          if (table === taskFiles || (table === tasks && !('count' in projection))) {
            const from = fixture.db.select().from(table as typeof tasks);
            return {
              where(query: Parameters<typeof from.where>[0]) {
                const filtered = from.where(query);
                return {
                  limit: filtered.limit.bind(filtered),
                  orderBy: (...order: Parameters<typeof filtered.orderBy>) => {
                    const ordered = filtered.orderBy(...order);
                    return Object.assign(ordered, {
                      then: (resolve: (rows: unknown[]) => unknown) =>
                        ordered.limit(100).then(resolve),
                    });
                  },
                  then: (resolve: (rows: unknown[]) => unknown) =>
                    filtered.limit(100).then(resolve),
                };
              },
            };
          }
          if (table === users)
            return (
              Object.keys(projection).length
                ? userDatabase.select(projection as never)
                : userDatabase.select()
            ).from(users);
          const rows = 'count' in projection ? [{ count: 0 }] : [];
          const query = {
            where: () => query,
            orderBy: () => query,
            limit: async () => rows,
            then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
          };
          return query;
        },
      };
    },
    insert: (table: unknown) =>
      table === taskFiles
        ? fixture.db.insert(taskFiles)
        : {
            values: () =>
              Object.assign(Promise.resolve([]), { onDuplicateKeyUpdate: async () => [] }),
          },
    update: () => ({ set: () => ({ where: async () => [] }) }),
    transaction: <T>(action: (tx: DB) => Promise<T>) =>
      fixture.db.transaction(() => action(database as unknown as DB)),
  } as unknown as DB;
  boundary.current = database;
  vi.spyOn(storage, 'getSharedStorageProvider').mockReturnValue(fixture.storage);
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    AGENT_MODE: 'legacy',
    BROWSER_EXECUTOR: 'unified',
    BROWSER_TASK_FILES_V1: true,
    QWEN_CORE_ALLOWLIST: 'usr_alice',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ENABLED_LANES: 'browser',
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
    DASHSCOPE_API_KEY: '',
  });
  vi.stubEnv('USER_BROWSER_ROUTING_V2', 'true');
  vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
  vi.stubEnv('BROWSER_LAUNCH_RECOVERY_ENABLED', 'false');
  reloadFeatureFlagsForTest();
  vi.spyOn(classifier, 'explainExecutionMode').mockResolvedValue({
    mode: 'browser',
    source: 'test',
  });
  const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockImplementation(async (state) => {
    Object.assign(fixture.taskRecords[0]!, {
      externalId: state.taskId,
      status: state.status,
      userId: 7,
      origin: 'user',
    });
  });
  vi.spyOn(TaskRepository.prototype, 'isTaskCancelled').mockResolvedValue(false);
  let result: { status: string; summary?: string; reason?: string } | undefined;
  const terminal = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockImplementation(async (_state, outcome) => {
      result = outcome;
      fixture.taskRecords[0]!.status = outcome.status;
      return { persisted: true };
    });
  vi.spyOn(extensionWs, 'broadcastToUser').mockReturnValue(0);
  const modelRequests: string[] = [];
  const metadata = {
    provider: 'alibaba-model-studio',
    model: 'formal-chrome-file-fixture',
    region: 'cn',
    deploymentScope: 'china_mainland',
    endpointKind: 'public',
    protocol: 'messages',
  } as const;
  vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
    metadata,
    async create(request) {
      modelRequests.push(JSON.stringify(request));
      const first = modelRequests.length === 1;
      expect(request.tools?.some((tool) => tool.name === 'browser_download_file')).toBe(true);
      return {
        id: `formal-${modelRequests.length}`,
        metadata,
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: `file-${modelRequests.length}`,
            name: first ? 'browser_download_file' : 'browser_finish',
            input: first
              ? {
                  selector: {
                    description: 'Export report',
                    strategies: [{ kind: 'role', role: 'link', name: 'Export report' }],
                    selfHeal: false,
                  },
                }
              : {
                  status: 'completed',
                  summary: '已保存网站原始 report.csv 文件。',
                  evidenceText: 'Export report',
                },
          },
        ],
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  }));
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
  const uiDir = join(artifacts, 'workbench');
  const app = express();
  app.use('/api', createHttpApp({ planner: {} as never, executionDrain: admission }));
  app.get('/candidate/result', (_req, res) =>
    res.json({
      taskId: fixture.taskRecords[0]!.externalId,
      status: result?.status,
      resultText: result?.summary,
      tickCount: 2,
    }),
  );
  app.use(express.static(uiDir));
  app.use(express.static(join(web, 'public')));
  const appOrigin = await listen(createServer(app));
  const token = await signAccessToken({ sub: 'usr_alice', plan: 'pro' });
  async function rpc(
    name: string,
    input?: unknown,
    mutation = false,
    bearer: string | null = token,
  ) {
    const response = await fetch(
      `${appOrigin}/api/trpc/${name}${!mutation && input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''}`,
      {
        method: mutation ? 'POST' : 'GET',
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(mutation ? { 'content-type': 'application/json' } : {}),
        },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
    const body = await response.json();
    writes.push(`${mutation ? 'POST' : 'GET'} ${name} ${response.status}`);
    expect(response.ok, JSON.stringify(body)).toBe(true);
    return body.result.data;
  }
  const exported: Array<{ method?: string; url?: string }> = [];
  let exportStarted!: () => void;
  const exporting = new Promise<void>((resolve) => {
    exportStarted = resolve;
  });
  const exportGate = new Promise<void>((resolve) => {
    releaseExport = resolve;
  });
  const site = await listen(
    createServer(async (req, res) => {
      if (req.url?.startsWith('/export')) {
        exported.push({ method: req.method, url: req.url });
        exportStarted();
        await exportGate;
        if (res.destroyed) return;
        res.writeHead(200, {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="report.csv"',
        });
        res.end(payload);
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          '<title>Formal file site</title><label>My notes <input id="notes" value="keep original"></label><a href="/export?ticket=PRIVATE-EXPORT-731">Export report</a>',
        );
      }
    }),
  );
  const extensionDir = join(artifacts, 'extension');
  async function build(
    cwd: string,
    args: string[],
    label: string,
    buildEnv: Record<string, string> = {},
  ) {
    const built = spawnSync(process.execPath, args, {
      cwd,
      env: { ...process.env, NODE_ENV: 'production', ...buildEnv },
      encoding: 'utf8',
    });
    await writeFile(join(artifacts, `${label}.log`), (built.stdout ?? '') + (built.stderr ?? ''));
    expect(built.status, built.stderr).toBe(0);
  }
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
      VITE_WORKBENCH_URL: `http://localhost:${bridge.port}`,
      VITE_ORCHESTRATOR_HTTP: bridge.origin,
      VITE_ORCHESTRATOR_WS: `ws://127.0.0.1:${bridge.port}/ws`,
    },
  );
  await writeFile(
    join(temp, 'index.html'),
    '<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Holaday task result candidate</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
  );
  await writeFile(
    join(temp, 'entry.tsx'),
    `import React from 'react';import {createRoot} from 'react-dom/client';import {TaskStream} from '${web}/src/components/TaskStream';import {ToastProvider} from '${web}/src/components/ui/toast';import '${web}/src/index.css';import '${web}/src/styles/holaday-ui.css';import '${web}/src/styles/approved-ui.css';const data=await (await fetch('/candidate/result')).json();createRoot(document.getElementById('root')).render(<ToastProvider><main className="holaday-shell mx-auto min-h-screen max-w-3xl bg-background p-4"><TaskStream task={{...data,intent:'导出网页原始文件',title:null,browserSource:'local-chrome',createdAt:new Date()}} /></main></ToastProvider>);`,
  );
  const uiConfig = join(temp, 'vite.config.mjs');
  await writeFile(
    uiConfig,
    `import app from '${web}/vite.config.ts';export default {...app,root:${JSON.stringify(temp)},resolve:{alias:{'@':${JSON.stringify(join(web, 'src'))},'react':${JSON.stringify(join(web, 'node_modules/react'))},'react-dom':${JSON.stringify(join(web, 'node_modules/react-dom'))}}},css:{postcss:${JSON.stringify(web)}},build:{...app.build,outDir:${JSON.stringify(uiDir)},emptyOutDir:true}};`,
  );
  await build(
    web,
    [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--config', uiConfig],
    'workbench-build',
  );
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [
      '--renderer-process-limit=2',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const bootLogs: string[] = [];
  context.on('console', (message) =>
    bootLogs.push(message.text().replace(/([?&]token=)[^&\s]+/g, '$1[synthetic]')),
  );
  const worker: Worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const connected = bridge.waitForConnection(1, 15_000);
  for (
    let i = 0;
    i < 20 && !bridge.received.some((message) => message.type === 'client.hello');
    i++
  ) {
    await worker.evaluate(
      async (seed) => chrome.storage.local.set({ 'holaday.access_token': seed }),
      `e2e-synthetic-file-token-000${i}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    await connected;
  } finally {
    await writeFile(
      join(artifacts, 'extension-boot.json'),
      JSON.stringify(
        { messages: bridge.received.map((message) => message.type), logs: bootLogs },
        null,
        2,
      ),
    );
  }
  const clientId = bridge.connections.at(-1)?.clientId;
  if (!clientId) throw new Error('No real extension connection');
  vi.spyOn(extensionWs, 'hasConnectedExtension').mockReturnValue(true);
  vi.spyOn(extensionWs, 'getConnectedExtensionClientIds').mockReturnValue([clientId]);
  vi.spyOn(extensionWs, 'sendExtensionToolCall').mockImplementation(async (_user, call) => {
    expect(call.extensionClientId).toBe(clientId);
    return {
      ...(await bridge!.call(call.taskId, call.kind, call.args, call.timeoutMs)),
      extensionClientId: clientId,
    } as extensionWs.ExtensionToolCallOutcome;
  });
  const original = await context.newPage();
  await original.goto(`${site}/original?ticket=PRIVATE-ORIGINAL-731`);
  const normal = await context.newPage();
  await normal.goto(`${bridge.origin}/page.html`);
  await normal.locator('#query').fill('normal browsing preserved');
  await normal.bringToFront();
  const active = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
  );
  const available = await rpc('tasks.localChromeTabs');
  const chosen = available.tabs.find((tab: { expectedUrl: string }) =>
    tab.expectedUrl.startsWith(site),
  );
  expect(chosen).toBeTruthy();
  const selection = {
    extensionClientId: chosen.extensionClientId,
    tabId: chosen.tabId,
    expectedUrl: chosen.expectedUrl,
    selectionId: chosen.selectionId,
  };
  const prepared = await rpc(
    'tasks.localChromeTaskTab',
    { selection, preparationId: randomUUID() },
    true,
  );
  expect(prepared.tabId).not.toBe(selection.tabId);
  const localChrome = {
    extensionClientId: prepared.extensionClientId,
    tabId: prepared.tabId,
    expectedUrl: prepared.expectedUrl,
    selectionId: prepared.selectionId,
  };
  const created = await rpc(
    'tasks.create',
    {
      intent: '从此网站导出 report.csv 原始文件并交给我',
      localChrome,
      mode: 'auto',
      expertMode: 'normal',
    },
    true,
  );
  expect(created.status).toBe('executing');
  await exporting;
  expect(terminal).not.toHaveBeenCalled();
  await normal.locator('#query').fill('typing while formal export waits');
  releaseExport!();
  await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
  expect(result, JSON.stringify(result)).toMatchObject({
    status: 'completed',
    summary: expect.stringContaining('holaday-file'),
  });
  await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 }));
  expect(consume).toHaveBeenCalledTimes(1);
  expect(exported).toEqual([{ method: 'GET', url: '/export?ticket=PRIVATE-EXPORT-731' }]);
  expect(await original.locator('#notes').inputValue()).toBe('keep original');
  expect(original.url()).toBe(`${site}/original?ticket=PRIVATE-ORIGINAL-731`);
  expect(await normal.locator('#query').inputValue()).toBe('typing while formal export waits');
  expect(
    await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
    ),
  ).toBe(active);
  expect((await worker.evaluate(async (id) => chrome.tabs.get(id), prepared.tabId)).url).toContain(
    site,
  );
  expect(modelRequests.join('\n')).not.toContain('PRIVATE-');
  const file = fixture.records[0]!;
  expect(file.browserSource).toMatchObject({
    kind: 'task_download',
    taskId: created.taskId,
    origin: site,
    sha256: hash(payload),
  });
  const ui: Page = await context.newPage();
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  ui.on('pageerror', (error) => errors.push(error.message));
  ui.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await ui.addInitScript((seed) => localStorage.setItem('holaday.access_token', seed), token);
  const views = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await ui.setViewportSize(viewport);
    await ui.goto(appOrigin);
    expect(await ui.title()).toBe('Holaday task result candidate');
    const button = ui.getByRole('button', { name: /下载.*report\.csv/ });
    await button.waitFor({ timeout: 10_000 });
    expect(await ui.locator('body').innerText()).toContain('report.csv');
    expect(await ui.locator('vite-error-overlay').count()).toBe(0);
    const [download] = await Promise.all([ui.waitForEvent('download'), button.click()]);
    const stream = await download.createReadStream();
    if (!stream) throw new Error('No Workbench download stream');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(payload);
    await download.delete();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    await ui.screenshot({
      path: join(artifacts, `workbench-result-${viewport.width}.png`),
      fullPage: true,
    });
    views.push({
      ...viewport,
      filename: download.suggestedFilename(),
      sha256: hash(Buffer.concat(chunks)),
      bounds,
    });
  }
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  const hashes: Record<string, string> = {};
  async function files(dir: string) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await files(path);
      else hashes[path.slice(artifacts.length + 1)] = hash(await readFile(path));
    }
  }
  await files(extensionDir);
  await files(uiDir);
  await writeFile(
    join(artifacts, 'result.json'),
    JSON.stringify(
      {
        created,
        preparedTaskTab: { tabId: prepared.tabId, originalTabId: chosen.tabId },
        source: file.browserSource,
        originalRequests: exported,
        sourceUserPageUnchanged: true,
        otherTabUnchanged: true,
        normalUserInput: await normal.locator('#query').inputValue(),
        userTypedDuringHeldOriginalExport: true,
        views,
        errors,
        consoleErrors,
        rpcTrace: writes,
        nativeUserQueries,
        modelAPICalls: 0,
        chromium: context.browser()!.version(),
        browserPlugin: 'Browser plugin not available; using repository Playwright workflow',
        buildFiles: hashes,
        limits: [
          'Synthetic account/database/model and controlled WS delivery; actual JWT/authenticated HTTP/tRPC/core task/loaded extension/native download/FileService/TaskStream/card/browser delivery. Not real-user/SQL/OS/focus/public-site acceptance.',
          'Candidate result-metadata endpoint mounts actual TaskStream using the actual core terminal outcome; TaskRepository persistence is synthetic. Full App/Composer/task-history navigation is not exercised.',
        ],
      },
      null,
      2,
    ),
  );
}, 180_000);
