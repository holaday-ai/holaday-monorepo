import {
  Activity,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  Clock,
  Compass,
  Eraser,
  Gauge,
  Heart,
  MoonStar,
  Orbit,
  Palette,
  RefreshCcw,
  Save,
  Shuffle,
  Sparkles,
  TimerReset,
  Users,
  WalletCards,
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

const EXPERIENCE_CARDS = [
  {
    icon: Orbit,
    title: '完整星盘',
    body: '太阳、月亮、上升、宫位和行星解释，适合做长期个人档案。',
    source: 'AstrologyAPI / Prokerala',
  },
  {
    icon: Users,
    title: '合盘匹配',
    body: '恋人、朋友、合作伙伴的吸引力、摩擦点和相处建议。',
    source: 'Compatibility / Synastry',
  },
  {
    icon: Brain,
    title: '心理小测试',
    body: '情绪、压力、决策风格和关系倾向，结合星盘给轻解释。',
    source: 'Holaday AI layer',
  },
  {
    icon: Shuffle,
    title: '塔罗 / 抽卡',
    body: '等待任务时抽一张卡，给一个轻量提示和下一步行动。',
    source: 'Tarot API / mock deck',
  },
  {
    icon: WalletCards,
    title: '数字命理',
    body: '生命灵数、个人年份、名字能量，适合做快捷娱乐入口。',
    source: 'Numerology API',
  },
  {
    icon: Activity,
    title: '流年提醒',
    body: '把重要 transit 做成今天、本周、本月的变化提醒。',
    source: 'Transit endpoints',
  },
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

      <HoroscopePanel reading={reading} />

      <ExperienceGrid />

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

function ExperienceGrid(): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[#EA1F59]">
          <Compass className="h-4 w-4" aria-hidden />
          <span>多元化命理入口</span>
        </div>
        <h2 className="mt-2 text-xl font-semibold text-[#231F20]">不只看今天，也能玩关系、心理和长期星盘</h2>
        <p className="mt-1 text-xs leading-5 text-[#8C8C8C]">
          这些入口先作为产品蓝图展示；后续按 API 能力逐个接入真实数据和 AI 解读。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {EXPERIENCE_CARDS.map(({ icon: Icon, title, body, source }) => (
          <article
            key={title}
            className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] p-4 transition hover:border-[#EA1F59]/25 hover:bg-[#EA1F59]/5"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-white text-[#57479C] shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#231F20]">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-[#595757]">{body}</p>
                <div className="mt-3 inline-flex rounded-[6px] border border-[#DCDDDD] bg-white px-2 py-1 text-[10px] font-medium text-[#8C8C8C]">
                  {source}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HoroscopePanel({
  reading,
}: {
  reading: ReturnType<typeof buildAstroReading>;
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-[#EA1F59]">
            <Sparkles className="h-4 w-4" aria-hidden />
            <span>{reading.zodiacLabel} · 今日星座运势</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-[#231F20]">总运、事业、财运、感情和身心状态</h2>
          <p className="mt-1 text-xs leading-5 text-[#8C8C8C]">
            当前为预览版日运数据；接入 AstrologyAPI 后，这里会替换为真实 provider 返回。
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[#7DD3FC]/45 bg-[#EFF6FF] px-2.5 py-1.5 text-xs font-medium text-[#0369A1]">
          <MoonStar className="h-3.5 w-3.5" aria-hidden />
          {reading.dateLabel}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {reading.fortune.map((item) => (
          <FortuneTile key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

function FortuneTile({
  item,
}: {
  item: ReturnType<typeof buildAstroReading>['fortune'][number];
}): JSX.Element {
  const tone = FORTUNE_TONE[item.key];
  const Icon = tone.icon;
  return (
    <article
      className={cn(
        'rounded-[8px] border p-4',
        tone.shell,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-[8px]', tone.iconShell)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <div className="text-xs font-medium text-[#595757]">{item.label}</div>
            <div className="text-sm font-semibold text-[#231F20]">{item.score}%</div>
          </div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/80">
        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${item.score}%` }} />
      </div>
      <h3 className="mt-4 text-base font-semibold leading-snug text-[#231F20]">{item.title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#595757]">{item.body}</p>
    </article>
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

const FORTUNE_TONE: Record<
  ReturnType<typeof buildAstroReading>['fortune'][number]['key'],
  {
    icon: typeof Sparkles;
    shell: string;
    iconShell: string;
    bar: string;
  }
> = {
  overall: {
    icon: Sparkles,
    shell: 'border-[#EA1F59]/20 bg-[#FFF6F8]',
    iconShell: 'bg-[#EA1F59]/10 text-[#EA1F59]',
    bar: 'bg-[#EA1F59]',
  },
  career: {
    icon: BriefcaseBusiness,
    shell: 'border-[#7DD3FC]/40 bg-[#F3FBFE]',
    iconShell: 'bg-[#7DD3FC]/20 text-[#0369A1]',
    bar: 'bg-[#42C0EF]',
  },
  wealth: {
    icon: WalletCards,
    shell: 'border-[#FDE68A]/70 bg-[#FFFBEB]',
    iconShell: 'bg-[#FDE68A]/40 text-[#B45309]',
    bar: 'bg-[#F59E0B]',
  },
  love: {
    icon: Heart,
    shell: 'border-[#FBCFE8]/70 bg-[#FDF2F8]',
    iconShell: 'bg-[#FBCFE8]/45 text-[#BE185D]',
    bar: 'bg-[#EC4899]',
  },
  health: {
    icon: Activity,
    shell: 'border-[#BBF7D0]/70 bg-[#F0FDF4]',
    iconShell: 'bg-[#BBF7D0]/45 text-[#15803D]',
    bar: 'bg-[#22C55E]',
  },
};
