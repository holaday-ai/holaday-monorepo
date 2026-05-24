import { describe, expect, it } from 'vitest';
import {
  connectionAccessMailBody,
  connectionPageSummary,
  connectionProviderStatus,
  groupConnectionProviders,
  type ConnectionProviderLike,
} from './connection-page-state';

const providers: readonly ConnectionProviderLike[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'development',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'communication',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'productivity',
    oauthSupported: true,
    comingSoon: false,
  },
];

describe('connection page state helpers', () => {
  it('groups providers in product order with localized labels', () => {
    const groups = groupConnectionProviders(providers);

    expect(groups.map((group) => group.label)).toEqual([
      '效率工具',
      '沟通协作',
      '研发协作',
    ]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['google-calendar']);
  });

  it('describes provider rollout status', () => {
    expect(connectionProviderStatus(providers[0]!)).toBe('按需开通');
    expect(connectionProviderStatus(providers[2]!)).toBe('可连接');
    expect(
      connectionProviderStatus({
        id: 'slack',
        name: 'Slack',
        category: 'communication',
        oauthSupported: true,
        comingSoon: true,
      }),
    ).toBe('授权准备中');
  });

  it('summarizes loading, failed, empty, and populated connection states', () => {
    expect(connectionPageSummary({ count: 0, categoryCount: 0, loading: true, error: null })).toBe(
      '连接器加载中…',
    );
    expect(connectionPageSummary({ count: 0, categoryCount: 0, loading: false, error: 'down' })).toBe(
      '连接器加载失败',
    );
    expect(connectionPageSummary({ count: 0, categoryCount: 0, loading: false, error: null })).toBe(
      '暂无规划连接器',
    );
    expect(connectionPageSummary({ count: 10, categoryCount: 5, loading: false, error: null })).toBe(
      '已规划 10 个连接器 · 5 类工具',
    );
  });

  it('asks for the concrete provider and use case in the request body', () => {
    expect(connectionAccessMailBody('GitHub')).toContain('请协助开通 GitHub 连接器。');
    expect(connectionAccessMailBody('GitHub')).toContain('需要执行的典型操作：');
  });
});
