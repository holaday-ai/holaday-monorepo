import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateBrowsingHistoryItems,
  collectBrowsingHistory,
  extractHost,
  syncHistoryToServer,
} from './history-sync.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('extractHost', () => {
  it('keeps only useful http hosts', () => {
    expect(extractHost('https://www.example.com/path?q=1')).toBe('example.com');
    expect(extractHost('http://sub.example.com/')).toBe('sub.example.com');
    expect(extractHost('chrome://extensions')).toBeNull();
    expect(extractHost('http://localhost:5173/')).toBeNull();
    expect(extractHost('not a url')).toBeNull();
  });

  it('times out a stuck history sync post', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({ 'holaday.access_token': 'token' })),
        },
      },
    } as unknown as typeof chrome;

    const assertion = expect(
      syncHistoryToServer([
        {
          domain: 'example.com',
          visitCount: 1,
          lastVisitAt: '2026-05-02T00:00:00.000Z',
        },
      ]),
    ).rejects.toThrow('history_sync_post_timeout');
    await vi.advanceTimersByTimeAsync(8_000);

    await assertion;
  });
});

describe('aggregateBrowsingHistoryItems', () => {
  it('aggregates valid visits and drops malformed history rows', () => {
    const entries = aggregateBrowsingHistoryItems([
      {
        url: 'https://www.example.com/a',
        visitCount: 2,
        lastVisitTime: Date.parse('2026-05-01T00:00:00Z'),
      },
      {
        url: 'https://example.com/b',
        visitCount: 3,
        lastVisitTime: Date.parse('2026-05-02T00:00:00Z'),
      },
      {
        url: 'https://bad.example/c',
        visitCount: 0,
        lastVisitTime: Date.parse('2026-05-03T00:00:00Z'),
      },
      {
        url: 'https://old.example/c',
        visitCount: 1,
        lastVisitTime: 0,
      },
      {
        url: 'chrome://settings',
        visitCount: 10,
        lastVisitTime: Date.now(),
      },
    ]);

    expect(entries).toEqual([
      {
        domain: 'example.com',
        visitCount: 5,
        lastVisitAt: '2026-05-02T00:00:00.000Z',
      },
    ]);
  });
});

describe('collectBrowsingHistory', () => {
  it('returns an empty list when chrome history search hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      history: {
        search: vi.fn(() => new Promise(() => undefined)),
      },
    } as unknown as typeof chrome;

    const assertion = expect(collectBrowsingHistory()).resolves.toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);

    await assertion;
  });
});
