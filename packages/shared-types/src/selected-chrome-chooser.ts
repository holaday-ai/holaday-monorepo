import { z } from 'zod';
import { userBrowserBindingSchema } from './browser-user-contract.js';
import { resilientSelectorSchema } from './selector.js';

/** One explicitly authorized, real bound click; no evaluation or file bytes. */
export const selectedChromeChooserCommandSchema = z
  .object({
    op: z.literal('chooser_open'),
    sessionId: z.string().uuid(),
    action: z
      .object({
        kind: z.literal('click'),
        selector: resilientSelectorSchema,
        deadlineMs: z.number().int().min(1).max(30_000).optional(),
      })
      .strict(),
    binding: userBrowserBindingSchema,
  })
  .strict();
export type SelectedChromeChooserCommand = z.infer<typeof selectedChromeChooserCommandSchema>;

export const userBrowserChooserStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('captured'),
      clickOutcome: z.literal('applied'),
      chooserId: z.string().uuid(),
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
        'capture_expired',
        'chooser_ambiguous',
        'chooser_unavailable',
      ]),
    })
    .strict(),
]);
export type UserBrowserChooserState = z.infer<typeof userBrowserChooserStateSchema>;
/** Trusted adapter receipt, separate from whether the native click applied. */
export const userBrowserChooserFailureSchema = z
  .object({
    clickOutcome: z.enum(['applied', 'not_applied', 'unknown']),
    interceptionRestored: z.boolean(),
  })
  .strict();
