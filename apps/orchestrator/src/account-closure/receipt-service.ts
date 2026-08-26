import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { accountClosureReceipts, accountClosureRequests } from '../db/schema/account-closures.js';
import {
  type AccountClosureCategoryId,
  type AccountClosureReceiptKind,
  parseAccountClosureReceiptCategoryIds,
} from './types.js';

export interface ClosureReceiptRecord {
  requestId: number;
  userId: number;
  receiptNumber: string;
  kind: AccountClosureReceiptKind;
  subjectDigest: string | null;
  completedCategoryIds: AccountClosureCategoryId[];
  restrictedCategoryIds: AccountClosureCategoryId[];
  notificationStatus: 'pending' | 'accepted' | 'failed';
  issuedAt: Date;
  completedAt: Date | null;
}

export interface ApplicationClosureReceipt {
  receiptNumber: string;
  kind: 'application';
  issuedAt: string;
  completedCategoryIds: AccountClosureCategoryId[];
  restrictedCategoryIds: AccountClosureCategoryId[];
}

export interface CompletionClosureReceipt {
  receiptNumber: string;
  kind: 'completion';
  issuedAt: string;
  completedAt: string | null;
  completedCategoryIds: AccountClosureCategoryId[];
  restrictedCategoryIds: AccountClosureCategoryId[];
}

export interface ClosureReceiptStore {
  insertOrGet(row: ClosureReceiptRecord): Promise<ClosureReceiptRecord>;
  insertCompletionOrGetWithLease(
    row: ClosureReceiptRecord,
    lease: CompletionReceiptLeaseInput,
  ): Promise<ClosureReceiptRecord | null>;
  find(requestId: number, kind: AccountClosureReceiptKind): Promise<ClosureReceiptRecord | null>;
  setNotificationStatusWithLease(
    input: CompletionNotificationLeaseInput,
  ): Promise<ClosureReceiptRecord | null>;
}

export interface CompletionReceiptLeaseInput {
  requestId: number;
  userId: number;
  expectedLeaseOwner: string;
  now: Date;
}

export interface CompletionNotificationLeaseInput extends CompletionReceiptLeaseInput {
  status: 'accepted' | 'failed';
}

export class AccountClosureReceiptLeaseLostError extends Error {
  constructor() {
    super('Account closure completion lease lost');
    this.name = 'AccountClosureReceiptLeaseLostError';
  }
}

export interface ReceiptServiceOptions {
  randomReceiptNumber?: () => string;
  now?: () => Date;
}

