import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { EvalCase } from './eval-suite.js';

const suitePath = fileURLToPath(new URL('./eval-cases/p0-release-gate.json', import.meta.url));

function readReleaseGateSuite(): EvalCase[] {
  return JSON.parse(readFileSync(suitePath, 'utf8')) as EvalCase[];
}

describe('P0 release gate suite', () => {
  it('keeps only the four fast non-browser release invariants', () => {
    const suite = readReleaseGateSuite();

    expect(suite.map((testCase) => testCase.id)).toEqual(['P0_001', 'P0_002', 'P0_010', 'P0_011']);
    expect(
      suite.every(
        (testCase) =>
          typeof testCase.expectations.maxDurationMs === 'number' &&
          testCase.expectations.maxDurationMs <= 60_000,
      ),
    ).toBe(true);
    expect(suite.some((testCase) => testCase.category.startsWith('browser'))).toBe(false);
    expect(suite.some((testCase) => testCase.category === 'generate_search')).toBe(false);
  });

  it('requires verifier approval for every completed release case', () => {
    const completedCases = readReleaseGateSuite().filter(
      (testCase) => testCase.expectations.mustComplete,
    );

    expect(completedCases.map((testCase) => testCase.id)).toEqual(['P0_001', 'P0_011']);
    expect(
      completedCases.every((testCase) => testCase.expectations.verificationMustPass === true),
    ).toBe(true);
  });
});
