import { BatteryLow, CloudSun, type LucideIcon, Sparkles, Waves } from 'lucide-react';
import type { EnergyMood } from './energy-types';

interface MoodCheckInProps {
  value: EnergyMood | null;
  onChange: (mood: EnergyMood) => void;
}

const MOODS: Array<{
  id: EnergyMood;
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  { id: 'good', label: '状态很好', detail: '想把好状态延续下去', icon: Sparkles },
  { id: 'tired', label: '有点累', detail: '想先让身体松一点', icon: BatteryLow },
  { id: 'stressed', label: '压力有点大', detail: '脑子里有些事情太吵', icon: Waves },
  { id: 'unwind', label: '只想放空', detail: '暂时什么都不想完成', icon: CloudSun },
];

export function MoodCheckIn({ value, onChange }: MoodCheckInProps): JSX.Element {
  return (
    <fieldset className="energy-mood-grid" aria-label="当前状态">
      {MOODS.map((mood) => {
        const Icon = mood.icon;
        const selected = value === mood.id;
        return (
          <button
            key={mood.id}
            type="button"
            className="energy-mood-option"
            aria-label={mood.label}
            title={mood.label}
            aria-pressed={selected}
            data-selected={selected ? 'true' : 'false'}
            onClick={() => onChange(mood.id)}
          >
            <span className="energy-mood-option__icon" aria-hidden="true">
              <Icon />
            </span>
            <span>
              <strong>{mood.label}</strong>
              <small>{mood.detail}</small>
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
