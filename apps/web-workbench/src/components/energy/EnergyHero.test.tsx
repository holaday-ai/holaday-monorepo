// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnergyNeed } from './energy-types';
import { EnergyHero } from './EnergyHero';

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
});
