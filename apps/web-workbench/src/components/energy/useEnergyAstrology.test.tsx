// @vitest-environment happy-dom

import { createProfileFromBirthday } from '@/lib/astrology';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEnergyAstrology } from './useEnergyAstrology';

const trpcMocks = vi.hoisted(() => ({
  daily: vi.fn(),
  tarot: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    astrology: {
      daily: { query: trpcMocks.daily },
      tarot: { query: trpcMocks.tarot },
    },
  },
}));

function remoteReading(zodiacSign: 'aries' | 'taurus', headline: string) {
  return {
    provider: 'divineapi' as const,
    apiConfigured: true,
    zodiacSign,
    zodiacLabel: zodiacSign === 'aries' ? '白羊座' : '金牛座',
    dateLabel: '8月11日星期二',
    headline,
    workNote: `${headline}的工作提示`,
    energyScore: zodiacSign === 'aries' ? 81 : 73,
    luckyColor: zodiacSign === 'aries' ? '远端红' : '远端绿',
    luckyWindow: '10:00 - 11:00',
    weekly: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  trpcMocks.daily.mockReset();
  trpcMocks.tarot.mockReset();
});

afterEach(cleanup);

describe('useEnergyAstrology', () => {
  it('merges successful provider reading and tarot responses', async () => {
    trpcMocks.daily.mockResolvedValue(remoteReading('aries', '远端今日提示'));
    trpcMocks.tarot.mockResolvedValue({
      provider: 'divineapi',
      apiConfigured: true,
      title: 'The Sun',
      subtitle: '把光带回来',
      body: '先完成一件让自己有力量的小事。',
    });
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe('provider');
    expect(result.current.error).toBeNull();
    expect(result.current.reading.headline).toBe('远端今日提示');
    expect(result.current.reading.fortune.find((item) => item.key === 'career')?.body).toBe(
      '远端今日提示的工作提示',
    );
    expect(result.current.tarot.title).toBe('The Sun');
  });

  it('keeps deterministic local content when the provider rejects', async () => {
    trpcMocks.daily.mockRejectedValue(new Error('provider unavailable'));
    trpcMocks.tarot.mockRejectedValue(new Error('provider unavailable'));
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe('local-fallback');
    expect(result.current.error).toBe('暂时使用本地提示');
    expect(result.current.reading.zodiacLabel).toBe('白羊座');
    expect(result.current.tarot.title).toBe('The Star');
  });

  it('does not let an older profile request overwrite the latest profile', async () => {
    const ariesDaily = deferred<ReturnType<typeof remoteReading>>();
    const taurusDaily = deferred<ReturnType<typeof remoteReading>>();
    const ariesTarot = deferred<{ title: string; subtitle: string; body: string }>();
    const taurusTarot = deferred<{ title: string; subtitle: string; body: string }>();
    trpcMocks.daily.mockImplementation(({ zodiacSign }: { zodiacSign: string }) =>
      zodiacSign === 'aries' ? ariesDaily.promise : taurusDaily.promise,
    );
    trpcMocks.tarot.mockImplementation(({ zodiacSign }: { zodiacSign: string }) =>
      zodiacSign === 'aries' ? ariesTarot.promise : taurusTarot.promise,
    );
    const aries = createProfileFromBirthday({ birthday: '1996-03-21' });
    const taurus = createProfileFromBirthday({ birthday: '1996-04-21' });

    const { result, rerender } = renderHook(({ profile }) => useEnergyAstrology(profile, true), {
      initialProps: { profile: aries },
    });
    rerender({ profile: taurus });

    await act(async () => {
      taurusDaily.resolve(remoteReading('taurus', '最新金牛提示'));
      taurusTarot.resolve({ title: 'The World', subtitle: '新的节奏', body: '保留最新结果。' });
      await Promise.all([taurusDaily.promise, taurusTarot.promise]);
    });
    await waitFor(() => expect(result.current.reading.headline).toBe('最新金牛提示'));

    await act(async () => {
      ariesDaily.resolve(remoteReading('aries', '过期白羊提示'));
      ariesTarot.resolve({ title: 'The Tower', subtitle: '过期结果', body: '不应覆盖。' });
      await Promise.all([ariesDaily.promise, ariesTarot.promise]);
    });

    expect(result.current.reading.headline).toBe('最新金牛提示');
    expect(result.current.tarot.title).toBe('The World');
  });
});
