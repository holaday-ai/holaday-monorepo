import type { ZodiacSign } from '@/lib/astrology';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  FlaskConical,
  Layers3,
  ListOrdered,
  Palette,
  RefreshCw,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import * as React from 'react';
import { AstrologyDimensionGrid } from './AstrologyDimensionGrid';
import { LuckyInsights } from './LuckyInsights';
import { hasCompleteRanking } from './astrology-content';
import type { EnergyAstrologyPeriod } from './energy-types';
import type { EnergyAstrologyState } from './useEnergyAstrology';
import { zodiacBadgeImage } from './zodiac-art';

interface AstrologyWorldProps {
  astrology: EnergyAstrologyState;
  onOpenEnergyCard: (trigger: HTMLButtonElement) => void;
  onOpenLightTest: (trigger: HTMLButtonElement) => void;
}

const TABS: Array<{ period: EnergyAstrologyPeriod; label: string }> = [
  { period: 'daily', label: '今日' },
  { period: 'weekly', label: '本周' },
  { period: 'monthly', label: '本月' },
  { period: 'yearly', label: '本年' },
];

const ZODIAC_OPTIONS: Array<{ sign: ZodiacSign; label: string }> = [
  { sign: 'aries', label: '白羊座' },
  { sign: 'taurus', label: '金牛座' },
  { sign: 'gemini', label: '双子座' },
  { sign: 'cancer', label: '巨蟹座' },
  { sign: 'leo', label: '狮子座' },
  { sign: 'virgo', label: '处女座' },
  { sign: 'libra', label: '天秤座' },
  { sign: 'scorpio', label: '天蝎座' },
  { sign: 'sagittarius', label: '射手座' },
  { sign: 'capricorn', label: '摩羯座' },
  { sign: 'aquarius', label: '水瓶座' },
  { sign: 'pisces', label: '双鱼座' },
];

