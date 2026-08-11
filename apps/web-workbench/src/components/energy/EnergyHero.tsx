import { Button } from '@/components/ui/button';
import { Focus, Smile, SunMedium, Waves, Zap, type LucideIcon } from 'lucide-react';
import type { EnergyNeed } from './energy-types';

interface EnergyHeroProps {
  value: EnergyNeed;
  onChange: (need: EnergyNeed) => void;
  onStart: (need: EnergyNeed, trigger: HTMLButtonElement) => void;
}

const NEEDS: Array<{
  id: EnergyNeed;
  label: string;
  detail: string;
  response: string;
  icon: LucideIcon;
}> = [
  {
    id: 'focus',
    label: '专注',
    detail: '提升专注力',
    response: '把注意力收回来，只点亮眼前最重要的一件事。',
    icon: Focus,
  },
  {
    id: 'relax',
    label: '放松',
    detail: '舒缓压力',
    response: '先把肩膀放松，再给大脑留一点空白。',
    icon: Waves,
  },
  {
    id: 'confidence',
    label: '自信',
    detail: '增强自我',
    response: '先肯定已经完成的部分，再向前迈一小步。',
    icon: SunMedium,
  },
  {
    id: 'uplift',
    label: '好心情',
    detail: '提升愉悦感',
    response: '给今天加一点轻盈，把好状态带回工作里。',
    icon: Smile,
  },
];

export function EnergyHero({ value, onChange, onStart }: EnergyHeroProps): JSX.Element {
  const selected = NEEDS.find((need) => need.id === value) ?? NEEDS[0];

  return (
    <section className="energy-hero" aria-labelledby="energy-hero-title">
      <div className="energy-hero__copy">
        <p className="energy-kicker">30 秒互动补给</p>
        <h2 id="energy-hero-title">今天想补哪一种能量？</h2>
        <p className="energy-hero__response" aria-live="polite">
          {selected.response}
        </p>
      </div>

      <div className="energy-hero__art" aria-hidden="true">
        <img src="/energy/recharge-island.jpg" alt="" />
      </div>

      <fieldset className="energy-need-list" aria-label="补给能量">
        {NEEDS.map((need) => {
          const Icon = need.icon;
          const isSelected = need.id === value;
          return (
            <button
              key={need.id}
              type="button"
              className="energy-need-option"
              aria-label={need.label}
              title={need.label}
              aria-pressed={isSelected}
              data-selected={isSelected ? 'true' : 'false'}
              data-need={need.id}
              onClick={() => onChange(need.id)}
            >
              <span aria-hidden="true">
                <Icon />
              </span>
              <span>
                <strong>{need.label}</strong>
                <small>{need.detail}</small>
              </span>
            </button>
          );
        })}
      </fieldset>

      <Button
        type="button"
        size="lg"
        className="energy-hero__action min-h-11"
        onClick={(event) => onStart(value, event.currentTarget)}
      >
        <Zap aria-hidden="true" />
        开始 30 秒补给
      </Button>
    </section>
  );
}
