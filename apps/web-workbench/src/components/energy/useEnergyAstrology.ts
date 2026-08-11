import { type AstroProfile, type AstroReading, buildAstroReading } from '@/lib/astrology';
import { trpc } from '@/lib/trpc';
import * as React from 'react';

type ProviderReading = Awaited<ReturnType<typeof trpc.astrology.daily.query>>;
type ProviderTarot = Awaited<ReturnType<typeof trpc.astrology.tarot.query>>;

export interface EnergyTarotReading {
  title: string;
  subtitle: string;
  body: string;
}

export interface EnergyAstrologyState {
  reading: AstroReading;
  tarot: EnergyTarotReading;
  source: 'provider' | 'local-fallback';
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

type EnergyAstrologySnapshot = Omit<EnergyAstrologyState, 'refresh'>;

export function useEnergyAstrology(
  profile: AstroProfile,
  liveProvider: boolean,
): EnergyAstrologyState {
  const localReading = React.useMemo(() => buildAstroReading(profile), [profile]);
  const localTarot = React.useMemo(() => buildLocalTarot(localReading), [localReading]);
  const requestIdRef = React.useRef(0);
  const [state, setState] = React.useState<EnergyAstrologySnapshot>(() => ({
    reading: localReading,
    tarot: localTarot,
    source: 'local-fallback',
    loading: false,
    error: null,
  }));

  const refresh = React.useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    if (!liveProvider) {
      setState({
        reading: localReading,
        tarot: localTarot,
        source: 'local-fallback',
        loading: false,
        error: null,
      });
      return;
    }

    setState({
      reading: localReading,
      tarot: localTarot,
      source: 'local-fallback',
      loading: true,
      error: null,
    });

    try {
      const [remoteReading, remoteTarot] = await Promise.all([
        trpc.astrology.daily.query({
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
        source: 'provider',
        loading: false,
        error: null,
      });
    } catch {
      if (requestId !== requestIdRef.current) return;
      setState({
        reading: localReading,
        tarot: localTarot,
        source: 'local-fallback',
        loading: false,
        error: '暂时使用本地提示',
      });
    }
  }, [liveProvider, localReading, localTarot, profile]);

  React.useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return React.useMemo(() => ({ ...state, refresh }), [refresh, state]);
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
