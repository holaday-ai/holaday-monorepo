import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DataCategoryId } from '../data-governance/types.js';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import type { StorageProvider } from '../files/storage-provider.js';
import type { AccountClosureRetentionOutcome } from './types.js';

export type ClosureCheckpoint = {
  targetIndex?: number;
  cursor?: number;
  processedCount: number;
} | null;

export interface ClosureHandlerContext {
  db: DB;
  logger: Logger;
  storage: StorageProvider;
  request: {
    id: number;
    externalId: string;
    userId: number;
    userExternalId: string;
  };
  checkpoint: ClosureCheckpoint;
  pageSize: 100;
}

export type ClosureHandlerResult =
  | { kind: 'continue'; checkpoint: NonNullable<ClosureCheckpoint>; processed: number }
  | {
      kind: 'complete';
      processed: number;
      retention: AccountClosureRetentionOutcome;
    };

export interface AccountClosureHandler {
  categoryId: DataCategoryId;
  version: 1;
  run(context: ClosureHandlerContext): Promise<ClosureHandlerResult>;
}

export type ClosureHandlerErrorCode =
  | 'HANDLER_DEFERRED'
  | 'CAPABILITY_CHANGED'
  | 'EXTERNAL_RETENTION_REQUIRED'
  | 'INVARIANT_VIOLATION';

export class ClosureHandlerError extends Error {
  constructor(public readonly code: ClosureHandlerErrorCode) {
    super(code);
    this.name = 'ClosureHandlerError';
  }
}

export interface RelationalDeleteTarget {
  selectOwnedIds(context: ClosureHandlerContext, limit: number): Promise<number[]>;
  deleteOwnedIds(context: ClosureHandlerContext, ids: readonly number[]): Promise<number>;
}

interface RelationalHandlerOptions {
  categoryId: DataCategoryId;
  targets: readonly RelationalDeleteTarget[];
  preflight?: (context: ClosureHandlerContext) => Promise<void>;
  retention?: Exclude<ClosureHandlerResult & { kind: 'complete' }, never>['retention'];
}

/**
 * Deletes one deterministic, globally bounded page. Every target owns its
 * selection and mutation predicate; this coordinator never infers ownership
 * from a previously selected row alone.
 */
export function createRelationalDeleteHandler(
  options: RelationalHandlerOptions,
): AccountClosureHandler {
  return {
    categoryId: options.categoryId,
    version: 1,
    async run(context) {
      const pageSize = Math.min(context.pageSize, 100);
      if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      await options.preflight?.(context);

      const previousProcessed = context.checkpoint?.processedCount ?? 0;
      let pageProcessed = 0;
      for (const target of options.targets) {
        const remaining = pageSize - pageProcessed;
        if (remaining === 0) break;
        const ids = await target.selectOwnedIds(context, remaining);
        if (ids.length > remaining || ids.some((id) => !Number.isSafeInteger(id) || id < 0)) {
          throw new ClosureHandlerError('INVARIANT_VIOLATION');
        }
        if (ids.length === 0) continue;
        const deleted = await target.deleteOwnedIds(context, ids);
        if (deleted !== ids.length) throw new ClosureHandlerError('INVARIANT_VIOLATION');
        pageProcessed += deleted;
      }

      const processed = previousProcessed + pageProcessed;
      const remaining = await hasAnyOwnedRows(context, options.targets);
      if (remaining) {
        return { kind: 'continue', checkpoint: { processedCount: processed }, processed };
      }
      return {
        kind: 'complete',
        processed,
        retention: processed === 0 ? 'not_present' : (options.retention ?? 'deleted'),
      };
    },
  };
}

export function createNoAccountAssociationHandler(
  categoryId: DataCategoryId,
  countAssociations: (context: ClosureHandlerContext) => Promise<number>,
): AccountClosureHandler {
  return {
    categoryId,
    version: 1,
    async run(context) {
      const associations = await countAssociations(context);
      if (!Number.isSafeInteger(associations) || associations < 0) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      if (associations !== 0) throw new ClosureHandlerError('CAPABILITY_CHANGED');
      return { kind: 'complete', processed: 0, retention: 'not_present' };
    },
  };
}

/**
 * Proves no relational association was added, then blocks until the
 * separately governed external-retention workflow is complete.
 */
