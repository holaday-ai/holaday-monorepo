import type { ZodiacSign } from '@/lib/astrology';
import type { EnergyContentCategory } from './explore-content';
import { zodiacBadgeImage } from './zodiac-art';

export type EnergyVisualTone = 'peach' | 'lavender' | 'sky' | 'mint' | 'sun';
export type EnergyVisualIcon =
  | 'book'
  | 'brain'
  | 'briefcase'
  | 'clock'
  | 'gamepad'
  | 'heart'
  | 'palette'
  | 'shuffle'
  | 'sparkles'
  | 'user'
  | 'wind';

export interface EnergyVisualDefinition {
  tone: EnergyVisualTone;
  icon: EnergyVisualIcon;
  imageSrc: string;
}

const EXPLORE_VISUALS: Record<
  Exclude<EnergyContentCategory, 'zodiac-knowledge'>,
  EnergyVisualDefinition
> = {
  relaxation: { tone: 'sky', icon: 'wind', imageSrc: '/energy/recharge-island.jpg' },
  fortune: { tone: 'peach', icon: 'sparkles', imageSrc: '/energy/energy-capsules.jpg' },
  'relationship-quiz': { tone: 'mint', icon: 'heart', imageSrc: '/energy/quick-test.jpg' },
  poll: { tone: 'lavender', icon: 'shuffle', imageSrc: '/energy/energy-capsules.jpg' },
  'test-recommendation': { tone: 'mint', icon: 'brain', imageSrc: '/energy/quick-test.jpg' },
  'card-recommendation': {
    tone: 'peach',
    icon: 'sparkles',
    imageSrc: '/energy/tarot-cards.jpg',
  },
  'game-recommendation': { tone: 'sky', icon: 'gamepad', imageSrc: '/energy/mini-game.jpg' },
};

const DIMENSION_VISUALS: Record<string, Omit<EnergyVisualDefinition, 'imageSrc'>> = {
  personal: { tone: 'lavender', icon: 'user' },
  health: { tone: 'mint', icon: 'heart' },
  profession: { tone: 'peach', icon: 'briefcase' },
  emotions: { tone: 'lavender', icon: 'sparkles' },
  travel: { tone: 'sky', icon: 'shuffle' },
  luck: { tone: 'sun', icon: 'sparkles' },
};

export function exploreVisualFor(
  category: EnergyContentCategory,
  zodiacSign: ZodiacSign,
): EnergyVisualDefinition {
  if (category === 'zodiac-knowledge') {
    return { tone: 'sky', icon: 'book', imageSrc: zodiacBadgeImage(zodiacSign) };
  }
  return EXPLORE_VISUALS[category];
}

export function dimensionVisualFor(
  key: string,
): Omit<EnergyVisualDefinition, 'imageSrc'> {
  return DIMENSION_VISUALS[key] ?? { tone: 'lavender', icon: 'sparkles' };
}
