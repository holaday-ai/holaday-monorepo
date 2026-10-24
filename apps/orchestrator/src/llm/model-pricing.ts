import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { LlmCallRecord } from '../agent/llm-call-recorder.js';
import type { DB } from '../db/client.js';
import { modelCatalogSettings } from '../db/schema/model-catalog.js';
import { BUILTIN_MODEL_PRICES } from './model-price-catalog.js';

const tierSchema = z.object({
  upTo: z.number().positive().optional(),
  input: z.number().nonnegative().optional(),
  output: z.number().nonnegative().optional(),
  cached: z.number().nonnegative().optional(),
  explicitRead: z.number().nonnegative().optional(),
  explicitWrite: z.number().nonnegative().optional(),
  explicitReadRatio: z.number().nonnegative().optional(),
  explicitWriteRatio: z.number().nonnegative().optional(),
  implicitCache: z.number().nonnegative().optional(),
  rate: z.number().nonnegative().optional(),
  resolution: z.string().optional(),
  audio: z.boolean().optional(),
  mode: z.string().optional(),
});
const catalogSchema = z.object({
  version: z.string(),
  entries: z.array(
    z.object({
      provider: z.string(),
      models: z.array(z.string()),
      region: z.string(),
      unit: z.enum(['token', 'image', 'second', 'character']),
      tiers: z.array(tierSchema),
      source: z.string().url(),
    }),
  ),
});
export type ModelPriceCatalog = z.infer<typeof catalogSchema>;
export interface MediaUsage {
  unit: 'image' | 'second' | 'character';
  quantity: number;
  resolution?: string;
  audio?: boolean;
  mode?: string;
  basis: 'provider' | 'request' | 'measured';
}
const cache = new WeakMap<object, { until: number; value: ModelPriceCatalog }>();
export async function loadModelPrices(db: DB): Promise<ModelPriceCatalog> {
  const previous = cache.get(db);
  if (previous && previous.until > Date.now()) return previous.value;
  let value = BUILTIN_MODEL_PRICES;
  try {
    const [row] = await db
      .select({ value: modelCatalogSettings.value })
      .from(modelCatalogSettings)
      .where(eq(modelCatalogSettings.id, 'model_pricing'))
      .limit(1);
    if (row) value = catalogSchema.parse(row.value);
  } catch (error) {
    // Pre-migration installations use the same published seed. Invalid stored prices fail closed.
    if (error instanceof z.ZodError) value = { version: 'invalid', entries: [] };
  }
  cache.set(db, { until: Date.now() + 60_000, value });
  return value;
}
export function officialCost(
  call: LlmCallRecord,
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  },
  catalog = BUILTIN_MODEL_PRICES,
): { costUsd: number | null; source: string | null; version: string } {
  const price = catalog.entries.find(
    (p) =>
      p.provider === call.provider &&
      p.models.includes(call.model) &&
      (p.region === 'any' || p.region === call.region) &&
      p.unit === (call.mediaUsage?.unit ?? 'token'),
  );
  const missing = { costUsd: null, source: price?.source ?? null, version: catalog.version };
  if (!price) return missing;
  if (call.mediaUsage) {
    const u = call.mediaUsage;
    if (call.status !== 'ok' || !Number.isFinite(u.quantity) || u.quantity < 0) return missing;
    const tier = price.tiers.find(
      (t) =>
        (t.resolution === undefined || t.resolution === u.resolution) &&
        (t.audio === undefined || t.audio === u.audio) &&
        (t.mode === undefined || t.mode === u.mode),
    );
    return tier?.rate === undefined ? missing : { ...missing, costUsd: u.quantity * tier.rate };
  }
  const {
    promptTokens: input,
    completionTokens: output,
    cacheReadTokens: read,
    cacheWriteTokens: write,
  } = usage;
  if (input === null || output === null || read === null || write === null) return missing;
  const tier = price.tiers.find((t) => t.upTo !== undefined && input + read + write <= t.upTo);
  if (!tier || tier.input === undefined || tier.output === undefined) return missing;
  const explicit = call.cacheMode === 'explicit' || write > 0;
  const readPrice = explicit
    ? (tier.explicitRead ??
      (tier.explicitReadRatio === undefined ? undefined : tier.input * tier.explicitReadRatio))
    : (tier.cached ??
      (tier.implicitCache === undefined ? undefined : tier.input * tier.implicitCache));
  const writePrice =
    tier.explicitWrite ??
    (tier.explicitWriteRatio === undefined ? undefined : tier.input * tier.explicitWriteRatio);
  if ((write > 0 && writePrice === undefined) || (read > 0 && readPrice === undefined))
    return missing;
  return {
    ...missing,
    costUsd:
      (input * tier.input +
        read * (readPrice ?? 0) +
        write * (writePrice ?? 0) +
        output * tier.output) /
      1_000_000,
  };
}
