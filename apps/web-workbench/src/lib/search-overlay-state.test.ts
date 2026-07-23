import { describe, expect, it } from 'vitest';
import {
  nextSearchActiveIndex,
  normalizeSearchOverlayRows,
  searchOverlayCanRetry,
  searchOverlayNeedsAttention,
  searchOverlayRowCopy,
  searchOverlayRowTone,
  searchOverlayStatusTone,
  searchOverlayErrorMessage,
  searchOverlayStatusCopy,
} from './search-overlay-state';

describe('searchOverlayRowTone — P2-B resting tone', () => {
  it('failed → subtle red left border', () => {
    expect(searchOverlayRowTone('failed')).toContain('rgba(234,31,89');
  });
  it('partial_success → subtle amber left border', () => {
    expect(searchOverlayRowTone('partial_success')).toContain('rgba(255,201,16');
  });
  it('cancelled → faint gray left border', () => {
    expect(searchOverlayRowTone('cancelled')).toContain('rgba(89,87,87');
  });
  it('completed / awaiting_user / running → neutral (empty)', () => {
    expect(searchOverlayRowTone('completed')).toBe('');
    expect(searchOverlayRowTone('awaiting_user')).toBe('');
    expect(searchOverlayRowTone('executing')).toBe('');
    expect(searchOverlayRowTone({ status: 'executing', awaitingKind: 'login' })).toBe('');
  });

  it('uses awaiting badge tone when awaitingKind arrives before status flips', () => {
    expect(searchOverlayStatusTone({ status: 'executing', awaitingKind: 'login' })).toContain(
      '#FFC910',
    );
    expect(searchOverlayStatusTone('executing')).toContain('#57479C');
    expect(searchOverlayStatusTone('paused')).toContain('#EFEFEF');
    expect(searchOverlayStatusTone('unknown')).toContain('#EFEFEF');
  });
});

describe('search overlay state helpers', () => {
  it('keeps keyboard active index in range', () => {
    expect(nextSearchActiveIndex({ current: 0, direction: 'down', count: 0 })).toBe(0);
    expect(nextSearchActiveIndex({ current: -1, direction: 'down', count: 3 })).toBe(0);
    expect(nextSearchActiveIndex({ current: 2, direction: 'down', count: 3 })).toBe(2);
    expect(nextSearchActiveIndex({ current: 4, direction: 'up', count: 3 })).toBe(1);
    expect(nextSearchActiveIndex({ current: 0, direction: 'up', count: 3 })).toBe(0);
  });

  it('distinguishes hard search failures from stale result failures', () => {
    expect(
      searchOverlayStatusCopy({
        query: '日报',
        searching: false,
        error: 'offline',
        resultCount: 0,
      }),
    ).toEqual({
      title: '搜索失败',
      body: 'offline',
      retry: true,
    });

    expect(
      searchOverlayStatusCopy({
        query: '日报',
        searching: false,
        error: 'offline',
        resultCount: 2,
      })?.title,
    ).toBe('搜索失败，正在显示上次结果');
  });

  it('blocks search retry while a request is still in flight', () => {
    expect(searchOverlayCanRetry(false)).toBe(true);
    expect(searchOverlayCanRetry(true)).toBe(false);
  });

  it('normalizes unknown search errors', () => {
    expect(searchOverlayErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(searchOverlayErrorMessage('搜索词不能为空')).toBe('搜索词不能为空');
    expect(searchOverlayErrorMessage({})).toBe('搜索暂时不可用，请稍后重试。');
  });

  it('normalizes server search rows before rendering', () => {
    expect(
      normalizeSearchOverlayRows([
        null,
        { taskId: '', intent: 'missing id' },
        {
          taskId: ' tsk_1 ',
          intent: '  Weekly report  ',
          title: '  Report title  ',
          status: 'completed',
          awaitingKind: 'video_quote',
        },
        {
          taskId: 'tsk_2',
          intent: { unsafe: true },
          title: { unsafe: true },
          status: 'mystery',
          awaitingKind: 'mystery',
        },
      ]),
    ).toEqual([
      {
        taskId: 'tsk_1',
        intent: 'Weekly report',
        title: 'Report title',
        status: 'completed',
        awaitingKind: 'video_quote',
      },
      {
        taskId: 'tsk_2',
        intent: '未命名任务',
        title: null,
        status: 'mystery',
        awaitingKind: null,
      },
    ]);
  });

  it('treats malformed search row collections as empty', () => {
    expect(normalizeSearchOverlayRows({ tasks: [] })).toEqual([]);
    expect(normalizeSearchOverlayRows('bad')).toEqual([]);
  });

  it('keeps action-needed status visible in mobile search rows', () => {
    expect(searchOverlayNeedsAttention('awaiting_user')).toBe(true);
    expect(searchOverlayNeedsAttention('executing')).toBe(false);
    expect(searchOverlayNeedsAttention({ status: 'executing', awaitingKind: 'login' })).toBe(
      true,
    );

    expect(
      searchOverlayRowCopy({
        intent: '登录航空公司查看订单',
        title: '机票订单',
        status: 'awaiting_user',
        awaitingKind: 'login',
      }),
    ).toEqual({
      title: '机票订单',
      secondary: '登录航空公司查看订单',
    });

    expect(
      searchOverlayRowCopy({
        intent: '补充预算',
        title: null,
        status: 'awaiting_user',
        awaitingKind: 'clarification',
      }),
    ).toEqual({
      title: '补充预算',
      secondary: '',
    });
  });

  it('does not repeat terminal status when the badge already shows it', () => {
    expect(
      searchOverlayRowCopy({
        intent: '打开 example.com',
        title: null,
        status: 'completed',
        awaitingKind: null,
      }),
    ).toEqual({
      title: '打开 example.com',
      secondary: '',
    });

    expect(
      searchOverlayRowCopy({
        intent: '原始任务描述',
        title: '整理好的标题',
        status: 'failed',
        awaitingKind: null,
      }),
    ).toEqual({
      title: '整理好的标题',
      secondary: '原始任务描述',
    });
  });

  it('shows only the user prompt for image tasks with internal routing copy', () => {
    const intent = [
      '生成图片：让同一只西高地坐在海边。',
      '图片风格要求：电影感、柔和逆光。',
      '主体一致性要求：请以用户上传的第一张图片作为锁定主角。',
    ].join('\n\n');

    expect(
      searchOverlayRowCopy({
        intent,
        title: '主体一致性要求：请以用户上传的第一张图片作为锁定主角。',
        status: 'completed',
        awaitingKind: null,
      }),
    ).toEqual({
      title: '让同一只西高地坐在海边。',
      secondary: '',
    });

    expect(
      searchOverlayRowCopy({
        intent,
        title: '夏日活动主视觉',
        status: 'completed',
        awaitingKind: null,
      }),
    ).toEqual({
      title: '夏日活动主视觉',
      secondary: '让同一只西高地坐在海边。',
    });
  });

  it('preserves unknown string statuses so search results do not fake queued state', () => {
    expect(
      normalizeSearchOverlayRows([
        {
          taskId: 'tsk_new_status',
          intent: 'new lifecycle',
          status: 'archived',
          awaitingKind: null,
        },
      ])[0]?.status,
    ).toBe('archived');
  });
});
