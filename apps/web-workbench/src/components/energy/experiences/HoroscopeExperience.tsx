import { Button } from '@/components/ui/button';
import type { AstroProfile } from '@/lib/astrology';
import { Check, Palette, RefreshCw, Sparkles, Timer } from 'lucide-react';
import * as React from 'react';
import type { ExperiencePhase } from '../energy-types';
import type { EnergyAstrologyState } from '../useEnergyAstrology';
import { weeklyHoroscopeSections } from './horoscope-content';

type HoroscopeView = 'daily' | 'weekly';

interface HoroscopeExperienceProps {
  profile: AstroProfile;
  astrology: EnergyAstrologyState;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete: () => void;
}

export function HoroscopeExperience({
  profile,
  astrology,
  phase,
  onPhaseChange,
  onComplete,
}: HoroscopeExperienceProps): JSX.Element {
  const [view, setView] = React.useState<HoroscopeView>('daily');

  if (phase === 'result') {
    return (
      <div className="energy-horoscope-result" aria-live="polite">
        <Check aria-hidden="true" />
        <h3>星座能量已收藏</h3>
        <p>不需要记住所有提示，挑一句今天用得上的就够了。</p>
      </div>
    );
  }

  const weeklySections = weeklyHoroscopeSections(astrology.weekly);

  return (
    <div className="energy-horoscope-flow">
      <header>
        <div>
          <p className="energy-kicker">
            <Sparkles aria-hidden="true" />
            {astrology.reading.zodiacLabel} · {astrology.reading.dateLabel}
          </p>
          <h3>{astrology.reading.headline}</h3>
          <p>
            {profile.birthday ? '根据已保存生日' : '根据默认资料'}
            对应的太阳星座生成；未使用本命盘推断。
          </p>
          {astrology.source === 'local-fallback' ? <small>暂时使用本地提示</small> : null}
        </div>
        <button
          type="button"
          className="energy-horoscope-refresh"
          disabled={astrology.loading}
          aria-label="更新星座提示"
          title="更新星座提示"
          onClick={() => void astrology.refresh()}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </header>

      <nav aria-label="星座提示范围">
        <button type="button" aria-pressed={view === 'daily'} onClick={() => setView('daily')}>
          今日提示
        </button>
        <button type="button" aria-pressed={view === 'weekly'} onClick={() => setView('weekly')}>
          本周运势
        </button>
      </nav>

      {view === 'daily' ? (
        <div className="energy-horoscope-daily">
          <div className="energy-horoscope-metrics">
            <span>
              <Sparkles aria-hidden="true" />
              <strong>{astrology.reading.energyScore}%</strong>
              今日能量
            </span>
            <span>
              <Palette aria-hidden="true" />
              <strong>{astrology.reading.luckyColor}</strong>
              幸运色
            </span>
            <span>
              <Timer aria-hidden="true" />
              <strong>{astrology.reading.luckyWindow}</strong>
              顺手时段
            </span>
          </div>
          <p className="energy-horoscope-work-note">{astrology.reading.workNote}</p>
          <div className="energy-horoscope-fortune-grid">
            {astrology.reading.fortune.map((fortune) => (
              <article key={fortune.key}>
                <div>
                  <strong>{fortune.label}</strong>
                  <span>{fortune.score}%</span>
                </div>
                <h4>{fortune.title}</h4>
                <p>{fortune.body}</p>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="energy-horoscope-weekly">
          <p>{astrology.weekly.weekLabel}</p>
          <div>
            {weeklySections.map((section) => (
              <article key={section.key}>
                <h3>{section.label}</h3>
                <p>{section.body}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      <Button
        type="button"
        className="energy-horoscope-collect"
        onClick={() => {
          onComplete();
          onPhaseChange('result');
        }}
      >
        收下今天的星座提示
      </Button>
    </div>
  );
}
