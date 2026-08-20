import { describe, expect, it } from 'vitest';

import { type EvalTaskDetail, validateEvalExpectations } from './eval-expectations.js';
import type { EvalExpectations } from './eval-suite.js';

function completedDetail(verificationPassed: boolean | null): EvalTaskDetail {
  return {
    taskId: 'tsk_eval',
    intent: '翻译一句话',
    status: 'completed',
    awaitingKind: null,
    awaitingQuestion: null,
    errorCode: null,
    errorMessage: null,
    result: { summary: 'Translated text' },
    planText: null,
    steps: [],
    verificationPassed,
  };
}

const verifiedCompletionExpectation = {
  mustComplete: true,
  terminalStatus: 'completed',
  verificationMustPass: true,
} satisfies EvalExpectations;

describe('validateEvalExpectations', () => {
  it.each([
    ['failed', false],
    ['missing', null],
  ] as const)(
    'rejects a completed task when required verification is %s',
    (_label, verificationPassed) => {
      const failures = validateEvalExpectations(
        completedDetail(verificationPassed),
        verifiedCompletionExpectation,
        '',
        'generate',
      );

      expect(failures).toEqual([
        `verificationMustPass: expected true, got ${String(verificationPassed)}`,
      ]);
    },
  );

  it('accepts a completed task when required verification passed', () => {
    expect(
      validateEvalExpectations(
        completedDetail(true),
        verifiedCompletionExpectation,
        '',
        'generate',
      ),
    ).toEqual([]);
  });
});
