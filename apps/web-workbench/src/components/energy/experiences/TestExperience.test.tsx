// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEnergyProgress } from '../energy-progress';
import type { LightTestId } from './test-content';
import { TestExperience } from './TestExperience';

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

function renderTestExperience(
  profileStorageScope: string | null = 'usr_a',
  initialTestId?: LightTestId,
) {
  const onPhaseChange = vi.fn();
  const onComplete = vi.fn();
  render(
    <TestExperience
      profileStorageScope={profileStorageScope}
      initialTestId={initialTestId}
      phase="active"
      onPhaseChange={onPhaseChange}
      onComplete={onComplete}
    />,
  );
  return { onPhaseChange, onComplete };
}

async function completeEmotionBattery() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '情绪电量' }));
  for (let index = 0; index < 5; index += 1) {
    const option = screen.getAllByTestId('light-test-option')[0];
    if (!option) throw new Error('expected light test option');
    await user.click(option);
  }
  return user;
}

describe('TestExperience', () => {
  it('opens a recommended test on its first question and returns to the directory', async () => {
    const user = userEvent.setup();
    renderTestExperience('usr_a', 'work-focus');

    expect(screen.getByText(/专注入口 · 1\/5/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '情绪电量' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '返回测试目录' }));

    expect(screen.getByRole('button', { name: '情绪电量' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '专注入口' })).toBeTruthy();
  });

  it('completes five questions and opens a related test without closing', async () => {
    const { onComplete } = renderTestExperience();
    const user = await completeEmotionBattery();

    expect(screen.getByText('今日心理画像')).toBeTruthy();
    expect(onComplete).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '测相关主题' }));
    expect(screen.getByText(/1\/5/)).toBeTruthy();
    expect(screen.getByText(/内心天气/)).toBeTruthy();
  });

  it('returns to the directory and marks the completed test', async () => {
    renderTestExperience();
    const user = await completeEmotionBattery();
    await user.click(screen.getByRole('button', { name: '返回测试目录' }));

    const completed = screen.getByRole('button', { name: '情绪电量' });
    expect(completed.textContent).toContain('已完成');
  });

  it('saves completion and action ids without persisting answers', async () => {
    const scope = 'usr_a';
    renderTestExperience(scope);
    const user = await completeEmotionBattery();
    await user.click(screen.getByRole('button', { name: '收藏行动建议' }));

    const progress = readEnergyProgress(scope);
    expect(progress.completedTestIds).toContain('emotion-battery');
    expect(progress.savedTestActionIds).toContain('emotion-battery:recover');
    const raw = storage.get(`holaday.energy.progress.v3:${scope}`) ?? '';
    expect(raw).not.toContain('answers');
    expect(raw).not.toContain('先补回基本余量');
  });

  it('keeps preview completion in memory without writing a guest record', async () => {
    renderTestExperience(null);
    const user = await completeEmotionBattery();
    await user.click(screen.getByRole('button', { name: '返回测试目录' }));

    expect(screen.getByRole('button', { name: '情绪电量' }).textContent).toContain('已完成');
    expect(storage.has('holaday.energy.progress.v3:guest')).toBe(false);
  });
});
