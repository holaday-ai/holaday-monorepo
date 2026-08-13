import { Sparkles } from 'lucide-react';
import * as React from 'react';
import { LuckyColorValue } from './LuckyColorValue';
import type { EnergyPeriodReading } from './useEnergyAstrology';
import { zodiacBadgeImage } from './zodiac-art';

interface AstrologyMagazineCoverProps {
  reading: EnergyPeriodReading;
  sourceLabel: string;
  loading: boolean;
}

export function AstrologyMagazineCover({
  reading,
  sourceLabel,
  loading,
}: AstrologyMagazineCoverProps): JSX.Element {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const artSrc = zodiacBadgeImage(reading.zodiacSign);
  const failed = failedSrc === artSrc;

  return (
    <header className="energy-astrology-magazine-cover" aria-busy={loading}>
      <div className="energy-astrology-magazine-cover__copy">
        <p className="energy-kicker">
          <Sparkles aria-hidden="true" />
          星座专刊
        </p>
        <h2 id="energy-astrology-world-title">{reading.zodiacLabel}能量专刊</h2>
        {loading ? (
          <div className="energy-astrology-magazine-cover__copy-skeleton" aria-hidden="true">
            <span className="energy-astrology-skeleton energy-astrology-skeleton--line" />
            <span className="energy-astrology-skeleton energy-astrology-skeleton--line-short" />
            <span className="energy-astrology-skeleton energy-astrology-skeleton--source" />
          </div>
        ) : (
          <>
            <p>{reading.summary}</p>
            <span className="energy-astrology-magazine-cover__source">{sourceLabel}</span>
          </>
        )}
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
        {loading ? (
          <dl aria-hidden="true">
            {['幸运色', '顺手时段', '阅读范围'].map((label) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <span className="energy-astrology-skeleton energy-astrology-skeleton--metric" />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <dl>
            <div>
              <dt>幸运色</dt>
              <dd>
                <LuckyColorValue value={reading.luckyColors[0]} />
              </dd>
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
        )}
      </div>
    </header>
  );
}
