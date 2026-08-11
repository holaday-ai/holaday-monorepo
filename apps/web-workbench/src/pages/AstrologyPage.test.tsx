// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstrologyPageShell } from './AstrologyPageShell';

const trpcMocks = vi.hoisted(() => ({
  energyHome: vi.fn().mockResolvedValue({ experiences: [] }),
  energyEvent: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    energy: {
      home: { query: trpcMocks.energyHome },
      reportEvent: { mutate: trpcMocks.energyEvent },
    },
    astrology: {
      daily: { query: vi.fn() },
      tarot: { query: vi.fn() },
    },
  },
}));

afterEach(cleanup);

describe('AstrologyPageShell', () => {
  it('shows the local date in the wide recharge-hub shell', () => {
    const { container } = render(
      <AstrologyPageShell liveProvider={false} profileStorageScope={null} />,
    );

    expect(screen.getByLabelText('今日日期').textContent).toMatch(
      /^\d{4}年\d{1,2}月\d{1,2}日\s+星期[一二三四五六日]$/,
    );
    expect(container.firstElementChild?.className).toContain('max-w-[1180px]');
  });

  it('renders the real focused energy home', () => {
    render(<AstrologyPageShell liveProvider={false} profileStorageScope={null} />);

    expect(screen.getByRole('heading', { name: '今日能量', level: 1 })).toBeTruthy();
    const moodGroup = screen.getByRole('group', { name: '当前状态' });
    expect(within(moodGroup).getAllByRole('button')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /开始|抽一张|看看/ })).toHaveLength(1);
    expect(screen.queryByText('多元化命理')).toBeNull();
    expect(screen.queryByText('任务等待模式')).toBeNull();
  });
});
