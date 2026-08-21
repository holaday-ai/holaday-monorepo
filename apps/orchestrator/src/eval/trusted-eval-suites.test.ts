import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { EvalCase } from './eval-suite.js';

function readSuite(name: string): EvalCase[] {
  const suitePath = fileURLToPath(new URL(`./eval-cases/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(suitePath, 'utf8')) as EvalCase[];
}

describe.each(['p0-smoke', 'p1-regression'])('%s trust contract', (suiteName) => {
  it('requires verifier approval for every case that claims completion', () => {
    const unverifiedCompletionCases = readSuite(suiteName)
      .filter((testCase) => testCase.expectations.mustComplete)
      .filter((testCase) => testCase.expectations.verificationMustPass !== true)
      .map((testCase) => testCase.id);

    expect(unverifiedCompletionCases).toEqual([]);
  });
});

const p2CompletedCaseIds = {
  'p2-content-topic': [
    'P2_CT_001',
    'P2_CT_004',
    'P2_CT_005',
    'P2_CT_006',
    'P2_CT_007',
    'P2_CT_008',
  ],
  'p2-ecom-daily': ['P2_ED_001', 'P2_ED_003', 'P2_ED_006', 'P2_ED_007', 'P2_ED_008'],
  'p2-douyin-review': ['P2_DR_001', 'P2_DR_005', 'P2_DR_006', 'P2_DR_008'],
} as const;

describe.each(Object.entries(p2CompletedCaseIds))(
  '%s professional-workflow trust contract',
  (suiteName, expectedCompletedIds) => {
    it('requires verified completion backed by persisted user input', () => {
      const completedCases = readSuite(suiteName).filter(
        (testCase) => testCase.expectations.mustComplete,
      );

      expect(completedCases.map((testCase) => testCase.id)).toEqual(expectedCompletedIds);
      for (const testCase of completedCases) {
        expect(testCase.expectations).toMatchObject({
          terminalStatus: 'completed',
          verificationMustPass: true,
          minEvidenceEntries: 1,
          requiredEvidenceSourceTypes: ['user_input'],
          executionMode: 'generate',
        });
      }
    });

    it('applies the same gate to completed follow-up deliverables', () => {
      const completedFollowUps = readSuite(suiteName).flatMap((testCase) =>
        (testCase.replySequence ?? [])
          .filter((turn) => turn.expectations?.mustComplete)
          .map((turn) => ({ caseId: testCase.id, expectations: turn.expectations })),
      );

      expect(completedFollowUps.map((turn) => turn.caseId)).toEqual([expectedCompletedIds.at(-1)]);
      expect(completedFollowUps[0]?.expectations).toMatchObject({
        terminalStatus: 'completed',
        verificationMustPass: true,
        minEvidenceEntries: 1,
        requiredEvidenceSourceTypes: ['user_input'],
        executionMode: 'generate',
      });
    });
  },
);

describe('P1 persisted acceptance contract', () => {
  it('keeps the production persisted gate bounded and representative', () => {
    const cases = readSuite('p1-persisted-gate');
    const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));

    expect(cases.map((testCase) => testCase.id)).toEqual([
      'P1_TRUST_SCRAPE',
      'P1_TRUST_BROWSER_ARTIFACT',
    ]);
    expect(byId.get('P1_TRUST_SCRAPE')).toMatchObject({
      prompt: expect.stringContaining('至少 3 个不同来源'),
      expectations: {
        mustComplete: false,
        allowedTerminalStatuses: ['completed', 'partial_success'],
        verificationMustPass: true,
        executionMode: 'scrape',
        minEvidenceEntries: 2,
        requiredEvidenceSourceTypes: ['tool_result'],
        maxDurationMs: 240000,
      },
    });
    expect(byId.get('P1_TRUST_BROWSER_ARTIFACT')?.expectations).toMatchObject({
      mustComplete: true,
      verificationMustPass: true,
      executionMode: 'browser',
      minEvidenceEntries: 2,
      requiredEvidenceSourceTypes: ['browser_state'],
      minOutputFiles: 1,
      requiredOutputMimeTypes: ['image/jpeg'],
      requiredActionCaptureTypes: ['navigate', 'click'],
    });
  });

  it('requires scrape cases to persist grounded tool-result evidence', () => {
    const scrapeCases = readSuite('p1-regression').filter(
      (testCase) =>
        testCase.expectations.mustComplete && testCase.expectations.executionMode === 'scrape',
    );

    expect(scrapeCases.map((testCase) => testCase.id)).toEqual([
      'P1_SCRAPE_NEWS',
      'P1_SCRAPE_PRODUCT',
      'P1_SCRAPE_XHS',
      'P1_SCRAPE_OFFICIAL',
    ]);
    expect(
      scrapeCases.every(
        (testCase) =>
          (testCase.expectations.minEvidenceEntries ?? 0) >= 2 &&
          testCase.expectations.requiredEvidenceSourceTypes?.includes('tool_result'),
      ),
    ).toBe(true);
  });

  it('requires browser cases to persist observed state and the actions they claim', () => {
    const byId = new Map(readSuite('p1-regression').map((testCase) => [testCase.id, testCase]));
    const completedBrowserIds = [
      'P1_BROWSER_NAV',
      'P1_BROWSER_CLICK',
      'P1_BROWSER_FORM_NO_SUBMIT',
      'P1_BROWSER_URL_CHECK',
    ];
    const expectedActions = {
      P1_BROWSER_NAV: ['navigate'],
      P1_BROWSER_CLICK: ['navigate', 'click'],
      P1_BROWSER_FORM_NO_SUBMIT: ['navigate', 'type'],
      P1_BROWSER_LOGIN_PARK: ['navigate'],
      P1_BROWSER_URL_CHECK: ['navigate'],
    } as const;

    for (const id of completedBrowserIds) {
      expect(byId.get(id)?.expectations.requiredEvidenceSourceTypes).toContain('browser_state');
    }
    for (const [id, actionTypes] of Object.entries(expectedActions)) {
      const expectations = byId.get(id)?.expectations;
      expect(expectations?.requiredActionCaptureTypes).toEqual(actionTypes);
    }
  });

  it('requires download cases to persist the requested MIME artifact', () => {
    const byId = new Map(readSuite('p3-downloads').map((testCase) => [testCase.id, testCase]));

    expect(byId.get('P3_DL_001')?.expectations).toMatchObject({
      minOutputFiles: 1,
      requiredOutputMimeTypes: ['image/jpeg'],
    });
    expect(byId.get('P3_DL_002')?.expectations).toMatchObject({
      minOutputFiles: 1,
      requiredOutputMimeTypes: ['application/pdf'],
    });
  });
});
