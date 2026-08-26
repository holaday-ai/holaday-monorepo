import { sql } from 'drizzle-orm';
import { createExternalRetentionHandler, readQueryCount } from '../handler-contract.js';

/**
 * Feedback currently has no relational store: the route sends personal content
 * to a Resend inbox and can copy delivery failures into operational logs. The
 * schema probe guards against an unreviewed future table; even when it is zero,
 * completion stays blocked until the external delete/minimize/legal-hold flow
 * has durable evidence.
 */
export const feedbackSupportClosureHandler = createExternalRetentionHandler(
  'feedback_support',
  async (context) =>
    readQueryCount(
      await context.db.execute(sql`
        SELECT COUNT(*) AS association_count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name REGEXP '(^|_)(feedback|support)(_|$)'
      `),
    ),
);
