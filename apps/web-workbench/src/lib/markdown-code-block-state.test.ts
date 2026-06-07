import { describe, expect, it } from 'vitest';
import { markdownCodeBlockMeta } from './markdown-code-block-state';

describe('markdown code block state', () => {
  it('keeps explicit programming languages code-like', () => {
    expect(markdownCodeBlockMeta('language-ts', 'const answer = 42;')).toEqual({
      label: 'TypeScript',
      copyLabel: '代码',
      copiedToast: '已复制代码',
      codeLike: true,
      variant: 'code',
    });
    expect(markdownCodeBlockMeta('language-python', 'print(42)').label).toBe('PYTHON');
  });

  it('labels unlabeled business templates as content rather than code', () => {
    expect(
      markdownCodeBlockMeta(
        undefined,
        '目标：提高注册转化\n假设：首屏 CTA 不够明确\n指标：注册点击率',
      ),
    ).toEqual({
      label: '模板',
      copyLabel: '内容',
      copiedToast: '已复制内容',
      codeLike: false,
      variant: 'content',
    });
  });

  it('keeps ascii diagrams aligned while avoiding code copy', () => {
    expect(markdownCodeBlockMeta(undefined, '访问 -> 激活 -> 留存\n  |      |      |')).toEqual({
      label: '图示',
      copyLabel: '内容',
      copiedToast: '已复制内容',
      codeLike: true,
      variant: 'diagram',
    });
    expect(markdownCodeBlockMeta(undefined, '访客流量\n    ↓\n价值传递\n    ↓\n转化用户').label).toBe(
      '图示',
    );
  });

  it('treats explicit diagram languages as diagrams instead of code', () => {
    expect(markdownCodeBlockMeta('language-mermaid', 'flowchart TD\n  A --> B')).toEqual({
      label: '图示',
      copyLabel: '内容',
      copiedToast: '已复制内容',
      codeLike: true,
      variant: 'diagram',
    });
    expect(markdownCodeBlockMeta('language-flowchart', 'A -> B').copyLabel).toBe('内容');
  });

  it('falls back to a plain text block', () => {
    expect(markdownCodeBlockMeta(undefined, '这是一段需要保留换行的说明。')).toEqual({
      label: '文本块',
      copyLabel: '内容',
      copiedToast: '已复制内容',
      codeLike: false,
      variant: 'content',
    });
  });
});
