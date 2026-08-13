import { describe, expect, it } from 'vitest';
import { isEnergyContentTarget } from './energy-content-target';
import {
  ENERGY_EXPLORE_CONTENT,
  REQUIRED_CONTENT_COUNTS,
  nextEnergyContentBatch,
} from './explore-content';

const now = new Date('2026-08-12T12:00:00Z');

describe('energy explore content', () => {
  it('contains 36 complete, non-sponsored launch items across all categories', () => {
    const content: readonly import('./explore-content').EnergyContentItem[] =
      ENERGY_EXPLORE_CONTENT;
    expect(ENERGY_EXPLORE_CONTENT).toHaveLength(36);
    expect(content.some((item) => item.kind === 'sponsored')).toBe(false);
    expect(new Set(ENERGY_EXPLORE_CONTENT.map((item) => item.id)).size).toBe(36);

    for (const [category, expected] of Object.entries(REQUIRED_CONTENT_COUNTS)) {
      expect(ENERGY_EXPLORE_CONTENT.filter((item) => item.category === category)).toHaveLength(
        expected,
      );
    }
    expect(
      ENERGY_EXPLORE_CONTENT.every(
        (item) => item.title && item.summary.length >= 25 && isEnergyContentTarget(item.target),
      ),
    ).toBe(true);
  });

  it('routes recommendations to distinct experiences instead of generic directories', () => {
    const targets = ENERGY_EXPLORE_CONTENT.map((item) => item.target);
    expect(
      new Set(
        targets.filter((target) => target.type === 'practice').map((target) => target.practiceId),
      ).size,
    ).toBe(6);
    expect(
      new Set(targets.filter((target) => target.type === 'poll').map((target) => target.pollId))
        .size,
    ).toBe(4);
    expect(
      new Set(targets.filter((target) => target.type === 'test').map((target) => target.testId))
        .size,
    ).toBe(8);
    expect(
      new Set(targets.filter((target) => target.type === 'tarot').map((target) => target.mode)),
    ).toEqual(new Set(['single', 'yes-no', 'three']));
    expect(
      new Set(targets.filter((target) => target.type === 'game').map((target) => target.gameId)),
    ).toEqual(new Set(['catch-energy', 'breath-rhythm', 'color-memory']));
  });

  it('returns unseen active items without repeating', () => {
    const context = { mood: 'stressed', energyNeed: 'relax' } as const;
    const first = nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds: [],
      seed: 'a',
      size: 6,
      now,
      ...context,
    });
    const second = nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds: first.map((item) => item.id),
      seed: 'b',
      size: 6,
      now,
      ...context,
    });

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect(
      first.map((item) => item.id).filter((id) => second.some((item) => item.id === id)),
    ).toEqual([]);
  });

  it('ranks matching energy needs first and filters unavailable dates', () => {
    const expiredSource = ENERGY_EXPLORE_CONTENT[0];
    const futureSource = ENERGY_EXPLORE_CONTENT[1];
    if (!expiredSource || !futureSource) throw new Error('expected launch content');
    const batch = nextEnergyContentBatch({
      items: [
        ...ENERGY_EXPLORE_CONTENT,
        {
          ...expiredSource,
          id: 'expired-item',
          expiresAt: '2026-08-11T00:00:00Z',
        },
        {
          ...futureSource,
          id: 'future-item',
          publishedAt: '2026-08-13T00:00:00Z',
        },
      ],
      seenIds: [],
      seed: 'need-aware',
      size: 6,
      now,
      mood: 'tired',
      energyNeed: 'relax',
    });

    expect(batch.slice(0, 3).every((item) => item.tags.includes('relax'))).toBe(true);
    expect(batch.map((item) => item.id)).not.toContain('expired-item');
    expect(batch.map((item) => item.id)).not.toContain('future-item');
  });

  it('returns the final partial batch and then an empty exhausted batch', () => {
    const seenIds = ENERGY_EXPLORE_CONTENT.slice(0, 34).map((item) => item.id);
    const final = nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds,
      seed: 'final',
      size: 6,
      now,
      mood: null,
      energyNeed: 'focus',
    });
    const exhausted = nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds: ENERGY_EXPLORE_CONTENT.map((item) => item.id),
      seed: 'done',
      size: 6,
      now,
      mood: null,
      energyNeed: 'focus',
    });

    expect(final).toHaveLength(2);
    expect(exhausted).toEqual([]);
  });
});
