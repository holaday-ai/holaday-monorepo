import {
  Activity,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  Eraser,
  Gauge,
  Heart,
  Loader2,
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
import { useToast } from '@/components/ui/toast';
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
import { copyTextToClipboard } from '@/lib/copy-text';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const MOODS = [
  { id: 'clear', label: '清醒', hint: '适合先做判断题' },
  { id: 'busy', label: '有点满', hint: '先把任务切小' },
  { id: 'soft', label: '慢一点', hint: '适合整理和收尾' },
] as const;

const COSMIC_EXPERIENCE_KEY = 'holaday.cosmic.experience.v1';
const COSMIC_PARTNER_KEY = 'holaday.cosmic.partner.v1';
const COSMIC_PSYCHOLOGY_KEY = 'holaday.cosmic.psychology.v1';
const COSMIC_WAITING_KEY = 'holaday.cosmic.waiting-mode.v1';

const PSYCHOLOGY_OPTIONS = [
  {
    id: 'fast',
    label: '先冲再调',
    body: '脑子里已经有方向，最怕被流程拖住。',
  },
  {
    id: 'steady',
    label: '先稳住节奏',
    body: '希望事情有条理，最好一步一步推进。',
  },
  {
    id: 'soft',
    label: '先照顾感受',
    body: '今天更在意氛围、关系和心里的松紧。',
  },
] as const;

const PSYCHOLOGY_RESULTS: Record<
  (typeof PSYCHOLOGY_OPTIONS)[number]['id'],
  { title: string; body: string; action: string }
> = {
  fast: {
    title: '行动型压力',
    body: '你现在适合用速度换清晰度。先做一个粗版本，别在开局就追求完美。',
    action: '先开一个 10 分钟小冲刺，结束后再判断要不要加深。',
  },
  steady: {
    title: '秩序型决策',
    body: '你更需要可控感。把任务拆成三步，会比临场发挥更容易进入状态。',
    action: '把最小下一步写出来，完成后再切到第二步。',
  },
  soft: {
    title: '感受型恢复',
    body: '你的注意力和情绪绑定得更紧。先降噪，再做决定，会更容易稳定输出。',
    action: '先整理桌面或喝点水，再处理最需要沟通的一件事。',
  },
};

type LocalReading = ReturnType<typeof buildAstroReading>;
type ProviderReading = Awaited<ReturnType<typeof trpc.astrology.daily.query>>;
type TarotReading = Awaited<ReturnType<typeof trpc.astrology.tarot.query>>;

interface ProviderState {
  reading: ProviderReading | null;
  tarot: TarotReading | null;
  loading: boolean;
  error: string | null;
}

const EXPERIENCE_CARDS = [
  {
    id: 'chart',
    icon: Orbit,
    title: '完整星盘',
    body: '太阳、月亮、上升、元素倾向和任务风格，生成长期个人档案。',
    status: '立即查看',
  },
  {
    id: 'compatibility',
    icon: Users,
    title: '合盘匹配',
    body: '输入对方生日，查看吸引力、摩擦点和相处建议。',
    status: '立即测算',
  },
  {
    id: 'psychology',
    icon: Brain,
    title: '心理小测试',
    body: '用 3 个轻问题看今天的压力、决策和关系倾向。',
    status: '立即测试',
  },
  {
    id: 'tarot',
    icon: Shuffle,
    title: '塔罗 / 抽卡',
    body: '等待任务时抽一张卡，给一个轻量提示和下一步行动。',
    status: '立即抽卡',
  },
  {
    id: 'numerology',
    icon: WalletCards,
    title: '数字命理',
    body: '根据生日计算生命灵数、个人年份和今天适合的节奏。',
    status: '立即计算',
  },
  {
    id: 'transit',
    icon: Activity,
    title: '流年提醒',
    body: '把本周重点变化转成今天、本周、本月的任务提醒。',
    status: '立即查看',
  },
] as const;

type ExperienceId = (typeof EXPERIENCE_CARDS)[number]['id'];
type PsychologyAnswer = (typeof PSYCHOLOGY_OPTIONS)[number]['id'];
type WaitingMode = 'energy' | 'tarot' | 'test';
type NatalSnapshot = ReturnType<typeof buildNatalSnapshot>;
type CompatibilityResult = ReturnType<typeof buildCompatibility>;
type NumerologyItem = ReturnType<typeof buildNumerology>[number];

export function AstroDashboard({
  liveProvider = false,
  profileStorageScope = null,
}: {
  liveProvider?: boolean;
  profileStorageScope?: string | null;
}): JSX.Element {
  const storageScope = profileStorageScope?.trim() || null;
  const canUseProfileStorage = !liveProvider || Boolean(storageScope);
  const [profile, setProfile] = React.useState<AstroProfile | null>(() =>
    canUseProfileStorage ? readAstroProfile(storageScope) : null,
  );
  const [cardIndex, setCardIndex] = React.useState(0);
  const [selectedMood, setSelectedMood] =
    React.useState<(typeof MOODS)[number]['id']>('clear');
  const requestIdRef = React.useRef(0);
  const [providerState, setProviderState] = React.useState<ProviderState>({
    reading: null,
    tarot: null,
    loading: false,
    error: null,
  });
  const effectiveProfile = React.useMemo(
    () => profile ?? createProfileFromBirthday({ birthday: '1996-03-21' }),
    [profile],
  );
  const localReading = React.useMemo(
    () => buildAstroReading(effectiveProfile),
    [effectiveProfile],
  );
  const reading = React.useMemo(
    () => mergeProviderReading(localReading, providerState.reading),
    [localReading, providerState.reading],
  );
  const activeCard = reading.waitingCards[cardIndex % reading.waitingCards.length];
  const activeMood = MOODS.find((mood) => mood.id === selectedMood) ?? MOODS[0];

  React.useEffect(() => {
    setProfile(canUseProfileStorage ? readAstroProfile(storageScope) : null);
  }, [canUseProfileStorage, storageScope]);

  const refreshProvider = React.useCallback(async () => {
    if (!liveProvider) {
      setProviderState({ reading: null, tarot: null, loading: false, error: null });
      return;
    }
    const requestId = ++requestIdRef.current;
    setProviderState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [remoteReading, remoteTarot] = await Promise.all([
        trpc.astrology.daily.query({
          name: effectiveProfile.name,
          birthday: effectiveProfile.birthday,
          birthTime: effectiveProfile.birthTime,
          birthPlace: effectiveProfile.birthPlace,
          zodiacSign: effectiveProfile.zodiacSign,
          locale: 'zh-CN',
        }),
        trpc.astrology.tarot.query({
          zodiacSign: effectiveProfile.zodiacSign,
          locale: 'zh-CN',
        }),
      ]);
      if (requestId !== requestIdRef.current) return;
      setProviderState({
        reading: remoteReading,
        tarot: remoteTarot,
        loading: false,
        error: null,
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setProviderState({
        reading: null,
        tarot: null,
        loading: false,
        error: pageErrorMessage(err),
      });
    }
  }, [effectiveProfile, liveProvider]);

  React.useEffect(() => {
    void refreshProvider();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refreshProvider]);

  function handleSave(next: AstroProfile): void {
    if (canUseProfileStorage) saveAstroProfile(next, storageScope);
    setProfile(next);
  }

  function handleReset(): void {
    if (canUseProfileStorage) clearAstroProfile(storageScope);
    setProfile(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <DailyEnergyPanel reading={reading} profile={profile} />
        <AstroProfilePanel profile={profile} onSave={handleSave} onReset={handleReset} />
      </div>

      <HoroscopePanel
        liveProvider={liveProvider}
        providerState={providerState}
        reading={reading}
        onRefresh={() => void refreshProvider()}
      />

      <ExperienceGrid
        profile={effectiveProfile}
        reading={reading}
        tarot={providerState.tarot}
        tarotLoading={providerState.loading}
        storageScope={storageScope}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <WaitingCardPreview
          card={activeCard}
          cardIndex={cardIndex}
          onNext={() => setCardIndex((index) => index + 1)}
          storageScope={storageScope}
        />
        <TarotPanel
          liveProvider={liveProvider}
          loading={providerState.loading}
          tarot={providerState.tarot}
          zodiacLabel={reading.zodiacLabel}
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

function mergeProviderReading(
  local: LocalReading,
  provider: ProviderReading | null,
): LocalReading {
  if (!provider) return local;
  const headline = provider.headline || local.headline;
  const workNote = provider.workNote || local.workNote;
  const luckyColor = provider.luckyColor || local.luckyColor;
  const next: LocalReading = {
    ...local,
    headline,
    workNote,
    energyScore: provider.energyScore,
    luckyColor,
    luckyWindow: provider.luckyWindow || local.luckyWindow,
    weekly: provider.weekly.length > 0 ? provider.weekly : local.weekly,
  };
  return {
    ...next,
    fortune: next.fortune.map((item) => {
      if (item.key === 'overall') {
        return {
          ...item,
          title: headline,
          body:
            provider.provider === 'divineapi'
              ? workNote
              : item.body,
        };
      }
      if (item.key === 'career') {
        return {
          ...item,
          body: workNote,
        };
      }
      if (item.key === 'wealth') {
        return {
          ...item,
          body: `适合检查订阅、预算、报价和待确认支出。幸运色 ${luckyColor} 可以当作今天的决策提醒。`,
        };
      }
      return item;
    }),
  };
}

function ExperienceGrid({
  profile,
  reading,
  tarot,
  tarotLoading,
  storageScope,
}: {
  profile: AstroProfile;
  reading: ReturnType<typeof buildAstroReading>;
  tarot: TarotReading | null;
  tarotLoading: boolean;
  storageScope: string | null;
}): JSX.Element {
  const [activeId, setActiveId] = React.useState<ExperienceId>(() =>
    readStoredExperienceId(storageScope) ?? 'chart',
  );
  const activeCard = EXPERIENCE_CARDS.find((card) => card.id === activeId) ?? EXPERIENCE_CARDS[0];
  const ActiveIcon = activeCard.icon;
  React.useEffect(() => {
    setActiveId(readStoredExperienceId(storageScope) ?? 'chart');
  }, [storageScope]);
  function selectExperience(id: ExperienceId): void {
    setActiveId(id);
    writeStoredValue(COSMIC_EXPERIENCE_KEY, storageScope, id);
  }
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[#EA1F59]">
          <Compass className="h-4 w-4" aria-hidden />
          <span>多元化命理</span>
        </div>
        <h2 className="mt-2 text-xl font-semibold text-[#231F20]">星盘、合盘、测试和提醒都能直接玩</h2>
        <p className="mt-1 text-xs leading-5 text-[#8C8C8C]">
          先用你的今日档案生成轻量结果；保存生日和出生时间后，结果会更贴近你。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {EXPERIENCE_CARDS.map(({ id, icon: Icon, title, body, status }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectExperience(id)}
            className={cn(
              'rounded-[8px] border p-4 text-left transition',
              activeId === id
                ? 'border-[#EA1F59]/40 bg-[#FFF6F8] shadow-[0_8px_24px_rgba(234,31,89,0.08)]'
                : 'border-[#EFEFEF] bg-[#FAFAFA] hover:border-[#EA1F59]/25 hover:bg-[#EA1F59]/5',
            )}
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-white text-[#57479C] shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#231F20]">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-[#595757]">{body}</p>
                <div className="mt-3 inline-flex rounded-[6px] border border-[#DCDDDD] bg-white px-2 py-1 text-[10px] font-medium text-[#8C8C8C]">
                  {status}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-white text-[#EA1F59] shadow-[0_6px_18px_rgba(15,23,42,0.05)]">
            <ActiveIcon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-base font-semibold text-[#231F20]">{activeCard.title}</h3>
            <p className="text-xs text-[#8C8C8C]">{activeCard.status}</p>
          </div>
        </div>
        <ExperienceDetail
          activeId={activeId}
          profile={profile}
          reading={reading}
          tarot={tarot}
          tarotLoading={tarotLoading}
          storageScope={storageScope}
        />
      </div>
    </section>
  );
}

function ExperienceDetail({
  activeId,
  profile,
  reading,
  tarot,
  tarotLoading,
  storageScope,
}: {
  activeId: ExperienceId;
  profile: AstroProfile;
  reading: ReturnType<typeof buildAstroReading>;
  tarot: TarotReading | null;
  tarotLoading: boolean;
  storageScope: string | null;
}): JSX.Element {
  if (activeId === 'chart') return <NatalChartFeature profile={profile} reading={reading} />;
  if (activeId === 'compatibility') return <CompatibilityFeature profile={profile} storageScope={storageScope} />;
  if (activeId === 'psychology') return <PsychologyFeature reading={reading} storageScope={storageScope} />;
  if (activeId === 'tarot') {
    return (
      <TarotCardBody
        loading={tarotLoading}
        tarot={tarot}
        zodiacLabel={reading.zodiacLabel}
      />
    );
  }
  if (activeId === 'numerology') return <NumerologyFeature profile={profile} reading={reading} />;
  return <TransitFeature reading={reading} />;
}

function NatalChartFeature({
  profile,
  reading,
}: {
  profile: AstroProfile;
  reading: ReturnType<typeof buildAstroReading>;
}): JSX.Element {
  const snapshot = React.useMemo(() => buildNatalSnapshot(profile, reading), [profile, reading]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="grid gap-3 sm:grid-cols-2">
        {snapshot.items.map((item) => (
          <div key={item.label} className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
            <div className="text-xs font-medium text-[#8C8C8C]">{item.label}</div>
            <div className="mt-1 text-lg font-semibold text-[#231F20]">{item.value}</div>
            <p className="mt-2 text-xs leading-5 text-[#595757]">{item.body}</p>
          </div>
        ))}
      </div>
      <div className="rounded-[8px] border border-[#FDE68A]/70 bg-[#FFFBEB] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#B45309]">
            <Orbit className="h-4 w-4" aria-hidden />
            长期档案建议
          </div>
          <CopyReportButton
            text={buildNatalReportText(snapshot)}
            label="复制报告"
          />
        </div>
        <h4 className="mt-3 text-base font-semibold text-[#231F20]">{snapshot.title}</h4>
        <p className="mt-2 text-sm leading-6 text-[#595757]">{snapshot.body}</p>
        <div className="mt-3 rounded-[8px] border border-white/80 bg-white/70 p-3 text-xs leading-5 text-[#595757]">
          保存出生时间和出生地后，这里会优先使用你的上升与宫位信息；没填时用生日和当前任务节奏生成稳定档案。
        </div>
      </div>
    </div>
  );
}

function CompatibilityFeature({
  profile,
  storageScope,
}: {
  profile: AstroProfile;
  storageScope: string | null;
}): JSX.Element {
  const storedPartner = React.useMemo(() => readStoredPartner(storageScope), [storageScope]);
  const [partnerName, setPartnerName] = React.useState(storedPartner.name);
  const [partnerBirthday, setPartnerBirthday] = React.useState(storedPartner.birthday);
  const [partnerSign, setPartnerSign] = React.useState<ZodiacSign>(
    storedPartner.zodiacSign,
  );
  React.useEffect(() => {
    const next = readStoredPartner(storageScope);
    setPartnerName(next.name);
    setPartnerBirthday(next.birthday);
    setPartnerSign(next.zodiacSign);
  }, [storageScope]);
  React.useEffect(() => {
    writeStoredValue(COSMIC_PARTNER_KEY, storageScope, {
      name: partnerName,
      birthday: partnerBirthday,
      zodiacSign: partnerSign,
    });
  }, [partnerBirthday, partnerName, partnerSign, storageScope]);
  const result = React.useMemo(
    () =>
      buildCompatibility(profile, {
        name: partnerName,
        birthday: partnerBirthday,
        birthTime: '',
        birthPlace: '',
        zodiacSign: partnerSign,
      }),
    [partnerBirthday, partnerName, partnerSign, profile],
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
        <div className="text-sm font-semibold text-[#231F20]">对方资料</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Field label="昵称">
            <input
              value={partnerName}
              onChange={(event) => setPartnerName(event.target.value)}
              className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            />
          </Field>
          <Field label="生日">
            <input
              type="date"
              value={partnerBirthday}
              onChange={(event) => {
                setPartnerBirthday(event.target.value);
                setPartnerSign(createProfileFromBirthday({ birthday: event.target.value }).zodiacSign);
              }}
              className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm outline-none transition focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            />
          </Field>
          <Field label="星座">
            <select
              value={partnerSign}
              onChange={(event) => setPartnerSign(event.target.value as ZodiacSign)}
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
      </div>
      <div className="rounded-[8px] border border-[#7DD3FC]/45 bg-[#EFF6FF] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-[#0369A1]">合盘结果</div>
            <h4 className="mt-1 text-xl font-semibold text-[#231F20]">{result.title}</h4>
          </div>
          <div className="flex items-center gap-2">
            <CopyReportButton
              text={buildCompatibilityReportText(result)}
              label="复制"
            />
            <div className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-[#0369A1]">
              {result.score}%
            </div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
          <div className="h-full rounded-full bg-[#42C0EF]" style={{ width: `${result.score}%` }} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {result.facets.map((facet) => (
            <div key={facet.label} className="rounded-[8px] bg-white/75 p-3">
              <div className="text-xs font-semibold text-[#0369A1]">{facet.label}</div>
              <p className="mt-1 text-xs leading-5 text-[#595757]">{facet.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm leading-6 text-[#595757]">{result.advice}</p>
      </div>
    </div>
  );
}

function PsychologyFeature({
  reading,
  storageScope,
}: {
  reading: ReturnType<typeof buildAstroReading>;
  storageScope: string | null;
}): JSX.Element {
  const [answer, setAnswer] = React.useState<'fast' | 'steady' | 'soft'>(() =>
    readStoredPsychologyAnswer(storageScope),
  );
  const result = PSYCHOLOGY_RESULTS[answer];
  React.useEffect(() => {
    setAnswer(readStoredPsychologyAnswer(storageScope));
  }, [storageScope]);
  function selectAnswer(value: 'fast' | 'steady' | 'soft'): void {
    setAnswer(value);
    writeStoredValue(COSMIC_PSYCHOLOGY_KEY, storageScope, value);
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
        <div className="text-sm font-semibold text-[#231F20]">现在遇到任务，你更像哪一种？</div>
        <div className="mt-3 grid gap-2">
          {PSYCHOLOGY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectAnswer(option.id)}
              className={cn(
                'rounded-[8px] border px-3 py-3 text-left transition',
                answer === option.id
                  ? 'border-[#EA1F59]/35 bg-[#FFF6F8] text-[#231F20]'
                  : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#EA1F59]/20 hover:bg-[#EA1F59]/5',
              )}
            >
              <div className="text-sm font-semibold">{option.label}</div>
              <div className="mt-1 text-xs leading-5">{option.body}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-[8px] border border-[#FBCFE8]/70 bg-[#FDF2F8] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#BE185D]">
            <Brain className="h-4 w-4" aria-hidden />
            今日心理画像
          </div>
          <CopyReportButton
            text={buildPsychologyReportText(result, reading)}
            label="复制"
          />
        </div>
        <h4 className="mt-3 text-xl font-semibold text-[#231F20]">{result.title}</h4>
        <p className="mt-2 text-sm leading-6 text-[#595757]">{result.body}</p>
        <div className="mt-3 rounded-[8px] bg-white/75 p-3 text-xs leading-5 text-[#595757]">
          结合今日关键词「{reading.mood}」：{result.action}
        </div>
      </div>
    </div>
  );
}

function TarotCardBody({
  loading,
  tarot,
  zodiacLabel,
}: {
  loading: boolean;
  tarot: TarotReading | null;
  zodiacLabel: string;
}): JSX.Element {
  const title = tarot?.title ?? 'The Star';
  const subtitle = tarot?.subtitle ?? '先把希望放回桌面';
  const body =
    tarot?.body ??
    `${zodiacLabel} 今天适合抽一张轻提示卡。先把问题放轻一点，选一个能马上行动的小方向。`;
  return (
    <div className="rounded-[8px] border border-[#57479C]/18 bg-[#F8F6FF] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#57479C]">
          <Sparkles className="h-4 w-4" aria-hidden />
          今日抽卡
        </div>
        <div className="flex items-center gap-2">
          <CopyReportButton
            text={buildTarotReportText({ title, subtitle, body })}
            label="复制"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#57479C]" aria-hidden />}
        </div>
      </div>
      <h3 className="mt-4 text-xl font-semibold text-[#231F20]">{title}</h3>
      <p className="mt-1 text-sm font-medium text-[#57479C]">{subtitle}</p>
      <p className="mt-3 text-sm leading-6 text-[#595757]">{body}</p>
    </div>
  );
}

function NumerologyFeature({
  profile,
  reading,
}: {
  profile: AstroProfile;
  reading: ReturnType<typeof buildAstroReading>;
}): JSX.Element {
  const numbers = React.useMemo(() => buildNumerology(profile, reading), [profile, reading]);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <CopyReportButton text={buildNumerologyReportText(numbers)} label="复制数字报告" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {numbers.map((item) => (
          <div key={item.label} className="rounded-[8px] border border-[#FDE68A]/70 bg-[#FFFBEB] p-4">
            <div className="text-xs font-semibold text-[#B45309]">{item.label}</div>
            <div className="mt-2 text-3xl font-semibold text-[#231F20]">{item.value}</div>
            <h4 className="mt-3 text-sm font-semibold text-[#231F20]">{item.title}</h4>
            <p className="mt-1 text-xs leading-5 text-[#595757]">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransitFeature({
  reading,
}: {
  reading: ReturnType<typeof buildAstroReading>;
}): JSX.Element {
  const strongest = [...reading.weekly].sort((a, b) => b.energy - a.energy).slice(0, 3);
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#57479C]">
            <Activity className="h-4 w-4" aria-hidden />
            今天 / 本周 / 本月
          </div>
          <CopyReportButton text={buildTransitReportText(reading, strongest)} label="复制" />
        </div>
        <h4 className="mt-3 text-lg font-semibold text-[#231F20]">把变化变成提醒</h4>
        <p className="mt-2 text-sm leading-6 text-[#595757]">
          今天先按「{reading.focusMode}」推进；本周优先抓能量最高的 3 天；本月把重复任务排到你的高光时段附近。
        </p>
      </div>
      <div className="grid gap-2">
        {strongest.map((day, index) => (
          <div key={day.key} className="rounded-[8px] border border-[#BBF7D0]/70 bg-[#F0FDF4] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[#231F20]">
                {index === 0 ? '重点提醒' : '辅助提醒'} · {day.label}
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#15803D]">
                {day.energy}%
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#595757]">
              {day.title}：{day.suggestion}。适合安排在 {reading.luckyWindow} 前后。
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoroscopePanel({
  liveProvider,
  providerState,
  reading,
  onRefresh,
}: {
  liveProvider: boolean;
  providerState: ProviderState;
  reading: ReturnType<typeof buildAstroReading>;
  onRefresh(): void;
}): JSX.Element {
  const providerLabel = providerStatusCopy(liveProvider, providerState);
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
            {providerLabel.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={cn('inline-flex w-fit items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-medium', providerLabel.className)}>
            {providerState.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <MoonStar className="h-3.5 w-3.5" aria-hidden />
            )}
            {providerLabel.label}
          </div>
          {liveProvider && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={providerState.loading}
            >
              <RefreshCcw className={cn('mr-1.5 h-3.5 w-3.5', providerState.loading && 'animate-spin')} aria-hidden />
              刷新
            </Button>
          )}
        </div>
      </div>
      <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[#7DD3FC]/45 bg-[#EFF6FF] px-2.5 py-1.5 text-xs font-medium text-[#0369A1]">
        <MoonStar className="h-3.5 w-3.5" aria-hidden />
        {reading.dateLabel}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {reading.fortune.map((item) => (
          <FortuneTile key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

function providerStatusCopy(
  liveProvider: boolean,
  state: ProviderState,
): { label: string; description: string; className: string } {
  if (!liveProvider) {
    return {
      label: '今日模式',
      description: '当前展示今天的轻量日运，适合快速感受页面节奏。',
      className: 'border-[#DCDDDD] bg-[#FAFAFA] text-[#595757]',
    };
  }
  if (state.loading) {
    return {
      label: '正在更新今日运势',
      description: '正在更新今天的内容；如果网络暂时不稳，会先保留当前结果。',
      className: 'border-[#7DD3FC]/45 bg-[#EFF6FF] text-[#0369A1]',
    };
  }
  if (state.error) {
    return {
      label: '暂用本地内容',
      description: '今天的内容暂时没有更新成功，先展示稳定版本。',
      className: 'border-[#FDE68A]/70 bg-[#FFFBEB] text-[#B45309]',
    };
  }
  if (state.reading?.provider === 'divineapi') {
    return {
      label: '今日运势已更新',
      description: '已同步今天的星座内容，并结合 Holaday 的任务节奏给出建议。',
      className: 'border-[#BBF7D0]/70 bg-[#F0FDF4] text-[#15803D]',
    };
  }
  return {
    label: '暂用本地内容',
    description: '今天的内容暂时没有更新成功，先展示稳定版本。',
    className: 'border-[#DCDDDD] bg-[#FAFAFA] text-[#595757]',
  };
}

function TarotPanel({
  liveProvider,
  loading,
  tarot,
  zodiacLabel,
}: {
  liveProvider: boolean;
  loading: boolean;
  tarot: TarotReading | null;
  zodiacLabel: string;
}): JSX.Element {
  const provider = tarot?.provider === 'divineapi' ? '今日牌面' : '今日牌组';
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#231F20]">今日塔罗提示</h2>
          <p className="mt-1 text-xs text-[#8C8C8C]">
            {liveProvider ? '每天给一个轻提示，适合等待任务时快速看一眼。' : '每天保留一张轻提示，适合等待任务时快速看一眼。'}
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-[8px] border border-[#DCDDDD] bg-[#FAFAFA] px-2 py-1 text-[10px] font-medium text-[#8C8C8C]">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Shuffle className="h-3 w-3" aria-hidden />}
          {provider}
        </div>
      </div>
      <TarotCardBody loading={loading} tarot={tarot} zodiacLabel={zodiacLabel} />
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
            出生时间和地点可以先空着，后续用于更完整的星盘和流年提醒。
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

function CopyReportButton({
  text,
  label,
}: {
  text: string;
  label: string;
}): JSX.Element {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);

  async function handleCopy(): Promise<void> {
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      toast.show('复制失败，请稍后重试', 'error');
      return;
    }
    setCopied(true);
    toast.show('已复制今日报告', 'info', 1800);
    globalThis.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
      {copied ? (
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? '已复制' : label}
    </Button>
  );
}

function WaitingCardPreview({
  card,
  cardIndex,
  onNext,
  storageScope,
}: {
  card: ReturnType<typeof buildAstroReading>['waitingCards'][number] | undefined;
  cardIndex: number;
  onNext(): void;
  storageScope: string | null;
}): JSX.Element {
  const [mode, setMode] = React.useState<WaitingMode>(() => readStoredWaitingMode(storageScope));
  React.useEffect(() => {
    setMode(readStoredWaitingMode(storageScope));
  }, [storageScope]);
  function selectMode(nextMode: WaitingMode): void {
    setMode(nextMode);
    writeStoredValue(COSMIC_WAITING_KEY, storageScope, nextMode);
  }
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#231F20]">任务等待模式</h2>
          <p className="mt-1 text-xs text-[#8C8C8C]">执行任务时自动出现，帮用户把等待时间变轻一点。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onNext}>
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          换一张
        </Button>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[
          { id: 'energy', label: '今日能量' },
          { id: 'tarot', label: '轻抽卡' },
          { id: 'test', label: '3 秒测试' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectMode(item.id as WaitingMode)}
            className={cn(
              'h-8 rounded-[8px] border px-2 text-xs font-medium transition',
              mode === item.id
                ? 'border-[#EA1F59]/35 bg-[#FFF6F8] text-[#EA1F59]'
                : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#EA1F59]/25',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/5 p-5">
        <div className="flex items-center gap-2 text-xs font-medium text-[#EA1F59]">
          <TimerReset className="h-4 w-4" aria-hidden />
          {mode === 'energy' ? `正在为你跑任务 · 第 ${(cardIndex % 3) + 1} 张` : mode === 'tarot' ? '等待抽卡' : '等待小测试'}
        </div>
        <h3 className="mt-4 text-xl font-semibold text-[#231F20]">
          {mode === 'energy' ? (card?.title ?? '任务正在跑') : mode === 'tarot' ? '先抽一张轻提示' : '你现在更想要哪种等待节奏？'}
        </h3>
        <p className="mt-3 text-sm leading-6 text-[#595757]">
          {mode === 'energy'
            ? (card?.body ?? '先喝口水，结果马上回来。')
            : mode === 'tarot'
              ? '等任务跑完前，先给自己一个很小的下一步提示。'
              : '快一点、稳一点、放轻一点，选完会给一条即时建议。'}
        </p>
        <button
          type="button"
          className="mt-5 inline-flex h-8 items-center rounded-[8px] border border-[#EA1F59]/25 bg-white px-3 text-xs font-medium text-[#EA1F59] transition hover:bg-[#EA1F59]/10"
          onClick={onNext}
        >
          {mode === 'energy' ? (card?.cta ?? '继续') : mode === 'tarot' ? '抽一张' : '开始小测试'}
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

function buildNatalSnapshot(
  profile: AstroProfile,
  reading: ReturnType<typeof buildAstroReading>,
): {
  title: string;
  body: string;
  items: Array<{ label: string; value: string; body: string }>;
} {
  const seed = localSeed(`${profile.birthday}-${profile.birthTime}-${profile.birthPlace}`);
  const signs = zodiacOptions();
  const moon = signs[(seed + 3) % signs.length] ?? signs[0];
  const rising = profile.birthTime
    ? (signs[(seed + Number(profile.birthTime.replace(':', ''))) % signs.length] ?? signs[0])
    : null;
  const element = pickLocal(seed, ['火象行动力', '土象稳定感', '风象连接力', '水象感受力']);
  const mode = pickLocal(seed + 7, ['启动型', '固定型', '变动型']);
  return {
    title: `${reading.zodiacLabel} 的任务档案：${reading.focusMode}`,
    body: `你的长期节奏适合先抓「${reading.mood}」这条主线。今天可以用 ${reading.luckyColor} 或 ${reading.luckyWindow} 作为进入状态的小锚点。`,
    items: [
      {
        label: '太阳星座',
        value: reading.zodiacLabel,
        body: `外在行动主题是「${reading.mood}」，适合用明确目标推进任务。`,
      },
      {
        label: '月亮倾向',
        value: moon?.label ?? reading.zodiacLabel,
        body: '代表情绪恢复方式；等待任务时更适合先照顾状态，再处理判断。',
      },
      {
        label: '上升倾向',
        value: rising?.label ?? '待补充出生时间',
        body: rising ? '代表你进入新任务时给人的第一印象。' : '补充出生时间后，这项会更准确。',
      },
      {
        label: '元素 / 模式',
        value: `${element} · ${mode}`,
        body: `适合把任务拆成「${reading.focusMode}」的小节奏，减少临场消耗。`,
      },
    ],
  };
}

function buildCompatibility(
  profile: AstroProfile,
  partner: AstroProfile,
): {
  score: number;
  title: string;
  advice: string;
  facets: Array<{ label: string; body: string }>;
} {
  const seed = localSeed(`${profile.zodiacSign}-${partner.zodiacSign}-${partner.birthday}`);
  const score = 58 + (seed % 36);
  const partnerLabel =
    zodiacOptions().find((option) => option.value === partner.zodiacSign)?.label ?? '对方';
  return {
    score,
    title: `${partner.name || partnerLabel}：${score >= 78 ? '很容易互相点亮' : score >= 68 ? '适合慢慢磨合' : '需要先对齐节奏'}`,
    advice:
      score >= 78
        ? '适合一起推进有明确目标的事，但也要给彼此留一点自由空间。'
        : score >= 68
          ? '吸引力在，摩擦也会出现。先约定沟通频率，比猜对方想法更有效。'
          : '先把边界和期待讲清楚，少用情绪推断，多用具体问题对齐。',
    facets: [
      {
        label: '吸引力',
        body: pickLocal(seed, ['容易被对方的表达吸引。', '对方会带来不同视角。', '互动有新鲜感，但节奏要慢一点。']),
      },
      {
        label: '摩擦点',
        body: pickLocal(seed + 5, ['容易抢节奏。', '容易一个想快、一个想稳。', '容易把沉默误会成冷淡。']),
      },
      {
        label: '相处建议',
        body: pickLocal(seed + 9, ['先说目标，再说情绪。', '把约定写下来更稳。', '给彼此一个缓冲时间。']),
      },
    ],
  };
}

function buildNumerology(
  profile: AstroProfile,
  reading: ReturnType<typeof buildAstroReading>,
): Array<{ label: string; value: number; title: string; body: string }> {
  const lifePath = reduceNumber(profile.birthday.replace(/-/g, ''));
  const year = new Date().getFullYear();
  const [, month = '1', day = '1'] = profile.birthday.split('-');
  const personalYear = reduceNumber(`${year}${month}${day}`);
  const dailyNumber = reduceNumber(`${lifePath}${personalYear}${reading.energyScore}`);
  return [
    {
      label: '生命灵数',
      value: lifePath,
      title: NUMEROLOGY_COPY[lifePath]?.title ?? '自我节奏',
      body: NUMEROLOGY_COPY[lifePath]?.body ?? '适合按自己的稳定节奏推进。',
    },
    {
      label: '个人年份',
      value: personalYear,
      title: `${year} 年主题`,
      body: pickLocal(personalYear, ['适合开新局。', '适合打基础。', '适合表达和扩散。', '适合整理秩序。', '适合尝试新方向。']),
    },
    {
      label: '今日行动数',
      value: dailyNumber,
      title: '今天怎么做',
      body: `配合今日关键词「${reading.mood}」，先完成一个看得见的小动作。`,
    },
  ];
}

const NUMEROLOGY_COPY: Record<number, { title: string; body: string }> = {
  1: { title: '启动者', body: '适合先开局、先定方向，不要等别人推你。' },
  2: { title: '协调者', body: '适合沟通、配合、修复关系里的细节。' },
  3: { title: '表达者', body: '适合输出、展示、写作和创意整理。' },
  4: { title: '建设者', body: '适合打底、归档、做流程和长期维护。' },
  5: { title: '探索者', body: '适合尝试新方法，但要给自己设一个边界。' },
  6: { title: '照料者', body: '适合处理家庭、团队和责任相关的事。' },
  7: { title: '研究者', body: '适合深度思考、复盘和独立判断。' },
  8: { title: '推进者', body: '适合目标、资源、预算和结果导向的任务。' },
  9: { title: '整合者', body: '适合收尾、放下旧负担，把经验整理出来。' },
};

function reduceNumber(value: string): number {
  let total = value
    .replace(/\D/g, '')
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
  while (total > 9) {
    total = String(total)
      .split('')
      .reduce((sum, digit) => sum + Number(digit), 0);
  }
  return total || 1;
}

function localSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickLocal<T>(seed: number, values: T[]): T {
  return values[seed % values.length] ?? values[0];
}

function scopedStorageKey(base: string, scope: string | null): string {
  const normalized = scope?.trim();
  return normalized ? `${base}.${encodeURIComponent(normalized)}` : base;
}

function readStoredString(base: string, scope: string | null): string | null {
  try {
    return globalThis.localStorage?.getItem(scopedStorageKey(base, scope)) ?? null;
  } catch {
    return null;
  }
}

function writeStoredValue(base: string, scope: string | null, value: unknown): void {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    globalThis.localStorage?.setItem(scopedStorageKey(base, scope), serialized);
  } catch {
    // Storage can be blocked in private contexts; the UI should still work.
  }
}

function readStoredExperienceId(scope: string | null): ExperienceId | null {
  const raw = readStoredString(COSMIC_EXPERIENCE_KEY, scope);
  return EXPERIENCE_CARDS.some((card) => card.id === raw) ? (raw as ExperienceId) : null;
}

function readStoredPartner(scope: string | null): {
  name: string;
  birthday: string;
  zodiacSign: ZodiacSign;
} {
  const fallback = createProfileFromBirthday({
    name: '对方',
    birthday: '1996-08-08',
  });
  const raw = readStoredString(COSMIC_PARTNER_KEY, scope);
  if (!raw) {
    return {
      name: fallback.name,
      birthday: fallback.birthday,
      zodiacSign: fallback.zodiacSign,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AstroProfile>;
    const birthday = isDateInputValue(parsed.birthday) ? parsed.birthday : fallback.birthday;
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallback.name,
      birthday,
      zodiacSign: isZodiacSign(parsed.zodiacSign)
        ? parsed.zodiacSign
        : createProfileFromBirthday({ birthday }).zodiacSign,
    };
  } catch {
    return {
      name: fallback.name,
      birthday: fallback.birthday,
      zodiacSign: fallback.zodiacSign,
    };
  }
}

function readStoredPsychologyAnswer(scope: string | null): PsychologyAnswer {
  const raw = readStoredString(COSMIC_PSYCHOLOGY_KEY, scope);
  return PSYCHOLOGY_OPTIONS.some((option) => option.id === raw)
    ? (raw as PsychologyAnswer)
    : 'steady';
}

function readStoredWaitingMode(scope: string | null): WaitingMode {
  const raw = readStoredString(COSMIC_WAITING_KEY, scope);
  return raw === 'tarot' || raw === 'test' || raw === 'energy' ? raw : 'energy';
}

function isZodiacSign(value: unknown): value is ZodiacSign {
  return typeof value === 'string' && zodiacOptions().some((option) => option.value === value);
}

function isDateInputValue(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildNatalReportText(snapshot: NatalSnapshot): string {
  return [
    '今日星盘档案',
    snapshot.title,
    snapshot.body,
    '',
    ...snapshot.items.map((item) => `${item.label}：${item.value}。${item.body}`),
  ].join('\n');
}

function buildCompatibilityReportText(result: CompatibilityResult): string {
  return [
    '今日合盘结果',
    `${result.title}（${result.score}%）`,
    result.advice,
    '',
    ...result.facets.map((facet) => `${facet.label}：${facet.body}`),
  ].join('\n');
}

function buildPsychologyReportText(
  result: (typeof PSYCHOLOGY_RESULTS)[PsychologyAnswer],
  reading: ReturnType<typeof buildAstroReading>,
): string {
  return [
    '今日心理画像',
    result.title,
    result.body,
    `结合今日关键词「${reading.mood}」：${result.action}`,
  ].join('\n');
}

function buildTarotReportText(card: { title: string; subtitle: string; body: string }): string {
  return ['今日抽卡', card.title, card.subtitle, card.body].join('\n');
}

function buildNumerologyReportText(items: NumerologyItem[]): string {
  return [
    '今日数字命理',
    ...items.map((item) => `${item.label} ${item.value}：${item.title}。${item.body}`),
  ].join('\n');
}

function buildTransitReportText(
  reading: ReturnType<typeof buildAstroReading>,
  strongest: AstroDay[],
): string {
  return [
    '今日流年提醒',
    `今天先按「${reading.focusMode}」推进，适合安排在 ${reading.luckyWindow} 前后。`,
    '',
    ...strongest.map((day) => `${day.label}：${day.title}，${day.suggestion}（${day.energy}%）`),
  ].join('\n');
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
