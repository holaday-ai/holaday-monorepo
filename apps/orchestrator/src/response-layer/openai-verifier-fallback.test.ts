/**
 * Optimization #2b — VerifierFallback unit tests.
 *
 * Covers:
 *   - isVerifierFallbackEnabled: flag parsing + API key requirement
 *   - shouldTrigger: deterministic_uncertain / llm_passed_with_issues /
 *     no-trigger paths
 *   - verifyFallback:
 *       * flag off → no API call, fallbackReason=flag_off
 *       * no trigger → no API call, fallbackReason=no_trigger
 *       * timeout / api_error → keep ORIGINAL verdict (no auto-improve)
 *       * empty / invalid JSON → keep original
 *       * verdict=agree → keep original (fallbackReason=agreed)
 *       * verdict=disagree → augmented: passed=false, fallback check
 *         appended, failureLevel=needs_clarification
 *       * upstream verdict tier preserved on augment
 */

import { describe, expect, it, vi } from 'vitest';
import type { VerificationResult } from '../execution/answer-verifier.js';
import {
  ANSWER_TRUNCATE_CHARS,
  DEFAULT_VERIFIER_FALLBACK_MODEL,
  isVerifierFallbackEnabled,
  shouldTrigger,
  verifyFallback,
} from './openai-verifier-fallback.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeFakeOpenAI(content: string | (() => Promise<string>)) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const c = typeof content === 'string' ? content : await content();
          return { choices: [{ message: { content: c } }] };
        }),
      },
    },
  };
}

function detFailFixable(): VerificationResult {
  // Deterministic verifier failed with one fixable severity check —
  // the canonical "uncertain" path that warrants a second opinion.
  return {
    taskId: 'tsk_test',
    passed: false,
    tier: 'deterministic',
    checks: [
      {
        criterionId: 'url_grounding',
        passed: false,
        checker: 'deterministic',
        detail: 'URL not in ledger — possibly fabricated',
        severity: 'fixable',
      },
    ],
    failureLevel: 'fixable',
  };
}

function detFailHardOnly(): VerificationResult {
  return {
    taskId: 'tsk_test',
    passed: false,
    tier: 'deterministic',
    checks: [
      {
        criterionId: 'constraint_violation',
        passed: false,
        checker: 'deterministic',
        detail: 'Action attempted form submit but constraint forbids it',
        severity: 'hard_fail',
      },
    ],
    failureLevel: 'hard_fail',
  };
}

function llmPassedWithIssues(): VerificationResult {
  return {
    taskId: 'tsk_test',
    passed: true,
    tier: 'llm',
    checks: [
      {
        criterionId: 'main_question_answered',
        passed: true,
        checker: 'llm',
        detail: 'Answer covers the main question',
      },
      {
        criterionId: 'source_grounding',
        passed: false,
        checker: 'llm',
        detail: '1 of 3 sources looks loosely supported',
      },
    ],
  };
}

function llmCleanPass(): VerificationResult {
  return {
    taskId: 'tsk_test',
    passed: true,
    tier: 'llm',
    checks: [
      {
        criterionId: 'main_question_answered',
        passed: true,
        checker: 'llm',
        detail: 'OK',
      },
    ],
  };
}

