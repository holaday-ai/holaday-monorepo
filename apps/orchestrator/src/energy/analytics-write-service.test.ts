import { describe, expect, it, vi } from 'vitest';
import type { EnergyAnalyticsConfig, NormalizedEnergyBucket } from './analytics-bucket.js';
import { energyEventInput } from './analytics-contract.js';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

const ENABLED_CONFIG: EnergyAnalyticsConfig = {
  enabled: true,
  hmacSecret: '0123456789abcdef0123456789abcdef',
  visitorRetentionDays: 30,
  metricRetentionDays: 400,
  receiptRetentionHours: 48,
};

interface ReceiptState {
  eventId: string;
  expiresAt: Date;
}

interface VisitorState {
  activityDate: string;
  visitorHash: string;
  expiresAt: Date;
}

interface MetricState extends NormalizedEnergyBucket {
  eventCount: number;
}

interface TransactionShape {
  claimReceipt(eventId: string, expiresAt: Date): Promise<boolean>;
  incrementMetric(bucket: NormalizedEnergyBucket): Promise<void>;
  insertVisitor(activityDate: string, visitorHash: string, expiresAt: Date): Promise<boolean>;
}

class InMemoryEnergyAnalyticsStore {
  readonly receipts = new Map<string, ReceiptState>();
  readonly metrics = new Map<string, MetricState>();
  readonly visitors = new Map<string, VisitorState>();
  transactions = 0;
  failMetricIncrement = false;

  async transaction<T>(callback: (tx: TransactionShape) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const receipts = new Map(this.receipts);
    const metrics = new Map(this.metrics);
    const visitors = new Map(this.visitors);
    const tx: TransactionShape = {
      claimReceipt: async (eventId, expiresAt) => {
        if (receipts.has(eventId)) return false;
        receipts.set(eventId, { eventId, expiresAt });
        return true;
      },
      incrementMetric: async (bucket) => {
        if (this.failMetricIncrement) throw new Error('metric write failed');
        const key = `${bucket.metricDate}:${bucket.bucketHash}`;
        const previous = metrics.get(key);
        metrics.set(key, {
          ...bucket,
          eventCount: (previous?.eventCount ?? 0) + 1,
        });
      },
      insertVisitor: async (activityDate, visitorHash, expiresAt) => {
        const key = `${activityDate}:${visitorHash}`;
        if (visitors.has(key)) return false;
        visitors.set(key, { activityDate, visitorHash, expiresAt });
        return true;
      },
    };

    const result = await callback(tx);
    this.receipts.clear();
    this.metrics.clear();
    this.visitors.clear();
    for (const [key, value] of receipts) this.receipts.set(key, value);
    for (const [key, value] of metrics) this.metrics.set(key, value);
    for (const [key, value] of visitors) this.visitors.set(key, value);
    return result;
  }
}

interface WriteServiceModule {
  recordEnergyEvent: (input: {
    store: InMemoryEnergyAnalyticsStore;
    input: ReturnType<typeof energyEventInput.parse>;
    userId: string;
    now: Date;
    config: EnergyAnalyticsConfig;
    logger: { warn: ReturnType<typeof vi.fn> };
  }) => Promise<{ ok: true; duplicate: boolean; visitorRecorded: boolean }>;
}

async function loadWriteService(): Promise<WriteServiceModule | null> {
  const modulePath = './analytics-write-service.js';
  return import(modulePath).catch(() => null) as Promise<WriteServiceModule | null>;
}

function homeEvent(eventId: string | undefined) {
  return energyEventInput.parse({
    ...(eventId ? { eventId } : {}),
    type: 'energy_home_viewed',
  });
}

