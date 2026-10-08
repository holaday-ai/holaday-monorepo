import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import * as messages from '../../llm/messages-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import * as extensionWs from '../../ws/server.js';
import type { Context } from '../context.js';
import { supercarReply } from '../../agent/supercar/qwen-only-agent-loop.js';
import { tasksRouter } from './tasks.js';

/**
 * Unified runtime safety gate through tasks.create: tasks.create passes
 * `classifyRuntimeAction` as onBeforeAction; an irreversible click must park
 * the task in awaiting_user (browser_action) WITHOUT clicking, and run only
 * after the user replies with a confirmation — the legacy loop's behaviour.
 *
 * Template: batch 12 — the full tasks.create path on the default executor
 * (BROWSER_EXECUTOR=unified): admission, quota, the unified tool loop on a
 * real headless Chromium page, llm_calls accounting, step persistence and the
 * terminal outcome. The Qwen model is a scripted fixture speaking the unified
 * protocol (snapshot / click by ref / finish with page evidence).
 */

const PAGE = `<!doctype html><html><head><title>评论</title></head><body>
  <h1>帖子 1024</h1><p id="status">草稿</p>
  <button onclick="document.getElementById('status').textContent='评论已公开'">发布评论</button>
</body></html>`;

const original = { ...env };
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  reloadFeatureFlagsForTest();
  Object.assign(env, original);
  vi.restoreAllMocks();
});

type Block = messages.NeutralOutputContentBlock;
const toolUse = (id: string, name: string, input: unknown): Block => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/** The ref of the 发布评论 button in the latest snapshot the loop sent back. */
function submitRef(request: messages.NeutralMessagesRequest): string {
  const text = JSON.stringify(request.messages.at(-1)?.content ?? '');
  const ref = text.match(/button \\"发布评论\\" \[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`no publish button ref in ${text.slice(0, 400)}`);
  return ref;
}

it('parks an irreversible click for confirmation through tasks.create', async () => {
  expect(original.BROWSER_EXECUTOR).toBe('unified');
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    AGENT_MODE: 'legacy',
    QWEN_CORE_ALLOWLIST: 'usr_browser_gate',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ENABLED_LANES: 'browser',
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
    DASHSCOPE_API_KEY: '',
  });
  vi.spyOn(classifier, 'classifyExecutionMode').mockResolvedValue('browser');
  vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
  vi.spyOn(TaskRepository.prototype, 'isTaskCancelled').mockResolvedValue(false);
  const awaiting = vi
    .spyOn(TaskRepository.prototype, 'persistAwaitingUser')
    .mockResolvedValue({ persisted: true } as never);
  const terminal = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockResolvedValue({ persisted: true });
  vi.spyOn(extensionWs, 'broadcastToUser');
  const drain = new ExecutionDrain();
  drain.open();

  const metadata = {
    provider: 'alibaba-model-studio',
    model: 'qwen-unified-fixture',
    region: 'cn',
    deploymentScope: 'china_mainland',
    endpointKind: 'public',
    protocol: 'messages',
  } as const;
  const requests: messages.NeutralMessagesRequest[] = [];
  vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
    metadata,
    async create(request) {
      requests.push(request);
      const turn = requests.length;
      const content: Block[] =
        turn === 1
          ? [toolUse('s1', 'snapshot', {})]
          : turn === 2
            ? [toolUse('c1', 'click', { ref: submitRef(request) })]
            : [
                toolUse('f1', 'finish', {
                  status: 'completed',
                  summary: '评论已公开发布。',
                  evidence: '评论已公开',
                }),
              ];
      return {
        id: `response-${turn}`,
        metadata,
        stopReason: 'tool_use',
        content,
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

  const page: Page = await browser.newPage();
  await page.setContent(PAGE);
  const executor = {
    getPage: async () => page,
    resetPageForTask: async () => {},
    screenshot: async () => ({
      base64: (await page.screenshot({ type: 'jpeg' })).toString('base64'),
      viewportWidth: 1280,
      viewportHeight: 720,
    }),
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
                modelDataRegion: 'cn',
              },
            ]
          : 'count' in projection
            ? [{ count: 0 }]
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
      return { from: () => query };
    },
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (table === llmCalls) recorded.push(row);
        if (table === taskSteps) stepRecords.push(row);
        return [];
      },
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  const ctx = {
    db,
    logger,
    userId: 'usr_browser_gate',
    req: {},
    res: {},
    planner: {},
    playwrightExecutor: executor,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
  } as unknown as Context;

  try {
    const result = await tasksRouter.createCaller(ctx).create({
      intent: '打开帖子页并发布这条评论',
      mode: 'auto',
      expertMode: 'normal',
    });
    expect(result.status).toBe('executing');
    await vi.waitFor(
      () =>
        expect(awaiting).toHaveBeenCalledWith(
          expect.objectContaining({
            taskExternalId: result.taskId,
            awaitingKind: 'browser_action',
            question: expect.stringContaining('发布评论'),
          }),
        ),
      { timeout: 20_000 },
    );
    // Parked before the click: nothing was published.
    expect(await page.textContent('#status')).toBe('草稿');
    expect(terminal).not.toHaveBeenCalled();

    expect(supercarReply(result.taskId, '确认执行')).toBe(true);
    await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
    expect(terminal.mock.calls.at(-1)?.[1], JSON.stringify(terminal.mock.calls.at(-1)?.[1])).toMatchObject({ status: 'completed' });
    expect(await page.textContent('#status')).toBe('评论已公开');
  } finally {
    await page.close();
  }
}, 60_000);
