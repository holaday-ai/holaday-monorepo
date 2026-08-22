// @vitest-environment happy-dom

import { clearAccessToken, clearMfaChallenge, getAccessToken, setMfaChallenge } from '@/lib/auth';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginGate } from './LoginGate';

const trpcMocks = vi.hoisted(() => ({
  loginOptions: vi.fn(),
  login: vi.fn(),
  verifyMfaChallenge: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      loginOptions: { query: trpcMocks.loginOptions },
      login: { mutate: trpcMocks.login },
      verifyMfaChallenge: { mutate: trpcMocks.verifyMfaChallenge },
    },
  },
}));

beforeEach(() => {
  clearAccessToken();
  clearMfaChallenge();
  trpcMocks.loginOptions.mockResolvedValue({ google: false, emailCode: false, sms: false });
  trpcMocks.verifyMfaChallenge.mockResolvedValue({ accessToken: 'verified-access-token' });
});

afterEach(() => {
  cleanup();
  clearAccessToken();
  clearMfaChallenge();
  vi.clearAllMocks();
});

describe('LoginGate MFA challenge', () => {
  it('continues password login with an authenticator challenge', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    trpcMocks.login.mockResolvedValue({
      mfaRequired: true,
      mfaToken: 'mfa-challenge-token',
      user: { externalId: 'usr_mfa' },
    });
    render(<LoginGate onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText('邮箱'), 'member@example.com');
    await user.type(screen.getByLabelText('密码'), 'password-42');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('heading', { name: '双重验证' })).toBeTruthy();
    await user.type(screen.getByLabelText('身份验证器或恢复码'), '123456');
    await user.click(screen.getByRole('button', { name: '验证并登录' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(getAccessToken()).toBe('verified-access-token');
    expect(trpcMocks.verifyMfaChallenge).toHaveBeenCalledWith({
      mfaToken: 'mfa-challenge-token',
      code: '123456',
    });
  });

  it('resumes a Google OAuth MFA challenge from the URL-fragment handoff', async () => {
    setMfaChallenge('google-mfa-token');
    render(<LoginGate onAuthenticated={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '双重验证' })).toBeTruthy();
  });
});
