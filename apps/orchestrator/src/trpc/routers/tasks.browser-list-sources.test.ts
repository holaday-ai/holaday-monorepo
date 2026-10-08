import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
 * FIX-BATCH-A (acceptance A2) — a news list through tasks.create on the unified
 * executor, a real headless Chromium page and the production verifier.
 *
 * Production: the model cited three article links it saw in the snapshot, the
 * ledger only knew the final URL, auto-fix "repaired" all three to the site
 * root and the contract only asked for one URL, so the task completed with
 * verificationPassed=true. Now page links ground citations, every list item
 * needs its own detail link plus the requested date, and a homepage-only
 * answer gets one remediation turn before it fails honestly.
 */

const HOME = `<!doctype html><html><head><title>新闻首页</title></head><body>
  <h1>今日新闻</h1>
  <ul>
    <li><a href="/p/101">开源的火，烧向硅谷</a> <span>2026-10-08 13:49</span></li>
    <li><a href="/p/102">AI开始自造AI</a> <span>2026-10-08 11:59</span></li>
    <li><a href="/p/103">AI办公刚刚来到1972年</a> <span>2026-10-08 11:48</span></li>
  </ul>
</body></html>`;

const original = { ...env };
let browser: Browser;
let server: Server;
let base = '';
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const article = req.url?.match(/^\/p\/(\d+)$/);
    res.end(
      article
        ? `<!doctype html><title>文章 ${article[1]}</title><h1>文章 ${article[1]}</h1>`
        : HOME,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
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

const TITLES = ['开源的火，烧向硅谷', 'AI开始自造AI', 'AI办公刚刚来到1972年'];
const TIMES = ['2026-10-08 13:49', '2026-10-08 11:59', '2026-10-08 11:48'];
const answer = (link: (index: number) => string) =>
  TITLES.map(
    (title, i) =>
      `${i + 1}. **原标题**：${title}\n   **发布日期**：${TIMES[i]}\n   **可核实链接**：${link(i)}`,
  ).join('\n\n');

it.each(['article_links', 'remediated', 'still_homepage'] as const)(
  'news list sources through tasks.create: %s',
  async (scenario) => {
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      QWEN_CORE_ALLOWLIST: 'usr_browser_list',
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
    const homepage = () => `${base}/`;
    const article = (i: number) => `${base}/p/${101 + i}`;
    const requests: messages.NeutralMessagesRequest[] = [];
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
      metadata,
      async create(request) {
        requests.push(request);
        const turn = requests.length;
        const finish = (summary: string): Block =>
          toolUse(`f${turn}`, 'finish', { status: 'completed', summary, evidence: TITLES[0] });
        const content: Block[] =
          turn === 1
            ? [toolUse('s1', 'snapshot', {})]
            : turn === 2
              ? [finish(answer(scenario === 'article_links' ? article : homepage))]
              : [finish(answer(scenario === 'remediated' ? article : homepage))];
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
    await page.goto(`${base}/`);
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
      userId: 'usr_browser_list',
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
        intent: '打开新闻首页，总结今天前三条新闻，提供原标题、发布日期和可核实链接。',
        mode: 'auto',
        expertMode: 'normal',
      });
      expect(result.status).toBe('executing');
      await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
      const outcome = terminal.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      const diagnostics = JSON.stringify({ errors: logger.error.mock.calls, outcome });

      // The model is told the per-item requirement up front.
      expect(JSON.stringify(requests[0]?.messages[0]?.content)).toContain('详情页链接');
      const remediation = JSON.stringify(requests[2]?.messages.at(-1)?.content ?? '');
      if (scenario === 'article_links') {
        // Article links the model saw stay intact (A2 rewrote them to the root).
        expect(requests, diagnostics).toHaveLength(2);
        expect(outcome, diagnostics).toMatchObject({ status: 'completed' });
        for (let i = 0; i < 3; i += 1) expect(outcome.summary).toContain(article(i));
      } else {
        // One remediation turn naming the gap, then the second answer is final.
        expect(requests, diagnostics).toHaveLength(3);
        expect(remediation).toContain('结果还不能交付');
        expect(remediation).toContain('第 1 条缺少独立来源链接');
        if (scenario === 'remediated') {
          expect(outcome, diagnostics).toMatchObject({ status: 'completed' });
          for (let i = 0; i < 3; i += 1) expect(outcome.summary).toContain(article(i));
        } else {
          // Never completed + verified with homepage links: an honest failure.
          expect(outcome, diagnostics).toMatchObject({ status: 'failed' });
          expect(String(outcome.reason)).toContain('独立来源链接');
          expect(outcome.failedChecks).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'list_item_sources' })]),
          );
        }
      }
    } finally {
      await page.close();
    }
  },
  60_000,
);
