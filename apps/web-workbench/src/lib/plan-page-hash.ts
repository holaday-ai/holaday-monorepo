export const PLAN_ADDONS_HASH = '#addons';

export function shouldScrollPlanAddons(hash: string): boolean {
  return hash === PLAN_ADDONS_HASH;
}
