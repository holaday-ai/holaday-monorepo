import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PageLike, PlaywrightExecutor, annotateAriaSnapshot } from './playwright-executor.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  // Turn off humanize for the raw-behaviour tests below: they assert
  // direct mouse.click / keyboard.type calls with specific arg
  // shapes, which humanize intentionally replaces with bezier paths
  // + per-char typing. Humanize behaviour has its own dedicated
  // tests in humanize.test.ts.
  process.env.HUMANIZE_ENABLED = 'false';
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
    ariaSnapshot: async () => '',
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

describe('annotateAriaSnapshot', () => {
  it('injects [ref=eN] on interactive lines; leaves static lines untouched', () => {
    const yaml = [
      '- generic:',
      '  - heading "Hello" [level=1]',
      '  - link "Home":',
      '    - /url: "https://example.com/"',
      '  - button "Submit"',
      '  - textbox "Email"',
    ].join('\n');
    const r = annotateAriaSnapshot(yaml);
    // 3 interactive roles in DFS order: link, button, textbox
    expect(r.refs.map((x) => x.ref)).toEqual(['e1', 'e2', 'e3']);
    expect(r.refs.map((x) => x.role)).toEqual(['link', 'button', 'textbox']);
    expect(r.refs.map((x) => x.name)).toEqual(['Home', 'Submit', 'Email']);
    // Augmented text keeps the original structure and sprinkles refs only on interactive lines.
    expect(r.text).toContain('- heading "Hello" [level=1]');
    expect(r.text).not.toMatch(/heading.*\[ref=/);
    expect(r.text).toContain('- link "Home" [ref=e1]:');
    expect(r.text).toContain('- button "Submit" [ref=e2]');
    expect(r.text).toContain('- textbox "Email" [ref=e3]');
    // Sub-properties (/url) must pass through verbatim.
    expect(r.text).toContain('    - /url: "https://example.com/"');
  });

  it('handles CJK names without mangling quoting', () => {
    const yaml = '- button "提交"\n- textbox "搜索"';
    const r = annotateAriaSnapshot(yaml);
    expect(r.refs).toEqual([
      { ref: 'e1', role: 'button', name: '提交' },
      { ref: 'e2', role: 'textbox', name: '搜索' },
    ]);
  });

  it('handles interactive role without a name (rare but legal)', () => {
    const yaml = '- button';
    const r = annotateAriaSnapshot(yaml);
    expect(r.refs).toEqual([{ ref: 'e1', role: 'button', name: '' }]);
    expect(r.text).toBe('- button [ref=e1]');
  });

  it('returns empty refs for empty input', () => {
    expect(annotateAriaSnapshot('')).toEqual({ text: '', refs: [] });
  });
});

describe('PlaywrightExecutor.accessibilitySnapshot', () => {
  const sampleYaml = [
    '- generic:',
    '  - navigation "Main nav":',
    '    - link "Home":',
    '      - /url: "/"',
    '    - link "About":',
    '      - /url: "/about"',
    '  - main:',
    '    - heading "欢迎来到 HOLA DAY" [level=1]',
    '    - textbox "Email"',
    '    - button "提交"',
  ].join('\n');

  it('calls page.ariaSnapshot + annotates refs; returns url+title', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      ariaSnapshot: async () => sampleYaml,
    });
    const r = await exec.accessibilitySnapshot(page);
    expect(r.error).toBeUndefined();
    expect(r.url).toBe('https://example.com/page');
    expect(r.title).toBe('Example Title');
    // 4 interactive nodes in DFS order: 2 links + textbox + button.
    expect(r.refs.map((x) => x.ref)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(r.refs.map((x) => x.role)).toEqual(['link', 'link', 'textbox', 'button']);
    expect(r.refs.map((x) => x.name)).toEqual(['Home', 'About', 'Email', '提交']);
    expect(r.text).toContain('- link "Home" [ref=e1]:');
    expect(r.text).toContain('- button "提交" [ref=e4]');
    // Static nodes (heading, generic, navigation) must NOT get refs.
    expect(r.text).not.toMatch(/heading.*\[ref=/);
    expect(r.text).not.toMatch(/navigation.*\[ref=/);
  });

  it('handles an empty snapshot (e.g. chrome:// pages)', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({ ariaSnapshot: async () => '' });
    const r = await exec.accessibilitySnapshot(page);
    expect(r.text).toBe('');
    expect(r.refs).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('wraps ariaSnapshot errors without throwing', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      ariaSnapshot: async () => {
        throw new Error('page detached');
      },
    });
    const r = await exec.accessibilitySnapshot(page);
    expect(r.error).toMatch(/ariaSnapshot failed.*page detached/);
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

  it('pressKey aliases legacy / OS-specific terminal keys to Playwright names', async () => {
    // Reason: Claude occasionally emits "Return" (macOS JS KeyboardEvent),
    // "Esc", "Del" — Playwright rejects those. Alias to canonical form
    // both as bare keys and as chord terminals.
    const exec = new PlaywrightExecutor();
    const cases: Array<[string, string]> = [
      ['Return', 'Enter'],
      ['return', 'Enter'],
      ['RETURN', 'Enter'],
      ['Esc', 'Escape'],
      ['Del', 'Delete'],
      ['Space', ' '],
      ['ctrl+Return', 'Control+Enter'],
      ['shift+Esc', 'Shift+Escape'],
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

  it('auto-creates a page via ctx.newPage() when the context is empty', async () => {
    const created = { tag: 'fresh' } as unknown;
    let newPageCalls = 0;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [
              {
                pages: () => [],
                newPage: async () => {
                  newPageCalls += 1;
                  return created;
                },
              },
            ],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const p = await exec.getPage();
    expect(p).toBe(created);
    expect(newPageCalls).toBe(1);
  });
});

describe('PlaywrightExecutor.isPageResponsive', () => {
  it('returns true when evaluate resolves inside the timeout', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      evaluate: async () => 1,
    });
    expect(await exec.isPageResponsive(page, 200)).toBe(true);
  });

  it('returns false when evaluate hangs past the timeout', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      // Never resolves — simulates a stuck renderer / anti-bot modal.
      evaluate: () => new Promise(() => {}),
    });
    expect(await exec.isPageResponsive(page, 100)).toBe(false);
  });

  it('returns false when evaluate rejects', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      evaluate: async () => {
        throw new Error('target crashed');
      },
    });
    expect(await exec.isPageResponsive(page, 200)).toBe(false);
  });

  it('defaults to true when the page stub has no evaluate (test tolerance)', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage();
    // makeFakePage doesn't set evaluate — PageLike.evaluate is optional.
    expect(await exec.isPageResponsive(page, 100)).toBe(true);
  });
});

