import { type SQL, sql } from 'drizzle-orm';
import { readAffectedRows } from '../../db/mysql-result.js';
import type { AccountClosureHandler, ClosureHandlerContext } from '../handler-contract.js';
import { ClosureHandlerError } from '../handler-contract.js';

const RESTRICTED_METADATA = sql`JSON_OBJECT('closureRestricted', TRUE)`;
const MAX_RETAINED_STRING_LENGTH = 256;

export type PartnerMetadataKind =
  | 'kyc'
  | 'order'
  | 'lot'
  | 'ledger'
  | 'withdrawal'
  | 'risk'
  | 'referral'
  | 'allocation'
  | 'release';

const PARTNER_METADATA_KEYS: Readonly<Record<PartnerMetadataKind, readonly string[]>> = {
  kyc: ['source', 'providerRef', 'bankCardHashUpdatedAt', 'reviewerUserId'],
  order: [
    'reviewReason',
    'annualRechargeCapCnyCents',
    'annualRechargeTotalCnyCents',
    'kycStatus',
    'reviewApprovedByUserId',
    'reviewApprovedAt',
  ],
  lot: [
    'rollingThirtyDayCnyCents',
    'monthlyCapCnyCents',
    'riskFrozenByUserId',
    'riskFrozenAt',
    'statusBeforeFreeze',
    'riskStatusBeforeFreeze',
    'riskResumedByUserId',
    'riskResumedAt',
    'riskClosedByUserId',
    'riskClosedAt',
    'riskCloseResolutionKind',
    'riskCloseResolutionRef',
    'statusBeforeClose',
    'riskStatusBeforeClose',
  ],
  ledger: [
    'withdrawalRequestId',
    'withdrawalRequestExternalId',
    'releaseId',
    'releaseMonth',
    'referralId',
    'referralExternalId',
    'inviteeUserId',
    'rechargeOrderId',
    'rechargeAmountCnyCents',
    'rewardRateBps',
    'settledAt',
    'source',
  ],
  withdrawal: [
    'approvedByUserId',
    'approvedAt',
    'rejectedByUserId',
    'rejectedAt',
    'paidByUserId',
    'providerPayoutId',
    'paidAt',
    'returnedByUserId',
    'returnedAt',
  ],
  risk: [
    'reviewerUserId',
    'lotExternalId',
    'restoredStatus',
    'restoredRiskStatus',
    'resolutionKind',
    'resolutionRef',
  ],
  referral: ['recordedAt', 'rewardedAt'],
  allocation: [],
  release: [],
};

export function sanitizePartnerMetadataForClosure(
  kind: PartnerMetadataKind,
  metadata: unknown,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = { closureRestricted: true };
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return sanitized;
  const record = metadata as Record<string, unknown>;
  for (const key of PARTNER_METADATA_KEYS[kind]) {
    const value = record[key];
    if (
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === 'string' && value.length > 0 && value.length <= MAX_RETAINED_STRING_LENGTH)
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

interface PartnerTargetRow {
  id: number;
  metadata: unknown;
}

interface PartnerTarget {
  kind: 'delete' | 'restrict';
  selectRows(
    context: ClosureHandlerContext,
    limit: number,
    afterId: number,
  ): Promise<PartnerTargetRow[]>;
  mutateRows(context: ClosureHandlerContext, rows: readonly PartnerTargetRow[]): Promise<number>;
}

export const partnerKycLedgerClosureHandler: AccountClosureHandler = {
  categoryId: 'partner_kyc_ledger',
  version: 1,
  async run(context) {
    const pageSize = Math.min(context.pageSize, 100);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }

    let targetIndex = context.checkpoint?.targetIndex ?? 0;
    let afterId = context.checkpoint?.cursor ?? 0;
    if (
      !Number.isSafeInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex > PARTNER_TARGETS.length ||
      !Number.isSafeInteger(afterId) ||
      afterId < 0
    ) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }

    let pageProcessed = 0;
    while (targetIndex < PARTNER_TARGETS.length) {
      const remaining = pageSize - pageProcessed;
      if (remaining === 0) break;
      const target = PARTNER_TARGETS[targetIndex];
      if (!target) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      const rows = await target.selectRows(context, remaining, afterId);
      if (rows.length > remaining) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      if (rows.length === 0) {
        targetIndex += 1;
        afterId = 0;
        continue;
      }
      const mutated = await target.mutateRows(context, rows);
      if (mutated !== rows.length) throw new ClosureHandlerError('INVARIANT_VIOLATION');
      pageProcessed += mutated;
      afterId = rows[rows.length - 1]?.id ?? afterId;
      if (rows.length < remaining) {
        targetIndex += 1;
        afterId = 0;
      }
    }

    const previousProcessed = context.checkpoint?.processedCount ?? 0;
    const processed = previousProcessed + pageProcessed;
    if (targetIndex < PARTNER_TARGETS.length) {
      return {
        kind: 'continue',
        checkpoint: {
          targetIndex,
          cursor: afterId,
          processedCount: processed,
        },
        processed,
      };
    }
    const hasRestrictedRows = await hasAnyRestrictedRows(context);
    if (processed === 0) {
      return {
        kind: 'complete',
        processed: 0,
        retention: hasRestrictedRows ? 'restricted' : 'not_present',
      };
    }
    return {
      kind: 'complete',
      processed,
      retention: hasRestrictedRows ? 'restricted' : 'deleted',
    };
  },
};

