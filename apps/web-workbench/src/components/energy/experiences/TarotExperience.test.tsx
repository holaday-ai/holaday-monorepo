// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEnergyProgress } from '../energy-progress';
import { TarotExperience } from './TarotExperience';

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

function renderTarot(
  options: {
    profileStorageScope?: string | null;
    onPhaseChange?: (phase: 'intro' | 'active' | 'result' | 'error') => void;
    onComplete?: () => void;
  } = {},
) {
  const onPhaseChange = options.onPhaseChange ?? vi.fn();
  const onComplete = options.onComplete ?? vi.fn();
  render(
    <TarotExperience
      profileStorageScope={options.profileStorageScope ?? 'usr_a'}
      capabilities={{}}
      phase="active"
      onPhaseChange={onPhaseChange}
      onComplete={onComplete}
    />,
  );
  return { onPhaseChange, onComplete };
}

async function revealSingleCard() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '单张能量牌' }));
  await user.click(screen.getByRole('button', { name: '工作推进' }));
  await user.click(screen.getByRole('button', { name: '开始抽卡' }));
  await user.click(screen.getByRole('button', { name: '翻开这张牌' }));
  return user;
}

describe('TarotExperience', () => {
  it('continues from a single-card result into a three-card spread', async () => {
    renderTarot();
    const user = await revealSingleCard();

    expect(screen.getByRole('heading', { name: 'Holaday 能量牌' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '进入三张牌' }));

    expect(screen.getAllByTestId('energy-card-result')).toHaveLength(3);
    expect(screen.getByText('回顾')).toBeTruthy();
    expect(screen.getByText('当下')).toBeTruthy();
    expect(screen.getByText('下一步')).toBeTruthy();
  });

  it('redraws without closing the result phase and completes only once', async () => {
    const onPhaseChange = vi.fn();
    const onComplete = vi.fn();
    renderTarot({ onPhaseChange, onComplete });
    const user = await revealSingleCard();

    expect(onComplete).toHaveBeenCalledOnce();
    onPhaseChange.mockClear();
    await user.click(screen.getByRole('button', { name: '再抽一次' }));

    expect(screen.getByRole('button', { name: '翻开这张牌' })).toBeTruthy();
    expect(onPhaseChange).toHaveBeenLastCalledWith('active');
    expect(onPhaseChange).not.toHaveBeenLastCalledWith('intro');
    await user.click(screen.getByRole('button', { name: '翻开这张牌' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('saves only the revealed card id for the current storage scope', async () => {
    const scope = 'usr_a';
    renderTarot({ profileStorageScope: scope });
    const user = await revealSingleCard();
    await user.click(screen.getByRole('button', { name: '收藏本次提示' }));

    expect(readEnergyProgress(scope).savedCardIds).toEqual([
      expect.stringMatching(/^[a-z-]+-\d{2}$/),
    ]);
    const raw = storage.get(`holaday.energy.progress.v2:${scope}`) ?? '';
    expect(raw).not.toContain('body');
    expect(raw).not.toContain('action');
  });

  it('answers a private yes-or-no prompt without collecting question text', async () => {
    const user = userEvent.setup();
    renderTarot();

    await user.click(screen.getByRole('button', { name: '是 / 否能量牌' }));
    await user.click(screen.getByRole('button', { name: '情绪整理' }));
    await user.click(screen.getByRole('button', { name: '开始抽卡' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/问题只留在心里/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '翻开回答牌' }));

    expect(screen.getByText(/^(YES|NO|WAIT)$/)).toBeTruthy();
  });
});
