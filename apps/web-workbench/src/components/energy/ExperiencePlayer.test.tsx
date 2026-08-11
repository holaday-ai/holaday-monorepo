// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExperiencePlayer } from './ExperiencePlayer';
import type { EnergyExperienceDefinition, ExperiencePhase } from './energy-types';

afterEach(cleanup);

const TAROT: EnergyExperienceDefinition = {
  id: 'tarot',
  kind: 'card',
  title: '抽张卡',
  description: '给当下一个轻提示',
  estimatedSeconds: 30,
  status: 'active',
  actionable: true,
  requiredProfileFields: [],
};

interface HarnessProps {
  initialPhase?: ExperiencePhase;
  onClose?: () => void;
  onReplay?: () => void;
  onChooseAnother?: () => void;
}

function Harness({
  initialPhase = 'intro',
  onClose = vi.fn(),
  onReplay = vi.fn(),
  onChooseAnother = vi.fn(),
}: HarnessProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<ExperiencePhase>(initialPhase);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开抽卡
      </button>
      <ExperiencePlayer
        open={open}
        experience={TAROT}
        phase={phase}
        returnFocusRef={triggerRef}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        onStart={() => setPhase('active')}
        onReplay={() => {
          onReplay();
          setPhase('active');
        }}
        onChooseAnother={() => {
          onChooseAnother();
          setOpen(false);
        }}
      >
        <p>结果内容</p>
      </ExperiencePlayer>
    </>
  );
}

describe('ExperiencePlayer', () => {
  it('moves focus inside, closes with Escape, and restores the trigger', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    const trigger = screen.getByRole('button', { name: '打开抽卡' });
    await user.click(trigger);

    expect(screen.getByRole('dialog', { name: '抽张卡' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '开始体验' }));
    expect(screen.queryByText('结果内容')).toBeNull();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the experience content only after start', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '打开抽卡' }));
    expect(screen.queryByText('结果内容')).toBeNull();

    await user.click(screen.getByRole('button', { name: '开始体验' }));

    expect(screen.getByText('结果内容')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始体验' })).toBeNull();
  });

  it('offers replay and another mode in the result phase', async () => {
    const onReplay = vi.fn();
    const onChooseAnother = vi.fn();
    const user = userEvent.setup();
    render(<Harness initialPhase="result" onReplay={onReplay} onChooseAnother={onChooseAnother} />);

    await user.click(screen.getByRole('button', { name: '打开抽卡' }));

    expect(screen.getByText('结果内容')).toBeTruthy();
    const replay = screen.getByRole('button', { name: '再来一次' });
    expect(replay.className).toContain('bg-[#765184]');
    await user.click(replay);
    expect(onReplay).toHaveBeenCalledOnce();

    cleanup();
    render(<Harness initialPhase="result" onReplay={onReplay} onChooseAnother={onChooseAnother} />);
    await user.click(screen.getByRole('button', { name: '打开抽卡' }));
    await user.click(screen.getByRole('button', { name: '换个玩法' }));

    expect(onChooseAnother).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives the icon close control both an accessible name and a native tooltip', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '打开抽卡' }));
    const close = screen.getByRole('button', { name: '关闭体验' });

    expect(close.getAttribute('title')).toBe('关闭体验');
  });
});