async function hasAnyRestrictedRows(context: ClosureHandlerContext): Promise<boolean> {
  const result = await context.db.execute(sql`
    SELECT (
      (SELECT COUNT(*) FROM partner_kyc_profiles WHERE user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_recharge_orders WHERE user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_lots WHERE user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM hola_credit_ledger_entries WHERE user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_withdrawal_requests WHERE user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_risk_events WHERE user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_referrals WHERE inviter_user_id = ${context.request.userId} OR invitee_user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_daily_allocations AS child INNER JOIN partner_lots AS lot ON lot.id = child.lot_id WHERE lot.user_id = ${context.request.userId}) +
      (SELECT COUNT(*) FROM partner_monthly_releases AS child INNER JOIN partner_lots AS lot ON lot.id = child.lot_id WHERE lot.user_id = ${context.request.userId})
    ) AS retained_count
  `);
  const rows = Array.isArray(result) ? result[0] : null;
  const count = Array.isArray(rows)
    ? Number((rows[0] as { retained_count?: number | bigint | string } | undefined)?.retained_count)
    : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return count > 0;
}

const PARTNER_TARGETS: readonly PartnerTarget[] = [
  directDeleteTarget('partner_activity_events'),
  directDeleteTarget('partner_memberships'),
  directRestrictedTarget('partner_kyc_profiles', 'kyc'),
  directRestrictedTarget('partner_recharge_orders', 'order'),
  directRestrictedTarget('partner_lots', 'lot'),
  directRestrictedTarget('hola_credit_ledger_entries', 'ledger'),
  directRestrictedTarget(
    'partner_withdrawal_requests',
    'withdrawal',
    sql`, rejection_reason = NULL`,
  ),
  directRestrictedTarget('partner_risk_events', 'risk'),
  referralRestrictedTarget(),
  lotChildRestrictedTarget('partner_daily_allocations', 'allocation'),
  lotChildRestrictedTarget('partner_monthly_releases', 'release'),
];

function directDeleteTarget(tableName: string): PartnerTarget {
  const table = identifier(tableName);
  return {
    kind: 'delete',
    async selectRows(context, limit, afterId) {
      return readRows(
        await context.db.execute(
          sql`SELECT id, NULL AS metadata FROM ${table} WHERE user_id = ${context.request.userId} AND id > ${afterId} ORDER BY id ASC LIMIT ${limit}`,
        ),
      );
    },
    async mutateRows(context, rows) {
      const ids = rows.map((row) => row.id);
      return affectedRows(
        await context.db.execute(
          sql`DELETE FROM ${table} WHERE user_id = ${context.request.userId} AND id IN (${idList(ids)})`,
        ),
      );
    },
  };
}

