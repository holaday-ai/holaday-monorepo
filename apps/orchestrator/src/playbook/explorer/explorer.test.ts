import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUDGET_DEFAULTS,
  checkBreaker,
  firstTripped,
  perBatchBreakerUsd,
  readBudgetBreakersFromEnv,
} from './explorer-budget.js';
import {
  classifyExplorerAction,
  isCapturedStepSafe,
  isWithinDBoundary,
} from './explorer-guards.js';
import { type ExploreSiteOutcome, runExplorerBatch } from './explorer.js';

const ENV_KEYS = [
  'EXPLORER_ENABLED',
  'EXPLORER_BREAKER_PER_SITE_SEED_USD',
  'EXPLORER_BREAKER_PER_SITE_STRANGER_USD',
  'EXPLORER_BREAKER_BATCH_FACTOR',
  'EXPLORER_BREAKER_PER_DAY_USD',
  'EXPLORER_BREAKER_PER_MONTH_USD',
  'EXPLORER_FIRECRAWL_COST_USD',
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ---- budget circuit breakers ----------------------------------------------

describe('explorer-budget', () => {
  it('breakers default to the BOSS v1 values when env unset', () => {
    expect(readBudgetBreakersFromEnv()).toEqual(BUDGET_DEFAULTS);
    expect(BUDGET_DEFAULTS).toEqual({
      perSiteSeedUsd: 5,
      perSiteStrangerUsd: 3,
      perBatchFactor: 1.2,
      perDayUsd: 50,
      perMonthUsd: 200,
    });
  });
  it('invalid env overrides fall back to the default (NOT 0)', () => {
    process.env.EXPLORER_BREAKER_PER_SITE_SEED_USD = '-5';
    process.env.EXPLORER_BREAKER_PER_DAY_USD = '0x10';
    process.env.EXPLORER_BREAKER_PER_MONTH_USD = 'abc';
    const b = readBudgetBreakersFromEnv();
    expect(b.perSiteSeedUsd).toBe(5);
    expect(b.perDayUsd).toBe(50);
    expect(b.perMonthUsd).toBe(200);
  });
  it('a valid positive override is honoured', () => {
    process.env.EXPLORER_BREAKER_PER_SITE_SEED_USD = '8';
    expect(readBudgetBreakersFromEnv().perSiteSeedUsd).toBe(8);
  });
  it('checkBreaker: trips at >= breaker, ok below, fail-safe-trips on <=0', () => {
    expect(checkBreaker(4.99, 5, 'x').tripped).toBe(false);
    expect(checkBreaker(5, 5, 'x').tripped).toBe(true);
    expect(checkBreaker(6, 5, 'x').tripped).toBe(true);
    expect(checkBreaker(0, 0, 'x').tripped).toBe(true); // misconfig → fail-safe
  });
  it('perBatchBreakerUsd = count × perSite × factor', () => {
    expect(perBatchBreakerUsd(3, 5, 1.2)).toBeCloseTo(18);
  });
  it('firstTripped returns the first tripped verdict, else null', () => {
    expect(firstTripped([checkBreaker(0, 5, 'a'), checkBreaker(9, 5, 'b')])?.reason).toMatch(/b/);
    expect(firstTripped([checkBreaker(0, 5, 'a')])).toBeNull();
  });
});

// ---- sensitive site protocol / D-boundary ---------------------------------

describe('explorer-guards', () => {
  it('read / screenshot / scroll are always allowed', () => {
    for (const kind of ['read', 'screenshot', 'scroll'] as const) {
      expect(classifyExplorerAction({ kind }).allowed).toBe(true);
    }
  });
  it('submit is NEVER allowed (hard line)', () => {
    const v = classifyExplorerAction({ kind: 'submit', label: '随便' });
    expect(v.allowed).toBe(false);
    expect(v.sensitive).toBe(true);
  });
  it('blocks order / pay / checkout controls (incl. the review-found leaks)', () => {
    for (const label of [
      '提交订单',
      '立即支付',
      '确认下单',
      '立即购买',
      '购买',
      '下单',
      '确认付款',
      '加入购物车',
      '结算',
      '微信支付',
      '支付宝支付',
      'pay now',
      'Pay',
      'checkout',
      'place order',
      'Buy Now',
      'Add to cart',
      'Order Now',
      'Proceed to payment',
    ]) {
      expect(classifyExplorerAction({ kind: 'click', label }).allowed).toBe(false);
    }
  });
  it('defeats whitespace / zero-width bypass on CN labels', () => {
    for (const label of ['登 录', '提 交', '立即 购买', '确认\u200b支付']) {
      expect(classifyExplorerAction({ kind: 'click', label }).allowed).toBe(false);
    }
  });
  it('blocks login / register / credential / identity controls (explorer additions)', () => {
    for (const label of [
      '登录',
      '注册',
      '修改密码',
      '实名认证',
      '身份证',
      'sign in',
      'log in',
      'password',
    ]) {
      const v = classifyExplorerAction({ kind: 'click', label });
      expect(v.allowed).toBe(false);
      expect(v.sensitive).toBe(true);
    }
  });
  it('blocks social-login / OAuth controls (review CAMERA-4: Continue with Google / 授权)', () => {
    for (const label of [
      'Continue with Google',
      'Continue with Apple',
      'Continue with Facebook',
      'Connect with GitHub',
      'Authorize',
      '授权',
      'Sign in with Google',
    ]) {
      expect(classifyExplorerAction({ kind: 'click', label }).allowed).toBe(false);
    }
  });
  it('allows a benign click / type (no over-block of plain Continue/Read)', () => {
    expect(classifyExplorerAction({ kind: 'click', label: 'Read the docs' }).allowed).toBe(true);
    expect(classifyExplorerAction({ kind: 'type', label: 'Search' }).allowed).toBe(true);
    expect(classifyExplorerAction({ kind: 'click', label: 'Continue reading' }).allowed).toBe(true);
  });
  // Regression — the icon-only BLOCKER the red-team fixture caught: an emoji/glyph
  // visible text must NOT shadow a sensitive aria-label/title (fail-safe multi-signal
  // OR, not first-non-null). Plus the type=password D-boundary + no over-block.
  it('icon-only: benign-glyph visible text does NOT shadow a sensitive aria-label/title', () => {
    // 💳 visible text + sensitive aria-label → blocked (the live BLOCKER).
    expect(
      classifyExplorerAction({ kind: 'click', label: '💳', ariaLabel: '立即支付' }).allowed,
    ).toBe(false);
    // sensitive intent only in title → blocked.
    expect(classifyExplorerAction({ kind: 'click', label: '💳', title: '立即支付' }).allowed).toBe(
      false,
    );
    // sensitive only in placeholder / name → blocked.
    expect(classifyExplorerAction({ kind: 'type', placeholder: '短信验证码' }).allowed).toBe(false);
    expect(classifyExplorerAction({ kind: 'click', name: 'addToCart' }).allowed).toBe(false);
  });
  it('type=password is ALWAYS vetoed (D-boundary), independent of label', () => {
    expect(classifyExplorerAction({ kind: 'type', inputType: 'password' }).allowed).toBe(false);
    expect(classifyExplorerAction({ kind: 'type', inputType: 'PASSWORD' }).allowed).toBe(false);
    // even with a totally benign accessible name, password type wins.
    expect(
      classifyExplorerAction({ kind: 'type', inputType: 'password', placeholder: '请输入' }).allowed,
    ).toBe(false);
  });
  it('does NOT over-block: benign signals + ordinary text/search input stay allowed', () => {
    // a benign icon button (emoji + benign aria/title) is allowed.
    expect(
      classifyExplorerAction({ kind: 'click', label: '🔍', ariaLabel: '搜索', title: '查看文档' })
        .allowed,
    ).toBe(true);
    // typing into a normal search/text field is allowed (explorer browses + searches).
    expect(
      classifyExplorerAction({ kind: 'type', inputType: 'search', placeholder: '搜索商品', name: 'q' })
        .allowed,
    ).toBe(true);
    expect(
      classifyExplorerAction({ kind: 'type', inputType: 'text', placeholder: '输入关键词' }).allowed,
    ).toBe(true);
  });
  it('blocks navigation to pay / login / auth urls (incl. review leaks); allows a doc url', () => {
    for (const url of [
      'https://x.com/checkout',
      'https://x.com/login',
      'https://x.com/account/security',
      'https://x.com/pay',
      'https://x.com/order',
      'https://x.com/cart',
      'https://x.com/buy',
      'https://x.com/purchase',
      'https://x.com/sso',
      'https://x.com/connect/authorize',
      'https://x.com/users/sign_in',
    ]) {
      expect(classifyExplorerAction({ kind: 'navigate', url }).allowed).toBe(false);
    }
    expect(
      classifyExplorerAction({ kind: 'navigate', url: 'https://x.com/docs/api' }).allowed,
    ).toBe(true);
  });
  it('isWithinDBoundary mirrors classify', () => {
    expect(isWithinDBoundary({ kind: 'read' })).toBe(true);
    expect(isWithinDBoundary({ kind: 'submit' })).toBe(false);
  });
  it('isCapturedStepSafe: fail-closed on unknown step types + url-aware', () => {
    expect(isCapturedStepSafe('navigate', null)).toBe(true);
    expect(isCapturedStepSafe('click', 'Learn more')).toBe(true);
    expect(isCapturedStepSafe('click', '提交订单')).toBe(false);
    expect(isCapturedStepSafe('submit', 'anything')).toBe(false);
    expect(isCapturedStepSafe('click', '登录')).toBe(false);
    // unknown step types fail closed (no longer coerced to 'read')
    expect(isCapturedStepSafe('form_submit', '提交订单')).toBe(false);
    expect(isCapturedStepSafe('tap', '登录')).toBe(false);
    // navigate / click with a sensitive url is dropped
    expect(isCapturedStepSafe('navigate', null, 'https://x.com/checkout')).toBe(false);
    expect(isCapturedStepSafe('click', 'Continue', 'https://x.com/pay')).toBe(false);
  });
});

// ---- orchestrator shell: locks + three-layer breaker ----------------------

function spyExplore(calls: string[], costUsd = 0): (d: string) => Promise<ExploreSiteOutcome> {
  return async (domain) => {
    calls.push(domain);
    return {
      domain,
      status: 'completed',
      costUsd,
      capabilityExternalId: `cap_${domain}`,
      note: 'fake',
    };
  };
}

describe('runExplorerBatch — never-runs locks', () => {
  it('LOCK 1: a REAL run while EXPLORER_ENABLED unset → no-op, exploreSite NEVER called', async () => {
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 1) },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(r.enabled).toBe(false);
    expect(r.halted).toBe(true);
    expect(calls).toEqual([]);
    expect(r.totalSpentUsd).toBe(0);
  });

  it('dry-run PREVIEWS while disabled — dispatches nothing, spends nothing', async () => {
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 1) },
      { seedSites: ['a.com', 'b.com'], dryRun: true },
    );
    expect(calls).toEqual([]); // no dispatch
    expect(r.perSite.map((p) => p.status)).toEqual(['dry_run', 'dry_run']);
    expect(r.halted).toBe(false);
  });

  it('LOCK 2: dry-run while enabled → preview only, exploreSite NEVER called', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 1) },
      { seedSites: ['a.com', 'b.com'], dryRun: true },
    );
    expect(calls).toEqual([]);
    expect(r.perSite.map((p) => p.status)).toEqual(['dry_run', 'dry_run']);
  });
});

