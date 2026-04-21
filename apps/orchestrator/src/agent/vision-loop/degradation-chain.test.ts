import { describe, expect, it } from 'vitest';
import type { AntiBotSignal } from './anti-bot-detector.js';
import {
  DegradationChain,
  type DegradationContext,
  type DegradationStrategy,
  ExtensionFallbackStrategy,
  ProfileRotationStrategy,
  ProxySwapStrategy,
  SearchApiFallbackStrategy,
  SearchEngineSwapStrategy,
  defaultStrategies,
} from './degradation-chain.js';

/**
 * DegradationChain sits between the anti-bot detector and the Layer 5
 * extension fallback. Tests cover ordering, skipping, and each
 * concrete strategy's canTry/execute contract. No real browser or
 * network — strategies that need Playwright get a hand-rolled
 * `executor` with just the .browser.contexts surface they poke.
 */

function signal(type: AntiBotSignal['type'] = 'captcha'): AntiBotSignal {
  return {
    type,
    confidence: 'high',
    rawMatch: 'test match',
  };
}

function ctx(overrides: Partial<DegradationContext> = {}): DegradationContext {
  return {
    taskId: 'tsk_test',
    userId: 'usr_test',
    intent: 'search for AAPL stock',
    signal: signal(),
    executor: null,
    strikes: 1,
    ...overrides,
  };
}

describe('DegradationChain.tryNext — ordering + skip semantics', () => {
  it('tries strategies in ascending level order', async () => {
    const order: string[] = [];
    const mk = (id: string, level: number): DegradationStrategy => ({
      id,
      level,
      canTry: () => {
        order.push(`can:${id}`);
        return true;
      },
      execute: async () => {
        order.push(`exec:${id}`);
        return { ok: true, strategy: id, level, message: id };
      },
    });
    const chain = new DegradationChain([mk('c', 3), mk('a', 1), mk('b', 2)]);
    const r = await chain.tryNext(ctx(), 0);
    expect(r?.strategy).toBe('a');
    // Only `a` was considered — chain stops at first canTry hit.
    expect(order).toEqual(['can:a', 'exec:a']);
  });

  it('skips levels <= lastLevelTried', async () => {
    const calls: string[] = [];
    const mk = (id: string, level: number): DegradationStrategy => ({
      id,
      level,
      canTry: () => {
        calls.push(id);
        return true;
      },
      execute: async () => ({ ok: true, strategy: id, level, message: id }),
    });
    const chain = new DegradationChain([mk('a', 1), mk('b', 2), mk('c', 3)]);
    const r = await chain.tryNext(ctx(), 2);
    expect(r?.strategy).toBe('c');
    expect(calls).toEqual(['c']);
  });

  it('skips strategies whose canTry returns false', async () => {
    const mk = (id: string, level: number, ok: boolean): DegradationStrategy => ({
      id,
      level,
      canTry: () => ok,
      execute: async () => ({ ok: true, strategy: id, level, message: id }),
    });
    const chain = new DegradationChain([mk('a', 1, false), mk('b', 2, true)]);
    const r = await chain.tryNext(ctx(), 0);
    expect(r?.strategy).toBe('b');
  });

  it('returns null when no remaining strategy can run', async () => {
    const mk = (id: string, level: number): DegradationStrategy => ({
      id,
      level,
      canTry: () => false,
      execute: async () => ({ ok: true, strategy: id, level, message: id }),
    });
    const chain = new DegradationChain([mk('a', 1), mk('b', 2)]);
    const r = await chain.tryNext(ctx(), 0);
    expect(r).toBeNull();
  });

  it('returns a fabricated ok:false when a strategy throws, continuing the task', async () => {
    const boom: DegradationStrategy = {
      id: 'boom',
      level: 1,
      canTry: () => true,
      execute: async () => {
        throw new Error('kaboom');
      },
    };
    const chain = new DegradationChain([boom]);
    const r = await chain.tryNext(ctx(), 0);
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/kaboom/);
  });

  it("treats canTry-throws the same as canTry-false (skip, don't crash)", async () => {
    let attempted = false;
    const throws: DegradationStrategy = {
      id: 'throws',
      level: 1,
      canTry: () => {
        throw new Error('oops');
      },
      execute: async () => {
        attempted = true;
        return { ok: true, strategy: 'throws', level: 1, message: '' };
      },
    };
    const passes: DegradationStrategy = {
      id: 'passes',
      level: 2,
      canTry: () => true,
      execute: async () => ({ ok: true, strategy: 'passes', level: 2, message: '' }),
    };
    const chain = new DegradationChain([throws, passes]);
    const r = await chain.tryNext(ctx(), 0);
    expect(attempted).toBe(false);
    expect(r?.strategy).toBe('passes');
  });
});

