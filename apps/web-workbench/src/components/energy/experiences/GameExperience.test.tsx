// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnergyGameId } from '../energy-content-target';
import type { ExperiencePhase } from '../energy-types';
import { GameExperience } from './GameExperience';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ gameId, onComplete = vi.fn() }: { gameId: EnergyGameId; onComplete?: () => void }) {
  const [phase, setPhase] = React.useState<ExperiencePhase>('active');
  return (
    <GameExperience
      initialGameId={gameId}
      phase={phase}
      onPhaseChange={setPhase}
      onComplete={onComplete}
    />
  );
}

describe('GameExperience', () => {
  it('completes catch-energy through twelve keyboard-accessible targets', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness gameId="catch-energy" onComplete={onComplete} />);

    for (let round = 1; round <= 12; round += 1) {
      await user.click(screen.getByRole('button', { name: `接住第 ${round} 个能量光点` }));
    }

    expect(onComplete).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: '能量收集完成' })).toBeTruthy();
  });

  it('completes four breath rounds with manual controls and static reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness gameId="breath-rhythm" onComplete={onComplete} />);

    expect(screen.getByTestId('breath-stage').getAttribute('data-motion')).toBe('static');
    for (let step = 0; step < 8; step += 1) {
      await user.click(screen.getByRole('button', { name: /继续到呼气|完成第 \d 轮/ }));
    }

    expect(onComplete).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: '四轮呼吸完成' })).toBeTruthy();
  });

  it('repeats a wrong color-memory round more gently and completes three rounds', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness gameId="color-memory" onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: '开始回答' }));
    await user.click(screen.getByRole('button', { name: '菱形' }));
    expect(screen.getByRole('status').textContent).toContain('再看一次，这一轮会更短');
    expect(screen.queryByText(/失败|扣分|连胜中断/)).toBeNull();

    for (let round = 1; round <= 3; round += 1) {
      await user.click(screen.getByRole('button', { name: round === 1 ? '重新观察' : '观察下一轮' }));
      await user.click(screen.getByRole('button', { name: '开始回答' }));
      const sequence = round === 1
        ? ['圆形', '方形', '星形']
        : round === 2
          ? ['方形', '星形', '菱形', '圆形']
          : ['星形', '圆形', '菱形', '方形', '星形'];
      for (const label of sequence) await user.click(screen.getByRole('button', { name: label }));
    }

    expect(onComplete).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: '颜色记忆完成' })).toBeTruthy();
  });
});
