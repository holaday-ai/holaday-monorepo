import { describe, expect, it } from 'vitest';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import {
  AccountClosureReceiptService,
  type ClosureReceiptRecord,
  type ClosureReceiptStore,
  serializeApplicationReceipt,
} from './receipt-service.js';

class MemoryReceiptStore implements ClosureReceiptStore {
  private readonly rows = new Map<string, ClosureReceiptRecord>();

  async insertOrGet(row: ClosureReceiptRecord): Promise<ClosureReceiptRecord> {
    const key = `${row.requestId}:${row.kind}`;
    const current = this.rows.get(key);
    if (current) return current;
    this.rows.set(key, structuredClone(row));
    return structuredClone(row);
  }

  async find(requestId: number, kind: 'application' | 'completion') {
    return structuredClone(this.rows.get(`${requestId}:${kind}`) ?? null);
  }

  async setNotificationStatus(
    requestId: number,
    kind: 'completion',
    status: 'accepted' | 'failed',
  ) {
    const key = `${requestId}:${kind}`;
    const current = this.rows.get(key);
    if (!current) throw new Error('missing receipt');
    if (current.notificationStatus !== 'accepted') current.notificationStatus = status;
    return structuredClone(current);
  }

  count() {
    return this.rows.size;
  }
}

const requestedAt = new Date('2026-08-26T09:00:00.000Z');
const graceEndsAt = new Date('2026-09-02T09:00:00.000Z');

describe('account closure receipt service', () => {
  it('projects application receipts without internal ids, subject digests, or raw content', () => {
    const sentinel: ClosureReceiptRecord & { forbidden: Record<string, string> } = {
      requestId: 99,
      userId: 77,
      receiptNumber: 'ACR-random-123',
      kind: 'application' as const,
      subjectDigest: 'forbidden-digest',
      completedCategoryIds: [],
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
      notificationStatus: 'pending' as const,
      issuedAt: requestedAt,
      completedAt: null,
      forbidden: {
        email: 'private@example.test',
        phone: '13800138000',
        filename: 'secret.txt',
        taskText: 'private task body',
      },
    };
    const serialized = serializeApplicationReceipt(sentinel);
    expect(serialized).toEqual({
      receiptNumber: 'ACR-random-123',
      kind: 'application',
      issuedAt: requestedAt.toISOString(),
      completedCategoryIds: [],
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
    });
    const json = JSON.stringify(serialized);
    for (const forbidden of [
      'requestId',
      'userId',
      'subjectDigest',
      'email',
      'private@example.test',
      '13800138000',
      'secret.txt',
      'private task body',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('creates one immutable random application receipt across retries', async () => {
    const store = new MemoryReceiptStore();
    let sequence = 0;
    const service = new AccountClosureReceiptService(store, {
      randomReceiptNumber: () => `ACR-random-${++sequence}`,
      now: () => new Date('2026-08-29T09:00:00.000Z'),
    });
    const input = {
      requestId: 99,
      userId: 77,
      issuedAt: requestedAt,
      completedCategoryIds: [] as const,
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'] as const,
    };
    const [first, second] = await Promise.all([
      service.createApplicationReceipt(input),
      service.createApplicationReceipt(input),
    ]);
    expect(first.receiptNumber).toBe(second.receiptNumber);
    expect(first.receiptNumber).not.toMatch(/^\d+$/);
    expect(first.issuedAt).toBe(requestedAt.toISOString());
    expect(store.count()).toBe(1);
  });

  it('creates at most one separate completion receipt and validates canonical categories', async () => {
    const store = new MemoryReceiptStore();
    let sequence = 0;
    const service = new AccountClosureReceiptService(store, {
      randomReceiptNumber: () => `ACR-random-${++sequence}`,
      now: () => requestedAt,
    });
    const input = {
      requestId: 99,
      userId: 77,
      subjectDigest: 'a'.repeat(64),
      completedCategoryIds: DATA_CATEGORY_IDS,
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'] as const,
      completedAt: graceEndsAt,
    };
    const [first, second] = await Promise.all([
      service.createCompletionReceipt(input),
      service.createCompletionReceipt(input),
    ]);
    expect(first.receiptNumber).toBe(second.receiptNumber);
    expect(store.count()).toBe(1);
    expect(
      (await service.setCompletionNotificationStatus(99, 77, 'accepted')).notificationStatus,
    ).toBe('accepted');
    expect(
      (await service.setCompletionNotificationStatus(99, 77, 'failed')).notificationStatus,
    ).toBe('accepted');
    await expect(
      service.createCompletionReceipt({ ...input, subjectDigest: 'b'.repeat(64) }),
    ).rejects.toThrow('Account closure completion receipt invariant failed');
    await expect(
      service.createCompletionReceipt({
        ...input,
        requestId: 100,
        completedCategoryIds: ['not-a-category'] as never,
      }),
    ).rejects.toThrow('Invalid account closure receipt categories');
  });

  it('rejects a receipt row whose stored user does not own the request', async () => {
    const store = new MemoryReceiptStore();
    const service = new AccountClosureReceiptService(store, {
      randomReceiptNumber: () => 'ACR-random-owner-bound',
      now: () => requestedAt,
    });
    await service.createApplicationReceipt({
      requestId: 99,
      userId: 77,
      issuedAt: requestedAt,
      completedCategoryIds: [],
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
    });
    await expect(service.getApplicationReceipt(99, 78)).rejects.toThrow(
      'Account closure receipt invariant failed',
    );
  });
});