describe('PlaywrightExecutor.getPage — anti-bot auto-recovery', () => {
  // Both tests stub `evaluate` to hang forever, so getPage waits out
  // its responsive-probe deadline before falling back. Setting
  // ACTION_TIMEOUT_MS=200 collapses the 3 s default to 200 ms so the
  // suite doesn't trip vitest's per-test cap on slower CI machines.
  let prevActionTimeout: string | undefined;
  beforeEach(() => {
    prevActionTimeout = process.env.ACTION_TIMEOUT_MS;
    process.env.ACTION_TIMEOUT_MS = '200';
  });
  afterEach(() => {
    if (prevActionTimeout === undefined) delete process.env.ACTION_TIMEOUT_MS;
    else process.env.ACTION_TIMEOUT_MS = prevActionTimeout;
  });

  it('soft-resets a stuck page by navigating to about:blank', async () => {
    const { page: stuckPage, calls } = makeFakePage({
      evaluate: () => new Promise(() => {}), // hangs → not responsive
    });
    let newPageCalls = 0;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [
              {
                pages: () => [stuckPage],
                newPage: async () => {
                  newPageCalls += 1;
                  return { tag: 'fresh' };
                },
              },
            ],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const p = await exec.getPage();
    // Soft reset (goto about:blank) succeeded → we keep the same page.
    expect(p).toBe(stuckPage);
    expect(newPageCalls).toBe(0);
    expect(calls.find((c) => c.method === 'goto')?.args[0]).toBe('about:blank');
  });

  it('hard-resets via ctx.newPage() when the soft reset also hangs', async () => {
    const { page: stuckPage } = makeFakePage({
      evaluate: () => new Promise(() => {}),
      // goto also hangs — Playwright will give up at the 5s timeout;
      // in the unit test we simulate the rejection path.
      goto: async () => {
        throw new Error('goto timeout: page not responding');
      },
    });
    let newPageCalls = 0;
    const fresh = { tag: 'hard-reset' } as unknown;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [
              {
                pages: () => [stuckPage],
                newPage: async () => {
                  newPageCalls += 1;
                  return fresh;
                },
              },
            ],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const p = await exec.getPage();
    expect(p).toBe(fresh);
    expect(newPageCalls).toBe(1);
  });
});

