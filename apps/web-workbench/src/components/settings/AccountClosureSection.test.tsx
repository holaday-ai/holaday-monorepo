// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountClosureSection } from './AccountClosureSection';

const trpcMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  mfaStatus: vi.fn(),
  requestVerification: vi.fn(),
  begin: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { mfaStatus: { query: trpcMocks.mfaStatus } },
    accountClosure: {
      preview: { query: trpcMocks.preview },
      requestVerification: { mutate: trpcMocks.requestVerification },
      begin: { mutate: trpcMocks.begin },
    },
  },
}));

const preview = {
  graceEndsAt: '2026-09-02T01:00:00.000Z',
  plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
  counts: {
    activeTasks: 2,
    futureTasks: 3,
    files: 4,
    stockItems: 5,
    notificationChannels: 1,
  },
  retainedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
  automaticRefund: false as const,
};

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname}</output>;
}

function renderSection(): void {
  render(
    <MemoryRouter initialEntries={['/settings#account']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AccountClosureSection />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  trpcMocks.preview.mockResolvedValue(preview);
  trpcMocks.mfaStatus.mockResolvedValue({ enabled: true, recoveryCodesRemaining: 8 });
  trpcMocks.requestVerification.mockResolvedValue({
    challengeId: 'ach_begin',
    channel: 'email',
    maskedDestination: 'y***@example.com',
    expiresAt: '2026-08-26T01:10:00.000Z',
  });
  trpcMocks.begin.mockResolvedValue({
    recoveryToken: 'recovery-only-token',
    requestStatus: 'pending_grace',
    graceEndsAt: preview.graceEndsAt,
    receipt: { receiptNumber: 'ACR-7K2P9' },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AccountClosureSection', () => {
  it('loads aggregate impact and shows the exact deadline, plan expiry, and no-refund boundary', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: '查看关闭影响' }));

    const dialog = await screen.findByRole('dialog', { name: '关闭账号 · 第 1 步' });
    expect(within(dialog).getByText('2026年9月2日 10:00')).toBeTruthy();
    expect(within(dialog).getByText(/Pro/)).toBeTruthy();
    expect(within(dialog).getByText(/2026年12月31日 09:00/)).toBeTruthy();
    expect(within(dialog).getByText('2 个运行中任务')).toBeTruthy();
    expect(within(dialog).getByText('3 个未来任务')).toBeTruthy();
    expect(within(dialog).getByText('4 个文件')).toBeTruthy();
    expect(within(dialog).getByText('5 个股票关注项')).toBeTruthy();
    expect(within(dialog).getByText('1 个通知渠道')).toBeTruthy();
    expect(within(dialog).getByText(/关闭不会自动退款/)).toBeTruthy();
    expect(within(dialog).getByText(/支付、退款与必要账务、合作方 KYC 与账本/)).toBeTruthy();
    expect(trpcMocks.preview).toHaveBeenCalledOnce();
  });

  it('requires all three plain-language acknowledgements before verification', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: '查看关闭影响' }));
    await user.click(await screen.findByRole('button', { name: '继续' }));

    const dialog = screen.getByRole('dialog', { name: '关闭账号 · 第 2 步' });
    const next = within(dialog).getByRole('button', { name: '继续验证' });
    expect(next.hasAttribute('disabled')).toBe(true);
    await user.click(within(dialog).getByRole('checkbox', { name: /立即退出登录/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /正在运行的任务会停止/ }));
    expect(next.hasAttribute('disabled')).toBe(true);
    await user.click(within(dialog).getByRole('checkbox', { name: /不会自动退款/ }));
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(within(dialog).queryByRole('textbox', { name: /输入确认文字/ })).toBeNull();
  });

  it('verifies the bound channel and MFA, submits once, and switches to recovery-only storage', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('holaday.access_token', 'normal-access');
    window.localStorage.setItem('holaday.cosmic.profile.v1.usr_1', 'private-profile');
    window.sessionStorage.setItem('holaday.mfa_challenge', 'stale-mfa');
    renderSection();

    await user.click(screen.getByRole('button', { name: '查看关闭影响' }));
    await user.click(await screen.findByRole('button', { name: '继续' }));
    const acknowledgements = screen.getAllByRole('checkbox');
    for (const checkbox of acknowledgements) await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '继续验证' }));
    await user.click(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText(/y\*\*\*@example\.com/)).toBeTruthy();
    await user.type(screen.getByLabelText('6 位验证码'), '482901');
    await user.type(screen.getByLabelText('MFA 动态码或恢复码'), '123456');
    const submit = screen.getByRole('button', { name: '确认关闭账号' });
    await user.dblClick(submit);

    await waitFor(() => expect(trpcMocks.begin).toHaveBeenCalledOnce());
    expect(trpcMocks.begin).toHaveBeenCalledWith({
      challengeId: 'ach_begin',
      code: '482901',
      mfaCode: '123456',
      acknowledgements: {
        immediateSignOut: true,
        runningWorkStops: true,
        noAutomaticRefund: true,
      },
    });
    expect(window.localStorage.getItem('holaday.access_token')).toBeNull();
    expect(window.localStorage.getItem('holaday.cosmic.profile.v1.usr_1')).toBeNull();
    expect(
      [...Array(window.sessionStorage.length)].map((_, index) => window.sessionStorage.key(index)),
    ).toEqual(['holaday.closure_recovery']);
    expect(window.sessionStorage.getItem('holaday.closure_recovery')).toBe('recovery-only-token');
    expect(screen.getByLabelText('当前位置').textContent).toBe('/account/closure-recovery');
  });

  it('traps keyboard focus, labels its icon-only close control, and focuses a generic error', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: '查看关闭影响' }));

    const dialog = await screen.findByRole('dialog', { name: '关闭账号 · 第 1 步' });
    const close = within(dialog).getByRole('button', { name: '关闭账号向导' });
    expect(close.getAttribute('title')).toBe('关闭账号向导');
    close.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '继续' }));

    await user.keyboard('{Escape}');
    trpcMocks.preview.mockRejectedValueOnce(new Error('private server detail'));
    await user.click(screen.getByRole('button', { name: '查看关闭影响' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('暂时无法完成账号关闭操作，请稍后重试。');
    expect(document.activeElement).toBe(alert);
  });

  it('keeps every step operable in a 390px viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: '查看关闭影响' }));
    const dialog = await screen.findByRole('dialog', { name: '关闭账号 · 第 1 步' });
    expect(within(dialog).getByRole('button', { name: '继续' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '继续' }));
    expect(screen.getByRole('dialog', { name: '关闭账号 · 第 2 步' })).toBeTruthy();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
