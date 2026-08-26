// @vitest-environment happy-dom

import {
  clearAccessToken,
  clearClosureRecovery,
  clearMfaChallenge,
  getAccessToken,
  getClosureRecovery,
  getMfaChallenge,
  setClosureRecovery,
  setMfaChallenge,
} from '@/lib/auth';
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

const recoveryResult = {
  user: { externalId: 'usr_closure_login' },
  closureRecoveryRequired: true as const,
  recoveryToken: 'closure-login-token',
  closureStatus: 'pending_grace' as const,
};

beforeEach(() => {
  clearAccessToken();
  clearMfaChallenge();
  clearClosureRecovery();
  trpcMocks.loginOptions.mockResolvedValue({ google: false, emailCode: false, sms: false });
  trpcMocks.login.mockReset();
  trpcMocks.verifyMfaChallenge.mockReset();
});

afterEach(() => {
  cleanup();
  clearAccessToken();
  clearMfaChallenge();
  clearClosureRecovery();
  vi.clearAllMocks();
});

describe('LoginGate closure recovery handoff', () => {
  it('stores password-login recovery and enters the dedicated recovery flow', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const onClosureRecovery = vi.fn();
    trpcMocks.login.mockResolvedValue(recoveryResult);
    render(
      <LoginGate
        initialMode="login"
        onAuthenticated={onAuthenticated}
        onClosureRecovery={onClosureRecovery}
      />,
    );

    await user.type(screen.getByLabelText('邮箱'), 'member@example.com');
    await user.type(screen.getByLabelText('密码'), 'password-42');
    await user.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(onClosureRecovery).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(getClosureRecovery()).toBe('closure-login-token');
    expect(getAccessToken()).toBeNull();
    expect(getMfaChallenge()).toBeNull();
  });

  it('cannot turn a pre-freeze MFA challenge into normal access', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const onClosureRecovery = vi.fn();
    setMfaChallenge('pre-freeze-mfa-token');
    trpcMocks.verifyMfaChallenge.mockResolvedValue(recoveryResult);
    render(<LoginGate onAuthenticated={onAuthenticated} onClosureRecovery={onClosureRecovery} />);

    await user.type(screen.getByLabelText('身份验证器或恢复码'), '123456');
    await user.click(screen.getByRole('button', { name: '验证并登录' }));

    await waitFor(() => expect(onClosureRecovery).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(getClosureRecovery()).toBe('closure-login-token');
    expect(getAccessToken()).toBeNull();
    expect(getMfaChallenge()).toBeNull();
  });

  it('continues an OAuth closure fragment already stored for this tab', async () => {
    const onClosureRecovery = vi.fn();
    setClosureRecovery('oauth-closure-token');

    render(<LoginGate onAuthenticated={vi.fn()} onClosureRecovery={onClosureRecovery} />);

    await waitFor(() => expect(onClosureRecovery).toHaveBeenCalledTimes(1));
    expect(getClosureRecovery()).toBe('oauth-closure-token');
    expect(getAccessToken()).toBeNull();
  });
});
