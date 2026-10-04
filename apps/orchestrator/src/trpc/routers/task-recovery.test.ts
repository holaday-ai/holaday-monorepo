import { describe, expect, it } from 'vitest';
import { __taskRecoveryInternals } from './task-recovery.js';

const { deriveTaskRefundState, retryableInputFiles } = __taskRecoveryInternals;

const NOW = Date.parse('2026-10-04T08:00:00.000Z');
const HOUR = 60 * 60_000;
const failed = (errorCode: string | null, errorMessage: string | null = null) => ({
  status: 'failed',
  errorCode,
  errorMessage,
});

describe('deriveTaskRefundState', () => {
  it('reports not_charged when the task has no ledger row', () => {
    expect(deriveTaskRefundState(failed('PROVIDER_ERROR'), null, NOW)).toBe('not_charged');
  });

  it('reports refunded once the ledger row is claimed, whatever the cause', () => {
    const ledger = { chargedAt: new Date(NOW - HOUR), refundedAt: new Date(NOW - 1000) };
    expect(deriveTaskRefundState(failed('MEDIA_VIDEO_FAILED'), ledger, NOW)).toBe('refunded');
  });

  it('reports pending for a recent platform-side failure the sweeper will refund', () => {
    const ledger = { chargedAt: new Date(NOW - HOUR), refundedAt: null };
    expect(deriveTaskRefundState(failed('PROVIDER_ERROR'), ledger, NOW)).toBe('pending');
    expect(deriveTaskRefundState(failed('EXECUTION_TIMEOUT'), ledger, NOW)).toBe('pending');
  });

  it('never promises a refund for content failures or user cancellations', () => {
    const ledger = { chargedAt: new Date(NOW - HOUR), refundedAt: null };
    expect(deriveTaskRefundState(failed('CONTENT_REJECTED'), ledger, NOW)).toBe('not_refundable');
    expect(
      deriveTaskRefundState(
        { status: 'cancelled', errorCode: 'PROVIDER_ERROR', errorMessage: null },
        ledger,
        NOW,
      ),
    ).toBe('not_refundable');
  });

  it('routes an aged-out platform failure to support instead of claiming pending', () => {
    const ledger = { chargedAt: new Date(NOW - 8 * 24 * HOUR), refundedAt: null };
    expect(deriveTaskRefundState(failed('PROVIDER_ERROR'), ledger, NOW)).toBe('contact_support');
  });
});

describe('retryableInputFiles', () => {
  const row = (id: string, extra: Partial<{ status: string; expiresAt: Date | null }> = {}) => ({
    externalId: id,
    filename: `${id}.pdf`,
    mimetype: 'application/pdf',
    status: 'active',
    expiresAt: null,
    ...extra,
  });

  it('keeps readable inputs in upload order', () => {
    expect(retryableInputFiles([row('f1'), row('f2')], NOW)).toEqual({
      files: [
        { fileId: 'f1', filename: 'f1.pdf', mimetype: 'application/pdf' },
        { fileId: 'f2', filename: 'f2.pdf', mimetype: 'application/pdf' },
      ],
      unavailableCount: 0,
    });
  });

  it('counts expired or removed inputs instead of resending them', () => {
    const out = retryableInputFiles(
      [
        row('ok'),
        row('gone', { status: 'expired' }),
        row('late', { expiresAt: new Date(NOW - 1) }),
      ],
      NOW,
    );
    expect(out.files.map((f) => f.fileId)).toEqual(['ok']);
    expect(out.unavailableCount).toBe(2);
  });

  it('caps the resend list at the tasks.create attachment limit', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => row(id));
    const out = retryableInputFiles(rows, NOW);
    expect(out.files).toHaveLength(5);
    expect(out.unavailableCount).toBe(1);
  });
});
