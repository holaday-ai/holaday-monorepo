import { and, eq, gt, sql } from 'drizzle-orm';
import { readAffectedRows } from '../../db/mysql-result.js';
import { payments } from '../../db/schema/payments.js';
import { taskQuotas } from '../../db/schema/task-quotas.js';
import { users } from '../../db/schema/users.js';
import {
  RETAINED_PAYMENT_METADATA_KEYS,
  sanitizePaymentMetadataForClosure,
} from '../../payment/retention.js';
import type { AccountClosureHandler } from '../handler-contract.js';
import { ClosureHandlerError } from '../handler-contract.js';

export { RETAINED_PAYMENT_METADATA_KEYS, sanitizePaymentMetadataForClosure };

export const paymentsEntitlementsClosureHandler: AccountClosureHandler = {
  categoryId: 'payments_entitlements',
  version: 1,
  async run(context) {
    const pageSize = boundedPageSize(context.pageSize);
    const previousProcessed = context.checkpoint?.processedCount ?? 0;
    const afterId = context.checkpoint?.cursor ?? 0;
    const [ownedUser] = await context.db
      .select({ externalId: users.externalId })
      .from(users)
      .where(eq(users.id, context.request.userId))
      .limit(1);
    if (!ownedUser || ownedUser.externalId !== context.request.userExternalId) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    const rows = await context.db
      .select({ id: payments.id, metadata: payments.metadata })
      .from(payments)
      .where(
        and(eq(payments.userExternalId, context.request.userExternalId), gt(payments.id, afterId)),
      )
      .orderBy(payments.id)
      .limit(pageSize);

    if (rows.length > 0) {
      for (const row of rows) {
        const result = await context.db
          .update(payments)
          .set({ metadata: sanitizePaymentMetadataForClosure(row.metadata) })
          .where(
            and(
              eq(payments.id, row.id),
              eq(payments.userExternalId, context.request.userExternalId),
            ),
          );
        if (readAffectedRows(result) !== 1) {
          throw new ClosureHandlerError('INVARIANT_VIOLATION');
        }
      }
      return {
        kind: 'continue',
        checkpoint: {
          cursor: rows.at(-1)?.id,
          processedCount: previousProcessed + rows.length,
        },
        processed: previousProcessed + rows.length,
      };
    }

    const [user] = await context.db
      .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
      .from(users)
      .where(eq(users.id, context.request.userId))
      .limit(1);
    if (!user) throw new ClosureHandlerError('INVARIANT_VIOLATION');

    const [quotaSummary] = await context.db
      .select({
        count: sql<number>`COUNT(*)`,
        activeCount: sql<number>`SUM(CASE WHEN ${taskQuotas.periodEnd} > CURRENT_TIMESTAMP(3) OR ${taskQuotas.bonusTasks} <> 0 OR ${taskQuotas.bonusOpus} <> 0 THEN 1 ELSE 0 END)`,
      })
      .from(taskQuotas)
      .where(eq(taskQuotas.userId, context.request.userId));
    const entitlementChanges =
      (user.plan !== 'free' || user.planExpiresAt !== null ? 1 : 0) +
      Number(quotaSummary?.activeCount ?? 0);

    await context.db
      .update(users)
      .set({ plan: 'free', planExpiresAt: null })
      .where(eq(users.id, context.request.userId));
    await context.db
      .update(taskQuotas)
      .set({
        periodEnd: sql`LEAST(${taskQuotas.periodEnd}, CURRENT_TIMESTAMP(3))`,
        bonusTasks: 0,
        bonusOpus: 0,
      })
      .where(eq(taskQuotas.userId, context.request.userId));

    const processed = previousProcessed + entitlementChanges;
    const [retainedPayments] = await context.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(payments)
      .where(eq(payments.userExternalId, context.request.userExternalId));
    const hasRetainedPayments = Number(retainedPayments?.count ?? 0) > 0;
    if (processed === 0 && !hasRetainedPayments) {
      return { kind: 'complete', processed: 0, retention: 'not_present' };
    }
    return {
      kind: 'complete',
      processed,
      retention: hasRetainedPayments ? 'restricted' : 'deleted',
    };
  },
};

function boundedPageSize(pageSize: number): number {
  const bounded = Math.min(pageSize, 100);
  if (!Number.isSafeInteger(bounded) || bounded <= 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return bounded;
}
