// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
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
  });

  it('keeps preview history in memory without creating a guest record', async () => {
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed storageScope={null} mood={null} energyNeed="uplift" onEvent={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: '再来一组' }));
    expect(storage.has('holaday.energy.progress.v2:guest')).toBe(false);
  });
});
