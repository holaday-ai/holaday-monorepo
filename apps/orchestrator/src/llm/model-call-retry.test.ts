import { describe, expect, it } from 'vitest';
import type { UnifiedToolResult } from '../agent/browser-tools/playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from '../agent/browser-tools/unified-browser-loop.js';
import type { LlmCallRecord } from '../agent/llm-call-recorder.js';
import { recordedBrowserAdapter } from '../agent/supercar/recorded-browser-adapter.js';
import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralMessagesResponse,
} from './messages-adapter.js';
import { isRetryableModelError, modelFailureReason, withModelRetry } from './model-call-retry.js';
import { safeProviderDiagnostics } from './provider-error-diagnostics.js';

/** LLM-RETRY-1 — Deploy-25 core-07: model calls errored before any browser step. */
const err = (
  code: ConstructorParameters<typeof MessagesAdapterError>[0],
  status: number | null = null,
  providerCode: string | null = null,
) =>
  new MessagesAdapterError(
    code,
    code === 'PROVIDER_ERROR' && status === 401
      ? '模型服务认证失败，请联系管理员检查服务配置。'
      : 'x',
    status,
    safeProviderDiagnostics({ httpStatus: status, providerCode }),
  );

describe('which model errors are retried', () => {
  it.each([
    ['timeout', err('REQUEST_TIMEOUT')],
    ['malformed response', err('INVALID_RESPONSE', 200)],
    ['connection reset (no HTTP answer)', err('PROVIDER_ERROR', null)],
    ['429 rate limit', err('PROVIDER_ERROR', 429)],
    ['500', err('PROVIDER_ERROR', 500)],
    ['503', err('PROVIDER_ERROR', 503)],
    ['a raw ECONNRESET', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
  ])('retries %s', (_label, error) => {
    expect(isRetryableModelError(error)).toBe(true);
  });
  it.each([
    ['401 credentials', err('PROVIDER_ERROR', 401)],
    ['403 access', err('PROVIDER_ERROR', 403)],
    ['400 parameter', err('PROVIDER_ERROR', 400)],
    ['Arrearage, even on a 5xx', err('PROVIDER_ERROR', 500, 'Arrearage')],
    ['InvalidApiKey', err('PROVIDER_ERROR', null, 'InvalidApiKey')],
    ['a caller abort', err('REQUEST_ABORTED')],
    ['an invalid request', err('INVALID_REQUEST')],
    ['a plain bug', new TypeError('x is undefined')],
  ])('does not retry %s', (_label, error) => {
    expect(isRetryableModelError(error)).toBe(false);
  });
  it('reports the permanent cause as it is', () => {
    expect(modelFailureReason(err('PROVIDER_ERROR', 401))).toContain('认证失败');
    expect(modelFailureReason(err('PROVIDER_ERROR', 400, 'Arrearage'))).toContain('欠费');
    // LLM-RETRY-1 live run l3: BBC Chinese news failed the mainland content inspection.
    expect(isRetryableModelError(err('PROVIDER_ERROR', 400, 'DataInspectionFailed'))).toBe(false);
    expect(modelFailureReason(err('PROVIDER_ERROR', 400, 'DataInspectionFailed'))).toBe(
      '模型服务拒绝处理：页面内容未通过内容安全检查，可换一个页面或来源后重试。',
    );
    expect(modelFailureReason(err('REQUEST_TIMEOUT'))).toBe(
      '模型服务暂时不可用，有限重试后仍失败，请稍后重试。',
    );
  });
});

describe('withModelRetry', () => {
  const run = async (errors: unknown[], signal?: AbortSignal) => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withModelRetry(
      async (attempt) => {
        calls += 1;
        expect(attempt).toBe(calls);
        const error = errors[calls - 1];
        if (error) throw error;
        return 'ok';
      },
      { sleep: async (ms) => void waits.push(ms), ...(signal ? { signal } : {}) },
    ).catch((error: unknown) => error);
    return { result, waits, calls };
  };
  it('waits 1s then 3s and succeeds on the third attempt', async () => {
    expect(await run([err('REQUEST_TIMEOUT'), err('PROVIDER_ERROR', 503)])).toEqual({
      result: 'ok',
      waits: [1_000, 3_000],
      calls: 3,
    });
  });
  it('stops after two retries', async () => {
    const out = await run([err('REQUEST_TIMEOUT'), err('REQUEST_TIMEOUT'), err('REQUEST_TIMEOUT')]);
    expect(out.calls).toBe(3);
    expect(out.result).toBeInstanceOf(MessagesAdapterError);
  });
  it('does not retry a permanent error', async () => {
    const out = await run([err('PROVIDER_ERROR', 401)]);
    expect(out).toMatchObject({ calls: 1, waits: [] });
  });
  it('does not retry once the task is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await run([err('REQUEST_TIMEOUT')], controller.signal);
    expect(out).toMatchObject({ calls: 1, waits: [] });
  });
});

