import { sql } from 'drizzle-orm';
import { createVerifiedRestrictedRetentionHandler, readQueryCount } from '../handler-contract.js';

/**
 * Existing energy analytics tables contain irreversible aggregates, anonymous
 * daily visitor hashes, and idempotency receipts. None maps a user to a
 * visitor. This probe fails closed if such a reversible account column lands
 * and deliberately does not derive a new hash from the closure subject.
 * Process/operations logs remain an external retention surface, so a zero
 * relational probe still blocks until that separate workflow is evidenced.
 */
export const analyticsLogsClosureHandler = createVerifiedRestrictedRetentionHandler(
  'analytics_logs',
  () => process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED === 'true',
  async (context) =>
    readQueryCount(
      await context.db.execute(sql`
        SELECT COUNT(*) AS association_count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND (
            (
              table_name = 'energy_daily_metrics'
              AND column_name NOT IN (
                'id',
                'metric_date',
                'bucket_hash',
                'event_type',
                'experience_id',
                'mode_id',
                'energy_need',
                'duration_bucket',
                'outcome',
                'section_id',
                'target_type',
                'source_kind',
                'content_id',
                'range_key',
                'task_status',
                'batch_count',
                'event_count',
                'expires_at',
                'created_at',
                'updated_at'
              )
            ) OR (
              table_name = 'energy_daily_visitors'
              AND column_name NOT IN (
                'id',
                'activity_date',
                'visitor_hash',
                'expires_at',
                'created_at'
              )
            ) OR (
              table_name = 'energy_event_receipts'
              AND column_name NOT IN ('event_id', 'expires_at', 'created_at')
            )
          )
      `),
    ),
);
