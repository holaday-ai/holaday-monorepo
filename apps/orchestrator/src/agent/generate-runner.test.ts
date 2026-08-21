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

import type Anthropic from '@anthropic-ai/sdk';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_TOPIC_WORKFLOW } from '../execution/expert-workflow-content-topic.js';
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
  contentBlocks?: ReadonlyArray<unknown>;
  citations?: Array<{
    type: 'web_search_result_location';
    title: string | null;
    url: string;
    cited_text: string;
    encrypted_index: string;
  }>;
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
            content:
              opts.contentBlocks ??
              (opts.textOut
                ? [{ type: 'text', text: opts.textOut, citations: opts.citations ?? null }]
                : []),
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

    it('ordinary generate task keeps the global 8192-token budget', async () => {
      const client = makeClient({ textOut: '普通生成结果' });

      const outcome = await runGenerateTask({
        taskId: 'tsk_default_budget',
        userId: 'usr_test',
        intent: '写一份详细的产品方案，包含背景、目标和执行步骤',
        client,
        logger: makeLogger(),
      });

      const streamMock = client.messages.stream as unknown as ReturnType<typeof vi.fn>;
      const params = streamMock.mock.calls[0]?.[0] as { max_tokens: number };
      expect(outcome.status).toBe('completed');
      expect(params.max_tokens).toBe(8192);
    });

    it('threads forced expert mode into the generated system prompt', async () => {
      const client = makeClient({ textOut: '专家建议正文' });
      await runGenerateTask({
        taskId: 'tsk_expert_prompt',
        userId: 'usr_test',
        intent: '给我一份 SaaS landing page 优化建议，按转化漏斗分层',
        expertMode: 'expert',
        client,
        logger: makeLogger(),
      });

      const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
        .mock.calls[0]?.[0] as { system?: Array<{ text: string }> } | undefined;
      expect(req?.system?.[0]?.text).toContain('专家模式质量合同');
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
      let maxTokensSeen = 0;
      const stream = vi.fn(
        (params: { system: { text: string }[]; max_tokens: number }, _reqOpts?: unknown): unknown => {
          systemPromptSeen = params.system[0]?.text ?? '';
          maxTokensSeen = params.max_tokens;
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
      expect(maxTokensSeen).toBe(4096);
      // Follow-up footer appended:
      expect(outcome.summary).toContain('HOLA_FOLLOW_UP_ACTIONS_START');
      expect(outcome.summary).toContain('生成下场直播 SOP');
    });

    it('content-topic workflow uses its larger bounded token budget', async () => {
      let maxTokensSeen = 0;
      const stream = vi.fn(
        (params: { max_tokens: number }): unknown => {
          maxTokensSeen = params.max_tokens;
          const finalMessagePromise = Promise.resolve({
            id: 'msg_content_budget',
            model: 'claude-sonnet-4-6',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '## 数据校验\n已通过', citations: null }],
            usage: { input_tokens: 100, output_tokens: 50 },
          });
          return {
            on() {
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
          taskId: 'tsk_content_budget',
          userId: 'usr_test',
          intent: '品类 母婴 平台小红书 生成 8 个选题',
          workflowOverride: CONTENT_TOPIC_WORKFLOW,
          client,
          logger: makeLogger(),
        }),
      );

      expect(outcome.status).toBe('completed');
      expect(maxTokensSeen).toBe(5120);
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

describe('runGenerateTask — deterministic fast path (Task B)', () => {
  function streamCallCount(client: Anthropic): number {
    return (client.messages.stream as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .length;
  }

  it('"1 加 1 等于几？" → deterministic answer, NO model call', async () => {
    const client = makeClient({ textOut: 'should not be reached' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw',
      userId: 'usr_test',
      intent: '1 加 1 等于几？',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toBe('1 + 1 = 2');
    expect(outcome.inputTokens).toBe(0);
    expect(outcome.outputTokens).toBe(0);
    expect(streamCallCount(client)).toBe(0); // model never invoked
  });

  it('"100 * 23 等于几？" → deterministic 2300, NO model call', async () => {
    const client = makeClient({ textOut: 'should not be reached' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_mul',
      userId: 'usr_test',
      intent: '100 * 23 等于几？',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toBe('100 × 23 = 2300');
    expect(streamCallCount(client)).toBe(0);
  });

  it('thank-you "谢谢" → deterministic reply, NO model call', async () => {
    const client = makeClient({ textOut: 'should not be reached' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_thanks',
      userId: 'usr_test',
      intent: '谢谢',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('不客气');
    expect(streamCallCount(client)).toBe(0);
  });

  it('emits the deterministic answer through onStreamDelta', async () => {
    const client = makeClient({ textOut: 'should not be reached' });
    const deltas: string[] = [];
    await runGenerateTask({
      taskId: 'tsk_lw_delta',
      userId: 'usr_test',
      intent: '1+1',
      client,
      logger: makeLogger(),
      onStreamDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(['1 + 1 = 2']);
  });

  it('"什么是 AI？" → lightweight but NOT deterministic → model direct-answer (web_search dropped)', async () => {
    const client = makeClient({ textOut: 'AI 指人工智能，让机器模拟人类的学习与推理能力。' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_know',
      userId: 'usr_test',
      intent: '什么是 AI？',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('人工智能');
    const req = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as { tools?: unknown[]; system?: Array<{ text: string }> } | undefined ?? {};
    expect(req.tools).toEqual([]); // web_search dropped for lightweight
    expect(req.system?.[0]?.text).toContain('简洁');
  });

  it('unit conversion stays on the model (not deterministic)', async () => {
    const client = makeClient({ textOut: '100 摄氏度 = 212 华氏度' });
    const outcome = await runGenerateTask({
      taskId: 'tsk_lw_conv',
      userId: 'usr_test',
      intent: '把 100 摄氏度换算成华氏度',
      client,
      logger: makeLogger(),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('212');
    expect(streamCallCount(client)).toBe(1); // model WAS called
  });
});

describe('runGenerateTask — lightweight direct-answer path', () => {
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

  it('must-execute intents that reach the runner keep web_search (no direct-answer)', async () => {
    // Defense-in-depth: even if a web/action/file intent were dispatched
    // to the generate runner, it must NOT take the direct-answer or
    // deterministic shortcut — web_search stays on so the model can
    // actually fetch live data instead of hedging from priors. ("去
    // Google Flights 查机票" routes to browser now, but is fed here to
    // prove the runner-level guard regardless of routing.)
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

  it('requires a source-backed search for a recent fund-event question', async () => {
    const client = makeClient({
      textOut: '需要补充基金全称或代码，才能准确核验近期动态。',
    });

    await runGenerateTask({
      taskId: 'tsk_recent_fund',
      userId: 'usr_test',
      intent: 'leopold的基金最近发生了什么事？',
      client,
      logger: makeLogger(),
    });

    const request = (client.messages.stream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as
      | { tool_choice?: unknown; system?: Array<{ text: string }> }
      | undefined;
    expect(request?.tool_choice).toEqual({ type: 'any' });
    expect(request?.system?.[0]?.text).toContain('必须先调用 web_search');
    expect(request?.system?.[0]?.text).toContain('基金全称或代码');
    expect(request?.system?.[0]?.text).toContain('不得把泛市场新闻、相似名称或相关机构动态写成目标对象的近况');
  });

  it('keeps web-search citations as clickable verification links', async () => {
    const client = makeClient({
      textOut: 'Leopold 的基金近期出现较大波动，以下结论仅基于检索结果。',
      citations: [
        {
          type: 'web_search_result_location',
          title: 'Reuters: fund update',
          url: 'https://www.reuters.com/example/fund-update',
          cited_text: 'fund update',
          encrypted_index: 'citation_1',
        },
      ],
    });

    const outcome = await runGenerateTask({
      taskId: 'tsk_fund_citations',
      userId: 'usr_test',
      intent: 'Leopold 的基金最近发生了什么事？',
      client,
      logger: makeLogger(),
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('### 核验来源');
    expect(outcome.summary).toContain(
      '[Reuters: fund update](<https://www.reuters.com/example/fund-update>)',
    );
    expect(outcome.sourceUrls).toEqual(['https://www.reuters.com/example/fund-update']);
  });

  it('keeps verified search-result links when dynamic filtering emits no text citations', async () => {
    const sourceUrl = 'https://developers.googleblog.com/en/google-io-2026-ai-update/';
    const client = makeClient({
      textOut: 'Google I/O 2026 发布了最新 AI 产品更新。',
      contentBlocks: [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_code',
          name: 'code_execution',
          input: { code: 'search_web("Google I/O 2026 AI")' },
        },
        {
          type: 'server_tool_use',
          id: 'srvtoolu_search',
          name: 'web_search',
          input: { query: 'Google I/O 2026 AI' },
          caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_code' },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_search',
          caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_code' },
          content: [
            {
              type: 'web_search_result',
              url: sourceUrl,
              title: 'Google I/O 2026 AI update',
              encrypted_content: 'encrypted-search-result',
              page_age: 'May 20, 2026',
            },
            {
              type: 'web_search_result',
              url: sourceUrl,
              title: 'Duplicate result',
            },
            {
              type: 'web_search_result',
              url: 'javascript:alert(1)',
              title: 'Unsafe result',
            },
          ],
        },
        {
          type: 'code_execution_tool_result',
          tool_use_id: 'srvtoolu_code',
          content: { type: 'code_execution_result', stdout: '', stderr: '', return_code: 0 },
        },
        {
          type: 'text',
          text: 'Google I/O 2026 发布了最新 AI 产品更新。',
          citations: null,
        },
      ],
    });

    const outcome = await runGenerateTask({
      taskId: 'tsk_dynamic_search_result',
      userId: 'usr_test',
      intent: '2026年5月最新的AI行业新闻是什么',
      client,
      logger: makeLogger(),
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('### 检索来源（请核对）');
    expect(outcome.summary).not.toContain('### 核验来源');
    expect(outcome.summary).toContain(`[Google I/O 2026 AI update](<${sourceUrl}>)`);
    expect(outcome.summary).not.toContain('javascript:');
    expect(outcome.sourceUrls).toEqual([sourceUrl]);
  });
});
