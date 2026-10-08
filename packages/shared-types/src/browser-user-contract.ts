import { z } from 'zod';

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
  })
  .strict();
export const userBrowserTargetDescriptionSchema = z
  .object({
    token: z.string().uuid(),
    tabId: z.number().int().nonnegative(),
    frameId: z.string().min(1).max(128),
    origin: exactWebOriginSchema,
    observationRevision: z.number().int().positive(),
    capturedAt: z.number().int().positive(),
    element: userBrowserElementSignalsSchema,
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
