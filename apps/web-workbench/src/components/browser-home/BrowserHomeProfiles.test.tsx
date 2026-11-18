import {
  type HomeProfileApi,
  HomeProfileJournal,
  type HomeProfileOptions,
} from '@/lib/home-profile-journal';
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserHomeProfiles } from './BrowserHomeProfiles';
const state = vi.hoisted(() => ({ context: null as unknown }));
vi.mock('@/lib/home-profile-context', () => ({
  createHomeProfileContext: async () => state.context,
}));
afterEach(() => cleanup());
function fixture(lost = false) {
  const data = new Map<string, string>();
  let saved = false;
  let selected: string | null = null;
  let captures = 0;
  const profileId = 'ee52fe57-1dd1-4562-828d-afcb84b0c96f';
  const options = (): HomeProfileOptions => ({
    enabled: true,
    profiles: saved
      ? [
          {
            id: profileId,
            origin: 'https://fixture.test',
            status: 'connected',
            expiresAt: 1_800_000_000_000,
            issuedAt: 1_700_000_000_000,
          },
        ]
      : [],
    selectedProfileId: selected,
    clearEpoch: 0,
    serverNow: Date.now(),
    source: {
      sourceId: 'ae52fe57-1dd1-4562-828d-afcb84b0c96f',
      origin: 'https://fixture.test',
      expiresAt: Date.now() + 120000,
    },
  });
  const api: HomeProfileApi = {
    options: async () => options(),
    receipt: async (req) =>
      saved
        ? { state: 'saved', id: req.requestId, origin: req.origin, expiresAt: 1_800_000_000_000 }
        : { state: 'missing' },
    save: async (req) => {
      captures++;
      saved = true;
      selected = profileId;
      if (lost) throw new Error('保存响应丢失');
      return {
        id: req.requestId,
        origin: req.origin,
        status: 'connected',
        expiresAt: 1_800_000_000_000,
      };
    },
    cancel: async () => ({ state: 'cancelled' }),
    select: async (id) => {
      selected = id;
    },
    forget: async () => {
      saved = false;
    },
  };
  state.context = {
    api,
    current: () => {},
    journal: new HomeProfileJournal({
      api,
      current: () => {},
      key: 'owner',
      uuid: () => profileId,
      storage: {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
        removeItem: (k) => {
          data.delete(k);
        },
      },
      lock: async (run) => run(),
    }),
  };
  return {
    captures: () => captures,
    data,
    selected: () => selected,
    forgetSaved: () => {
      saved = false;
    },
  };
}
describe('the actual Home saved-site dialog', () => {
  it('clears the previous actor metadata immediately while the new actor loads', async () => {
    const old = fixture(true);
    const view = render(<BrowserHomeProfiles ownerId="usr_a" />);
    fireEvent.click(screen.getByRole('button', { name: '已保存的网站' }));
    fireEvent.click(await screen.findByLabelText(/我同意保存/));
    fireEvent.click(screen.getByRole('button', { name: '保存当前站点' }));
    await screen.findByRole('button', { name: '核对保存结果' });
    old.forgetSaved();
    fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
    await waitFor(() =>
      expect(screen.getAllByText('https://fixture.test', { exact: true })).toHaveLength(2),
    );
    fixture();
    (state.context as { api: HomeProfileApi }).api.options = () => new Promise(() => {});
    view.rerender(<BrowserHomeProfiles ownerId="usr_b" />);
    fireEvent.click(screen.getByRole('button', { name: '已保存的网站' }));
    expect(screen.queryByText('https://fixture.test', { exact: true })).toBeNull();
  });
  it('requires site consent, saves actual highlevel intent, and labels the next-open selection', async () => {
    const f = fixture();
    render(<BrowserHomeProfiles ownerId="usr_fixture" />);
    fireEvent.click(screen.getByRole('button', { name: '已保存的网站' }));
    expect(await screen.findByRole('heading', { name: '已保存的网站' })).toBeTruthy();
    const save = await screen.findByRole('button', { name: '保存当前站点' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText(/我同意保存/));
    fireEvent.click(save);
    expect(await screen.findByText(/已保存 https:\/\/fixture.test/)).toBeTruthy();
    expect(await screen.findByText('下次打开时使用')).toBeTruthy();
    expect(f.captures()).toBe(1);
    expect(f.data.size).toBe(0);
    expect(screen.queryByText('已登录')).toBeNull();
  });
  it('unknown save is reconciled explicitly after reopening, never creating another capture', async () => {
    const f = fixture(true);
    const view = render(<BrowserHomeProfiles ownerId="usr_fixture" />);
    fireEvent.click(screen.getByRole('button', { name: '已保存的网站' }));
    fireEvent.click(await screen.findByLabelText(/我同意保存/));
    fireEvent.click(screen.getByRole('button', { name: '保存当前站点' }));
    expect(await screen.findByRole('button', { name: '核对保存结果' })).toBeTruthy();
    expect(f.data.size).toBe(1);
    view.unmount();
    render(<BrowserHomeProfiles ownerId="usr_fixture" />);
    fireEvent.click(screen.getByRole('button', { name: '已保存的网站' }));
    expect(await screen.findByText(/已保存 https:\/\/fixture.test/)).toBeTruthy();
    expect(f.captures()).toBe(1);
    expect(f.data.size).toBe(0);
  });
});
