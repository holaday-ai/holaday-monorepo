// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnergyMagazineCard } from './EnergyMagazineCard';
import { allocateMagazineVisuals } from './energy-magazine-visuals';
import { ENERGY_EXPLORE_CONTENT, type EnergyContentItem } from './explore-content';

function content(id: string): EnergyContentItem {
  const item = ENERGY_EXPLORE_CONTENT.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing fixture ${id}`);
  return item;
}

afterEach(cleanup);

describe('EnergyMagazineCard', () => {
  it('renders artwork, the zodiac overlay, and a real action button', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggleFavorite = vi.fn();
    const entry = allocateMagazineVisuals([content('zodiac-fire-recharge')], 'leo')[0];
    if (!entry) throw new Error('expected allocated magazine entry');
    const { container } = render(
      <EnergyMagazineCard
        entry={entry}
        opened={false}
        favorite={false}
        onOpen={onOpen}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    expect(container.querySelector('article[data-layout="hero"] img[data-artwork]')).toBeTruthy();
    expect(
      container.querySelector('img[data-zodiac-badge][src="/energy/leo-badge.jpg"]'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '打开火象星座怎样充电' }));
    expect(onOpen).toHaveBeenCalledWith(entry.item, expect.any(HTMLButtonElement));
    await user.click(screen.getByRole('button', { name: '收藏火象星座怎样充电' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(entry.item.id);
    expect(screen.getByRole('button', { name: '收藏火象星座怎样充电' }).title).toBe(
      '收藏火象星座怎样充电',
    );
  });

  it('keeps the card actionable when artwork fails', () => {
    const entry = allocateMagazineVisuals([content('relax-breath-window')], 'leo')[0];
    if (!entry) throw new Error('expected allocated magazine entry');
    const { container } = render(
      <EnergyMagazineCard
        entry={entry}
        opened={false}
        favorite={false}
        onOpen={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );
    const image = container.querySelector<HTMLImageElement>('img[data-artwork]');
    if (!image) throw new Error('expected magazine artwork');
    fireEvent.error(image);
    expect(image.hidden).toBe(true);
    expect(container.querySelector('[data-artwork-fallback]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开窗边八次慢呼吸' })).toBeTruthy();
  });

  it('shows the saved state without replacing the open action', () => {
    const entry = allocateMagazineVisuals([content('relax-breath-window')], 'leo')[0];
    if (!entry) throw new Error('expected allocated magazine entry');
    render(
      <EnergyMagazineCard
        entry={entry}
        opened={false}
        favorite
        onOpen={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '取消收藏窗边八次慢呼吸' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开窗边八次慢呼吸' })).toBeTruthy();
  });
});
