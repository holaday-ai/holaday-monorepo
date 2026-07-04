import { describe, expect, it } from 'vitest';
import { staticTaskEvidenceRows } from './MainPanel';

describe('staticTaskEvidenceRows', () => {
  it('does not render empty evidence counters in the lazy-load fallback', () => {
    expect(
      staticTaskEvidenceRows({
        finalUrl: null,
        finalScreenshot: null,
        attachments: [],
      }),
    ).toEqual([]);
  });

  it('only renders evidence rows that were actually collected', () => {
    expect(
      staticTaskEvidenceRows({
        finalUrl: 'https://example.com/final',
        finalScreenshot: 'base64',
        attachments: [{ fileId: 'file_1' }, { fileId: 'file_2' }],
      }),
    ).toEqual([
      { label: '最终页面', value: '已记录' },
      { label: '最终截图', value: '已保存' },
      { label: '产物文件', value: '2 个' },
    ]);
  });
});
