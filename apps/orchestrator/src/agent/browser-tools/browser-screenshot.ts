import { createHash } from 'node:crypto';
import { type TaskScreenshot, taskScreenshotSchema } from '@holaday/shared-types';
import type { BrowserDownloadReceipt } from './playwright-unified-executor.js';

export type StoreTaskScreenshot = (input: {
  filename: string;
  buffer: Buffer;
  sha256: string;
  mimetype: string;
  canPublish?: () => boolean;
}) => Promise<BrowserDownloadReceipt>;

/** Trusted native capture only; one write, with no automatic retry on an unknown receipt. */
export async function persistTaskScreenshot(
  image: TaskScreenshot,
  store: StoreTaskScreenshot,
  current: () => Promise<boolean>,
  canPublish?: () => boolean,
): Promise<BrowserDownloadReceipt> {
  const parsed = taskScreenshotSchema.parse(image);
  const buffer = Buffer.from(parsed.data, 'base64');
  if (
    buffer.length !== parsed.sizeBytes ||
    buffer.toString('base64') !== parsed.data ||
    createHash('sha256').update(buffer).digest('hex') !== parsed.sha256 ||
    !(await current())
  )
    throw new Error('screenshot_unavailable');
  const filename = `screenshot-${parsed.captureId}.jpg`;
  const receipt = await store({
    filename,
    buffer,
    sha256: parsed.sha256,
    mimetype: parsed.mediaType,
    canPublish,
  });
  if (
    !receipt.fileId ||
    receipt.filename !== filename ||
    receipt.sizeBytes !== buffer.length ||
    receipt.sha256 !== parsed.sha256 ||
    receipt.mimetype !== parsed.mediaType ||
    receipt.downloadUrl !== `/api/files/${receipt.fileId}/download` ||
    !receipt.expiresAt ||
    !Number.isFinite(Date.parse(receipt.expiresAt)) ||
    !(await current())
  )
    throw new Error('screenshot_save_unconfirmed');
  return Object.freeze({ ...receipt });
}