describe('isVerifierFallbackEnabled', () => {
  it('flag off → false', () => {
    expect(isVerifierFallbackEnabled({ OPENAI_VERIFIER_FALLBACK_ENABLED: 'false', OPENAI_API_KEY: 'sk-x' })).toBe(false);
  });
  it('flag on, no API key → false', () => {
    expect(isVerifierFallbackEnabled({ OPENAI_VERIFIER_FALLBACK_ENABLED: 'true' })).toBe(false);
  });
  it('flag on + key → true', () => {
    expect(isVerifierFallbackEnabled({ OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
  it('"1" works as truthy', () => {
    expect(isVerifierFallbackEnabled({ OPENAI_VERIFIER_FALLBACK_ENABLED: '1', OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
  it('default (env empty) → false (Codex P2 — feature off by default)', () => {
    expect(isVerifierFallbackEnabled({})).toBe(false);
  });
});

describe('shouldTrigger', () => {
  it('deterministic soft-fail with fixable → deterministic_uncertain', () => {
    expect(shouldTrigger(detFailFixable())).toBe('deterministic_uncertain');
  });
  it('deterministic hard-fail only (no fixable) → null', () => {
    expect(shouldTrigger(detFailHardOnly())).toBeNull();
  });
  it('deterministic pass → null', () => {
    const v = detFailFixable();
    v.passed = true;
    expect(shouldTrigger(v)).toBeNull();
  });
  it('llm passed but a check failed → llm_passed_with_issues', () => {
    expect(shouldTrigger(llmPassedWithIssues())).toBe('llm_passed_with_issues');
  });
  it('llm clean pass → null', () => {
    expect(shouldTrigger(llmCleanPass())).toBeNull();
  });
  it('llm failed (not pass-with-issues) → null', () => {
    const v = llmPassedWithIssues();
    v.passed = false;
    expect(shouldTrigger(v)).toBeNull();
  });
});

describe('verifyFallback — runtime', () => {
  const baseReq = (original: VerificationResult) => ({
    original,
    answerText: 'Some answer body with enough detail to be plausible',
    contractGoal: 'Test the verifier fallback',
  });

  it('flag off → no API call, original returned, fallbackReason=flag_off', async () => {
    const client = makeFakeOpenAI('SHOULD NEVER FIRE');
    const r = await verifyFallback(
      baseReq(detFailFixable()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'false', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.verification).toBe(detFailFixable() ? r.verification : null);
    expect(r.metadata.triggered).toBe(false);
    expect(r.metadata.fallbackReason).toBe('flag_off');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('flag on but no trigger → no API call, fallbackReason=no_trigger', async () => {
    const client = makeFakeOpenAI('SHOULD NEVER FIRE');
    const r = await verifyFallback(
      baseReq(llmCleanPass()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.triggered).toBe(false);
    expect(r.metadata.fallbackReason).toBe('no_trigger');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('agree verdict → keep original verification (fallbackReason=agreed)', async () => {
    const client = makeFakeOpenAI(JSON.stringify({ verdict: 'agree' }));
    const original = llmPassedWithIssues();
    const r = await verifyFallback(
      baseReq(original),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.verification).toEqual(original);
    expect(r.metadata.triggered).toBe(true);
    expect(r.metadata.triggerReason).toBe('llm_passed_with_issues');
    expect(r.metadata.fallbackReason).toBe('agreed');
  });

  it('disagree verdict → augment: passed=false + new check + failureLevel=needs_clarification', async () => {
    const client = makeFakeOpenAI(
      JSON.stringify({
        verdict: 'disagree',
        reasons: ['Source 2 contradicts the GMV figure', 'Final number unverified'],
        suggestedFix: 'Re-verify the GMV against the platform export',
      }),
    );
    const r = await verifyFallback(
      baseReq(llmPassedWithIssues()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.verification.passed).toBe(false);
    expect(r.verification.failureLevel).toBe('needs_clarification');
    // Original 2 checks + 1 fallback-injected check.
    expect(r.verification.checks).toHaveLength(3);
    const last = r.verification.checks[r.verification.checks.length - 1];
    expect(last?.criterionId).toBe('verifier_fallback');
    expect(last?.passed).toBe(false);
    expect(last?.severity).toBe('needs_clarification');
    expect(last?.detail).toMatch(/Source 2 contradicts/);
    expect(r.verification.suggestedFix).toMatch(/Re-verify the GMV/);
    // Tier preserved — fallback annotates, doesn't replace.
    expect(r.verification.tier).toBe('llm');
    expect(r.metadata.fallbackReason).toBeUndefined();
  });

  it('disagree on deterministic soft-fail → also augments correctly', async () => {
    const client = makeFakeOpenAI(
      JSON.stringify({
        verdict: 'disagree',
        reasons: ['URL pattern looks fabricated and lacks evidence'],
      }),
    );
    const r = await verifyFallback(
      baseReq(detFailFixable()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.verification.passed).toBe(false);
    expect(r.verification.failureLevel).toBe('needs_clarification');
    expect(r.verification.tier).toBe('deterministic');
  });

  it('timeout → keep ORIGINAL verdict, fallbackReason=timeout (no auto-improve)', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error('Request timeout after 8000ms');
          }),
        },
      },
    };
    const original = detFailFixable();
    const r = await verifyFallback(
      baseReq(original),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.verification).toEqual(original);
    expect(r.verification.passed).toBe(false);
    expect(r.metadata.fallbackReason).toBe('timeout');
    expect(r.metadata.triggered).toBe(true);
  });

  it('generic API error → fallbackReason=api_error, original preserved', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error('429 rate limited');
          }),
        },
      },
    };
    const r = await verifyFallback(
      baseReq(detFailFixable()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('api_error');
  });

  it('empty output → fallbackReason=empty_output, original preserved', async () => {
    const client = makeFakeOpenAI('   \n');
    const r = await verifyFallback(
      baseReq(detFailFixable()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('empty_output');
  });

  it('invalid JSON response → fallbackReason=invalid_response, original preserved', async () => {
    const client = makeFakeOpenAI('this is not JSON at all, just chat noise');
    const r = await verifyFallback(
      baseReq(detFailFixable()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('invalid_response');
    expect(r.verification.passed).toBe(false); // original verdict preserved
  });

  it('disagree WITHOUT reasons → treated as invalid (no blind flip)', async () => {
    // Spec: reasons[] is required when disagreeing. Empty reasons →
    // parse returns null → invalid_response. We refuse to flip
    // pass→fail without an explanation.
    const client = makeFakeOpenAI(JSON.stringify({ verdict: 'disagree' }));
    const original = llmPassedWithIssues();
    const r = await verifyFallback(
      baseReq(original),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('invalid_response');
    expect(r.verification).toEqual(original);
  });

  it('response wrapped in ```json fence → still parsed correctly', async () => {
    const client = makeFakeOpenAI(
      '```json\n{"verdict": "agree"}\n```',
    );
    const r = await verifyFallback(
      baseReq(llmPassedWithIssues()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('agreed');
  });

  it('long answer is truncated in the OpenAI prompt payload', async () => {
    const longAnswer = 'a'.repeat(ANSWER_TRUNCATE_CHARS + 100);
    const client = makeFakeOpenAI(JSON.stringify({ verdict: 'agree' }));
    await verifyFallback(
      { ...baseReq(llmPassedWithIssues()), answerText: longAnswer },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    // Inspect the user message that was sent. Cast through unknown
    // because the mock's calls tuple is typed as `[]` when the
    // helper builder elides parameter types.
    const calls = client.chat.completions.create.mock.calls as unknown as Array<
      [{ messages: { role: string; content: string }[] }]
    >;
    const call = calls[0]?.[0];
    expect(call).toBeDefined();
    const userMsg = call?.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toMatch(/\[\.\.\.truncated\]/);
  });

  it('uses configured model (defaults to gpt-4o-mini)', async () => {
    const client = makeFakeOpenAI(JSON.stringify({ verdict: 'agree' }));
    const r = await verifyFallback(
      baseReq(llmPassedWithIssues()),
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_VERIFIER_FALLBACK_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.model).toBe(DEFAULT_VERIFIER_FALLBACK_MODEL);
  });
});
