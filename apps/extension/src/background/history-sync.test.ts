import { describe, expect, it } from 'vitest';
import { aggregateBrowsingHistoryItems, extractHost } from './history-sync.js';

describe('extractHost', () => {
  it('keeps only useful http hosts', () => {
    expect(extractHost('https://www.example.com/path?q=1')).toBe('example.com');
    expect(extractHost('http://sub.example.com/')).toBe('sub.example.com');
    expect(extractHost('chrome://extensions')).toBeNull();
    expect(extractHost('http://localhost:5173/')).toBeNull();
    expect(extractHost('not a url')).toBeNull();
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
