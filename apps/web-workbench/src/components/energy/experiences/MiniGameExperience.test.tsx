// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExperiencePhase } from '../energy-types';
import { MiniGameExperience } from './MiniGameExperience';

afterEach(cleanup);

function Harness({ onComplete = vi.fn() }: { onComplete?: () => void }): JSX.Element {
  const [phase, setPhase] = React.useState<ExperiencePhase>('active');
  return (
    <>
      <MiniGameExperience phase={phase} onPhaseChange={setPhase} onComplete={onComplete} />
      {phase === 'result' ? (
        <button type="button" onClick={() => setPhase('active')}>
          再玩一次
        </button>
      ) : null}
    </>
  );
}

describe('MiniGameExperience', () => {
  it('starts without a result and lets keyboard activation advance one round', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByText('能量收集完成')).toBeNull();
    expect(screen.getByText('0 / 12')).toBeTruthy();

    const target = screen.getByRole('button', { name: '接住第 1 个能量光点' });
    target.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByText('1 / 12')).toBeTruthy();
    expect(screen.getByRole('button', { name: '接住第 2 个能量光点' })).toBeTruthy();
  });

  it('completes on round twelve and resets the score on replay', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    for (let round = 1; round <= 12; round += 1) {
      await user.click(screen.getByRole('button', { name: `接住第 ${round} 个能量光点` }));
    }

    expect(screen.getByRole('heading', { name: '能量收集完成' })).toBeTruthy();
    expect(screen.getByText('12 / 12')).toBeTruthy();
    expect(onComplete).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: '再玩一次' }));
    expect(screen.getByText('0 / 12')).toBeTruthy();
    expect(screen.getByRole('button', { name: '接住第 1 个能量光点' })).toBeTruthy();
  });
});
