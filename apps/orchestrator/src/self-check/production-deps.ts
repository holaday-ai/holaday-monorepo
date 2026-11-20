import { chromium } from 'playwright';
import { env as appEnv } from '../config/env.js';
import { pool } from '../db/client.js';
import { modelCatalogService } from '../llm/model-catalog-runtime.js';
import { createProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { redis } from '../redis.js';
import { SELF_CHECK_FLAG_NAMES, readSelfCheckFlags } from './self-check-service.js';
import type { SelfCheckDeps } from './self-check.js';

/** Region to probe: the admin's own region, else whichever region has a key. */
export function defaultSelfCheckRegion(preferred?: string | null): 'cn' | 'intl' {
  if (preferred === 'cn' || preferred === 'intl') return preferred;
  return appEnv.DASHSCOPE_INTL_API_KEY ? 'intl' : 'cn';
}

/** Flag values as the running process sees them (parsed env first, raw env second). */
function flagSource(): Record<string, string | undefined> {
  const parsed = appEnv as unknown as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  for (const name of SELF_CHECK_FLAG_NAMES) {
    const value = parsed[name] ?? process.env[name];
    out[name] =
      typeof value === 'boolean' || typeof value === 'number'
        ? String(value)
        : typeof value === 'string'
          ? value
          : undefined;
  }
  return out;
}

export function createProductionSelfCheckDeps(input: {
  actorExternalId: string;
  region: 'cn' | 'intl';
  skip?: SelfCheckDeps['skip'];
}): SelfCheckDeps {
  return {
    env: appEnv,
    flags: readSelfCheckFlags(flagSource()),
    fetchImpl: fetch,
    now: Date.now,
    catalog: () => modelCatalogService.snapshot(),
    wiring: createProductionModelRuntimeWiring(
      appEnv,
      {},
      {
        catalog: () => modelCatalogService.snapshot(),
      },
    ),
    region: input.region,
    actorExternalId: input.actorExternalId,
    async mysqlQuery(sql, params) {
      const [rows] = await pool.query(sql, params ?? []);
      return rows as Record<string, unknown>[];
    },
    redisPing: () => redis.ping(),
    async launchChromium() {
      const browser = await chromium.launch({ headless: true, timeout: 20_000 });
      await browser.close();
    },
    ...(input.skip ? { skip: input.skip } : {}),
  };
}
