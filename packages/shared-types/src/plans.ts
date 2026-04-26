/**
 * Plan catalogue — single source of truth for pricing, limits, and
 * marketing copy, shared between the orchestrator (charges + DB
 * writes) and the web UI (pricing page).
 *
 * Money in cents (integer) so we never round-trip through floats.
 * Two parallel currencies: USD (charged via PayPal today, will charge
 * via Stripe later) and CNY (charged via WeChat Pay / Alipay in
 * Phase 2). The frontend picks one based on locale; today PayPal
 * always charges USD regardless of display currency, so the CNY
 * column is informational until Phase 2 lands.
 *
 * Each paid plan has three price points: `monthly`, `yearly`,
 * `firstMonth`. The yearly is ~17% off vs 12×monthly; firstMonth is
 * a deep promo for new users (server checks `users.plan === 'free'`
 * to decide whether to apply). Adding a new plan: extend `PLAN_IDS`
 * and add an entry — the DB column is VARCHAR(32) so no migration.
 */

export const PLAN_IDS = ['free', 'basic', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type BillingCycle = 'monthly' | 'yearly';
export type Currency = 'usd' | 'cny';

export interface PlanPricing {
  /** Cost of a single monthly cycle, regular rate. */
  readonly monthlyCents: number;
  /** Cost of a yearly cycle. ~17% off vs 12 × monthly. */
  readonly yearlyCents: number;
  /** Promotional first-month rate. `null` on Free. */
  readonly firstMonthCents: number | null;
}

export interface PlanDefinition {
  readonly id: PlanId;
  /** Chinese display name (rendered in zh-CN locale). */
  readonly nameZh: string;
  /** English display name (rendered everywhere else). */
  readonly nameEn: string;
  readonly usd: PlanPricing;
  readonly cny: PlanPricing;
  /**
   * Task allowance. `period` is 'day' for Free (resets daily, no
   * rollover) or 'month' (resets first of month). `opus` is the
   * sub-quota for Opus-tier tasks (Pro only); standard tasks come
   * out of `count`. `firstMonthBonus` is added to `count` only on
   * the first paid month.
   */
  readonly tasks: {
    readonly period: 'day' | 'month';
    readonly count: number;
    readonly opus?: number;
    readonly firstMonthBonus?: number;
  };
  readonly concurrency: number;
  readonly historyDays: number;
  /** Roles available to this tier. 0 = none, 33 = full catalogue. */
  readonly rolesAllowed: number;
  /** Marketing bullets — already localised, no per-feature i18n. */
  readonly featuresZh: readonly string[];
  readonly featuresEn: readonly string[];
}

export const PLAN_CATALOGUE: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: 'free',
    nameZh: '体验版',
    nameEn: 'Free',
    usd: { monthlyCents: 0, yearlyCents: 0, firstMonthCents: null },
    cny: { monthlyCents: 0, yearlyCents: 0, firstMonthCents: null },
    tasks: { period: 'day', count: 3 },
    concurrency: 1,
    historyDays: 7,
    rolesAllowed: 0,
    featuresZh: ['Sonnet 模型', '搜索 + 基础浏览器', '7 天任务历史', '1 并发'],
    featuresEn: ['Sonnet model', 'Search + basic browser', '7-day history', '1 concurrent'],
  },
  basic: {
    id: 'basic',
    nameZh: '基础版',
    nameEn: 'Basic',
    usd: { monthlyCents: 400, yearlyCents: 4000, firstMonthCents: 150 },
    cny: { monthlyCents: 2900, yearlyCents: 29000, firstMonthCents: 990 },
    tasks: { period: 'month', count: 100, firstMonthBonus: 30 },
    concurrency: 1,
    historyDays: 30,
    rolesAllowed: 5,
    featuresZh: [
      'Sonnet 模型',
      '完整浏览器（Brave 反检测）',
      '30 天任务历史',
      '1 并发',
      '自选 5 个专业角色',
    ],
    featuresEn: [
      'Sonnet model',
      'Full browser (Brave anti-detection)',
      '30-day history',
      '1 concurrent',
      '5 professional roles (your pick)',
    ],
  },
  pro: {
    id: 'pro',
    nameZh: '专业版',
    nameEn: 'Pro',
    usd: { monthlyCents: 1370, yearlyCents: 13700, firstMonthCents: 690 },
    cny: { monthlyCents: 9900, yearlyCents: 99000, firstMonthCents: 4900 },
    tasks: { period: 'month', count: 150, opus: 15, firstMonthBonus: 50 },
    concurrency: 3,
    historyDays: 90,
    rolesAllowed: 33,
    featuresZh: [
      'Sonnet + Opus 智能路由',
      '完整浏览器',
      '90 天任务历史',
      '3 并发',
      '全部 33 个专业角色',
      '优先队列',
    ],
    featuresEn: [
      'Smart Sonnet + Opus routing',
      'Full browser',
      '90-day history',
      '3 concurrent',
      'All 33 professional roles',
      'Priority queue',
    ],
  },
} as const;

export function isPaidPlan(id: string): id is PaidPlanId {
  return id === 'basic' || id === 'pro';
}

/**
 * Pick the right charge amount given plan + cycle + first-month
 * status + currency. Used by the server to compute PayPal order
 * total and by the frontend to render display prices. Yearly
 * skips the first-month promo (the savings are in the annual
 * discount itself).
 */
export function getPlanPriceCents(
  planId: PaidPlanId,
  cycle: BillingCycle,
  currency: Currency,
  isFirstMonth: boolean,
): number {
  const plan = PLAN_CATALOGUE[planId];
  const pricing = currency === 'cny' ? plan.cny : plan.usd;
  if (cycle === 'yearly') return pricing.yearlyCents;
  if (isFirstMonth && pricing.firstMonthCents != null) return pricing.firstMonthCents;
  return pricing.monthlyCents;
}

/** USD cents → "$9.90". 0 cents → "$0". */
export function formatUsd(cents: number): string {
  if (cents === 0) return '$0';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? `$${whole}` : `$${whole}.${frac.toString().padStart(2, '0')}`;
}

/** CNY cents → "¥29" / "¥9.9" / "¥0". Drops trailing zero on the cent place. */
export function formatCny(cents: number): string {
  if (cents === 0) return '¥0';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (frac === 0) return `¥${whole}`;
  // ¥9.9 looks better than ¥9.90 in Chinese pricing convention
  if (frac % 10 === 0) return `¥${whole}.${Math.floor(frac / 10)}`;
  return `¥${whole}.${frac.toString().padStart(2, '0')}`;
}

export function formatPrice(cents: number, currency: Currency): string {
  return currency === 'cny' ? formatCny(cents) : formatUsd(cents);
}

/**
 * Yearly savings vs 12 × monthly, as a rounded percent. Used in the
 * "省 17%" badge on the yearly toggle. Recomputed from the catalogue
 * so a future price change keeps the badge honest.
 */
export function getYearlyDiscountPercent(planId: PaidPlanId, currency: Currency): number {
  const pricing = currency === 'cny' ? PLAN_CATALOGUE[planId].cny : PLAN_CATALOGUE[planId].usd;
  if (pricing.monthlyCents === 0) return 0;
  const twelveMonths = pricing.monthlyCents * 12;
  if (twelveMonths === 0) return 0;
  return Math.round(((twelveMonths - pricing.yearlyCents) / twelveMonths) * 100);
}
