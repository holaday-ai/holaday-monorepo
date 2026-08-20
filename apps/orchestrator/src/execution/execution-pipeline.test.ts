/**
 * Phase 1 Day 5 — execution-pipeline integration tests.
 *
 * Covers BOSS spec section 7a (the 9 cases):
 *   1. Flags all off → all entry points are no-ops
 *   2. Only Ledger on → recordEvidence writes, no verification
 *   3. All on + generate (checklist tier) → deterministic passes
 *   4. All on + URL fabrication → fixable → autoFix → passes
 *   5. All on + URL fabrication unfixable → demoted needs_clarification
 *   6. All on + full tier → LLM verifier triggered (mocked Haiku)
 *   7. All on + constraint violation → hard_fail
 *   8. Persist writes the 5 columns
 *   9. Persist failure non-blocking
 *
 * Plus a few extras: dispose / contract registry / pipeline-throws
 * fallback / non-completed runner outcomes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetLedgerRegistryForTest, getLedger } from './evidence-ledger.js';
import {
  _resetExecutionPipelineForTest,
  assessResultTrust,
  assessResearchSourceTrust,
  disposeExecution,
  deriveFinalStatus,
  extractFailedChecks,
  getContract,
  initExecution,
  persistExecution,
  recheckPostFormat,
  recordEvidence,
  verifyAndFinalize,
} from './execution-pipeline.js';
import {
  reloadFeatureFlagsForTest,
  setFeatureFlagsForTest,
} from './feature-flags.js';
import type { AnthropicLikeClient } from './llm-verifier.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetLedgerRegistryForTest();
  _resetExecutionPipelineForTest();
  setFeatureFlagsForTest({
    EVIDENCE_LEDGER: false,
    EXECUTION_CONTRACT: false,
    EXECUTION_VERIFIER: false,
  });
});

afterEach(() => {
  reloadFeatureFlagsForTest();
});

function flagsAllOn(): void {
  setFeatureFlagsForTest({
    EVIDENCE_LEDGER: true,
    EXECUTION_CONTRACT: true,
    EXECUTION_VERIFIER: true,
  });
}

function makeStubClient(textOut: string): AnthropicLikeClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: textOut }],
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Case 1 — flags all off, no-op everywhere
// ---------------------------------------------------------------------------

describe('flags off (default)', () => {
  it('marks an explicit research result with no source as partial instead of completed', () => {
    const review = assessResearchSourceTrust({
      intent: '研究 2026 年 AI 行业趋势',
      resultText: 'AI 行业仍在快速增长。',
    });

    expect(review).toEqual({
      requiresReview: true,
      blocking: false,
      failedChecks: [
        {
          type: 'source_count',
          detail: '研究或检索结果缺少可点击来源，关键事实未验证',
        },
      ],
    });
    expect(deriveFinalStatus('completed', null, review)).toBe('partial_success');
  });

  it('recognises a natural freshness question as research that needs sources', () => {
    const review = assessResultTrust({
      intent: '2026年5月最新的AI行业新闻是什么',
      resultText: '多家公司发布了新的模型与融资计划。',
    });

    expect(review).toEqual({
      requiresReview: true,
      blocking: false,
      failedChecks: [
        {
          type: 'source_count',
          detail: '研究或检索结果缺少可点击来源，关键事实未验证',
        },
      ],
    });
    expect(deriveFinalStatus('completed', null, review)).toBe('partial_success');
  });

  it.each(['总结本周 AI 行业新闻', '生成式 AI 最新新闻是什么'])(
    'recognises freshness retrieval phrased as %s',
    (intent) => {
      const review = assessResultTrust({
        intent,
        resultText: '多家公司发布了新的模型与融资计划。',
      });

      expect(review.requiresReview).toBe(true);
      expect(review.blocking).toBe(false);
    },
  );

  it('does not treat supplied text containing freshness words as retrieval', () => {
    const review = assessResultTrust({
      intent: '把下面这句话改写得更自然：今天的新闻很多。',
      resultText: '今天的新闻内容很丰富。',
    });

    expect(review.requiresReview).toBe(false);
  });

  it('fails a stock quote with no source even when the execution verifier flag is off', () => {
    const review = assessResultTrust({
      intent: '查今天特斯拉股价并给出来源',
      resultText: '特斯拉当前价格为 123.45 美元，时间为今天 10:30。',
    });

    expect(review.requiresReview).toBe(true);
    expect(review.failedChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'source_count' })]),
    );
    expect(deriveFinalStatus('completed', null, review)).toBe('failed');
  });

  it('fails a current stock quote that contradicts itself about market timing', () => {
    const review = assessResultTrust({
      intent: '查今天特斯拉股价并给出来源链接',
      resultText:
        '特斯拉当前价格为 123.45 美元，时间为 2026-08-06 10:30。市场已经收盘，但美股尚未开盘。来源：https://example.com/tsla',
    });

    expect(review.requiresReview).toBe(true);
    expect(review.failedChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'temporal_consistency' })]),
    );
    expect(deriveFinalStatus('completed', null, review)).toBe('failed');
  });

  it('accepts a structurally complete stock quote with price, timestamp, and source', () => {
    const review = assessResultTrust({
      intent: '查今天特斯拉股价并给出来源链接',
      resultText:
        '特斯拉当前价格为 123.45 美元，更新时间为 2026-08-06 10:30。来源：https://example.com/tsla',
    });

    expect(review.requiresReview).toBe(false);
    expect(deriveFinalStatus('completed', null, review)).toBe('completed');
  });

  it('fails an ecommerce ranking that claims a winner without verifiable product links', () => {
    const review = assessResultTrust({
      intent: '去电商站搜 iPhone 16，按价格排序，给前5结果（名称/价格/链接）',
      resultText:
        '唯一最佳选择是 iPhone 16 128GB，价格 4599 元。其余结果与链接暂时无法获取。',
    });

    expect(review.requiresReview).toBe(true);
    expect(review.failedChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'ecommerce_rows' })]),
    );
    expect(deriveFinalStatus('completed', null, review)).toBe('failed');
  });

  it('accepts complete ecommerce rows written as bullet items', () => {
    const review = assessResultTrust({
      intent: '去电商站搜 iPhone 16，按价格排序，给前3结果（名称/价格/链接）',
      resultText: [
        '- iPhone 16 128GB ¥4599 https://example.com/item-1',
        '- iPhone 16 256GB ¥4999 https://example.com/item-2',
        '- iPhone 16 Plus ¥5299 https://example.com/item-3',
      ].join('\n'),
    });

    expect(review.requiresReview).toBe(false);
    expect(deriveFinalStatus('completed', null, review)).toBe('completed');
  });

  it('initExecution returns null contract + null ledger', () => {
    const out = initExecution({
      taskId: 'tsk_off1',
      intent: '翻译',
      executionMode: 'generate',
    });
    expect(out.contract).toBeNull();
    expect(out.ledger).toBeNull();
    expect(getLedger('tsk_off1')).toBeUndefined();
    expect(getContract('tsk_off1')).toBeUndefined();
  });

  it('recordEvidence is a silent no-op', () => {
    initExecution({ taskId: 'tsk_off2', intent: 'x', executionMode: 'generate' });
    recordEvidence('tsk_off2', {
      fact: 'something',
      sourceType: 'tool_result',
      sourceDetail: 'x',
      confidence: 'extracted',
    });
    expect(getLedger('tsk_off2')).toBeUndefined();
  });

  it('verifyAndFinalize returns the input text and null verification', async () => {
    const out = await verifyAndFinalize({
      taskId: 'tsk_off3',
      answerText: 'unchanged answer',
    });
    expect(out.verification).toBeNull();
    expect(out.finalText).toBe('unchanged answer');
  });

  it('persistExecution returns false (nothing to write)', async () => {
    const fakeDb = {
      update: vi.fn(),
    } as unknown as Parameters<typeof persistExecution>[0]['db'];
    const ok = await persistExecution({
      taskId: 'tsk_off4',
      verification: null,
      db: fakeDb,
    });
    expect(ok).toBe(false);
    expect(fakeDb.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 2 — only Ledger flag on
// ---------------------------------------------------------------------------

describe('only EVIDENCE_LEDGER on', () => {
  beforeEach(() => {
    setFeatureFlagsForTest({ EVIDENCE_LEDGER: true });
  });

  it('initExecution creates a ledger and seeds the user_input fact', () => {
    const out = initExecution({
      taskId: 'tsk_l1',
      intent: 'translate this',
      executionMode: 'generate',
    });
    expect(out.ledger).not.toBeNull();
    expect(out.contract).toBeNull();
    const ledger = getLedger('tsk_l1')!;
    expect(ledger.size).toBe(1);
    expect(ledger.entries[0]!.sourceType).toBe('user_input');
    expect(ledger.entries[0]!.fact).toBe('translate this');
  });

  it('recordEvidence appends to the ledger', () => {
    initExecution({ taskId: 'tsk_l2', intent: 'x', executionMode: 'generate' });
    recordEvidence('tsk_l2', {
      fact: 'response_length=120',
      sourceType: 'tool_result',
      sourceDetail: 'llm_generate_response',
      confidence: 'observed',
    });
    expect(getLedger('tsk_l2')!.size).toBe(2); // intent + response_length
  });

  it('verifyAndFinalize STILL no-ops when verifier flag is off', async () => {
    initExecution({ taskId: 'tsk_l3', intent: 'x', executionMode: 'generate' });
    const out = await verifyAndFinalize({
      taskId: 'tsk_l3',
      answerText: 'whatever',
    });
    expect(out.verification).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Case 3 — all on + generate (checklist tier) happy path
// ---------------------------------------------------------------------------

describe('all flags on — generate happy path', () => {
  beforeEach(() => flagsAllOn());

  it('runs deterministic verifier and passes for a complete answer', async () => {
    initExecution({
      taskId: 'tsk_g1',
      intent: 'translate this',
      executionMode: 'generate',
    });
    recordEvidence('tsk_g1', {
      fact: 'response_length=78',
      sourceType: 'tool_result',
      sourceDetail: 'llm_generate_response',
      confidence: 'observed',
    });
    const out = await verifyAndFinalize({
      taskId: 'tsk_g1',
      answerText: 'Today the weather is really nice and the build is green and the tests are passing.',
    });
    expect(out.verification).not.toBeNull();
    expect(out.verification!.passed).toBe(true);
    expect(out.verification!.tier).toBe('deterministic');
    expect(out.finalText).toContain('Today the weather');
  });

  it('marks research with only a missing-source verifier failure as partial', async () => {
    initExecution({
      taskId: 'tsk_g2',
      intent: '研究 2026 年 AI 行业趋势',
      executionMode: 'generate',
    });
    recordEvidence('tsk_g2', {
      fact: 'response_length=120',
      sourceType: 'tool_result',
      sourceDetail: 'llm_generate_response',
      confidence: 'observed',
    });

    const out = await verifyAndFinalize({
      taskId: 'tsk_g2',
      answerText:
        'AI 行业正在从通用模型竞争转向推理效率、智能体执行和企业落地。' +
        '未来一年，成本控制、数据治理和监管合规会成为商业化的重要约束。',
    });

    expect(out.verification?.passed).toBe(false);
    expect(out.verification?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionType: 'url_count',
          passed: false,
        }),
      ]),
    );
    const sourceTrust = assessResultTrust({
      intent: '研究 2026 年 AI 行业趋势',
      resultText: out.finalText,
    });
    expect(deriveFinalStatus('completed', out.verification, sourceTrust)).toBe(
      'partial_success',
    );
  });
});

// ---------------------------------------------------------------------------
// Case 4 — all on + URL fabrication → fixable → autoFix → passes
// ---------------------------------------------------------------------------

describe('all flags on — URL fabrication autoFix loop', () => {
  beforeEach(() => flagsAllOn());

  it('fabricated URL with a similar grounded → substituted, recheck passes', async () => {
    initExecution({
      taskId: 'tsk_f1',
      intent: 'find the help page',
      executionMode: 'generate',
    });
    recordEvidence('tsk_f1', {
      fact: 'visited https://example.com/help/index',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const dirtyAnswer =
      'See https://example.com/help/wrong-page for the canonical doc. Plus more text to clear word_count.';
    const out = await verifyAndFinalize({
      taskId: 'tsk_f1',
      answerText: dirtyAnswer,
    });
    expect(out.verification).not.toBeNull();
    expect(out.verification!.passed).toBe(true);
    expect(out.finalText).toContain('https://example.com/help/index');
    expect(out.finalText).not.toContain('wrong-page');
    // The verification record retains the autoFix annotation.
    const fixOps = out.verification!.checks.filter((c) =>
      c.criterionId.startsWith('autoFix.'),
    );
    expect(fixOps.length).toBeGreaterThan(0);
    expect(fixOps[0]!.criterionId).toBe('autoFix.url_substitute');
  });

  it('fabricated URL with no similar grounded → drop placeholder', async () => {
    // Codex Round 2 P0-1 follow-up — keep the intent free of any
    // keyword that Pack A1's classifyIntentForOutputRequirement
    // would route to `general_with_links` (cite / 引用 / 来源 etc.).
    // Otherwise the contract picks up a url_count >= 1 criterion
    // that fails right after autoFix drops the only URL — the
    // verifier verdict no longer reflects the drop-placeholder
    // path under test.
    initExecution({
      taskId: 'tsk_f2',
      intent: 'translate the phrase',
      executionMode: 'generate',
    });
    recordEvidence('tsk_f2', {
      fact: 'visited https://example.com/help',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const out = await verifyAndFinalize({
      taskId: 'tsk_f2',
      answerText:
        'Citation: https://totally-unrelated.example.org/x. ' + 'x'.repeat(60),
    });
    // Phase 1 follow-up: url_drop now removes the fabricated URL
    // entirely (no placeholder text). The recheck passes because
    // no URLs remain in the answer for the grounding rule to flag.
    expect(out.finalText).not.toContain('totally-unrelated.example.org');
    expect(out.finalText).not.toContain('[未验证');
    expect(out.verification!.passed).toBe(true);
  });

  it('explicit source-link tasks fail closed when autoFix removes the only URL', async () => {
    initExecution({
      taskId: 'tsk_f3',
      intent: '帮我查今天特斯拉股价并给出来源链接',
      executionMode: 'generate',
    });
    recordEvidence('tsk_f3', {
      fact: 'visited https://finance.example.com/quote/TSLA',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });

    const out = await verifyAndFinalize({
      taskId: 'tsk_f3',
      answerText:
        '特斯拉当前股价为 123.45 美元，来源：https://totally-unrelated.example.org/tsla。' +
        '请以交易所实时行情为准。',
    });

    expect(out.finalText).not.toContain('totally-unrelated.example.org');
    expect(out.verification!.passed).toBe(false);
    expect(out.verification!.failureLevel).toBe('fixable');
    expect(out.verification!.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionType: 'url_count',
          passed: false,
        }),
      ]),
    );
    expect(deriveFinalStatus('completed', out.verification)).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Case 5 — fixable but autoFix can't fix → demoted to needs_clarification
// ---------------------------------------------------------------------------

describe('fixable demotion when autoFix produces no ops', () => {
  beforeEach(() => flagsAllOn());

  it('answer too short → fixable but autoFix cannot extend → demoted', async () => {
    initExecution({
      taskId: 'tsk_d1',
      intent: 'something',
      executionMode: 'generate',
    });
    const out = await verifyAndFinalize({
      taskId: 'tsk_d1',
      answerText: 'too short',
    });
    expect(out.verification!.passed).toBe(false);
    expect(out.verification!.failureLevel).toBe('needs_clarification');
    expect(out.finalText).not.toBe('too short');
    expect(out.finalText).toContain('未能给出可验证的结果');
    expect(out.finalText).toContain('已保留的中间结果');
    expect(out.finalText).toContain('too short');
    expect(deriveFinalStatus('completed', out.verification)).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Case 6 — full tier triggers LLM verifier
// ---------------------------------------------------------------------------

describe('full tier triggers LLM verifier', () => {
  beforeEach(() => flagsAllOn());

  it('deterministic passes → LLM tier called → final passed=true', async () => {
    initExecution({
      taskId: 'tsk_full1',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin-livestream-review',
      requiredInputs: [
        { name: 'GMV', description: '总成交额', provided: true },
        { name: '客单价', description: '人均下单金额', provided: true },
      ],
    });
    recordEvidence('tsk_full1', {
      fact: 'parsed: GMV=100000 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const client = makeStubClient('{"passed":true,"issues":[]}');
    const answerText =
      '本场 GMV ¥100000，客单价 ¥80。' + 'x'.repeat(220);
    const out = await verifyAndFinalize({
      taskId: 'tsk_full1',
      answerText,
      client,
    });
    expect(out.verification!.tier).toBe('llm');
    expect(out.verification!.passed).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('deterministic passes → LLM finds an issue → returns LLM verdict', async () => {
    initExecution({
      taskId: 'tsk_full2',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [{ name: 'GMV', description: 't', provided: true }],
    });
    recordEvidence('tsk_full2', {
      fact: 'parsed: GMV=100000',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const client = makeStubClient(
      '{"passed":false,"issues":[{"criterion_id":"q","problem":"内容深度不够","fixable":false}]}',
    );
    const out = await verifyAndFinalize({
      taskId: 'tsk_full2',
      answerText: '本场 GMV ¥100000 表现不错。' + 'x'.repeat(220),
      client,
    });
    expect(out.verification!.tier).toBe('llm');
    expect(out.verification!.passed).toBe(false);
    expect(out.verification!.failureLevel).toBe('needs_clarification');
  });
});

// ---------------------------------------------------------------------------
// Case 7 — constraint violation → hard_fail (no fix attempt)
// ---------------------------------------------------------------------------

describe('constraint violation hard_fail', () => {
  beforeEach(() => flagsAllOn());

  it('form_submit detected in browser_state → hard_fail, unverified text hidden', async () => {
    initExecution({
      taskId: 'tsk_hf',
      intent: '搜索',
      executionMode: 'browser',
      targetDomain: 'example.com',
      // Light tier auto-includes no_form_submit.
    });
    recordEvidence('tsk_hf', {
      fact: 'navigated to https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    recordEvidence('tsk_hf', {
      fact: 'submitted form on /search',
      sourceType: 'browser_state',
      sourceDetail: 'submit',
      confidence: 'observed',
    });
    const out = await verifyAndFinalize({
      taskId: 'tsk_hf',
      answerText: 'Did the search.',
      finalUrl: 'https://example.com/',
    });
    expect(out.verification!.passed).toBe(false);
    expect(out.verification!.failureLevel).toBe('hard_fail');
    expect(out.finalText).not.toContain('Did the search.');
    expect(out.finalText).toContain('未能给出可验证的结果');
    expect(out.finalText).toContain('原因：');
  });
});

// ---------------------------------------------------------------------------
// Case 8 — persistence writes the 5 columns
// ---------------------------------------------------------------------------

describe('persistExecution writes the 5 columns', () => {
  beforeEach(() => flagsAllOn());

  it('passes contract / evidence / verification snapshots through to db.update', async () => {
    initExecution({
      taskId: 'tsk_p1',
      intent: 'translate',
      executionMode: 'generate',
    });
    recordEvidence('tsk_p1', {
      fact: 'response_length=80',
      sourceType: 'tool_result',
      sourceDetail: 'llm_generate_response',
      confidence: 'observed',
    });
    const v = await verifyAndFinalize({
      taskId: 'tsk_p1',
      answerText: 'A long enough answer to pass word_count threshold easily here.',
    });
    expect(v.verification!.passed).toBe(true);

    const setFn = vi.fn((_arg: Record<string, unknown>) => ({
      where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])),
    }));
    const fakeDb = { update: vi.fn(() => ({ set: setFn })) } as unknown as Parameters<
      typeof persistExecution
    >[0]['db'];

    const ok = await persistExecution({
      taskId: 'tsk_p1',
      verification: v.verification,
      db: fakeDb,
    });
    expect(ok).toBe(true);
    expect(fakeDb.update).toHaveBeenCalledTimes(1);
    const setArg = setFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.contractJson).toBeTruthy();
    expect(setArg.evidenceJson).toBeTruthy();
    expect(setArg.verificationJson).toBeTruthy();
    expect(setArg.verificationPassed).toBe(true);
    expect(setArg.failureLevel).toBeNull();
  });

  it('writes failureLevel when verification failed', async () => {
    initExecution({
      taskId: 'tsk_p2',
      intent: 'x',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    recordEvidence('tsk_p2', {
      fact: 'navigated to https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    recordEvidence('tsk_p2', {
      fact: 'submitted form on /search',
      sourceType: 'browser_state',
      sourceDetail: 'submit',
      confidence: 'observed',
    });
    const v = await verifyAndFinalize({
      taskId: 'tsk_p2',
      answerText: 'whatever',
      finalUrl: 'https://example.com/',
    });
    const setFn = vi.fn((_arg: Record<string, unknown>) => ({
      where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])),
    }));
    const fakeDb = { update: vi.fn(() => ({ set: setFn })) } as unknown as Parameters<
      typeof persistExecution
    >[0]['db'];
    await persistExecution({
      taskId: 'tsk_p2',
      verification: v.verification,
      db: fakeDb,
    });
    const setArg = setFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg.verificationPassed).toBe(false);
    expect(setArg.failureLevel).toBe('hard_fail');
  });

  it('returns false when the terminal-status guard refuses the update', async () => {
    initExecution({
      taskId: 'tsk_p3',
      intent: 'translate',
      executionMode: 'generate',
    });
    recordEvidence('tsk_p3', {
      fact: 'response_length=80',
      sourceType: 'tool_result',
      sourceDetail: 'llm_generate_response',
      confidence: 'observed',
    });

    const setFn = vi.fn((_arg: Record<string, unknown>) => ({
      where: vi.fn(() => Promise.resolve([{ affectedRows: 0 }])),
    }));
    const fakeDb = { update: vi.fn(() => ({ set: setFn })) } as unknown as Parameters<
      typeof persistExecution
    >[0]['db'];

    const ok = await persistExecution({
      taskId: 'tsk_p3',
      verification: null,
      db: fakeDb,
    });

    expect(ok).toBe(false);
    expect(fakeDb.update).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Case 9 — persist DB failure is non-blocking
// ---------------------------------------------------------------------------

describe('persistExecution non-blocking on db error', () => {
  beforeEach(() => flagsAllOn());

  it('returns false when db.update throws, does not propagate', async () => {
    initExecution({
      taskId: 'tsk_nb1',
      intent: 'x',
      executionMode: 'generate',
    });
    const fakeDb = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.reject(new Error('connection lost'))),
        })),
      })),
    } as unknown as Parameters<typeof persistExecution>[0]['db'];
    const warnFn = vi.fn();
    const logger = {
      warn: warnFn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: () => logger,
    } as unknown as Parameters<typeof persistExecution>[0]['logger'];
    const ok = await persistExecution({
      taskId: 'tsk_nb1',
      verification: null,
      db: fakeDb,
      logger,
    });
    expect(ok).toBe(false);
    expect(warnFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bonus — disposeExecution + LLM verifier throw resilience
// ---------------------------------------------------------------------------

describe('disposeExecution + resilience', () => {
  beforeEach(() => flagsAllOn());

  it('dispose clears both registries (idempotent)', () => {
    initExecution({
      taskId: 'tsk_dx',
      intent: 'x',
      executionMode: 'generate',
    });
    expect(getContract('tsk_dx')).toBeDefined();
    expect(getLedger('tsk_dx')).toBeDefined();
    disposeExecution('tsk_dx');
    expect(getContract('tsk_dx')).toBeUndefined();
    expect(getLedger('tsk_dx')).toBeUndefined();
    // Idempotent — second call does not throw.
    disposeExecution('tsk_dx');
  });

  it('catches a throwing LLM client and falls through to deterministic verdict', async () => {
    initExecution({
      taskId: 'tsk_thr',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [{ name: 'GMV', description: 't', provided: true }],
    });
    recordEvidence('tsk_thr', {
      fact: 'parsed: GMV=100000',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    // Client whose .create throws synchronously — verifyWithLlm
    // already catches it and returns a non-blocking pass; the
    // pipeline falls through cleanly either way.
    const client: AnthropicLikeClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('upstream 503')),
      },
    };
    const out = await verifyAndFinalize({
      taskId: 'tsk_thr',
      answerText: '本场 GMV ¥100000 ' + 'x'.repeat(220),
      client,
    });
    // The LLM tier returned the non-blocking pass, so verification
    // is `passed: true` from the LLM fallback path.
    expect(out.verification!.passed).toBe(true);
    expect(out.verification!.tier).toBe('llm');
    const fb = out.verification!.checks.find((c) => c.criterionId === 'llm.fallback');
    expect(fb).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Codex Round 2 P1-5 — recheckPostFormat
// ---------------------------------------------------------------------------

describe('recheckPostFormat — formatter-induced regressions', () => {
  it('no-op when before === after (formatter passed through)', () => {
    const text = '答案：xxx';
    const res = recheckPostFormat(text, text);
    expect(res.downgrade).toBe(false);
    expect(res.reason).toBeNull();
  });

  it('flags downgrade when item count drops', () => {
    const before = [
      '```json',
      '{"items":[{"name":"A","price":1,"url":"https://a.com"},{"name":"B","price":2,"url":"https://b.com"}]}',
      '```',
    ].join('\n');
    const after = [
      '```json',
      '{"items":[{"name":"A","price":1,"url":"https://a.com"}]}',
      '```',
    ].join('\n');
    const res = recheckPostFormat(before, after);
    expect(res.downgrade).toBe(true);
    expect(res.reason).toContain('结构化结果数减少');
    expect(res.reason).toContain('2 → 1');
  });

  it('flags downgrade when URL count drops (prose path, no structured items)', () => {
    const before = '答案：参考 https://a.com 与 https://b.com';
    const after = '答案：参考 https://a.com';
    const res = recheckPostFormat(before, after);
    expect(res.downgrade).toBe(true);
    expect(res.reason).toContain('链接数减少');
  });

  it('does not flag when content actually grew (cosmetic re-format)', () => {
    const before = '1. iPhone ¥6999 https://a.com\n2. iPad ¥4999 https://b.com';
    const after = '推荐如下：\n1. iPhone ¥6999 https://a.com\n2. iPad ¥4999 https://b.com\n\n以上数据更新于 2026 年。';
    const res = recheckPostFormat(before, after);
    expect(res.downgrade).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Codex Round 2 P1-6 — extractFailedChecks
// ---------------------------------------------------------------------------

describe('extractFailedChecks — surfaces criterionType for SPA banner', () => {
  it('returns empty when all checks passed', () => {
    const out = extractFailedChecks({
      taskId: 'tsk_x',
      passed: true,
      tier: 'deterministic',
      checks: [
        {
          criterionId: 'c1',
          criterionType: 'url_count',
          passed: true,
          checker: 'deterministic',
          detail: 'ok',
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('uses criterionType when present', () => {
    const out = extractFailedChecks({
      taskId: 'tsk_x',
      passed: false,
      tier: 'deterministic',
      checks: [
        {
          criterionId: 'abc-123',
          criterionType: 'url_count',
          passed: false,
          checker: 'deterministic',
          detail: 'only 0 URL(s) found, need at least 1',
        },
        {
          criterionId: 'xyz-456',
          criterionType: 'price_sort',
          passed: false,
          checker: 'deterministic',
          detail: 'asc order broken at position 2',
        },
      ],
    });
    expect(out).toEqual([
      { type: 'url_count', detail: 'only 0 URL(s) found, need at least 1' },
      { type: 'price_sort', detail: 'asc order broken at position 2' },
    ]);
  });

  it('falls back to generic.* criterionId when no criterionType', () => {
    const out = extractFailedChecks({
      taskId: 'tsk_x',
      passed: false,
      tier: 'deterministic',
      checks: [
        {
          criterionId: 'generic.empty_result',
          passed: false,
          checker: 'deterministic',
          detail: 'meaningful answer length 5',
        },
      ],
    });
    expect(out).toEqual([{ type: 'generic.empty_result', detail: 'meaningful answer length 5' }]);
  });

  it('marks unknown criterionId as "unknown"', () => {
    const out = extractFailedChecks({
      taskId: 'tsk_x',
      passed: false,
      tier: 'deterministic',
      checks: [
        {
          criterionId: 'abc-xyz',
          passed: false,
          checker: 'deterministic',
          detail: 'something broke',
        },
      ],
    });
    expect(out).toEqual([{ type: 'unknown', detail: 'something broke' }]);
  });
});