describe('defaultStrategies', () => {
  it('registers exactly five tiers, sorted by level', () => {
    const chain = new DegradationChain(defaultStrategies());
    const levels = chain.getStrategies().map((s) => s.level);
    expect(levels).toEqual([1, 2, 3, 4, 5]);
    const ids = chain.getStrategies().map((s) => s.id);
    expect(ids).toEqual([
      'profile_rotation',
      'proxy_swap',
      'search_engine_swap',
      'search_api_fallback',
      'extension_fallback',
    ]);
  });
});

describe('ProfileRotationStrategy', () => {
  it('clears cookies on every context and installs a UA override', async () => {
    const clearCalls: string[] = [];
    const addInitCalls: Array<{ content: string }> = [];
    const fakeContexts = [
      {
        clearCookies: async () => {
          clearCalls.push('c1');
        },
        addInitScript: async (opts: { content: string }) => {
          addInitCalls.push(opts);
        },
      },
      {
        clearCookies: async () => {
          clearCalls.push('c2');
        },
        addInitScript: async (opts: { content: string }) => {
          addInitCalls.push(opts);
        },
      },
    ];
    const fakeExecutor = { browser: { contexts: () => fakeContexts } } as never;
    const s = new ProfileRotationStrategy();
    const r = await s.execute(ctx({ executor: fakeExecutor }));
    expect(r.ok).toBe(true);
    expect(clearCalls).toEqual(['c1', 'c2']);
    expect(addInitCalls).toHaveLength(2);
    expect(addInitCalls[0]?.content).toMatch(/userAgent/);
  });

  it('canTry is false when no executor is attached', async () => {
    const s = new ProfileRotationStrategy();
    expect(await s.canTry(ctx({ executor: null }))).toBe(false);
  });
});

describe('ProxySwapStrategy env gating', () => {
  it('canTry returns false when PROXY_LIST is unset', async () => {
    const prev = process.env.PROXY_LIST;
    delete process.env.PROXY_LIST;
    const s = new ProxySwapStrategy();
    expect(await s.canTry()).toBe(false);
    if (prev !== undefined) process.env.PROXY_LIST = prev;
  });

  it('canTry returns true when PROXY_LIST contains at least one entry', async () => {
    const prev = process.env.PROXY_LIST;
    process.env.PROXY_LIST = 'http://proxy-a:8080,http://proxy-b:8080';
    const s = new ProxySwapStrategy();
    expect(await s.canTry()).toBe(true);
    const r = await s.execute();
    // Stub implementation: ok:false + diagnostic message noting the
    // connectOverCDP constraint. Regression guard so we remember to
    // flip this to ok:true once we ship the relaunch path.
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/proxy swap noted/);
    if (prev === undefined) delete process.env.PROXY_LIST;
    else process.env.PROXY_LIST = prev;
  });
});

