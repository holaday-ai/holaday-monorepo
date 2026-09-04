import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { VerificationResult } from '../execution/answer-verifier.js';
import {
  isVerifierFallbackEnabled,
  shouldTrigger,
  verifyFallback,
} from './openai-verifier-fallback.js';

const DETERMINISTIC_FAIL: VerificationResult = {
  taskId: 'tsk_dormant',
  passed: false,
  tier: 'deterministic',
  checks: [
    {
      criterionId: 'source',
      passed: false,
      checker: 'deterministic',
      detail: 'source missing',
      severity: 'fixable',
    },
  ],
  failureLevel: 'fixable',
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
} as unknown as Logger;

describe('dormant OpenAI verifier fallback', () => {
  it('cannot be enabled even when legacy flags and credentials are present', () => {
    expect(
      isVerifierFallbackEnabled({
        OPENAI_VERIFIER_FALLBACK_ENABLED: 'true',
        OPENAI_API_KEY: 'synthetic-key',
      }),
    ).toBe(false);
  });

  it('never calls the legacy client and preserves the original failure', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"verdict":"agree"}' } }],
    });
    const result = await verifyFallback(
      {
        original: DETERMINISTIC_FAIL,
        answerText: 'PRIVATE_USER_TEXT',
        contractGoal: 'PRIVATE_GOAL',
      },
      {
        logger,
        openaiClient: { chat: { completions: { create } } },
      },
      {
        OPENAI_VERIFIER_FALLBACK_ENABLED: 'true',
        OPENAI_API_KEY: 'synthetic-key',
      },
    );

    expect(create).not.toHaveBeenCalled();
    expect(result.verification).toBe(DETERMINISTIC_FAIL);
    expect(result.verification.passed).toBe(false);
    expect(result.metadata).toMatchObject({
      triggered: false,
      fallbackReason: 'flag_off',
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_USER_TEXT|PRIVATE_GOAL/);
  });

  it('keeps trigger classification pure but unreachable from production', () => {
    expect(shouldTrigger(DETERMINISTIC_FAIL)).toBe('deterministic_uncertain');
  });
});