describe('PlaywrightExecutor — per-action deadlines', () => {
  it('click returns { ok:false } rather than hanging when mouse.click never resolves', async () => {
    const exec = new PlaywrightExecutor();
    const { page } = makeFakePage({
      mouse: {
        // Never resolves → would hang forever without our withTimeout guard.
        click: () => new Promise(() => {}),
        move: async () => {},
        wheel: async () => {},
      },
    });
    // Force a short override so the test completes quickly.
    const prev = process.env.ACTION_TIMEOUT_MS;
    process.env.ACTION_TIMEOUT_MS = '200';
    vi.resetModules();
    const mod = await import('./playwright-executor.js');
    const e = new mod.PlaywrightExecutor();
    const r = await e.click(page as never, 1, 2);
    if (prev === undefined) delete process.env.ACTION_TIMEOUT_MS;
    else process.env.ACTION_TIMEOUT_MS = prev;
    void exec;
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/click failed.*timed out/);
  });

  it('type returns { ok:false } when keyboard.type never resolves', async () => {
    const { page } = makeFakePage({
      keyboard: {
        type: () => new Promise(() => {}),
        press: async () => {},
      },
    });
    const prev = process.env.ACTION_TIMEOUT_MS;
    process.env.ACTION_TIMEOUT_MS = '150';
    vi.resetModules();
    const mod = await import('./playwright-executor.js');
    const e = new mod.PlaywrightExecutor();
    const r = await e.type(page as never, 'hello');
    if (prev === undefined) delete process.env.ACTION_TIMEOUT_MS;
    else process.env.ACTION_TIMEOUT_MS = prev;
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/type failed.*timed out/);
  });
});

describe('PlaywrightExecutor.screenshot — timeout', () => {
  it('passes a bounded timeout to page.screenshot', async () => {
    const exec = new PlaywrightExecutor();
    const { page, calls } = makeFakePage();
    await exec.screenshot(page);
    const shot = calls.find((c) => c.method === 'screenshot');
    expect(shot?.args[0]).toMatchObject({ timeout: expect.any(Number) });
    const passedTimeout = (shot?.args[0] as { timeout: number }).timeout;
    // Default is 10s, and must be strictly shorter than Playwright's
    // built-in 30s — that's the whole point of this knob.
    expect(passedTimeout).toBeLessThan(30_000);
  });

  it('accepts an explicit timeoutMs override', async () => {
    const exec = new PlaywrightExecutor();
    const { page, calls } = makeFakePage();
    await exec.screenshot(page, { timeoutMs: 2_500 });
    const shot = calls.find((c) => c.method === 'screenshot');
    expect((shot?.args[0] as { timeout: number }).timeout).toBe(2_500);
  });
});

