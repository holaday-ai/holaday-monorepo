// @vitest-environment happy-dom

/**
 * FIX-60 BOSS 决定 (2026-11-09): the 「任务处理区域」 choice is off by default — no settings entry,
 * no dialog; on, it is shown as before.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const shell = vi.hoisted(() => ({ me: null as Record<string, unknown> | null }));

vi.mock('@/components/AppShell', () => ({
  useAppShellContext: () => ({ me: shell.me, refreshMe: vi.fn() }),
}));
vi.mock('@/components/ApiKeysSection', () => ({ ApiKeysSection: () => null }));
vi.mock('@/components/notifications/NotificationsSection', () => ({
  NotificationsSection: () => null,
}));
vi.mock('@/components/settings/MemorySection', () => ({ MemorySection: () => null }));
vi.mock('@/components/settings/BrowserDataSection', () => ({ BrowserDataSection: () => null }));
vi.mock('@/stores/theme-store', () => ({
  useTheme: () => ({ mode: 'light', setMode: vi.fn() }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { mfaStatus: { query: vi.fn() }, assignModelDataRegion: { mutate: vi.fn() } },
    accountClosure: {
      preview: { query: vi.fn() },
      requestVerification: { mutate: vi.fn() },
      begin: { mutate: vi.fn() },
    },
  },
}));

function renderSettings(): void {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsPage region choice', () => {
  it('off (the default): no 「数据区域」 entry and no region section, for any account', () => {
    for (const modelDataRegion of [null, 'cn', 'intl']) {
      shell.me = { modelDataRegion, modelDataRegionSelection: false };
      renderSettings();
      expect(screen.queryByRole('link', { name: '数据区域' })).toBeNull();
      expect(screen.queryByText('任务处理区域')).toBeNull();
      cleanup();
    }
  });

  it('on: the entry and the section are back as before', () => {
    shell.me = { modelDataRegion: null, modelDataRegionSelection: true };
    renderSettings();
    expect(screen.getByRole('link', { name: '数据区域' })).toBeTruthy();
    expect(screen.getAllByText('任务处理区域').length).toBeGreaterThan(0);
  });
});
