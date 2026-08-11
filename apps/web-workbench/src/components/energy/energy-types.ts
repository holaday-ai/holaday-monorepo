export type EnergyMood = 'good' | 'tired' | 'stressed' | 'unwind';
export type EnergyExperienceId = 'tarot' | 'light-test' | 'horoscope' | 'games';
export type ExperiencePhase = 'intro' | 'active' | 'result' | 'error';

export interface EnergyExperienceDefinition {
  id: EnergyExperienceId;
  kind: 'card' | 'test' | 'horoscope' | 'game';
  title: string;
  description: string;
  estimatedSeconds: number;
  status: 'active' | 'coming-soon' | 'hidden';
  actionable: boolean;
  requiredProfileFields: Array<'birthday' | 'birthTime' | 'birthPlace'>;
}

export interface EnergyExperienceProps {
  mood: EnergyMood | null;
  profileStorageScope: string | null;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
}
