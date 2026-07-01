import { getAccessToken } from '@/lib/auth';

/**
 * Shared authed file download / fetch helpers. Centralised so the
 * FileDownloadCard, ScreenshotThumbnailCard, and FilesPage all share
 * one bearer-token blob hop — and so we never hand a raw
 * `/api/files/:id/download` link to a top-level <a>, which the
 * browser refuses to authenticate.
 *
 * `downloadFileAuthed` triggers a save-to-disk via an anchor click.
 * `fetchFileBlobAuthed` returns the blob + the assumed MIME so the
 * preview modal can show an inline image / iframe / fallback.
 */

export interface DownloadResult {
  ok: boolean;
  /** HTTP status when the response made it back; null on network err. */
  status: number | null;
  /** Free-form diagnostic; not user-facing copy. */
  message: string;
}

export function safeDownloadFilename(filename: string): string {
  const trimmed = filename.trim();
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.-]+|-+$/g, '')
    .slice(0, 180);
  return cleaned || 'holaday-file';
}

interface BaseInput {
  /** Relative or absolute URL for the file (e.g. `/api/files/:id/download`). */
  url: string;
  /** Filename used for the download attribute. */
  filename: string;
}

/**
 * Authed fetch → blob → anchor click → revoke. Resolves with an
 * `ok: true` on success or a status/message tuple on failure so the
 * caller can craft a context-specific toast.
 */
export async function downloadFileAuthed(
  input: BaseInput,
): Promise<DownloadResult> {
  const token = getAccessToken();
  try {
    const res = await fetch(input.url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `HTTP ${res.status}`,
      };
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = safeDownloadFilename(input.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after a tick so the browser can finish piping the
    // blob through to the OS-level save dialog.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
    return { ok: true, status: res.status, message: 'ok' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[downloadFileAuthed] failed', err);
    return {
      ok: false,
      status: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface FetchBlobResult {
  ok: boolean;
  blob?: Blob;
  /** Server's Content-Type when available; the blob.type is a fallback. */
  mime?: string;
  status: number | null;
  message: string;
}

/**
 * Authed fetch → blob. No anchor click. Used by the in-product
 * preview modal to render the response inline (image / pdf / etc.).
 * Caller is responsible for revoking the object URL it builds from
 * the blob.
 */
export async function fetchFileBlobAuthed(
  input: { url: string },
): Promise<FetchBlobResult> {
  const token = getAccessToken();
  try {
    const res = await fetch(input.url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `HTTP ${res.status}`,
      };
    }
    const blob = await res.blob();
    const mime = res.headers.get('content-type') ?? blob.type ?? '';
    return { ok: true, blob, mime, status: res.status, message: 'ok' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[fetchFileBlobAuthed] failed', err);
    return {
      ok: false,
      status: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取图片预览'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片预览'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Map a DownloadResult / FetchBlobResult status to user-facing copy.
 * Centralised so 401 / 404 / 410 all say the same thing across
 * download cards, the files page, and the preview modal.
 */
export function downloadFailureMessage(status: number | null): string {
  if (status === 401 || status === 403) {
    return '下载失败，请刷新页面后重试。';
  }
  if (status === 404 || status === 410) {
    return '链接已过期，产出文件保留 24 小时。';
  }
  return '下载失败，或链接已过期。';
}
