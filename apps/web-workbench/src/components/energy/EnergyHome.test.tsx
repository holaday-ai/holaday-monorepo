// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyHome } from './EnergyHome';

const trpcMocks = vi.hoisted(() => ({
  homeQuery: vi.fn(),
  reportEvent: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    energy: {
      home: { query: trpcMocks.homeQuery },
      reportEvent: { mutate: trpcMocks.reportEvent },
    },
  },
}));

beforeEach(() => {
  trpcMocks.homeQuery.mockResolvedValue({
    experiences: [
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
        description: '轻量小游戏正在准备中',
        estimatedSeconds: 180,
        status: 'coming-soon',
        actionable: false,
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
  it('keeps one primary recommendation and makes the future game non-interactive', async () => {
    render(<EnergyHome profileStorageScope="usr_energy" />);

    expect(screen.getByRole('heading', { name: '你现在感觉怎么样？' })).toBeTruthy();
    const moodGroup = screen.getByRole('group', { name: '当前状态' });
    expect(within(moodGroup).getAllByRole('button', { pressed: false })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /开始|抽一张|看看/ })).toHaveLength(1);
    expect(screen.getByText('小游戏正在准备中')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /小游戏/ })).toBeNull();

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
        mood: 'tired',
      }),
    );
  });
});
