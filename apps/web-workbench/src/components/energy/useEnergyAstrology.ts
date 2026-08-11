import { type AstroProfile, type AstroReading, buildAstroReading } from '@/lib/astrology';
import { trpc } from '@/lib/trpc';
import * as React from 'react';

type ProviderReading = Awaited<ReturnType<typeof trpc.astrology.daily.query>>;
type ProviderWeekly = Awaited<ReturnType<typeof trpc.astrology.weekly.query>>;
type ProviderTarot = Awaited<ReturnType<typeof trpc.astrology.tarot.query>>;
type ProviderYesNoTarot = Awaited<ReturnType<typeof trpc.astrology.yesNoTarot.query>>;

export interface EnergyTarotReading {
  title: string;
  subtitle: string;
  body: string;
}

export interface EnergyWeeklyReading {
  weekLabel: string;
  personal: string;
  health: string;
  profession: string;
  emotions: string;
  travel: string;
  luck: string;
  luckyColors: string[];
}

export interface EnergyYesNoTarotReading {
  answer: 'yes' | 'no' | 'maybe';
  card: string;
  category: string;
  result: string;
}

export interface EnergyAstrologyState {
  reading: AstroReading;
  tarot: EnergyTarotReading;
  weekly: EnergyWeeklyReading;
  yesNoTarot: EnergyYesNoTarotReading | null;
  yesNoLoading: boolean;
  source: 'provider' | 'local-fallback';
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  drawYesNoTarot: () => Promise<void>;
}

type EnergyAstrologySnapshot = Pick<
  EnergyAstrologyState,
  'reading' | 'tarot' | 'weekly' | 'source' | 'loading' | 'error'
>;

export function useEnergyAstrology(
  profile: AstroProfile,
  liveProvider: boolean,
): EnergyAstrologyState {
  const localReading = React.useMemo(() => buildAstroReading(profile), [profile]);
  const localTarot = React.useMemo(() => buildLocalTarot(localReading), [localReading]);
  const localWeekly = React.useMemo(() => buildLocalWeekly(localReading), [localReading]);
  const localYesNoTarot = React.useMemo(() => buildLocalYesNoTarot(localReading), [localReading]);
  const requestIdRef = React.useRef(0);
  const yesNoRequestIdRef = React.useRef(0);
  const [state, setState] = React.useState<EnergyAstrologySnapshot>(() => ({
    reading: localReading,
    tarot: localTarot,
    weekly: localWeekly,
    source: 'local-fallback',
    loading: false,
    error: null,
  }));
  const [yesNoTarot, setYesNoTarot] = React.useState<EnergyYesNoTarotReading | null>(null);
  const [yesNoLoading, setYesNoLoading] = React.useState(false);

  const refresh = React.useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    if (!liveProvider) {
      setState({
        reading: localReading,
        tarot: localTarot,
        weekly: localWeekly,
        source: 'local-fallback',
        loading: false,
        error: null,
      });
      return;
    }

    setState({
      reading: localReading,
      tarot: localTarot,
      weekly: localWeekly,
      source: 'local-fallback',
      loading: true,
      error: null,
    });

    try {
      const [remoteReading, remoteWeekly, remoteTarot] = await Promise.all([
        trpc.astrology.daily.query({
          name: profile.name,
          birthday: profile.birthday,
          birthTime: profile.birthTime,
          birthPlace: profile.birthPlace,
          zodiacSign: profile.zodiacSign,
          locale: 'zh-CN',
        }),
        trpc.astrology.weekly.query({
          name: profile.name,
          birthday: profile.birthday,
          birthTime: profile.birthTime,
          birthPlace: profile.birthPlace,
          zodiacSign: profile.zodiacSign,
          locale: 'zh-CN',
        }),
        trpc.astrology.tarot.query({
          zodiacSign: profile.zodiacSign,
          locale: 'zh-CN',
        }),
      ]);
      if (requestId !== requestIdRef.current) return;
      setState({
        reading: mergeProviderReading(localReading, remoteReading),
        tarot: providerTarot(remoteTarot),
        weekly: providerWeekly(remoteWeekly),
        source: 'provider',
        loading: false,
        error: null,
      });
    } catch {
      if (requestId !== requestIdRef.current) return;
      setState({
        reading: localReading,
        tarot: localTarot,
        weekly: localWeekly,
        source: 'local-fallback',
        loading: false,
        error: '暂时使用本地提示',
      });
    }
  }, [liveProvider, localReading, localTarot, localWeekly, profile]);

  const drawYesNoTarot = React.useCallback(async (): Promise<void> => {
    const requestId = ++yesNoRequestIdRef.current;
    if (!liveProvider) {
      setYesNoTarot(localYesNoTarot);
      setYesNoLoading(false);
      return;
    }

    setYesNoLoading(true);
    try {
      const remote = await trpc.astrology.yesNoTarot.query({
        zodiacSign: profile.zodiacSign,
        locale: 'zh-CN',
      });
      if (requestId !== yesNoRequestIdRef.current) return;
      setYesNoTarot(providerYesNoTarot(remote));
    } catch {
      if (requestId !== yesNoRequestIdRef.current) return;
      setYesNoTarot(localYesNoTarot);
    } finally {
      if (requestId === yesNoRequestIdRef.current) setYesNoLoading(false);
    }
  }, [liveProvider, localYesNoTarot, profile.zodiacSign]);

  React.useEffect(() => {
    if (!profile.zodiacSign) return;
    yesNoRequestIdRef.current += 1;
    setYesNoTarot(null);
    setYesNoLoading(false);
  }, [profile.zodiacSign]);

  React.useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return React.useMemo(
    () => ({ ...state, refresh, yesNoTarot, yesNoLoading, drawYesNoTarot }),
    [drawYesNoTarot, refresh, state, yesNoLoading, yesNoTarot],
  );
}

