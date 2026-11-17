import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Server-captured provenance; never accepted as an end-user upload body. */
export const browserFileOriginSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('personal_home'),
    sessionId: z.string().min(5).max(128),
    instanceId: z.string().uuid(),
    origin: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return ['https:', 'http:'].includes(url.protocol) && url.origin === value;
        } catch {
          return false;
        }
      }),
    taskId: z.string().min(1).max(32).nullable(),
  })
  .strict();

export type BrowserFileOrigin = z.infer<typeof browserFileOriginSchema>;
export const taskBrowserFileOriginSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('task_download'),
    taskId: z.string().min(1).max(32),
    origin: browserFileOriginSchema.shape.origin,
    originBasis: z.enum(['download_url', 'owning_page']),
  })
  .strict();
export type TaskBrowserFileOrigin = z.infer<typeof taskBrowserFileOriginSchema>;
export const storedBrowserFileOriginSchema = z.discriminatedUnion('kind', [
  browserFileOriginSchema,
  taskBrowserFileOriginSchema,
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const browserFileSourceSchema = z.discriminatedUnion('kind', [
  browserFileOriginSchema.extend({ sha256: digest }),
  taskBrowserFileOriginSchema.extend({ sha256: digest }),
]);
export type BrowserFileSource = z.infer<typeof browserFileSourceSchema>;

export function browserFileBytesMatch(source: unknown, size: number, buffer: Buffer): boolean {
  const parsed = browserFileSourceSchema.safeParse(source);
  return (
    parsed.success &&
    size === buffer.length &&
    createHash('sha256').update(buffer).digest('hex') === parsed.data.sha256
  );
}