describe('recordEnergyEvent', () => {
  it('records receipt, aggregate and anonymous home visitor atomically', async () => {
    const service = await loadWriteService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new InMemoryEnergyAnalyticsStore();
    const logger = { warn: vi.fn() };

    const result = await service.recordEnergyEvent({
      store,
      input: homeEvent(UUID_A),
      userId: 'usr_energy',
      now: NOW,
      config: ENABLED_CONFIG,
      logger,
    });

    expect(result).toEqual({ ok: true, duplicate: false, visitorRecorded: true });
    expect([...store.receipts.values()]).toEqual([
      { eventId: UUID_A, expiresAt: new Date('2026-08-18T12:00:00.000Z') },
    ]);
    expect([...store.metrics.values()][0]).toMatchObject({
      eventType: 'energy_home_viewed',
      eventCount: 1,
      expiresAt: new Date('2027-09-20T00:00:00.000Z'),
    });
    expect([...store.visitors.values()][0]).toMatchObject({
      activityDate: '2026-08-16',
      expiresAt: new Date('2026-09-15T00:00:00.000Z'),
    });
    expect(JSON.stringify([...store.visitors.values()])).not.toContain('usr_energy');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns duplicate without incrementing a retried event id', async () => {
    const service = await loadWriteService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new InMemoryEnergyAnalyticsStore();
    const logger = { warn: vi.fn() };
    const args = {
      store,
      input: homeEvent(UUID_A),
      userId: 'usr_energy',
      now: NOW,
      config: ENABLED_CONFIG,
      logger,
    };

    await service.recordEnergyEvent(args);
    const retry = await service.recordEnergyEvent(args);

    expect(retry).toEqual({ ok: true, duplicate: true, visitorRecorded: false });
    expect([...store.metrics.values()][0]?.eventCount).toBe(1);
    expect(store.receipts.size).toBe(1);
    expect(store.visitors.size).toBe(1);
  });

  it('rolls back a claimed receipt when the metric increment fails', async () => {
    const service = await loadWriteService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new InMemoryEnergyAnalyticsStore();
    store.failMetricIncrement = true;

    await expect(
      service.recordEnergyEvent({
        store,
        input: homeEvent(UUID_A),
        userId: 'usr_energy',
        now: NOW,
        config: ENABLED_CONFIG,
        logger: { warn: vi.fn() },
      }),
    ).rejects.toThrow('metric write failed');
    expect(store.receipts.size).toBe(0);
    expect(store.metrics.size).toBe(0);
    expect(store.visitors.size).toBe(0);
  });

  it('performs no transaction while the feature flag is disabled', async () => {
    const service = await loadWriteService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new InMemoryEnergyAnalyticsStore();

    await expect(
      service.recordEnergyEvent({
        store,
        input: homeEvent(UUID_A),
        userId: 'usr_energy',
        now: NOW,
        config: { ...ENABLED_CONFIG, enabled: false },
        logger: { warn: vi.fn() },
      }),
    ).resolves.toEqual({ ok: true, duplicate: false, visitorRecorded: false });
    expect(store.transactions).toBe(0);
  });

  it('keeps legacy clients without eventId writable but without retry dedupe', async () => {
    const service = await loadWriteService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new InMemoryEnergyAnalyticsStore();
    const args = {
      store,
      input: homeEvent(undefined),
      userId: 'usr_energy',
      now: NOW,
      config: ENABLED_CONFIG,
      logger: { warn: vi.fn() },
    };

    await service.recordEnergyEvent(args);
    await service.recordEnergyEvent(args);

    expect(store.receipts.size).toBe(0);
    expect([...store.metrics.values()][0]?.eventCount).toBe(2);
    expect(store.visitors.size).toBe(1);
  });

  it('continues aggregate writes and warns once when the HMAC secret is missing', async () => {
    const service = await loadWriteService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new InMemoryEnergyAnalyticsStore();
    const logger = { warn: vi.fn() };
    const config = { ...ENABLED_CONFIG, hmacSecret: '' };

    for (const eventId of [UUID_B, UUID_C]) {
      await service.recordEnergyEvent({
        store,
        input: homeEvent(eventId),
        userId: 'usr_private',
        now: NOW,
        config,
        logger,
      });
    }

    expect([...store.metrics.values()][0]?.eventCount).toBe(2);
    expect(store.visitors.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { feature: 'energy_analytics_visitors' },
      'energy analytics visitor HMAC secret missing; visitor metrics skipped',
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/usr_private|11111111|22222222/);
  });
});
