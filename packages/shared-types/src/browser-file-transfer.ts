import { z } from 'zod';

export const BROWSER_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const BROWSER_UPLOAD_CHUNK_BYTES = 256 * 1024;
export const BROWSER_UPLOAD_IDLE_MS = 120_000;
export const BROWSER_UPLOAD_LIFETIME_MS = 600_000;

export const browserUploadFileSchema = z
  .object({
    fileId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          value !== '.' &&
          value !== '..' &&
          !/[/\\]/.test(value) &&
          ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
      ),
    mimeType: z
      .string()
      .min(3)
      .max(255)
      .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/),
    sizeBytes: z.number().int().nonnegative().max(BROWSER_UPLOAD_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const browserUploadManifestSchema = z
  .array(browserUploadFileSchema)
  .min(1)
  .max(5)
  .refine((files) => new Set(files.map((file) => file.fileId)).size === files.length)
  .refine(
    (files) => files.reduce((sum, file) => sum + file.sizeBytes, 0) <= BROWSER_UPLOAD_MAX_BYTES,
  );
export type BrowserUploadManifest = z.infer<typeof browserUploadManifestSchema>;

export const browserUploadChunkSchema = z
  .object({
    transferId: z.string().uuid(),
    fileIndex: z.number().int().min(0).max(4),
    offset: z.number().int().nonnegative().max(BROWSER_UPLOAD_MAX_BYTES),
    data: z
      .string()
      .min(1)
      .max(Math.ceil(BROWSER_UPLOAD_CHUNK_BYTES / 3) * 4)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
export type BrowserUploadChunk = z.infer<typeof browserUploadChunkSchema>;

export const browserUploadOutcomeSchema = z
  .object({
    status: z.enum(['handed_to_page', 'not_applied', 'unknown']),
    reason: z
      .string()
      .regex(/^[a-zA-Z0-9_]{1,64}$/)
      .optional(),
  })
  .strict();
export type BrowserUploadOutcome = z.infer<typeof browserUploadOutcomeSchema>;
export const browserUploadTransferReceiptSchema = browserUploadOutcomeSchema
  .extend({
    transferId: z.string().uuid(),
    files: browserUploadManifestSchema,
  })
  .strict();
export type BrowserUploadTransferReceipt = z.infer<typeof browserUploadTransferReceiptSchema>;
