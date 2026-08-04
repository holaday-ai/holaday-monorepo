import { describe, expect, it } from 'vitest';
import { orderImageAttachmentIds } from './image-input-order.js';

describe('orderImageAttachmentIds', () => {
  it('puts the selected locked subject first and keeps every reference once', () => {
    expect(
      orderImageAttachmentIds(
        ['file_style', 'file_subject', 'file_notes'],
        'lock_subject',
        'file_subject',
      ),
    ).toEqual(['file_subject', 'file_style', 'file_notes']);
  });

  it('keeps free-generation attachment order and multiplicity unchanged', () => {
    expect(
      orderImageAttachmentIds(
        ['file_style', 'file_subject', 'file_style'],
        'free',
        'file_subject',
      ),
    ).toEqual(['file_style', 'file_subject', 'file_style']);
  });

  it('rejects a selected subject that is not attached to the task', () => {
    expect(() =>
      orderImageAttachmentIds(
        ['file_style'],
        'lock_subject',
        'file_subject',
      ),
    ).toThrow('主角图不在本次任务附件中');
  });

  it('requires an explicit subject for locked-subject generation', () => {
    expect(() =>
      orderImageAttachmentIds(
        ['file_subject', 'file_style'],
        'lock_subject',
        undefined,
      ),
    ).toThrow('请选择一张主角图');
  });
});
