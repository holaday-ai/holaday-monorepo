import { describe, expect, it } from 'vitest';
import { ENERGY_POLL_IDS } from '../energy-content-target';
import { POLL_CONTENT } from './poll-content';

describe('poll content', () => {
  it('defines four honest local choices with feedback for every poll', () => {
    expect(POLL_CONTENT.map((poll) => poll.id)).toEqual(ENERGY_POLL_IDS);

    for (const poll of POLL_CONTENT) {
      expect(poll.options).toHaveLength(4);
      expect(new Set(poll.options.map((option) => option.id)).size).toBe(4);
      for (const option of poll.options) {
        expect(option.interpretation.length).toBeGreaterThan(0);
        expect(option.suggestion.length).toBeGreaterThan(0);
        expect(`${option.label}${option.interpretation}${option.suggestion}`).not.toMatch(/%|全网|用户选择/);
      }
    }
  });
});