function buildLocalTarot(reading: AstroReading): EnergyTarotReading {
  return {
    title: 'The Star',
    subtitle: '先把希望放回桌面',
    body: `${reading.zodiacLabel} 今天适合抽一张轻提示卡。先把问题放轻一点，选一个能马上行动的小方向。`,
  };
}

function providerTarot(tarot: ProviderTarot): EnergyTarotReading {
  return {
    title: tarot.title,
    subtitle: tarot.subtitle,
    body: tarot.body,
  };
}

function buildLocalWeekly(reading: AstroReading): EnergyWeeklyReading {
  return {
    weekLabel: '本周能量',
    personal: reading.headline,
    health: '把休息也当成计划的一部分，给身体留一点恢复时间。',
    profession: reading.workNote,
    emotions: '先看见感受，再决定今天要回应到什么程度。',
    travel: '安排保留一点弹性，临时变化也不会打乱整体节奏。',
    luck: '从一个小实验开始，真实反馈会带来下一步线索。',
    luckyColors: [reading.luckyColor],
  };
}

function buildLocalYesNoTarot(reading: AstroReading): EnergyYesNoTarotReading {
  return {
    answer: 'maybe',
    card: 'Temperance',
    category: 'Major Arcana',
    result: `${reading.zodiacLabel}今天更适合先补足一个关键信息，再做决定。`,
  };
}

function providerWeekly(weekly: ProviderWeekly): EnergyWeeklyReading {
  return {
    weekLabel: weekly.weekLabel,
    personal: weekly.personal,
    health: weekly.health,
    profession: weekly.profession,
    emotions: weekly.emotions,
    travel: weekly.travel,
    luck: weekly.luck,
    luckyColors: weekly.luckyColors,
  };
}

function providerYesNoTarot(tarot: ProviderYesNoTarot): EnergyYesNoTarotReading {
  return {
    answer: tarot.answer,
    card: tarot.card,
    category: tarot.category,
    result: tarot.result,
  };
}

function mergeProviderReading(local: AstroReading, provider: ProviderReading): AstroReading {
  const headline = provider.headline || local.headline;
  const workNote = provider.workNote || local.workNote;
  const luckyColor = provider.luckyColor || local.luckyColor;
  const next: AstroReading = {
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
          body: provider.provider === 'divineapi' ? workNote : item.body,
        };
      }
      if (item.key === 'career') return { ...item, body: workNote };
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