describe('the browser loop survives a failed model call (core-07)', () => {
  const metadata = { provider: 'anthropic' as const, model: 'fixture' };
  const reply = (name: string, input: Record<string, unknown>, id: string) =>
    ({
      id,
      metadata,
      content: [{ type: 'tool_use', id, name, input }],
      stopReason: 'tool_use',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    }) as NeutralMessagesResponse;
  const planText = {
    id: 'plan',
    metadata,
    content: [{ type: 'text', text: '打开页面，读标题。' }],
    stopReason: 'end_turn',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      complete: true,
    },
  } as NeutralMessagesResponse;
  /** `failures[i]` is thrown by the i-th call of that role (undefined = answer). */
  const setup = (planFailures: unknown[], turnFailures: unknown[]) => {
    const records: LlmCallRecord[] = [];
    let planCalls = 0;
    let turnCalls = 0;
    let answered = 0;
    const script = [
      reply('navigate', { url: 'https://example.com/' }, 'a'),
      reply('snapshot', {}, 'b'),
      reply('finish', { status: 'completed', summary: '页面标题是 Example Domain。' }, 'c'),
    ];
    const base: MessagesAdapter = {
      metadata,
      browserBrain: {
        planning: {
          metadata,
          async create() {
            const failure = planFailures[planCalls++];
            if (failure) throw failure;
            return planText;
          },
        },
        verification: {
          metadata,
          async create() {
            return planText;
          },
        },
      },
      async create() {
        const failure = turnFailures[turnCalls++];
        if (failure) throw failure;
        return script[answered++]!;
      },
    };
    const recorder = { record: async (call: LlmCallRecord) => void records.push(call) };
    const recorded = recordedBrowserAdapter(base, {
      recorder: recorder as never,
      userExternalId: 'usr_test',
      taskId: 'tsk_test',
      iteration: 1,
      onRecordError: () => {},
    });
    const actions: string[] = [];
    const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
      actions.push(action.tool);
      return action.tool === 'navigate'
        ? { ok: true, text: '已打开', url: action.url }
        : { ok: true, text: 'heading "Example Domain" [level=1]', url: 'https://example.com/' };
    };
    const outcome = runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，打开 example.com 读标题',
      adapter: recorded,
      maxSteps: 6,
      execute: execute as never,
      modelRetry: { sleep: async () => {} },
    });
    return { outcome, records, actions, calls: () => ({ planCalls, turnCalls }) };
  };

  it('retries planning and an execution turn, records every attempt, runs each action once', async () => {
    const run = setup(
      [err('PROVIDER_ERROR', 503), err('REQUEST_TIMEOUT')],
      [err('PROVIDER_ERROR', null), undefined, err('PROVIDER_ERROR', 502)],
    );
    expect(await run.outcome).toMatchObject({ status: 'completed' });
    expect(run.calls()).toEqual({ planCalls: 3, turnCalls: 5 });
    // navigate and snapshot each ran once although their turns were retried.
    expect(run.actions).toEqual(['navigate', 'snapshot']);
    const rows = run.records.map((r) => [
      r.purpose,
      r.status,
      (r.requestMeta as { attempt?: number }).attempt,
    ]);
    expect(rows).toEqual([
      ['browser.planning', 'error', 1],
      ['browser.planning', 'error', 2],
      ['browser.planning', 'ok', 3],
      ['supercar.turn', 'error', 1],
      ['supercar.turn', 'ok', 2],
      ['supercar.turn', 'error', 1],
      ['supercar.turn', 'ok', 2],
      ['supercar.turn', 'ok', 1],
    ]);
  });

  it('a permanent error is not retried and is reported as a model failure', async () => {
    const run = setup([], [err('PROVIDER_ERROR', 401)]);
    expect(await run.outcome).toMatchObject({
      status: 'failed',
      reason: '模型服务认证失败，请联系管理员检查服务配置。',
      modelFailure: true,
    });
    expect(run.calls().turnCalls).toBe(1);
    expect(run.actions).toEqual([]);
  });

  it('three transient failures in one turn fail the task honestly', async () => {
    const run = setup([], [err('REQUEST_TIMEOUT'), err('REQUEST_TIMEOUT'), err('REQUEST_TIMEOUT')]);
    expect(await run.outcome).toMatchObject({
      status: 'failed',
      reason: '模型服务暂时不可用，有限重试后仍失败，请稍后重试。',
      modelFailure: true,
    });
    expect(run.calls().turnCalls).toBe(3);
  });
});
