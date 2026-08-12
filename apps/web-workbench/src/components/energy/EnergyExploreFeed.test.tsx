// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyExploreFeed } from './EnergyExploreFeed';
import { readEnergyProgress } from './energy-progress';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(cleanup);

describe('EnergyExploreFeed', () => {
  it('replaces the visible six cards and reports a bounded refresh', async () => {
    const onEvent = vi.fn();
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood="stressed"
        energyNeed="relax"
        zodiacSign="aries"
        onEvent={onEvent}
      />,
    );
    const before = screen.getAllByRole('article').map((item) => item.textContent);

    await user.click(screen.getByRole('button', { name: '再来一组' }));

    const after = screen.getAllByRole('article').map((item) => item.textContent);
    expect(after).not.toEqual(before);
    expect(onEvent).toHaveBeenCalledWith({ type: 'energy_feed_refreshed' });
    expect(readEnergyProgress('usr_a').seenContentIds).toHaveLength(12);
  });

  it('reports only the stable content id when a card is opened', async () => {
    const onEvent = vi.fn();
    const onActionTarget = vi.fn();
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={onEvent}
        onActionTarget={onActionTarget}
      />,
    );

    const firstAction = screen.getAllByRole('button', { name: /打开/ })[0];
    if (!firstAction) throw new Error('expected content action');
    await user.click(firstAction);

    expect(onEvent).toHaveBeenCalledWith({
      type: 'energy_content_opened',
      contentId: expect.stringMatching(/^[a-z0-9-]+$/),
    });
    expect(onActionTarget).toHaveBeenCalledWith(expect.any(String), firstAction);
    expect(firstAction.closest('article')?.getAttribute('data-opened')).toBe('true');
  });

  it('keeps preview history in memory without creating a guest record', async () => {
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed
        storageScope={null}
        mood={null}
        energyNeed="uplift"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '再来一组' }));
    expect(storage.has('holaday.energy.progress.v2:guest')).toBe(false);
  });

  it('renders two illustrated feature cards and four icon-led compact cards', () => {
    const { container } = render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('article[data-layout="feature"]')).toHaveLength(2);
    expect(container.querySelectorAll('article[data-layout="compact"]')).toHaveLength(4);
    expect(container.querySelectorAll('article[data-layout="feature"] img')).toHaveLength(2);
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('hides failed feature artwork and keeps the icon fallback available', () => {
    const { container } = render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );
    const image = container.querySelector<HTMLImageElement>('article[data-layout="feature"] img');
    if (!image) throw new Error('expected feature artwork');

    fireEvent.error(image);

    expect(image.hidden).toBe(true);
    expect(image.parentElement?.querySelector('span svg')).toBeTruthy();
  });
});
