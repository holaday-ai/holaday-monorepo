import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { readAffectedRows } from '../../db/mysql-result.js';
import { feedbackCases } from '../../db/schema/feedback-cases.js';
import {
  type AccountClosureHandler,
  ClosureHandlerError,
  readQueryCount,
} from '../handler-contract.js';

/**
 * Ordinary governed feedback rows are deleted. Explicitly reviewed
 * legal/dispute cases are stripped of identity and content, then bound to this
 * closure request. Legacy inbox/log content must have a separately audited
 * sanitation confirmation before any mutation begins.
 */
export const feedbackSupportClosureHandler: AccountClosureHandler = {
  categoryId: 'feedback_support',
  version: 1,
  retentionOutcomes: ['deleted', 'restricted', 'not_present'],

  async run(context) {
    context.signal.throwIfAborted();
    if (process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED !== 'true') {
      throw new ClosureHandlerError('EXTERNAL_RETENTION_REQUIRED');
    }
    const ungovernedAssociations = readQueryCount(
      await context.db.execute(sql`
        SELECT (
          SELECT COUNT(*)
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name REGEXP '(^|_)(feedback|support)(_|$)'
            AND table_name <> 'feedback_cases'
        ) + (
          SELECT COUNT(*)
          FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = 'feedback_cases'
            AND column_name NOT IN (
              'id',
              'external_id',
              'user_id',
              'closure_request_id',
              'message',
              'context',
              'user_agent',
              'hold_reason',
              'restricted_at',
              'created_at'
            )
        ) AS association_count
      `),
    );
    if (ungovernedAssociations !== 0) throw new ClosureHandlerError('CAPABILITY_CHANGED');

    const pageSize = Math.min(context.pageSize, 100);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    const rows = await context.db
      .select({ id: feedbackCases.id, holdReason: feedbackCases.holdReason })
      .from(feedbackCases)
      .where(eq(feedbackCases.userId, context.request.userId))
      .orderBy(feedbackCases.id)
      .limit(pageSize);

    for (const row of rows) {
      context.signal.throwIfAborted();
      const result = row.holdReason
        ? await context.db
            .update(feedbackCases)
            .set({
              userId: null,
              closureRequestId: context.request.id,
              message: null,
              context: null,
              userAgent: null,
              restrictedAt: new Date(),
            })
            .where(
              and(
                eq(feedbackCases.id, row.id),
                eq(feedbackCases.userId, context.request.userId),
                eq(feedbackCases.holdReason, row.holdReason),
              ),
            )
        : await context.db
            .delete(feedbackCases)
            .where(
              and(eq(feedbackCases.id, row.id), eq(feedbackCases.userId, context.request.userId)),
            );
      if (readAffectedRows(result) !== 1) throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }

    const processed = (context.checkpoint?.processedCount ?? 0) + rows.length;
    context.signal.throwIfAborted();
    const [remaining] = await context.db
      .select({ id: feedbackCases.id })
      .from(feedbackCases)
      .where(eq(feedbackCases.userId, context.request.userId))
      .limit(1);
    if (remaining) {
      return { kind: 'continue', checkpoint: { processedCount: processed }, processed };
    }

    const [restricted] = await context.db
      .select({ id: feedbackCases.id })
      .from(feedbackCases)
      .where(
        and(
          eq(feedbackCases.closureRequestId, context.request.id),
          isNotNull(feedbackCases.holdReason),
        ),
      )
      .limit(1);
    return {
      kind: 'complete',
      processed,
      retention: restricted ? 'restricted' : processed > 0 ? 'deleted' : 'not_present',
    };
  },
};
