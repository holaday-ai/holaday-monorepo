// @vitest-environment happy-dom

import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

const trpcMocks = vi.hoisted(() => ({
  me: vi.fn(),
  sendPasswordChangeCode: vi.fn(),
  changePasswordWithCode: vi.fn(),
  mfaStatus: vi.fn(),
  beginMfaSetup: vi.fn(),
  confirmMfaSetup: vi.fn(),
  regenerateMfaRecoveryCodes: vi.fn(),
  disableMfa: vi.fn(),
}));

vi.mock('qrcode', () => ({
  toDataURL: vi.fn(async () => 'data:image/png;base64,mfa-qr'),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      me: { query: trpcMocks.me },
      sendPasswordChangeCode: { mutate: trpcMocks.sendPasswordChangeCode },
      changePasswordWithCode: { mutate: trpcMocks.changePasswordWithCode },
      mfaStatus: { query: trpcMocks.mfaStatus },
      beginMfaSetup: { mutate: trpcMocks.beginMfaSetup },
      confirmMfaSetup: { mutate: trpcMocks.confirmMfaSetup },
      regenerateMfaRecoveryCodes: { mutate: trpcMocks.regenerateMfaRecoveryCodes },
      disableMfa: { mutate: trpcMocks.disableMfa },
    },
  },
}));

beforeEach(() => {
  clearAccessToken();
  trpcMocks.me.mockResolvedValue({
    email: 'member@example.com',
    displayName: 'Member',
  });
  trpcMocks.sendPasswordChangeCode.mockResolvedValue({ ok: true, cooldownMs: 60_000 });
  trpcMocks.changePasswordWithCode.mockResolvedValue({
    accessToken: 'fresh-access-token',
    user: {
      externalId: 'usr_member',
      email: 'member@example.com',
      plan: 'free',
      displayName: 'Member',
      avatarUrl: null,
      createdAt: new Date(),
    },
  });
  trpcMocks.mfaStatus.mockResolvedValue({ enabled: false, recoveryCodesRemaining: 0 });
  trpcMocks.beginMfaSetup.mockResolvedValue({
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/HOLA%20DAY%3Amember%40example.com?secret=JBSWY3DP',
  });
  trpcMocks.confirmMfaSetup.mockResolvedValue({
    accessToken: 'mfa-enabled-token',
    recoveryCodes: ['ABCDE-23456', 'FGHJK-789AB'],
  });
});

afterEach(() => {
  cleanup();
  clearAccessToken();
  vi.clearAllMocks();
});

describe('ProfilePage password self-service', () => {
  it('offers a real authenticator setup instead of email or SMS pseudo-2FA', async () => {
    render(<ProfilePage />);

    await screen.findByRole('heading', { name: '账号安全' });
    expect(await screen.findByRole('button', { name: '开启双重验证' })).toBeTruthy();
    expect(screen.getByText('使用身份验证器生成动态验证码')).toBeTruthy();
    expect(screen.queryByText('使用手机或邮箱验证码二次确认登录')).toBeNull();
  });

  it('enables an authenticator and reveals recovery codes only after verification', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(await screen.findByRole('button', { name: '开启双重验证' }));
    expect(await screen.findByRole('img', { name: '双重验证二维码' })).toBeTruthy();
    await user.type(screen.getByLabelText('身份验证器验证码'), '123456');
    await user.click(screen.getByRole('button', { name: '确认开启' }));

    expect(await screen.findByRole('heading', { name: '保存恢复码' })).toBeTruthy();
    expect(screen.getByText('ABCDE-23456')).toBeTruthy();
    expect(getAccessToken()).toBe('mfa-enabled-token');
    expect(trpcMocks.confirmMfaSetup).toHaveBeenCalledWith({ code: '123456' });
  });

  it('keeps only one security workflow open at a time', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await screen.findByRole('heading', { name: '账号安全' });
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByRole('form', { name: '修改密码' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '开启双重验证' }));
    expect(await screen.findByRole('form', { name: '开启双重验证' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: '修改密码' })).toBeNull();
  });

  it('changes the password with a code sent to the authenticated account', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await screen.findByRole('heading', { name: '账号安全' });
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    const form = screen.getByRole('form', { name: '修改密码' });
    await user.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByText('验证码已发送至当前账号邮箱，5 分钟内有效。')).toBeTruthy();

    await user.type(screen.getByLabelText('邮箱验证码'), '123456');
    await user.type(screen.getByLabelText('新密码'), 'new-password-42');
    await user.type(screen.getByLabelText('确认新密码'), 'new-password-42');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('fresh-access-token');
    });
    expect(screen.getByText('密码已修改，其他设备需要重新登录。')).toBeTruthy();
    expect(form.getAttribute('aria-busy')).toBe('false');
    expect(trpcMocks.changePasswordWithCode).toHaveBeenCalledWith({
      code: '123456',
      password: 'new-password-42',
    });
  });

  it('rejects mismatched passwords before submitting', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await screen.findByRole('heading', { name: '账号安全' });
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    await user.type(screen.getByLabelText('邮箱验证码'), '123456');
    await user.type(screen.getByLabelText('新密码'), 'new-password-42');
    await user.type(screen.getByLabelText('确认新密码'), 'different-password');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(screen.getByRole('alert').textContent).toContain('两次输入的新密码不一致');
    expect(trpcMocks.changePasswordWithCode).not.toHaveBeenCalled();
  });
});
