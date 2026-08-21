import { describe, expect, it, vi } from 'vitest';

import { verifyDeterministic } from './answer-verifier.js';
import { buildContract } from './execution-contract.js';
import { EvidenceLedger } from './evidence-ledger.js';
import {
  ANSWER_TRUNCATE_CHARS,
  buildUserPayload,
  DEFAULT_LLM_VERIFIER_MODEL,
  DEFAULT_LLM_VERIFIER_TIMEOUT_MS,
  shouldRunLlmVerifier,
  verifyWithLlm,
  type AnthropicLikeClient,
  type AnthropicMessageContentBlock,
  type AnthropicMessageCreateParams,
  type AnthropicRequestOptions,
  type AnthropicMessageResponse,
} from './llm-verifier.js';

// ---------------------------------------------------------------------------
// Mock client helpers
// ---------------------------------------------------------------------------

interface ClientOptions {
  /** When set, the client returns a response with this text block. */
  textOut?: string;
  /** When set, messages.create rejects with this error. */
  rejectWith?: Error;
  /** When true, never resolves until aborted. */
  hangForever?: boolean;
  /** When true, never resolves and ignores abort. */
  ignoreAbort?: boolean;
  /** Override response shape entirely. */
  contentOverride?: AnthropicMessageContentBlock[];
}

function makeClient(opts: ClientOptions = {}): {
  client: AnthropicLikeClient;
  createMock: ReturnType<typeof vi.fn>;
} {
  const createMock = vi.fn(
    (
      _params: AnthropicMessageCreateParams,
      reqOpts?: AnthropicRequestOptions,
    ): Promise<AnthropicMessageResponse> => {
      if (opts.hangForever) {
        return new Promise((_resolve, reject) => {
          if (reqOpts?.signal) {
            const onAbort = (): void => {
              const err = new Error('Request was aborted.');
              err.name = 'AbortError';
              reject(err);
            };
            if (reqOpts.signal.aborted) onAbort();
            else reqOpts.signal.addEventListener('abort', onAbort);
          }
        });
      }
      if (opts.ignoreAbort) {
        return new Promise(() => undefined);
      }
      if (opts.rejectWith) return Promise.reject(opts.rejectWith);
      const content: AnthropicMessageContentBlock[] =
        opts.contentOverride ?? [
          { type: 'text', text: opts.textOut ?? '{"passed":true,"issues":[]}' },
        ];
      return Promise.resolve({ content });
    },
  );
  return {
    client: { messages: { create: createMock } },
    createMock,
  };
}

function makeFullContract(taskId = 'tsk_full') {
  return buildContract({
    taskId,
    intent: '复盘抖音直播',
    executionMode: 'generate',
    expertWorkflowId: 'douyin-livestream-review',
  });
}

function makeFullPassingResult(taskId = 'tsk_full') {
  const contract = makeFullContract(taskId);
  const ledger = new EvidenceLedger(taskId);
  ledger.add({
    fact: 'GMV=100000, 客单价=80',
    sourceType: 'user_input',
    sourceDetail: 'msg #1',
    confidence: 'observed',
  });
  // Long enough answer + mentions both required inputs.
  const answerText =
    '本场 GMV ¥100000，客单价 ¥80。' + '复盘建议：' + 'x'.repeat(220);
  const detResult = verifyDeterministic({
    contract,
    ledger,
    answerText,
  });
  return { contract, ledger, answerText, detResult };
}

// ---------------------------------------------------------------------------
// shouldRunLlmVerifier
// ---------------------------------------------------------------------------

