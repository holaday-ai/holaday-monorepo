import { z } from 'zod';
import { exactWebOriginSchema } from './browser-user-contract.js';

export const USER_BROWSER_SCREENSHOT_CAPABILITY = 'task_screenshot_v1' as const;
export const TASK_SCREENSHOT_MAX_BYTES = 1024 * 1024;
export const taskScreenshotSchema = z
  .object({
    captureId: z.string().uuid(),
    tabId: z.number().int().nonnegative(),
    origin: exactWebOriginSchema,
    observationRevision: z.number().int().positive(),
    mediaType: z.literal('image/jpeg'),
    sizeBytes: z.number().int().min(4).max(TASK_SCREENSHOT_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    data: z
      .string()
      .min(8)
      .max(Math.ceil(TASK_SCREENSHOT_MAX_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    capturedAt: z.number().int().positive(),
  })
  .strict();
export type TaskScreenshot = z.infer<typeof taskScreenshotSchema>;
