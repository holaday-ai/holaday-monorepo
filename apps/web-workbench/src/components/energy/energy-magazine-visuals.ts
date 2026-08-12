import type { EnergyContentCategory } from './explore-content';

export type EnergyMagazineSlot = 'hero' | 'portrait' | 'landscape';

export interface MagazineArtAsset {
  id: string;
  imageSrc: `/energy/magazine/${string}.webp`;
  categories: readonly EnergyContentCategory[];
  objectPosition: string;
  maxBytes: 180_000 | 260_000;
}

export const MAGAZINE_ART: readonly MagazineArtAsset[] = [
  {
    id: 'relax-window',
    imageSrc: '/energy/magazine/relax-window.webp',
    categories: ['relaxation'],
    objectPosition: '50% 48%',
    maxBytes: 260_000,
  },
  {
    id: 'relax-island',
    imageSrc: '/energy/magazine/relax-island.webp',
    categories: ['relaxation', 'fortune'],
    objectPosition: '50% 52%',
    maxBytes: 260_000,
  },
  {
    id: 'fortune-capsule',
    imageSrc: '/energy/magazine/fortune-capsule.webp',
    categories: ['fortune', 'poll'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
  {
    id: 'fortune-window',
    imageSrc: '/energy/magazine/fortune-window.webp',
    categories: ['fortune', 'relaxation'],
    objectPosition: '50% 46%',
    maxBytes: 180_000,
  },
  {
    id: 'tarot-single',
    imageSrc: '/energy/magazine/tarot-single.webp',
    categories: ['card-recommendation', 'fortune'],
    objectPosition: '50% 48%',
    maxBytes: 180_000,
  },
  {
    id: 'tarot-spread',
    imageSrc: '/energy/magazine/tarot-spread.webp',
    categories: ['card-recommendation'],
    objectPosition: '50% 54%',
    maxBytes: 260_000,
  },
  {
    id: 'test-mood',
    imageSrc: '/energy/magazine/test-mood.webp',
    categories: ['test-recommendation', 'poll'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
  {
    id: 'test-relationship',
    imageSrc: '/energy/magazine/test-relationship.webp',
    categories: ['test-recommendation', 'relationship-quiz'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
  {
    id: 'game-stars',
    imageSrc: '/energy/magazine/game-stars.webp',
    categories: ['game-recommendation', 'relaxation'],
    objectPosition: '50% 50%',
    maxBytes: 260_000,
  },
  {
    id: 'game-console',
    imageSrc: '/energy/magazine/game-console.webp',
    categories: ['game-recommendation'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
  {
    id: 'zodiac-orbit',
    imageSrc: '/energy/magazine/zodiac-orbit.webp',
    categories: ['zodiac-knowledge', 'fortune'],
    objectPosition: '50% 50%',
    maxBytes: 260_000,
  },
  {
    id: 'zodiac-library',
    imageSrc: '/energy/magazine/zodiac-library.webp',
    categories: ['zodiac-knowledge'],
    objectPosition: '50% 46%',
    maxBytes: 180_000,
  },
  {
    id: 'poll-cloud',
    imageSrc: '/energy/magazine/poll-cloud.webp',
    categories: ['poll', 'relationship-quiz'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
  {
    id: 'relation-tea',
    imageSrc: '/energy/magazine/relation-tea.webp',
    categories: ['relationship-quiz', 'relaxation'],
    objectPosition: '50% 52%',
    maxBytes: 180_000,
  },
  {
    id: 'editorial-breath',
    imageSrc: '/energy/magazine/editorial-breath.webp',
    categories: ['relaxation', 'test-recommendation'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
  {
    id: 'editorial-spark',
    imageSrc: '/energy/magazine/editorial-spark.webp',
    categories: ['fortune', 'poll', 'card-recommendation'],
    objectPosition: '50% 50%',
    maxBytes: 180_000,
  },
] as const;

export const DIMENSION_MAGAZINE_ART: Readonly<
  Record<string, `/energy/magazine/${string}.webp`>
> = {
  personal: '/energy/magazine/editorial-spark.webp',
  health: '/energy/magazine/editorial-breath.webp',
  profession: '/energy/magazine/fortune-window.webp',
  emotions: '/energy/magazine/test-mood.webp',
  travel: '/energy/magazine/relax-island.webp',
  luck: '/energy/magazine/fortune-capsule.webp',
};

export const ASTROLOGY_PORTAL_ART = {
  ranking: '/energy/magazine/zodiac-orbit.webp',
  sign: '/energy/magazine/zodiac-library.webp',
  tarot: '/energy/magazine/tarot-spread.webp',
  test: '/energy/magazine/test-relationship.webp',
} as const;
