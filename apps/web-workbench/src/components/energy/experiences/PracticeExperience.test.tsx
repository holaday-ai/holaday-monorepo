// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENERGY_PRACTICE_IDS, type EnergyPracticeId } from '../energy-content-target';
import { readEnergyProgress } from '../energy-progress';
import { PracticeExperience } from './PracticeExperience';

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

function renderPractice(practiceId: EnergyPracticeId, onComplete = vi.fn()) {
  const onPhaseChange = vi.fn();
  render(
    <PracticeExperience
      initialPracticeId={practiceId}
      profileStorageScope="usr_a"
      phase="active"
      onPhaseChange={onPhaseChange}
      onComplete={onComplete}
    />,
  );
  return { onComplete, onPhaseChange };
}

describe('PracticeExperience', () => {
  it.each(ENERGY_PRACTICE_IDS)('completes %s after showing its first step', async (practiceId) => {
    const user = userEvent.setup();
    const callbacks = renderPractice(practiceId);

    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: '立即完成' }));

    expect(callbacks.onComplete).toHaveBeenCalledOnce();
    expect(callbacks.onPhaseChange).toHaveBeenCalledWith('result');
    expect(readEnergyProgress('usr_a').continuation.completedPracticeIds).toEqual([practiceId]);
    expect(readEnergyProgress('usr_a').collectedKinds).toContain('recharge');
  });

  it('lets the user move backward and forward without a forced timer', async () => {
    const user = userEvent.setup();
    renderPractice('five-senses');

    const progress = screen.getByRole('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(progress.getAttribute('aria-valuenow')).toBe('2');
    await user.click(screen.getByRole('button', { name: '上一步' }));
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
  });
});
