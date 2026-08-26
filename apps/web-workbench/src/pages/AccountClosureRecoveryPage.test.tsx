// @vitest-environment happy-dom

import { clearClosureRecovery, getClosureRecovery, setClosureRecovery } from '@/lib/auth';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountClosureRecoveryPage,
  ClosureRecoveryRouteBoundary,
} from './AccountClosureRecoveryPage';

const trpcMocks = vi.hoisted(() => ({
  status: vi.fn(),
  applicationReceipt: vi.fn(),
  requestCancellationVerification: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    accountClosure: {
      status: { query: trpcMocks.status },
      applicationReceipt: { query: trpcMocks.applicationReceipt },
      requestCancellationVerification: { mutate: trpcMocks.requestCancellationVerification },
      cancel: { mutate: trpcMocks.cancel },
    },
  },
}));

const graceStatus = {
  requestStatus: 'pending_grace' as const,
  requestedAt: '2026-08-26T01:00:00.000Z',
  graceEndsAt: '2026-09-02T01:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  canCancel: true,
  plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
  mfaRequired: true,
};

const receipt = {
  receiptNumber: 'ACR-7K2P9',
  kind: 'application' as const,
  issuedAt: '2026-08-26T01:00:00.000Z',
  completedCategoryIds: [],
  restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
};

function renderRecovery(initialPath = '/account/closure-recovery'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/account/closure-recovery" element={<AccountClosureRecoveryPage />} />
        <Route path="/login" element={<div>登录页</div>} />
        <Route path="/stocks" element={<div>股票页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-31T23:58:59.000Z'));
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  setClosureRecovery('recovery-token');
  trpcMocks.status.mockResolvedValue(graceStatus);
  trpcMocks.applicationReceipt.mockResolvedValue(receipt);
  trpcMocks.requestCancellationVerification.mockResolvedValue({
    challengeId: 'ach_cancel',
    channel: 'email',
    maskedDestination: 'y***@example.com',
    expiresAt: '2026-09-01T00:08:59.000Z',
  });
  trpcMocks.cancel.mockResolvedValue({ cancelled: true });
});

afterEach(() => {
  cleanup();
  clearClosureRecovery();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

describe('AccountClosureRecoveryPage', () => {
  it('shows the exact deadline, countdown, receipt, plan expiry, and precise restoration promise', async () => {
    renderRecovery();

    expect(await screen.findByRole('heading', { name: '账号关闭冷静期' })).toBeTruthy();
    expect(screen.getByText('剩余 1天 1小时 1分')).toBeTruthy();
    expect(screen.getByText('2026年9月2日 10:00')).toBeTruthy();
    expect(screen.getByText('申请回执 ACR-7K2P9')).toBeTruthy();
    expect(screen.getByText(/Pro 套餐原到期时间：2026年12月31日 09:00/)).toBeTruthy();
    expect(screen.getByText(/撤回后恢复原套餐与额度，不会增加或顺延 7 天/)).toBeTruthy();
    expect(screen.getByText(/关闭不会自动退款/)).toBeTruthy();
    expect(screen.getByText(/暂停范围：正常产品访问、新任务和仍在运行的任务/)).toBeTruthy();
    expect(screen.getByText(/支付、退款与必要账务、合作方 KYC 与账本/)).toBeTruthy();
  });

  it('requires a fresh bound verification and MFA before cancellation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderRecovery();
    await screen.findByRole('heading', { name: '账号关闭冷静期' });

    await user.click(screen.getByRole('button', { name: '撤回关闭申请' }));
    const dialog = screen.getByRole('dialog', { name: '验证并撤回关闭申请' });
    await user.click(within(dialog).getByRole('button', { name: '发送验证码' }));
    expect(await within(dialog).findByText(/y\*\*\*@example\.com/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText('6 位验证码'), '193842');
    await user.type(within(dialog).getByLabelText('MFA 动态码或恢复码'), '654321');
    await user.click(within(dialog).getByRole('button', { name: '确认撤回' }));

    await waitFor(() => expect(trpcMocks.cancel).toHaveBeenCalledOnce());
    expect(trpcMocks.cancel).toHaveBeenCalledWith({
      recoveryToken: 'recovery-token',
      challengeId: 'ach_cancel',
      code: '193842',
      mfaCode: '654321',
    });
    expect(await screen.findByRole('heading', { name: '关闭申请已撤回' })).toBeTruthy();
    expect(screen.getByText(/套餐仍按 2026年12月31日 09:00 到期/)).toBeTruthy();
    expect(getClosureRecovery()).toBeNull();
  });

  it.each([
    ['processing', '正在完成账号关闭'],
    ['needs_attention', '账号关闭正在由专人跟进'],
    ['completed', '账号已经关闭'],
  ] as const)(
    'renders %s without a withdrawal action and performs best-effort local cleanup',
    async (requestStatus, heading) => {
      window.localStorage.setItem('holaday.cosmic.profile.v1.usr_1', 'private-profile');
      window.localStorage.setItem('holaday.energy.progress.v4:usr_1', 'private-progress');
      trpcMocks.status.mockResolvedValue({
        ...graceStatus,
        requestStatus,
        canCancel: false,
        completedAt: requestStatus === 'completed' ? '2026-09-02T01:15:00.000Z' : null,
      });

      renderRecovery();

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      expect(screen.getByText('申请回执 ACR-7K2P9')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '撤回关闭申请' })).toBeNull();
      expect(window.localStorage.getItem('holaday.cosmic.profile.v1.usr_1')).toBeNull();
      expect(window.localStorage.getItem('holaday.energy.progress.v4:usr_1')).toBeNull();
    },
  );

  it('offers immediate local cleanup and states the remote-copy limitation truthfully', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderRecovery();
    await screen.findByRole('heading', { name: '账号关闭冷静期' });
    window.localStorage.setItem('holaday.cosmic.profile.v1.usr_1', 'private-profile');

    await user.click(screen.getByRole('button', { name: '立即清除本机资料' }));

    expect(window.localStorage.getItem('holaday.cosmic.profile.v1.usr_1')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/已清除当前浏览器/);
    expect(
      screen.getByText(/无法远程清除其他设备、浏览器扩展、已下载文件或其他本地副本/),
    ).toBeTruthy();
  });

  it('shows only a generic error and moves focus to it', async () => {
    trpcMocks.status.mockRejectedValue(new Error('request 19 belongs to user 42'));
    renderRecovery();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('暂时无法读取账号关闭状态，请重新登录后再试。');
    expect(alert.textContent).not.toContain('request 19');
    expect(document.activeElement).toBe(alert);
  });
});

describe('ClosureRecoveryRouteBoundary', () => {
  it('redirects a recovery-token session away from every normal product route', async () => {
    render(
      <MemoryRouter initialEntries={['/stocks']}>
        <Routes>
          <Route element={<ClosureRecoveryRouteBoundary />}>
            <Route path="/stocks" element={<div>股票页</div>} />
            <Route path="/account/closure-recovery" element={<div>专用账号关闭恢复页</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('专用账号关闭恢复页')).toBeTruthy();
    expect(screen.queryByText('股票页')).toBeNull();
  });

  it('sends visitors without a recovery credential to login', async () => {
    clearClosureRecovery();
    renderRecovery();
    expect(await screen.findByText('登录页')).toBeTruthy();
  });
});
