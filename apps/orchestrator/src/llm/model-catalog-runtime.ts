import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { env } from '../config/env.js';
import { type DB, db } from '../db/client.js';
import { users } from '../db/schema/users.js';
import {
  type ResolvedBrain,
  createDrizzleModelCatalogStore,
  createModelCatalogService,
  readTaskModelSelections,
  resolveBrainFromEntries,
} from './model-catalog.js';
import { isExternalProviderConfigured } from './model-runtime-wiring.js';

const log = pino({ level: 'warn', base: { service: 'orchestrator', module: 'model-catalog' } });
let loadErrorLogged = false;

/** Process-wide catalog. Falls back to the built-in seed until migration 0061 is applied. */
export const modelCatalogService = createModelCatalogService({
  store: createDrizzleModelCatalogStore(db),
  isProviderConfigured: (provider) => isExternalProviderConfigured(env, provider),
  onLoadError: (error) => {
    if (loadErrorLogged) return;
    loadErrorLogged = true;
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'model catalog unavailable; using built-in defaults',
    );
  },
});

export async function isAdminUser(database: DB, userExternalId: string): Promise<boolean> {
  try {
    const [row] = await database
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.externalId, userExternalId))
      .limit(1);
    return row?.role === 'admin' && row.status === 'active';
  } catch {
    return false;
  }
}

export async function resolveBrainForUser(
  database: DB,
  userExternalId: string,
  requestedBrainId: string | null | undefined,
): Promise<ResolvedBrain> {
  if (!requestedBrainId) {
    // The common path (no explicit pick) never waits on the database: the
    // in-memory snapshot refreshes itself in the background every 10s.
    return resolveBrainFromEntries(
      modelCatalogService.snapshot(),
      { isAdmin: false },
      modelCatalogService.isProviderConfigured,
    );
  }
  const isAdmin = await isAdminUser(database, userExternalId);
  return modelCatalogService.resolveBrain({ isAdmin, requestedBrainId });
}

/** A follow-up on an existing task keeps the brain that task started with. */
export async function resolveBrainForExistingTask(
  database: DB,
  userExternalId: string,
  taskExternalId: string,
): Promise<ResolvedBrain> {
  let storedBrainId: string | null = null;
  try {
    storedBrainId =
      (await readTaskModelSelections(database, [taskExternalId])).get(taskExternalId)?.brainId ??
      null;
  } catch {
    storedBrainId = null;
  }
  return resolveBrainForUser(database, userExternalId, storedBrainId);
}
