// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationInvitationAcceptPage,
  invitationSafePath,
  invitationTokenFromHash,
} from './OrganizationInvitationAcceptPage';

const api = vi.hoisted(() => ({ accept: vi.fn(), me: vi.fn() }));
const shell = vi.hoisted(() => ({
  me: { teamProjectsEnabled: true } as {
    teamProjectsEnabled: boolean;
  } | null,
}));

vi.mock('@/components/AppShell', () => ({
  useAppShellContext: () => ({
    me: shell.me,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { me: { query: api.me } },
    organizations: { acceptInvitation: { mutate: api.accept } },
  },
}));

function renderPage(entry: string, strict = false): void {
  const page = (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/organizations/invitations/accept"
          element={<OrganizationInvitationAcceptPage />}
        />
        <Route path="/projects" element={<div>项目空间</div>} />
      </Routes>
    </MemoryRouter>
  );
  render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  shell.me = { teamProjectsEnabled: true };
  api.me.mockReset().mockResolvedValue({ teamProjectsEnabled: true });
  api.accept.mockReset().mockResolvedValue({ membershipId: 'omem_new', status: 'joined' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('organization invitation acceptance route', () => {
  it('reads only a fragment token and clears it before the mutation settles', async () => {
    let finish: ((value: { membershipId: string; status: 'joined' }) => void) | undefined;
    api.accept.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const replaceState = vi.spyOn(window.history, 'replaceState');

    renderPage('/organizations/invitations/accept#token=one-time-secret');

    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(
        window.history.state,
        '',
        '/organizations/invitations/accept',
      ),
    );
    expect(api.accept).toHaveBeenCalledTimes(1);
    expect(api.accept).toHaveBeenCalledWith({ token: 'one-time-secret' });
    expect(screen.queryByText(/one-time-secret/)).toBeNull();

    finish?.({ membershipId: 'omem_new', status: 'joined' });
    expect(await screen.findByText('已加入团队')).toBeTruthy();
  });

  it('does not submit when the account kill switch is off', async () => {
    shell.me = { teamProjectsEnabled: false };
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderPage('/organizations/invitations/accept#token=disabled-secret');

    expect(await screen.findByText('团队空间暂未开放')).toBeTruthy();
    expect(api.accept).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      '',
      '/organizations/invitations/accept',
    );
  });

  it('keeps the fragment token until a delayed auth snapshot enables the account', async () => {
    shell.me = null;
    let finishAuth: ((value: { teamProjectsEnabled: boolean }) => void) | undefined;
    api.me.mockReturnValueOnce(
      new Promise((resolve) => {
        finishAuth = resolve;
      }),
    );

    renderPage('/organizations/invitations/accept#token=cold-start-secret');

    expect(await screen.findByText('正在验证邀请')).toBeTruthy();
    expect(api.accept).not.toHaveBeenCalled();
    finishAuth?.({ teamProjectsEnabled: true });

    await waitFor(() => expect(api.accept).toHaveBeenCalledWith({ token: 'cold-start-secret' }));
    expect(await screen.findByText('已加入团队')).toBeTruthy();
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('submits once and keeps the result under StrictMode effect replay', async () => {
    let finish: ((value: { membershipId: string; status: 'joined' }) => void) | undefined;
    api.accept.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    renderPage('/organizations/invitations/accept#token=strict-secret', true);

    await waitFor(() => expect(api.accept).toHaveBeenCalledTimes(1));
    finish?.({ membershipId: 'omem_new', status: 'joined' });
    expect(await screen.findByText('已加入团队')).toBeTruthy();
    expect(api.accept).toHaveBeenCalledTimes(1);
  });

  it('shows one indistinguishable failure for expired, revoked, or replayed invitations', async () => {
    api.accept.mockRejectedValueOnce(new Error('INVITATION_NOT_AVAILABLE'));
    renderPage('/organizations/invitations/accept#token=unavailable-secret');

    expect(await screen.findByText('邀请已失效')).toBeTruthy();
    expect(api.accept).toHaveBeenCalledTimes(1);
  });

  it('rejects query-string and missing invitation tokens without submitting', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderPage('/organizations/invitations/accept?token=legacy-query-secret');

    expect(await screen.findByText('邀请链接不完整')).toBeTruthy();
    expect(api.accept).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      '',
      '/organizations/invitations/accept',
    );
    expect(screen.queryByText(/legacy-query-secret/)).toBeNull();
  });
});

describe('invitationTokenFromHash', () => {
  it('accepts a token parameter only from the fragment', () => {
    expect(invitationTokenFromHash('#token=opaque+token')).toBe('opaque token');
    expect(invitationTokenFromHash('?token=query-secret')).toBe('');
    expect(invitationTokenFromHash('#other=value')).toBe('');
  });

  it('removes only a legacy token query parameter from the safe browser path', () => {
    expect(
      invitationSafePath('/organizations/invitations/accept', '?source=email&token=secret'),
    ).toBe('/organizations/invitations/accept?source=email');
  });
});
