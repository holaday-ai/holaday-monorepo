import { sql } from 'drizzle-orm';
import { createNoAccountAssociationHandler, readQueryCount } from '../handler-contract.js';

/**
 * Feedback currently has no relational store: the route sends directly to
 * Resend and records operational logs. Any future feedback/support table is a
 * capability change and blocks closure until an explicit delete/minimize rule
 * (including legal/dispute retention) replaces this probe.
 */
export const feedbackSupportClosureHandler = createNoAccountAssociationHandler(
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
