export interface SidebarFeatureNavItem {
  label: string;
  href?: string;
}

export interface SidebarFeatureNavFlags {
  cosmicEnabled: boolean;
  partnerEnabled?: boolean;
}

export function filterSidebarFeatureNavItems<T extends SidebarFeatureNavItem>(
  items: readonly T[],
  flags: SidebarFeatureNavFlags,
): T[] {
  return items.filter((item) => {
    if (item.href === '/cosmic') return flags.cosmicEnabled;
    if (item.href === '/partner') return flags.partnerEnabled === true;
    return true;
  });
}

export function isPartnerNavEnabled(): boolean {
  return import.meta.env.VITE_PARTNER_LEDGER_NAV_ENABLED === 'true';
}
