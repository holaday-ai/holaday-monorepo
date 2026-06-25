import {
  CalendarDays,
  Clock,
  Compass,
  Eraser,
  Gauge,
  MoonStar,
  Palette,
  RefreshCcw,
  Save,
  Sparkles,
  TimerReset,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  buildAstroReading,
  clearAstroProfile,
  createProfileFromBirthday,
  readAstroProfile,
  saveAstroProfile,
  zodiacOptions,
  type AstroDay,
  type AstroProfile,
  type ZodiacSign,
} from '@/lib/astrology';
import { cn } from '@/lib/utils';

const MOODS = [
  { id: 'clear', label: '清醒', hint: '适合先做判断题' },
  { id: 'busy', label: '有点满', hint: '先把任务切小' },
  { id: 'soft', label: '慢一点', hint: '适合整理和收尾' },
] as const;

export function AstroDashboard(): JSX.Element {
  const [profile, setProfile] = React.useState<AstroProfile | null>(() =>
    readAstroProfile(),
  );
  const [cardIndex, setCardIndex] = React.useState(0);
  const [selectedMood, setSelectedMood] =
    React.useState<(typeof MOODS)[number]['id']>('clear');
  const reading = React.useMemo(
    () => buildAstroReading(profile ?? createProfileFromBirthday({ birthday: '1996-03-21' })),
    [profile],
  );
  const activeCard = reading.waitingCards[cardIndex % reading.waitingCards.length];
  const activeMood = MOODS.find((mood) => mood.id === selectedMood) ?? MOODS[0];

  function handleSave(next: AstroProfile): void {
    saveAstroProfile(next);
    setProfile(next);
  }

  function handleReset(): void {
    clearAstroProfile();
    setProfile(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <DailyEnergyPanel reading={reading} profile={profile} />
        <AstroProfilePanel profile={profile} onSave={handleSave} onReset={handleReset} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <WaitingCardPreview
          card={activeCard}
          cardIndex={cardIndex}
          onNext={() => setCardIndex((index) => index + 1)}
        />
        <MoodCheckPanel
          selectedMood={selectedMood}
          activeMood={activeMood}
          onSelect={setSelectedMood}
          focusMode={reading.focusMode}
        />
      </div>

      <WeeklyPlanner days={reading.weekly} />
    </div>
  );
}

function DailyEnergyPanel({
  reading,
  profile,
}: {
  reading: ReturnType<typeof buildAstroReading>;
  profile: AstroProfile | null;
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <div className="relative min-h-[292px] p-6 sm:p-7">
        <div
          className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-bl-full bg-[#7DD3FC]/20"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute bottom-0 left-0 h-28 w-44 rounded-tr-full bg-[#FDE68A]/35"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 text-xs font-medium text-[#EA1F59]">
              <MoonStar className="h-4 w-4" aria-hidden />
              <span>{reading.dateLabel}</span>
            </div>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-normal text-[#231F20] sm:text-4xl">
              {profile?.name ? `${profile.name}，` : ''}
              {reading.headline}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#595757]">
              {reading.workNote}
            </p>
          </div>
          <div className="grid min-w-[240px] grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <MetricTile icon={Gauge} label="今日能量" value={`${reading.energyScore}%`} />
            <MetricTile icon={Sparkles} label="今日关键词" value={reading.mood} />
            <MetricTile icon={Palette} label="幸运色" value={reading.luckyColor} />
            <MetricTile icon={Clock} label="高光时段" value={reading.luckyWindow} />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-[8px] border border-white/70 bg-white/80 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex items-center gap-1.5 text-[11px] text-[#8C8C8C]">
        <Icon className="h-3.5 w-3.5 text-[#EA1F59]" aria-hidden />
        {label}
      </div>
      <div className="mt-1.5 text-sm font-semibold text-[#231F20]">{value}</div>
    </div>
  );
}

function AstroProfilePanel({
  profile,
  onSave,
  onReset,
}: {
  profile: AstroProfile | null;
  onSave(profile: AstroProfile): void;
  onReset(): void;
}): JSX.Element {
  const [name, setName] = React.useState(profile?.name ?? '');
  const [birthday, setBirthday] = React.useState(profile?.birthday ?? '1996-03-21');
  const [birthTime, setBirthTime] = React.useState(profile?.birthTime ?? '');
  const [birthPlace, setBirthPlace] = React.useState(profile?.birthPlace ?? '');
  const [zodiacSign, setZodiacSign] = React.useState<ZodiacSign>(
    profile?.zodiacSign ?? 'aries',
  );

  React.useEffect(() => {
    setName(profile?.name ?? '');
    setBirthday(profile?.birthday ?? '1996-03-21');
    setBirthTime(profile?.birthTime ?? '');
    setBirthPlace(profile?.birthPlace ?? '');
    setZodiacSign(profile?.zodiacSign ?? 'aries');
  }, [profile]);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = createProfileFromBirthday({
      name,
      birthday,
      birthTime,
      birthPlace,
    });
    onSave({ ...next, zodiacSign });
  }

  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#231F20]">个人星象档案</h2>
          <p className="mt-1 text-xs leading-5 text-[#8C8C8C]">
            出生时间和地点可以先空着，后续接 AstrologyAPI 时再做完整星盘。
          </p>
        </div>
        {profile && (
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            清空
          </Button>
        )}
      </div>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="昵称">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            placeholder="今天怎么称呼你"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="生日">
            <input
              type="date"
              value={birthday}
              onChange={(event) => {
                const next = createProfileFromBirthday({ birthday: event.target.value });
                setBirthday(event.target.value);
                setZodiacSign(next.zodiacSign);
              }}
              className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            />
          </Field>
          <Field label="星座">
            <select
              value={zodiacSign}
              onChange={(event) => setZodiacSign(event.target.value as ZodiacSign)}
              className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            >
              {zodiacOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="出生时间">
            <input
              type="time"
              value={birthTime}
              onChange={(event) => setBirthTime(event.target.value)}
              className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            />
          </Field>
          <Field label="出生地">
            <input
              value={birthPlace}
              onChange={(event) => setBirthPlace(event.target.value)}
              className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
              placeholder="城市"
            />
          </Field>
        </div>
        <Button type="submit" className="w-full">
          <Save className="mr-2 h-4 w-4" aria-hidden />
          保存今日档案
        </Button>
      </form>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[#595757]">{label}</span>
      {children}
    </label>
  );
}

function WaitingCardPreview({
  card,
  cardIndex,
  onNext,
}: {
  card: ReturnType<typeof buildAstroReading>['waitingCards'][number] | undefined;
  cardIndex: number;
  onNext(): void;
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#231F20]">等待时的小卡片</h2>
          <p className="mt-1 text-xs text-[#8C8C8C]">后续可以嵌进任务执行中的等待区域。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onNext}>
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          换一张
        </Button>
      </div>
      <div className="rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/5 p-5">
        <div className="flex items-center gap-2 text-xs font-medium text-[#EA1F59]">
          <TimerReset className="h-4 w-4" aria-hidden />
          正在为你跑任务 · 第 {(cardIndex % 3) + 1} 张
        </div>
        <h3 className="mt-4 text-xl font-semibold text-[#231F20]">
          {card?.title ?? '任务正在跑'}
        </h3>
        <p className="mt-3 text-sm leading-6 text-[#595757]">
          {card?.body ?? '先喝口水，结果马上回来。'}
        </p>
        <button
          type="button"
          className="mt-5 inline-flex h-8 items-center rounded-[8px] border border-[#EA1F59]/25 bg-white px-3 text-xs font-medium text-[#EA1F59] transition hover:bg-[#EA1F59]/10"
          onClick={onNext}
        >
          {card?.cta ?? '继续'}
        </button>
      </div>
    </section>
  );
}

function MoodCheckPanel({
  selectedMood,
  activeMood,
  onSelect,
  focusMode,
}: {
  selectedMood: (typeof MOODS)[number]['id'];
  activeMood: (typeof MOODS)[number];
  onSelect(value: (typeof MOODS)[number]['id']): void;
  focusMode: string;
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[#231F20]">一分钟状态测试</h2>
        <p className="mt-1 text-xs text-[#8C8C8C]">把今天的任务入口调得轻一点。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {MOODS.map((mood) => (
          <button
            key={mood.id}
            type="button"
            onClick={() => onSelect(mood.id)}
            className={cn(
              'rounded-[8px] border px-3 py-3 text-left transition',
              selectedMood === mood.id
                ? 'border-[#22C55E]/50 bg-[#DCFCE7] text-[#14532D]'
                : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#22C55E]/30 hover:bg-[#F0FDF4]',
            )}
          >
            <div className="text-sm font-semibold">{mood.label}</div>
            <div className="mt-1 text-xs opacity-80">{mood.hint}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-[8px] border border-[#7DD3FC]/45 bg-[#EFF6FF] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#0369A1]">
          <Compass className="h-4 w-4" aria-hidden />
          当前建议
        </div>
        <p className="mt-2 text-sm leading-6 text-[#0F172A]">
          你现在是「{activeMood.label}」模式，适合用「{focusMode}」开始。
          先选一个 10 分钟内能完成的小动作，Holaday 负责跑复杂的部分。
        </p>
      </div>
    </section>
  );
}

function WeeklyPlanner({ days }: { days: AstroDay[] }): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-[#EA1F59]" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-[#231F20]">本周任务节奏</h2>
          <p className="mt-1 text-xs text-[#8C8C8C]">每天打开都能给任务排序一点点灵感。</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day) => (
          <DayTile key={day.key} day={day} />
        ))}
      </div>
    </section>
  );
}

function DayTile({ day }: { day: AstroDay }): JSX.Element {
  const tone = TONE_CLASS[day.tone];
  return (
    <div className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#8C8C8C]">{day.label}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', tone.pill)}>
          {day.energy}%
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${day.energy}%` }} />
      </div>
      <div className="mt-3 text-sm font-semibold text-[#231F20]">{day.title}</div>
      <p className="mt-1 min-h-[34px] text-xs leading-4 text-[#595757]">{day.suggestion}</p>
    </div>
  );
}

const TONE_CLASS: Record<
  AstroDay['tone'],
  { pill: string; bar: string }
> = {
  focus: {
    pill: 'bg-[#DBEAFE] text-[#1D4ED8]',
    bar: 'bg-[#3B82F6]',
  },
  social: {
    pill: 'bg-[#FCE7F3] text-[#BE185D]',
    bar: 'bg-[#EC4899]',
  },
  creative: {
    pill: 'bg-[#FEF3C7] text-[#B45309]',
    bar: 'bg-[#F59E0B]',
  },
  recovery: {
    pill: 'bg-[#DCFCE7] text-[#15803D]',
    bar: 'bg-[#22C55E]',
  },
};
