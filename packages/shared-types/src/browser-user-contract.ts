import { z } from 'zod';

/** Optional extension ability; keep the six mandatory v2 capabilities compatible. */
export const USER_BROWSER_ACTIVITY_CAPABILITY = 'human_activity_v1' as const;
export const USER_BROWSER_UPLOAD_CAPABILITY = 'task_file_upload_v1' as const;
export const userBrowserActivitySchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    stamp: z.string().regex(/^[a-f0-9]{64}$/),
    keys: z.number().int().min(0).max(1280),
    pointers: z.number().int().min(0).max(60),
    composing: z.boolean(),
    interrupted: z.boolean(),
  })
  .strict();
export type UserBrowserActivity = z.infer<typeof userBrowserActivitySchema>;
/** Local page→extension relay. Never carries field values, key names or URLs. */
export const nativeDocumentActivitySchema = userBrowserActivitySchema
  .omit({ tabId: true, stamp: true })
  .extend({
    document: z.string().uuid(),
    input: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const USER_BROWSER_PROTOCOL = Object.freeze({
  version: 2 as const,
  capabilitiesVersion: 1 as const,
  capabilities: [
    'real_target',
    'revision_binding',
    'exact_origin',
    'scroll',
    'select',
    'task_tabs',
  ] as const,
});
export const userBrowserProtocolSchema = z
  .object({
    version: z.literal(2),
    capabilitiesVersion: z.literal(1),
    capabilities: z
      .array(z.string().max(64))
      .max(32)
      .refine((values) =>
        USER_BROWSER_PROTOCOL.capabilities.every((value) => values.includes(value)),
      ),
  })
  .strict();
export type UserBrowserProtocol = z.infer<typeof userBrowserProtocolSchema>;
export const exactWebOriginSchema = z
  .string()
  .url()
  .max(2048)
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) && url.origin === raw && !url.username && !url.password;
    } catch {
      return false;
    }
  });
const signal = z.string().max(1200).nullable();
export const userBrowserElementSignalsSchema = z
  .object({
    role: signal,
    visibleText: signal,
    ariaLabel: signal,
    title: signal,
    placeholder: signal,
    name: signal,
    inputType: signal,
    tagName: signal,
    /** FIX-36 复审 #1: read in the page by `readLoginContext` (absent from older extensions). */
    loginField: z.boolean().optional(),
    loginControl: z.boolean().optional(),
    loginBlock: z.boolean().optional(),
  })
  .strict();
export const userBrowserTargetDescriptionSchema = z
  .object({
    token: z.string().uuid(),
    elementId: z.string().uuid(),
    objectDigest: z.string().regex(/^[a-f0-9]{64}$/),
    tabId: z.number().int().nonnegative(),
    frameId: z.string().min(1).max(128),
    origin: exactWebOriginSchema,
    observationRevision: z.number().int().positive(),
    capturedAt: z.number().int().positive(),
    element: userBrowserElementSignalsSchema,
    /** Present only for the opt-in bound file-delivery path. No local paths or
     * names of files already selected by the human leave the document. */
    fileInput: z
      .object({
        accept: z.string().max(1200),
        multiple: z.boolean(),
        disabled: z.boolean(),
        directory: z.boolean(),
        credentialForm: z.boolean(),
        formOrigin: exactWebOriginSchema.nullable(),
        formMethod: z.string().max(16),
        selectedCount: z.number().int().nonnegative().max(10000),
      })
      .strict()
      .optional(),
    /** The tab's current document, read by the extension (never the model):
     * origin + path only — query and hash values never leave the page — and
     * whether the full address (including query/hash) is a transaction page. */
    page: z
      .object({
        url: z
          .string()
          .url()
          .max(2048)
          .refine((raw) => {
            try {
              const url = new URL(raw);
              return (
                /^https?:$/.test(url.protocol) &&
                !url.search &&
                !url.hash &&
                !url.username &&
                !url.password
              );
            } catch {
              return false;
            }
          }),
        transactional: z.boolean(),
      })
      .strict(),
    form: z
      .object({
        action: signal,
        method: signal,
        fieldSignal: signal,
        hasAmountField: z.boolean(),
        transactionalAction: z.boolean(),
        searchLike: z.boolean(),
        submitControl: userBrowserElementSignalsSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type UserBrowserTargetDescription = z.infer<typeof userBrowserTargetDescriptionSchema>;
export type UserBrowserElementSignals = z.infer<typeof userBrowserElementSignalsSchema>;
export const userBrowserBindingSchema = z
  .object({
    token: z.string().uuid(),
    observationRevision: z.number().int().positive(),
  })
  .strict();
export type UserBrowserBinding = z.infer<typeof userBrowserBindingSchema>;
