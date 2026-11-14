// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_HOME_SHORTCUTS_KEY,
  browserHomeErrorMessage,
  browserHomeNavFailureMessage,
  browserHomeSearchTarget,
  defaultBrowserHomeSearchEngine,
  normalizeShortcutUrl,
  parseBrowserHomeSites,
  readBrowserHomeShortcuts,
  visibleBrowserHomeSites,
  writeBrowserHomeShortcuts,
} from './browser-home';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BROWSER-HOME-1 search', () => {
  it('defaults to Google on the overseas entry and 百度 otherwise (server default cn)', () => {
    expect(defaultBrowserHomeSearchEngine('intl')).toBe('google');
    expect(defaultBrowserHomeSearchEngine('cn')).toBe('baidu');
    expect(defaultBrowserHomeSearchEngine(null)).toBe('baidu');
  });

  it('opens an address as typed and turns words into the picked engine’s search page', () => {
    expect(browserHomeSearchTarget('  ', 'google')).toBeNull();
    expect(browserHomeSearchTarget('example.com/a?b=1', 'baidu')).toBe('example.com/a?b=1');
    expect(browserHomeSearchTarget('https://holaday.ai', 'google')).toBe('https://holaday.ai');
    expect(browserHomeSearchTarget('机票 上海', 'baidu')).toBe(
      'https://www.baidu.com/s?wd=%E6%9C%BA%E7%A5%A8%20%E4%B8%8A%E6%B5%B7',
    );
    expect(browserHomeSearchTarget('weather', 'google')).toBe(
      'https://www.google.com/search?q=weather',
    );
    // A scheme the policy refuses still goes to the server as an address (never a silent search).
    expect(browserHomeSearchTarget('file:///etc/passwd', 'google')).toBe('file:///etc/passwd');
  });
});

describe('BROWSER-HOME-1 recommended sites config', () => {
  const sites = parseBrowserHomeSites({
    sites: [
      {
        name: 'B',
        url: 'https://b.example',
        logo: '/browser-home/logos/b.png',
        regions: ['cn'],
        order: 2,
      },
      {
        name: 'A',
        url: 'https://a.example',
        logo: 'https://a.example/logo.png',
        regions: ['cn', 'intl'],
        order: 1,
      },
      { name: '待添加', url: '', regions: ['cn', 'intl'], order: 9, placeholder: true },
      { name: 'bad url', url: 'javascript:alert(1)', regions: ['cn'], order: 3 },
      { name: 'no region', url: 'https://c.example', regions: [], order: 4 },
    ],
  });

  it('keeps valid entries and never hot-links a logo from another site', () => {
    expect(sites.map((site) => site.name)).toEqual(['B', 'A', '待添加']);
    expect(sites.find((site) => site.name === 'A')?.logo).toBeNull();
    expect(sites.find((site) => site.name === 'B')?.logo).toBe('/browser-home/logos/b.png');
  });

  it('filters by entry region and sorts by order', () => {
    expect(visibleBrowserHomeSites(sites, 'cn', { production: false }).map((s) => s.name)).toEqual([
      'A',
      'B',
      '待添加',
    ]);
    expect(
      visibleBrowserHomeSites(sites, 'intl', { production: false }).map((s) => s.name),
    ).toEqual(['A', '待添加']);
  });

  it('hides placeholder tiles in a production build', () => {
    expect(visibleBrowserHomeSites(sites, 'cn', { production: true }).map((s) => s.name)).toEqual([
      'A',
      'B',
    ]);
  });

  it('ships 8 placeholder tiles until the list arrives (shown in development only)', () => {
    const shipped = parseBrowserHomeSites(
      JSON.parse(readFileSync(resolve(process.cwd(), 'public/browser-home/sites.json'), 'utf8')),
    );
    expect(shipped).toHaveLength(8);
    expect(shipped.every((site) => site.placeholder)).toBe(true);
    expect(visibleBrowserHomeSites(shipped, 'cn', { production: false })).toHaveLength(8);
    expect(visibleBrowserHomeSites(shipped, 'intl', { production: true })).toHaveLength(0);
  });
});

describe('BROWSER-HOME-1 my shortcuts', () => {
  it('accepts http(s) addresses only', () => {
    expect(normalizeShortcutUrl('example.com')).toBe('https://example.com/');
    expect(normalizeShortcutUrl('http://a.example/x')).toBe('http://a.example/x');
    expect(normalizeShortcutUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeShortcutUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeShortcutUrl('two words')).toBeNull();
  });

  it('persists in localStorage and survives storage being unavailable', () => {
    writeBrowserHomeShortcuts([{ name: '例子', url: 'https://example.com/' }]);
    expect(readBrowserHomeShortcuts()).toEqual([{ name: '例子', url: 'https://example.com/' }]);
    window.localStorage.setItem(BROWSER_HOME_SHORTCUTS_KEY, '{not json');
    expect(readBrowserHomeShortcuts()).toEqual([]);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { ...memoryStorage(), getItem: blocked, setItem: blocked });
    expect(readBrowserHomeShortcuts()).toEqual([]);
    expect(() => writeBrowserHomeShortcuts([])).not.toThrow();
  });
});

describe('BROWSER-HOME-1 address bar refusals', () => {
  it('shows the server’s Chinese message first', () => {
    expect(
      browserHomeNavFailureMessage(
        { reason: 'blocked_target', message: '不能打开内网地址。' },
        'goto',
      ),
    ).toBe('不能打开内网地址。');
    expect(browserHomeNavFailureMessage({ reason: 'no_session' }, 'goto')).toBe(
      '云浏览器还在打开，请稍候再试',
    );
    expect(browserHomeErrorMessage(new Error('云浏览器暂未开放'), 'goto')).toBe('云浏览器暂未开放');
    expect(browserHomeErrorMessage(new Error('fetch failed'), 'reload')).toBe(
      '刷新失败，请稍后重试',
    );
  });
});
