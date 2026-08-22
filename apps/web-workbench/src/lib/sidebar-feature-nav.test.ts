import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  filterSidebarFeatureNavItems,
  preloadSidebarFeatureNavItem,
} from './sidebar-feature-nav';

const FEATURES = [
  { label: '专家技能', href: '/skills' },
  { label: '合伙人计划', href: '/partner' },
  { label: '今日能量', href: '/cosmic' },
  { label: '文件库', href: '/files' },
] as const;

describe('filterSidebarFeatureNavItems', () => {
  it('hides partner navigation by default for dark launch', () => {
    expect(filterSidebarFeatureNavItems(FEATURES, { cosmicEnabled: true }).map((item) => item.href)).toEqual([
      '/skills',
      '/cosmic',
      '/files',
    ]);
  });

  it('shows partner navigation only when explicitly enabled', () => {
    expect(
      filterSidebarFeatureNavItems(FEATURES, {
        cosmicEnabled: true,
        partnerEnabled: true,
      }).map((item) => item.href),
    ).toContain('/partner');
  });

  it('keeps the existing cosmic feature flag behavior', () => {
    expect(
      filterSidebarFeatureNavItems(FEATURES, {
        cosmicEnabled: false,
        partnerEnabled: true,
      }).map((item) => item.href),
    ).toEqual(['/skills', '/partner', '/files']);
  });

  it('runs an optional feature preload for pointer or focus intent', () => {
    const preload = vi.fn();

    preloadSidebarFeatureNavItem({ label: '股市任务', href: '/stocks', preload });
    preloadSidebarFeatureNavItem({ label: '文件库', href: '/files' });

    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('wires stock module preload to pointer and keyboard intent without replacing navigation', () => {
    const sidebarSource = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8');

    expect(sidebarSource).toContain('void preloadStockTasksPageRoute()');
    expect(sidebarSource).toContain('onPointerEnter={() => preloadSidebarFeatureNavItem(item)}');
    expect(sidebarSource).toContain('onFocus={() => preloadSidebarFeatureNavItem(item)}');
    expect(sidebarSource).toContain('onClick={() => navigate(href)}');
  });
});