export class AccountClosureReceiptService {
  private readonly randomReceiptNumber: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly store: ClosureReceiptStore,
    options: ReceiptServiceOptions = {},
  ) {
    this.randomReceiptNumber = options.randomReceiptNumber ?? createRandomReceiptNumber;
    this.now = options.now ?? (() => new Date());
  }

  async createApplicationReceipt(input: {
    requestId: number;
    userId: number;
    issuedAt: Date;
    completedCategoryIds: readonly string[];
    restrictedCategoryIds: readonly string[];
  }): Promise<ApplicationClosureReceipt> {
    const completedCategoryIds = parseAccountClosureReceiptCategoryIds([
      ...input.completedCategoryIds,
    ]);
    const restrictedCategoryIds = parseAccountClosureReceiptCategoryIds([
      ...input.restrictedCategoryIds,
    ]);
    const row = await this.store.insertOrGet({
      requestId: input.requestId,
      userId: input.userId,
      receiptNumber: this.randomReceiptNumber(),
      kind: 'application',
      subjectDigest: null,
      completedCategoryIds,
      restrictedCategoryIds,
      notificationStatus: 'pending',
      issuedAt: input.issuedAt,
      completedAt: null,
    });
    assertReceiptIdentity(row, input.requestId, input.userId, 'application');
    return serializeApplicationReceipt(row);
  }

  async getApplicationReceipt(
    requestId: number,
    userId: number,
  ): Promise<ApplicationClosureReceipt | null> {
    const row = await this.store.find(requestId, 'application');
    if (row) assertReceiptIdentity(row, requestId, userId, 'application');
    return row ? serializeApplicationReceipt(row) : null;
  }

  async createCompletionReceipt(input: {
    requestId: number;
    userId: number;
    subjectDigest: string;
    completedCategoryIds: readonly string[];
    restrictedCategoryIds: readonly string[];
    expectedLeaseOwner: string;
    now: Date;
  }): Promise<CompletionClosureReceipt> {
    if (!/^[a-f0-9]{64}$/i.test(input.subjectDigest)) {
      throw new Error('Invalid account closure subject digest');
    }
    const completedCategoryIds = parseAccountClosureReceiptCategoryIds([
      ...input.completedCategoryIds,
    ]);
    const restrictedCategoryIds = parseAccountClosureReceiptCategoryIds([
      ...input.restrictedCategoryIds,
    ]);
    assertCompletionLeaseInput(input);
    const row = await this.store.insertCompletionOrGetWithLease(
      {
        requestId: input.requestId,
        userId: input.userId,
        receiptNumber: this.randomReceiptNumber(),
        kind: 'completion',
        subjectDigest: input.subjectDigest,
        completedCategoryIds,
        restrictedCategoryIds,
        notificationStatus: 'pending',
        issuedAt: this.now(),
        completedAt: null,
      },
      input,
    );
    if (!row) throw new AccountClosureReceiptLeaseLostError();
    assertReceiptIdentity(row, input.requestId, input.userId, 'completion');
    if (
      row.subjectDigest?.toLowerCase() !== input.subjectDigest.toLowerCase() ||
      !sameCategorySet(row.completedCategoryIds, completedCategoryIds) ||
      !sameCategorySet(row.restrictedCategoryIds, restrictedCategoryIds)
    ) {
      throw new Error('Account closure completion receipt invariant failed');
    }
    return serializeCompletionReceipt(row);
  }

  async getCompletionReceiptRecord(
    requestId: number,
    userId: number,
  ): Promise<ClosureReceiptRecord | null> {
    const row = await this.store.find(requestId, 'completion');
    if (row) assertReceiptIdentity(row, requestId, userId, 'completion');
    return row;
  }

  async setCompletionNotificationStatus(
    input: CompletionNotificationLeaseInput,
  ): Promise<ClosureReceiptRecord> {
    assertCompletionLeaseInput(input);
    const row = await this.store.setNotificationStatusWithLease(input);
    if (!row) throw new AccountClosureReceiptLeaseLostError();
    assertReceiptIdentity(row, input.requestId, input.userId, 'completion');
    return row;
  }
}

export class DatabaseClosureReceiptStore implements ClosureReceiptStore {
  constructor(private readonly db: DB) {}

  async insertOrGet(row: ClosureReceiptRecord): Promise<ClosureReceiptRecord> {
    await this.db
      .insert(accountClosureReceipts)
      .values({
        requestId: row.requestId,
        userId: row.userId,
        receiptNumber: row.receiptNumber,
        kind: row.kind,
        subjectDigest: row.subjectDigest,
        completedCategoryIds: row.completedCategoryIds,
        restrictedCategoryIds: row.restrictedCategoryIds,
        notificationStatus: row.notificationStatus,
        issuedAt: row.issuedAt,
        completedAt: row.completedAt,
      })
      .onDuplicateKeyUpdate({
        // Immutable idempotency: the unique (request, kind) winner is
        // retained byte-for-byte. The no-op assignment only lets both
        // concurrent callers converge on the subsequent explicit read.
        set: { requestId: sql`${accountClosureReceipts.requestId}` },
      });
    const persisted = await this.find(row.requestId, row.kind);
    if (!persisted) throw new Error('Account closure receipt persistence failed');
    return persisted;
  }

