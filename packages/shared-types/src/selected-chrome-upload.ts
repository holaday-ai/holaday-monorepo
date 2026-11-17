import { z } from 'zod';
import {
  BROWSER_UPLOAD_MAX_BYTES,
  browserUploadChunkSchema,
  browserUploadManifestSchema,
  browserUploadTransferReceiptSchema,
} from './browser-file-transfer.js';
import { userBrowserBindingSchema } from './browser-user-contract.js';
import { resilientSelectorSchema } from './selector.js';

const selectedUploadBySelector = z
  .object({
    kind: z.literal('upload'),
    selector: resilientSelectorSchema,
    payload: z
      .object({ files: browserUploadManifestSchema, chooserId: z.never().optional() })
      .strict(),
    deadlineMs: z.number().int().min(1).max(30_000).optional(),
  })
  .strict();
const selectedUploadByChooser = z
  .object({
    kind: z.literal('upload'),
    selector: z.never().optional(),
    payload: z
      .object({ files: browserUploadManifestSchema, chooserId: z.string().uuid() })
      .strict(),
    deadlineMs: z.number().int().min(1).max(30_000).optional(),
  })
  .strict();
export const selectedChromeUploadActionSchema = z.union([
  selectedUploadBySelector,
  selectedUploadByChooser,
]);
export type SelectedChromeUploadAction = z.infer<typeof selectedChromeUploadActionSchema>;

export const selectedChromeUploadCommandSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('upload_describe'),
      sessionId: z.string().uuid(),
      action: selectedChromeUploadActionSchema,
      observationRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      op: z.literal('upload_begin'),
      sessionId: z.string().uuid(),
      action: selectedChromeUploadActionSchema,
      binding: userBrowserBindingSchema,
    })
    .strict(),
  browserUploadChunkSchema
    .extend({ op: z.literal('upload_chunk'), sessionId: z.string().uuid() })
    .strict(),
  z
    .object({
      op: z.literal('upload_commit'),
      sessionId: z.string().uuid(),
      transferId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      op: z.literal('upload_abort'),
      sessionId: z.string().uuid(),
      transferId: z.string().uuid(),
    })
    .strict(),
]);
export type SelectedChromeUploadCommand = z.infer<typeof selectedChromeUploadCommandSchema>;
export const userBrowserUploadStateSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('begun'), transferId: z.string().uuid() }).strict(),
  z
    .object({
      phase: z.literal('progress'),
      transferId: z.string().uuid(),
      fileIndex: z.number().int().min(0).max(4),
      nextOffset: z.number().int().nonnegative().max(BROWSER_UPLOAD_MAX_BYTES),
    })
    .strict(),
  z.object({ phase: z.literal('finished'), receipt: browserUploadTransferReceiptSchema }).strict(),
  z.object({ phase: z.literal('aborted'), transferId: z.string().uuid() }).strict(),
]);
export type UserBrowserUploadState = z.infer<typeof userBrowserUploadStateSchema>;
