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
  it('keeps the mobile title below the fixed shell controls', () => {
    const { container } = render(
      <AstrologyPageShell liveProvider={false} profileStorageScope={null} />,
    );

    expect(screen.getByLabelText('今日日期').textContent).toMatch(
      /^\d{4}年\d{1,2}月\d{1,2}日\s+星期[一二三四五六日]$/,
    );
    const shellClassName = container.firstElementChild?.className ?? '';
    expect(shellClassName).toContain('max-w-[1180px]');
    expect(shellClassName).toContain('!pt-14');
    expect(shellClassName).toContain('min-[769px]:!pt-5');
    expect(shellClassName).not.toContain('!pt-4');
  });

  it('renders the real focused energy home', () => {
    render(<AstrologyPageShell liveProvider={false} profileStorageScope={null} />);

    expect(screen.getByRole('heading', { name: '今日能量', level: 1 })).toBeTruthy();
    const needGroup = screen.getByRole('group', { name: '补给能量' });
    expect(within(needGroup).getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '开始 30 秒补给' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '选一个轻松玩法' })).getAllByRole('button'),
    ).toHaveLength(3);
    expect(screen.getByRole('region', { name: '今日能量成长' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '你的星座能量' })).toBeTruthy();
    expect(screen.queryByText('多元化命理')).toBeNull();
    expect(screen.queryByText('任务等待模式')).toBeNull();
  });
});
