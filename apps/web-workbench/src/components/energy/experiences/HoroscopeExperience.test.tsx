// @vitest-environment happy-dom

import { buildAstroReading, createProfileFromBirthday } from '@/lib/astrology';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnergyAstrologyState } from '../useEnergyAstrology';
import { HoroscopeExperience } from './HoroscopeExperience';

afterEach(cleanup);

const profile = createProfileFromBirthday({
  birthday: '1996-03-21',
  birthTime: '08:30',
  birthPlace: 'Tokyo',
});
const reading = buildAstroReading(profile, new Date('2026-08-11T12:00:00+09:00'));

function astrologyState(source: EnergyAstrologyState['source'] = 'provider'): EnergyAstrologyState {
  return {
    reading,
    tarot: { title: 'The Star', subtitle: '提示', body: '卡片内容' },
    source,
    loading: false,
    error: source === 'local-fallback' ? '暂时使用本地提示' : null,
    refresh: vi.fn(),
  };
}

describe('HoroscopeExperience', () => {
  it('renders only the selected daily detail in one panel', async () => {
    const user = userEvent.setup();
    render(<HoroscopeExperience profile={profile} astrology={astrologyState()} />);

    const tabs = screen.getByRole('tablist', { name: '今日运势分类' });
    expect(within(tabs).getByRole('tab', { name: '总览' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByText(reading.fortune[0]?.body ?? '')).toBeTruthy();
    expect(screen.queryByText(reading.fortune[1]?.body ?? '')).toBeNull();

    await user.click(within(tabs).getByRole('tab', { name: '工作' }));

    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByText(reading.fortune[1]?.body ?? '')).toBeTruthy();
    expect(screen.queryByText(reading.fortune[0]?.body ?? '')).toBeNull();

    await user.click(within(tabs).getByRole('tab', { name: '本周' }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getAllByText(/周[一二三四五六日]/)).toHaveLength(7);
  });

  it('keeps natal and transit depth separate from the daily tabs', async () => {
    const user = userEvent.setup();
    render(<HoroscopeExperience profile={profile} astrology={astrologyState()} />);

    await user.click(screen.getByRole('button', { name: '星盘档案' }));
    expect(screen.queryByRole('tablist', { name: '今日运势分类' })).toBeNull();
    expect(screen.getByRole('heading', { name: /白羊座 的任务档案/ })).toBeTruthy();
    expect(screen.getByText(/长期不必追求一直高能量/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '流年提醒' }));
    expect(screen.queryByRole('tablist', { name: '今日运势分类' })).toBeNull();
    expect(screen.getByRole('heading', { name: '这一周，哪里更适合用力' })).toBeTruthy();
  });

  it('shows a low-noise fallback note instead of an error panel', () => {
    render(<HoroscopeExperience profile={profile} astrology={astrologyState('local-fallback')} />);

    expect(screen.getByText('暂时使用本地提示')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tablist', { name: '今日运势分类' })).toBeTruthy();
  });
});
