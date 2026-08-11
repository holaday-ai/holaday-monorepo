import {
  HOLADAY_ENERGY_CARDS,
  type HoladayCardTheme,
  type HoladayEnergyCard,
} from './energy-card-content';

export function drawEnergyCards(input: {
  mode: 'daily' | 'single' | 'yes-no' | 'three';
  theme: HoladayCardTheme;
  count: 1 | 3;
  seed: string;
  seenIds: string[];
}): HoladayEnergyCard[] {
  const themed = HOLADAY_ENERGY_CARDS.filter((card) => card.primaryTheme === input.theme);
  const seenIds = new Set(input.seenIds);
  const unseen = themed.filter((card) => !seenIds.has(card.id));
  const pool = unseen.length >= input.count ? unseen : themed;
  return stableRotate(pool, seededNumber(`${input.mode}:${input.seed}`)).slice(0, input.count);
}

function stableRotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return [];
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function seededNumber(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
