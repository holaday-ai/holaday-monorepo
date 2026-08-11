// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyHome } from './EnergyHome';
import { readEnergyProgress } from './energy-progress';

const trpcMocks = vi.hoisted(() => ({
  homeQuery: vi.fn(),
  reportEvent: vi.fn(),
}));
const progressStorage = new Map<string, string>();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    energy: {
      home: { query: trpcMocks.homeQuery },
      reportEvent: { mutate: trpcMocks.reportEvent },
    },
  },
}));

beforeEach(() => {
  progressStorage.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => progressStorage.get(key) ?? null,
      setItem: (key: string, value: string) => progressStorage.set(key, value),
    },
  });
  trpcMocks.homeQuery.mockResolvedValue({
    experiences: [
      {
        id: 'recharge',
        kind: 'ritual',
        title: '30 秒补给',
        description: '跟着三段光点找回一点能量',
        estimatedSeconds: 30,
        status: 'active',
        actionable: true,
      },
      {
        id: 'tarot',
        kind: 'card',
        title: '抽张卡',
        description: '给当下一个轻提示',
        estimatedSeconds: 30,
        status: 'active',
        actionable: true,
      },
      {
        id: 'light-test',
        kind: 'test',
        title: '轻测试',
        description: '用一分钟看见现在的状态',
        estimatedSeconds: 60,
        status: 'active',
        actionable: true,
      },
      {
        id: 'horoscope',
        kind: 'horoscope',
        title: '今日星座',
        description: '看看今天适合怎样安排节奏',
        estimatedSeconds: 60,
        status: 'active',
        actionable: true,
      },
      {
        id: 'games',
        kind: 'game',
        title: '小游戏',
        description: '接住十二颗轻盈的能量光点',
        estimatedSeconds: 45,
        status: 'active',
        actionable: true,
      },
    ],
  });
  trpcMocks.reportEvent.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EnergyHome', () => {
  it('opens the recharge ritual with the selected need and records completion', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '放松' }));
    await user.click(screen.getByRole('button', { name: '开始 30 秒补给' }));
    expect(screen.getByRole('dialog', { name: '30 秒补给' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '开始体验' }));
    await user.click(await screen.findByRole('button', { name: '立即完成' }));

    expect(screen.getByRole('heading', { name: '放松能量已点亮' })).toBeTruthy();
    expect(readEnergyProgress('usr_energy').collectedKinds).toEqual(['recharge']);
    expect(trpcMocks.reportEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completed',
        experienceId: 'recharge',
        energyNeed: 'relax',
      }),
    );
  });

  it('keeps one primary recharge and exposes every active secondary experience', async () => {
    render(<EnergyHome profileStorageScope="usr_energy" />);

    expect(screen.getByRole('heading', { name: '你现在感觉怎么样？' })).toBeTruthy();
    const moodGroup = screen.getByRole('group', { name: '当前状态' });
    expect(within(moodGroup).getAllByRole('button', { pressed: false })).toHaveLength(4);
    const primaryAction = screen.getByRole('button', { name: '开始 30 秒补给' });
    expect(primaryAction.className).toContain('min-h-11');
    const modeActions = screen.getAllByRole('button', {
      name: /打开(抽张卡|轻测试|今日星座|小游戏)/,
    });
    expect(modeActions).toHaveLength(4);
    expect(modeActions.every((action) => action.className.includes('min-h-11'))).toBe(true);

    await userEvent.setup().click(screen.getByRole('button', { name: '打开小游戏 45 秒' }));
    expect(screen.getByRole('dialog', { name: '小游戏' })).toBeTruthy();

    await waitFor(() => expect(trpcMocks.homeQuery).toHaveBeenCalledOnce());
  });

  it('updates the response in place and recommends only tarot when tired', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    const tired = screen.getByRole('button', { name: '有点累' });
    await user.click(tired);

    expect(tired.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: '先让自己松一点' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /抽一张/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '抽一张轻提示卡' }));
    expect(screen.getByRole('dialog', { name: '抽张卡' })).toBeTruthy();
    expect(trpcMocks.reportEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'started',
        experienceId: 'tarot',
        energyNeed: 'relax',
      }),
    );

    await user.click(screen.getByRole('button', { name: '开始体验' }));
    expect(await screen.findByRole('heading', { name: '这张卡想回应什么？' })).toBeTruthy();
  });

  it('supports Tab, Shift+Tab, Enter, and Escape through the primary flow', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    const focus = screen.getByRole('button', { name: '专注' });
    const relax = screen.getByRole('button', { name: '放松' });
    await user.tab();
    expect(document.activeElement).toBe(focus);
    await user.tab();
    expect(document.activeElement).toBe(relax);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(focus);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(relax.getAttribute('aria-pressed')).toBe('true');

    await user.tab();
    await user.tab();
    await user.tab();
    const primary = screen.getByRole('button', { name: '开始 30 秒补给' });
    expect(document.activeElement).toBe(primary);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '开始体验' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(primary);
  });
});
