import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import {
  type MaintenanceRecord,
  OrdinaryMaintenance,
} from '../../execution/ordinary-maintenance.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import * as storageProvider from '../../files/storage-provider.js';
import * as messages from '../../llm/messages-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import * as extensionWs from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const original = { ...env };
// The scripted Qwen fixture speaks the legacy coordinate protocol; the default
// executor is unified since batch 08, so pin the rollback mode here.
beforeEach(() => {
  Object.assign(env, { BROWSER_EXECUTOR: 'legacy' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  reloadFeatureFlagsForTest();
  Object.assign(env, original);
  vi.restoreAllMocks();
});

it.each([
  'v2-offline',
  'v2-grant',
  // FIX-PR250: ordinary login / private-data wording, with and without an
  // explicit public-cloud choice, is held before model preflight and quota.
  'v2-private-repo',
  'v2-inbox-public-cloud',
  // FIX-PR252: routing flag OFF — the retired cookie sync must not send a
  // login-required task to a logged-out cloud browser.
  'v2-flag-off-identity',
  'ready',
  'timeout',
  'disabled',
  'region',
  'credentials',
  'executor',
  'local',
  'local-file',
  'ordinary',
] as const)('formal Qwen browser task admission and execution: %s', async (scenario) => {
  const isV2 = scenario.startsWith('v2-');
  if (isV2) {
    if (scenario !== 'v2-flag-off-identity') vi.stubEnv('USER_BROWSER_ROUTING_V2', 'true');
    vi.spyOn(extensionWs, 'hasConnectedExtension').mockReturnValue(
      scenario === 'v2-grant' || scenario === 'v2-inbox-public-cloud',
    );
  }
  const awaiting = vi
    .spyOn(TaskRepository.prototype, 'persistAwaitingUser')
    .mockResolvedValue({ persisted: true });
  const isLocal = scenario === 'local' || scenario === 'local-file';
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    AGENT_MODE: 'legacy',
    QWEN_CORE_ALLOWLIST: 'usr_browser_qwen',
    // Qwen is on by default; the env can only switch it off (kill switch).
    QWEN_CORE_ROLLOUT_MODE: scenario === 'disabled' ? 'off' : 'synthetic',
    QWEN_CORE_ENABLED_LANES: 'browser',
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: scenario === 'credentials' ? '' : 'synthetic-cn',
    DASHSCOPE_API_KEY: '',
  });
  vi.spyOn(classifier, 'classifyExecutionMode').mockResolvedValue(isLocal ? 'generate' : 'browser');
  const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
  vi.spyOn(TaskRepository.prototype, 'isTaskCancelled').mockResolvedValue(false);
  const terminal = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockResolvedValue({ persisted: true });
  const requests: messages.NeutralMessagesRequest[] = [];
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let maintenanceRecord: MaintenanceRecord = {
    identity,
    mode: 'closed',
    needsReconciliation: false,
  };
  const maintenance = new OrdinaryMaintenance({
    identity,
    journal: {
      read: () => structuredClone(maintenanceRecord),
      persist: (next) => {
        maintenanceRecord = { identity, ...next };
      },
    },
    checks: {
      verifyReady: async () => {},
      stopProducers: async () => {},
      verifyRetainedQueue: async () => {},
    },
  });
  const drain = scenario === 'ordinary' ? maintenance.drain : new ExecutionDrain();
  if (scenario === 'ordinary') await maintenance.resumeServing();
  else drain.open();
  let releaseModel!: () => void;
  const modelGate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  let releasePersistence!: () => void;
  let markPersistenceStarted!: () => void;
  const persistenceGate = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });
  const persistenceStarted = new Promise<void>((resolve) => {
    markPersistenceStarted = resolve;
  });
  if (isLocal || scenario === 'ordinary') vi.stubEnv('EVIDENCE_LEDGER_ENABLED', 'true');
  reloadFeatureFlagsForTest();
  const effects: string[] = [];
  if (isLocal) {
    vi.spyOn(extensionWs, 'sendExtensionToolCall').mockImplementation(async (_user, call) => {
      if (call.extensionClientId !== '48a8a099-0987-40e3-aa14-fb4545f9a003')
        throw new Error('wrong connection');
      const command = call.args?.session;
      if (command?.op === 'act') effects.push('local-act');
      const observation = {
        tabId: 42,
        origin: 'https://work.example',
        title: 'Details',
        bodyText:
          scenario === 'local-file'
            ? 'name score Alpha 2 Beta, Inc 3'
            : effects.length
              ? 'Saved'
              : 'Draft',
        ariaSnapshot: '- button "Save"',
        truncated: false,
      };
      return {
        ok: true,
        extensionClientId: call.extensionClientId,
        result:
          call.kind === 'read'
            ? { ...observation, finalUrl: observation.origin, selectedSessionVersion: 1 }
            : command?.op === 'close'
              ? { ok: true, closed: true }
              : {
                  ok: true,
                  sessionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
                  observation,
                  ...(command?.op === 'act' ? { actionOutcome: 'applied' } : {}),
                },
      };
    });
  }
  const metadata = {
    provider: 'alibaba-model-studio',
    model: 'qwen-vision-fixture',
    region: 'cn',
    deploymentScope: 'china_mainland',
    endpointKind: 'public',
    protocol: 'messages',
  } as const;
  const createAdapter = vi
    .spyOn(messages, 'createQwenMessagesAdapter')
    .mockImplementation(({ region, purpose }) => {
      expect(region).toBe('cn');
      expect(purpose).toBe('vision');
      return {
        metadata,
        async create(request) {
          requests.push(request);
          if ((scenario === 'local' || scenario === 'ordinary') && requests.length === 1)
            await modelGate;
          if (scenario === 'timeout' && requests.length === 2)
            throw new messages.MessagesAdapterError('REQUEST_TIMEOUT', 'Qwen request timeout');
          return {
            id: 'response',
            metadata,
            stopReason: requests.length === 1 ? 'tool_use' : 'end_turn',
            content: isLocal
              ? [
                  {
                    type: 'tool_use',
                    id: `local-${requests.length}`,
                    name:
                      requests.length === 1
                        ? scenario === 'local-file'
                          ? 'create_file'
                          : 'browser_act'
                        : 'browser_finish',
                    input:
                      requests.length === 1
                        ? scenario === 'local-file'
                          ? {
                              filename: 'notes.csv',
                              format: 'csv',
                              content:
                                '[{"name":"Alpha","score":2},{"name":"Beta, Inc","score":3}]',
                            }
                          : {
                              // Clicks in the user's Chrome go to a human handoff
                              // until targets are host-verified; typing still runs.
                              action: {
                                kind: 'type',
                                payload: { text: '已修改' },
                                selector: {
                                  description: 'Save',
                                  strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
                                  scope: { timeoutMs: 5000 },
                                  selfHeal: false,
                                },
                              },
                            }
                        : scenario === 'local-file'
                          ? { summary: '已生成可下载的 CSV。', evidenceText: 'Alpha 2' }
                          : { summary: '已保存页面中的修改。', evidenceText: 'Saved' },
                  },
                ]
              : requests.length === 1
                ? [
                    {
                      type: 'tool_use',
                      id: 'click',
                      name: 'computer',
                      input: { action: 'left_click', coordinate: [120, 80] },
                    },
                  ]
                : [{ type: 'text', text: '已查看页面内容并完成操作。' }],
            usage: {
              inputTokens: 10,
              outputTokens: 10,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        },
      };
    });
  const page = {
    url: () => 'https://93.184.216.34/',
    title: async () => 'Synthetic page',
    evaluate: async () => ({ bodyTextLen: 100, images: 0, inputs: 0, buttons: 1 }),
    waitForTimeout: async () => {},
  };
  const executor = {
    getPage: async () => page,
    resetPageForTask: async () => {},
    screenshot: async () => ({ base64: 'cGFnZQ==', viewportWidth: 1280, viewportHeight: 720 }),
    click: async (_page: unknown, x: number, y: number) => {
      effects.push(`${x},${y}`);
      return { ok: true };
    },
  };
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const recorded: Record<string, unknown>[] = [];
  const stepRecords: Record<string, unknown>[] = [];
  const fileRows: Record<string, unknown>[] = [];
  const storageWrites: Array<{ userExternalId: string; buffer: Buffer; filename: string }> = [];
  if (scenario === 'local-file') {
    vi.spyOn(storageProvider, 'getSharedStorageProvider').mockReturnValue({
      put: async (input: { userExternalId: string; buffer: Buffer; filename: string }) => {
        storageWrites.push(input);
        return { storagePath: 'fixture/output/notes.csv' };
      },
    } as unknown as ReturnType<typeof storageProvider.getSharedStorageProvider>);
  }
  const broadcast = vi.spyOn(extensionWs, 'broadcastToUser');
  const db = {
    select(projection: Record<string, unknown> = {}) {
      const rows =
        'plan' in projection
          ? [
              {
                id: 41,
                plan: 'pro',
                selectedRoles: [],
                selectedSkills: [],
                modelDataRegion: scenario === 'region' ? null : 'cn',
              },
            ]
          : isV2 && 'status' in projection
            ? [
                {
                  id: 77,
                  status: 'awaiting_user',
                  intent: '查看我的京东订单',
                  result: {
                    metadata: {
                      browserSource: 'local-chrome',
                      ...(scenario === 'v2-flag-off-identity'
                        ? { browserRoutingAwaiting: 'extension_offline' }
                        : {}),
                    },
                  },
                  awaitingQuestion: '请连接插件并重新选择页面',
                },
              ]
            : isV2 && 'modelDataRegion' in projection
              ? [{ id: 41, modelDataRegion: 'cn' }]
              : 'count' in projection
                ? [{ count: 0 }]
                : scenario === 'local-file' && 'id' in projection && 'userId' in projection
                  ? [{ id: 41, userId: 41 }]
                  : Object.keys(projection).length === 1 && 'id' in projection
                    ? [{ id: 41 }]
                    : [];
      const query = {
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable; this is the database boundary fixture.
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      const fileQuery = {
        where: () => fileQuery,
        limit: async () => fileRows,
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable; this is the database boundary fixture.
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(fileRows).then(resolve),
      };
      return { from: (table: unknown) => (table === taskFiles ? fileQuery : query) };
    },
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (table === llmCalls) recorded.push(row);
        if (table === taskSteps) stepRecords.push(row);
        if (table === taskFiles)
          fileRows.push({ id: fileRows.length + 1, status: 'active', ...row });
        return [];
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if ((scenario === 'local' || scenario === 'ordinary') && 'evidenceJson' in values) {
            markPersistenceStarted();
            await persistenceGate;
          }
          return [];
        },
      }),
    }),
  };
  const ctx = {
    db,
    logger,
    userId: 'usr_browser_qwen',
    req: {},
    res: {},
    planner: {},
    playwrightExecutor: scenario === 'executor' || isLocal || isV2 ? null : executor,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
    ...(scenario === 'ordinary'
      ? { executionDrain: maintenance, ordinaryMaintenance: maintenance }
      : {}),
    ...(isLocal
      ? {
          executionDrain: {
            drain,
            runRoot: (action: (lifetime: OperationLifetime) => Promise<unknown>) =>
              startOwnedOperation(drain, 'request', (owner) => action({ drain, owner }), {
                errorOutcome: 'unknown',
              }),
          },
        }
      : {}),
  } as unknown as Context;
  const pending = tasksRouter.createCaller(ctx).create({
    intent: isV2
      ? scenario === 'v2-private-repo'
        ? '登录 GitHub 后读取私有仓库列表'
        : scenario === 'v2-inbox-public-cloud'
          ? '查看 Gmail 收件箱'
          : '查看我的京东订单'
      : scenario === 'local-file'
        ? '从当前 Chrome 页面生成可下载 CSV'
        : '查看网页内容并点击详情',
    mode: 'auto',
    expertMode: 'normal',
    ...(scenario === 'v2-inbox-public-cloud' ? { browserPreference: 'cloud-public' as const } : {}),
    ...(isLocal
      ? {
          localChrome: {
            extensionClientId: '48a8a099-0987-40e3-aa14-fb4545f9a003',
            tabId: 42,
            expectedUrl: 'https://work.example',
            selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
          },
        }
      : {}),
  });
  if (scenario === 'executor') {
    await expect(pending).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(consume).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    return;
  }
  const result = await pending;
  if (isV2) {
    expect(result.status).toBe('awaiting_user');
    expect(consume).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    // FIX-D11: every identity wait carries the connection marker; no public-cloud fallback.
    if (scenario !== 'v2-grant') {
      const connection = {
        reason: scenario === 'v2-inbox-public-cloud' ? 'selection_required' : 'extension_offline',
        publicCloudAllowed: false,
      };
      expect((result as { browserConnection?: unknown }).browserConnection).toEqual(connection);
      expect(broadcast).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'server.supercar.awaiting_user',
          browserConnection: connection,
        }),
      );
      expect(awaiting).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            metadata: expect.objectContaining({ browserConnection: connection }),
          }),
        }),
      );
      expect((result as { question: string }).question).toContain('需要连接 HOLA DAY Chrome 插件');
    }
    expect(createAdapter).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
    expect(awaiting).toHaveBeenCalledWith(expect.objectContaining({ awaitingKind: 'permission' }));
    const replied = await tasksRouter
      .createCaller(ctx)
      .reply({ taskId: result.taskId, message: '继续' });
    expect(replied).toEqual({ ok: true, state: 'stillAwaiting' });
    expect(consume).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    return;
  }
  if (scenario === 'disabled' || scenario === 'region' || scenario === 'credentials') {
    expect(result.status).toBe('failed');
    expect(consume).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(terminal.mock.calls.at(-1)?.[1]).toMatchObject({
      errorCode:
        scenario === 'region'
          ? 'MODEL_DATA_REGION_UNASSIGNED'
          : scenario === 'credentials'
            ? 'REGION_SERVICE_NOT_CONFIGURED'
            : 'MODEL_MIGRATION_IN_PROGRESS',
    });
    return;
  }
  expect(result.status).toBe('executing');
  if (scenario === 'ordinary') {
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(drain.snapshot().roots).toBe(0);
    expect(drain.snapshot().byKind.execution).toBeGreaterThan(0);
    await maintenance.beginMaintenance();
    expect(drain.snapshot().idle).toBe(false);
    releaseModel();
  }
  if (scenario === 'local-file') {
    await vi.waitFor(() => expect(terminal).toHaveBeenCalled());
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 }));
    drain.close();
    expect(
      terminal.mock.calls.at(-1)?.[1],
      JSON.stringify({ firstStep: stepRecords[0], files: fileRows }),
    ).toMatchObject({ status: 'completed' });
    expect(fileRows).toHaveLength(1);
    const file = fileRows[0];
    if (!file) throw new Error('expected persisted output file');
    expect(file).toMatchObject({
      userId: 41,
      kind: 'output',
      filename: 'notes.csv',
      mimetype: 'text/csv; charset=utf-8',
      status: 'active',
    });
    expect(file.externalId).toMatch(/^file_/);
    expect(file.taskId).toBe(41);
    expect(storageWrites).toHaveLength(1);
    const storageWrite = storageWrites[0];
    if (!storageWrite) throw new Error('expected persisted output bytes');
    expect(storageWrite.userExternalId).toBe('usr_browser_qwen');
    expect(storageWrite.filename).toBe('notes.csv');
    expect(storageWrite.buffer).toEqual(Buffer.from('name,score\nAlpha,2\n"Beta, Inc",3', 'utf8'));
    const finalOutcome = terminal.mock.calls.at(-1)?.[1];
    if (!finalOutcome || !('summary' in finalOutcome) || typeof finalOutcome.summary !== 'string') {
      throw new Error('expected persisted file summary');
    }
    const summary = finalOutcome.summary;
    expect(summary).toMatch(/```holaday-file\n[^\n]+\n```/);
    const receipt = JSON.parse(summary.match(/```holaday-file\n([^\n]+)\n```/)?.[1] ?? 'null');
    expect(receipt).toMatchObject({
      fileId: file.externalId,
      downloadUrl: `/api/files/${file.externalId}/download`,
      filename: 'notes.csv',
      size: storageWrite.buffer.length,
    });
    return;
  }
  if (scenario === 'local') {
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(drain.snapshot().roots).toBe(0);
    expect(drain.snapshot().byKind.execution).toBe(1);
    const charged = consume.mock.calls.length;
    await expect(
      tasksRouter.createCaller(ctx).create({
        intent: '查看其他内容',
        localChrome: {
          extensionClientId: '48a8a099-0987-40e3-aa14-fb4545f9a003',
          tabId: 43,
          expectedUrl: 'https://work.example',
          selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(consume).toHaveBeenCalledTimes(charged);
    expect(TaskRepository.prototype.insertTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceContext: { browserSource: 'local-chrome' } }),
    );
    releaseModel();
  }
  await vi.waitFor(() =>
    expect(
      effects,
      JSON.stringify({
        errors: logger.error.mock.calls,
        warnings: logger.warn.mock.calls,
        terminal: terminal.mock.calls,
      }),
      // Qwen emits 0..1000 coordinates: floor(120*1280/1000), floor(80*720/1000).
    ).toEqual(scenario === 'local' ? ['local-act'] : ['153,57']),
  );
  await vi.waitFor(() => expect(terminal).toHaveBeenCalled());
  if (scenario === 'ordinary') {
    await persistenceStarted;
    try {
      expect(drain.snapshot().byKind.execution).toBeGreaterThan(0);
    } finally {
      releasePersistence();
    }
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 }));
    await maintenance.waitForIdle(1000);
    expect(maintenance.snapshot().mode).toBe('closed');
  }
  if (scenario === 'local') {
    await persistenceStarted;
    try {
      expect(drain.snapshot().byKind.execution).toBe(1);
    } finally {
      releasePersistence();
    }
    await vi.waitFor(() => expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 }));
    drain.close();
    expect(drain.snapshot().idle).toBe(true);
    expect(stepRecords).toMatchObject([
      {
        seq: 1,
        kind: 'selected_chrome_action',
        status: 'done',
        output: { execution: { ok: true } },
      },
      { seq: 2, kind: 'selected_chrome_finish', status: 'done' },
    ]);
    expect(
      broadcast.mock.calls
        .map((call) => call[1])
        .filter((event) => event.type === 'server.vision.tick.end'),
    ).toMatchObject([
      { tickIndex: 1, actionKind: 'selected_chrome_action', ok: true },
      { tickIndex: 2, actionKind: 'selected_chrome_finish', ok: true },
    ]);
  }
  expect(requests.length).toBe(2);
  expect(recorded).toHaveLength(2);
  expect(recorded[0]).toMatchObject({
    provider: 'alibaba-model-studio',
    model: 'qwen-vision-fixture',
    region: 'cn',
    providerRequestId: 'response',
    costUsd: null,
    costStatus: 'unpriced',
    promptTokens: 10,
    completionTokens: 10,
    usageStatus: 'complete',
    status: 'ok',
  });
  expect(recorded[1]).toMatchObject(
    scenario === 'timeout'
      ? {
          status: 'error',
          promptTokens: null,
          completionTokens: null,
          costUsd: null,
          costStatus: 'usage_missing',
          errorMessage: 'REQUEST_TIMEOUT',
        }
      : { status: 'ok', costUsd: null, costStatus: 'unpriced' },
  );
  expect(consume).toHaveBeenCalledWith(41, 'pro', false);
  expect(terminal.mock.calls.at(-1)?.[1]).toMatchObject({
    metadata: { provider: 'alibaba-model-studio', model: 'qwen-vision-fixture', region: 'cn' },
  });
  expect(terminal.mock.calls.at(-1)?.[1]?.status).toBe(
    scenario === 'timeout' ? 'failed' : 'completed',
  );
});
