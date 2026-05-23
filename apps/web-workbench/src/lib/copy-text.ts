interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

interface CopyTextDeps {
  clipboard?: ClipboardLike | null;
  document?: Document | null;
}

export async function copyTextToClipboard(
  text: string,
  deps: CopyTextDeps = {},
): Promise<boolean> {
  const clipboard = deps.clipboard ?? globalThis.navigator?.clipboard ?? null;
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea path below. Clipboard writes can
      // fail when the browser loses focus or denies permission.
    }
  }

  return copyWithTextarea(text, deps.document ?? globalThis.document ?? null);
}

function copyWithTextarea(text: string, doc: Document | null): boolean {
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  doc.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
