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
import { tasksRouter } from './tasks.js';

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

it.each(['ready', 'timeout'] as const)(
  'unified executor through tasks.create: %s',
  async (scenario) => {
    expect(original.BROWSER_EXECUTOR).toBe('unified');
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      QWEN_CORE_ALLOWLIST: 'usr_browser_unified',
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ENABLED_LANES: 'browser',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-cn',
      DASHSCOPE_API_KEY: '',
    });
    vi.spyOn(classifier, 'classifyExecutionMode').mockResolvedValue('browser');
    const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
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
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
      metadata,
      async create(request) {
        requests.push(request);
        const turn = requests.length;
        if (scenario === 'timeout' && turn === 2)
          throw new messages.MessagesAdapterError('REQUEST_TIMEOUT', 'Qwen request timeout');
        // The unified loop offers only its own tools and forces a tool call.
        expect(request.tools?.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['snapshot', 'click', 'finish']),
        );
        expect(request.toolChoice).toEqual({ type: 'any' });
        const content: Block[] =
          turn === 1
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
        intent: '打开详情页并点击保存',
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

      expect(consume, diagnostics).toHaveBeenCalledWith(41, 'pro', false);
      if (scenario === 'ready') {
        expect(outcome, diagnostics).toMatchObject({
          status: 'completed',
          metadata: {
            provider: 'alibaba-model-studio',
            model: 'qwen-unified-fixture',
            region: 'cn',
          },
        });
        // The click really ran on the page.
        expect(await page.textContent('#status')).toBe('已保存');
        expect(requests).toHaveLength(4);
        // Every model turn lands in llm_calls (cost accounting), like the legacy loop.
        expect(recorded).toHaveLength(4);
        expect(recorded[0]).toMatchObject({
          provider: 'alibaba-model-studio',
          model: 'qwen-unified-fixture',
          promptTokens: 10,
          completionTokens: 5,
          status: 'ok',
        });
      } else {
        expect(outcome, diagnostics).toMatchObject({ status: 'failed' });
        expect(await page.textContent('#status')).toBe('草稿');
        expect(recorded).toHaveLength(2);
        expect(recorded[1]).toMatchObject({ status: 'error', errorMessage: 'REQUEST_TIMEOUT' });
      }
    } finally {
      await page.close();
    }
  },
  60_000,
);