describe('runExplorerBatch — three-layer breaker (does NOT 掐 normal completion)', () => {
  it('a normal batch completes — breakers default to real values, not 0', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 0.5) }, // $0.5 ≪ $5 per-site breaker
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(calls).toEqual(['a.com', 'b.com']);
    expect(r.sitesExplored).toBe(2);
    expect(r.halted).toBe(false);
    expect(r.totalSpentUsd).toBeCloseTo(1.0);
  });

  it('PER-SITE breaker stops THAT site (flags it) but the batch CONTINUES', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const exploreSite = async (domain: string): Promise<ExploreSiteOutcome> => {
      calls.push(domain);
      return { domain, status: 'completed', costUsd: domain === 'a.com' ? 6 : 0.5, note: 'fake' };
    };
    const r = await runExplorerBatch(
      { exploreSite },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(calls).toEqual(['a.com', 'b.com']); // batch continued past the abnormal site
    expect(r.perSite.find((p) => p.domain === 'a.com')?.status).toBe('halted_budget');
    expect(r.perSite.find((p) => p.domain === 'b.com')?.status).toBe('completed');
    expect(r.halted).toBe(false);
  });

  it('PER-BATCH breaker stops the WHOLE batch (backstop for multiple abnormal sites)', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    // 2 sites × $5 × 1.2 = $12 batch breaker; two $7 sites → $14 ≥ $12 after site 2.
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 7) },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(calls).toEqual(['a.com', 'b.com']);
    expect(r.halted).toBe(true);
    expect(r.haltReason).toMatch(/per-batch.*TRIPPED/);
  });

  it('PER-DAY breaker stops the batch using the prior-day base', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 0.5), readPriorDaySpendUsd: async () => 49.9 },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    // dayBase 49.9 + $0.5 = 50.4 ≥ $50 → halt after site 1
    expect(calls).toEqual(['a.com']);
    expect(r.halted).toBe(true);
    expect(r.haltReason).toMatch(/per-day.*TRIPPED/);
  });

  it('PER-MONTH breaker stops the batch using the prior-month base', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 0.5), readPriorMonthSpendUsd: async () => 199.9 },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(calls).toEqual(['a.com']);
    expect(r.halted).toBe(true);
    expect(r.haltReason).toMatch(/per-month.*TRIPPED/);
  });

  it('a single-site failure does not abort the batch', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const exploreSite = async (domain: string): Promise<ExploreSiteOutcome> => {
      calls.push(domain);
      if (domain === 'bad.com') throw new Error('boom');
      return { domain, status: 'completed', costUsd: 0.1, note: 'ok' };
    };
    const r = await runExplorerBatch(
      { exploreSite },
      { seedSites: ['bad.com', 'good.com'], dryRun: false },
    );
    expect(calls).toEqual(['bad.com', 'good.com']);
    expect(r.perSite.find((p) => p.domain === 'bad.com')?.status).toBe('failed');
    expect(r.perSite.find((p) => p.domain === 'good.com')?.status).toBe('completed');
  });
});