  async insertCompletionOrGetWithLease(
    row: ClosureReceiptRecord,
    lease: CompletionReceiptLeaseInput,
  ): Promise<ClosureReceiptRecord | null> {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select({
          userId: accountClosureRequests.userId,
          activeUserId: accountClosureRequests.activeUserId,
          status: accountClosureRequests.status,
          leaseOwner: accountClosureRequests.completionLeaseOwner,
          leaseUntil: accountClosureRequests.completionLeaseUntil,
        })
        .from(accountClosureRequests)
        .where(eq(accountClosureRequests.id, lease.requestId))
        .limit(1)
        .for('update');
      if (!hasCurrentCompletionLease(request, lease)) return null;
      await tx
        .insert(accountClosureReceipts)
        .values(receiptInsertValues(row))
        .onDuplicateKeyUpdate({
          set: { requestId: sql`${accountClosureReceipts.requestId}` },
        });
      return findReceiptInTransaction(tx, row.requestId, 'completion');
    });
  }

  async find(
    requestId: number,
    kind: AccountClosureReceiptKind,
  ): Promise<ClosureReceiptRecord | null> {
    const [row] = await this.db
      .select({
        requestId: accountClosureReceipts.requestId,
        userId: accountClosureReceipts.userId,
        receiptNumber: accountClosureReceipts.receiptNumber,
        kind: accountClosureReceipts.kind,
        subjectDigest: accountClosureReceipts.subjectDigest,
        completedCategoryIds: accountClosureReceipts.completedCategoryIds,
        restrictedCategoryIds: accountClosureReceipts.restrictedCategoryIds,
        notificationStatus: accountClosureReceipts.notificationStatus,
        issuedAt: accountClosureReceipts.issuedAt,
        completedAt: accountClosureReceipts.completedAt,
      })
      .from(accountClosureReceipts)
      .where(
        and(eq(accountClosureReceipts.requestId, requestId), eq(accountClosureReceipts.kind, kind)),
      )
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      completedCategoryIds: parseAccountClosureReceiptCategoryIds(row.completedCategoryIds),
      restrictedCategoryIds: parseAccountClosureReceiptCategoryIds(row.restrictedCategoryIds),
    };
  }

  async setNotificationStatusWithLease(
    input: CompletionNotificationLeaseInput,
  ): Promise<ClosureReceiptRecord | null> {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select({
          userId: accountClosureRequests.userId,
          activeUserId: accountClosureRequests.activeUserId,
          status: accountClosureRequests.status,
          leaseOwner: accountClosureRequests.completionLeaseOwner,
          leaseUntil: accountClosureRequests.completionLeaseUntil,
        })
        .from(accountClosureRequests)
        .where(eq(accountClosureRequests.id, input.requestId))
        .limit(1)
        .for('update');
      if (!hasCurrentCompletionLease(request, input)) return null;
      await tx
        .update(accountClosureReceipts)
        .set({ notificationStatus: input.status })
        .where(
          and(
            eq(accountClosureReceipts.requestId, input.requestId),
            eq(accountClosureReceipts.userId, input.userId),
            eq(accountClosureReceipts.kind, 'completion'),
            input.status === 'accepted'
              ? sql`${accountClosureReceipts.notificationStatus} IN ('pending', 'failed')`
              : sql`${accountClosureReceipts.notificationStatus} <> 'accepted'`,
          ),
        );
      const persisted = await findReceiptInTransaction(tx, input.requestId, 'completion');
      if (!persisted) throw new Error('Account closure receipt persistence failed');
      return persisted;
    });
  }
}

type ReceiptTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

function receiptInsertValues(row: ClosureReceiptRecord) {
  return {
    requestId: row.requestId,
    userId: row.userId,
    receiptNumber: row.receiptNumber,
    kind: row.kind,
    subjectDigest: row.subjectDigest,
    completedCategoryIds: row.completedCategoryIds,
    restrictedCategoryIds: row.restrictedCategoryIds,
    notificationStatus: row.notificationStatus,
    issuedAt: row.issuedAt,
    completedAt: row.completedAt,
  };
}

