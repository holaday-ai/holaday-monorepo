import { sql } from 'drizzle-orm';
import { createExternalRetentionHandler, readQueryCount } from '../handler-contract.js';

/**
 * Existing energy analytics tables contain irreversible aggregates, anonymous
 * daily visitor hashes, and idempotency receipts. None maps a user to a
 * visitor. This probe fails closed if such a reversible account column lands
 * and deliberately does not derive a new hash from the closure subject.
 * Process/operations logs remain an external retention surface, so a zero
 * relational probe still blocks until that separate workflow is evidenced.
 */
export const analyticsLogsClosureHandler = createExternalRetentionHandler(
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
