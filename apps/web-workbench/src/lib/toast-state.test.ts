import { describe, expect, it } from 'vitest';
import { enqueueToastItem, type ToastItem } from './toast-state.js';

function toast(id: number, text: string, kind: ToastItem['kind'] = 'info'): ToastItem {
  return { id, text, kind };
}

describe('toast-state', () => {
  it('keeps the newest toast at the end of the stack', () => {
    expect(enqueueToastItem([toast(1, '已保存')], toast(2, '已复制'))).toEqual([
      toast(1, '已保存'),
      toast(2, '已复制'),
    ]);
  });

  it('dedupes repeated messages by text and kind', () => {
    expect(
      enqueueToastItem(
        [toast(1, '网络已恢复'), toast(2, '提交失败', 'error')],
        toast(3, '提交失败', 'error'),
      ),
    ).toEqual([toast(1, '网络已恢复'), toast(3, '提交失败', 'error')]);
  });

  it('keeps different tones for the same text distinct', () => {
    expect(enqueueToastItem([toast(1, '连接状态', 'info')], toast(2, '连接状态', 'error'))).toEqual([
      toast(1, '连接状态', 'info'),
      toast(2, '连接状态', 'error'),
    ]);
  });

  it('caps the stack to the most recent items', () => {
    expect(
      enqueueToastItem(
        [toast(1, 'one'), toast(2, 'two'), toast(3, 'three')],
        toast(4, 'four'),
      ),
    ).toEqual([toast(2, 'two'), toast(3, 'three'), toast(4, 'four')]);
  });
});
