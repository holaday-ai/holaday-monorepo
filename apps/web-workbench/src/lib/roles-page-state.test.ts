import { describe, expect, it } from 'vitest';
import type { RoleDefinition } from '@holaday/shared-types';
import {
  groupRoleCatalogue,
  normalizeRoleListResponse,
  normalizeRoleSelectResponse,
  roleLimitMessage,
  rolePageSummary,
  rolePlanLabel,
  roleRemainingChanges,
} from './roles-page-state';

const roles = [
  {
    id: 'support',
    nameZh: '客服',
    nameEn: 'Support',
    descriptionZh: '处理客户问题',
    descriptionEn: 'Handle support issues',
    category: 'support',
    tier: 'open',
  },
  {
    id: 'marketing',
    nameZh: '内容营销',
    nameEn: 'Marketing',
    descriptionZh: '规划内容活动',
    descriptionEn: 'Plan campaigns',
    category: 'marketing',
    tier: 'open',
  },
] satisfies readonly RoleDefinition[];

describe('roles page state helpers', () => {
  it('groups the role catalogue in product order', () => {
    const groups = groupRoleCatalogue(roles);

    expect(groups.map((group) => group.nameZh)).toEqual(['营销 & 内容', '支持 & 合规']);
    expect(groups[0]?.items.map((role) => role.id)).toEqual(['marketing']);
  });

  it('labels role plans', () => {
    expect(rolePlanLabel('free')).toBe('体验版');
    expect(rolePlanLabel('basic')).toBe('基础版');
    expect(rolePlanLabel('pro')).toBe('专业版');
    expect(rolePlanLabel('enterprise')).toBe('当前套餐');
  });

  it('summarizes loading, failed, free, basic, pro, and empty states', () => {
    expect(
      rolePageSummary({
        loading: true,
        error: null,
        plan: 'basic',
        selectedCount: 0,
        totalCount: 0,
      }),
    ).toBe('角色加载中…');
    expect(
      rolePageSummary({
        loading: false,
        error: 'offline',
        plan: 'basic',
        selectedCount: 0,
        totalCount: 0,
      }),
    ).toBe('角色加载失败');
    expect(
      rolePageSummary({
        loading: false,
        error: null,
        plan: 'basic',
        selectedCount: 0,
        totalCount: 0,
      }),
    ).toBe('暂无可用角色');
    expect(
      rolePageSummary({
        loading: false,
        error: null,
        plan: 'basic',
        selectedCount: 2,
        totalCount: 33,
        pickLimit: 5,
      }),
    ).toBe('已选 2 / 5 · 基础版');
    expect(
      rolePageSummary({
        loading: false,
        error: null,
        plan: 'pro',
        selectedCount: 0,
        totalCount: 33,
      }),
    ).toBe('全部 33 个角色 · 专业版');
    expect(
      rolePageSummary({
        loading: false,
        error: null,
        plan: 'free',
        selectedCount: 0,
        totalCount: 33,
      }),
    ).toBe('解锁 33 个角色 · 体验版');
  });

  it('keeps remaining monthly changes non-negative', () => {
    expect(roleRemainingChanges(1, 3)).toBe(2);
    expect(roleRemainingChanges(4, 3)).toBe(0);
  });

  it('describes the basic pick limit', () => {
    expect(roleLimitMessage(5)).toBe('最多选择 5 个角色');
  });

  it('normalizes role list payloads before rendering', () => {
    const snapshot = normalizeRoleListResponse({
      plan: 'basic',
      selected: [' support ', 'missing', 'support', 123],
      catalogue: [
        roles[0],
        {
          id: ' loose ',
          nameZh: '',
          nameEn: '',
          descriptionZh: 123,
          descriptionEn: null,
          tier: 'bad',
          category: 'bad',
        },
        { id: '', nameZh: 'empty' },
      ],
      pickLimit: 4.9,
      changesThisMonth: 1.8,
      changesLimit: -1,
    });

    expect(snapshot).toEqual({
      plan: 'basic',
      selected: ['support'],
      catalogue: [
        roles[0],
        {
          id: 'loose',
          nameZh: 'loose',
          nameEn: 'loose',
          descriptionZh: '',
          descriptionEn: '',
          tier: 'open',
          category: 'specialty',
        },
      ],
      pickLimit: 4,
      changesThisMonth: 1,
      changesLimit: 3,
      overLimit: false,
      needsRoleRepair: true,
    });
  });

  it('uses safe defaults for malformed role list payloads', () => {
    expect(normalizeRoleListResponse(null)).toEqual({
      plan: 'free',
      selected: [],
      catalogue: [],
      pickLimit: 5,
      changesThisMonth: 0,
      changesLimit: 3,
      overLimit: false,
      needsRoleRepair: false,
    });
  });

  it('normalizes role select responses with a fallback snapshot', () => {
    expect(
      normalizeRoleSelectResponse(
        { selected: [' a ', 'a', 'b'], changesThisMonth: 2.9 },
        { selected: ['fallback'], changesThisMonth: 1, changesLimit: 3 },
      ),
    ).toEqual({
      selected: ['a', 'b'],
      changesThisMonth: 2,
      changesLimit: 3,
    });

    expect(
      normalizeRoleSelectResponse(null, {
        selected: ['fallback'],
        changesThisMonth: 1,
        changesLimit: 3,
      }),
    ).toEqual({
      selected: ['fallback'],
      changesThisMonth: 1,
      changesLimit: 3,
    });
  });
});
