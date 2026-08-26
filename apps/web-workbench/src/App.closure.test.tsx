// @vitest-environment happy-dom

import { setClosureRecovery } from '@/lib/auth';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('@/components/AdminLayout', () => ({
  AdminLayout: () => <div>admin shell</div>,
}));
vi.mock('@/components/AppShell', () => ({
  AppShell: () => <div>product shell</div>,
}));
vi.mock('@/pages/LoginPage', () => ({ LoginPage: () => <div>login page</div> }));
vi.mock('@/pages/RegisterPage', () => ({ RegisterPage: () => <div>register page</div> }));
vi.mock('@/pages/RedirectIfAuthed', () => ({
  RedirectIfAuthed: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./WorkbenchApp', () => ({ WorkbenchApp: () => <div>workbench</div> }));
vi.mock('@/pages/AccountClosureRecoveryPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/AccountClosureRecoveryPage')>();
  return {
    ...actual,
    AccountClosureRecoveryPage: () => <div>专用账号关闭恢复页</div>,
  };
});

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App account-closure recovery route', () => {
  it('mounts the recovery guard above the real product route table', async () => {
    setClosureRecovery('recovery-token');

    render(
      <MemoryRouter initialEntries={['/stocks']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('专用账号关闭恢复页')).toBeTruthy();
    expect(screen.queryByText('product shell')).toBeNull();
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
