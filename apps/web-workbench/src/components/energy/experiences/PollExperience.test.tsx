// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENERGY_POLL_IDS, type EnergyPollId } from '../energy-content-target';
import { readEnergyProgress } from '../energy-progress';
import { PollExperience } from './PollExperience';

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

function renderPoll(pollId: EnergyPollId) {
  const onPhaseChange = vi.fn();
  render(
    <PollExperience
      initialPollId={pollId}
      profileStorageScope="usr_a"
      phase="active"
      onPhaseChange={onPhaseChange}
    />,
  );
  return onPhaseChange;
}

describe('PollExperience', () => {
  it.each(ENERGY_POLL_IDS)('shows four choices and local feedback for %s', async (pollId) => {
    const user = userEvent.setup();
    const onPhaseChange = renderPoll(pollId);
    const options = screen.getAllByRole('radio');

    expect(options).toHaveLength(4);
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(options[0]!);

    const result = screen.getByRole('heading', { name: '你的选择，值得被照顾' });
    expect(result).toBeTruthy();
    expect(document.activeElement).toBe(result);
    expect(screen.queryByText(/%|全网|用户选择/)).toBeNull();
    expect(onPhaseChange).toHaveBeenCalledWith('result');
    expect(readEnergyProgress('usr_a').continuation.pollSelections[pollId]).toMatch(/^[a-z0-9-]+$/);
  });

  it('allows a same-day re-selection and keeps only the latest option id', async () => {
    const user = userEvent.setup();
    renderPoll('break-style');
    await user.click(screen.getAllByRole('radio')[0]!);
    const first = readEnergyProgress('usr_a').continuation.pollSelections['break-style'];

    await user.click(screen.getByRole('button', { name: '重新选择' }));
    await user.click(screen.getAllByRole('radio')[1]!);
    const second = readEnergyProgress('usr_a').continuation.pollSelections['break-style'];

    expect(second).not.toBe(first);
    expect(Object.keys(readEnergyProgress('usr_a').continuation.pollSelections)).toEqual([
      'break-style',
    ]);
  });
});
