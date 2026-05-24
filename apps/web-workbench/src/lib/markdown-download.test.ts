import { describe, expect, it, vi } from 'vitest';
import {
  downloadMarkdownFile,
  markdownDownloadFilename,
} from './markdown-download';

describe('markdownDownloadFilename', () => {
  it('uses a safe markdown filename from the task id', () => {
    expect(markdownDownloadFilename('task_abc-123')).toBe('task_abc-123.md');
    expect(markdownDownloadFilename(' task / with : spaces ')).toBe(
      'task-with-spaces.md',
    );
  });

  it('falls back when the task id is empty or unsafe', () => {
    expect(markdownDownloadFilename()).toBe('holaday-task.md');
    expect(markdownDownloadFilename('   ')).toBe('holaday-task.md');
    expect(markdownDownloadFilename('@@@')).toBe('holaday-task.md');
  });
});

describe('downloadMarkdownFile', () => {
  it('creates and clicks a temporary markdown download link', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const revokeObjectURL = vi.fn();
    const schedule = vi.fn((fn: () => void) => {
      fn();
      return 1;
    });
    const anchor = {
      click,
      download: '',
      href: '',
      remove,
    } as unknown as HTMLAnchorElement;
    const doc = {
      body: { appendChild },
      createElement: vi.fn().mockReturnValue(anchor),
    } as unknown as Document;

    expect(
      downloadMarkdownFile('# Report', 'task/abc', {
        document: doc,
        setTimeout: schedule,
        url: {
          createObjectURL: vi.fn().mockReturnValue('blob:markdown'),
          revokeObjectURL,
        },
      }),
    ).toBe(true);

    expect(anchor.href).toBe('blob:markdown');
    expect(anchor.download).toBe('task-abc.md');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:markdown');
  });

  it('returns false when the document cannot host a download link', () => {
    expect(
      downloadMarkdownFile('x', 'task', {
        document: { body: null } as unknown as Document,
      }),
    ).toBe(false);
  });
});
