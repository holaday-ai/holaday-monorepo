/**
 * Phase 22a follow-up — generate-runner unit tests.
 *
 * Test A: happy path — mocked Anthropic returns text → outcome=completed
 *         with the right tokens / summary.
 * Test (timeout): API hangs past timeoutMs → AbortController fires →
 *                 outcome=failed with the friendly Chinese reason. This
 *                 is the "Test E for generate" — the runner can't sit
 *                 at status='executing' forever.
 * Test (api error): API rejects with a non-abort error → outcome=failed
 *                   with the raw error message.
 * Test (empty response): API returns no text blocks → outcome=failed.
 * Test (skill hint): explicit skillId is preferred over keyword-derived
 *                    classifyRole.
 */

import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type Anthropic from '@anthropic-ai/sdk';
import { runGenerateTask } from './generate-runner.js';

function makeLogger() {
  return pino({ level: 'silent' });
}

/**
 * Build a minimal Anthropic client stub with a scripted messages.stream.
 *
 * Phase 24 RC follow-up — runner switched messages.create →
 * messages.stream. The mock returns an EventEmitter-like object with
 * on('text', ...) for delta subscription and finalMessage() for the
 * canonical response. Tests can pass a textOut string and the mock
 * fires one synthetic 'text' delta + resolves finalMessage() with a
 * single text content block.
 */
function makeClient(opts: {
  textOut?: string;
  rejectWith?: Error;
  /** When true, the stream never resolves (simulates a hang). The
   *  test must rely on the runner's AbortController to break the wait. */
  hangForever?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
}): Anthropic {
  const stream = vi.fn(
    (
      _params: unknown,
      reqOpts?: { signal?: AbortSignal },
    ): unknown => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
      const emit = (event: string, ...args: unknown[]): void => {
        const subs = listeners[event] ?? [];
        for (const fn of subs) fn(...args);
      };
      const finalMessagePromise = new Promise<unknown>((resolve, reject) => {
        // Defer one tick so callers have a chance to attach .on('text')
        // before we synthesise the delta.
        queueMicrotask(() => {
          if (opts.hangForever) {
            if (reqOpts?.signal) {
              const onAbort = (): void => {
                const err = new Error('Request was aborted.');
                err.name = 'AbortError';
                reject(err);
              };
              if (reqOpts.signal.aborted) onAbort();
              else reqOpts.signal.addEventListener('abort', onAbort);
            }
            // Never resolves unless aborted.
            return;
          }
          if (opts.rejectWith) {
            reject(opts.rejectWith);
            return;
          }
          if (opts.textOut) emit('text', opts.textOut, opts.textOut);
          resolve({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            stop_reason: opts.stopReason ?? 'end_turn',
            stop_sequence: null,
            content: opts.textOut
              ? [{ type: 'text', text: opts.textOut, citations: null }]
              : [],
            usage: {
              input_tokens: opts.inputTokens ?? 100,
              output_tokens: opts.outputTokens ?? 50,
            },
          });
        });
      });
      return {
        on(event: string, fn: (...args: unknown[]) => void) {
          (listeners[event] ??= []).push(fn);
          return this;
        },
        finalMessage() {
          return finalMessagePromise;
        },
      };
    },
  );
  return {
    messages: {
      stream,
    },
  } as unknown as Anthropic;
}

