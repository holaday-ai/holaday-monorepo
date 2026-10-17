import { afterEach, describe, expect, it, vi } from 'vitest';
import * as planning from '../../agent/core-task-plan.js';
import { CoreTaskRepository } from '../../agent/core-task-repository.js';
import * as classifier from '../../agent/intent-classifier.js';
import * as scraping from '../../agent/scrape-runner.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import {
  reloadFeatureFlagsForTest,
  setFeatureFlagsForTest,
} from '../../execution/feature-flags.js';
import { QuotaService } from '../../quota/quota-service.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

/**
 * FIX-INTENT-ROUTE-BROWSER — a search-engine task that asks for result links
 * goes through the real scrape lane of tasks.create; when the scrape answer has
 * fewer real links than requested, the same task is handed to the browser lane
 * once (internal ctx flag, same taskId, idempotency key dropped) instead of
 * failing, and the reason is recorded. The browser lane itself is covered by
 * tasks.browser-unified.test.ts (scrape-retry scenario).
 */

const INTENT = 'Google 搜索「HOLA DAY AI」返回前5条标题和链接';
const original = { ...env };
afterEach(() => {
  reloadFeatureFlagsForTest();
  Object.assign(env, original);
  vi.restoreAllMocks();
});

function context(): Context {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const db = {
    select(projection: Record<string, unknown>) {
      if ('plan' in projection)
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: 41,
                  plan: 'free',
                  selectedRoles: [],
                  selectedSkills: [],
                  modelDataRegion: 'cn',
                },
              ],
            }),
          }),
        };
      if ('count' in projection) return { from: () => ({ where: async () => [{ count: 0 }] }) };
      if ('status' in projection)
        return {
          from: () => ({ where: () => ({ limit: async () => [{ status: 'executing' }] }) }),
        };
      throw new Error('Unexpected test database read');
    },
  };
  return {
    db,
    logger,
    planner: {},
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
    firecrawl: { scrape: vi.fn(), search: vi.fn() },
    paypalAdapter: null,
    downloadManager: null,
    req: {},
    res: {},
    userId: 'usr_scrape_retry_test',
  } as unknown as Context;
}

function setup(summary: string, sources: string[] = []) {
  setFeatureFlagsForTest({ EVIDENCE_LEDGER: true, EXECUTION_CONTRACT: true });
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ALLOWLIST: 'usr_scrape_retry_test',
    QWEN_CORE_ENABLED_LANES: 'plan,generate,scrape',
    QWEN_RESPONSES_ADAPTER_ENABLED: true,
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
  });
  vi.spyOn(classifier, 'explainExecutionMode').mockResolvedValue({
    mode: 'scrape',
    source: 'kw:search-verb',
    match: '搜索',
  });
  const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
  const persisted = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockResolvedValue({ persisted: true });
  vi.spyOn(planning, 'prepareCoreTaskPlan').mockResolvedValue(null);
  vi.spyOn(scraping, 'runScrapeTask').mockResolvedValue({
    status: 'completed',
    summary,
    source: 'search',
    sources,
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 1,
  });
  let admitted: import('../../agent/core-task-admission.js').CoreAdmission | undefined;
  vi.spyOn(CoreTaskRepository.prototype, 'admit').mockImplementation(async (op) => {
    admitted = op;
    return { persisted: true };
  });
  vi.spyOn(CoreTaskRepository.prototype, 'readHead').mockImplementation(async () =>
    admitted
      ? {
          status: 'executing',
          executionId: admitted.executionId,
          executionRevision: admitted.executionRevision,
          recordVersion: admitted.recordVersion,
        }
      : null,
  );
  const settled = vi
    .spyOn(CoreTaskRepository.prototype, 'settle')
    .mockResolvedValue({ persisted: true });
  // Calls carrying the internal retry flag are the handoff; every other call is real.
  const realCreateCaller = tasksRouter.createCaller.bind(tasksRouter);
  const retryCreate = vi.fn().mockResolvedValue({ taskId: 'ignored', status: 'executing' });
  const handoffs: Context[] = [];
  vi.spyOn(tasksRouter, 'createCaller').mockImplementation(((ctx: Context) => {
    if (!ctx.scrapeBrowserRetry) return realCreateCaller(ctx);
    handoffs.push(ctx);
    return { create: retryCreate };
  }) as unknown as typeof tasksRouter.createCaller);
  return { consume, persisted, settled, retryCreate, handoffs };
}

