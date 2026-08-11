import { buildAstroReading, createProfileFromBirthday } from '@/lib/astrology';
import { describe, expect, it } from 'vitest';
import { LIGHT_TESTS, type LightTestContext } from './test-content';

const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
const context: LightTestContext = {
  profile,
  reading: buildAstroReading(profile, new Date('2026-08-11T12:00:00+09:00')),
  date: new Date('2026-08-11T12:00:00+09:00'),
};

describe('LIGHT_TESTS', () => {
  it('contains three complete tests with reachable results', () => {
    expect(LIGHT_TESTS.map((test) => test.id)).toEqual([
      'psychology',
      'compatibility',
      'daily-number',
    ]);

    for (const test of LIGHT_TESTS) {
      expect(test.questions.length).toBeGreaterThanOrEqual(1);
      expect(test.questions.length).toBeLessThanOrEqual(3);
      for (const question of test.questions) {
        expect(question.options.length).toBeGreaterThanOrEqual(2);
        for (const option of question.options) {
          const answers = test.questions.map((candidate) => candidate.options[0]?.id ?? '');
          const questionIndex = test.questions.indexOf(question);
          answers[questionIndex] = option.id;

          expect(test.resultFor(answers, context)).toEqual({
            title: expect.any(String),
            body: expect.any(String),
            strength: expect.any(String),
            reminder: expect.any(String),
            action: expect.any(String),
          });
        }
      }
    }
  });

  it('does not use clinical labels or treatment language', () => {
    const forbidden = /抑郁症|焦虑症|人格障碍|诊断|治疗方案/;
    expect(JSON.stringify(LIGHT_TESTS)).not.toMatch(forbidden);
  });

  it('keeps compatibility and daily number results deterministic without rankings', () => {
    const compatibility = LIGHT_TESTS.find((test) => test.id === 'compatibility');
    const dailyNumber = LIGHT_TESTS.find((test) => test.id === 'daily-number');
    expect(compatibility).toBeDefined();
    expect(dailyNumber).toBeDefined();
    if (!compatibility || !dailyNumber) throw new Error('expected light test definitions');

    const compatibilityResult = compatibility.resultFor(['steady'], context);
    expect(compatibility.resultFor(['steady'], context)).toEqual(compatibilityResult);
    expect(compatibilityResult).not.toHaveProperty('score');

    const numberResult = dailyNumber.resultFor(['work'], context);
    expect(dailyNumber.resultFor(['work'], context)).toEqual(numberResult);
    expect(numberResult.title).toMatch(/^今日行动数 [1-9]$/);
    expect(numberResult).not.toHaveProperty('rank');
  });
});
