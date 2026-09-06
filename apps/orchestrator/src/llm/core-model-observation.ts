import { type Logger, pino } from 'pino';
import { z } from 'zod';
import { CORE_MODEL_LANES } from './model-runtime-policy.js';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const observationSchema = z
  .object({
    provider: z.literal('alibaba-model-studio'),
    region: z.enum(['cn', 'intl']),
    deploymentScope: z.enum(['china_mainland', 'international']),
    lane: z.enum(CORE_MODEL_LANES),
    protocol: z.enum(['messages', 'responses']),
    purpose: z.enum([
      'reasoning',
      'standard',
      'fast',
      'coding',
      'verify',
      'verify_fast',
      'verify_strict',
      'vision',
    ]),
    model: z
      .string()
      .max(80)
      .regex(/^qwen[a-zA-Z0-9._-]*$/),
    outcome: z.enum(['success', 'incomplete', 'error']),
    inputTokens: count.nullable(),
    outputTokens: count.nullable(),
    latencyMs: count,
  })
  .refine((value) => (value.region === 'cn') === (value.deploymentScope === 'china_mainland'));

/** Never inherit a request logger: it may bind user, task, URL or payload data. */
export function createCoreModelObserver(log: Pick<Logger, 'info'>): (value: unknown) => void {
  return (value) => {
    const parsed = observationSchema.safeParse(value);
    if (!parsed.success) return;
    // Zod strips unknown fields. Never log validation errors or the input.
    log.info({ event: 'qwen.core.call', ...parsed.data }, 'Qwen core model call');
  };
}

// A dedicated fixed-info operational sink makes request observations available
// even if callers omit `observe` or ordinary application logs are warning-only.
export const recordCoreModelObservation = createCoreModelObserver(
  pino({
    level: 'info',
    base: { service: 'orchestrator' },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),
);