/** Whatever terminal write the lane used, its metadata. */
function terminalMetadata(spies: ReturnType<typeof setup>): Record<string, unknown> | undefined {
  const fromVision = spies.persisted.mock.calls.at(-1)?.[1] as
    | { metadata?: Record<string, unknown> }
    | undefined;
  if (fromVision?.metadata) return fromVision.metadata;
  return JSON.parse(JSON.stringify(spies.settled.mock.calls.at(-1) ?? null))?.[0]?.result?.metadata;
}

describe('scrape → browser one-time retry for search-engine link requests', () => {
  it('hands the same task to the browser lane when the scrape has no real links', async () => {
    const spies = setup('1. HOLA DAY 官网\n2. HOLA DAY AI 介绍\n3. HOLA DAY 新闻');
    const result = await tasksRouter.createCaller(context()).create({
      intent: INTENT,
      expertMode: 'normal',
    });
    expect(result.executionMode).toBe('scrape');
    await vi.waitFor(() => expect(spies.retryCreate).toHaveBeenCalledTimes(1));
    expect(spies.handoffs[0]?.scrapeBrowserRetry).toEqual({
      taskId: result.taskId,
      reason: expect.stringContaining('需要 5 条带真实链接的结果，只取得 0 条'),
    });
    expect(spies.handoffs[0]?.scrapeBrowserRetry?.reason).toContain('已自动改用云端浏览器重试一次');
    expect(spies.retryCreate).toHaveBeenCalledWith({ intent: INTENT, expertMode: 'normal' });
    // Charged once (by the scrape create); the scrape lane wrote no terminal result.
    expect(spies.consume).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spies.persisted).not.toHaveBeenCalled();
    expect(spies.settled).not.toHaveBeenCalled();
  });

  it('keeps the scrape answer when it already has the requested links', async () => {
    const urls = [1, 2, 3, 4, 5].map((n) => `https://site${n}.example.test/page`);
    const spies = setup(urls.map((url, i) => `${i + 1}. 结果 ${i + 1} ${url}`).join('\n'), urls);
    await tasksRouter.createCaller(context()).create({ intent: INTENT, expertMode: 'normal' });
    await vi.waitFor(
      () => expect(spies.persisted.mock.calls.length + spies.settled.mock.calls.length).toBe(1),
      { timeout: 10_000 },
    );
    expect(spies.retryCreate).not.toHaveBeenCalled();
    const metadata = terminalMetadata(spies);
    expect(metadata).toMatchObject({
      executionMode: 'scrape',
      executionModeReason: { mode: 'scrape', source: 'kw:search-verb', match: '搜索' },
    });
    expect(metadata).not.toHaveProperty('browserRetryFailure');
  });

  it('does not count links the scrape never fetched (the verifier strips them)', async () => {
    const made = [1, 2, 3, 4, 5].map((n) => `${n}. 结果 ${n} https://site${n}.example.test/page`);
    const spies = setup(made.join('\n'));
    await tasksRouter.createCaller(context()).create({ intent: INTENT, expertMode: 'normal' });
    await vi.waitFor(() => expect(spies.retryCreate).toHaveBeenCalledTimes(1));
  });

  it('records why when the browser retry cannot start, then finishes the scrape task', async () => {
    const spies = setup('1. HOLA DAY 官网');
    spies.retryCreate.mockRejectedValueOnce(new Error('BROWSER_RETRY_RUNTIME_UNAVAILABLE'));
    await tasksRouter.createCaller(context()).create({ intent: INTENT, expertMode: 'normal' });
    await vi.waitFor(
      () => expect(spies.persisted.mock.calls.length + spies.settled.mock.calls.length).toBe(1),
      { timeout: 10_000 },
    );
    expect(terminalMetadata(spies)).toMatchObject({
      executionMode: 'scrape',
      browserRetryFailure: expect.stringContaining('但浏览器重试未能启动'),
    });
  });
});
