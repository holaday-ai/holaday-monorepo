/**
 * Add-on packs — one-time purchases that top up the current
 * billing period's quota without changing the plan tier.
 *
 * Two flavours:
 *   - Standard task packs: add to `bonus_tasks` on the active
 *     `task_quotas` row. Eligible for Basic + Pro.
 *   - Opus packs: also add to `bonus_opus`. Pro-only — Basic users
 *     don't have an Opus quota at all, so an Opus pack would be a
 *     dead purchase.
 *
 * Pricing follows the same per-currency convention as plans: USD
 * cents (PayPal today) and CNY cents (WeChat / Alipay in Phase 2).
 * The CNY column is informational until Phase 2 lands — PayPal still
 * settles in USD even when the UI displays ¥.
 */

export interface AddonPackDefinition {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly tasks: number;
  readonly opus: number;
  readonly priceUsdCents: number;
  readonly priceCnyCents: number;
  /** Plans allowed to buy this pack. */
  readonly availableTo: readonly ('basic' | 'pro')[];
}

export const ADDON_PACK_IDS = ['pack-20', 'pack-50', 'pack-50-opus'] as const;
export type AddonPackId = (typeof ADDON_PACK_IDS)[number];

export const ADDON_PACK_CATALOGUE: Readonly<Record<AddonPackId, AddonPackDefinition>> = {
  'pack-20': {
    id: 'pack-20',
    nameZh: '20 次加量包',
    nameEn: '20-task add-on',
    tasks: 20,
    opus: 0,
    priceUsdCents: 150,
    priceCnyCents: 990,
    availableTo: ['basic', 'pro'],
  },
  'pack-50': {
    id: 'pack-50',
    nameZh: '50 次加量包',
    nameEn: '50-task add-on',
    tasks: 50,
    opus: 0,
    priceUsdCents: 300,
    priceCnyCents: 1990,
    availableTo: ['basic', 'pro'],
  },
  'pack-50-opus': {
    id: 'pack-50-opus',
    nameZh: '50 + 5 次加量包（含 Opus）',
    nameEn: '50 + 5 Opus add-on',
    tasks: 50,
    opus: 5,
    priceUsdCents: 420,
    priceCnyCents: 2900,
    availableTo: ['pro'],
  },
} as const;

export function getAddonPackPriceCents(
  packId: AddonPackId,
  currency: 'usd' | 'cny',
): number {
  const def = ADDON_PACK_CATALOGUE[packId];
  return currency === 'cny' ? def.priceCnyCents : def.priceUsdCents;
}

export function isAddonPackId(value: string): value is AddonPackId {
  return (ADDON_PACK_IDS as readonly string[]).includes(value);
}