function directRestrictedTarget(
  tableName: string,
  metadataKind: PartnerMetadataKind,
  extraSet: SQL = sql``,
): PartnerTarget {
  const table = identifier(tableName);
  return {
    kind: 'restrict',
    async selectRows(context, limit, afterId) {
      return readRows(
        await context.db.execute(
          sql`SELECT id, metadata FROM ${table} WHERE user_id = ${context.request.userId} AND id > ${afterId} ORDER BY id ASC LIMIT ${limit}`,
        ),
      );
    },
    async mutateRows(context, rows) {
      let affected = 0;
      for (const row of rows) {
        affected += affectedRows(
          await context.db.execute(
            sql`UPDATE ${table} SET metadata = ${metadataSql(sanitizePartnerMetadataForClosure(metadataKind, row.metadata))}${extraSet} WHERE user_id = ${context.request.userId} AND id = ${row.id}`,
          ),
        );
      }
      return affected;
    },
  };
}

function referralRestrictedTarget(): PartnerTarget {
  return {
    kind: 'restrict',
    async selectRows(context, limit, afterId) {
      return readRows(
        await context.db.execute(sql`
          SELECT id, metadata FROM partner_referrals
          WHERE (inviter_user_id = ${context.request.userId} OR invitee_user_id = ${context.request.userId})
            AND id > ${afterId}
          ORDER BY id ASC LIMIT ${limit}
        `),
      );
    },
    async mutateRows(context, rows) {
      let affected = 0;
      for (const row of rows) {
        affected += affectedRows(
          await context.db.execute(sql`
            UPDATE partner_referrals
            SET metadata = ${metadataSql(sanitizePartnerMetadataForClosure('referral', row.metadata))}
            WHERE (inviter_user_id = ${context.request.userId} OR invitee_user_id = ${context.request.userId})
              AND id = ${row.id}
          `),
        );
      }
      return affected;
    },
  };
}

function lotChildRestrictedTarget(
  tableName: string,
  metadataKind: PartnerMetadataKind,
): PartnerTarget {
  const table = identifier(tableName);
  return {
    kind: 'restrict',
    async selectRows(context, limit, afterId) {
      return readRows(
        await context.db.execute(sql`
          SELECT child.id, child.metadata FROM ${table} AS child
          INNER JOIN partner_lots AS lot ON lot.id = child.lot_id
          WHERE lot.user_id = ${context.request.userId}
            AND child.id > ${afterId}
          ORDER BY child.id ASC LIMIT ${limit}
        `),
      );
    },
    async mutateRows(context, rows) {
      let affected = 0;
      for (const row of rows) {
        affected += affectedRows(
          await context.db.execute(sql`
            UPDATE ${table} AS child
            INNER JOIN partner_lots AS lot ON lot.id = child.lot_id
            SET child.metadata = ${metadataSql(sanitizePartnerMetadataForClosure(metadataKind, row.metadata))}
            WHERE lot.user_id = ${context.request.userId}
              AND child.id = ${row.id}
          `),
        );
      }
      return affected;
    },
  };
}

function identifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return sql.identifier(value);
}

function idList(ids: readonly number[]): SQL {
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

function readRows(result: unknown): PartnerTargetRow[] {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((row) => {
    const candidate = row as { id?: number | bigint | string; metadata?: unknown };
    const id = Number(candidate.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return { id, metadata: parseMetadata(candidate.metadata) };
  });
}

function parseMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
}

function metadataSql(metadata: Record<string, string | number | boolean>): SQL {
  const pairs = Object.entries(metadata).filter(([key]) => key !== 'closureRestricted');
  if (pairs.length === 0) return RESTRICTED_METADATA;
  return sql`JSON_OBJECT('closureRestricted', TRUE, ${sql.join(
    pairs.flatMap(([key, value]) => [sql`${key}`, sql`${value}`]),
    sql`, `,
  )})`;
}

function affectedRows(result: unknown): number {
  const affected = readAffectedRows(result);
  if (!Number.isSafeInteger(affected) || affected < 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return affected;
}
