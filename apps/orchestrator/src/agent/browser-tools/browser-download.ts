import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Download } from 'playwright';
import { MAX_DOWNLOAD_BYTES } from '../../files/download-manager.js';
import type { BrowserDownloadReceipt } from './playwright-unified-executor.js';

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
