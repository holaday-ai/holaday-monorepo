import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { createRequire, isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import express from 'express';
import type { Connection } from 'mysql2/promise';
import { type BrowserContext, type Page, type Worker, chromium } from 'playwright';
import { afterAll, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { TableAggregate } from '../../agent/browser-tools/browser-task-table.js';
import * as classifier from '../../agent/intent-classifier.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { signAccessToken } from '../../auth/jwt.js';
import { env } from '../../config/env.js';
import type { DB } from '../../db/client.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { webhookIdempotency } from '../../db/schema/webhook-idempotency.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import * as storage from '../../files/storage-provider.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import {
  type IsolatedMysqlProbe,
  openIsolatedMysqlProbe,
} from '../../testing/isolated-mysql-probe.js';
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
const payload = Buffer.from(`channel,amount\n${'web,0.10\n'.repeat(10000)}store,99.90\n`);
const expectedAnalysis = 'metric,value\nsum,1099.9\nrows,10001\n';
const captureScreenshot = process.env.HOLADAY_CHROME_APP_SCREENSHOT === '1';
const browserChannel = process.env.HOLADAY_CHROME_APP_CHANNEL ?? 'chromium';
const intent = `从此网站导出 report.csv 原始文件，读取并完整统计金额总和和数据行数，再生成 analysis.csv，把两份文件交给我${captureScreenshot ? '，另外截图并一并交付截图文件' : ''}`;
const hash = (buffer: Uint8Array) => createHash('sha256').update(buffer).digest('hex');
const originalEnv = { ...env };
let context: BrowserContext | undefined;
let webSockets: WebSocketServer | undefined;
const realSql = process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1';
let sqlProbe: IsolatedMysqlProbe | undefined;
let predicateDb: DatabaseSync | undefined;
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
  try {
    releaseExport?.();
    if (context && process.env.HOLADAY_E2E_ARTIFACT_DIR) {
      const evidence = process.env.HOLADAY_E2E_ARTIFACT_DIR;
      const pages = context.pages().slice(-3);
      await writeFile(
        join(evidence, 'last-pages.json'),
        JSON.stringify(
          await Promise.all(
            pages.map(async (page) => ({
              url: page.url(),
              body: await page
                .locator('body')
                .innerText()
                .catch(() => '')
                .then((text) => text.slice(0, 5000)),
            })),
          ),
          null,
          2,
        ),
      );
      await pages
        .find((page) => page.url().includes('/?task=') || page.url().endsWith('/history'))
        ?.screenshot({ path: join(evidence, 'last-page.png'), fullPage: true })
        .catch(() => {});
    }
    await context?.close();
    for (const socket of webSockets?.clients ?? []) socket.terminate();
    if (webSockets) await new Promise<void>((resolve) => webSockets!.close(() => resolve()));
    predicateDb?.close();
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
  } finally {
    await sqlProbe?.close();
  }
});

