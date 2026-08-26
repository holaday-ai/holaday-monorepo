import { sql } from 'drizzle-orm';
import { createNoAccountAssociationHandler, readQueryCount } from '../handler-contract.js';

/**
 * Existing energy analytics tables contain irreversible aggregates, anonymous
 * daily visitor hashes, and idempotency receipts. None maps a user to a
 * visitor. This probe fails closed if such a reversible account column lands;
 * it deliberately does not derive a new hash from the closure subject.
 */
export const analyticsLogsClosureHandler = createNoAccountAssociationHandler(
  'analytics_logs',
  async (context) =>
    readQueryCount(
      await context.db.execute(sql`
        SELECT COUNT(*) AS association_count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name IN (
            'energy_daily_metrics',
            'energy_daily_visitors',
            'energy_event_receipts'
          )
          AND column_name IN ('user_id', 'user_external_id', 'account_id')
      `),
    ),
);
