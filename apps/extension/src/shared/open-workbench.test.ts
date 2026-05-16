import { describe, expect, it } from 'vitest';
import { pickBestTab, WORKBENCH_TAB_MATCH_PATTERNS } from './open-workbench.js';

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

describe('WORKBENCH_TAB_MATCH_PATTERNS', () => {
  it('targets the two prod surfaces only (China + intl apex)', () => {
    expect(WORKBENCH_TAB_MATCH_PATTERNS).toEqual([
      '*://hd-app.orangebench.tech/*',
      '*://holaday.ai/*',
    ]);
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
