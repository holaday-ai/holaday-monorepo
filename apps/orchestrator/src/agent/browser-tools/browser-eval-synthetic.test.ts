import { expect, it } from 'vitest';
import { scoreSyntheticSuite } from '../../../scripts/browser-eval/score.js';
it('keeps failed and missing cases in the denominator, separate from unsupported', () => {
  const result = scoreSyntheticSuite(
    [
      { id: 'a', category: 'read' },
      { id: 'b', category: 'safety' },
      { id: 'c', category: 'read' },
    ],
    [
      { id: 'a', status: 'passed' },
      { id: 'b', status: 'failed' },
    ],
  );
  expect(result).toMatchObject({
    denominator: 3,
    passed: 1,
    failed: 1,
    unsupported: 1,
    successRate: 1 / 3,
    failureComposition: { safety: 1, unsupported: 1 },
  });
});
