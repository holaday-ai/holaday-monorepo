import { describe, expect, it } from 'vitest';
import { statusLabel } from './SearchOverlay';

describe('SearchOverlay statusLabel', () => {
  it('renders every task status with a visible label', () => {
    expect(statusLabel('queued')).toBe('排队中');
    expect(statusLabel('executing')).toBe('执行中');
    expect(statusLabel('awaiting_user')).toBe('等待你回复');
    expect(statusLabel('paused')).toBe('已暂停');
    expect(statusLabel('completed')).toBe('已完成');
    expect(statusLabel('partial_success')).toBe('部分完成');
    expect(statusLabel('failed')).toBe('失败');
    expect(statusLabel('cancelled')).toBe('已取消');
  });
});
