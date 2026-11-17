import { rm } from 'node:fs/promises';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as classifier from '../../agent/intent-classifier.js';
import {
  hasParkedSupercarHandle,
  supercarAbort,
} from '../../agent/supercar/qwen-only-agent-loop.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { _resetSharedStorageProviderForTesting } from '../../files/storage-provider.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import * as messages from '../../llm/messages-adapter.js';
import * as responses from '../../llm/responses-adapter.js';
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

const SCRAPE_TEN = [
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}. 商品${i + 1} — ¥${i + 1}9.00`),
  '10. 商品10 — 价格：页面未显示',
].join('\n');

// scrape-retry (FIX-INTENT-ROUTE-BROWSER): the scrape lane's one-time handoff re-enters
// create with an internal ctx flag; it adopts the scrape task's row and is not charged again.
// scrape-retry-partial (FIX-36 复审 #1 #3): the scrape got 9 of 10 prices; the browser retry
// fails — the scrape's answer is delivered as 部分完成 naming the missing price.
// tool-block (FIX-34 review #2): the browser lane's final summary carries an unasked
// ```json tool-call block; it is delivered without it.
it.each([
  'ready',
  'timeout',
  'timeout-persists',
  'scrape-retry',
  'scrape-retry-partial',
  'tool-block',
  'file-upload',
  'file-upload-reply',
  'file-upload-manual-data',
  'file-download-read',
  'file-download-table',
] as const)(
  'unified executor through tasks.create: %s',
  async (scenario) => {
    const manualData = scenario === 'file-upload-manual-data';
    const tableAnalysis = scenario === 'file-download-table';
    const downloading = scenario.startsWith('file-download');
    const downloadCsv = tableAnalysis
      ? `channel,amount\n${'web,0.10\n'.repeat(10000)}store,99.90\n`
      : 'sku,qty\nAPI-DOWN-731,31\n';
    const withReply = scenario === 'file-upload-reply' || manualData;
    const uploadFixture = scenario.startsWith('file-') ? await browserOutputFixture() : undefined;
    let replying = false;
    const fixtureUserId = uploadFixture ? 7 : 41;
    const fixtureExternalId = uploadFixture ? 'usr_alice' : 'usr_browser_unified';
    const inputFile =
      uploadFixture && !downloading
        ? await uploadFixture.service.storeUpload({
            userIdInternal: 7,
            userExternalId: 'usr_alice',
            filename: withReply ? 'notes.csv' : 'report.csv',
            mimetype: 'text/csv',
            buffer: Buffer.from(
              manualData ? 'scope,note\ncompleted-only,INITIAL-531\n' : 'sku,qty\nA-731,31\n',
            ),
          })
        : undefined;
    const replyFile = withReply
      ? await uploadFixture!.service.storeUpload({
          userIdInternal: 7,
          userExternalId: 'usr_alice',
          filename: 'report.csv',
          mimetype: 'text/csv',
          buffer: Buffer.from('sku,qty\nA-731,31\n'),
        })
      : undefined;
    if (uploadFixture) {
      vi.stubEnv('STORAGE_PROVIDER', 'local');
      vi.stubEnv('HOLADAY_FILES_ROOT', uploadFixture.root);
      _resetSharedStorageProviderForTesting();
    }
    expect(original.BROWSER_EXECUTOR).toBe('unified');
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'legacy',
      QWEN_CORE_ALLOWLIST: fixtureExternalId,
      BROWSER_TASK_FILES_V1: Boolean(uploadFixture),
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ENABLED_LANES: manualData ? 'browser,generate' : 'browser',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      ...(manualData ? { QWEN_RESPONSES_ADAPTER_ENABLED: true } : {}),
      DASHSCOPE_CN_API_KEY: 'synthetic-cn',
      DASHSCOPE_API_KEY: '',
    });
    vi.spyOn(classifier, 'explainExecutionMode').mockResolvedValue({
      mode: 'browser',
      source: 'test',
    });
    const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    const insert = vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
    if (uploadFixture)
      insert.mockImplementation(async (state) => {
        uploadFixture.taskRecords.push({
          id: 91,
          externalId: state.taskId,
          userId: 7,
          status: state.status,
          origin: 'user',
          executionId: null,
          executionRevision: 0,
          coreRecordVersion: 0,
          intent: downloading
            ? '下载本站报表并读取文件内容'
            : '把附件 report.csv 上传到 fixture.browser.test 的文件控件',
          result: { executionMode: 'browser' },
        });
      });
    if (withReply) {
      vi.spyOn(TaskRepository.prototype, 'persistAwaitingUser').mockImplementation(
        async (input) => {
          const row = uploadFixture!.taskRecords.find(
            (row) => row.externalId === input.taskExternalId,
          )!;
          row.status = 'awaiting_user';
          row.awaitingKind = input.awaitingKind;
          row.awaitingQuestion = input.question;
          return { persisted: true };
        },
      );
      vi.spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed').mockImplementation(
        async (id) => {
          const row = uploadFixture!.taskRecords.find((row) => row.externalId === id)!;
          row.status = 'executing';
          return { persisted: true };
        },
      );
    }
    const adopt = vi
      .spyOn(TaskRepository.prototype, 'adoptTaskForBrowserRetry')
      .mockResolvedValue({ persisted: true });
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
    const generationRequests: responses.NeutralResponsesRequest[] = [];
    if (manualData)
      vi.spyOn(responses, 'createQwenResponsesAdapter').mockImplementation(() => {
        const generateMetadata = {
          ...metadata,
          model: 'qwen-generate-fixture',
          protocol: 'responses' as const,
        };
        return {
          metadata: generateMetadata,
          async stream(request, options) {
            generationRequests.push(request);
            const text =
              '用户数据摘要：GMV100、订单20、ROI5。CSV 报表 A-731 数量31，初始备注 INITIAL-531 保留。';
            options?.onTextDelta?.(text);
            return {
              id: 'response-generate',
              metadata: generateMetadata,
              status: 'completed',
              text,
              sources: [],
              usage: { inputTokens: 10, outputTokens: 10 },
            };
          },
        };
      });
    // LLM-RETRY-1: a timed-out call is retried; turns count answered calls only.
    let answered = 0;
    let downloadedFileId = '';
    vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => ({
      metadata,
      async create(request) {
        requests.push(request);
        if (
          (scenario === 'timeout' && requests.length === 2) ||
          (scenario === 'timeout-persists' && answered >= 1)
        )
          throw new messages.MessagesAdapterError('REQUEST_TIMEOUT', 'Qwen request timeout');
        const turn = ++answered;
        // The unified loop offers only its own tools and forces a tool call.
        expect(request.tools?.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['snapshot', 'click', 'finish']),
        );
        expect(request.toolChoice).toEqual({ type: 'any' });
        const content: Block[] = downloading
          ? turn === 1
            ? [toolUse('s1', 'snapshot', {})]
            : turn === 2
              ? [
                  toolUse('d1', 'download', {
                    ref: JSON.stringify(request.messages.at(-1))
                      .split('\\n')
                      .find((line) => /link.*Export report/.test(line))
                      ?.match(/\[ref=(e\d+)\]/)?.[1],
                  }),
                ]
              : turn === 3
                ? (() => {
                    const last = request.messages.at(-1)?.content;
                    const result = Array.isArray(last)
                      ? last.find((block) => block.type === 'tool_result')
                      : undefined;
                    downloadedFileId =
                      result?.type === 'tool_result' ? JSON.parse(result.content).fileId : '';
                    return [
                      toolUse(
                        'r1',
                        tableAnalysis ? 'analyze_task_table' : 'read_task_file',
                        tableAnalysis
                          ? {
                              fileId: downloadedFileId,
                              mode: 'aggregate',
                              metrics: [{ op: 'count_rows' }, { op: 'sum', column: 'B' }],
                            }
                          : { fileId: downloadedFileId },
                      ),
                    ];
                  })()
                : [
                    toolUse('f1', 'finish', {
                      status: 'completed',
                      summary: tableAnalysis
                        ? '导出报表共10001条记录，金额合计1099.9。'
                        : '导出文件 report.csv 中的 SKU 为 API-DOWN-731，数量31。',
                      fields: tableAnalysis
                        ? [
                            {
                              name: 'amount [B] 合计',
                              value: '1099.9',
                              fileId: downloadedFileId,
                              tableFactId: [
                                ...JSON.stringify(request.messages.at(-1)).matchAll(
                                  /tbf_[a-f0-9]{32}/g,
                                ),
                              ].map((match) => match[0])[1],
                            },
                          ]
                        : [{ name: 'SKU', value: 'API-DOWN-731', fileId: downloadedFileId }],
                    }),
                  ]
          : manualData
            ? turn === 1
              ? [toolUse('s1', 'snapshot', {})]
              : [
                  toolUse('h1', 'request_human', {
                    reason: 'clarification',
                    message: '请补充报表数据和附件',
                  }),
                ]
            : scenario === 'file-upload-reply'
              ? turn === 1
                ? [toolUse('s1', 'snapshot', {})]
                : turn === 2
                  ? [
                      toolUse('h1', 'request_human', {
                        reason: 'clarification',
                        message: '请提供 report.csv',
                      }),
                    ]
                  : turn === 3
                    ? [toolUse('s2', 'snapshot', {})]
                    : turn === 4
                      ? [
                          toolUse('u1', 'upload', {
                            ref: JSON.stringify(request.messages.at(-1)).match(
                              /button \\"Report\\" \[ref=(e\d+)\]/,
                            )![1],
                            fileIds: [replyFile!.externalId],
                          }),
                        ]
                      : turn === 5
                        ? [toolUse('s3', 'snapshot', {})]
                        : [
                            toolUse('f1', 'finish', {
                              status: 'completed',
                              summary: '回复文件已交给页面，页面读到 A-731,31',
                              evidence: 'A-731,31',
                            }),
                          ]
              : scenario === 'file-upload'
                ? turn === 1
                  ? [toolUse('s1', 'snapshot', {})]
                  : turn === 2
                    ? [
                        toolUse('u1', 'upload', {
                          ref: JSON.stringify(request.messages.at(-1)).match(
                            /button \\"Report\\" \[ref=(e\d+)\]/,
                          )![1],
                          fileIds: [inputFile!.externalId],
                        }),
                      ]
                    : turn === 3
                      ? [toolUse('s2', 'snapshot', {})]
                      : [
                          toolUse('f1', 'finish', {
                            status: 'completed',
                            summary: '文件已交给页面控件，页面读到 A-731,31',
                            evidence: 'A-731,31',
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
                            status: scenario === 'scrape-retry-partial' ? 'failed' : 'completed',
                            summary:
                              scenario === 'tool-block'
                                ? '订单已保存。\n\n```json\n{"name": "browser_use", "arguments": {"action": "click", "ref": "e3"}}\n```'
                                : '订单已保存。',
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

    const page: Page = await browser.newPage({ acceptDownloads: downloading });
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: downloading
          ? `${PAGE}<a href="/export.csv">Export report</a>`
          : uploadFixture
            ? `${PAGE}<label>Report <input type="file" id="file" accept=".csv"></label><script>document.querySelector("#file").onchange=async function(){document.querySelector("#status").textContent="页面读到："+await this.files[0].text();}</script>`
            : PAGE,
      }),
    );
    if (downloading)
      await page.route('https://fixture.browser.test/export.csv', (route) =>
        route.fulfill({
          contentType: 'text/csv',
          headers: { 'content-disposition': 'attachment; filename="report.csv"' },
          body: downloadCsv,
        }),
      );
    await page.goto('https://fixture.browser.test/');
    const replyImage = manualData
      ? await uploadFixture!.service.storeUpload({
          userIdInternal: 7,
          userExternalId: 'usr_alice',
          filename: 'chart.png',
          mimetype: 'image/png',
          buffer: await page.screenshot({ type: 'png' }),
        })
      : undefined;
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
                  id: fixtureUserId,
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
        return {
          from: (table: unknown) =>
            uploadFixture &&
            (table === taskFiles ||
              (table === users && !('plan' in projection)) ||
              (table === tasks &&
                ('origin' in projection || replying || (downloading && 'id' in projection))))
              ? uploadFixture.db.select().from(table as typeof taskFiles)
              : query,
        };
      },
      insert: (table: unknown) =>
        downloading && table === taskFiles
          ? uploadFixture!.db.insert(taskFiles)
          : {
              values: async (row: Record<string, unknown>) => {
                if (table === llmCalls) recorded.push(row);
                if (table === taskSteps) stepRecords.push(row);
                return [];
              },
            },
      update: () => ({ set: () => ({ where: async () => [] }) }),
    };
    const ctx = {
      db,
      logger,
      userId: fixtureExternalId,
      taskOrigin: 'user',
      req: {},
      res: {},
      planner: {},
      playwrightExecutor: executor,
      executionRouter: null,
      browserPool: null,
      taskQueue: null,
      ...(scenario === 'scrape-retry' || scenario === 'scrape-retry-partial'
        ? {
            scrapeBrowserRetry: {
              taskId: 'task_scrape_retry1',
              reason: '抓取结果不满足要求（测试）',
              ...(scenario === 'scrape-retry-partial'
                ? {
                    scrapeAnswer: {
                      summary: SCRAPE_TEN,
                      missing: ['价格'],
                      found: 9,
                      wanted: 10,
                    },
                  }
                : {}),
            },
          }
        : {}),
    } as unknown as Context;

    try {
      const result = await tasksRouter.createCaller(ctx).create({
        // Executor path under test; an explicit order/login need would route to the user's Chrome.
        intent: downloading
          ? tableAnalysis
            ? '下载本站CSV报表，统计全部数据记录数及金额合计'
            : '下载本站报表并读取整个导出文件，报告其中的SKU和数量'
          : manualData
            ? '打开报表页面读取数据并整理分析，无法读取时使用我补充的数据'
            : uploadFixture
              ? '把附件 report.csv 上传到 fixture.browser.test 的文件控件'
              : '打开详情页并点击保存',
        ...(inputFile ? { fileIds: [inputFile.externalId] } : {}),
        mode: 'auto',
        expertMode: 'normal',
      });
      expect(result.status).toBe('executing');
      if (replyFile) {
        await vi.waitFor(() => expect(hasParkedSupercarHandle(result.taskId)).toBe(true), {
          timeout: 15_000,
        });
        expect(JSON.stringify(requests[0]?.messages)).not.toContain(replyFile.externalId);
        replying = true;
        const reply = await tasksRouter.createCaller(ctx).reply({
          taskId: result.taskId,
          message: manualData
            ? '数据如下：GMV100，订单20，ROI5，请结合附件写分析'
            : '这是要上传的 report.csv，请继续',
          fileIds: [replyFile.externalId, ...(replyImage ? [replyImage.externalId] : [])],
        });
        expect(reply).toMatchObject({ ok: true, state: 'resumed' });
      }
      await vi.waitFor(() => expect(terminal).toHaveBeenCalled(), { timeout: 20_000 });
      const outcome = terminal.mock.calls.at(-1)?.[1];
      const diagnostics = JSON.stringify({
        errors: logger.error.mock.calls,
        outcome,
        requests: requests.length,
        ...(downloading ? { downloadResult: requests[2]?.messages.at(-1) } : {}),
      });
      if (downloading) {
        expect(outcome, diagnostics).toMatchObject({
          status: 'completed',
          summary: expect.stringContaining(tableAnalysis ? '1099.9' : 'API-DOWN-731'),
        });
        expect(JSON.stringify(outcome)).toContain(downloadedFileId);
        expect(JSON.stringify(outcome)).toContain('网站导出范围尚未核实');
        const [stored] = await uploadFixture!.service.loadMany([downloadedFileId], 7);
        expect(stored?.buffer.toString()).toBe(downloadCsv);
        expect(stored?.row).toMatchObject({
          taskId: 91,
          kind: 'output',
          mimetype: 'application/octet-stream',
        });
        expect(await uploadFixture!.service.loadMany([downloadedFileId], 8)).toEqual([]);
        expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
          tableAnalysis ? '1099.9' : 'API-DOWN-731',
        );
        expect(await page.locator('#status').textContent()).toBe('草稿');
        expect(consume).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(4);
        if (tableAnalysis)
          await vi.waitFor(() => {
            expect(JSON.stringify(stepRecords)).toContain('analyze_task_table');
            expect(JSON.stringify(stepRecords)).toContain('1099.9');
          });
        return;
      }
      if (manualData) {
        expect(outcome, diagnostics).toMatchObject({
          status: 'completed',
          metadata: { finalExecutionMode: 'generate' },
        });
        if (outcome?.status !== 'completed') throw new Error(diagnostics);
        expect(outcome.summary).toContain('A-731');
        expect(generationRequests).toHaveLength(1);
        expect(JSON.stringify(generationRequests[0])).toContain('INITIAL-531');
        expect(JSON.stringify(generationRequests[0])).toContain('A-731,31');
        expect(JSON.stringify(generationRequests[0])).toContain('input_image');
        expect(requests).toHaveLength(2);
        expect(await page.locator('#status').textContent()).toBe('草稿');
        expect(consume).toHaveBeenCalledTimes(1);
        return;
      }
      if (uploadFixture) {
        expect(outcome, diagnostics).toMatchObject({ status: 'completed' });
        expect(await page.locator('#status').textContent()).toContain('A-731,31');
        expect(JSON.stringify(requests[0]?.messages)).toContain(inputFile!.externalId);
        if (replyFile)
          expect(JSON.stringify(requests.at(-1)?.messages)).toContain(replyFile.externalId);
        expect(consume).toHaveBeenCalledTimes(1);
        return;
      }

      if (scenario === 'scrape-retry-partial') {
        expect(outcome, diagnostics).toMatchObject({
          status: 'partial_success',
          summary: expect.stringMatching(/^部分完成：「价格」页面未显示（10 项中 9 项完整）/),
        });
        const summary = (outcome as { summary?: string }).summary ?? '';
        for (let n = 1; n <= 9; n++) expect(summary).toContain(`商品${n} — ¥${n}9.00`);
        expect(summary).toContain('商品10 — 价格：页面未显示');
        return;
      }
      if (scenario === 'scrape-retry') {
        // Same task, same charge: the scrape row is adopted, nothing new is inserted.
        expect(result.taskId).toBe('task_scrape_retry1');
        expect(consume, diagnostics).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
        expect(adopt).toHaveBeenCalledWith(
          expect.objectContaining({
            taskExternalId: 'task_scrape_retry1',
            userId: 41,
            status: 'executing',
            sourceContext: { browserSessionPolicy: 'anonymous' },
            reason: '抓取结果不满足要求（测试）',
          }),
        );
        expect(outcome, diagnostics).toMatchObject({
          status: 'completed',
          metadata: {
            executionMode: 'browser',
            fallbackChain: ['scrape', 'browser'],
            browserRetryReason: '抓取结果不满足要求（测试）',
          },
        });
        expect(await page.textContent('#status')).toBe('已保存');
        return;
      }
      expect(adopt).not.toHaveBeenCalled();
      expect(consume, diagnostics).toHaveBeenCalledWith(41, 'pro', false);
      if (scenario === 'tool-block') {
        expect(outcome, diagnostics).toMatchObject({
          status: 'completed',
          summary: '订单已保存。',
        });
        return;
      }
      if (scenario === 'ready' || scenario === 'timeout') {
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
        // A timed-out turn is sent again (one more request) and the click still ran once.
        const extra = scenario === 'timeout' ? 1 : 0;
        expect(requests).toHaveLength(4 + extra);
        // Every model call, retries included, lands in llm_calls (cost accounting).
        expect(recorded).toHaveLength(4 + extra);
        if (scenario === 'timeout')
          expect(recorded[1]).toMatchObject({ status: 'error', errorMessage: 'REQUEST_TIMEOUT' });
        expect(recorded[0]).toMatchObject({
          provider: 'alibaba-model-studio',
          model: 'qwen-unified-fixture',
          promptTokens: 10,
          completionTokens: 5,
          status: 'ok',
        });
      } else {
        // timeout-persists: three attempts of the second turn, then an honest failure.
        expect(outcome, diagnostics).toMatchObject({ status: 'failed' });
        expect(JSON.stringify(outcome)).toContain('模型服务暂时不可用，有限重试后仍失败');
        expect(await page.textContent('#status')).toBe('草稿');
        expect(recorded).toHaveLength(4);
        expect(recorded.slice(1)).toEqual(
          Array(3).fill(
            expect.objectContaining({ status: 'error', errorMessage: 'REQUEST_TIMEOUT' }),
          ),
        );
      }
    } finally {
      if (replyFile)
        for (const row of uploadFixture!.taskRecords) supercarAbort(String(row.externalId));
      await page.close();
      if (uploadFixture) {
        _resetSharedStorageProviderForTesting();
        await rm(uploadFixture.root, { recursive: true, force: true });
      }
    }
  },
  60_000,
);
