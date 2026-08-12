// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ENERGY_EXPLORE_CONTENT, type EnergyContentItem } from './explore-content';
import { allocateMagazineVisuals } from './energy-magazine-visuals';
import { EnergyMagazineCard } from './EnergyMagazineCard';

function content(id: string): EnergyContentItem {
  const item = ENERGY_EXPLORE_CONTENT.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing fixture ${id}`);
  return item;
}

describe('EnergyMagazineCard', () => {
  it('renders artwork, the zodiac overlay, and a real action button', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const entry = allocateMagazineVisuals([content('zodiac-fire-recharge')], 'leo')[0]!;
    const { container } = render(
      <EnergyMagazineCard entry={entry} opened={false} onOpen={onOpen} />,
    );

    expect(container.querySelector('article[data-layout="hero"] img[data-artwork]')).toBeTruthy();
    expect(
      container.querySelector('img[data-zodiac-badge][src="/energy/leo-badge.jpg"]'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '打开火象星座怎样充电' }));
    expect(onOpen).toHaveBeenCalledWith(entry.item, expect.any(HTMLButtonElement));
  });

  it('keeps the card actionable when artwork fails', () => {
    const entry = allocateMagazineVisuals([content('relax-breath-window')], 'leo')[0]!;
    const { container } = render(
      <EnergyMagazineCard entry={entry} opened={false} onOpen={vi.fn()} />,
    );
    const image = container.querySelector<HTMLImageElement>('img[data-artwork]')!;
    fireEvent.error(image);
    expect(image.hidden).toBe(true);
    expect(container.querySelector('[data-artwork-fallback]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开窗边八次慢呼吸' })).toBeTruthy();
  });
});
