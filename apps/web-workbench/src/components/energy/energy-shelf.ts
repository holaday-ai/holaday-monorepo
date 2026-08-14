import type { ZodiacSign } from '@/lib/astrology';
import type { EnergyContentTarget } from './energy-content-target';
import { allocateMagazineVisuals } from './energy-magazine-visuals';
import type { EnergyProgress, EnergyRecentExperience } from './energy-progress';
import { recentExperienceKey } from './energy-progress';
import { ENERGY_EXPERIENCES } from './experience-registry';
import { HOLADAY_ENERGY_CARDS } from './experiences/energy-card-content';
import { ENERGY_GAMES } from './experiences/game-content';
import { PRACTICE_CONTENT } from './experiences/practice-content';
import { LIGHT_TESTS, type LightTestId, type LightTestOutcome } from './experiences/test-content';
import { ENERGY_EXPLORE_CONTENT, type EnergyExploreContentId } from './explore-content';
import { zodiacBadgeImage } from './zodiac-art';

export type EnergyShelfFavoriteSource = 'energy-card' | 'test-action' | 'magazine-content';

export type EnergyShelfFavoriteRef =
  | { source: 'energy-card'; cardId: string }
  | { source: 'test-action'; testId: LightTestId; outcomeId: LightTestOutcome['id'] }
  | { source: 'magazine-content'; contentId: EnergyExploreContentId };

export interface EnergyShelfItem {
  id: string;
  section: 'recent' | 'favorite';
  source: EnergyShelfFavoriteSource | 'experience';
  title: string;
  summary: string;
  eyebrow: string;
  imageSrc: string;
  imageObjectPosition: string;
  estimatedSeconds: number;
  completedLabel: string | null;
  recent: EnergyRecentExperience | null;
  target: EnergyContentTarget | null;
  favoriteRef: EnergyShelfFavoriteRef | null;
}

export interface EnergyShelfModel {
  recent: EnergyShelfItem[];
  favorites: EnergyShelfItem[];
}

interface ResolvedRecentContent {
  title: string;
  summary: string;
  eyebrow: string;
  estimatedSeconds: number;
}

const DEFAULT_IMAGE_POSITION = '50% 50%';

function recentImage(
  experienceId: EnergyRecentExperience['experienceId'],
  sign: ZodiacSign,
): string {
  if (experienceId === 'recharge' || experienceId === 'practice') {
    return '/energy/recharge-island.jpg';
  }
  if (experienceId === 'tarot') return '/energy/tarot-cards.jpg';
  if (experienceId === 'light-test') return '/energy/quick-test.jpg';
  if (experienceId === 'games') return '/energy/mini-game.jpg';
  return zodiacBadgeImage(sign);
}

function resolveRecentContent(recent: EnergyRecentExperience): ResolvedRecentContent | null {
  const experience = ENERGY_EXPERIENCES.find((item) => item.id === recent.experienceId);
  if (!experience || experience.status !== 'active' || !experience.actionable || !experience.load) {
    return null;
  }

  const target = recent.launchTarget;
  if (target?.type === 'practice') {
    const practice = PRACTICE_CONTENT.find((item) => item.id === target.practiceId);
    return practice
      ? {
          title: practice.title,
          summary: practice.description,
          eyebrow: '轻松练习',
          estimatedSeconds: practice.estimatedSeconds,
        }
      : null;
  }
  if (target?.type === 'test') {
    const test = LIGHT_TESTS.find((item) => item.id === target.testId);
    return test
      ? {
          title: test.title,
          summary: test.description,
          eyebrow: '轻测试',
          estimatedSeconds: test.estimatedSeconds,
        }
      : null;
  }
  if (target?.type === 'game') {
    const game = ENERGY_GAMES.find((item) => item.id === target.gameId);
    return game
      ? {
          title: game.title,
          summary: game.description,
          eyebrow: '小游戏',
          estimatedSeconds: game.estimatedSeconds,
        }
      : null;
  }
  if (target?.type === 'tarot') {
    const title =
      target.mode === 'three' ? '三张能量牌' : target.mode === 'yes-no' ? '是或否方向' : '单张提示';
    return {
      title,
      summary: experience.description,
      eyebrow: '能量牌',
      estimatedSeconds: experience.estimatedSeconds,
    };
  }
  if (target?.type === 'poll') return null;
  if (recent.experienceId === 'games') {
    const game = ENERGY_GAMES.find((item) => item.id === 'catch-energy');
    if (game) {
      return {
        title: game.title,
        summary: game.description,
        eyebrow: '小游戏',
        estimatedSeconds: game.estimatedSeconds,
      };
    }
  }
  return {
    title: experience.title,
    summary: experience.description,
    eyebrow:
      recent.experienceId === 'recharge'
        ? '30 秒补给'
        : recent.experienceId === 'horoscope'
          ? '星座能量'
          : '能量体验',
    estimatedSeconds: experience.estimatedSeconds,
  };
}

