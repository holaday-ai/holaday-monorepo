import { describe, expect, it } from 'vitest';
import { PlaywrightExecutor } from './playwright-executor.js';

/**
 * Phase 1 Playbook ④ — gated CLEAN-CONTEXT mode + the fail-closed ZERO-COOKIE
 * assertion (the zero-credential hard guarantee). Uses the constructor DI seam to
 * inject a fake chromium; connect()'s banner dismissal / stealth no-op on an empty
 * contexts() list, so these tests exercise the clean-context path in isolation.
 */
function fakeChromium(cookies: Array<{ domain: string }>) {
  const state = { newContextCalls: 0, closed: false, cookieCalls: 0 };
  const fakeCtx = {
    cookies: async () => {
      state.cookieCalls += 1;
      return cookies;
    },
    close: async () => {
      state.closed = true;
    },
  };
  const browser = {
    contexts: () => [] as unknown[], // banner dismissal + stealth loop over nothing
    newContext: async () => {
      state.newContextCalls += 1;
      return fakeCtx;
    },
  };
  return {
    chromium: { connectOverCDP: async () => browser } as never,
    state,
  };
}

describe('PlaywrightExecutor — gated clean-context mode', () => {
  it('clean mode creates a FRESH context + passes the zero-cookie assertion when empty', async () => {
    const { chromium, state } = fakeChromium([]);
    const ex = new PlaywrightExecutor({ chromium });
    const r = await ex.connect('http://127.0.0.1:9222', { cleanContext: true });
    expect(r.ok).toBe(true);
    expect(state.newContextCalls).toBe(1); // fresh isolated context, not contexts()[0]
    await expect(ex.assertCleanContext()).resolves.toBeUndefined();
    await ex.disposeCleanContext();
    expect(state.closed).toBe(true);
  });

  it('🔒 FAIL-CLOSED: a non-empty cookie jar → assertCleanContext throws + disposes the context', async () => {
    const { chromium, state } = fakeChromium([{ domain: 'accounts.google.com' }]);
    const ex = new PlaywrightExecutor({ chromium });
    await ex.connect('http://127.0.0.1:9222', { cleanContext: true });
    await expect(ex.assertCleanContext()).rejects.toThrow(/not clean|refusing/i);
    expect(state.closed).toBe(true); // dirty context is closed, browse must not proceed
  });

  it('DEFAULT (no cleanContext) → newContext NOT called (user task byte-identical)', async () => {
    const { chromium, state } = fakeChromium([]);
    const ex = new PlaywrightExecutor({ chromium });
    await ex.connect('http://127.0.0.1:9222');
    expect(state.newContextCalls).toBe(0);
    // assertCleanContext is meaningless off clean mode → refuses (can't be called by accident)
    await expect(ex.assertCleanContext()).rejects.toThrow(/outside clean-context/i);
  });
});

// Regression for the adversarial-review CAMERA-3/6 BLOCKER: the page-lifecycle
// methods (resetPageForTask / getPage / reopenActivePage) must operate on the FRESH
// clean context — NEVER the shared contexts()[0] — and must not close the user's
// shared tabs. (The earlier tests stubbed runSupercar, so they missed this.)
describe('PlaywrightExecutor — clean mode never touches the shared context', () => {
  function fakeWithBothContexts() {
    const fakePage = {
      url: () => 'about:blank',
      close: async () => {},
      isClosed: () => false,
      evaluate: async () => {},
      addInitScript: async () => {},
      setViewportSize: async () => {},
      setDefaultTimeout: () => {},
      setDefaultNavigationTimeout: () => {},
    };
    const calls = { sharedNewPage: 0, cleanNewPage: 0, sharedClose: 0 };
    const sharedTab = {
      close: async () => {
        calls.sharedClose += 1;
      },
    };
    const sharedCtx = {
      pages: () => [sharedTab],
      newPage: async () => {
        calls.sharedNewPage += 1;
        return fakePage;
      },
      cookies: async () => [],
    };
    const cleanCtx = {
      pages: () => [],
      newPage: async () => {
        calls.cleanNewPage += 1;
        return fakePage;
      },
      cookies: async () => [],
      close: async () => {},
    };
    const browser = { contexts: () => [sharedCtx], newContext: async () => cleanCtx };
    return { chromium: { connectOverCDP: async () => browser } as never, calls };
  }

  it('resetPageForTask in clean mode opens the FRESH context + leaves the shared tabs alone', async () => {
    const { chromium, calls } = fakeWithBothContexts();
    const ex = new PlaywrightExecutor({ chromium });
    await ex.connect('http://127.0.0.1:9222', { cleanContext: true });
    await ex.resetPageForTask();
    expect(calls.cleanNewPage).toBe(1); // fresh page on the CLEAN context
    expect(calls.sharedNewPage).toBe(0); // shared context's newPage NEVER called
    expect(calls.sharedClose).toBe(0); // user's shared tabs NEVER closed
  });

  it('default mode resetPageForTask still uses the shared context (unchanged)', async () => {
    const { chromium, calls } = fakeWithBothContexts();
    const ex = new PlaywrightExecutor({ chromium });
    await ex.connect('http://127.0.0.1:9222'); // no clean flag
    await ex.resetPageForTask();
    expect(calls.sharedNewPage).toBe(1); // operates on contexts()[0] as before
    expect(calls.cleanNewPage).toBe(0);
  });
});
