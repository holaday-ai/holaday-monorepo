// @vitest-environment happy-dom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RechargeExperience } from './RechargeExperience';
import type { ExperiencePhase } from '../energy-types';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('does not advance or record completion before the user starts, then completes after three intervals', async () => {
  vi.useFakeTimers();
  const complete = vi.fn();
  function Harness() {
    const [phase, setPhase] = React.useState<ExperiencePhase>('intro');
    return (
      <RechargeExperience
        need="focus"
        phase={phase}
        onPhaseChange={setPhase}
        onComplete={complete}
      />
    );
  }
  render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(40000);
  });
  expect(complete).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '开始30秒' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '开始30秒' }));
  for (let step = 0; step < 3; step++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(screen.getByText('专注能量已点亮')).toBeTruthy();
});
