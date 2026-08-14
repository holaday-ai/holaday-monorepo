import { describe, expect, it } from 'vitest';
import type { EnergyProgress, EnergyRecentExperience } from './energy-progress';
import { buildEnergyShelfModel, energyShelfDateLabel } from './energy-shelf';

function progressFixture(
  overrides: {
    recent?: EnergyRecentExperience[];
    savedCardIds?: string[];
    savedTestActionIds?: string[];
    favoriteContentIds?: string[];
  } = {},
): EnergyProgress {
  return {
    completedDates: [],
    collectedKinds: [],
    savedCardIds: overrides.savedCardIds ?? [],
    completedTestIds: [],
    savedTestActionIds: overrides.savedTestActionIds ?? [],
    seenContentIds: [],
    completedKindsByDate: {},
    seenContentDateKey: null,
    continuation: {
      dateKey: '2026-08-14',
      lastTarget: null,
      lastCompletedKind: null,
      completedPracticeIds: [],
      pollSelections: {},
      favoriteContentIds: overrides.favoriteContentIds ?? [],
    },
    shelf: { recentExperiences: overrides.recent ?? [] },
  };
}

describe('energy shelf model', () => {
  it('resolves precise recent content and all three favorite sources', () => {
    const progress = progressFixture({
      recent: [
        {
          experienceId: 'games',
          launchTarget: { type: 'game', gameId: 'color-memory' },
          kind: 'game',
          completedAt: new Date(2026, 7, 14, 10).toISOString(),
        },
      ],
      savedCardIds: ['work-01', 'missing-01'],
      savedTestActionIds: ['work-focus:steady', 'missing-test:steady'],
      favoriteContentIds: ['relax-breath-window', 'missing-content'],
    });

    const model = buildEnergyShelfModel(progress, 'aries', new Date(2026, 7, 14, 12));

    expect(model.recent).toEqual([
      expect.objectContaining({
        id: 'recent:games:color-memory',
        title: '颜色记忆',
        imageSrc: '/energy/mini-game.jpg',
        completedLabel: '今天',
      }),
    ]);
    expect(model.favorites.map((item) => item.source)).toEqual([
      'energy-card',
      'test-action',
      'magazine-content',
    ]);
    expect(model.favorites[0]).toMatchObject({
      title: '先推一厘米',
      imageSrc: '/energy/tarot-cards.jpg',
      target: { type: 'tarot', mode: 'single', theme: 'work' },
      favoriteRef: { source: 'energy-card', cardId: 'work-01' },
    });
    expect(model.favorites[1]).toMatchObject({
      title: '先把节奏稳住',
      imageSrc: '/energy/quick-test.jpg',
      target: { type: 'test', testId: 'work-focus' },
      favoriteRef: { source: 'test-action', testId: 'work-focus', outcomeId: 'steady' },
    });
    expect(model.favorites[2]).toMatchObject({
      title: '窗边八次慢呼吸',
      imageSrc: '/energy/magazine/relax-island.webp',
      imageObjectPosition: '50% 52%',
      target: { type: 'practice', practiceId: 'breath-window' },
      favoriteRef: { source: 'magazine-content', contentId: 'relax-breath-window' },
    });
  });

  it('uses the real default game and exact targeted practice titles', () => {
    const progress = progressFixture({
      recent: [
        {
          experienceId: 'games',
          launchTarget: null,
          kind: 'game',
          completedAt: new Date(2026, 7, 14, 11).toISOString(),
        },
        {
          experienceId: 'practice',
          launchTarget: { type: 'practice', practiceId: 'breath-window' },
          kind: 'recharge',
          completedAt: new Date(2026, 7, 13, 11).toISOString(),
        },
        {
          experienceId: 'tarot',
          launchTarget: null,
          kind: 'tarot',
          completedAt: new Date(2026, 7, 12, 11).toISOString(),
        },
        {
          experienceId: 'light-test',
          launchTarget: { type: 'test', testId: 'work-focus' },
          kind: 'test',
          completedAt: new Date(2026, 7, 11, 11).toISOString(),
        },
        {
          experienceId: 'tarot',
          launchTarget: { type: 'tarot', mode: 'three', theme: 'work' },
          kind: 'tarot',
          completedAt: new Date(2026, 7, 10, 11).toISOString(),
        },
      ],
    });

    const model = buildEnergyShelfModel(progress, 'aries', new Date(2026, 7, 14, 12));

    expect(model.recent.map((item) => item.title)).toEqual([
      '接住能量',
      '窗边八次慢呼吸',
      '抽张卡',
      '专注入口',
      '三张能量牌',
    ]);
    expect(model.recent.map((item) => item.completedLabel)).toEqual([
      '今天',
      '昨天',
      '8月12日',
      '8月11日',
      '8月10日',
    ]);
  });

  it('labels dates by local calendar days and returns an empty label for invalid input', () => {
    const now = new Date(2026, 7, 14, 12);

    expect(energyShelfDateLabel(new Date(2026, 7, 14, 1).toISOString(), now)).toBe('今天');
    expect(energyShelfDateLabel(new Date(2026, 7, 13, 23).toISOString(), now)).toBe('昨天');
    expect(energyShelfDateLabel(new Date(2026, 7, 10, 12).toISOString(), now)).toBe('8月10日');
    expect(energyShelfDateLabel('not-a-date', now)).toBe('');
  });
});
