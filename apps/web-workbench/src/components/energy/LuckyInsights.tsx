import { Clock3, Hash, HeartHandshake, Palette, Sparkles, Type } from 'lucide-react';
import { luckyInsightGroups } from './astrology-content';
import type { EnergyPeriodReading } from './useEnergyAstrology';

interface LuckyInsightsProps {
  reading: EnergyPeriodReading;
}

const GROUP_ICONS = {
  colors: Palette,
  numbers: Hash,
  letters: Type,
  times: Clock3,
} as const;

export function LuckyInsights({ reading }: LuckyInsightsProps): JSX.Element {
  const groups = luckyInsightGroups(reading);
  const tips = [
    { key: 'cosmic', label: '宇宙提示', body: reading.cosmicTip },
    { key: 'singles', label: '单身提示', body: reading.singlesTip },
    { key: 'couples', label: '关系提示', body: reading.couplesTip },
  ].filter((item): item is { key: string; label: string; body: string } => Boolean(item.body));

  return (
    <section className="energy-lucky-insights" aria-label="幸运线索与趋势">
      {groups.length > 0 ? (
        <div className="energy-lucky-insights__groups">
          {groups.map((group) => {
            const Icon = GROUP_ICONS[group.key];
            return (
              <article key={group.key}>
                <header>
                  <Icon aria-hidden="true" />
                  <h4>{group.label}</h4>
                </header>
                <div>
                  {group.values.map((value) => (
                    <span key={value}>
                      {group.key === 'colors' && isColorCode(value) ? (
                        <i aria-label={`色值 ${value}`} style={{ backgroundColor: value }} />
                      ) : null}
                      {value}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {tips.length > 0 ? (
        <div className="energy-lucky-insights__tips">
          {tips.map((tip) => (
            <article key={tip.key}>
              {tip.key === 'cosmic' ? (
                <Sparkles aria-hidden="true" />
              ) : (
                <HeartHandshake aria-hidden="true" />
              )}
              <div>
                <h4>{tip.label}</h4>
                <p>{tip.body}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {reading.sevenDayTrend ? (
        <figure role="img" aria-label="七日能量趋势">
          <figcaption>七日能量趋势</figcaption>
          <div>
            {reading.sevenDayTrend.items.map((item) => (
              <label key={item.dateLabel}>
                <span>{item.dateLabel}</span>
                <meter min="0" max="100" value={item.score}>
                  {item.score}%
                </meter>
                <strong>{item.score}%</strong>
              </label>
            ))}
          </div>
        </figure>
      ) : (
        <p className="energy-lucky-insights__empty-trend">暂未获得可验证的七日趋势</p>
      )}
    </section>
  );
}

function isColorCode(value: string): boolean {
  return /^(#[\da-f]{3,8}|rgba?\(|hsla?\()/i.test(value.trim());
}