async function findReceiptInTransaction(
  tx: ReceiptTransaction,
  requestId: number,
  kind: AccountClosureReceiptKind,
): Promise<ClosureReceiptRecord | null> {
  const [row] = await tx
    .select({
      requestId: accountClosureReceipts.requestId,
      userId: accountClosureReceipts.userId,
      receiptNumber: accountClosureReceipts.receiptNumber,
      kind: accountClosureReceipts.kind,
      subjectDigest: accountClosureReceipts.subjectDigest,
      completedCategoryIds: accountClosureReceipts.completedCategoryIds,
      restrictedCategoryIds: accountClosureReceipts.restrictedCategoryIds,
      notificationStatus: accountClosureReceipts.notificationStatus,
      issuedAt: accountClosureReceipts.issuedAt,
      completedAt: accountClosureReceipts.completedAt,
    })
    .from(accountClosureReceipts)
    .where(
      and(eq(accountClosureReceipts.requestId, requestId), eq(accountClosureReceipts.kind, kind)),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    completedCategoryIds: parseAccountClosureReceiptCategoryIds(row.completedCategoryIds),
    restrictedCategoryIds: parseAccountClosureReceiptCategoryIds(row.restrictedCategoryIds),
  };
}

function hasCurrentCompletionLease(
  request:
    | {
        userId: number;
        activeUserId: number | null;
        status: string;
        leaseOwner: string | null;
        leaseUntil: Date | null;
      }
    | undefined,
  input: CompletionReceiptLeaseInput,
): boolean {
  return Boolean(
    request &&
      request.userId === input.userId &&
      request.activeUserId === input.userId &&
      request.status === 'processing' &&
      request.leaseOwner === input.expectedLeaseOwner &&
      request.leaseUntil &&
      request.leaseUntil.getTime() > input.now.getTime(),
  );
}

function assertCompletionLeaseInput(input: CompletionReceiptLeaseInput): void {
  if (
    !Number.isSafeInteger(input.requestId) ||
    input.requestId <= 0 ||
    !Number.isSafeInteger(input.userId) ||
    input.userId <= 0 ||
    !input.expectedLeaseOwner ||
    input.expectedLeaseOwner.length > 64 ||
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new Error('Invalid account closure completion lease');
  }
}

export function createDatabaseReceiptService(db: DB): AccountClosureReceiptService {
  return new AccountClosureReceiptService(new DatabaseClosureReceiptStore(db));
}

export function serializeApplicationReceipt(row: ClosureReceiptRecord): ApplicationClosureReceipt {
  if (row.kind !== 'application') throw new Error('Application receipt required');
  return {
    receiptNumber: row.receiptNumber,
    kind: 'application',
    issuedAt: row.issuedAt.toISOString(),
    completedCategoryIds: [...row.completedCategoryIds],
    restrictedCategoryIds: [...row.restrictedCategoryIds],
  };
}

function serializeCompletionReceipt(row: ClosureReceiptRecord): CompletionClosureReceipt {
  if (row.kind !== 'completion') throw new Error('Completion receipt required');
  return {
    receiptNumber: row.receiptNumber,
    kind: 'completion',
    issuedAt: row.issuedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedCategoryIds: [...row.completedCategoryIds],
    restrictedCategoryIds: [...row.restrictedCategoryIds],
  };
}

function createRandomReceiptNumber(): string {
  return `ACR-${randomBytes(18).toString('base64url')}`;
}

function assertReceiptIdentity(
  row: ClosureReceiptRecord,
  requestId: number,
  userId: number,
  kind: AccountClosureReceiptKind,
): void {
  if (row.requestId !== requestId || row.userId !== userId || row.kind !== kind) {
    throw new Error('Account closure receipt invariant failed');
  }
}

function sameCategorySet(
  left: readonly AccountClosureCategoryId[],
  right: readonly AccountClosureCategoryId[],
): boolean {
  return left.length === right.length && left.every((categoryId) => right.includes(categoryId));
}
