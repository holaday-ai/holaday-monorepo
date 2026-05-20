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
  disposeExecution,
  getContract,
  initExecution,
  persistExecution,
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

  it('form_submit detected in browser_state → hard_fail, text untouched', async () => {
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
    expect(out.finalText).toBe('Did the search.');
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
      where: vi.fn(() => Promise.resolve()),
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
      where: vi.fn(() => Promise.resolve()),
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
