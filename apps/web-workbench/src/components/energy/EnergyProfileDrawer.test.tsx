// @vitest-environment happy-dom

import type { AstroProfile } from '@/lib/astrology';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyProfileDrawer } from './EnergyProfileDrawer';

const astrologyMocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@/lib/astrology', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/astrology')>();
  return {
    ...actual,
    readAstroProfile: astrologyMocks.read,
    saveAstroProfile: astrologyMocks.save,
    clearAstroProfile: astrologyMocks.clear,
  };
});

const storedProfile: AstroProfile = {
  name: '',
  birthday: '1996-03-21',
  birthTime: '',
  birthPlace: '',
  zodiacSign: 'aries',
};

function Harness({
  onProfileChange = vi.fn(),
}: { onProfileChange?: (profile: AstroProfile | null) => void }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        我的能量
      </button>
      <EnergyProfileDrawer
        open={open}
        storageScope="usr_energy"
        returnFocusRef={triggerRef}
        onOpenChange={setOpen}
        onProfileChange={onProfileChange}
      />
    </>
  );
}

beforeEach(() => {
  astrologyMocks.read.mockReset();
  astrologyMocks.save.mockReset();
  astrologyMocks.clear.mockReset();
  astrologyMocks.read.mockReturnValue(storedProfile);
});

afterEach(cleanup);

describe('EnergyProfileDrawer', () => {
  it('explains profile use, reveals optional fields, and saves the local profile', async () => {
    const onProfileChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onProfileChange={onProfileChange} />);

    await user.click(screen.getByRole('button', { name: '我的能量' }));
    expect(screen.getByRole('dialog', { name: '我的能量' })).toBeTruthy();
    expect(screen.getByText('用于计算星座')).toBeTruthy();
    expect(screen.getByLabelText('生日')).toBeTruthy();
    expect(screen.queryByLabelText('出生时间')).toBeNull();
    expect(screen.queryByLabelText('出生地点')).toBeNull();

    await user.click(screen.getByRole('button', { name: '完善星象资料' }));
    await user.type(screen.getByLabelText('出生时间'), '08:30');
    await user.type(screen.getByLabelText('出生地点'), 'Tokyo');
    await user.click(screen.getByRole('button', { name: '保存资料' }));

    expect(astrologyMocks.save).toHaveBeenCalledWith(
      {
        name: '',
        birthday: '1996-03-21',
        birthTime: '08:30',
        birthPlace: 'Tokyo',
        zodiacSign: 'aries',
      },
      'usr_energy',
    );
    expect(onProfileChange).toHaveBeenCalledWith(expect.objectContaining({ birthTime: '08:30' }));
  });

  it('requires confirmation before clearing and restores trigger focus on close', async () => {
    const onProfileChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onProfileChange={onProfileChange} />);

    const trigger = screen.getByRole('button', { name: '我的能量' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '清除资料' }));
    expect(astrologyMocks.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认清除' }));
    expect(astrologyMocks.clear).toHaveBeenCalledWith('usr_energy');
    expect(onProfileChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    const close = screen.getByRole('button', { name: '关闭个人资料' });
    expect(close.getAttribute('title')).toBe('关闭个人资料');
    await user.click(close);
    expect(document.activeElement).toBe(trigger);
  });
});