describe('runGenerateTask (phase 22a)', () => {
  describe('Test A: happy path', () => {
    it('completed outcome with summary + tokens + duration', async () => {
      const client = makeClient({
        textOut: '这是一份产品方案的草稿……',
        inputTokens: 1234,
        outputTokens: 567,
      });
      const outcome = await runGenerateTask({
        taskId: 'tsk_A',
        userId: 'usr_test',
        intent: '写一份 AI 产品 PRD 草案',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).toBe('这是一份产品方案的草稿……');
      expect(outcome.inputTokens).toBe(1234);
      expect(outcome.outputTokens).toBe(567);
      expect(outcome.reason).toBeUndefined();
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Timeout: AbortController fires when API hangs', () => {
    it('returns failed with a Chinese timeout reason after timeoutMs', async () => {
      const client = makeClient({ hangForever: true });
      const start = Date.now();
      const outcome = await runGenerateTask({
        taskId: 'tsk_timeout',
        userId: 'usr_test',
        intent: '翻译这段话',
        client,
        logger: makeLogger(),
        timeoutMs: 200, // tight timeout for the test
      });
      const elapsed = Date.now() - start;

      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toMatch(/超时/);
      // Should NOT take 120s — aborted at our 200ms cap.
      expect(elapsed).toBeLessThan(2_000);
      expect(outcome.summary).toBe('');
    });
  });

  describe('API rejection: non-abort error reported as failed', () => {
    it('passes through the SDK error message', async () => {
      const client = makeClient({
        rejectWith: new Error('Rate limited by Anthropic'),
      });
      const outcome = await runGenerateTask({
        taskId: 'tsk_err',
        userId: 'usr_test',
        intent: '写一段开场白',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toBe('Rate limited by Anthropic');
    });
  });

  describe('Empty response: no text blocks → failed', () => {
    it('reports a friendly empty-response reason after retries are exhausted', async () => {
      // Phase 24 RC follow-up — runGenerateTask now retries empty
      // responses once before giving up. The mock client returns
      // empty text on every call (so both attempts come back empty);
      // outcome message reflects the post-retry exhaustion.
      const client = makeClient({ textOut: '' });
      const outcome = await runGenerateTask({
        taskId: 'tsk_empty',
        userId: 'usr_test',
        intent: '随便写点什么',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toMatch(/没有返回|empty|空内容/i);
      expect(outcome.summary).toBe('');
    });
  });

  describe('Defensive: completes without attachments', () => {
    // Phase 21b-22a — the attachments path threads files into the user
    // message. Verify that the no-attachments branch still works (most
    // generate intents don't carry files).
    it('runs cleanly with no attachments', async () => {
      const client = makeClient({ textOut: 'OK' });
      const outcome = await runGenerateTask({
        taskId: 'tsk_noattach',
        userId: 'usr_test',
        intent: '说 OK',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).toBe('OK');
    });
  });

  // -------------------------------------------------------------------------
  // Phase 2 — expert-workflow intake gate. The runner intercepts before
  // any model call when EXPERT_WORKFLOW=true AND the intent matches a
  // registered workflow (today: douyin-review). Three outcomes:
  //   missing       → awaiting_user with the clarification question
  //   contradiction → awaiting_user with the arithmetic-conflict question
  //   ready         → swap the system prompt, model call proceeds with
  //                   structured report directives + follow-up footer
  //                   appended to the final summary.
  // -------------------------------------------------------------------------
  describe('Phase 2 expert-workflow intake gate', () => {
    // Defer-load to avoid a circular dep at file parse time.
    async function withFlag<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
      const { setFeatureFlagsForTest, reloadFeatureFlagsForTest } = await import(
        '../execution/feature-flags.js'
      );
      setFeatureFlagsForTest({ EXPERT_WORKFLOW: value });
      try {
        return await fn();
      } finally {
        reloadFeatureFlagsForTest();
      }
    }

    it('flag OFF → workflow skipped, default flow even with matching intent', async () => {
      const client = makeClient({ textOut: '生成的复盘报告...' });
      const outcome = await withFlag(false, () =>
        runGenerateTask({
          taskId: 'tsk_w_off',
          userId: 'usr_test',
          intent: '复盘抖音直播 GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%',
          client,
          logger: makeLogger(),
        }),
      );
      expect(outcome.status).toBe('completed');
      // No follow-up footer when workflow is bypassed.
      expect(outcome.summary).not.toContain('HOLA_FOLLOW_UP_ACTIONS');
      expect(outcome.summary).toBe('生成的复盘报告...');
    });

    it('flag ON + missing inputs → awaiting_user with clarification question, NO model call', async () => {
      const client = makeClient({ textOut: 'should not be reached' });
      const outcome = await withFlag(true, () =>
        runGenerateTask({
          taskId: 'tsk_w_missing',
          userId: 'usr_test',
          intent: '帮我复盘下抖音直播',
          client,
          logger: makeLogger(),
        }),
      );
      expect(outcome.status).toBe('awaiting_user');
      expect(outcome.summary).toContain('直播 GMV');
      expect(outcome.summary).toContain('客单价');
      expect(outcome.inputTokens).toBe(0);
      expect(outcome.outputTokens).toBe(0);
    });

    it('flag ON + contradiction → awaiting_user with arithmetic-conflict question', async () => {
      const client = makeClient({ textOut: 'should not be reached' });
      const outcome = await withFlag(true, () =>
        runGenerateTask({
          taskId: 'tsk_w_contradict',
          userId: 'usr_test',
          intent:
            '复盘抖音直播 GMV 200000 UV 5000 订单 500 客单价 50 转化率 10%',
          client,
          logger: makeLogger(),
        }),
      );
      expect(outcome.status).toBe('awaiting_user');
      expect(outcome.summary).toContain('校验未通过');
      expect(outcome.summary).toContain('400'); // calculated avg price
      expect(outcome.summary).toContain('50'); // declared
      expect(outcome.inputTokens).toBe(0);
    });

    it('flag ON + ready → model call uses workflow system prompt + footer appended', async () => {
      // The mock client captures the system prompt the runner sends so
      // we can assert it carries the workflow's directive markers
      // (source-annotation markers, section list).
      let systemPromptSeen = '';
      const stream = vi.fn(
        (params: { system: { text: string }[] }, _reqOpts?: unknown): unknown => {
          systemPromptSeen = params.system[0]?.text ?? '';
          const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
          const emit = (event: string, ...args: unknown[]) => {
            for (const fn of listeners[event] ?? []) fn(...args);
          };
          const finalMessagePromise = new Promise<unknown>((resolve) => {
            queueMicrotask(() => {
              const text = '## 核心数据\n本场 GMV ¥100000 ([用户提供] 用户提供) ...';
              emit('text', text, text);
              resolve({
                id: 'msg_test',
                model: 'claude-sonnet-4-6',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text, citations: null }],
                usage: { input_tokens: 100, output_tokens: 50 },
              });
            });
          });
          return {
            on(event: string, fn: (...a: unknown[]) => void) {
              (listeners[event] ??= []).push(fn);
              return this;
            },
            finalMessage() {
              return finalMessagePromise;
            },
          };
        },
      );
      const client = { messages: { stream } } as unknown as Anthropic;

      const outcome = await withFlag(true, () =>
        runGenerateTask({
          taskId: 'tsk_w_ready',
          userId: 'usr_test',
          intent:
            '复盘抖音直播 GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%',
          client,
          logger: makeLogger(),
        }),
      );
      expect(outcome.status).toBe('completed');
      // System prompt swapped to workflow report directives:
      expect(systemPromptSeen).toContain('抖音直播复盘');
      expect(systemPromptSeen).toContain('[用户提供]');
      expect(systemPromptSeen).toContain('核心数据');
      expect(systemPromptSeen).toContain('"gmv": 100000');
      // Follow-up footer appended:
      expect(outcome.summary).toContain('HOLA_FOLLOW_UP_ACTIONS_START');
      expect(outcome.summary).toContain('生成下场直播 SOP');
    });

    it('flag ON + non-matching intent → workflow skipped, default flow', async () => {
      const client = makeClient({ textOut: 'translation result' });
      const outcome = await withFlag(true, () =>
        runGenerateTask({
          taskId: 'tsk_w_no_match',
          userId: 'usr_test',
          intent: '把这句话翻译成英文：今天天气真好',
          client,
          logger: makeLogger(),
        }),
      );
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).toBe('translation result');
      // No workflow → no footer.
      expect(outcome.summary).not.toContain('HOLA_FOLLOW_UP_ACTIONS');
    });
  });
});

describe('runGenerateTask — lightweight direct-answer path', () => {
  it('"1 加 1 等于几？" → clean short summary, NOT lost/emptied; no web_search', async () => {
    const client = makeClient({ textOut: '1 + 1 = 2' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw',
      userId: 'usr_test',
      intent: '1 加 1 等于几？',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    // The short answer survives the runner — not blanked / not "没有答案".
    expect(outcome.summary).toBe('1 + 1 = 2');
    expect(outcome.summary).toContain('2');
    const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as { tools?: unknown[]; system?: Array<{ text: string }> } | undefined ?? {};
    expect(req.tools).toEqual([]); // web_search dropped for lightweight
    expect(req.system?.[0]?.text).toContain('简洁');
  });

  it('greeting "你好" → short reply survives', async () => {
    const client = makeClient({ textOut: '你好！很高兴见到你，有什么我可以帮你的吗？' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_hi',
      userId: 'usr_test',
      intent: '你好',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('你好');
  });

  it('"100 * 23 等于几？" → direct-answer path, no web_search, result survives', async () => {
    const client = makeClient({ textOut: '100 × 23 = 2300' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_mul',
      userId: 'usr_test',
      intent: '100 * 23 等于几？',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('2300');
    const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as { tools?: unknown[] } | undefined ?? {};
    expect(req.tools).toEqual([]); // web_search dropped for lightweight
  });

  it('thank-you "谢谢" → short reply survives via direct-answer', async () => {
    const client = makeClient({ textOut: '不客气！还有什么我可以帮你的吗？' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_thanks',
      userId: 'usr_test',
      intent: '谢谢',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('不客气');
    const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as { tools?: unknown[] } | undefined ?? {};
    expect(req.tools).toEqual([]);
  });

  it('must-execute intents that reach the runner keep web_search (no direct-answer)', async () => {
    // Defense-in-depth: even if a web/action/file intent were dispatched
    // to the generate runner (e.g. the named-site "去 Google Flights 查
    // 机票" currently routes to generate), it must NOT take the
    // direct-answer shortcut — web_search stays on so the model can
    // actually fetch live data instead of hedging from priors.
    for (const intent of [
      '生成一个可下载的 Markdown 文件',
      '去 Google Flights 查机票',
      '查今天特斯拉股价',
      '搜索最新 AI 新闻',
    ]) {
      const client = makeClient({ textOut: '……' });
      await runGenerateTask({
        taskId: `tsk_me_${intent.length}`,
        userId: 'usr_test',
        intent,
        client,
        logger: makeLogger(),
      });
      const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
        .mock.calls[0]?.[0] as { tools?: unknown[] } | undefined ?? {};
      expect((req.tools as unknown[]).length, intent).toBeGreaterThan(0);
    }
  });

  it('a real research task keeps web_search (not intercepted)', async () => {
    const client = makeClient({ textOut: '这是一份 2026 行业研究报告……' });
    await runGenerateTask({
      taskId: 'tsk_full',
      userId: 'usr_test',
      intent: '写一份 2026 年 AI 行业研究报告，包含市场格局与趋势',
      client,
      logger: makeLogger(),
    });
    const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as { tools?: unknown[] } | undefined ?? {};
    expect((req.tools as unknown[]).length).toBeGreaterThan(0);
  });
});
