import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AccessibilityNode,
  type PageLike,
  PlaywrightExecutor,
} from './playwright-executor.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

/**
 * Unit tests for PlaywrightExecutor. No real browser — we inject a
 * `chromium.connectOverCDP` stub at construction, and pass a `PageLike`
 * fake to the action methods (they only touch the narrow duck-typed
 * surface we declared).
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

function makeFakePage(overrides: Partial<PageLike> = {}): {
  page: PageLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
  };
  const base: PageLike = {
    url: () => 'https://example.com/page',
    title: async () => 'Example Title',
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async (opts) => {
      record('screenshot', opts);
      return Buffer.from('fake-jpeg-bytes');
    },
    mouse: {
      click: async (x, y, opts) => {
        record('mouse.click', x, y, opts);
      },
      move: async (x, y) => {
        record('mouse.move', x, y);
      },
      wheel: async (dx, dy) => {
        record('mouse.wheel', dx, dy);
      },
    },
    keyboard: {
      type: async (text) => {
        record('keyboard.type', text);
      },
      press: async (key) => {
        record('keyboard.press', key);
      },
    },
    accessibility: {
      snapshot: async () => null,
    },
    waitForTimeout: async (ms) => {
      record('waitForTimeout', ms);
    },
    goto: async (url, opts) => {
      record('goto', url, opts);
      return null;
    },
  };
  return { page: { ...base, ...overrides }, calls };
}

describe('PlaywrightExecutor.connect', () => {
  it('returns ok when chromium.connectOverCDP succeeds', async () => {
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () => ({ contexts: () => [], close: async () => {} }) as never,
      },
    });
    const r = await exec.connect('http://127.0.0.1:9222');
    expect(r.ok).toBe(true);
  });

  it('returns { ok:false, error } on connection failure — never throws', async () => {
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () => {
          throw new Error('ECONNREFUSED 127.0.0.1:9222');
        },
      },
    });
    const r = await exec.connect('http://127.0.0.1:9222');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/connectOverCDP.*failed.*ECONNREFUSED/);
  });

  it('is idempotent — second connect is a no-op', async () => {
    let calls = 0;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () => {
          calls += 1;
          return { contexts: () => [], close: async () => {} } as never;
        },
      },
    });
    await exec.connect('http://a');
    await exec.connect('http://a');
    expect(calls).toBe(1);
  });
});

describe('PlaywrightExecutor.screenshot', () => {
  it('returns base64 + viewport dims', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage();
    const r = await exec.screenshot(page);
    expect(r.base64).toBe(Buffer.from('fake-jpeg-bytes').toString('base64'));
    expect(r.viewportWidth).toBe(1280);
    expect(r.viewportHeight).toBe(800);
    expect(r.error).toBeUndefined();
  });

  it('returns error string on failure — never throws', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      screenshot: async () => {
        throw new Error('target closed');
      },
    });
    const r = await exec.screenshot(page);
    expect(r.base64).toBeUndefined();
    expect(r.error).toMatch(/screenshot failed.*target closed/);
  });
});

describe('PlaywrightExecutor.accessibilitySnapshot', () => {
  function makeTree(): AccessibilityNode {
    return {
      role: 'WebArea',
      name: 'Example',
      children: [
        {
          role: 'navigation',
          name: 'Main nav',
          children: [
            { role: 'link', name: 'Home' },
            { role: 'link', name: 'About' },
          ],
        },
        {
          role: 'main',
          children: [
            { role: 'heading', name: '欢迎来到 HOLA DAY' },
            { role: 'textbox', name: 'Email' },
            { role: 'button', name: '提交' },
          ],
        },
      ],
    };
  }

  it('serialises tree with indentation; interactive nodes get refs', async () => {
    const exec = new PlaywrightExecutor();
    const tree = makeTree();
    const { page } = makeFakePage({
      accessibility: { snapshot: async () => tree },
    });
    const r = await exec.accessibilitySnapshot(page);
    expect(r.error).toBeUndefined();
    expect(r.url).toBe('https://example.com/page');
    expect(r.title).toBe('Example Title');
    // 4 interactive nodes (2 links + textbox + button) → 4 refs, in DFS order.
    expect(r.refs.map((x) => x.ref)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(r.refs.map((x) => x.role)).toEqual(['link', 'link', 'textbox', 'button']);
    expect(r.refs.map((x) => x.name)).toEqual(['Home', 'About', 'Email', '提交']);
    // Text output uses indentation: e.g. navigation's children are 2x indented
    expect(r.text).toContain('WebArea');
    expect(r.text).toContain('    e1 link "Home"');
    expect(r.text).toContain('    e4 button "提交"');
  });

  it('handles a null snapshot (e.g. chrome:// pages with no a11y tree)', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      accessibility: { snapshot: async () => null },
    });
    const r = await exec.accessibilitySnapshot(page);
    expect(r.text).toBe('');
    expect(r.refs).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('wraps snapshot errors without throwing', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      accessibility: {
        snapshot: async () => {
          throw new Error('page detached');
        },
      },
    });
    const r = await exec.accessibilitySnapshot(page);
    expect(r.error).toMatch(/accessibility\.snapshot failed.*page detached/);
    expect(r.text).toBe('');
  });
});

describe('PlaywrightExecutor — input actions', () => {
  it('click passes coordinates + button to page.mouse.click', async () => {
    const exec = new PlaywrightExecutor();
    const { page, calls } = makeFakePage();
    const r = await exec.click(page, 123, 456, 'right');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/clicked right @ \(123,456\)/);
    expect(calls[0]).toEqual({
      method: 'mouse.click',
      args: [123, 456, { button: 'right' }],
    });
  });

  it('click default button is left', async () => {
    const exec = new PlaywrightExecutor();
    const { page, calls } = makeFakePage();
    await exec.click(page, 1, 2);
    expect((calls[0]?.args as unknown[])[2]).toEqual({ button: 'left' });
  });

  it('type forwards to keyboard.type', async () => {
    const exec = new PlaywrightExecutor();
    const { page, calls } = makeFakePage();
    const r = await exec.type(page, 'HOLA DAY');
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual({ method: 'keyboard.type', args: ['HOLA DAY'] });
  });

  it('pressKey normalises lowercase chords to Playwright capitalisation', async () => {
    const exec = new PlaywrightExecutor();
    const cases: Array<[string, string]> = [
      ['Enter', 'Enter'],
      ['ctrl+a', 'Control+a'],
      ['cmd+c', 'Meta+c'],
      ['alt+F4', 'Alt+F4'],
      ['shift+Tab', 'Shift+Tab'],
      ['ctrl+shift+k', 'Control+Shift+k'],
    ];
    for (const [input, expected] of cases) {
      const { page, calls } = makeFakePage();
      await exec.pressKey(page, input);
      expect(calls[0]).toEqual({ method: 'keyboard.press', args: [expected] });
    }
  });

  it('scroll calls page.mouse.wheel (0, deltaY), optionally moving first', async () => {
    const exec = new PlaywrightExecutor();
    // No coords → no move
    {
      const { page, calls } = makeFakePage();
      await exec.scroll(page, 500);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ method: 'mouse.wheel', args: [0, 500] });
    }
    // With coords → move first, then wheel
    {
      const { page, calls } = makeFakePage();
      await exec.scroll(page, -200, 100, 200);
      expect(calls[0]).toEqual({ method: 'mouse.move', args: [100, 200] });
      expect(calls[1]).toEqual({ method: 'mouse.wheel', args: [0, -200] });
    }
  });

  it('wait clamps ms to [0, 10000]', async () => {
    const exec = new PlaywrightExecutor();
    {
      const { page, calls } = makeFakePage();
      await exec.wait(page, 500);
      expect(calls[0]).toEqual({ method: 'waitForTimeout', args: [500] });
    }
    {
      const { page, calls } = makeFakePage();
      await exec.wait(page, 99_999);
      expect(calls[0]).toEqual({ method: 'waitForTimeout', args: [10_000] });
    }
    {
      const { page, calls } = makeFakePage();
      await exec.wait(page, -50);
      expect(calls[0]).toEqual({ method: 'waitForTimeout', args: [0] });
    }
  });

  it('navigate calls goto with domcontentloaded', async () => {
    const exec = new PlaywrightExecutor();
    const { page, calls } = makeFakePage();
    const r = await exec.navigate(page, 'https://holaday.test/');
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe('goto');
    expect(calls[0]?.args[0]).toBe('https://holaday.test/');
    const opts = calls[0]?.args[1] as { waitUntil?: string };
    expect(opts?.waitUntil).toBe('domcontentloaded');
  });

  it('every action wraps errors rather than throwing', async () => {
    const exec = new PlaywrightExecutor();
    const { page: clickPage } = makeFakePage({
      mouse: {
        click: async () => {
          throw new Error('target detached');
        },
        move: async () => {},
        wheel: async () => {},
      },
    });
    const click = await exec.click(clickPage, 1, 2);
    expect(click.ok).toBe(false);
    expect(click.message).toMatch(/click failed.*target detached/);

    const { page: typePage } = makeFakePage({
      keyboard: {
        type: async () => {
          throw new Error('not focused');
        },
        press: async () => {},
      },
    });
    const type = await exec.type(typePage, 'x');
    expect(type.ok).toBe(false);
    expect(type.message).toMatch(/type failed.*not focused/);
  });
});

describe('PlaywrightExecutor.getPage', () => {
  it('throws when not connected', async () => {
    const exec = new PlaywrightExecutor();
    await expect(exec.getPage()).rejects.toThrow(/not connected/);
  });

  it('returns first page of first context', async () => {
    const fakePage = { tag: 'fake-page' } as unknown;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [{ pages: () => [fakePage] }],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const p = await exec.getPage();
    expect(p).toBe(fakePage);
  });

  it('throws when there are no pages', async () => {
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [{ pages: () => [] }],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    await expect(exec.getPage()).rejects.toThrow(/no pages/);
  });
});
