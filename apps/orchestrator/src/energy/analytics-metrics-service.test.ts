import { describe, expect, it, vi } from 'vitest';
import type { EnergyMetricsResult } from './analytics-metrics-service.js';

const NOW = new Date('2026-08-16T12:00:00.000Z');

interface MetricReadRow {
  metricDate: string;
  eventType: string;
  experienceId: string;
  eventCount: number;
}

interface AudienceReadRow {
  activityDate: string;
  dau: number;
  d1Returning: number;
}

class ReadStore {
  constructor(
    readonly metricRows: MetricReadRow[],
    readonly audienceRows: AudienceReadRow[],
  ) {}

  async readMetricRows() {
    return this.metricRows;
  }

  async readDailyAudience() {
    return this.audienceRows;
  }
}

interface MetricsServiceModule {
  queryEnergyMetrics(options: {
    store: ReadStore;
    window: 7 | 30;
    now: Date;
  }): Promise<EnergyMetricsResult>;
}

async function loadMetricsService(): Promise<MetricsServiceModule | null> {
  const modulePath = './analytics-metrics-service.js';
  return import(modulePath).catch(() => null) as Promise<MetricsServiceModule | null>;
}

describe('queryEnergyMetrics', () => {
  it('returns only deterministic 7-day aggregates and complete D1 cohorts', async () => {
    const service = await loadMetricsService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new ReadStore(
      [
        {
          metricDate: '2026-08-14',
          eventType: 'energy_home_viewed',
          experienceId: '',
          eventCount: 10,
        },
        {
          metricDate: '2026-08-15',
          eventType: 'energy_home_viewed',
          experienceId: '',
          eventCount: 4,
        },
        {
          metricDate: '2026-08-14',
          eventType: 'energy_experience_started',
          experienceId: 'tarot',
          eventCount: 6,
        },
        {
          metricDate: '2026-08-14',
          eventType: 'energy_experience_replayed',
          experienceId: 'tarot',
          eventCount: 2,
        },
        {
          metricDate: '2026-08-14',
          eventType: 'energy_experience_completed',
          experienceId: 'tarot',
          eventCount: 5,
        },
        {
          metricDate: '2026-08-14',
          eventType: 'energy_experience_failed',
          experienceId: 'tarot',
          eventCount: 1,
        },
      ],
      [
        { activityDate: '2026-08-14', dau: 8, d1Returning: 3 },
        { activityDate: '2026-08-15', dau: 4, d1Returning: 4 },
      ],
    );

    const result = await service.queryEnergyMetrics({ store, window: 7, now: NOW });

    expect(result).toEqual({
      window: 7,
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      daily: [
        { date: '2026-08-10', homeViews: 0, dau: 0, d1Returning: 0, d1Rate: null },
        { date: '2026-08-11', homeViews: 0, dau: 0, d1Returning: 0, d1Rate: null },
        { date: '2026-08-12', homeViews: 0, dau: 0, d1Returning: 0, d1Rate: null },
        { date: '2026-08-13', homeViews: 0, dau: 0, d1Returning: 0, d1Rate: null },
        { date: '2026-08-14', homeViews: 10, dau: 8, d1Returning: 3, d1Rate: 0.375 },
        { date: '2026-08-15', homeViews: 4, dau: 4, d1Returning: null, d1Rate: null },
        { date: '2026-08-16', homeViews: 0, dau: 0, d1Returning: null, d1Rate: null },
      ],
      experiences: expect.arrayContaining([
        {
          experienceId: 'tarot',
          started: 6,
          replayed: 2,
          completed: 5,
          failed: 1,
          completionRate: 0.625,
          replayRate: 0.25,
          failureRate: 0.125,
        },
      ]),
      totals: {
        homeViews: 14,
        started: 6,
        replayed: 2,
        completed: 5,
        failed: 1,
        startsPerVisit: 0.5714,
      },
    });
    expect(result.experiences).toHaveLength(7);
    expect(JSON.stringify(result)).not.toMatch(/visitorHash|eventId|userId|\bhash\b/i);
  });

  it('returns null ratios for zero denominators instead of non-finite numbers', async () => {
    const service = await loadMetricsService();
    expect(service).not.toBeNull();
    if (!service) return;

    const result = await service.queryEnergyMetrics({
      store: new ReadStore([], []),
      window: 30,
      now: NOW,
    });

    expect(result.daily).toHaveLength(30);
    expect(result.experiences).toHaveLength(7);
    expect(result.experiences[0]).toMatchObject({
      completionRate: null,
      replayRate: null,
      failureRate: null,
    });
    expect(result.totals.startsPerVisit).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/Infinity|NaN/);
  });

  it('queries exactly the inclusive UTC window boundaries', async () => {
    const service = await loadMetricsService();
    expect(service).not.toBeNull();
    if (!service) return;
    const store = new ReadStore([], []);
    const metricSpy = vi.spyOn(store, 'readMetricRows');
    const audienceSpy = vi.spyOn(store, 'readDailyAudience');

    await service.queryEnergyMetrics({ store, window: 7, now: NOW });

    expect(metricSpy).toHaveBeenCalledWith('2026-08-10', '2026-08-16');
    expect(audienceSpy).toHaveBeenCalledWith('2026-08-10', '2026-08-16');
  });
});