describe('PlaywrightExecutor.navigate — goto-no-op fallback', () => {
  // Production bug: Playwright's page.goto can return "success" while
  // the page silently stays on its prior URL (esp. Chromium's startup
  // about:blank tab). Before the fix, we blindly believed the return
  // value and reported `ok:true`, so the commander saw a green
  // navigate and tried to interact with a blank viewport. The fix is
  // to detect "url stayed blank" and retry on a fresh ctx.newPage().
  it('detects url-stayed-blank, opens a fresh page, and retries the goto there', async () => {
    // Simulate the exact symptom: goto resolves OK, but page.url()
    // keeps returning about:blank. Fresh page behaves normally.
    let stuckGotoCalls = 0;
    const stuck: PageLike = {
      url: () => 'about:blank',
      title: async () => '',
      viewportSize: () => ({ width: 1280, height: 800 }),
      screenshot: async () => Buffer.from(''),
      mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
      keyboard: { type: async () => {}, press: async () => {} },
      ariaSnapshot: async () => '',
      waitForTimeout: async () => {},
      goto: async () => {
        stuckGotoCalls += 1;
        return null; // "200 OK" — but page.url() stays about:blank
      },
      close: async () => {},
    };
    let freshGotoCalls = 0;
    let freshUrl = 'about:blank';
    const fresh: PageLike = {
      ...stuck,
      url: () => freshUrl,
      goto: async (u: string) => {
        freshGotoCalls += 1;
        freshUrl = u; // newPage actually navigates
        return { status: () => 200 } as unknown as null;
      },
    };
    let newPageCalls = 0;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [
              {
                pages: () => [stuck],
                newPage: async () => {
                  newPageCalls += 1;
                  return fresh;
                },
              },
            ],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const r = await exec.navigate(stuck, 'https://example.com/');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/via fresh page fallback/);
    expect(stuckGotoCalls).toBe(1);
    expect(newPageCalls).toBe(1);
    expect(freshGotoCalls).toBe(1);
    expect(freshUrl).toBe('https://example.com/');
  });

  it('returns ok:false when even the fresh page stays blank', async () => {
    // Models the worst case: the whole browser is wedged and neither
    // the current page nor a fresh one can reach the target. We must
    // report failure rather than claim success.
    const stuck: PageLike = {
      url: () => 'about:blank',
      title: async () => '',
      viewportSize: () => null,
      screenshot: async () => Buffer.from(''),
      mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
      keyboard: { type: async () => {}, press: async () => {} },
      ariaSnapshot: async () => '',
      waitForTimeout: async () => {},
      goto: async () => null,
      close: async () => {},
    };
    const fresh: PageLike = { ...stuck };
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [
              {
                pages: () => [stuck],
                newPage: async () => fresh,
              },
            ],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const r = await exec.navigate(stuck, 'https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/still stuck/);
  });

  it('happy path: single goto succeeds, no fallback triggered', async () => {
    let gotoCalls = 0;
    let currentUrl = 'about:blank';
    const page: PageLike = {
      url: () => currentUrl,
      title: async () => 'Example Domain',
      viewportSize: () => ({ width: 1280, height: 800 }),
      screenshot: async () => Buffer.from(''),
      mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
      keyboard: { type: async () => {}, press: async () => {} },
      ariaSnapshot: async () => '',
      waitForTimeout: async () => {},
      goto: async (u: string) => {
        gotoCalls += 1;
        currentUrl = u;
        return { status: () => 200 } as unknown as null;
      },
    };
    let newPageCalls = 0;
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [
              {
                pages: () => [page],
                newPage: async () => {
                  newPageCalls += 1;
                  return page;
                },
              },
            ],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    const r = await exec.navigate(page, 'https://example.com/');
    expect(r.ok).toBe(true);
    expect(r.message).toBe('navigated to https://example.com/');
    expect(gotoCalls).toBe(1);
    expect(newPageCalls).toBe(0);
  });
});

