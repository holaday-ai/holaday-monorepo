import { Sparkles } from 'lucide-react';
import * as React from 'react';
import type { EnergyPeriodReading } from './useEnergyAstrology';
import { zodiacBadgeImage } from './zodiac-art';

interface AstrologyMagazineCoverProps {
  reading: EnergyPeriodReading;
  sourceLabel: string;
}

export function AstrologyMagazineCover({
  reading,
  sourceLabel,
}: AstrologyMagazineCoverProps): JSX.Element {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const artSrc = zodiacBadgeImage(reading.zodiacSign);
  const failed = failedSrc === artSrc;

  return (
    <header className="energy-astrology-magazine-cover">
      <div className="energy-astrology-magazine-cover__copy">
        <p className="energy-kicker">
          <Sparkles aria-hidden="true" />
          星座专刊
        </p>
        <h2 id="energy-astrology-world-title">{reading.zodiacLabel}能量专刊</h2>
        <p>{reading.summary}</p>
        <span className="energy-astrology-magazine-cover__source">{sourceLabel}</span>
      </div>
      <div className="energy-astrology-magazine-cover__art">
        {failed ? (
          <span data-testid="zodiac-cover-fallback">
            <Sparkles aria-hidden="true" />
            <strong>{reading.zodiacLabel}</strong>
          </span>
        ) : (
          <img
            src={artSrc}
            alt={`${reading.zodiacLabel}马卡龙专刊封面`}
            onError={() => setFailedSrc(artSrc)}
          />
        )}
        <dl>
          <div>
            <dt>幸运色</dt>
            <dd>{reading.luckyColors[0] ?? '等待提示'}</dd>
          </div>
          <div>
            <dt>顺手时段</dt>
            <dd>{reading.suitableTimes[0] ?? '等待提示'}</dd>
          </div>
          <div>
            <dt>阅读范围</dt>
            <dd>{reading.rangeLabel}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
