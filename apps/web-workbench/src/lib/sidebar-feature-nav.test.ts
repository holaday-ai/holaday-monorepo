import { describe, expect, it } from 'vitest';
import { filterSidebarFeatureNavItems } from './sidebar-feature-nav';

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
});