describe('PlaywrightExecutor.getPage — pinned activePage bypasses probe', () => {
  // Production bug: after a successful navigate(), the next tick's
  // getPage() was running the responsiveness probe on the just-
  // navigated page. When the probe raced with Playwright's context
  // teardown it returned false, which triggered a soft-reset
  // `goto('about:blank')` and clobbered the navigation. The commander
  // then saw url=about:blank forever and gave up.
  //
  // Fix invariant: once a page is pinned as activePage (either by
  // resetPageForTask or by navigate's fallback), getPage returns it
  // DIRECTLY without any probe / reset. The probe path is reserved
  // for the stale pages[0] we didn't create ourselves.
  it('returns the pinned activePage without running the liveness probe', async () => {
    // We count only probe-shaped evaluate calls (the probe passes '1'
    // as the argument). The stealth injector also calls evaluate but
    // with the stealth SCRIPT text, which is fire-and-forget and
    // idempotent — not what this regression test is about.
    let probeCalls = 0;
    let gotoCalls = 0;
    const pinned: PageLike = {
      url: () => 'https://example.com/',
      title: async () => 'Example Domain',
      viewportSize: () => ({ width: 1280, height: 800 }),
      screenshot: async () => Buffer.from(''),
      mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
      keyboard: { type: async () => {}, press: async () => {} },
      ariaSnapshot: async () => '',
      waitForTimeout: async () => {},
      goto: async () => {
        gotoCalls += 1;
        return null;
      },
      evaluate: async (expr: string) => {
        if (expr === '1') probeCalls += 1;
        return 1;
      },
    };
    // Context has a stale pages[0] that would be returned if the pin
    // failed — we assert we NEVER fall through to it.
    const stale = { tag: 'stale' } as unknown;
    const ctx = {
      pages: () => [stale, pinned],
      newPage: async () => pinned,
      addInitScript: async () => {},
    };
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [ctx],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    // Prime the pin via resetPageForTask so activePage = pinned.
    // We have to tweak ctx.newPage to return the pinned page since
    // resetPageForTask opens a newPage.
    await exec.resetPageForTask();
    // First getPage — should return the pinned page, no probe.
    const p1 = await exec.getPage();
    expect(p1).toBe(pinned);
    expect(probeCalls).toBe(0);
    // Second getPage — still no probe, still the pin.
    const p2 = await exec.getPage();
    expect(p2).toBe(pinned);
    expect(probeCalls).toBe(0);
    // And no silent soft-reset goto('about:blank').
    expect(gotoCalls).toBe(0);
  });
});

describe('PlaywrightExecutor.resetPageForTask', () => {
  // Cleanslate guarantee: every task starts on a page we ourselves
  // created via ctx.newPage(), never on a page that survived from the
  // previous task or from Chromium's launch. Prevents the goto-no-op
  // symptom and drops residual state (timers, cookies-in-memory).
  it('opens a fresh newPage, pins it, and closes prior pages', async () => {
    const closeCalls: string[] = [];
    const viewportCalls: Array<{ width: number; height: number }> = [];
    const old1 = {
      url: () => 'https://prev.task/',
      close: async () => {
        closeCalls.push('old1');
      },
    };
    const old2 = {
      url: () => 'about:blank',
      close: async () => {
        closeCalls.push('old2');
      },
    };
    const fresh = {
      url: () => 'about:blank',
      evaluate: async () => 1,
      setViewportSize: async (size: { width: number; height: number }) => {
        viewportCalls.push(size);
      },
      close: async () => {
        closeCalls.push('fresh');
      },
    };
    const pagesRef: unknown[] = [old1, old2];
    const ctx = {
      pages: () => [...pagesRef],
      newPage: async () => {
        pagesRef.push(fresh);
        return fresh;
      },
      addInitScript: async () => {},
    };
    const exec = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [ctx],
            close: async () => {},
          }) as never,
      },
    });
    await exec.connect('http://a');
    exec.setViewportSize({ width: 390, height: 844 });
    await exec.resetPageForTask();
    // Both priors got a close() queued. Fresh is NOT closed.
    await new Promise((r) => setTimeout(r, 10)); // drain fire-and-forget
    expect(closeCalls.sort()).toEqual(['old1', 'old2']);
    // Subsequent getPage returns the pinned fresh page, not pages[0].
    const p = await exec.getPage();
    expect(p).toBe(fresh);
    expect(viewportCalls).toEqual([{ width: 390, height: 844 }]);
  });
});
