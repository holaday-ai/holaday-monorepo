import { describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard, hasCopyableText } from './copy-text';

describe('hasCopyableText', () => {
  it('treats empty / whitespace / nullish values as not copyable', () => {
    expect(hasCopyableText('hello')).toBe(true);
    expect(hasCopyableText('  x  ')).toBe(true);
    expect(hasCopyableText('')).toBe(false);
    expect(hasCopyableText('   \n\t ')).toBe(false);
    expect(hasCopyableText(null)).toBe(false);
    expect(hasCopyableText(undefined)).toBe(false);
  });
});

describe('copyTextToClipboard', () => {
  it('uses navigator clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      copyTextToClipboard('hello', {
        clipboard: { writeText },
        document: null,
      }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a temporary textarea when clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const doc = fakeCopyDocument(true);

    await expect(
      copyTextToClipboard('fallback text', {
        clipboard: { writeText },
        document: doc.document,
      }),
    ).resolves.toBe(true);

    expect(doc.textarea.value).toBe('fallback text');
    expect(doc.appendChild).toHaveBeenCalledWith(doc.textarea);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(doc.remove).toHaveBeenCalled();
  });

  it('returns false when both clipboard and fallback copy fail', async () => {
    const doc = fakeCopyDocument(false);

    await expect(
      copyTextToClipboard('nope', {
        clipboard: null,
        document: doc.document,
      }),
    ).resolves.toBe(false);
  });
});

function fakeCopyDocument(copyResult: boolean): {
  appendChild: ReturnType<typeof vi.fn>;
  document: Document;
  execCommand: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  textarea: HTMLTextAreaElement;
} {
  const remove = vi.fn();
  const textarea = {
    focus: vi.fn(),
    remove,
    select: vi.fn(),
    setAttribute: vi.fn(),
    style: {},
    value: '',
  } as unknown as HTMLTextAreaElement;
  const appendChild = vi.fn();
  const execCommand = vi.fn().mockReturnValue(copyResult);
  const document = {
    body: { appendChild },
    createElement: vi.fn().mockReturnValue(textarea),
    execCommand,
  } as unknown as Document;

  return { appendChild, document, execCommand, remove, textarea };
}