describe('SearchEngineSwapStrategy', () => {
  it('canTry=true only when the intent mentions a search-engine-flavoured task', () => {
    const s = new SearchEngineSwapStrategy();
    expect(s.canTry(ctx({ intent: 'search AAPL 股价' }))).toBe(true);
    expect(s.canTry(ctx({ intent: 'google "how to X"' }))).toBe(true);
    expect(s.canTry(ctx({ intent: '打开 example.com' }))).toBe(false);
  });

  it('picks a different engine from the current URL and builds a query URL', async () => {
    const fakeExecutor = {
      getPage: async () => ({ url: () => 'https://www.google.com/search?q=foo' }),
    } as never;
    const s = new SearchEngineSwapStrategy();
    const r = await s.execute(ctx({ executor: fakeExecutor, intent: 'search AAPL stock' }));
    expect(r.ok).toBe(true);
    expect(r.nextUrl).toBeDefined();
    // Not google (we're on google); should prefer duckduckgo first.
    expect(r.nextUrl).toMatch(/duckduckgo\.com/);
    expect(r.nextUrl).toContain(encodeURIComponent('AAPL stock'));
  });
});

describe('SearchApiFallbackStrategy env gating', () => {
  it('canTry returns true when SERPAPI_KEY is set', () => {
    const prev = process.env.SERPAPI_KEY;
    process.env.SERPAPI_KEY = 'test-key';
    expect(new SearchApiFallbackStrategy().canTry()).toBe(true);
    if (prev === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prev;
  });

  it('canTry returns false when neither SERPAPI_KEY nor GOOGLE_SEARCH_API_KEY is set', () => {
    const prevS = process.env.SERPAPI_KEY;
    const prevG = process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.SERPAPI_KEY;
    delete process.env.GOOGLE_SEARCH_API_KEY;
    expect(new SearchApiFallbackStrategy().canTry()).toBe(false);
    if (prevS !== undefined) process.env.SERPAPI_KEY = prevS;
    if (prevG !== undefined) process.env.GOOGLE_SEARCH_API_KEY = prevG;
  });
});

describe('ExtensionFallbackStrategy', () => {
  it('always can-try and flips handoffToExtension=true in its result', async () => {
    const s = new ExtensionFallbackStrategy();
    expect(s.canTry()).toBe(true);
    const r = await s.execute();
    expect(r.ok).toBe(true);
    expect(r.handoffToExtension).toBe(true);
    expect(r.message).toMatch(/extension/i);
  });
});

describe('DegradationChain end-to-end escalation', () => {
  it('on a search-flavoured task with no proxy/search-API env, lands on search_engine_swap first', async () => {
    const prev = {
      P: process.env.PROXY_LIST,
      S: process.env.SERPAPI_KEY,
      G: process.env.GOOGLE_SEARCH_API_KEY,
    };
    delete process.env.PROXY_LIST;
    delete process.env.SERPAPI_KEY;
    delete process.env.GOOGLE_SEARCH_API_KEY;

    const fakeExecutor = {
      browser: {
        contexts: () => [
          { clearCookies: async () => {}, addInitScript: async () => {} },
        ],
      },
      getPage: async () => ({ url: () => 'https://www.google.com/search?q=x' }),
    } as never;

    const chain = new DegradationChain();
    // First pass: profile rotation (level 1) fires because it's first
    // and canTry=true.
    const r1 = await chain.tryNext(ctx({ executor: fakeExecutor }), 0);
    expect(r1?.strategy).toBe('profile_rotation');
    // Second pass: proxy skipped (no env), so we land on engine swap.
    const r2 = await chain.tryNext(ctx({ executor: fakeExecutor }), 1);
    expect(r2?.strategy).toBe('search_engine_swap');
    // Third pass: search API skipped (no env), so we hit extension.
    const r3 = await chain.tryNext(ctx({ executor: fakeExecutor }), 3);
    expect(r3?.strategy).toBe('extension_fallback');
    expect(r3?.handoffToExtension).toBe(true);

    if (prev.P !== undefined) process.env.PROXY_LIST = prev.P;
    if (prev.S !== undefined) process.env.SERPAPI_KEY = prev.S;
    if (prev.G !== undefined) process.env.GOOGLE_SEARCH_API_KEY = prev.G;
  });
});
