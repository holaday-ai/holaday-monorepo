import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import * as messages from '../../llm/messages-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import * as extensionWs from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

vi.mock('../../llm/messages-adapter.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../llm/messages-adapter.js')>();
  return { ...original, createQwenMessagesAdapter: vi.fn(original.createQwenMessagesAdapter) };
});

/**
 * Batch 12 — the full tasks.create path on the default executor
 * (BROWSER_EXECUTOR=unified): admission, quota, the unified tool loop on a
 * real headless Chromium page, llm_calls accounting, step persistence and the
 * terminal outcome. The Qwen model is a scripted fixture speaking the unified
 * protocol (snapshot / click by ref / finish with page evidence).
 */

const PAGE = `<!doctype html><html><head><title>订单详情</title></head><body>
  <h1>订单 1024</h1><p id="status">草稿</p>
  <button onclick="document.getElementById('status').textContent='已保存'">保存</button>
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

/** The ref of the 保存 button in the latest snapshot the loop sent back. */
function saveRef(request: messages.NeutralMessagesRequest): string {
  const text = JSON.stringify(request.messages.at(-1)?.content ?? '');
  const ref = text.match(/button \\"保存\\" \[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`no save button ref in ${text.slice(0, 400)}`);
  return ref;
}

// scrape-retry (FIX-INTENT-ROUTE-BROWSER): the scrape lane's one-time handoff re-enters
// create with an internal ctx flag; it adopts the scrape task's row and is not charged again.
it.each(['planning', 'diagnostic'] as const)(
  'unified executor through tasks.create: %s',
  async (scenario) => {
    expect(original.BROWSER_EXECUTOR).toBe('unified');
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      QWEN_CORE_ALLOWLIST: 'usr_browser_unified',
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ENABLED_LANES: 'browser,plan',
      BROWSER_OBSERVATION_V2: scenario === 'diagnostic',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-cn',
      DASHSCOPE_API_KEY: '',
    });
    vi.spyOn(classifier, 'explainExecutionMode').mockResolvedValue({
      mode: 'browser',
      source: 'test',
    });
    vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
    vi.spyOn(TaskRepository.prototype, 'adoptTaskForBrowserRetry').mockResolvedValue({
      persisted: true,
    });
    vi.spyOn(TaskRepository.prototype, 'isTaskCancelled').mockResolvedValue(false);
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
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation((config) => ({
      metadata:
        config.purpose === 'standard'
          ? { ...metadata, model: config.environment.QWEN_STANDARD_MODEL }
          : metadata,
      async create(request) {
        if (config.purpose === 'standard')
          return {
            id: 'plan-call',
            metadata: this.metadata,
            stopReason: 'end_turn',
            content: [{ type: 'text', text: '{"skip":true}' }],
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              complete: true,
            },
          };
        requests.push(request);
        const turn = requests.length;

        // The unified loop offers only its own tools and forces a tool call.
        expect(request.tools?.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['snapshot', 'click', 'finish']),
        );
        expect(request.toolChoice).toEqual({ type: 'any' });
        const content: Block[] =
          scenario === 'diagnostic'
            ? turn === 1
              ? [toolUse('read', 'read_page', {})]
              : [
                  toolUse('done', 'finish', {
                    status: 'completed',
                    summary:
                      turn === 2 ? '标题：Invented title; token=hidden-test-token' : '订单 1024',
                    evidence: turn === 2 ? 'Invented title' : '订单 1024',
                  }),
                ]
            : turn === 1
              ? [toolUse('s1', 'snapshot', {})]
              : turn === 2
                ? [toolUse('c1', 'click', { ref: saveRef(request) })]
                : turn === 3
                  ? [toolUse('s2', 'snapshot', {})]
                  : [
                      toolUse('f1', 'finish', {
                        status: 'completed',
                        summary: '订单已保存。',
                        evidence: '已保存',
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
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }),
    );
    await page.goto('https://fixture.browser.test/');
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
    const eventRecords: Record<string, unknown>[] = [];
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
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return { from: () => query };
      },
      insert: (table: unknown) => ({
        values: async (row: Record<string, unknown>) => {
          if (table === llmCalls) recorded.push(row);
          if (table === taskEvents) eventRecords.push(row);
          if (table === taskSteps) stepRecords.push(row);
          return [];
        },
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    };
    const ctx = {
      db,
      logger,
      userId: 'usr_browser_unified',
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
        // Executor path under test; an explicit order/login need would route to the user's Chrome.
        intent: scenario === 'diagnostic' ? '打开详情页并读取标题' : '打开详情页并点击保存',
        mode: 'auto',
        expertMode: 'normal',
      });
      expect(result.status).toBe('executing');
      await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
      const outcome = terminal.mock.calls.at(-1)?.[1];
      const diagnostics = JSON.stringify({
        errors: logger.error.mock.calls,
        outcome,
        requests: requests.length,
      });

      expect(outcome, diagnostics).toMatchObject({ status: 'completed' });
      const planning = recorded.find((row) => row.purpose === 'browser.planning');
      expect(planning).toMatchObject({
        taskId: 41,
        model: 'qwen3.8-flash',
        promptTokens: 10,
        completionTokens: 5,
        status: 'ok',
      });
      expect(planning?.costUsd).not.toBeNull();
      if (scenario === 'diagnostic') {
        await vi.waitFor(() =>
          expect(eventRecords.some((e) => e.type === 'browser.finish_rejected')).toBe(true),
        );
        const event = JSON.stringify(eventRecords);
        expect(event).toContain('Invented title');
        expect(event).not.toContain('hidden-test-token');
      }
    } finally {
      await page.close();
    }
  },
  60_000,
);
