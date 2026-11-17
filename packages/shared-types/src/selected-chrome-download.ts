import { z } from 'zod';
import {
  BROWSER_UPLOAD_CHUNK_BYTES,
  BROWSER_UPLOAD_MAX_BYTES,
  browserUploadChunkSchema,
  browserUploadFileSchema,
} from './browser-file-transfer.js';
import { exactWebOriginSchema } from './browser-user-contract.js';
import { selectedChromeChooserCommandSchema } from './selected-chrome-chooser.js';

export const selectedChromeDownloadCommandSchema = z.discriminatedUnion('op', [
  selectedChromeChooserCommandSchema.extend({ op: z.literal('download_open') }),
  z
    .object({
      op: z.literal('download_read'),
      sessionId: z.string().uuid(),
      downloadId: z.string().uuid(),
      offset: z.number().int().min(0).max(BROWSER_UPLOAD_MAX_BYTES),
      length: z.number().int().min(1).max(BROWSER_UPLOAD_CHUNK_BYTES),
    })
    .strict(),
  z
    .object({
      op: z.literal('download_release'),
      sessionId: z.string().uuid(),
      downloadId: z.string().uuid(),
    })
    .strict(),
]);
export type SelectedChromeDownloadCommand = z.infer<typeof selectedChromeDownloadCommandSchema>;
export const browserDownloadMetadataSchema = browserUploadFileSchema
  .omit({ fileId: true, name: true })
  .extend({ filename: browserUploadFileSchema.shape.name })
  .strict();
export const browserDownloadSourceSchema = z
  .object({
    origin: exactWebOriginSchema,
    originBasis: z.enum(['download_url', 'owning_page']),
    guid: z.string().min(1).max(128),
    frameId: z.string().min(1).max(128),
  })
  .strict();
export const userBrowserDownloadStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('captured'),
      clickOutcome: z.literal('applied'),
      downloadId: z.string().uuid(),
      metadata: browserDownloadMetadataSchema,
      source: browserDownloadSourceSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('not_applied'),
      clickOutcome: z.literal('not_applied'),
      reason: z.enum(['scope_unavailable', 'capture_expired']),
    })
    .strict(),
  z
    .object({
      status: z.literal('clicked'),
      clickOutcome: z.literal('applied'),
      reason: z.enum([
        'not_captured',
        'scope_unavailable',
        'download_timeout',
        'download_ambiguous',
        'download_cancelled',
        'download_too_large',
        'blob_source_unavailable',
        'origin_grant_required',
        'download_metadata_invalid',
        'data_payload_invalid',
        'original_response_unavailable',
      ]),
    })
    .strict(),
]);
export type UserBrowserDownloadState = z.infer<typeof userBrowserDownloadStateSchema>;
export const userBrowserDownloadChunkSchema = z
  .object({
    downloadId: z.string().uuid(),
    offset: z.number().int().min(0).max(BROWSER_UPLOAD_MAX_BYTES),
    data: browserUploadChunkSchema.shape.data.or(z.literal('')),
    eof: z.boolean(),
  })
  .strict();
export type UserBrowserDownloadChunk = z.infer<typeof userBrowserDownloadChunkSchema>;
