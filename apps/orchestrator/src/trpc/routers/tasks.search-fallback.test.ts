import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import { supercarAbort } from '../../agent/supercar/index.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskSteps } from '../../db/schema/task-steps.js';
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

const PAGE = `<html><head><title>Search results</title></head><body><h1>Search results</h1>${[1, 2, 3, 4, 5].map((i) => `<a href="https://example.com/${i}">Result ${i}</a>`).join('<br>')}</body></html>`;

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

// scrape-retry (FIX-INTENT-ROUTE-BROWSER): the scrape lane's one-time handoff re-enters
// create with an internal ctx flag; it adopts the scrape task's row and is not charged again.
it('search wall uses a same-task fallback without a second quota debit', async () => {
  expect(original.BROWSER_EXECUTOR).toBe('unified');
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    AGENT_MODE: 'legacy',
    QWEN_CORE_ALLOWLIST: 'usr_browser_unified',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ENABLED_LANES: 'browser,plan',
    BROWSER_OBSERVATION_V2: true,
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
        turn === 1
          ? [toolUse('google', 'navigate', { url: 'https://www.google.com/sorry/index' })]
          : turn === 2
            ? [toolUse('bing', 'navigate', { url: 'https://www.bing.com/search?q=HOLA+DAY+AI' })]
            : turn === 3
              ? [toolUse('read', 'read_page', {})]
              : turn === 4
                ? [toolUse('links', 'links', { limit: 20 })]
                : [
                    toolUse('finish', 'finish', {
                      status: 'completed',
                      summary: [1, 2, 3, 4, 5]
                        .map((i) => `${i}. [Result ${i}](https://example.com/${i})`)
                        .join('\n'),
                      evidence: 'Result 1',
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
  await page.route('https://www.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><title>Unusual traffic</title><h1>Our systems have detected unusual traffic from your computer network</h1><div class="g-recaptcha">Verify you are human</div></html>',
    }),
  );
  await page.route('https://www.bing.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: PAGE }),
  );
  vi.spyOn(TaskRepository.prototype, 'persistAwaitingUser').mockImplementation(async (input) => {
    supercarAbort(input.taskExternalId);
    return { persisted: true };
  });
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
      intent: '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接',
      mode: 'auto',
      expertMode: 'normal',
    });
    expect(result.status).toBe('executing');
    try {
      await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
    } catch (error) {
      console.error(
        'FALLBACK_DIAGNOSTIC',
        JSON.stringify({
          url: page.url(),
          events: eventRecords,
          steps: stepRecords,
          warnings: logger.warn.mock.calls,
          errors: logger.error.mock.calls,
          awaiting: vi.mocked(TaskRepository.prototype.persistAwaitingUser).mock.calls,
        }),
      );
      throw error;
    }
    const outcome = terminal.mock.calls.at(-1)?.[1];
    const diagnostics = JSON.stringify({
      errors: logger.error.mock.calls,
      outcome,
      requests: requests.length,
    });

    expect(outcome, diagnostics).toMatchObject({ status: 'completed' });
    expect(QuotaService.prototype.tryConsume).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(5);
    expect(
      (outcome as { metadata?: { fallbackChain?: string[] } })?.metadata?.fallbackChain,
    ).toEqual(['browser', 'search:google', 'search:bing']);
    expect(outcome?.status === 'completed' ? outcome.summary : '').toContain(
      'Google 要求人机验证，已改用 Bing 搜索',
    );
    expect(
      eventRecords
        .filter((e) => e.type === 'browser.search_fallback')
        .map((e) => (e.payload as { phase: string }).phase),
    ).toEqual(['started', 'completed']);
    expect(new Set(stepRecords.map((r) => r.seq)).size).toBe(stepRecords.length);
    expect(eventRecords.every((e) => e.taskId === 41)).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);
