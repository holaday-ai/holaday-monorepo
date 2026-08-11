// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnergyNeed, ExperiencePhase } from '../energy-types';
import { RechargeExperience } from './RechargeExperience';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({
  need = 'relax',
  onComplete = vi.fn(),
}: {
  need?: EnergyNeed;
  onComplete?: (need: EnergyNeed) => void;
}): JSX.Element {
  const [phase, setPhase] = React.useState<ExperiencePhase>('active');
  return (
    <RechargeExperience
      need={need}
      phase={phase}
      onPhaseChange={setPhase}
      onComplete={onComplete}
    />
  );
}

describe('RechargeExperience', () => {
  it('moves through three visible steps before completing the selected recharge', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    expect(screen.getByRole('heading', { name: '先慢慢松开' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '点亮下一步' }));
    expect(screen.getByRole('heading', { name: '把呼吸放长一点' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '点亮下一步' }));
    expect(screen.getByRole('heading', { name: '把空白留给自己' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '完成这次补给' }));

    expect(onComplete).toHaveBeenCalledWith('relax');
    expect(screen.getByRole('heading', { name: '放松能量已点亮' })).toBeTruthy();
    expect(screen.getByText('先喝一口水，再回到最需要处理的一件事。')).toBeTruthy();
  });

  it('lets the user finish immediately without waiting for animation', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness need="focus" onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: '立即完成' }));

    expect(onComplete).toHaveBeenCalledWith('focus');
    expect(screen.getByRole('heading', { name: '专注能量已点亮' })).toBeTruthy();
  });

  it('completes the three-stage rhythm after thirty seconds', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<Harness need="confidence" onComplete={onComplete} />);

    for (let step = 0; step < 3; step += 1) {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    }

    expect(onComplete).toHaveBeenCalledWith('confidence');
    expect(screen.getByRole('heading', { name: '自信能量已点亮' })).toBeTruthy();
  });
});
