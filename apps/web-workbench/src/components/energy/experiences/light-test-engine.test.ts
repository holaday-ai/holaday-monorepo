import { describe, expect, it } from 'vitest';
import { reachableOutcomeIds, scoreLightTest } from './light-test-engine';
import { LIGHT_TESTS } from './test-content';

describe('light test scoring engine', () => {
  it('maps score bands to stable outcome ids', () => {
    const test = LIGHT_TESTS[0];
    if (!test) throw new Error('expected at least one light test');
    const lowest = test.questions.map(
      (question) => question.options.find((option) => option.points === 0)?.id ?? '',
    );
    const highest = test.questions.map(
      (question) => question.options.find((option) => option.points === 3)?.id ?? '',
    );
    expect(scoreLightTest(test, lowest).id).toBe('recover');
    expect(scoreLightTest(test, highest).id).toBe('charge');
  });

  it('makes every declared outcome reachable', () => {
    for (const test of LIGHT_TESTS) {
      expect(reachableOutcomeIds(test).sort()).toEqual(test.outcomes.map((item) => item.id).sort());
    }
  });
});
