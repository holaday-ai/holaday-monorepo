// @vitest-environment happy-dom

import { type AstroProfile, type ZodiacSign, buildAstroReading } from '@/lib/astrology';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnergyAstrologyPanel } from './EnergyAstrologyPanel';
import type { EnergyAstrologyState } from './useEnergyAstrology';

const zodiacAssets: Array<[ZodiacSign, string]> = [
  ['aries', '/energy/aries-badge.jpg'],
  ['taurus', '/energy/taurus-badge.jpg'],
  ['gemini', '/energy/gemini-badge.jpg'],
  ['cancer', '/energy/cancer-badge.jpg'],
  ['leo', '/energy/leo-badge.jpg'],
  ['virgo', '/energy/virgo-badge.jpg'],
  ['libra', '/energy/libra-badge.jpg'],
  ['scorpio', '/energy/scorpio-badge.jpg'],
  ['sagittarius', '/energy/sagittarius-badge.jpg'],
  ['capricorn', '/energy/capricorn-badge.jpg'],
  ['aquarius', '/energy/aquarius-badge.jpg'],
  ['pisces', '/energy/pisces-badge.jpg'],
];

function profileFor(zodiacSign: ZodiacSign): AstroProfile {
  return {
    name: 'HOLA DAY',
    birthday: '1990-01-01',
    birthTime: '09:00',
    birthPlace: 'Tokyo',
    zodiacSign,
  };
}

function astrologyFor(profile: AstroProfile): EnergyAstrologyState {
  const reading = buildAstroReading(profile);
  return {
    reading,
    tarot: { title: 'The Star', subtitle: '提示', body: '正文' },
    weekly: {
      weekLabel: '本周',
      personal: reading.headline,
      health: '照顾身体',
      profession: reading.workNote,
      emotions: '照顾感受',
      travel: '保留弹性',
      luck: '尝试新事物',
      luckyColors: [reading.luckyColor],
    },
    yesNoTarot: null,
    yesNoLoading: false,
    source: 'local-fallback',
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    drawYesNoTarot: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(cleanup);

describe('EnergyAstrologyPanel zodiac art', () => {
  it.each(zodiacAssets)('renders the dedicated %s illustration', (zodiacSign, expectedSrc) => {
    const profile = profileFor(zodiacSign);
    const { container } = render(
      <EnergyAstrologyPanel
        profile={profile}
        astrology={astrologyFor(profile)}
        canEditProfile
        onOpen={vi.fn()}
        onEditProfile={vi.fn()}
      />,
    );

    const image = container.querySelector<HTMLImageElement>('.energy-astrology-panel__badge img');
    expect(image?.getAttribute('src')).toBe(expectedSrc);
  });
});
