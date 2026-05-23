import { describe, expect, it } from 'vitest';
import { filesEmptyCopy } from './files-empty-copy';

describe('filesEmptyCopy', () => {
  it('distinguishes global empty library from search misses', () => {
    expect(filesEmptyCopy({ query: '', filter: 'all' })).toEqual({
      title: '还没有文件',
      body: '在任务输入框点 + 号上传文件，文件会出现在这里。',
    });
    expect(filesEmptyCopy({ query: 'report', filter: 'all' }).title).toBe(
      '没有匹配的文件',
    );
  });

  it('uses filter-specific empty copy when no query is active', () => {
    expect(filesEmptyCopy({ query: '', filter: 'images' }).title).toBe(
      '还没有图片',
    );
    expect(filesEmptyCopy({ query: '', filter: 'documents' }).title).toBe(
      '还没有文档',
    );
  });
});