it.runIf(realSql || isBuiltin('node:sqlite'))(
  'requires native SQLite or explicit MySQL opt-in: submits a plugin report from the full App Composer and restores both files through task history after reload',
  async () => {
    expect(['chromium', 'chrome']).toContain(browserChannel);
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
    const historyFile = join(temp, 'task-history.json');
    writeFileSync(historyFile, '[]');
    const loadHistory = (): Array<Record<string, unknown>> =>
      JSON.parse(readFileSync(historyFile, 'utf8'), (key, value) =>
        /At$/.test(key) && typeof value === 'string' ? new Date(value) : value,
      );
    const saveHistory = () =>
      writeFileSync(
        historyFile,
        JSON.stringify(fixture.taskRecords.filter((row) => 'intent' in row)),
      );
    if (!realSql) {
      const NativeDatabase: new (path: string) => DatabaseSync = createRequire(import.meta.url)(
        'node:sqlite',
      ).DatabaseSync;
      predicateDb = new NativeDatabase(':memory:');
    }
    const dialect = new MySqlDialect();
    const scalar = (value: unknown): string | number | null =>
      value == null
        ? null
        : value instanceof Date
          ? value.toISOString().slice(0, 19).replace('T', ' ')
          : typeof value === 'boolean'
            ? Number(value)
            : typeof value === 'object'
              ? JSON.stringify(value)
              : typeof value === 'number'
                ? value
                : String(value);
    const matchRows = (
      table: typeof tasks | typeof taskFiles,
      rows: Array<Record<string, unknown>>,
      where: Parameters<typeof dialect.sqlToQuery>[0],
    ) => {
      const query = dialect.sqlToQuery(where);
      const columns = Object.entries(getTableColumns(table));
      const sql = `SELECT 1 FROM (SELECT ${columns.map(([, column]) => `? AS \`${column.name}\``).join(',')}) AS \`${getTableName(table)}\` WHERE ${query.sql}`;
      const statement = predicateDb!.prepare(sql);
      return rows.filter((row) =>
        Boolean(
          statement.get(...columns.map(([key]) => scalar(row[key])), ...query.params.map(scalar)),
        ),
      );
    };
    const writes: string[] = [];
    const nativeUserQueries: string[] = [];
    const idempotencyRows: Array<Record<string, unknown>> = [];
    const idempotencyStatements: string[] = [];
    const mysql = {
      async query(query: { sql: string }, parameters: unknown[]) {
        if (query.sql.includes('`webhook_idempotency`')) {
          const sql = query.sql;
          idempotencyStatements.push(sql.split(' ')[0]!);
          const property = (column: string) =>
            column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
          const matches = (row: Record<string, unknown>, where: string, args: unknown[]) =>
            [...where.matchAll(/`(\w+)`\s*=\s*\?/g)].every(
              (match, index) => row[property(match[1]!)] === args[index],
            );
          if (/^insert/i.test(sql)) {
            const columns = sql
              .slice(sql.indexOf('(') + 1, sql.indexOf(')'))
              .split(',')
              .map((name) => name.trim().replaceAll('`', ''));
            const values = sql
              .slice(sql.toLowerCase().indexOf(' values ') + 8)
              .replace(/^\(|\)$/g, '')
              .split(',')
              .map((value) => value.trim());
            const row: Record<string, unknown> = {
              id: idempotencyRows.length + 1,
              createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            };
            let index = 0;
            columns.forEach((column, position) => {
              if (values[position] === '?') row[property(column)] = parameters[index++];
            });
            if (
              idempotencyRows.some(
                (prior) =>
                  prior.userId === row.userId && prior.idempotencyKey === row.idempotencyKey,
              )
            )
              throw Object.assign(new Error('synthetic driver duplicate'), {
                code: 'ER_DUP_ENTRY',
                errno: 1062,
              });
            idempotencyRows.push(row);
            return [{ affectedRows: 1, insertId: row.id }, []];
          }
          if (/^update/i.test(sql)) {
            const [set, where] = sql.split(/ where /i);
            const changes = [...set!.matchAll(/`(\w+)`\s*=\s*\?/g)];
            const selected = idempotencyRows.filter((row) =>
              matches(row, where!, parameters.slice(changes.length)),
            );
            for (const row of selected)
              changes.forEach((match, index) => {
                row[property(match[1]!)] = parameters[index];
              });
            return [{ affectedRows: selected.length }, []];
          }
          if (/^delete/i.test(sql)) {
            const kept = idempotencyRows.filter(
              (row) => !matches(row, sql.split(/ where /i)[1]!, parameters),
            );
            const affectedRows = idempotencyRows.length - kept.length;
            idempotencyRows.splice(0, idempotencyRows.length, ...kept);
            return [{ affectedRows }, []];
          }
          const columns = sql
            .slice(7, sql.toLowerCase().indexOf(' from '))
            .split(',')
            .map((field) => [...field.split(/\s+as\s+/i)[0]!.matchAll(/`([^`]+)`/g)].at(-1)?.[1]);
          const rows = idempotencyRows.filter((row) =>
            matches(row, sql.split(/ where /i)[1]!, parameters),
          );
          return [rows.map((row) => columns.map((column) => row[property(column!)] ?? null)), []];
        }
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
    let database = {
      select(projection: Record<string, unknown> = {}) {
        return {
          from(table: unknown) {
            if (table === taskFiles || (table === tasks && !('count' in projection))) {
              return {
                where(query: Parameters<typeof dialect.sqlToQuery>[0]) {
                  const read = () =>
                    matchRows(
                      table as typeof tasks | typeof taskFiles,
                      table === tasks ? loadHistory() : fixture.records,
                      query,
                    ).sort((a, b) => Number(b.id) - Number(a.id));
                  const limited = (count: number) => {
                    const promise = Promise.resolve(read().slice(0, count));
                    return Object.assign(promise, { for: (_mode: string) => promise });
                  };
                  const ordered = {
                    limit: limited,
                    then: (resolve: (rows: unknown[]) => unknown) =>
                      Promise.resolve(read()).then(resolve),
                  };
                  return { ...ordered, orderBy: () => ordered };
                },
              };
            }
            if (table === webhookIdempotency)
              return (
                Object.keys(projection).length
                  ? userDatabase.select(projection as never)
                  : userDatabase.select()
              ).from(webhookIdempotency);
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
          : table === webhookIdempotency
            ? userDatabase.insert(webhookIdempotency)
            : {
                values: () =>
                  Object.assign(Promise.resolve([]), { onDuplicateKeyUpdate: async () => [] }),
              },
      update: (table: unknown) =>
        table === webhookIdempotency
          ? userDatabase.update(webhookIdempotency)
          : { set: () => ({ where: async () => [] }) },
      delete: () => userDatabase.delete(webhookIdempotency),
      transaction: <T>(action: (tx: DB) => Promise<T>) =>
        fixture.db.transaction(() => action(database as unknown as DB)),
    } as unknown as DB;
    if (realSql) {
      sqlProbe = await openIsolatedMysqlProbe({
        allTableStructures: true,
        artifactPath: join(artifacts, 'mysql-evidence.json'),
      });
      database = sqlProbe.db;
      await database.insert(users).values({
        id: 7,
        externalId: 'usr_alice',
        email: 'alice@example.test',
        passwordHash: 'synthetic-only',
        plan: 'pro',
        modelDataRegion: 'cn',
      });
    }
    const readFileRecords = async (): Promise<Array<Record<string, unknown>>> =>
      sqlProbe ? database.select().from(taskFiles) : fixture.records;
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
    if (captureScreenshot) vi.stubEnv('BROWSER_COLLABORATION_V2', 'true');
    vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
    vi.stubEnv('BROWSER_LAUNCH_RECOVERY_ENABLED', 'false');
    reloadFeatureFlagsForTest();
    vi.spyOn(classifier, 'explainExecutionMode').mockResolvedValue({
      mode: 'browser',
      source: 'test',
    });
    const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(QuotaService.prototype, 'getOrCreateActiveQuota').mockResolvedValue({
      id: 1,
      userId: 7,
      period: 'month',
      periodStart: new Date('2026-11-01T00:00:00Z'),
      periodEnd: new Date('2026-12-01T00:00:00Z'),
      tasksUsed: 0,
      opusUsed: 0,
      bonusTasks: 0,
      bonusOpus: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (!realSql) {
      vi.spyOn(TaskRepository.prototype, 'insertTask').mockImplementation(async (state, input) => {
        Object.assign(fixture.taskRecords[0]!, {
          externalId: state.taskId,
          status: state.status,
          userId: 7,
          origin: 'user',
          intent: input.intent,
          title: null,
          sourceContext: input.sourceContext,
          result: null,
          plan: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          projectId: null,
        });
        saveHistory();
      });
      vi.spyOn(TaskRepository.prototype, 'isTaskCancelled').mockResolvedValue(false);
    }
    let result: { status: string; summary?: string; reason?: string } | undefined;
    let persistenceReceipt: unknown;
    const persistOutcome = TaskRepository.prototype.persistVisionOutcome;
    const terminal = vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome');
    if (realSql) {
      terminal.mockImplementation(async function (this: TaskRepository, taskId, outcome) {
        const receipt = await persistOutcome.call(this, taskId, outcome);
        persistenceReceipt = receipt;
        if (receipt.persisted) result = outcome;
        return receipt;
      });
    } else {
      terminal.mockImplementation(async (_state, outcome) => {
        result = outcome;
        Object.assign(fixture.taskRecords[0]!, {
          status: outcome.status,
          result: outcome,
          completedAt: new Date(),
          updatedAt: new Date(),
        });
        saveHistory();
        return { persisted: true };
      });
    }
    vi.spyOn(extensionWs, 'broadcastToUser').mockImplementation((_user, message) => {
      let count = 0;
      for (const socket of webSockets?.clients ?? [])
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
          count++;
        }
      return count;
    });
    const modelRequests: string[] = [];
    let analysis: TableAggregate | undefined;
    let originalFileId: string | undefined;
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
        const turn = modelRequests.length;
        const toolResults = request.messages
          .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
          .flatMap((block) =>
            block.type === 'tool_result' && typeof block.content === 'string'
              ? [JSON.parse(block.content)]
              : [],
          );
        let name = 'browser_download_file';
        let input: Record<string, unknown> = {
          selector: {
            description: 'Export report',
            strategies: [{ kind: 'role', role: 'link', name: 'Export report' }],
            selfHeal: false,
          },
        };
        if (!first) {
          expect(request.tools?.map((tool) => tool.name)).toEqual(
            expect.arrayContaining(['read_task_file', 'analyze_task_table', 'create_file']),
          );
          originalFileId ??= String(
            (await readFileRecords()).find((file) => file.filename === 'report.csv')!.externalId,
          );
          if (turn === 2) {
            name = 'read_task_file';
            input = { fileId: originalFileId };
          } else if (turn === 3) {
            const read = toolResults.at(-1)!;
            expect(read).toMatchObject({
              ok: true,
              fileId: originalFileId,
              coverage: { complete: false },
            });
            expect(read.text).toContain('channel,amount');
            name = 'analyze_task_table';
            input = {
              fileId: originalFileId,
              mode: 'aggregate',
              metrics: [{ op: 'sum', column: 'B' }, { op: 'count_rows' }],
            };
          } else if (turn === 4) {
            analysis = toolResults.at(-1) as TableAggregate;
            expect(analysis).toMatchObject({
              complete: true,
              scope: { scannedRows: 10001, matchedRows: 10001 },
            });
            expect(analysis.overall.map((metric) => metric.value)).toEqual(['1099.9', '10001']);
            name = 'create_file';
            input = {
              filename: 'analysis.csv',
              format: 'csv',
              content: `metric,value\nsum,${analysis.overall[0]!.value}\nrows,${analysis.overall[1]!.value}\n`,
            };
          } else if (captureScreenshot && turn === 5) {
            expect(request.tools?.some((tool) => tool.name === 'browser_screenshot')).toBe(true);
            expect(toolResults.at(-1)).toMatchObject({
              ok: true,
              file: { filename: 'analysis.csv' },
            });
            name = 'browser_screenshot';
            input = {};
          } else {
            expect(turn).toBe(captureScreenshot ? 6 : 5);
            expect(toolResults.at(-1)).toMatchObject({
              ok: true,
              file: {
                filename: captureScreenshot
                  ? expect.stringMatching(/^screenshot-.*\.jpg$/)
                  : 'analysis.csv',
              },
            });
            name = 'browser_finish';
            input = {
              status: 'completed',
              summary: `已保存原报表，完整统计并生成分析文件。${captureScreenshot ? '已保存遮罩截图。' : ''}`,
              evidenceText: 'Export report',
              fields: analysis!.overall.map((metric) => ({
                name: metric.name,
                value: metric.value,
                fileId: originalFileId,
                tableFactId: metric.id,
              })),
            };
          }
        }
        return {
          id: `formal-${modelRequests.length}`,
          metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `file-${modelRequests.length}`,
              name,
              input,
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
    app.use(express.static(uiDir));
    app.use(express.static(join(web, 'public')));
    app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: uiDir }));
    const appServer = createServer(app);
    webSockets = new WebSocketServer({
      server: appServer,
      path: '/ws',
      handleProtocols: (protocols) => (protocols.has('holaday.v1') ? 'holaday.v1' : false),
    });
    webSockets.on('connection', (socket) =>
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'client.hello')
          socket.send(
            JSON.stringify({
              type: 'server.welcome',
              userId: 'usr_alice',
              clientId: randomUUID(),
              heartbeatMs: 30000,
            }),
          );
      }),
    );
    const appOrigin = await listen(appServer);
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
    await writeFile(join(temp, 'entry.tsx'), `import '${web}/src/main.tsx';`);
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
      channel: browserChannel,
      headless: true,
      ignoreDefaultArgs: browserChannel === 'chrome' ? ['--disable-extensions'] : undefined,
      args: [
        '--renderer-process-limit=2',
        ...(browserChannel === 'chrome'
          ? ['--enable-unsafe-extension-debugging']
          : [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]),
      ],
    });
    let extensionInstallation: Record<string, unknown> | undefined;
    if (browserChannel === 'chrome') {
      const cdp = await context.browser()!.newBrowserCDPSession();
      const browserVersion = await cdp.send('Browser.getVersion');
      // Branded Chrome no longer accepts --load-extension; use the supported private-pipe API.
      const loaded = await cdp.send('Extensions.loadUnpacked', { path: extensionDir });
      const extensions = await cdp.send('Extensions.getExtensions');
      const installed = extensions.extensions.find((item) => item.path === extensionDir);
      expect(installed, 'Actual Chrome must load the candidate QA extension').toBeDefined();
      const builtManifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
      expect(installed).toMatchObject({
        id: loaded.id,
        enabled: true,
        name: builtManifest.name,
        version: builtManifest.version,
      });
      extensionInstallation = {
        browserProduct: browserVersion.product,
        installationMethod: 'Extensions.loadUnpacked over owned private pipe',
        ...installed,
      };
      await cdp.detach();
    }
    const bootLogs: string[] = [];
    context.on('console', (message) =>
      bootLogs.push(message.text().replace(/([?&]token=)[^&\s]+/g, '$1[synthetic]')),
    );
    const worker: Worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const bootStarted = performance.now();
    // A worker target may exist before its execution context can answer evaluation.
    // Keep that startup budget separate from the actual network handshake budget.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Extension worker readiness timed out')),
        45_000,
      );
      void worker
        .evaluate(() => chrome.runtime.id)
        .then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
    const workerReadyMs = Math.round(performance.now() - bootStarted);
    if (extensionInstallation)
      expect(
        await worker.evaluate(() => ({
          id: chrome.runtime.id,
          name: chrome.runtime.getManifest().name,
          version: chrome.runtime.getManifest().version,
        })),
      ).toMatchObject({
        id: extensionInstallation.id,
        name: extensionInstallation.name,
        version: extensionInstallation.version,
      });
    const handshakeStarted = performance.now();
    // Clean install clears auth asynchronously. Re-seed one stable token only when absent;
    // changing it every pass restarts an in-flight WS preflight on slower launches.
    const connected = bridge.waitForConnection(1, 20_000).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    for (
      let i = 0;
      i < 20 && !bridge.received.some((message) => message.type === 'client.hello');
      i++
    ) {
      await worker.evaluate(async (seed) => {
        const stored = await chrome.storage.local.get('holaday.access_token');
        if (stored['holaday.access_token'] !== seed)
          await chrome.storage.local.set({ 'holaday.access_token': seed });
      }, 'e2e-synthetic-file-token-0001');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    try {
      const connection = await connected;
      if (!connection.ok) throw connection.error;
    } finally {
      await writeFile(
        join(artifacts, 'extension-boot.json'),
        JSON.stringify(
          {
            workerReadyMs,
            handshakeMs: Math.round(performance.now() - handshakeStarted),
            messages: bridge.received.map((message) => message.type),
            logs: bootLogs,
          },
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
    let active = await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
    );
    const available = await rpc('tasks.localChromeTabs');
    const chosen = available.tabs.find((tab: { expectedUrl: string }) =>
      tab.expectedUrl.startsWith(site),
    );
    expect(chosen).toBeTruthy();
    const ui: Page = await context.newPage();
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    ui.on('response', async (response) => {
      if (response.status() >= 400 && response.url().includes('/api/')) {
        const body = await response.text().catch(() => 'response unavailable');
        await writeFile(
          join(
            artifacts,
            `failed-api-${response.url().includes('quota.status') ? 'quota' : 'other'}.json`,
          ),
          body,
        );
      }
    });
    ui.on('pageerror', (error) => errors.push(error.message));
    ui.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await ui.addInitScript((seed) => localStorage.setItem('holaday.access_token', seed), token);
    await ui.setViewportSize({ width: 1440, height: 900 });
    await ui.goto(appOrigin);
    await ui.getByRole('button', { name: '选择 Chrome 页面' }).first().click();
    await ui.getByRole('menuitem').filter({ hasText: 'Formal file site' }).first().click();
    const composer = ui.locator('textarea:visible');
    await composer.fill(intent);
    expect(await composer.inputValue()).toBe(intent);
    const [createResponse] = await Promise.all([
      ui.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().includes('tasks.create'),
      ),
      ui.getByRole('button', { name: '发送', exact: true }).click(),
    ]);
    const createBody = await createResponse.json();
    await writeFile(
      join(artifacts, 'task-create-response.json'),
      JSON.stringify(createBody, null, 2),
    );
    expect(
      createResponse.ok(),
      JSON.stringify(
        (Array.isArray(createBody) ? createBody : [createBody]).map((item) => item.error?.message),
      ),
    ).toBe(true);
    const created = (Array.isArray(createBody) ? createBody[0] : createBody).result.data;
    const ownedTabs = await worker.evaluate(async () => chrome.tabs.query({}));
    const prepared = ownedTabs.find((tab) => tab.id !== chosen.tabId && tab.url?.startsWith(site))!;
    expect(prepared?.id).toBeDefined();
    const preparedTabId = prepared.id!;
    expect(created.status).toBe('executing');
    await exporting;
    expect(terminal).not.toHaveBeenCalled();
    await normal.bringToFront();
    active = await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
    );
    await normal.locator('#query').fill('typing while formal export waits');
    releaseExport!();
    await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
    // A called async persistence method may still be awaiting its SQL commit.
    // Observe the operation's completion before judging its durable result.
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 }), {
      timeout: 20_000,
    });
    expect(result, JSON.stringify({ result, persistenceReceipt })).toMatchObject({
      status: 'completed',
      summary: expect.stringContaining('holaday-file'),
    });
    expect(consume).toHaveBeenCalledTimes(1);
    if (sqlProbe) {
      idempotencyRows.push(...(await database.select().from(webhookIdempotency)));
      await sqlProbe.reconnect((fresh) => {
        database = fresh;
        boundary.current = fresh;
      });
      const savedHistory = await database.select().from(tasks);
      expect(savedHistory).toHaveLength(1);
      expect(savedHistory[0]).toMatchObject({
        externalId: created.taskId,
        status: 'completed',
        result: { summary: expect.stringContaining('holaday-file') },
      });
      Object.assign(sqlProbe.evidence, {
        persistedAcrossConnection: true,
        actualTaskRepositoryWrites: true,
      });
      await writeFile(
        join(artifacts, 'persisted-task-history.json'),
        JSON.stringify(savedHistory, null, 2),
      );
    }
    expect(idempotencyRows).toHaveLength(1);
    expect(idempotencyRows[0]?.taskId).toBe(created.taskId);
    if (!sqlProbe)
      await writeFile(join(artifacts, 'persisted-task-history.json'), await readFile(historyFile));
    expect(exported).toEqual([{ method: 'GET', url: '/export?ticket=PRIVATE-EXPORT-731' }]);
    expect(await original.locator('#notes').inputValue()).toBe('keep original');
    expect(original.url()).toBe(`${site}/original?ticket=PRIVATE-ORIGINAL-731`);
    expect(await normal.locator('#query').inputValue()).toBe('typing while formal export waits');
    expect(
      await worker.evaluate(
        async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id,
      ),
    ).toBe(active);
    expect((await worker.evaluate(async (id) => chrome.tabs.get(id), preparedTabId)).url).toContain(
      site,
    );
    expect(modelRequests.join('\n')).not.toContain('PRIVATE-');
    expect(modelRequests).toHaveLength(captureScreenshot ? 6 : 5);
    const fileRecords = await readFileRecords();
    const file = fileRecords.find((row) => row.filename === 'report.csv')!;
    const generated = fileRecords.find((row) => row.filename === 'analysis.csv')!;
    expect(generated).toBeDefined();
    expect(fileRecords).toHaveLength(captureScreenshot ? 3 : 2);
    const screenshot = captureScreenshot
      ? fileRecords.find((row) => row.mimetype === 'image/jpeg')
      : undefined;
    if (captureScreenshot) expect(screenshot).toMatchObject({ userId: 7, kind: 'output' });
    expect(analysis?.complete).toBe(true);
    expect(file.browserSource).toMatchObject({
      kind: 'task_download',
      taskId: created.taskId,
      origin: site,
      sha256: hash(payload),
    });
    // Clear the terminal capture: history reload must query the current database via real tasks.list/detail handlers.
    result = undefined;
    await ui.goto(`${appOrigin}/history`);
    await ui
      .getByRole('button')
      .filter({ hasText: '从此网站导出 report.csv 原始文件' })
      .last()
      .click();
    await expect.poll(() => ui.url()).toContain('?task=');
    await ui.reload();
    const views = [];
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await ui.setViewportSize(viewport);
      await ui.goto(`${appOrigin}/?task=${created.taskId}`);
      expect(await ui.title()).toBe('Holaday task result candidate');
      await expect.poll(() => ui.locator('body').innerText(), { timeout: 10000 }).toContain(intent);
      const files = [];
      for (const filename of [
        'report.csv',
        'analysis.csv',
        ...(screenshot ? [String(screenshot.filename)] : []),
      ]) {
        const button = ui.getByRole('button', {
          name: new RegExp(`下载.*${filename.replace('.', '\\.')}`),
        });
        await button.waitFor({ timeout: 10_000 });
        expect(await ui.locator('body').innerText()).toContain(filename);
        expect(await ui.locator('vite-error-overlay').count()).toBe(0);
        const [download] = await Promise.all([ui.waitForEvent('download'), button.click()]);
        const stream = await download.createReadStream();
        if (!stream) throw new Error('No Workbench download stream');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const received = Buffer.concat(chunks);
        if (filename === 'report.csv') expect(received).toEqual(payload);
        else if (filename === 'analysis.csv')
          expect(
            received
              .toString()
              .replace(/^\uFEFF/, '')
              .replace(/\r\n/g, '\n'),
          ).toBe(expectedAnalysis);
        else {
          expect(received.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
          expect(received.subarray(-2)).toEqual(Buffer.from([255, 217]));
          expect(received.length).toBe(Number(screenshot!.sizeBytes));
          await writeFile(join(artifacts, 'app-delivered-screenshot.jpg'), received);
        }
        expect(download.suggestedFilename()).toBe(filename);
        await download.delete();
        const bounds = await button.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        files.push({ filename, sha256: hash(received), sizeBytes: received.length, bounds });
      }
      await ui.screenshot({
        path: join(artifacts, `workbench-result-${viewport.width}.png`),
        fullPage: true,
      });
      views.push({ ...viewport, files });
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
          preparedTaskTab: { tabId: preparedTabId, originalTabId: chosen.tabId },
          fullAppComposer: true,
          historyReload: true,
          fixtureHistoryFile: sqlProbe ? null : historyFile,
          persistence: sqlProbe ? 'actual-isolated-mysql' : 'file-backed-fixture',
          mysqlEvidence: sqlProbe?.evidence,
          source: file.browserSource,
          analyzedRows: analysis?.scope.scannedRows,
          statistics: analysis?.overall.map(({ name, value }) => ({ name, value })),
          analysisFile: {
            fileId: generated.externalId,
            filename: generated.filename,
            sizeBytes: generated.sizeBytes,
          },
          screenshotFile: screenshot
            ? {
                fileId: screenshot.externalId,
                filename: screenshot.filename,
                sizeBytes: screenshot.sizeBytes,
              }
            : null,
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
          idempotencyStatements,
          modelAPICalls: 0,
          chromium: context.browser()!.version(),
          browserChannel,
          extensionInstallation,
          browserPlugin: 'Browser plugin not available; using repository Playwright workflow',
          buildFiles: hashes,
          limits: [
            'Synthetic account/model and controlled WS delivery; actual JWT/authenticated HTTP/tRPC/core task/loaded extension/native download/FileService/TaskStream/card/browser delivery. Not real-user/physical OS/public-site acceptance.',
            sqlProbe
              ? 'Actual isolated MySQL with ownership guard; no business data or production migration.'
              : 'TaskRepository write boundary is a file-backed synthetic fixture, not real MySQL durability acceptance.',
          ],
        },
        null,
        2,
      ),
    );
  },
  180_000,
);
