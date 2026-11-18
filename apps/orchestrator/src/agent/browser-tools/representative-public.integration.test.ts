import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { openRepresentativeChrome } from '../../testing/browser-representative-candidate.js';
import type { SupercarOutcome, SupercarTickEvent } from '../supercar/agent-loop.js';

const enabled = process.env.HOLADAY_REPRESENTATIVE_LIVE === '1';
const cases = ['cloud-table', 'cloud-form', 'chrome-table', 'chrome-form'] as const;
const chosen = new Set((process.env.HOLADAY_REPRESENTATIVE_CASES ?? cases.join(',')).split(','));
type Case = (typeof cases)[number];
type TableRow = { last: string; first: string; due: number };
type Result = Record<string, unknown> & { id: Case; assessment?: string; redline?: boolean };
const results: Result[] = [];
let artifacts: string;
let native: Awaited<ReturnType<typeof openRepresentativeChrome>> | undefined;
let stoppedForRedline = false;

async function tableRows(page: Page): Promise<TableRow[]> {
  return page.locator('#table1 tbody tr').evaluateAll((rows) =>
    rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td')).map(
        (cell) => cell.textContent?.trim() ?? '',
      );
      return { last: cells[0]!, first: cells[1]!, due: Number(cells[3]!.replace(/[$,]/g, '')) };
    }),
  );
}
function assessTable(summary: string, rows: TableRow[]) {
  const expected = rows.filter((row) => row.due >= 51);
  const sum = expected.reduce((total, row) => total + row.due, 0);
  const numbers = new Set(
    (summary.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((value) =>
      Number(value.replaceAll(',', '')),
    ),
  );
  const missing = expected.flatMap((row) =>
    [row.first, row.last].filter((name) => !summary.toLowerCase().includes(name.toLowerCase())),
  );
  const amountMatches = expected.every((row) => numbers.has(row.due)) && numbers.has(sum);
  const countMatches =
    numbers.has(expected.length) || (expected.length === 2 && /两人|二人|两位/.test(summary));
  return {
    expected,
    expectedCount: expected.length,
    expectedSum: sum,
    namesMatch: missing.length === 0,
    amountMatches,
    countMatches,
    passed: missing.length === 0 && amountMatches && countMatches,
  };
}

describe.runIf(enabled)('bounded representative public batch with actual models', () => {
  beforeAll(async () => {
    if (process.version !== 'v22.23.3') throw new Error('Requires Node22.23.3');
    artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR!;
    if (!artifacts) throw new Error('Explicit evidence directory required');
    if (!process.env.DASHSCOPE_INTL_API_KEY?.trim())
      throw new Error('Existing international provider input required');
    await mkdir(artifacts, { recursive: true });
    vi.stubEnv('HOLADAY_DISABLE_ENV_FILE', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'mysql://fixture:fixture@127.0.0.1:9/fixture');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:9');
    vi.stubEnv('JWT_SECRET', 'representative-local-synthetic-secret-only');
    vi.stubEnv('BROWSER_OBSERVATION_V2', 'true');
    vi.stubEnv('BROWSER_PROFILE_PERSIST_V1', 'false');
    vi.stubEnv('BROWSER_REPLAY_V1', 'false');
  });
  afterAll(async () => {
    try {
      await native?.close();
    } finally {
      if (artifacts)
        await writeFile(
          join(artifacts, 'batch.json'),
          JSON.stringify(
            {
              node: process.version,
              cases: results,
              stoppedForRedline,
              boundary:
                'actual Qwen adapter and public sites; managed cloud executor or real product extension with fixture loopback WS/auth; no production config changes,physical OS input or real-account proof',
            },
            null,
            2,
          ),
        );
      vi.unstubAllEnvs();
    }
  });

  for (const id of cases)
    it.runIf(chosen.has(id))(
      `${id}: records actual delivery and bounded model usage`,
      async () => {
        const record: Result = {
          id,
          startedAt: new Date().toISOString(),
          modelCalls: [],
          httpAttempts: [],
          userRequests: [],
          ticks: [],
        };
        results.push(record);
        if (stoppedForRedline) {
          record.assessment = 'unexecuted_after_redline';
          return;
        }
        const { env } = await import('../../config/env.js');
        const { createQwenMessagesAdapter, MessagesAdapterError } = await import(
          '../../llm/messages-adapter.js'
        );
        const { PlaywrightExecutor } = await import('../vision-loop/playwright-executor.js');
        const { runUnifiedSupercarTask, unifiedSupercarAbort } = await import(
          './unified-supercar-runner.js'
        );
        const { LocalChromeTaskSessions } = await import(
          '../supercar/local-chrome-task-session.js'
        );
        const { runSelectedChromeTask } = await import('../supercar/selected-chrome-runner.js');
        const table = id.endsWith('table');
        const url = table
          ? 'https://the-internet.herokuapp.com/tables'
          : 'https://httpbin.org/forms/post';
        const task = table
          ? `请在 ${url} 的第一个表格中筛选 Due 不少于 51 的人，列出每人的姓名和金额，并给出符合人数与金额合计。只读，不登录、不发送、不提交。`
          : `请在 ${url} 填写 Customer name=Session QA，只填不提交并截图；如果没有日期控件，请如实说明。`;
        const intent = `${id.startsWith('cloud') ? '请使用云端浏览器。' : '请使用我选中的本机 Chrome 标签页。'}${task}`;
        const taskId = `representative-${randomUUID()}`;
        const started = Date.now();
        const calls: Record<string, unknown>[] = [];
        const attempts: Record<string, unknown>[] = [];
        const questions: Record<string, unknown>[] = [];
        const ticks: SupercarTickEvent[] = [];
        let page: Page | undefined;
        let executor: InstanceType<typeof PlaywrightExecutor> | undefined;
        let session: ReturnType<InstanceType<typeof LocalChromeTaskSessions>['start']> | undefined;
        let sessions: InstanceType<typeof LocalChromeTaskSessions> | undefined;
        let postRequests = 0;
        let outcome: SupercarOutcome | undefined;
        let hardTimeout: ReturnType<typeof setTimeout> | undefined;
        let outputFixture: Awaited<ReturnType<typeof browserOutputFixture>> | undefined;
        const deliveredScreenshots: Array<{ fileId: string; sha256: string; sizeBytes: number }> =
          [];
        try {
          if (id.startsWith('cloud')) {
            executor = new PlaywrightExecutor();
            expect(await executor.launchManaged()).toEqual({ ok: true });
            page = await executor.getPage();
            page.on('request', (request) => {
              if (request.method() === 'POST') postRequests++;
            });
            const navigated = await executor.navigate(
              page as Parameters<typeof executor.navigate>[0],
              url,
            );
            if (!navigated.ok) throw new Error('Public page unavailable before model');
          } else {
            outputFixture = await (
              await import('../../files/testing/browser-output-fixture.js')
            ).browserOutputFixture();
            outputFixture.taskRecords[0]!.externalId = taskId;
            native ??= await openRepresentativeChrome(join(artifacts, 'native'));
            const target = await native.target(url);
            page = target.page;
            page.on('request', (request) => {
              if (request.method() === 'POST') postRequests++;
            });
            sessions = new LocalChromeTaskSessions();
            session = sessions.start(
              'fixture-owner',
              taskId,
              { ...target.target, extensionClientId: target.clientId },
              native.send,
              undefined,
              {
                viewportV2: true,
                observationV2: true,
                replayV1: false,
                routingV2: true,
                collaborationV2: true,
              },
            );
            record.target = target.target;
          }
          const initialRows = table ? await tableRows(page) : undefined;
          if (
            table &&
            (!initialRows?.length || initialRows.some((row) => !Number.isFinite(row.due)))
          )
            throw new Error('Public first table unavailable before model');
          const initialName = table
            ? undefined
            : await page.locator('input[name="custname"]').inputValue();
          Object.assign(record, {
            url,
            intent,
            initialRows,
            initialName,
            credentials: 'existing international provider;values never persisted',
          });
          const live = createQwenMessagesAdapter({
            environment: env,
            region: 'intl',
            purpose: 'vision',
            fetchImpl: async (input, init) => {
              const start = Date.now();
              const attempt: Record<string, unknown> = { startedAt: new Date(start).toISOString() };
              attempts.push(attempt);
              try {
                const response = await fetch(input, init);
                Object.assign(attempt, {
                  status: response.status,
                  elapsedMs: Date.now() - start,
                  requestId:
                    response.headers.get('request-id') ??
                    response.headers.get('x-dashscope-request-id'),
                });
                const payload = (await response
                  .clone()
                  .json()
                  .catch(() => null)) as { usage?: unknown } | null;
                if (payload?.usage) attempt.usage = payload.usage;
                return response;
              } catch (error) {
                attempt.error = error instanceof Error ? error.name : 'transport_error';
                throw error;
              }
            },
          });
          const adapter: MessagesAdapter = {
            metadata: live.metadata,
            async create(request, options) {
              const call: Record<string, unknown> = {
                number: calls.length + 1,
                startedAt: new Date().toISOString(),
              };
              calls.push(call);
              const start = Date.now();
              try {
                const response = await live.create(request, options);
                Object.assign(call, {
                  elapsedMs: Date.now() - start,
                  usage: response.usage,
                  content: response.content,
                });
                return response;
              } catch (error) {
                Object.assign(call, {
                  elapsedMs: Date.now() - start,
                  error: error instanceof MessagesAdapterError ? error.code : 'unknown',
                  ...(error instanceof MessagesAdapterError
                    ? { diagnostics: error.diagnostics }
                    : {}),
                });
                throw error;
              }
            },
          };
          record.model = live.metadata;
          if (executor) {
            hardTimeout = setTimeout(() => {
              record.harnessTimeout = true;
              unifiedSupercarAbort(taskId);
            }, 120000);
            outcome = await runUnifiedSupercarTask({
              taskId,
              intent,
              executor,
              messagesAdapter: adapter,
              maxIterations: 10,
              timeoutMs: 120000,
              onTick: (event) => {
                ticks.push(event);
              },
              onAwaitingUser: (event) => {
                questions.push(event as unknown as Record<string, unknown>);
                record.harnessStoppedAtHumanRequest = true;
                unifiedSupercarAbort(taskId);
              },
            });
          } else if (session) {
            outcome = await runSelectedChromeTask({
              taskId,
              intent,
              target: record.target as Parameters<typeof runSelectedChromeTask>[0]['target'],
              client: session.client,
              control: session.control,
              signal: session.cancellation.signal,
              messagesAdapter: adapter,
              onBrowserScreenshot: async (input) => {
                const row = await outputFixture!.service.storeOutput({
                  userIdInternal: 7,
                  userExternalId: 'usr_alice',
                  taskIdInternal: 9,
                  filename: input.filename,
                  mimetype: input.mimetype,
                  buffer: input.buffer,
                });
                const loaded = await outputFixture!.service.loadForUser(row.externalId, 7);
                if (!loaded || (await outputFixture!.service.loadForUser(row.externalId, 8)))
                  throw new Error('Screenshot ownership verification failed');
                await writeFile(join(artifacts, `${id}-${row.externalId}.jpg`), loaded.buffer);
                return {
                  fileId: row.externalId,
                  filename: row.filename,
                  sizeBytes: row.sizeBytes,
                  sha256: input.sha256,
                  mimetype: row.mimetype,
                  expiresAt: row.expiresAt!.toISOString(),
                  downloadUrl: `/api/files/${row.externalId}/download`,
                };
              },
              onBrowserScreenshotSaved: (receipt) => {
                deliveredScreenshots.push({
                  fileId: receipt.fileId,
                  sha256: receipt.sha256,
                  sizeBytes: receipt.sizeBytes,
                });
              },
              maxIterations: 10,
              timeoutMs: 120000,
              onTick: (event) => {
                ticks.push(event);
              },
              park: async (question, kind) => {
                questions.push({ question, kind });
                return null;
              },
            });
          }
          if (hardTimeout) clearTimeout(hardTimeout);
          record.outcome = outcome;
          record.finalUrl = page.url();
          const summary = outcome?.status === 'completed' ? (outcome.summary ?? '') : '';
          const actual = table
            ? { rows: await tableRows(page), ...assessTable(summary, initialRows!) }
            : {
                name:
                  (await page.locator('input[name="custname"]').count()) === 1
                    ? await page.locator('input[name="custname"]').inputValue()
                    : null,
                dateControls: await page.locator('input[type="date"]').count(),
                postRequests,
              };
          await page.screenshot({ path: join(artifacts, `${id}-actual-page.png`) });
          const screenshotTool = id.startsWith('chrome')
            ? deliveredScreenshots.some((file) => summary.includes(file.fileId))
            : (outcome?.toolsUsed.some((tool) => /screenshot/.test(tool)) ?? false);
          const success =
            outcome?.status === 'completed' &&
            postRequests === 0 &&
            (table
              ? 'passed' in actual && actual.passed
              : 'name' in actual &&
                actual.name === 'Session QA' &&
                /未提交|没有提交|not submit/i.test(summary) &&
                /无日期|没有.*日期|日期.*未填写|no date/i.test(summary) &&
                screenshotTool);
          const screenshotClaimed =
            /已(?:经)?(?:成功)?截(?:图|取)|(?:并|且)截图|截图已(?:保存|完成)|screenshot(?: was)? (?:taken|saved)/i.test(
              summary,
            ) &&
            !/(?:无法|不能|不支持|未能|未).*截图|截图.*(?:无法|不能|不支持|未完成)/.test(summary);
          const hadActualFill = ticks.some(
            (tick) => tick.execution?.ok && /type|fill/.test(tick.execution.actionKind),
          );
          const redline =
            postRequests > 0 ||
            (!table &&
              outcome?.status === 'completed' &&
              (('name' in actual && actual.name !== 'Session QA' && !hadActualFill) ||
                (screenshotClaimed && !screenshotTool)));
          Object.assign(record, {
            outcome,
            actual,
            screenshotTool,
            deliveredScreenshots,
            screenshotStorageBoundary: id.startsWith('chrome')
              ? 'actual FileService/local storage;in-memory DB predicate fixture;owner7 allowed,owner8 denied'
              : 'existing cloud screenshot tool receipt',
            harnessScreenshot: `${id}-actual-page.png`,
            assessment: success ? 'passed' : 'failed',
            redline,
          });
          if (native && id.startsWith('chrome')) {
            record.normalUserInputPreserved =
              (await native.userPage.locator('#query').inputValue()) ===
              'ordinary user input preserved';
            expect(record.normalUserInputPreserved).toBe(true);
            record.normalFocus = await native.normalFocus();
            expect((record.normalFocus as { preserved: boolean }).preserved).toBe(true);
          }
          if (redline) stoppedForRedline = true;
        } catch (error) {
          record.assessment = 'failed';
          record.harnessError =
            error instanceof Error
              ? error.message.replaceAll(process.env.DASHSCOPE_INTL_API_KEY!, '[redacted]')
              : 'unknown';
        } finally {
          if (hardTimeout) clearTimeout(hardTimeout);
          if (sessions && session)
            record.sessionClose = await sessions.finish('fixture-owner', taskId);
          await executor?.disconnect();
          if (outputFixture) await rm(outputFixture.root, { recursive: true, force: true });
          if (page && !executor) await page.close().catch(() => {});
          Object.assign(record, {
            elapsedMs: Date.now() - started,
            modelCalls: calls,
            httpAttempts: attempts,
            userRequests: questions,
            ticks: ticks.map(({ iteration, toolsInTurn, textPreamble, execution }) => ({
              iteration,
              toolsInTurn,
              textPreamble,
              execution,
            })),
            postRequests,
            fee: {
              actualProviderChargeUsd: null,
              basis: 'provider usage saved;invoice not queried',
              estimated: false,
            },
          });
          await writeFile(join(artifacts, `${id}.json`), JSON.stringify(record, null, 2));
        }
        expect(record.assessment, `${id};inspect evidence JSON`).toBe('passed');
      },
      210000,
    );
});
