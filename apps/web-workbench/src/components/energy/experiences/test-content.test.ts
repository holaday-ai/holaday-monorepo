import { describe, expect, it } from 'vitest';
import { LIGHT_TESTS } from './test-content';

describe('LIGHT_TESTS', () => {
  it('contains six categories, three tests each, and complete questions', () => {
    expect(LIGHT_TESTS).toHaveLength(18);
    const ids = new Set(LIGHT_TESTS.map((test) => test.id));
    expect(ids.size).toBe(18);
    const counts: Record<string, number> = {};
    for (const test of LIGHT_TESTS) {
      counts[test.category] = (counts[test.category] ?? 0) + 1;
      expect(test.questions).toHaveLength(5);
      expect(test.outcomes).toHaveLength(4);
      expect(test.relatedTestIds.length).toBeGreaterThanOrEqual(2);
      expect(test.relatedTestIds.every((id) => ids.has(id))).toBe(true);
      for (const question of test.questions) {
        expect(question.options.map((option) => option.points)).toEqual([0, 1, 2, 3]);
      }
    }
    expect(counts).toEqual({
      emotion: 3,
      stress: 3,
      work: 3,
      relationship: 3,
      social: 3,
      'daily-number': 3,
    });
  });

  it('contains no diagnostic or deterministic-risk language', () => {
    expect(JSON.stringify(LIGHT_TESTS)).not.toMatch(
      /患有|确诊|风险等级|人格缺陷|注定|一定会|治疗方案/,
    );
  });
});
