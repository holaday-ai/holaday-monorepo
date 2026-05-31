import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isWorkbenchTabUrl,
  openOrFocusWorkbench,
  pickBestTab,
  WORKBENCH_TAB_MATCH_PATTERNS,
} from './open-workbench.js';

/**
 * Helper to fabricate a chrome.tabs.Tab — the real type has ~30 fields,
 * we only care about id / windowId / active / lastAccessed for the
 * tiebreak. The cast loosens the rest.
 */
function makeTab(over: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 10,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('WORKBENCH_TAB_MATCH_PATTERNS', () => {
  it('targets the two prod surfaces only (China + intl apex)', () => {
    expect(WORKBENCH_TAB_MATCH_PATTERNS).toEqual([
      '*://hd-app.orangebench.tech/*',
      '*://holaday.ai/*',
      '*://app.holaday.ai/*',
    ]);
  });
});

describe('isWorkbenchTabUrl', () => {
  it('matches only the production workbench tab urls', () => {
    expect(isWorkbenchTabUrl('https://holaday.ai/app')).toBe(true);
    expect(isWorkbenchTabUrl('https://app.holaday.ai/app')).toBe(true);
    expect(isWorkbenchTabUrl('https://hd-app.orangebench.tech/app')).toBe(true);
    expect(isWorkbenchTabUrl('https://staging.holaday.ai/app')).toBe(false);
    expect(isWorkbenchTabUrl('chrome://extensions')).toBe(false);
    expect(isWorkbenchTabUrl(undefined)).toBe(false);
  });
});

describe('pickBestTab', () => {
  it('returns null on empty input', () => {
    expect(pickBestTab([])).toBeNull();
  });

  it('returns the sole tab when only one matches', () => {
    const only = makeTab({ id: 42 });
    expect(pickBestTab([only])).toBe(only);
  });

  it('prefers an active tab over inactive ones', () => {
    const a = makeTab({ id: 1, active: false, lastAccessed: 1000 });
    const b = makeTab({ id: 2, active: true, lastAccessed: 500 });
    const c = makeTab({ id: 3, active: false, lastAccessed: 2000 });
    expect(pickBestTab([a, b, c])?.id).toBe(2);
  });

  it('among multiple active tabs, picks the most-recently-accessed', () => {
    // Two browser windows, each with the workbench as their active tab.
    const win1Active = makeTab({ id: 1, windowId: 10, active: true, lastAccessed: 1000 });
    const win2Active = makeTab({ id: 2, windowId: 20, active: true, lastAccessed: 5000 });
    expect(pickBestTab([win1Active, win2Active])?.id).toBe(2);
  });

  it('falls back to lastAccessed when no tab is active', () => {
    const older = makeTab({ id: 1, active: false, lastAccessed: 1000 });
    const newer = makeTab({ id: 2, active: false, lastAccessed: 5000 });
    expect(pickBestTab([older, newer])?.id).toBe(2);
  });

  it('falls back to first tab when no active + no lastAccessed', () => {
    const a = makeTab({ id: 1, active: false });
    const b = makeTab({ id: 2, active: false });
    expect(pickBestTab([a, b])?.id).toBe(1);
  });
});

describe('openOrFocusWorkbench', () => {
  it('falls back to all-tab filtering when match-pattern query fails', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('bad pattern'))
      .mockResolvedValueOnce([
        makeTab({ id: 7, url: 'https://app.holaday.ai/app', active: false }),
        makeTab({ id: 8, url: 'https://staging.holaday.ai/app', active: false }),
      ]);
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({}));
    globalThis.chrome = {
      tabs: { query, update, create },
      windows: { update: vi.fn(async () => ({})) },
    } as unknown as typeof chrome;

    await openOrFocusWorkbench('https://hd-app.orangebench.tech/app');

    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(create).not.toHaveBeenCalled();
  });
});
