// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyExploreFeed } from './EnergyExploreFeed';
import { isEnergyContentTarget } from './energy-content-target';
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
    expect(readEnergyProgress('usr_a').seenContentIds).toEqual([]);
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
        onActionTarget={(target, trigger) => {
          onActionTarget(target, trigger);
          return true;
        }}
      />,
    );

    const firstAction = screen.getAllByRole('button', { name: /打开/ })[0];
    if (!firstAction) throw new Error('expected content action');
    await user.click(firstAction);

    expect(onEvent).toHaveBeenCalledWith({
      type: 'energy_content_opened',
      contentId: expect.stringMatching(/^[a-z0-9-]+$/),
      targetType: expect.stringMatching(
        /^(practice|poll|test|tarot|game|astrology|astrology-signs)$/,
      ),
    });
    const target = onActionTarget.mock.calls[0]?.[0];
    expect(isEnergyContentTarget(target)).toBe(true);
    expect(onActionTarget).toHaveBeenCalledWith(target, firstAction);
    expect(firstAction.closest('article')?.getAttribute('data-opened')).toBe('true');
    expect(readEnergyProgress('usr_a').seenContentIds).toHaveLength(1);
  });

  it('keeps a card unopened and recoverable when its target is unavailable', async () => {
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
        onActionTarget={() => false}
      />,
    );

    const action = screen.getAllByRole('button', { name: /打开/ })[0];
    if (!action) throw new Error('expected content action');
    await user.click(action);

    expect(action.closest('article')?.getAttribute('data-opened')).toBe('false');
    expect(screen.getByRole('status').textContent).toContain(
      '这个体验暂时不可用，已为你保留当前位置',
    );
    expect(readEnergyProgress('usr_a').seenContentIds).toEqual([]);
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

  it('keeps preview favorites in memory without creating a guest record', async () => {
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
    const favorite = screen.getAllByRole('button', { name: /^收藏/ })[0];
    if (!favorite) throw new Error('expected favorite control');

    await user.click(favorite);

    expect(screen.getAllByRole('button', { name: /^取消收藏/ })).toHaveLength(1);
    expect(storage.has('holaday.energy.progress.v3:guest')).toBe(false);
  });

  it('renders one hero, two portraits and three landscapes with unique artwork', () => {
    const { container } = render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('article[data-layout="hero"]')).toHaveLength(1);
    expect(container.querySelectorAll('article[data-layout="portrait"]')).toHaveLength(2);
    expect(container.querySelectorAll('article[data-layout="landscape"]')).toHaveLength(3);
    const artwork = [...container.querySelectorAll<HTMLImageElement>('img[data-artwork]')];
    expect(artwork).toHaveLength(6);
    expect(new Set(artwork.map((image) => image.src)).size).toBe(6);
    expect(container.querySelector('[data-layout="compact"]')).toBeNull();
  });

  it('hides failed artwork and keeps the icon fallback available', () => {
    const { container } = render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );
    const image = container.querySelector<HTMLImageElement>('img[data-artwork]');
    if (!image) throw new Error('expected magazine artwork');

    fireEvent.error(image);

    expect(image.hidden).toBe(true);
    expect(image.parentElement?.querySelector('[data-artwork-fallback] svg')).toBeTruthy();
  });

  it('offers three recovery routes and reports exhaustion only once', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    const onCompleteToday = vi.fn();
    render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={onEvent}
        onCompleteToday={onCompleteToday}
      />,
    );

    for (let batch = 0; batch < 6; batch += 1) {
      await user.click(screen.getByRole('button', { name: '再来一组' }));
    }

    expect(screen.getByRole('button', { name: '换个能量主题' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '继续收藏' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: '完成今日能量' }));
    expect(onCompleteToday).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls.filter(([event]) => event.type === 'energy_feed_exhausted')).toEqual([
      [{ type: 'energy_feed_exhausted', energyNeed: 'focus', batchCount: 6 }],
    ]);
  });

  it('keeps a favorite available after fresh batches are exhausted', async () => {
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );

    const firstArticle = screen.getAllByRole('article')[0];
    if (!firstArticle) throw new Error('expected first content card');
    const firstTitle = firstArticle.querySelector('h3')?.textContent;
    if (!firstTitle) throw new Error('expected first content title');
    await user.click(screen.getByRole('button', { name: `收藏${firstTitle}` }));
    expect(readEnergyProgress('usr_a').continuation.favoriteContentIds).toHaveLength(1);
    for (let batch = 0; batch < 6; batch += 1) {
      await user.click(screen.getByRole('button', { name: '再来一组' }));
    }

    await user.click(screen.getByRole('button', { name: '继续收藏' }));
    expect(screen.getByRole('heading', { name: '我的能量收藏' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: firstTitle })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: `取消收藏${firstTitle}` }));
    expect(screen.getByRole('heading', { name: '还没有可用的收藏' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '返回今日精选' }));
    expect(screen.getByRole('heading', { name: '今日精选重逛' })).toBeTruthy();
  });

  it('starts a need-aware revisit without claiming the content is unseen', async () => {
    const user = userEvent.setup();
    render(
      <EnergyExploreFeed
        storageScope="usr_a"
        mood={null}
        energyNeed="focus"
        zodiacSign="aries"
        onEvent={vi.fn()}
      />,
    );

    for (let batch = 0; batch < 6; batch += 1) {
      await user.click(screen.getByRole('button', { name: '再来一组' }));
    }
    await user.click(screen.getByRole('button', { name: '换个能量主题' }));
    await user.click(screen.getByRole('button', { name: '放松' }));

    expect(screen.getByRole('heading', { name: '今日精选重逛' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.queryByText(/没有看过|未看过/)).toBeNull();
  });
});
