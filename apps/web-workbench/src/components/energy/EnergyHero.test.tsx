// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnergyHero } from './EnergyHero';
import type { EnergyNeed } from './energy-types';

afterEach(cleanup);

function HeroHarness({ onStart }: { onStart: (need: EnergyNeed) => void }): JSX.Element {
  const [need, setNeed] = React.useState<EnergyNeed>('focus');
  return <EnergyHero value={need} onChange={setNeed} onStart={(need) => onStart(need)} />;
}

describe('EnergyHero', () => {
  it('offers four exclusive energy needs and starts the selected recharge', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<HeroHarness onStart={onStart} />);

    expect(screen.getByRole('heading', { name: '今天想补哪一种能量？' })).toBeTruthy();
    const group = screen.getByRole('group', { name: '补给能量' });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
    expect(within(group).getByRole('button', { name: '专注' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await user.click(within(group).getByRole('button', { name: '放松' }));

    expect(screen.getByText('先把肩膀放松，再给大脑留一点空白。')).toBeTruthy();
    expect(within(group).getByRole('button', { name: '放松' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: '开始 30 秒补给' }));
    expect(onStart).toHaveBeenCalledWith('relax');
  });

  it('shows a compact same-day return state and expands for a new choice', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <EnergyHero
        mode="compact"
        value="relax"
        completedCount={1}
        totalCount={5}
        continueLabel="继续上次"
        onChange={vi.fn()}
        onStart={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText('今日完成 1/5')).toBeTruthy();
    expect(screen.getByText('继续补一点放松能量')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '继续上次' }));
    expect(onContinue).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '重新选择能量' }));
    expect(screen.getByRole('heading', { name: '今天想补哪一种能量？' })).toBeTruthy();
  });
});
