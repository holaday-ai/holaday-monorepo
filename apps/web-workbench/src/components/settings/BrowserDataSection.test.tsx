// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { tabs } = vi.hoisted(() => ({
  tabs: vi.fn(async () => ({
    tabs: [
      {
        tabId: 1,
        selectionId: '11111111-1111-4111-8111-111111111111',
        expectedUrl: 'https://fixture.test',
        title: 'Fixture',
        extensionClientId: 'ext',
      },
    ],
  })),
}));
vi.mock('@/lib/trpc', () => ({ trpc: { tasks: { localChromeTabs: { query: tabs } } } }));
vi.mock('@/lib/auth', () => ({ getAccessToken: () => 'TEST_AUTH' }));
import { BrowserDataSection } from './BrowserDataSection';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('browser login and data settings', () => {
  it('shows default-off state without presenting a working import button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              enabled: false,
              importEnabled: false,
              profileEnabled: false,
              grants: [],
            }),
          ),
      ),
    );
    render(<BrowserDataSection />);
    expect(await screen.findByText(/尚未启用/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '授权并导入' })).toBeNull();
  });
  it('requires explicit disclosure consent before selected-site import', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
        if (String(url).endsWith('/grants'))
          return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }));
        return new Response(
          JSON.stringify({ enabled: true, importEnabled: true, profileEnabled: true, grants: [] }),
        );
      }),
    );
    render(<BrowserDataSection />);
    fireEvent.click(await screen.findByRole('button', { name: '选择 Chrome 站点' }));
    fireEvent.change(await screen.findByLabelText('已选站点'), { target: { value: '0' } });
    const button = screen.getByRole('button', { name: '授权并导入' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText(/我同意将这个站点/));
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/dispatch'))).toBe(true));
    const grant = calls.find((c) => c.url.endsWith('/grants'))?.body as {
      consent: string;
      request: { origin: string };
    };
    expect(grant.consent).toBe('session-import-v1');
    expect(grant.request.origin).toBe('https://fixture.test');
    expect(JSON.stringify(calls)).not.toContain('SYNTHETIC_ONLY');
  });
});
