import { getAccessToken } from '@/lib/auth';
import { pageErrorMessage } from '@/lib/page-error-copy';

export interface UploadedFileMeta {
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
}

export interface UploadError {
  status: number;
  message: string;
  /** Server's error code (e.g. 'plan_does_not_allow_uploads', 'file_too_large'). */
  code?: string;
}

/**
 * POST a file to the orchestrator's /api/files/upload endpoint and
 * return the server-issued file id. Throws an UploadError-shaped
 * object on non-2xx so the caller can render the right copy
 * (free-plan upsell vs. file-too-large vs. unsupported type).
 */
export async function uploadFile(file: File): Promise<UploadedFileMeta> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const token = getAccessToken();
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      // Server returned non-JSON (probably nginx 413).
    }
    const err: UploadError = {
      status: res.status,
      message:
        body.message ??
        (res.status === 413
          ? '文件超过大小限制'
          : res.status === 415
            ? '不支持的文件类型'
            : res.status === 403
              ? '当前套餐不支持文件上传'
              : '上传失败'),
      ...(body.error ? { code: body.error } : {}),
    };
    throw err;
  }
  const json = (await res.json()) as UploadedFileMeta;
  return json;
}

export function isUploadError(e: unknown): e is UploadError {
  return typeof e === 'object' && e !== null && 'status' in e && 'message' in e;
}

export function uploadFailureMessage(err: unknown): string {
  if (!isUploadError(err)) return pageErrorMessage(err, '上传失败，请稍后重试。');

  if (err.code === 'plan_does_not_allow_uploads' || err.status === 403) {
    return '当前套餐不支持文件上传，升级后即可使用。';
  }
  if (err.code === 'file_too_large' || err.status === 413) {
    return '文件超过大小限制，请换一个更小的文件。';
  }
  if (err.status === 415) {
    return '不支持的文件类型，请换一个文件。';
  }

  return pageErrorMessage(err.message, '上传失败，请稍后重试。');
}
