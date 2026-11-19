/** Opt-in saved-material preflight: real HTTP/SQL/file tools, scripted model, no website export. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import express from 'express';
import { afterAll, expect, it, vi } from 'vitest';
import type { TableAggregate } from '../../agent/browser-tools/browser-task-table.js';
import { signAccessToken } from '../../auth/jwt.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { DB } from '../../db/client.js';
import { users } from '../../db/schema/users.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import * as storage from '../../files/storage-provider.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { openIsolatedMysqlProbe } from '../../testing/isolated-mysql-probe.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock('../../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('Saved-input SQL is not ready');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));

const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const originalEnv = { ...env };
let closeProbe: (() => Promise<void>) | undefined;
let server: ReturnType<typeof createServer> | undefined;
afterAll(async () => {
  if (server)
    await new Promise<void>((yes, no) => server!.close((error) => (error ? no(error) : yes())));
  await closeProbe?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Object.assign(env, originalEnv);
  reloadFeatureFlagsForTest();
});

it.runIf(process.env.HOLADAY_SAVED_INPUT_PREFLIGHT === '1')(
  'processes an uploaded saved original through HTTP, file tools and actual isolated SQL without a website',
  async () => {
    expect(process.env.HOLADAY_SQL_PERSISTENCE_PROBE).toBe('1');
    const out = resolve(process.env.HOLADAY_SAVED_INPUT_PREFLIGHT_OUT ?? '');
    expect(out.startsWith('/private/tmp/pr360-readiness/saved-input-preflight-')).toBe(true);
    await mkdir(out, { recursive: true, mode: 0o700 });
    const materialPath = resolve(process.env.HOLADAY_SAVED_INPUT_PREFLIGHT_MATERIAL ?? '');
    expect(materialPath.startsWith(join(root, '.superpowers/sdd/'))).toBe(true);
    const material = JSON.parse(await readFile(materialPath, 'utf8')) as {
      path: string;
      filename: string;
      sha256: string;
    };
    const sourcePath = resolve(material.path);
    expect(sourcePath.startsWith(join(root, '.superpowers/sdd/'))).toBe(true);
    expect(material.filename).toMatch(/^[^/\\]+\.csv$/);
    const bytes = await readFile(sourcePath);
    const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
    expect(hash(bytes)).toBe(material.sha256);
    const ledger = join(
      root,
      '.superpowers/sdd/2026-11-18-browser-assistant-release-readiness/real-site-runtime-20261118/model-relay/requests.json',
    );
    const ledgerBefore = hash(await readFile(ledger));
    const probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      artifactPath: join(out, 'mysql-evidence.json'),
    });
    closeProbe = () => probe.close();
    boundary.current = probe.db;
    const user = 'usr_saved_input_preflight';
    await probe.db.insert(users).values({
      id: 7,
      externalId: user,
      email: 'saved-input@example.test',
      passwordHash: 'not-a-login-credential',
      plan: 'pro',
      modelDataRegion: 'cn',
    });
    vi.spyOn(storage, 'getSharedStorageProvider').mockReturnValue(
      new storage.LocalStorageProvider(join(out, 'files'), logger),
    );
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      BROWSER_EXECUTOR: 'unified',
      BROWSER_TASK_FILES_V1: true,
      TOOL_ROUTER_V2: false,
      QWEN_CORE_ALLOWLIST: user,
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ENABLED_LANES: 'browser',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'scripted-no-provider-access',
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
    const attemptedExternalFetches: string[] = [];
    vi.stubGlobal(
      'fetch',
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? String(input) : input.url,
        );
        if (url.hostname !== '127.0.0.1') {
          attemptedExternalFetches.push(url.origin);
          throw new Error('Paid/external fetch forbidden by saved-input preflight');
        }
        return nativeFetch(input, init);
      },
    );
    const navigations: string[] = [];
    const metadata = {
      provider: 'alibaba-model-studio',
      model: 'saved-input-scripted-fixture',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    } as const;
    let inputId = '';
    let generatedId = '';
    let aggregate: TableAggregate | undefined;
    let turns = 0;
    const receipts: unknown[] = [];
    const requests: messages.NeutralMessagesRequest[] = [];
    const resultFrom = (request: messages.NeutralMessagesRequest) => {
      const content = request.messages.at(-1)?.content;
      const block = Array.isArray(content)
        ? content.find((part) => part.type === 'tool_result')
        : undefined;
      if (block?.type !== 'tool_result' || typeof block.content !== 'string')
        throw new Error('Missing actual tool result');
      const start = block.content.startsWith('{') ? 0 : block.content.indexOf('\n{') + 1;
      const result = JSON.parse(block.content.slice(start));
      receipts.push(result);
      return result;
    };
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
      metadata,
      async create(request) {
        requests.push(request);
        turns++;
        try {
          expect(request.tools?.map((tool) => tool.name)).toEqual(
            expect.arrayContaining([
              'read_task_file',
              'analyze_task_table',
              'create_file',
              'finish',
            ]),
          );
          let name: string;
          let input: Record<string, unknown>;
          if (turns === 1) {
            expect(JSON.stringify(request.messages)).toContain(inputId);
            name = 'read_task_file';
            input = { fileId: inputId };
          } else if (turns === 2) {
            expect(resultFrom(request)).toMatchObject({
              fileId: inputId,
              sha256: material.sha256,
              coverage: { complete: true },
            });
            name = 'analyze_task_table';
            input = { fileId: inputId, mode: 'describe' };
          } else if (turns === 3) {
            const described = resultFrom(request);
            const amount = described.columns.find(
              (column: { label: string }) => column.label === 'amount',
            );
            expect(amount).toBeTruthy();
            name = 'analyze_task_table';
            input = {
              fileId: inputId,
              mode: 'aggregate',
              metrics: [{ op: 'count_rows' }, { op: 'sum', column: amount.id }],
            };
          } else if (turns === 4) {
            aggregate = resultFrom(request) as TableAggregate;
            expect(aggregate).toMatchObject({ fileId: inputId, complete: true });
            expect(aggregate.overall).toHaveLength(2);
            name = 'create_file';
            input = {
              filename: 'summary.csv',
              format: 'csv',
              content: `metric,value\ndata_rows,${aggregate.overall[0]!.value}\namount_sum,${aggregate.overall[1]!.value}\n`,
            };
          } else if (turns === 5) {
            const created = resultFrom(request);
            expect(created).toMatchObject({ ok: true, file: { filename: 'summary.csv' } });
            generatedId = created.file.fileId;
            name = 'read_task_file';
            input = { fileId: generatedId };
          } else if (turns === 6) {
            const read = resultFrom(request);
            expect(read).toMatchObject({
              fileId: generatedId,
              coverage: { complete: true },
              source: { kind: 'task_generated' },
            });
            expect(read.text).toContain(`data_rows,${aggregate!.overall[0]!.value}`);
            name = 'analyze_task_table';
            input = { fileId: generatedId, mode: 'aggregate', metrics: [{ op: 'count_rows' }] };
          } else if (turns === 7) {
            expect(resultFrom(request)).toMatchObject({
              fileId: generatedId,
              complete: true,
              overall: [{ value: '2' }],
            });
            name = 'finish';
            input = {
              status: 'completed',
              summary: `已完整读取原件并核对 summary.csv：data_rows=${aggregate!.overall[0]!.value}，amount_sum=${aggregate!.overall[1]!.value}。原件和生成文件均已保留。`,
              fields: aggregate!.overall.map((metric) => ({
                name: metric.name,
                value: metric.value,
                fileId: inputId,
                tableFactId: metric.id,
              })),
            };
          } else {
            throw new Error('File continuation did not finish within the seven scripted turns');
          }
          return {
            id: `saved-input-${turns}`,
            metadata,
            stopReason: 'tool_use' as const,
            content: [{ type: 'tool_use' as const, id: `saved-tool-${turns}`, name, input }],
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        } catch (error) {
          await writeFile(
            join(out, 'script-diagnostics.json'),
            JSON.stringify(
              {
                turns,
                receipts,
                error: error instanceof Error ? error.stack : String(error),
                latestToolResult: request.messages.at(-1),
                drain: drain.snapshot(),
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          throw error;
        }
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
    const app = express();
    app.use(
      '/api',
      createHttpApp({
        planner: {} as never,
        executionDrain: admission,
      }),
    );
    server = createServer(app);
    await new Promise<void>((yes) => server!.listen(0, '127.0.0.1', yes));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing App port');
    const origin = `http://127.0.0.1:${address.port}`;
    const token = await signAccessToken({ sub: user, plan: 'pro' });
    const headers = { authorization: `Bearer ${token}` };
    const rpc = async (method: string, input: unknown, post = false) => {
      const res = await fetch(
        `${origin}/api/trpc/${method}${post ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
        {
          method: post ? 'POST' : 'GET',
          headers: { ...headers, 'content-type': 'application/json' },
          ...(post ? { body: JSON.stringify(input) } : {}),
        },
      );
      const body = (await res.json()) as { result?: { data?: unknown }; error?: unknown };
      if (!res.ok || body.error)
        throw new Error(`App RPC failed ${method}: ${JSON.stringify(body.error)}`);
      return body.result!.data as Record<string, unknown>;
    };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'text/csv' }), material.filename);
    const upload = await fetch(`${origin}/api/files/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    expect(upload.status).toBe(200);
    const uploaded = (await upload.json()) as { fileId: string };
    inputId = uploaded.fileId;
    const created = await rpc(
      'tasks.create',
      {
        intent:
          '请使用云端浏览器，仅处理我提供的已保存原始CSV附件。不要访问或下载任何网站。用read_task_file完整读取，再用analyze_task_table完整统计数据行数和amount合计，生成“summary.csv”，列为metric,value，包含data_rows和amount_sum。完整读回和统计新CSV，交付附件原件及生成文件的下载链接。',
        fileIds: [inputId],
        mode: 'auto',
        expertMode: 'normal',
      },
      true,
    );
    expect(created.status).toBe('executing');
    const taskId = String(created.taskId);
    let detail: Record<string, unknown> = {};
    await vi.waitFor(
      async () => {
        detail = await rpc('tasks.detail', { taskId });
        expect(['completed', 'failed'], JSON.stringify(detail)).toContain(detail.status);
      },
      { timeout: 30_000, interval: 250 },
    );
    expect(detail.status, JSON.stringify(detail)).toBe('completed');
    expect(turns).toBe(7);
    expect(JSON.stringify(detail)).toContain(inputId);
    expect(JSON.stringify(detail)).toContain(generatedId);
    expect(attemptedExternalFetches).toEqual([]);
    expect(navigations).toEqual([]);
    const originalDownload = await fetch(`${origin}/api/files/${inputId}/download`, { headers });
    expect(originalDownload.status).toBe(200);
    expect(Buffer.from(await originalDownload.arrayBuffer())).toEqual(bytes);
    const generatedDownload = await fetch(`${origin}/api/files/${generatedId}/download`, {
      headers,
    });
    expect(generatedDownload.status).toBe(200);
    const summary = Buffer.from(await generatedDownload.arrayBuffer());
    expect(
      summary
        .toString()
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n'),
    ).toBe(
      `metric,value\ndata_rows,${aggregate!.overall[0]!.value}\namount_sum,${aggregate!.overall[1]!.value}\n`,
    );
    await probe.reconnect((db) => {
      boundary.current = db;
    });
    const reloaded = await rpc('tasks.detail', { taskId });
    expect(reloaded.status).toBe('completed');
    const [rows] = await probe.db.execute(
      sql`SELECT status, result FROM tasks WHERE external_id=${taskId}`,
    );
    const [quota] = await probe.db.execute(
      sql`SELECT tasks_used, opus_used FROM task_quotas WHERE user_id=7`,
    );
    const [steps] = await probe.db.execute(
      sql`SELECT kind, status, input, output FROM task_steps WHERE task_id=(SELECT id FROM tasks WHERE external_id=${taskId}) ORDER BY seq`,
    );
    expect(JSON.stringify(steps)).toContain('read_task_file');
    expect(JSON.stringify(steps)).toContain('analyze_task_table');
    expect(JSON.stringify(steps)).toContain('create_file');
    expect(String((detail.result as { summary?: string }).summary)).toContain(inputId);
    expect(String((detail.result as { summary?: string }).summary)).toContain(generatedId);
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 }));
    drain.close();
    expect(drain.snapshot().idle).toBe(true);
    expect(hash(await readFile(ledger))).toBe(ledgerBefore);
    await writeFile(
      join(out, 'receipt.json'),
      JSON.stringify(
        {
          scope:
            'actual saved bytes; real HTTP/SQL/tools; scripted model only, not paid real-site acceptance',
          fullFileOnlyTaskAccepted: true,
          completionBoundary: 'opaque task-file contract; source and output receipts verified',
          sourceSHA256: material.sha256,
          sourceBytes: bytes.length,
          inputFileId: inputId,
          generatedFileId: generatedId,
          taskId,
          scriptedModelTurns: turns,
          actualModelCalls: 0,
          websiteExports: 0,
          websiteNavigations: navigations,
          externalFetches: attemptedExternalFetches,
          tableReceipts: receipts,
          originalDownloadSHA256: hash(bytes),
          summarySHA256: hash(summary),
          summaryBytes: summary.length,
          actualSqlRows: rows,
          actualQuota: quota,
          actualSteps: steps,
          browserConfigured: false,
          newConnectionDetailStatus: reloaded.status,
          drain: drain.snapshot(),
          ledgerUnchanged: true,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  },
  90_000,
);
