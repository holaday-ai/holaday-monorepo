import type { EnergyWeeklyReading } from '../useEnergyAstrology';

export interface WeeklyHoroscopeSection {
  key: 'profession' | 'personal' | 'health' | 'emotions' | 'travel' | 'luck';
  label: string;
  body: string;
}

export function weeklyHoroscopeSections(weekly: EnergyWeeklyReading): WeeklyHoroscopeSection[] {
  return [
    { key: 'profession', label: '工作', body: weekly.profession },
    { key: 'personal', label: '人际', body: weekly.personal },
    { key: 'health', label: '身心', body: weekly.health },
    { key: 'emotions', label: '情绪', body: weekly.emotions },
    { key: 'travel', label: '出行', body: weekly.travel },
    { key: 'luck', label: '好运', body: weekly.luck },
  ];
}
