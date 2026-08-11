import type { AstroProfile } from '@/lib/astrology';
import type { EnergyAstrologyState } from './useEnergyAstrology';

export type EnergyMood = 'good' | 'tired' | 'stressed' | 'unwind';
export type EnergyNeed = 'focus' | 'relax' | 'confidence' | 'uplift';
export type EnergyAstrologyPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type EnergyAstrologyRangeKey = 'today' | 'current' | 'next';
export type EnergyExperienceId = 'recharge' | 'tarot' | 'light-test' | 'horoscope' | 'games';
export type ExperiencePhase = 'intro' | 'active' | 'result' | 'error';

export interface EnergyExperienceDefinition {
  id: EnergyExperienceId;
  kind: 'ritual' | 'card' | 'test' | 'horoscope' | 'game';
  title: string;
  description: string;
  estimatedSeconds: number;
  status: 'active' | 'coming-soon' | 'hidden';
  actionable: boolean;
  requiredProfileFields: Array<'birthday' | 'birthTime' | 'birthPlace'>;
}

export interface EnergyExperienceProps {
  mood: EnergyMood | null;
  energyNeed: EnergyNeed;
  profileStorageScope: string | null;
  profile: AstroProfile;
  astrology: EnergyAstrologyState;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onExperienceComplete: (kind: 'recharge' | 'tarot' | 'game' | 'test' | 'horoscope') => void;
}
