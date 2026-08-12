import { describe, expect, it } from 'vitest';
import { ENERGY_GAME_IDS } from '../energy-content-target';
import { ENERGY_GAMES } from './game-content';

describe('game content', () => {
  it('defines three distinct bounded games without competitive copy', () => {
    expect(ENERGY_GAMES.map((game) => game.id)).toEqual(ENERGY_GAME_IDS);
    expect(new Set(ENERGY_GAMES.map((game) => game.title)).size).toBe(3);
    for (const game of ENERGY_GAMES) {
      expect(game.estimatedSeconds).toBeGreaterThanOrEqual(30);
      expect(game.estimatedSeconds).toBeLessThanOrEqual(120);
      expect(`${game.title}${game.description}${game.completionBody}`).not.toMatch(/排名|连胜|失败|惩罚/);
    }
  });
});