export const AstrologyWorld = React.forwardRef<HTMLElement, AstrologyWorldProps>(
  function AstrologyWorld({ astrology, onOpenEnergyCard, onOpenLightTest }, ref): JSX.Element {
    const [selectedPeriod, setSelectedPeriod] = React.useState<EnergyAstrologyPeriod>('daily');
    const [monthRange, setMonthRange] = React.useState<'current' | 'next'>('current');
    const [rankingRequested, setRankingRequested] = React.useState(false);
    const [signPickerOpen, setSignPickerOpen] = React.useState(false);
    const selectedState = astrology.periods[selectedPeriod];
    const completeRanking = hasCompleteRanking(astrology.ranking);
    const sourceLabel =
      selectedState.source === 'local-fallback'
        ? 'Holaday 本地提示'
        : selectedState.reading.freshness === 'stale'
          ? 'DivineAPI 最近成功数据'
          : 'DivineAPI 内容';

    const selectPeriod = (period: EnergyAstrologyPeriod): void => {
      setSelectedPeriod(period);
      const state = astrology.periods[period];
      if (period === 'monthly') {
        if (!state.loaded || state.reading.rangeKey !== monthRange) {
          void astrology.loadPeriod('monthly', monthRange);
        }
        return;
      }
      if (!state.loaded) void astrology.loadPeriod(period, 'current');
    };

    const selectMonth = (rangeKey: 'current' | 'next'): void => {
      setMonthRange(rangeKey);
      if (
        !astrology.periods.monthly.loaded ||
        astrology.periods.monthly.reading.rangeKey !== rangeKey
      ) {
        void astrology.loadPeriod('monthly', rangeKey);
      }
    };

    return (
      <section
        ref={ref}
        id="energy-astrology-world"
        className="energy-astrology-world"
        aria-labelledby="energy-astrology-world-title"
      >
        <div className="energy-astrology-world__stage">
          <header className="energy-astrology-world__header">
            <div>
              <p className="energy-kicker">
                <Sparkles aria-hidden="true" />
                不止两分钟的星座补给
              </p>
              <h2 id="energy-astrology-world-title">星座深度补给站</h2>
              <p>按今天、本周、本月和本年慢慢看，只展示能确认来源的内容。</p>
            </div>
            <span className="energy-astrology-world__source">{sourceLabel}</span>
          </header>
          <div className="energy-astrology-world__art">
            <Sparkles className="energy-astrology-world__sparkle" aria-hidden="true" />
            <img
              src={zodiacBadgeImage(selectedState.reading.zodiacSign)}
              alt={`${selectedState.reading.zodiacLabel}马卡龙插画`}
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
            <span className="energy-astrology-world__orbit-note" data-note="color">
              <Palette aria-hidden="true" />
              <small>幸运色</small>
              <strong>{selectedState.reading.luckyColors[0] ?? '等待提示'}</strong>
            </span>
            <span className="energy-astrology-world__orbit-note" data-note="time">
              <Clock3 aria-hidden="true" />
              <small>顺手时段</small>
              <strong>{selectedState.reading.suitableTimes[0] ?? '等待提示'}</strong>
            </span>
          </div>
        </div>

        <div className="energy-astrology-world__tabs" role="tablist" aria-label="星座范围">
          {TABS.map((tab) => (
            <button
              key={tab.period}
              type="button"
              role="tab"
              id={`energy-astrology-tab-${tab.period}`}
              aria-controls="energy-astrology-panel"
              aria-selected={selectedPeriod === tab.period}
              tabIndex={selectedPeriod === tab.period ? 0 : -1}
              onClick={() => selectPeriod(tab.period)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {selectedPeriod === 'monthly' ? (
          <fieldset className="energy-astrology-world__month-range">
            <legend>月份范围</legend>
            <button
              type="button"
              aria-pressed={monthRange === 'current'}
              onClick={() => selectMonth('current')}
            >
              本月
            </button>
            <button
              type="button"
              aria-pressed={monthRange === 'next'}
              onClick={() => selectMonth('next')}
            >
              下月
            </button>
          </fieldset>
        ) : null}

        <div
          id="energy-astrology-panel"
          role="tabpanel"
          aria-labelledby={`energy-astrology-tab-${selectedPeriod}`}
          className="energy-astrology-world__panel"
        >
          <header className="energy-astrology-world__period-header">
            <div>
              <p>
                <CalendarDays aria-hidden="true" />
                {selectedState.reading.zodiacLabel} · {selectedState.reading.rangeLabel}
              </p>
              <h3>{selectedState.reading.summary}</h3>
            </div>
            <button
              type="button"
              aria-label="刷新当前星座范围"
              title="刷新当前星座范围"
              disabled={selectedState.loading}
              onClick={() => void astrology.refreshPeriod(selectedPeriod)}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </header>

          {selectedState.loading ? <p aria-live="polite">正在读取这一段星座内容…</p> : null}
          {selectedState.error ? (
            <p className="energy-astrology-world__notice">{selectedState.error}</p>
          ) : null}
          <AstrologyDimensionGrid key={selectedPeriod} reading={selectedState.reading} />
          <LuckyInsights reading={selectedState.reading} />
        </div>

        <section className="energy-astrology-world__continue" aria-label="继续探索星座内容">
          <header>
            <Layers3 aria-hidden="true" />
            <div>
              <h3>继续往下逛</h3>
              <p>换个角度、抽张牌，或做个轻测试，不必一次看完。</p>
            </div>
          </header>
          <div className="energy-astrology-world__continue-actions">
            <button
              type="button"
              aria-label="查看十二星座排行"
              data-tone="lavender"
              disabled={astrology.ranking.loading}
              onClick={() => {
                setRankingRequested(true);
                void astrology.loadRanking();
              }}
            >
              <span className="energy-astrology-world__portal-icon" aria-hidden="true">
                <ListOrdered />
              </span>
              <span>
                <strong>查看十二星座排行</strong>
                <small>看看谁更有行动力</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="换个星座看看"
              data-tone="sky"
              onClick={() => setSignPickerOpen((value) => !value)}
            >
              <span className="energy-astrology-world__portal-icon" aria-hidden="true">
                <Shuffle />
              </span>
              <span>
                <strong>换个星座看看</strong>
                <small>切换视角，不改资料</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="抽一张相关能量牌"
              data-tone="peach"
              onClick={(event) => onOpenEnergyCard(event.currentTarget)}
            >
              <span className="energy-astrology-world__portal-icon" aria-hidden="true">
                <Sparkles />
              </span>
              <span>
                <strong>抽一张相关能量牌</strong>
                <small>给当下一个轻提示</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="测个相关主题"
              data-tone="mint"
              onClick={(event) => onOpenLightTest(event.currentTarget)}
            >
              <span className="energy-astrology-world__portal-icon" aria-hidden="true">
                <FlaskConical />
              </span>
              <span>
                <strong>测个相关主题</strong>
                <small>一分钟看见状态</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          </div>

          {rankingRequested ? (
            completeRanking ? (
              <div className="energy-astrology-world__ranking">
                <h3>十二星座今日能量排行</h3>
                <ol>
                  {astrology.ranking.items.map((item) => (
                    <li key={item.zodiacSign}>
                      <span>{item.zodiacLabel}</span>
                      <strong>{item.score}%</strong>
                      <small>{item.dateLabel}</small>
                    </li>
                  ))}
                </ol>
              </div>
            ) : astrology.ranking.loading ? (
              <p aria-live="polite">正在读取完整排行…</p>
            ) : (
              <p>Provider 数据尚不完整，暂不展示本地拼接排行。</p>
            )
          ) : null}

          {signPickerOpen ? (
            <div className="energy-astrology-world__sign-picker">
              <p>只预览，不会修改已保存的生日资料。</p>
              <fieldset>
                <legend>选择预览星座</legend>
                {ZODIAC_OPTIONS.map((option) => (
                  <button
                    key={option.sign}
                    type="button"
                    onClick={() => void astrology.loadSignPreview(option.sign)}
                  >
                    {option.label}
                  </button>
                ))}
              </fieldset>
              {astrology.signPreview ? (
                <article aria-live="polite">
                  <strong>{astrology.signPreview.reading.zodiacLabel}</strong>
                  <h4>{astrology.signPreview.reading.summary}</h4>
                  <p>{astrology.signPreview.reading.dimensions[0]?.body}</p>
                </article>
              ) : null}
            </div>
          ) : null}
        </section>

        <a className="energy-astrology-world__top-link" href="#energy-astrology-world-title">
          回到星座补给开头
          <ArrowRight aria-hidden="true" />
        </a>
      </section>
    );
  },
);
