// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyHome } from './EnergyHome';
import {
  readEnergyProgress,
  recordEnergyCompletion,
  saveEnergyCardIds,
  saveLastEnergyTarget,
  saveLightTestAction,
  toggleFavoriteEnergyContent,
} from './energy-progress';

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
  vi.doUnmock('./experiences/TarotExperience');
  vi.clearAllMocks();
});

describe('EnergyHome', () => {
  it('reports one home view for a stable authenticated scope', async () => {
    const { rerender } = render(<EnergyHome profileStorageScope="usr_energy" />);

    rerender(<EnergyHome profileStorageScope="usr_energy" />);

    await waitFor(() =>
      expect(
        trpcMocks.reportEvent.mock.calls.filter(
          ([event]) => event.type === 'energy_home_viewed',
        ),
      ).toHaveLength(1),
    );
  });

  it('reports only real need changes and never the initial default', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);
    await waitFor(() =>
      expect(
        trpcMocks.reportEvent.mock.calls.some(([event]) => event.type === 'energy_home_viewed'),
      ).toBe(true),
    );
    trpcMocks.reportEvent.mockClear();

    await user.click(screen.getByRole('button', { name: '专注' }));
    await user.click(screen.getByRole('button', { name: '放松' }));
    await user.click(screen.getByRole('button', { name: '放松' }));

    expect(
      trpcMocks.reportEvent.mock.calls
        .filter(([event]) => event.type === 'energy_need_selected')
        .map(([event]) => event.energyNeed),
    ).toEqual(['relax']);
  });

  it('keeps public preview interactions local without querying protected energy services', async () => {
    const user = userEvent.setup();
    render(<EnergyHome liveProvider={false} profileStorageScope={null} />);

    expect(trpcMocks.homeQuery).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '玩接住能量' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));

    expect(await screen.findByRole('button', { name: '接住第 1 个能量光点' })).toBeTruthy();
    expect(trpcMocks.reportEvent).not.toHaveBeenCalled();
  });

  it('renders the selected recharge hierarchy with three active playful choices', async () => {
    const { container } = render(<EnergyHome profileStorageScope="usr_energy" />);

    expect(screen.getByRole('heading', { name: '今天想补哪一种能量？' })).toBeTruthy();
    const deck = screen.getByRole('region', { name: '选一个轻松玩法' });
    expect(within(deck).getByRole('button', { name: '抽一张能量卡' })).toBeTruthy();
    expect(within(deck).getByRole('button', { name: '玩接住能量' })).toBeTruthy();
    expect(within(deck).getByRole('button', { name: '做一个轻测试' })).toBeTruthy();
    expect(within(deck).getAllByRole('button')).toHaveLength(3);
    const insightGrid = container.querySelector('.energy-insight-grid');
    expect(insightGrid).toBeTruthy();
    expect(
      within(insightGrid as HTMLElement).getByRole('region', { name: '今日能量成长' }),
    ).toBeTruthy();
    expect(
      within(insightGrid as HTMLElement).getByRole('region', { name: '你的星座能量' }),
    ).toBeTruthy();
    expect(screen.queryByText('你现在感觉怎么样？')).toBeNull();
    expect(screen.queryByText('轻松一点的几分钟')).toBeNull();
    expect(screen.queryByRole('button', { name: /有帮助|没帮助/ })).toBeNull();
    const exploreFeed = screen.getByRole('region', { name: '再逛一会' });
    expect(within(exploreFeed).getAllByRole('article')).toHaveLength(6);
    expect(exploreFeed.querySelectorAll('article[data-layout="hero"]')).toHaveLength(1);
    expect(exploreFeed.querySelectorAll('article[data-layout="portrait"]')).toHaveLength(2);
    expect(exploreFeed.querySelectorAll('article[data-layout="landscape"]')).toHaveLength(3);

    await waitFor(() => expect(trpcMocks.homeQuery).toHaveBeenCalledOnce());
  });

  it('completes a selected 30-second recharge and lights the growth record', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '放松' }));
    await user.click(screen.getByRole('button', { name: '开始 30 秒补给' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    await user.click(await screen.findByRole('button', { name: '立即完成' }));

    expect(screen.getByRole('heading', { name: '放松能量已点亮' })).toBeTruthy();
    expect(readEnergyProgress('usr_energy').collectedKinds).toEqual(['recharge']);
    expect(trpcMocks.reportEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'energy_experience_completed',
        experienceId: 'recharge',
        energyNeed: 'relax',
      }),
    );
    expect(screen.getByRole('button', { name: '继续：呼吸节奏' })).toBeTruthy();
  });

  it('reports target-only poll lifecycle with its stable mode id', async () => {
    const user = userEvent.setup();
    recordEnergyCompletion('usr_energy', 'recharge');
    saveLastEnergyTarget('usr_energy', { type: 'poll', pollId: 'break-style' }, null);
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '继续上次' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    const firstOption = (await screen.findAllByRole('radio'))[0];
    if (!firstOption) throw new Error('expected poll option');
    await user.click(firstOption);

    expect(trpcMocks.reportEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'energy_experience_started',
        experienceId: 'poll',
        modeId: expect.stringMatching(/^(break-style|focus-sound|small-reward|social-battery)$/),
      }),
    );
    expect(trpcMocks.reportEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'energy_experience_completed',
        experienceId: 'poll',
      }),
    );
  });

  it('continues from a completed recharge into the exact recommended game', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '放松' }));
    const originalTrigger = screen.getByRole('button', { name: '开始 30 秒补给' });
    await user.click(originalTrigger);
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    await user.click(await screen.findByRole('button', { name: '立即完成' }));
    await user.click(screen.getByRole('button', { name: '继续：呼吸节奏' }));

    expect(screen.getByRole('dialog', { name: '小游戏' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    expect(await screen.findByRole('heading', { name: '舒服地吸气' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭体验' }));
    expect(originalTrigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '继续今日内容' }));
    expect(trpcMocks.reportEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'energy_continuation_opened',
        fromKind: 'recharge',
        targetType: 'game',
      }),
    );
  });

  it('reports a retry as replayed without a second start', async () => {
    vi.doMock('./experiences/TarotExperience', () => ({
      TarotExperience: ({
        onPhaseChange,
      }: {
        onPhaseChange: (phase: 'error') => void;
      }) => (
        <button type="button" onClick={() => onPhaseChange('error')}>
          模拟体验失败
        </button>
      ),
    }));
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '抽一张能量卡' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    await user.click(await screen.findByRole('button', { name: '模拟体验失败' }));
    await user.click(screen.getByRole('button', { name: '重新试试' }));

    const lifecycleTypes = trpcMocks.reportEvent.mock.calls
      .map(([event]) => event.type)
      .filter((type) => String(type).startsWith('energy_experience_'));
    expect(lifecycleTypes).toEqual([
      'energy_experience_started',
      'energy_experience_failed',
      'energy_experience_replayed',
    ]);
  });

  it('skips a remotely unavailable continuation type instead of rendering a dead action', async () => {
    trpcMocks.homeQuery.mockResolvedValue({
      experiences: [
        {
          id: 'games',
          kind: 'game',
          title: '小游戏',
          description: '接住十二颗轻盈的能量光点',
          estimatedSeconds: 45,
          status: 'coming-soon',
          actionable: false,
        },
      ],
    });
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);
    await waitFor(() => expect(trpcMocks.homeQuery).toHaveBeenCalledOnce());

    await user.click(screen.getByRole('button', { name: '放松' }));
    await user.click(screen.getByRole('button', { name: '开始 30 秒补给' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    await user.click(await screen.findByRole('button', { name: '立即完成' }));

    expect(screen.queryByRole('button', { name: '继续：呼吸节奏' })).toBeNull();
    expect(screen.getByRole('button', { name: '继续：一分钟轻测试' })).toBeTruthy();
  });

  it('opens the playable mini game from the three-choice deck', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '玩接住能量' }));
    expect(screen.getByRole('dialog', { name: '小游戏' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    expect(await screen.findByRole('button', { name: '接住第 1 个能量光点' })).toBeTruthy();
  });

  it('adds a completed experience to the shelf and reopens it from the recent card', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    await user.click(screen.getByRole('button', { name: '玩接住能量' }));
    await user.click(screen.getByRole('button', { name: '开始体验' }));
    for (let round = 1; round <= 12; round += 1) {
      await user.click(screen.getByRole('button', { name: `接住第 ${round} 个能量光点` }));
    }
    expect(screen.getByRole('heading', { name: '能量收集完成' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '返回今日内容' }));

    const shelf = screen.getByRole('region', { name: '我的能量架' });
    expect(within(shelf).getByRole('heading', { name: '接住能量' })).toBeTruthy();
    await user.click(within(shelf).getByRole('button', { name: '再体验接住能量' }));
    expect(screen.getByRole('dialog', { name: '小游戏' })).toBeTruthy();
  });

  it('opens and removes all three local favorite sources without new service events', async () => {
    saveEnergyCardIds('usr_energy', ['work-01']);
    saveLightTestAction('usr_energy', 'work-focus', 'steady');
    toggleFavoriteEnergyContent('usr_energy', 'relax-breath-window');
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    const shelf = screen.getByRole('region', { name: '我的能量架' });
    await user.click(within(shelf).getByRole('tab', { name: '我的收藏' }));
    expect(within(shelf).getAllByRole('article')).toHaveLength(3);

    await user.click(within(shelf).getByRole('button', { name: '取消收藏先推一厘米' }));
    expect(readEnergyProgress('usr_energy').savedCardIds).toEqual([]);
    expect(within(shelf).queryByRole('heading', { name: '先推一厘米' })).toBeNull();

    await user.click(within(shelf).getByRole('button', { name: '再体验先把节奏稳住' }));
    expect(screen.getByRole('dialog', { name: '轻测试' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭体验' }));

    await user.click(within(shelf).getByRole('button', { name: '取消收藏窗边八次慢呼吸' }));
    const progress = readEnergyProgress('usr_energy');
    expect(progress.savedTestActionIds).toEqual(['work-focus:steady']);
    expect(progress.continuation.favoriteContentIds).toEqual([]);
    expect(
      trpcMocks.reportEvent.mock.calls.some(
        ([event]) =>
          String(event.type).includes('feedback') || String(event.type).includes('shelf'),
      ),
    ).toBe(false);
  });

  it('keeps magazine favorites and the shelf in sync during the same visit', async () => {
    const user = userEvent.setup();
    render(<EnergyHome profileStorageScope="usr_energy" />);

    const exploreFeed = screen.getByRole('region', { name: '再逛一会' });
    const favoriteButton = within(exploreFeed).getAllByRole('button', { name: /^收藏/ })[0];
    if (!favoriteButton) throw new Error('expected a magazine favorite control');
    const favoriteLabel = favoriteButton.getAttribute('aria-label');
    if (!favoriteLabel?.startsWith('收藏')) throw new Error('expected a favorite label');
    const title = favoriteLabel.slice(2);

    await user.click(favoriteButton);

    const shelf = screen.getByRole('region', { name: '我的能量架' });
    await user.click(within(shelf).getByRole('tab', { name: '我的收藏' }));
    expect(within(shelf).getByRole('heading', { name: title })).toBeTruthy();

    await user.click(within(shelf).getByRole('button', { name: `取消收藏${title}` }));
    expect(within(shelf).queryByRole('heading', { name: title })).toBeNull();
    expect(favoriteButton.getAttribute('aria-pressed')).toBe('false');
    expect(favoriteButton.getAttribute('aria-label')).toBe(`收藏${title}`);
  });

  it('scrolls to the honest astrology world and keeps continuation experiences playable', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    render(<EnergyHome profileStorageScope="usr_energy" />);

    expect(screen.queryByText(/月亮倾向|上升倾向|流年提醒/)).toBeNull();
    expect(screen.getByRole('region', { name: '白羊座能量专刊' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '进入星座深度补给' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    await user.click(screen.getByRole('button', { name: '抽一张相关能量牌' }));
    expect(screen.getByRole('dialog', { name: '抽张卡' })).toBeTruthy();
    expect(screen.queryByText(/月亮倾向|上升倾向|流年提醒/)).toBeNull();
  });

  it('uses a compact same-day return hero after a completed experience', () => {
    recordEnergyCompletion('usr_energy', 'test');
    render(<EnergyHome profileStorageScope="usr_energy" />);

    expect(screen.getByText('今日完成 1/5')).toBeTruthy();
    expect(screen.getByRole('button', { name: '继续今日内容' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '今日能量章节' })).toBeTruthy();
  });
});
