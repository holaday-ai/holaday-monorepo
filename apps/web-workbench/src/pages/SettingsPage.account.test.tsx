// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(within(account).getByRole('link', { name: /个人资料/ }).getAttribute('href')).toBe(
      '/profile',
    );
    expect(within(account).getByRole('link', { name: /订阅与账单/ }).getAttribute('href')).toBe(
      '/billing',
    );
    expect(within(account).getByRole('link', { name: /用量与额度/ }).getAttribute('href')).toBe(
      '/usage',
    );
    expect(within(account).getByText('危险操作')).toBeTruthy();
  });

  it('keeps a visible support address and explains the mail-app fallback', async () => {
    const user = userEvent.setup();
    renderSettings();

    const account = screen.getByRole('region', { name: '账号' });
    const supportLink = within(account).getByRole('link', { name: 'support@holaday.ai' });
    expect(supportLink.getAttribute('href')).toBe('mailto:support@holaday.ai');

    await user.click(within(account).getByRole('button', { name: '邮件申请删除' }));

    const dialog = screen.getByRole('dialog', { name: '申请删除账号？' });
    expect(within(dialog).getByText(/若未自动打开/)).toBeTruthy();
    expect(within(dialog).getByText(/support@holaday\.ai/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '打开邮件应用' })).toBeTruthy();
  });

  it('describes deletion as a reviewed request with lawful retention exceptions', async () => {
    const user = userEvent.setup();
    renderSettings();

    const account = screen.getByRole('region', { name: '账号' });
    expect(within(account).getByText(/通过邮件提交申请/)).toBeTruthy();
    expect(within(account).getByText(/交易、安全或审计记录可能继续受限保存/)).toBeTruthy();

    await user.click(within(account).getByRole('button', { name: '邮件申请删除' }));
    const dialog = screen.getByRole('dialog', { name: '申请删除账号？' });
    expect(within(dialog).getByText(/邮件是申请入口，不代表账号会即时自动删除/)).toBeTruthy();
    expect(within(dialog).getByText(/依法需要保留/)).toBeTruthy();

    const text = dialog.textContent ?? '';
    expect(text).not.toContain('删除会清除任务记录、浏览器数据和订阅信息');
    expect(text).not.toContain('再完成账号关闭');
  });
});
