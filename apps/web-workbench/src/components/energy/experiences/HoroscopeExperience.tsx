import type { AstroFortuneArea, AstroProfile } from '@/lib/astrology';
import { CalendarDays, Orbit, RefreshCw, Sparkles } from 'lucide-react';
import * as React from 'react';
import type { EnergyAstrologyState } from '../useEnergyAstrology';
import { buildNatalSnapshot, buildTransitSnapshot } from './horoscope-content';

type HoroscopeView = 'daily' | 'natal' | 'transit';
type DailyTab = AstroFortuneArea['key'] | 'week';

interface HoroscopeExperienceProps {
  profile: AstroProfile;
  astrology: EnergyAstrologyState;
}

const DAILY_TABS: Array<{ id: DailyTab; label: string }> = [
  { id: 'overall', label: '总览' },
  { id: 'career', label: '工作' },
  { id: 'love', label: '人际' },
  { id: 'wealth', label: '财务' },
  { id: 'health', label: '身心' },
  { id: 'week', label: '本周' },
];

export function HoroscopeExperience({ profile, astrology }: HoroscopeExperienceProps): JSX.Element {
  const [view, setView] = React.useState<HoroscopeView>('daily');
  const [dailyTab, setDailyTab] = React.useState<DailyTab>('overall');
  const natal = React.useMemo(
    () => buildNatalSnapshot(profile, astrology.reading),
    [astrology.reading, profile],
  );
  const transit = React.useMemo(() => buildTransitSnapshot(astrology.reading), [astrology.reading]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#9b5f78]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {astrology.reading.zodiacLabel} · {astrology.reading.dateLabel}
          </div>
          <h3 className="mt-2 text-xl font-semibold text-[#332d37]">
            {astrology.reading.headline}
          </h3>
          {astrology.source === 'local-fallback' ? (
            <p className="mt-2 text-xs text-[#8a7c86]">暂时使用本地提示</p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[#816f7a] hover:bg-[#f6eff3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a86684]"
          disabled={astrology.loading}
          onClick={() => void astrology.refresh()}
        >
          <RefreshCw
            className={astrology.loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
            aria-hidden="true"
          />
          {astrology.loading ? '更新中' : '更新提示'}
        </button>
      </div>

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="星座详情">
        {(
          [
            ['daily', '今日运势'],
            ['natal', '星盘档案'],
            ['transit', '流年提醒'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="rounded-full border border-[#e4dce1] bg-white px-3 py-1.5 text-xs font-medium text-[#665c67] hover:border-[#c9acba] aria-pressed:border-[#aa6a88] aria-pressed:bg-[#fff2f7] aria-pressed:text-[#7b4861]"
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'daily' ? (
        <DailyFortune reading={astrology.reading} selected={dailyTab} onSelect={setDailyTab} />
      ) : null}
      {view === 'natal' ? <NatalPanel snapshot={natal} /> : null}
      {view === 'transit' ? <TransitPanel snapshot={transit} /> : null}
    </div>
  );
}

function DailyFortune({
  reading,
  selected,
  onSelect,
}: {
  reading: EnergyAstrologyState['reading'];
  selected: DailyTab;
  onSelect: (tab: DailyTab) => void;
}): JSX.Element {
  const fortune =
    selected === 'week' ? null : reading.fortune.find((item) => item.key === selected);
  return (
    <div className="mt-5">
      <div
        className="flex gap-1 overflow-x-auto rounded-xl bg-[#f6f2f5] p-1"
        role="tablist"
        aria-label="今日运势分类"
      >
        {DAILY_TABS.map((tab) => (
          <button
            key={tab.id}
            id={`energy-horoscope-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected === tab.id}
            aria-controls={`energy-horoscope-panel-${tab.id}`}
            className="min-w-fit flex-1 rounded-lg px-3 py-2 text-xs font-medium text-[#786d78] hover:bg-white/70 aria-selected:bg-white aria-selected:text-[#704157] aria-selected:shadow-sm"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        id={`energy-horoscope-panel-${selected}`}
        role="tabpanel"
        aria-labelledby={`energy-horoscope-tab-${selected}`}
        className="mt-4 rounded-2xl border border-[#e8e1e5] bg-white p-5"
      >
        {selected === 'week' ? (
          <ul className="grid list-none gap-2 p-0">
            {reading.weekly.map((day) => (
              <li
                key={day.key}
                className="grid grid-cols-[48px_minmax(0,1fr)_44px] items-center gap-3 rounded-xl bg-[#faf7f9] px-3 py-2.5"
              >
                <strong className="text-xs text-[#554b56]">{day.label}</strong>
                <span className="min-w-0 text-xs leading-5 text-[#746a75]">
                  {day.title} · {day.suggestion}
                </span>
                <span className="text-right text-xs font-semibold text-[#9a617b]">
                  {day.energy}%
                </span>
              </li>
            ))}
          </ul>
        ) : fortune ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-[#9a617b]">{fortune.label}</p>
                <h4 className="mt-2 text-lg font-semibold text-[#332d37]">{fortune.title}</h4>
              </div>
              <span className="rounded-full bg-[#fff1f6] px-3 py-1 text-xs font-semibold text-[#985d78]">
                {fortune.score}%
              </span>
            </div>
            <p className="energy-detail-copy mt-3 text-sm leading-7 text-[#655c66]">
              {fortune.body}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}

function NatalPanel({
  snapshot,
}: { snapshot: ReturnType<typeof buildNatalSnapshot> }): JSX.Element {
  return (
    <section className="mt-5 rounded-2xl border border-[#e2d9e5] bg-[#fbf7fc] p-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#785488]">
        <Orbit className="h-4 w-4" aria-hidden="true" /> 星盘档案
      </div>
      <h3 className="mt-2 text-xl font-semibold text-[#352e39]">{snapshot.title}</h3>
      <p className="energy-detail-copy mt-2 text-sm leading-7 text-[#665d69]">{snapshot.body}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {snapshot.items.map((item) => (
          <div key={item.label} className="rounded-xl bg-white p-3">
            <span className="text-xs text-[#8b7d8c]">{item.label}</span>
            <strong className="mt-1 block text-sm text-[#403744]">{item.value}</strong>
            <p className="mt-1 text-xs leading-5 text-[#746b76]">{item.body}</p>
          </div>
        ))}
      </div>
      <p className="energy-detail-copy mt-4 rounded-xl bg-white/80 p-3 text-sm leading-6 text-[#65586a]">
        {snapshot.longTermAdvice}
      </p>
    </section>
  );
}

function TransitPanel({
  snapshot,
}: {
  snapshot: ReturnType<typeof buildTransitSnapshot>;
}): JSX.Element {
  return (
    <section className="mt-5 rounded-2xl border border-[#dce7df] bg-[#f7fbf8] p-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#58755f]">
        <CalendarDays className="h-4 w-4" aria-hidden="true" /> 流年提醒
      </div>
      <h3 className="mt-2 text-xl font-semibold text-[#303833]">{snapshot.title}</h3>
      <p className="energy-detail-copy mt-2 text-sm leading-7 text-[#5e6961]">{snapshot.body}</p>
      <div className="mt-4 grid gap-2">
        {snapshot.strongest.map((day) => (
          <div key={day.key} className="rounded-xl bg-white/85 p-3">
            <strong className="text-sm text-[#405348]">
              {day.label} · {day.title}
            </strong>
            <p className="mt-1 text-xs leading-5 text-[#66726a]">{day.suggestion}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
