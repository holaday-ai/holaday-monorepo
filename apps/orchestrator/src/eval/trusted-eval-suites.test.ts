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