export function createExternalRetentionHandler(
  categoryId: DataCategoryId,
  countAssociations: (context: ClosureHandlerContext) => Promise<number>,
): AccountClosureHandler {
  return {
    categoryId,
    version: 1,
    async run(context) {
      const associations = await countAssociations(context);
      if (!Number.isSafeInteger(associations) || associations < 0) {
        throw new ClosureHandlerError('INVARIANT_VIOLATION');
      }
      if (associations !== 0) throw new ClosureHandlerError('CAPABILITY_CHANGED');
      throw new ClosureHandlerError('EXTERNAL_RETENTION_REQUIRED');
    },
  };
}

export function createDeferredClosureHandler(categoryId: DataCategoryId): AccountClosureHandler {
  return {
    categoryId,
    version: 1,
    async run() {
      throw new ClosureHandlerError('HANDLER_DEFERRED');
    },
  };
}

/** Direct `table.user_id = request.userId` ownership. */
export function directUserRows(tableName: string, userColumn = 'user_id'): RelationalDeleteTarget {
  const table = identifier(tableName);
  const owner = identifier(userColumn);
  return {
    async selectOwnedIds(context, limit) {
      return selectIds(
        await context.db.execute(
          sql`SELECT id FROM ${table} WHERE ${owner} = ${context.request.userId} ORDER BY id ASC LIMIT ${limit}`,
        ),
      );
    },
    async deleteOwnedIds(context, ids) {
      if (ids.length === 0) return 0;
      return affectedRows(
        await context.db.execute(
          sql`DELETE FROM ${table} WHERE ${owner} = ${context.request.userId} AND id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    },
  };
}

/** Child ownership proven by joining a user-owned parent on every read and mutation. */
export function rowsOwnedThroughParent(input: {
  tableName: string;
  parentTableName: string;
  childParentColumn: string;
  parentJoinColumn?: string;
  parentUserColumn?: string;
}): RelationalDeleteTarget {
  const child = identifier(input.tableName);
  const parent = identifier(input.parentTableName);
  const childParent = identifier(input.childParentColumn);
  const parentJoin = identifier(input.parentJoinColumn ?? 'id');
  const parentOwner = identifier(input.parentUserColumn ?? 'user_id');
  return {
    async selectOwnedIds(context, limit) {
      return selectIds(
        await context.db.execute(
          sql`SELECT child.id FROM ${child} AS child INNER JOIN ${parent} AS parent ON parent.${parentJoin} = child.${childParent} WHERE parent.${parentOwner} = ${context.request.userId} ORDER BY child.id ASC LIMIT ${limit}`,
        ),
      );
    },
    async deleteOwnedIds(context, ids) {
      if (ids.length === 0) return 0;
      return affectedRows(
        await context.db.execute(
          sql`DELETE child FROM ${child} AS child INNER JOIN ${parent} AS parent ON parent.${parentJoin} = child.${childParent} WHERE parent.${parentOwner} = ${context.request.userId} AND child.id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    },
  };
}

/** Child ownership proven through a parent and then a user-owned grandparent. */
export function rowsOwnedThroughGrandparent(input: {
  tableName: string;
  parentTableName: string;
  ownerTableName: string;
  childParentColumn: string;
  parentOwnerColumn: string;
  parentJoinColumn?: string;
  ownerJoinColumn?: string;
  ownerUserColumn?: string;
}): RelationalDeleteTarget {
  const child = identifier(input.tableName);
  const parent = identifier(input.parentTableName);
  const ownerTable = identifier(input.ownerTableName);
  const childParent = identifier(input.childParentColumn);
  const parentOwner = identifier(input.parentOwnerColumn);
  const parentJoin = identifier(input.parentJoinColumn ?? 'id');
  const ownerJoin = identifier(input.ownerJoinColumn ?? 'id');
  const ownerUser = identifier(input.ownerUserColumn ?? 'user_id');
  return {
    async selectOwnedIds(context, limit) {
      return selectIds(
        await context.db.execute(
          sql`SELECT child.id FROM ${child} AS child INNER JOIN ${parent} AS parent ON parent.${parentJoin} = child.${childParent} INNER JOIN ${ownerTable} AS owner_table ON owner_table.${ownerJoin} = parent.${parentOwner} WHERE owner_table.${ownerUser} = ${context.request.userId} ORDER BY child.id ASC LIMIT ${limit}`,
        ),
      );
    },
    async deleteOwnedIds(context, ids) {
      if (ids.length === 0) return 0;
      return affectedRows(
        await context.db.execute(
          sql`DELETE child FROM ${child} AS child INNER JOIN ${parent} AS parent ON parent.${parentJoin} = child.${childParent} INNER JOIN ${ownerTable} AS owner_table ON owner_table.${ownerJoin} = parent.${parentOwner} WHERE owner_table.${ownerUser} = ${context.request.userId} AND child.id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    },
  };
}

/** Child ownership proven through three relation hops to a user-owned root. */
export function rowsOwnedThroughThreeParents(input: {
  tableName: string;
  parentTableName: string;
  ancestorTableName: string;
  ownerTableName: string;
  childParentColumn: string;
  parentAncestorColumn: string;
  ancestorOwnerColumn: string;
  parentJoinColumn?: string;
  ancestorJoinColumn?: string;
  ownerJoinColumn?: string;
  ownerUserColumn?: string;
}): RelationalDeleteTarget {
  const child = identifier(input.tableName);
  const parent = identifier(input.parentTableName);
  const ancestor = identifier(input.ancestorTableName);
  const ownerTable = identifier(input.ownerTableName);
  const childParent = identifier(input.childParentColumn);
  const parentAncestor = identifier(input.parentAncestorColumn);
  const ancestorOwner = identifier(input.ancestorOwnerColumn);
  const parentJoin = identifier(input.parentJoinColumn ?? 'id');
  const ancestorJoin = identifier(input.ancestorJoinColumn ?? 'id');
  const ownerJoin = identifier(input.ownerJoinColumn ?? 'id');
  const ownerUser = identifier(input.ownerUserColumn ?? 'user_id');
  return {
    async selectOwnedIds(context, limit) {
      return selectIds(
        await context.db.execute(
          sql`SELECT child.id FROM ${child} AS child INNER JOIN ${parent} AS parent ON parent.${parentJoin} = child.${childParent} INNER JOIN ${ancestor} AS ancestor ON ancestor.${ancestorJoin} = parent.${parentAncestor} INNER JOIN ${ownerTable} AS owner_table ON owner_table.${ownerJoin} = ancestor.${ancestorOwner} WHERE owner_table.${ownerUser} = ${context.request.userId} ORDER BY child.id ASC LIMIT ${limit}`,
        ),
      );
    },
    async deleteOwnedIds(context, ids) {
      if (ids.length === 0) return 0;
      return affectedRows(
        await context.db.execute(
          sql`DELETE child FROM ${child} AS child INNER JOIN ${parent} AS parent ON parent.${parentJoin} = child.${childParent} INNER JOIN ${ancestor} AS ancestor ON ancestor.${ancestorJoin} = parent.${parentAncestor} INNER JOIN ${ownerTable} AS owner_table ON owner_table.${ownerJoin} = ancestor.${ancestorOwner} WHERE owner_table.${ownerUser} = ${context.request.userId} AND child.id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    },
  };
}

export async function assertNoOwnedRows(
  context: ClosureHandlerContext,
  targets: readonly RelationalDeleteTarget[],
  code: ClosureHandlerErrorCode = 'HANDLER_DEFERRED',
): Promise<void> {
  if (await hasAnyOwnedRows(context, targets)) throw new ClosureHandlerError(code);
}

export function readQueryCount(result: unknown, column = 'association_count'): number {
  const rows = Array.isArray(result) ? result[0] : null;
  const row = Array.isArray(rows)
    ? (rows[0] as Record<string, number | string | bigint | undefined> | undefined)
    : undefined;
  const count = Number(row?.[column] ?? Number.NaN);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return count;
}

async function hasAnyOwnedRows(
  context: ClosureHandlerContext,
  targets: readonly RelationalDeleteTarget[],
): Promise<boolean> {
  for (const target of targets) {
    if ((await target.selectOwnedIds(context, 1)).length !== 0) return true;
  }
  return false;
}

function identifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return sql.identifier(value);
}

function selectIds(result: unknown): number[] {
  const rows = Array.isArray(result) ? result[0] : null;
  if (!Array.isArray(rows)) throw new ClosureHandlerError('INVARIANT_VIOLATION');
  return rows.map((row) => {
    const id = Number((row as { id?: number | string | bigint }).id);
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new ClosureHandlerError('INVARIANT_VIOLATION');
    }
    return id;
  });
}

function affectedRows(result: unknown): number {
  const affected = readAffectedRows(result);
  if (!Number.isSafeInteger(affected) || affected < 0) {
    throw new ClosureHandlerError('INVARIANT_VIOLATION');
  }
  return affected;
}
