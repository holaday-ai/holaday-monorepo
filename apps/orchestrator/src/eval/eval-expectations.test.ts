import { describe, expect, it } from 'vitest';

import {
  type EvalAcceptanceSnapshot,
  type EvalTaskDetail,
  validateEvalExpectations,
} from './eval-expectations.js';
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

  it('rejects completed work when persisted evidence, files, or browser actions are missing', () => {
    const expectations = {
      ...verifiedCompletionExpectation,
      minEvidenceEntries: 2,
      requiredEvidenceSourceTypes: ['tool_result'],
      minOutputFiles: 1,
      requiredOutputMimeTypes: ['application/pdf'],
      requiredActionCaptureTypes: ['navigate', 'click'],
    } satisfies EvalExpectations;
    const snapshot: EvalAcceptanceSnapshot = {
      evidenceEntryCount: 1,
      evidenceSourceTypeCounts: { user_input: 1 },
      outputFileCount: 0,
      outputMimeTypeCounts: {},
      actionCaptureTypeCounts: { navigate: 1 },
    };

    expect(
      validateEvalExpectations(completedDetail(true), expectations, '', 'browser', snapshot),
    ).toEqual([
      'minEvidenceEntries: expected >= 2, got 1',
      'requiredEvidenceSourceTypes: missing tool_result',
      'minOutputFiles: expected >= 1, got 0',
      'requiredOutputMimeTypes: missing application/pdf',
      'requiredActionCaptureTypes: missing click',
    ]);
  });

  it('accepts persisted aggregate evidence without reading raw evidence values', () => {
    const expectations = {
      ...verifiedCompletionExpectation,
      minEvidenceEntries: 2,
      requiredEvidenceSourceTypes: ['tool_result'],
      minOutputFiles: 1,
      requiredOutputMimeTypes: ['application/pdf'],
      requiredActionCaptureTypes: ['navigate', 'click'],
    } satisfies EvalExpectations;
    const snapshot: EvalAcceptanceSnapshot = {
      evidenceEntryCount: 2,
      evidenceSourceTypeCounts: { user_input: 1, tool_result: 1 },
      outputFileCount: 1,
      outputMimeTypeCounts: { 'application/pdf': 1 },
      actionCaptureTypeCounts: { navigate: 1, click: 1 },
    };

    expect(
      validateEvalExpectations(completedDetail(true), expectations, '', 'browser', snapshot),
    ).toEqual([]);
  });
});
