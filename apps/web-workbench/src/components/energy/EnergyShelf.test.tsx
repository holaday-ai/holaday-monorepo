// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnergyShelf } from './EnergyShelf';
import type { EnergyShelfItem, EnergyShelfModel } from './energy-shelf';

afterEach(cleanup);

const recentFixture: EnergyShelfItem = {
  id: 'recent:games:color-memory',
  section: 'recent',
  source: 'experience',
  title: '颜色记忆',
  summary: '观察颜色与形状，再按顺序轻轻点回去',
  eyebrow: '小游戏',
  imageSrc: '/energy/mini-game.jpg',
  imageObjectPosition: '50% 42%',
  estimatedSeconds: 60,
  completedLabel: '今天',
  recent: {
    experienceId: 'games',
    launchTarget: { type: 'game', gameId: 'color-memory' },
    kind: 'game',
    completedAt: '2026-08-14T01:00:00.000Z',
  },
  target: null,
  favoriteRef: null,
};

const favoriteFixture: EnergyShelfItem = {
  id: 'favorite:energy-card:work-01',
  section: 'favorite',
  source: 'energy-card',
  title: '先推一厘米',
  summary: '现在不必解决整件事，先完成最小一步。',
  eyebrow: '动量比完整更重要',
  imageSrc: '/energy/tarot-cards.jpg',
  imageObjectPosition: '50% 50%',
  estimatedSeconds: 30,
  completedLabel: null,
  recent: null,
  target: { type: 'tarot', mode: 'single', theme: 'work' },
  favoriteRef: { source: 'energy-card', cardId: 'work-01' },
};

function modelFixture(): EnergyShelfModel {
  return { recent: [recentFixture], favorites: [favoriteFixture] };
}

describe('EnergyShelf', () => {
  it('switches between recent and favorites and exposes accessible actions', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onRemoveFavorite = vi.fn();
    const { container } = render(
      <EnergyShelf model={modelFixture()} onOpen={onOpen} onRemoveFavorite={onRemoveFavorite} />,
    );

    expect(screen.getByRole('tab', { name: '最近玩过' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const image = container.querySelector<HTMLImageElement>('.energy-shelf__image img');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.style.objectPosition).toBe('50% 42%');
    const open = screen.getByRole('button', { name: '再体验颜色记忆' });
    expect(open.title).toBe('再体验颜色记忆');
    await user.click(open);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recent:games:color-memory' }),
      expect.any(HTMLButtonElement),
    );

    await user.click(screen.getByRole('tab', { name: '我的收藏' }));
    const remove = screen.getByRole('button', { name: '取消收藏先推一厘米' });
    expect(remove.title).toBe('取消收藏先推一厘米');
    await user.click(remove);
    expect(onRemoveFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'favorite:energy-card:work-01' }),
    );
  });

  it('supports automatic arrow, home and end keyboard tab activation', async () => {
    const user = userEvent.setup();
    render(<EnergyShelf model={modelFixture()} onOpen={vi.fn()} onRemoveFavorite={vi.fn()} />);
    const recent = screen.getByRole('tab', { name: '最近玩过' });
    const favorites = screen.getByRole('tab', { name: '我的收藏' });

    recent.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(favorites);
    expect(favorites.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: '我的收藏' })).toBeTruthy();

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(recent);
    expect(recent.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(favorites);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(recent);
  });

  it('renders honest actionable empty states without disabled placeholder cards', async () => {
    const user = userEvent.setup();
    render(
      <EnergyShelf
        model={{ recent: [], favorites: [] }}
        onOpen={vi.fn()}
        onRemoveFavorite={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: '去玩一个轻体验' }).getAttribute('href')).toBe(
      '#energy-play',
    );
    expect(screen.queryByRole('button', { name: /再体验/ })).toBeNull();

    await user.click(screen.getByRole('tab', { name: '我的收藏' }));
    expect(screen.getByRole('link', { name: '去逛能量专刊' }).getAttribute('href')).toBe(
      '#energy-today-content',
    );
    expect(screen.queryByRole('button', { name: /再体验/ })).toBeNull();
  });
});