function recentShelfItem(
  recent: EnergyRecentExperience,
  zodiacSign: ZodiacSign,
  now: Date,
): EnergyShelfItem | null {
  const content = resolveRecentContent(recent);
  if (!content) return null;
  return {
    id: `recent:${recentExperienceKey(recent)}`,
    section: 'recent',
    source: 'experience',
    ...content,
    imageSrc: recentImage(recent.experienceId, zodiacSign),
    imageObjectPosition: DEFAULT_IMAGE_POSITION,
    completedLabel: energyShelfDateLabel(recent.completedAt, now),
    recent,
    target: null,
    favoriteRef: null,
  };
}

function energyCardFavorites(progress: EnergyProgress): EnergyShelfItem[] {
  return progress.savedCardIds.flatMap((cardId): EnergyShelfItem[] => {
    const card = HOLADAY_ENERGY_CARDS.find((item) => item.id === cardId);
    if (!card) return [];
    return [
      {
        id: `favorite:energy-card:${card.id}`,
        section: 'favorite',
        source: 'energy-card',
        title: card.title,
        summary: card.body,
        eyebrow: card.subtitle,
        imageSrc: '/energy/tarot-cards.jpg',
        imageObjectPosition: DEFAULT_IMAGE_POSITION,
        estimatedSeconds: 30,
        completedLabel: null,
        recent: null,
        target: { type: 'tarot', mode: 'single', theme: card.primaryTheme },
        favoriteRef: { source: 'energy-card', cardId: card.id },
      },
    ];
  });
}

function testActionFavorites(progress: EnergyProgress): EnergyShelfItem[] {
  return progress.savedTestActionIds.flatMap((actionId): EnergyShelfItem[] => {
    const [testId, outcomeId, extra] = actionId.split(':');
    if (extra !== undefined) return [];
    const test = LIGHT_TESTS.find((item) => item.id === testId);
    const outcome = test?.outcomes.find((item) => item.id === outcomeId);
    if (!test || !outcome) return [];
    return [
      {
        id: `favorite:test-action:${test.id}:${outcome.id}`,
        section: 'favorite',
        source: 'test-action',
        title: outcome.title,
        summary: outcome.action,
        eyebrow: `${test.title} · 行动建议`,
        imageSrc: '/energy/quick-test.jpg',
        imageObjectPosition: DEFAULT_IMAGE_POSITION,
        estimatedSeconds: test.estimatedSeconds,
        completedLabel: null,
        recent: null,
        target: { type: 'test', testId: test.id },
        favoriteRef: { source: 'test-action', testId: test.id, outcomeId: outcome.id },
      },
    ];
  });
}

function magazineFavorites(progress: EnergyProgress, zodiacSign: ZodiacSign): EnergyShelfItem[] {
  return progress.continuation.favoriteContentIds.flatMap((contentId): EnergyShelfItem[] => {
    const item = ENERGY_EXPLORE_CONTENT.find((candidate) => candidate.id === contentId);
    if (!item) return [];
    const allocated = allocateMagazineVisuals([item], zodiacSign)[0];
    if (!allocated) return [];
    return [
      {
        id: `favorite:magazine-content:${item.id}`,
        section: 'favorite',
        source: 'magazine-content',
        title: item.title,
        summary: item.summary,
        eyebrow: '能量专刊',
        imageSrc: allocated.visual.imageSrc,
        imageObjectPosition: allocated.visual.objectPosition,
        estimatedSeconds: item.estimatedSeconds,
        completedLabel: null,
        recent: null,
        target: item.target,
        favoriteRef: { source: 'magazine-content', contentId: item.id },
      },
    ];
  });
}

export function buildEnergyShelfModel(
  progress: EnergyProgress,
  zodiacSign: ZodiacSign,
  now = new Date(),
): EnergyShelfModel {
  return {
    recent: progress.shelf.recentExperiences.flatMap((recent) => {
      const item = recentShelfItem(recent, zodiacSign, now);
      return item ? [item] : [];
    }),
    favorites: [
      ...energyCardFavorites(progress),
      ...testActionFavorites(progress),
      ...magazineFavorites(progress, zodiacSign),
    ],
  };
}

export function energyShelfDateLabel(completedAt: string, now = new Date()): string {
  const completed = new Date(completedAt);
  if (!Number.isFinite(completed.getTime())) return '';
  const todayKey = localDateKey(now);
  const completedKey = localDateKey(completed);
  if (completedKey === todayKey) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  if (completedKey === localDateKey(yesterday)) return '昨天';
  return `${completed.getMonth() + 1}月${completed.getDate()}日`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
