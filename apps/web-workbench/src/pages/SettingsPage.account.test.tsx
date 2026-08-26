// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

vi.mock('@/components/ApiKeysSection', () => ({ ApiKeysSection: () => null }));
vi.mock('@/components/notifications/NotificationsSection', () => ({
  NotificationsSection: () => null,
}));
vi.mock('@/components/settings/MemorySection', () => ({ MemorySection: () => null }));
vi.mock('@/stores/theme-store', () => ({
  useTheme: () => ({ mode: 'light', setMode: vi.fn() }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { mfaStatus: { query: vi.fn() } },
    accountClosure: {
      preview: { query: vi.fn() },
      requestVerification: { mutate: vi.fn() },
      begin: { mutate: vi.fn() },
    },
  },
}));

function renderSettings(): void {
  render(
    <MemoryRouter initialEntries={['/settings#account']}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsPage account hub', () => {
  it('routes users to profile, billing, and usage before the destructive action', () => {
    renderSettings();

    const account = screen.getByRole('region', { name: '账号' });
    expect(
      within(account)
        .getByRole('link', { name: /个人资料/ })
        .getAttribute('href'),
    ).toBe('/profile');
    expect(
      within(account)
        .getByRole('link', { name: /订阅与账单/ })
        .getAttribute('href'),
    ).toBe('/billing');
    expect(
      within(account)
        .getByRole('link', { name: /用量与额度/ })
        .getAttribute('href'),
    ).toBe('/usage');
    expect(within(account).getByText('关闭账号')).toBeTruthy();
  });

  it('places the calm self-service closure entry at the bottom of account and security', () => {
    renderSettings();

    const account = screen.getByRole('region', { name: '账号' });
    expect(within(account).getByText('关闭账号')).toBeTruthy();
    expect(within(account).getByText(/7 天冷静期/)).toBeTruthy();
    expect(within(account).getByText(/关闭不会自动退款/)).toBeTruthy();
    const trigger = within(account).getByRole('button', { name: '查看关闭影响' });
    expect(trigger).toBeTruthy();
    expect(within(account).queryByRole('link', { name: 'support@holaday.ai' })).toBeNull();
    expect(within(account).queryByRole('button', { name: '邮件申请删除' })).toBeNull();
  });
});
