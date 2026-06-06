import { describe, expect, it } from 'vitest';
import {
  connectionAccessMailBody,
  connectionLoadErrorCopy,
  connectionPageSummary,
  connectionProviderActionLabel,
  connectionProviderStatus,
  groupConnectionProviders,
  normalizeConnectionProviders,
  safeConnectionCount,
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

  it('labels provider request actions by rollout state', () => {
    expect(connectionProviderActionLabel(providers[0]!)).toBe('申请接入');
    expect(connectionProviderActionLabel(providers[2]!)).toBe('申请连接');
    expect(
      connectionProviderActionLabel({
        id: 'slack',
        name: 'Slack',
        category: 'communication',
        oauthSupported: true,
        comingSoon: true,
      }),
    ).toBe('申请试用');
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
    expect(
      connectionPageSummary({
        count: Number.NaN,
        categoryCount: Number.POSITIVE_INFINITY,
        loading: false,
        error: null,
      }),
    ).toBe('暂无规划连接器');
  });

  it('asks for the concrete provider and use case in the request body', () => {
    expect(connectionAccessMailBody('GitHub')).toContain('请协助开通 GitHub 连接器。');
    expect(connectionAccessMailBody('GitHub')).toContain('需要执行的典型操作：');
  });

  it('formats connection load errors for user-facing surfaces', () => {
    expect(connectionLoadErrorCopy('  offline  ')).toEqual({
      title: '连接器暂时无法加载',
      body: 'offline',
    });
    expect(connectionLoadErrorCopy(undefined)).toEqual({
      title: '连接器暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开连接器。',
    });
  });

  it('normalizes malformed connection provider responses', () => {
    const rows = normalizeConnectionProviders([
      {
        id: ' github ',
        name: ' GitHub ',
        category: 'development',
        oauthSupported: true,
        comingSoon: false,
        icon: 'Github',
        description: '  Code hosting  ',
      },
      {
        id: ' github ',
        name: 'Duplicate GitHub',
        category: 'development',
        oauthSupported: false,
        comingSoon: true,
      },
      {
        id: 'bad-category',
        name: 'Bad Category',
        category: 'unknown',
      },
      {
        id: 'bad-name',
        name: { unsafe: true },
        category: 'productivity',
      },
      null,
    ]);

    expect(rows).toEqual([
      {
        id: 'github',
        name: 'GitHub',
        category: 'development',
        oauthSupported: true,
        comingSoon: false,
        icon: 'Github',
        description: 'Code hosting',
      },
    ]);
  });

  it('uses safe fallbacks for optional provider fields', () => {
    expect(
      normalizeConnectionProviders([
        {
          id: 'custom',
          name: 'Custom App',
          category: 'productivity',
        },
      ]),
    ).toEqual([
      {
        id: 'custom',
        name: 'Custom App',
        category: 'productivity',
        oauthSupported: false,
        comingSoon: true,
        icon: 'Plug',
        description: '暂未提供说明。',
      },
    ]);
  });

  it('rejects non-array provider payloads and sanitizes counts', () => {
    expect(() => normalizeConnectionProviders({ providers: [] })).toThrow(
      '连接器列表暂时无法读取，请刷新后重试。',
    );
    expect(safeConnectionCount(Number.NaN)).toBe(0);
    expect(safeConnectionCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeConnectionCount('3')).toBe(0);
    expect(safeConnectionCount(-1)).toBe(0);
    expect(safeConnectionCount(3.9)).toBe(3);
  });
});
