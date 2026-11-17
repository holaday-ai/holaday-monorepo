import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { browserDownloadMetadataSchema, browserDownloadSourceSchema } from '@holaday/shared-types';
import type { Download } from 'playwright';
import { MAX_DOWNLOAD_BYTES } from '../../files/download-manager.js';
import type { SelectedChromeDownloadFile } from '../supercar/selected-chrome-client.js';
import type { BrowserDownloadReceipt } from './playwright-unified-executor.js';

/** One physical download has one persistence owner, even when a task also awaits its event. */
const ownedDownloads = new WeakMap<
  Download,
  { owner: object; promise: Promise<BrowserDownloadReceipt> }
>();
const TASK_DOWNLOAD = Symbol('saved-owned-task-download');
type TaskDownloadSource = Readonly<{
  taskId: string;
  origin: string;
  originBasis: 'download_url' | 'owning_page';
}>;
/** An opaque receipt from the actual Download path, never a client file-ID grant. */
export function taskBrowserDownloadSource(
  receipt: BrowserDownloadReceipt,
  taskId: string,
): TaskDownloadSource | null {
  const source = (receipt as BrowserDownloadReceipt & { [TASK_DOWNLOAD]?: TaskDownloadSource })[
    TASK_DOWNLOAD
  ];
  return source?.taskId === taskId ? source : null;
}

/** Trusted server port only: bytes already read from one authenticated task's
 * native source, never a model-supplied address, file ID, or synthetic Page. */
export async function persistTransferredTaskBrowserDownload(
  file: SelectedChromeDownloadFile,
  options: {
    taskId: string;
    current(): Promise<boolean>;
    store(input: {
      filename: string;
      buffer: Buffer;
      sha256: string;
      mimetype?: string;
    }): Promise<BrowserDownloadReceipt>;
  },
): Promise<BrowserDownloadReceipt> {
  const metadata = browserDownloadMetadataSchema.parse(file.metadata);
  const source = browserDownloadSourceSchema.parse(file.source);
  if (
    !options.taskId ||
    !(file.buffer instanceof Uint8Array) ||
    file.buffer.length !== metadata.sizeBytes ||
    createHash('sha256').update(file.buffer).digest('hex') !== metadata.sha256 ||
    !(await options.current())
  )
    throw new Error('download_unavailable');
  // Exactly one write. An absent/invalid write receipt never retries the click
  // or storage; the caller retains an unknown result for reconciliation.
  const receipt = await options.store({
    filename: metadata.filename,
    buffer: file.buffer,
    sha256: metadata.sha256,
    mimetype: metadata.mimeType,
  });
  if (
    !receipt.fileId ||
    receipt.filename !== metadata.filename ||
    receipt.sizeBytes !== metadata.sizeBytes ||
    receipt.sha256 !== metadata.sha256 ||
    receipt.mimetype !== metadata.mimeType ||
    receipt.downloadUrl !== `/api/files/${receipt.fileId}/download` ||
    !receipt.expiresAt ||
    !Number.isFinite(Date.parse(receipt.expiresAt)) ||
    !(await options.current())
  )
    throw new Error('download_receipt_unconfirmed');
  return Object.freeze({
    ...receipt,
    [TASK_DOWNLOAD]: Object.freeze({
      taskId: options.taskId,
      origin: source.origin,
      originBasis: source.originBasis,
    }),
  });
}
export function sharedBrowserDownload(
  download: Download,
  owner: object,
): Promise<BrowserDownloadReceipt> | null {
  const saved = ownedDownloads.get(download);
  if (!saved) return null;
  if (saved.owner !== owner) throw new Error('download_owner_changed');
  return saved.promise;
}
export function ownBrowserDownload(
  download: Download,
  owner: object,
  save: () => Promise<BrowserDownloadReceipt>,
): Promise<BrowserDownloadReceipt> {
  const current = sharedBrowserDownload(download, owner);
  if (current) return current;
  const promise = Promise.resolve().then(save);
  ownedDownloads.set(download, { owner, promise });
  return promise;
}

/** A shared Home save still publishes the result to the task's normal attachment path. */
export async function persistTaskBrowserDownload(
  download: Download,
  owner: object,
  store: Parameters<typeof persistBrowserDownload>[1],
  publish?: (receipt: BrowserDownloadReceipt) => void | Promise<void>,
  taskId?: string,
): Promise<BrowserDownloadReceipt> {
  // Capture at the actual Download, before storage I/O or a later navigation.
  let taskSource: TaskDownloadSource | null = null;
  if (taskId) {
    try {
      const url = new URL(download.url());
      let origin = url.origin;
      let originBasis: TaskDownloadSource['originBasis'] = 'download_url';
      if (origin === 'null' && ['data:', 'blob:'].includes(url.protocol)) {
        origin = new URL(download.page().url()).origin;
        originBasis = 'owning_page';
      }
      if (/^https?:\/\//.test(origin)) taskSource = Object.freeze({ taskId, origin, originBasis });
    } catch {
      /* Unavailable sources must not grant file-reading authority. */
    }
  }
  const receipt = await (sharedBrowserDownload(download, owner) ??
    persistBrowserDownload(download, store));
  await publish?.(receipt);
  if (taskId) {
    if (!taskSource) throw new Error('download_source_unavailable');
    return Object.freeze({ ...receipt, [TASK_DOWNLOAD]: taskSource });
  }
  return receipt;
}

export async function persistBrowserDownload(
  download: Download,
  store: (input: {
    filename: string;
    buffer: Buffer;
    sha256: string;
  }) => Promise<BrowserDownloadReceipt>,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<BrowserDownloadReceipt> {
  const directory = await mkdtemp(join(tmpdir(), 'holaday-download-'));
  try {
    const source = await download.createReadStream();
    if (!source) throw new Error('download_unreadable');
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of source) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) {
          await download.cancel();
          throw new Error('download_too_large');
        }
        chunks.push(bytes);
      }
    } finally {
      source.destroy();
    }
    if (await download.failure()) throw new Error('download_failed');
    const buffer = Buffer.concat(chunks);
    const filename =
      basename(download.suggestedFilename())
        .split('')
        .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
        .join('') || 'download.bin';
    const path = join(directory, 'payload');
    await writeFile(path, buffer, { mode: 0o600, flag: 'wx' });
    const saved = await readFile(path);
    const sha256 = createHash('sha256').update(saved).digest('hex');
    const receipt = await store({ filename, buffer: saved, sha256 });
    if (
      !receipt.fileId ||
      !receipt.downloadUrl ||
      receipt.sizeBytes !== size ||
      receipt.sha256 !== sha256
    )
      throw new Error('download_receipt_mismatch');
    return receipt;
  } finally {
    await download.delete().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