describe('shouldRunLlmVerifier', () => {
  it('triggers when tier=full AND deterministic passed', () => {
    const { contract, detResult } = makeFullPassingResult('tsk_t1');
    expect(detResult.passed).toBe(true);
    expect(shouldRunLlmVerifier(detResult, contract)).toBe(true);
  });

  it('does NOT trigger when tier=full but deterministic failed', () => {
    const contract = makeFullContract('tsk_t2');
    const ledger = new EvidenceLedger('tsk_t2');
    // No user_input → data_present check fails.
    const detResult = verifyDeterministic({
      contract,
      ledger,
      answerText: 'short',
    });
    expect(detResult.passed).toBe(false);
    expect(shouldRunLlmVerifier(detResult, contract)).toBe(false);
  });

  it('does NOT trigger when tier=light', () => {
    const contract = buildContract({
      taskId: 'tsk_t3',
      intent: 'open',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = new EvidenceLedger('tsk_t3');
    ledger.add({
      fact: 'visited https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const detResult = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Page reached example.com home content successfully.',
      finalUrl: 'https://example.com/',
    });
    expect(detResult.passed).toBe(true);
    expect(shouldRunLlmVerifier(detResult, contract)).toBe(false);
  });

  it('does NOT trigger when tier=checklist', () => {
    const contract = buildContract({
      taskId: 'tsk_t4',
      intent: 'translate',
      executionMode: 'generate',
    });
    const ledger = new EvidenceLedger('tsk_t4');
    const detResult = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Translated text long enough to pass word_count' + 'x'.repeat(60),
    });
    expect(detResult.passed).toBe(true);
    expect(shouldRunLlmVerifier(detResult, contract)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildUserPayload
// ---------------------------------------------------------------------------

describe('buildUserPayload — request shape', () => {
  it('serialises contract + evidence + answerDraft', () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_pl');
    const payload = JSON.parse(buildUserPayload({ contract, ledger, answerText }));
    expect(payload.contract.taskId).toBe('tsk_pl');
    expect(payload.contract.tier).toBe('full');
    expect(payload.evidence.taskId).toBe('tsk_pl');
    expect(payload.answerDraft).toBe(answerText); // not truncated
    expect(payload.finalUrl).toBeUndefined();
  });

  it('includes finalUrl when provided', () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_url');
    const payload = JSON.parse(
      buildUserPayload({
        contract,
        ledger,
        answerText,
        finalUrl: 'https://example.com/done',
      }),
    );
    expect(payload.finalUrl).toBe('https://example.com/done');
  });

  it('truncates answer beyond ANSWER_TRUNCATE_CHARS and marks it', () => {
    const { contract, ledger } = makeFullPassingResult('tsk_trunc');
    const huge = 'a'.repeat(ANSWER_TRUNCATE_CHARS + 500);
    const payload = JSON.parse(
      buildUserPayload({ contract, ledger, answerText: huge }),
    );
    const draft = payload.answerDraft as string;
    expect(draft.length).toBeLessThanOrEqual(ANSWER_TRUNCATE_CHARS + 32);
    expect(draft).toContain('[...truncated]');
    expect(draft.startsWith('a'.repeat(ANSWER_TRUNCATE_CHARS))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyWithLlm — happy paths
// ---------------------------------------------------------------------------

describe('verifyWithLlm — pass', () => {
  it('returns passed=true when LLM responds {passed:true,issues:[]}', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_p');
    const { client, createMock } = makeClient({
      textOut: '{"passed":true,"issues":[]}',
    });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
    expect(result.tier).toBe('llm');
    expect(result.failureLevel).toBeUndefined();
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.criterionId).toBe('llm.overall');
    expect(result.checks[0]!.checker).toBe('llm');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('uses Haiku model and the spec system prompt by default', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_m');
    const { client, createMock } = makeClient({
      textOut: '{"passed":true,"issues":[]}',
    });
    await verifyWithLlm({ contract, ledger, answerText, client });
    const params = createMock.mock.calls[0]![0] as AnthropicMessageCreateParams;
    expect(params.model).toBe(DEFAULT_LLM_VERIFIER_MODEL);
    expect(params.system).toContain('质量检查员');
    expect(params.messages[0]!.role).toBe('user');
    // The user payload is JSON-string of the spec shape.
    const body = JSON.parse(params.messages[0]!.content);
    expect(body.contract.taskId).toBe('tsk_m');
  });

  it('bounds verifier requests with no SDK retries', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_bounds');
    const { client, createMock } = makeClient({
      textOut: '{"passed":true,"issues":[]}',
    });
    await verifyWithLlm({ contract, ledger, answerText, client, timeoutMs: 1234 });
    const requestOptions = createMock.mock.calls[0]![1] as AnthropicRequestOptions;
    expect(requestOptions.timeout).toBe(1234);
    expect(requestOptions.maxRetries).toBe(0);
    expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('respects model override', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_mo');
    const { client, createMock } = makeClient({
      textOut: '{"passed":true,"issues":[]}',
    });
    await verifyWithLlm({
      contract,
      ledger,
      answerText,
      client,
      model: 'claude-sonnet-4-6',
    });
    const params = createMock.mock.calls[0]![0] as AnthropicMessageCreateParams;
    expect(params.model).toBe('claude-sonnet-4-6');
  });

  it('parses ```json fenced response cleanly', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_fence');
    const { client } = makeClient({
      textOut: '```json\n{"passed":true,"issues":[]}\n```',
    });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyWithLlm — issues path
// ---------------------------------------------------------------------------

describe('verifyWithLlm — issues', () => {
  it('maps fixable=true to severity=fixable and failureLevel=fixable', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_i1');
    const issuesText = JSON.stringify({
      passed: false,
      issues: [
        {
          criterion_id: contract.successCriteria[0]!.id,
          problem: '回复中遗漏了用户提供的 GMV 字段',
          fixable: true,
        },
      ],
    });
    const { client } = makeClient({ textOut: issuesText });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('fixable');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.checker).toBe('llm');
    expect(result.checks[0]!.passed).toBe(false);
    expect(result.checks[0]!.severity).toBe('fixable');
    expect(result.checks[0]!.detail).toContain('遗漏');
  });

  it('maps fixable=false to needs_clarification', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_i2');
    const issuesText = JSON.stringify({
      passed: false,
      issues: [
        {
          criterion_id: contract.successCriteria[0]!.id,
          problem: '用户提供的数据存在矛盾，需要澄清',
          fixable: false,
        },
      ],
    });
    const { client } = makeClient({ textOut: issuesText });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('needs_clarification');
  });

  it('mixed fixable+non-fixable: needs_clarification wins (worst case)', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_i3');
    const issuesText = JSON.stringify({
      passed: false,
      issues: [
        { criterion_id: 'a', problem: 'minor format', fixable: true },
        { criterion_id: 'b', problem: 'missing core data', fixable: false },
      ],
    });
    const { client } = makeClient({ textOut: issuesText });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.failureLevel).toBe('needs_clarification');
    expect(result.checks).toHaveLength(2);
  });

  it('passed=false with empty issues is an invalid advisory verdict and does not block', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_i4');
    const { client } = makeClient({
      textOut: '{"passed":false,"issues":[]}',
    });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
    expect(result.failureLevel).toBeUndefined();
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        criterionId: 'llm.fallback',
        passed: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// verifyWithLlm — fallback paths (timeout, error, parse failure)
// ---------------------------------------------------------------------------

describe('verifyWithLlm — non-blocking fallbacks', () => {
  it('timeout: hangForever + small timeoutMs → fallback pass with timeout note', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_to');
    const { client } = makeClient({ hangForever: true });
    const result = await verifyWithLlm({
      contract,
      ledger,
      answerText,
      client,
      timeoutMs: 50, // fire fast
    });
    expect(result.passed).toBe(true);
    expect(result.tier).toBe('llm');
    expect(result.checks[0]!.criterionId).toBe('llm.fallback');
    expect(result.checks[0]!.detail).toContain('timed out');
    expect(result.failureLevel).toBeUndefined();
  });

  it('hard timeout: fallback pass even when the SDK ignores abort', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_hard_to');
    const { client } = makeClient({ ignoreAbort: true });
    const startedAt = Date.now();
    const result = await verifyWithLlm({
      contract,
      ledger,
      answerText,
      client,
      timeoutMs: 40,
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.passed).toBe(true);
    expect(result.tier).toBe('llm');
    expect(result.checks[0]!.criterionId).toBe('llm.fallback');
    expect(result.checks[0]!.detail).toContain('timed out');
  });

  it('default timeout is 15s (sanity check on the constant)', () => {
    expect(DEFAULT_LLM_VERIFIER_TIMEOUT_MS).toBe(15_000);
  });

  it('api error: rejection → fallback pass with error note', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_err');
    const { client } = makeClient({ rejectWith: new Error('502 upstream') });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
    expect(result.checks[0]!.criterionId).toBe('llm.fallback');
    expect(result.checks[0]!.detail).toContain('502 upstream');
  });

  it('empty response: no text blocks → fallback pass', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_empty');
    const { client } = makeClient({ contentOverride: [] });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
    expect(result.checks[0]!.detail).toContain('empty response');
  });

  it('malformed JSON → fallback pass', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_bad');
    const { client } = makeClient({ textOut: 'definitely not json {{{' });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
    expect(result.checks[0]!.detail).toContain('not valid JSON');
  });

  it('JSON with wrong schema (missing passed) → fallback pass', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_sch');
    const { client } = makeClient({ textOut: '{"issues":[],"summary":"ok"}' });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
  });

  it('JSON with malformed issue entry → fallback pass', async () => {
    const { contract, ledger, answerText } = makeFullPassingResult('tsk_si');
    const { client } = makeClient({
      // criterion_id is a number, not string → schema check rejects.
      textOut: '{"passed":false,"issues":[{"criterion_id":42,"problem":"x","fixable":true}]}',
    });
    const result = await verifyWithLlm({ contract, ledger, answerText, client });
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Verify the deterministic verifier's needs_clarification stays sticky
// (number contradiction case — spec rule 6).
// ---------------------------------------------------------------------------

describe('LLM verifier does NOT alter deterministic needs_clarification verdict', () => {
  it('shouldRunLlmVerifier=false when deterministic flagged number conflict', () => {
    // Build a contract that would otherwise be tier=full.
    const contract = makeFullContract('tsk_nc');
    const ledger = new EvidenceLedger('tsk_nc');
    ledger.add({
      fact: 'GMV = ¥200000',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    ledger.add({
      fact: '订单数 = 500',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    ledger.add({
      fact: '客单价 = ¥50',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const detResult = verifyDeterministic({
      contract,
      ledger,
      answerText: '直播复盘报告' + 'x'.repeat(220),
    });
    expect(detResult.passed).toBe(false);
    expect(detResult.failureLevel).toBe('needs_clarification');
    // Spec rule: LLM tier ONLY runs when deterministic passed. Number
    // conflict short-circuits before LLM ever sees the answer.
    expect(shouldRunLlmVerifier(detResult, contract)).toBe(false);
  });
});
