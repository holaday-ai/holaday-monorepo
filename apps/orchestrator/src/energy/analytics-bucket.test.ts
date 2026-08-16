import { describe, expect, it } from 'vitest';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-16T23:59:59.999Z');

interface AnalyticsContractModule {
  energyEventInput: { parse: (input: unknown) => Record<string, unknown> };
}

interface AnalyticsBucketModule {
  normalizeEnergyBucket: (
    input: Record<string, unknown>,
    now: Date,
    retentionDays: number,
  ) => Record<string, unknown>;
  hashEnergyVisitor: (secret: string, userId: string) => string;
  utcDate: (now: Date) => string;
  addUtcHours: (now: Date, hours: number) => Date;
  addUtcDaysFromDate: (date: string, days: number) => Date;
  energyAnalyticsConfigFromEnv: (source: Record<string, unknown>) => Record<string, unknown>;
}

async function loadContract(): Promise<AnalyticsContractModule | null> {
  const modulePath = './analytics-contract.js';
  return import(modulePath).catch(() => null) as Promise<AnalyticsContractModule | null>;
}

async function loadBucket(): Promise<AnalyticsBucketModule | null> {
  const modulePath = './analytics-bucket.js';
  return import(modulePath).catch(() => null) as Promise<AnalyticsBucketModule | null>;
}

describe('energy analytics contract and bucket normalization', () => {
  it('accepts bounded new and legacy events while rejecting private bodies', async () => {
    const contract = await loadContract();
    expect(contract).not.toBeNull();
    if (!contract) return;

    expect(
      contract.energyEventInput.parse({ type: 'energy_home_viewed', eventId: UUID_A }),
    ).toEqual({ type: 'energy_home_viewed', eventId: UUID_A });
    expect(
      contract.energyEventInput.parse({ type: 'energy_need_selected', energyNeed: 'relax' }),
    ).toEqual({ type: 'energy_need_selected', energyNeed: 'relax' });
    expect(
      contract.energyEventInput.parse({
        type: 'replayed',
        experienceId: 'tarot',
        energyNeed: 'relax',
        durationBucket: null,
        outcome: null,
      }),
    ).toMatchObject({ type: 'replayed', experienceId: 'tarot' });
    expect(() =>
      contract.energyEventInput.parse({
        type: 'light_test_completed',
        testId: 'emotion-battery',
        answerText: 'private answer',
      }),
    ).toThrow();
    expect(() =>
      contract.energyEventInput.parse({
        type: 'astrology_range_opened',
        range: 'daily',
        providerBody: 'private provider response',
      }),
    ).toThrow();
    expect(() =>
      contract.energyEventInput.parse({
        type: 'energy_content_opened',
        contentId: 'made-up-content',
      }),
    ).toThrow();
  });

  it('maps legacy replay to one canonical privacy-safe bucket', async () => {
    const contract = await loadContract();
    const bucket = await loadBucket();
    expect(contract).not.toBeNull();
    expect(bucket).not.toBeNull();
    if (!contract || !bucket) return;

    const normalized = bucket.normalizeEnergyBucket(
      contract.energyEventInput.parse({
        type: 'replayed',
        experienceId: 'tarot',
        energyNeed: 'relax',
        durationBucket: null,
        outcome: null,
      }),
      NOW,
      400,
    );

    expect(normalized).toMatchObject({
      metricDate: '2026-08-16',
      eventType: 'energy_experience_replayed',
      experienceId: 'tarot',
      modeId: '',
      energyNeed: 'relax',
      durationBucket: '',
      outcome: '',
      batchCount: 0,
      expiresAt: new Date('2027-09-20T00:00:00.000Z'),
    });
  });

  it('keeps event ids and user identity out of stable aggregate hashes', async () => {
    const contract = await loadContract();
    const bucket = await loadBucket();
    expect(contract).not.toBeNull();
    expect(bucket).not.toBeNull();
    if (!contract || !bucket) return;

    const left = bucket.normalizeEnergyBucket(
      contract.energyEventInput.parse({ type: 'energy_home_viewed', eventId: UUID_A }),
      NOW,
      400,
    );
    const right = bucket.normalizeEnergyBucket(
      contract.energyEventInput.parse({ type: 'energy_home_viewed', eventId: UUID_B }),
      NOW,
      400,
    );

    expect(left.bucketHash).toBe(right.bucketHash);
    expect(String(left.bucketHash)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(left)).not.toContain(UUID_A);
    expect(JSON.stringify(left)).not.toContain('usr_energy');
  });

  it('normalizes content-hub dimensions into fixed columns', async () => {
    const contract = await loadContract();
    const bucket = await loadBucket();
    expect(contract).not.toBeNull();
    expect(bucket).not.toBeNull();
    if (!contract || !bucket) return;

    const fixtures = [
      [
        { type: 'astrology_range_opened', range: 'monthly' },
        { eventType: 'astrology_range_opened', rangeKey: 'monthly' },
      ],
      [
        { type: 'light_test_completed', testId: 'emotion-battery' },
        { eventType: 'light_test_completed', modeId: 'emotion-battery' },
      ],
      [
        { type: 'energy_continuation_opened', fromKind: 'tarot', targetType: 'test' },
        { eventType: 'energy_continuation_opened', sourceKind: 'tarot', targetType: 'test' },
      ],
      [
        { type: 'running_task_returned', taskStatus: 'waiting' },
        { eventType: 'running_task_returned', taskStatus: 'waiting' },
      ],
    ] as const;

    for (const [input, expected] of fixtures) {
      expect(
        bucket.normalizeEnergyBucket(contract.energyEventInput.parse(input), NOW, 400),
      ).toMatchObject(expected);
    }
  });

  it('uses UTC boundaries and an independent HMAC-SHA256 visitor key', async () => {
    const bucket = await loadBucket();
    expect(bucket).not.toBeNull();
    if (!bucket) return;

    expect(bucket.utcDate(new Date('2026-08-16T23:59:59.999-07:00'))).toBe('2026-08-17');
    expect(bucket.addUtcHours(new Date('2026-08-16T23:30:00.000Z'), 48)).toEqual(
      new Date('2026-08-18T23:30:00.000Z'),
    );
    expect(bucket.addUtcDaysFromDate('2026-08-16', 30)).toEqual(
      new Date('2026-09-15T00:00:00.000Z'),
    );
    expect(bucket.hashEnergyVisitor('0123456789abcdef0123456789abcdef', 'usr_energy')).toBe(
      '17c22fb1406493f294f9d5e9db5578323eaad7b93497d26e557c92827aa69418',
    );
  });

  it('copies only the five analytics configuration values', async () => {
    const bucket = await loadBucket();
    expect(bucket).not.toBeNull();
    if (!bucket) return;

    expect(
      bucket.energyAnalyticsConfigFromEnv({
        ENERGY_ANALYTICS_ENABLED: true,
        ENERGY_ANALYTICS_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
        ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: 30,
        ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: 400,
        ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: 48,
        JWT_SECRET: 'must-not-be-copied',
      }),
    ).toEqual({
      enabled: true,
      hmacSecret: '0123456789abcdef0123456789abcdef',
      visitorRetentionDays: 30,
      metricRetentionDays: 400,
      receiptRetentionHours: 48,
    });
  });
});
