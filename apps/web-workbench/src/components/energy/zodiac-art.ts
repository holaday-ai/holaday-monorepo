import type { ZodiacSign } from '@/lib/astrology';

const ZODIAC_BADGE_IMAGES: Record<ZodiacSign, string> = {
  aries: '/energy/aries-badge.jpg',
  taurus: '/energy/taurus-badge.jpg',
  gemini: '/energy/gemini-badge.jpg',
  cancer: '/energy/cancer-badge.jpg',
  leo: '/energy/leo-badge.jpg',
  virgo: '/energy/virgo-badge.jpg',
  libra: '/energy/libra-badge.jpg',
  scorpio: '/energy/scorpio-badge.jpg',
  sagittarius: '/energy/sagittarius-badge.jpg',
  capricorn: '/energy/capricorn-badge.jpg',
  aquarius: '/energy/aquarius-badge.jpg',
  pisces: '/energy/pisces-badge.jpg',
};

export function zodiacBadgeImage(sign: ZodiacSign): string {
  return ZODIAC_BADGE_IMAGES[sign];
}
