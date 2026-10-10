import { createHash } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { stockDashboardSnapshots } from '../db/schema/stock-dashboard-snapshots.js';

type Db = typeof import('../db/client.js').db;
const FORMAT = 'served-stock-context-v1';
const LEASE_MS = 10 * 60_000;
interface ContextIdentity { snapshotId: string; dataAsOf: string; trustMode: string }
function versionKey(identity: ContextIdentity): string {
  return createHash('sha256').update(JSON.stringify([FORMAT, identity.snapshotId, identity.dataAsOf, identity.trustMode])).digest('hex');
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Display cache rows may be replaced; issued contexts have separate user-scoped keys. */
export async function rememberServedStockSnapshot(args: {
  db: Db; userId: number; snapshot: unknown;
  logger: { warn(obj: Record<string, unknown>, message: string): void };
}): Promise<void> {
  const trust = record(record(args.snapshot)?.trust);
  if (!trust || !['current', 'delayed', 'historical'].includes(String(trust.mode))) return;
  if (typeof trust.snapshotId !== 'string' || typeof trust.dataAsOf !== 'string') throw new Error('Invalid served stock context');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  await args.db.insert(stockDashboardSnapshots).values({
    userId: args.userId,
    cacheKeyHash: versionKey({ snapshotId: trust.snapshotId, dataAsOf: trust.dataAsOf, trustMode: String(trust.mode) }),
    snapshotJson: { kind: FORMAT, expiresAt, snapshot: args.snapshot },
  }).onDuplicateKeyUpdate({ set: {
    // Renew the lease without replacing the already issued payload.
    snapshotJson: sql`JSON_SET(${stockDashboardSnapshots.snapshotJson}, '$.expiresAt', ${expiresAt})`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  } });
  try {
    // Only this new ephemeral cache namespace is pruned, never legacy display/business rows.
    await args.db.delete(stockDashboardSnapshots).where(and(
      eq(stockDashboardSnapshots.userId, args.userId),
      sql`JSON_EXTRACT(${stockDashboardSnapshots.snapshotJson}, '$.kind') = ${FORMAT}`,
      lt(stockDashboardSnapshots.updatedAt, new Date(now.getTime() - LEASE_MS)),
    ));
  } catch {
    args.logger.warn({ code: 'SERVED_STOCK_CACHE_PRUNE_FAILED' }, 'stocks: context cache pruning failed');
  }
}

export async function findServedStockSnapshot(args: {
  db: Db; userId: number; input: ContextIdentity;
}): Promise<{ state: 'missing' } | { state: 'expired' } | { state: 'valid'; snapshot: unknown }> {
  const [row] = await args.db.select({ userId: stockDashboardSnapshots.userId, snapshotJson: stockDashboardSnapshots.snapshotJson })
    .from(stockDashboardSnapshots).where(and(
      eq(stockDashboardSnapshots.userId, args.userId),
      eq(stockDashboardSnapshots.cacheKeyHash, versionKey(args.input)),
    )).limit(1);
  if (!row || row.userId !== args.userId) return { state: 'missing' };
  const envelope = record(row.snapshotJson);
  if (envelope?.kind !== FORMAT) return { state: 'missing' };
  const expiry = typeof envelope.expiresAt === 'string' ? Date.parse(envelope.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return { state: 'expired' };
  return { state: 'valid', snapshot: envelope.snapshot };
}
