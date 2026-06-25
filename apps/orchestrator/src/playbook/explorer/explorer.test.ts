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
  it('A3 login-mode EXTRA_RE: blocks 转账/分享/删除/提现 ONLY when loginMode (免登录 unchanged)', () => {
    // 'Copy link' / '复制链接' = figma login run #2 gap (a share-link control slipped the veto).
    for (const label of [
      '转账',
      '分享',
      '删除文件',
      '提现',
      '解绑',
      '设为公开',
      'transfer',
      'delete',
      'Copy link',
      '复制链接',
    ]) {
      // 免登录 lane (default): EXTRA_RE controls are NOT in the base list → allowed.
      expect(classifyExplorerAction({ kind: 'click', label }).allowed).toBe(true);
      // login mode: EXTRA_RE thickens → blocked.
      expect(classifyExplorerAction({ kind: 'click', label }, { loginMode: true }).allowed).toBe(false);
    }
    // multi-signal: an icon-only 转账 (sensitive aria) is blocked in login mode.
    expect(
      classifyExplorerAction({ kind: 'click', label: '🔁', ariaLabel: '转账' }, { loginMode: true }).allowed,
    ).toBe(false);
  });
  it('A3 login-mode does NOT loosen: base-sensitive + submit + password stay blocked in BOTH modes', () => {
    // base sensitive label blocked regardless of mode.
    for (const opts of [{}, { loginMode: true }]) {
      expect(classifyExplorerAction({ kind: 'click', label: '立即支付' }, opts).allowed).toBe(false);
      expect(classifyExplorerAction({ kind: 'submit', label: 'x' }, opts).allowed).toBe(false);
      expect(classifyExplorerAction({ kind: 'type', inputType: 'password' }, opts).allowed).toBe(false);
      // a benign control stays allowed even in login mode (no over-block).
      expect(classifyExplorerAction({ kind: 'click', label: 'Read the docs' }, opts).allowed).toBe(true);
    }
  });
  it('A3 EXTRA_RE precision: benign onboarding text NOT over-blocked, real combos still vetoed', () => {
    // todoist login run FALSE POSITIVE: bare 清空/永久/公开 matched onboarding text ("清空您的大脑")
    // → premature halt. Tightened to combos. These benign labels must NOT veto in login mode:
    for (const label of ['清空您的大脑', '清空大脑', '永久免费', '公开课', '公开页面']) {
      expect(classifyExplorerAction({ kind: 'click', label }, { loginMode: true }).allowed).toBe(true);
    }
    // the REAL destructive / share combos still vetoed in login mode (incl. 清空收件箱 = bulk-delete,
    // the BOSS-flagged gap — a destructive 清空 combo, distinct from the benign onboarding "清空您的大脑"):
    for (const label of [
      '永久删除',
      '清空收件箱',
      '清空回收站',
      '清空账户',
      '清空所有',
      '清空数据',
      '设为公开',
      '公开分享',
      '删除任务',
      '删除项目',
      '转账',
    ]) {
      expect(classifyExplorerAction({ kind: 'click', label }, { loginMode: true }).allowed).toBe(false);
    }
  });

  // ════ 预订/交易站 fail-closed 加固 (login-mode only) — 6 红队向量 ════
  const LOGIN = { loginMode: true } as const;
  it('🏨① 交易/出行人新词：login-mode 拦、免登录放行 (EXTRA-only，base 没这些)', () => {
    // EXTRA-only (NOT in base; 立即预订/确认预订/下单/去支付… are already in base → blocked both modes,
    // so they belong to ⑤ not here):
    for (const label of [
      '继续预订', '占座', '选座', '锁定座位', '担保',
      'book now', 'reserve', 'hold seat', '添加出行人', '添加乘客', '新增联系人', '填写证件', '保存出行人',
      'add traveler', 'add passenger',
    ]) {
      expect(classifyExplorerAction({ kind: 'click', label }, LOGIN).allowed).toBe(false); // login 拦
      expect(classifyExplorerAction({ kind: 'click', label }).allowed).toBe(true); // 免登录放行
    }
    // base 交易词在两模式都拦 (确认这些没退化；预授权 经 base 授权 命中也属此列):
    for (const label of ['立即预订', '确认预订', '下单', '去支付', '预授权']) {
      expect(classifyExplorerAction({ kind: 'click', label }).allowed).toBe(false);
      expect(classifyExplorerAction({ kind: 'click', label }, LOGIN).allowed).toBe(false);
    }
  });
  it('🏨③ 层B 结构：提交型控件 + 中性"继续/下一步" → 拦；非提交型 → 不拦', () => {
    expect(classifyExplorerAction({ kind: 'click', label: '继续', tagName: 'button' }, LOGIN).allowed).toBe(false);
    expect(classifyExplorerAction({ kind: 'click', label: '下一步', tagName: 'button' }, LOGIN).allowed).toBe(false);
    expect(
      classifyExplorerAction({ kind: 'click', label: 'Continue', tagName: 'input', inputType: 'submit' }, LOGIN).allowed,
    ).toBe(false);
    // NON-submit control with the SAME neutral label → layer-B does NOT fire (no over-block of links/spans)
    expect(classifyExplorerAction({ kind: 'click', label: '继续', tagName: 'span' }, LOGIN).allowed).toBe(true);
    expect(classifyExplorerAction({ kind: 'click', label: '继续阅读', tagName: 'a' }, LOGIN).allowed).toBe(true);
    // 免登录: layer B never fires (submit button + 继续 allowed)
    expect(classifyExplorerAction({ kind: 'click', label: '继续', tagName: 'button' }).allowed).toBe(true);
  });
  it('🏨②⑥ 交易页反转：login + 交易阶段 pageUrl → 非白名单 click 默认拦；白名单放行；spy 内层 never 调（halt 前拦）', () => {
    const tx = (label: string, extra: Record<string, unknown> = {}) =>
      classifyExplorerAction(
        { kind: 'click', label, pageUrl: 'https://www.trip.com/booking/confirm', ...extra },
        LOGIN,
      );
    // 极致 fail-closed: ANY non-whitelisted click on a transaction-stage page → vetoed (sensitive=true →
    // the agent-loop halts BEFORE executeComputerAction = executor inner click never called).
    expect(tx('继续').allowed).toBe(false);
    expect(tx('点这里').allowed).toBe(false); // 任意中性钮也拦
    expect(tx('立即支付').allowed).toBe(false);
    expect(tx('继续').sensitive).toBe(true); // halt 标记
    // safe whitelist → allowed (agent can still navigate back / inspect)
    expect(tx('返回').allowed).toBe(true);
    expect(tx('查看价格明细').allowed).toBe(true);
    expect(tx('修改').allowed).toBe(true);
    expect(tx('取消').allowed).toBe(true);
    // 反转只在交易页：同样中性 click 在非交易页 → 放行
    expect(
      classifyExplorerAction({ kind: 'click', label: '点这里', pageUrl: 'https://www.trip.com/flights/search' }, LOGIN)
        .allowed,
    ).toBe(true);
    // 免登录: 反转不触发 (交易页 + 中性 click 放行)
    expect(
      classifyExplorerAction({ kind: 'click', label: '点这里', pageUrl: 'https://www.trip.com/booking/confirm' }).allowed,
    ).toBe(true);
  });
  it('🏨④ benign 不误拦 (login-mode, 非交易页)：搜索/查看/筛选/改日期/返回 放行', () => {
    for (const label of ['搜索航班', '查看详情', '筛选', '改日期', '返回', '排序', '展开更多']) {
      expect(
        classifyExplorerAction({ kind: 'click', label, pageUrl: 'https://www.trip.com/flights' }, LOGIN).allowed,
      ).toBe(true);
    }
  });
  it('🏨⑤ 既有红线不回归 (login-mode 仍拦)：转账/删除/分享/Copy link/清空收件箱/支付/登录', () => {
    for (const label of ['转账', '删除任务', '分享', 'Copy link', '清空收件箱', '立即支付', '登录']) {
      expect(classifyExplorerAction({ kind: 'click', label }, LOGIN).allowed).toBe(false);
    }
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

  it('(a) FAIL-CLOSED: a non-finite site cost HALTS the batch (NOT treated as $0)', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const exploreSite = async (domain: string): Promise<ExploreSiteOutcome> => {
      calls.push(domain);
      return { domain, status: 'completed', costUsd: Number.NaN, note: 'fake' };
    };
    const r = await runExplorerBatch(
      { exploreSite },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(calls).toEqual(['a.com']); // halted after the indeterminate site — b.com never ran
    expect(r.halted).toBe(true);
    expect(r.haltReason).toMatch(/indeterminate cost/i);
    expect(r.perSite.find((p) => p.domain === 'a.com')?.status).toBe('halted_budget');
  });

  it('(a) a FINITE $0 cost is legitimate (no billable call) — NOT a trip, batch completes', async () => {
    process.env.EXPLORER_ENABLED = 'true';
    const calls: string[] = [];
    const r = await runExplorerBatch(
      { exploreSite: spyExplore(calls, 0) },
      { seedSites: ['a.com', 'b.com'], dryRun: false },
    );
    expect(calls).toEqual(['a.com', 'b.com']);
    expect(r.halted).toBe(false);
    expect(r.perSite.every((p) => p.status === 'completed')).toBe(true);
    expect(r.totalSpentUsd).toBe(0);
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
