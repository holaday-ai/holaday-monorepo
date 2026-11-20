export interface SidebarFeatureNavItem {
  label: string;
  href?: string;
  preload?: () => void;
}

export interface SidebarFeatureNavFlags {
  cosmicEnabled: boolean;
  /** HIDE-1: 股市任务 (default hidden). */
  ashareEnabled?: boolean;
  partnerEnabled?: boolean;
  /** BROWSER-HOME-1: 云浏览器 (server flag via auth.me.browserHomeEnabled; default hidden). */
  browserHomeEnabled?: boolean;
}

export function filterSidebarFeatureNavItems<T extends SidebarFeatureNavItem>(
  items: readonly T[],
  flags: SidebarFeatureNavFlags,
): T[] {
  return items.filter((item) => {
    if (item.href === '/cosmic') return flags.cosmicEnabled;
    if (item.href === '/stocks') return flags.ashareEnabled === true;
    if (item.href === '/partner') return flags.partnerEnabled === true;
    if (item.href === '/browser') return flags.browserHomeEnabled === true;
    return true;
  });
}

export function preloadSidebarFeatureNavItem(item: SidebarFeatureNavItem): void {
  item.preload?.();
}

export function isPartnerNavEnabled(): boolean {
  return import.meta.env.VITE_PARTNER_LEDGER_NAV_ENABLED === 'true';
}
