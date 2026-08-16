import { utcDate } from './analytics-bucket.js';
import type { EnergyAnalyticsReadStore } from './analytics-store.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const EXPERIENCE_IDS = [
  'recharge',
  'practice',
  'poll',
  'tarot',
  'light-test',
  'horoscope',
  'games',
] as const;

interface LifecycleCounts {
  started: number;
  replayed: number;
  completed: number;
  failed: number;
}

export interface EnergyDailyMetricResult {
  date: string;
  homeViews: number;
  dau: number;
  d1Returning: number | null;
  d1Rate: number | null;
}

export interface EnergyExperienceMetricResult extends LifecycleCounts {
  experienceId: (typeof EXPERIENCE_IDS)[number];
  completionRate: number | null;
  replayRate: number | null;
  failureRate: number | null;
}

export interface EnergyMetricsResult {
  window: 7 | 30;
  startDate: string;
  endDate: string;
  daily: EnergyDailyMetricResult[];
  experiences: EnergyExperienceMetricResult[];
  totals: LifecycleCounts & {
    homeViews: number;
    startsPerVisit: number | null;
  };
}

export async function queryEnergyMetrics({
  store,
  window,
  now,
}: {
  store: EnergyAnalyticsReadStore;
  window: 7 | 30;
  now: Date;
}): Promise<EnergyMetricsResult> {
  const endDate = utcDate(now);
  const startDate = shiftUtcDate(endDate, -(window - 1));
  const utcYesterday = shiftUtcDate(endDate, -1);
  const [metricRows, audienceRows] = await Promise.all([
    store.readMetricRows(startDate, endDate),
    store.readDailyAudience(startDate, endDate),
  ]);

  const homeViewsByDate = new Map<string, number>();
  const countsByExperience = new Map<string, LifecycleCounts>(
    EXPERIENCE_IDS.map((experienceId) => [experienceId, emptyLifecycleCounts()]),
  );

  for (const row of metricRows) {
    const count = Number(row.eventCount);
    if (row.eventType === 'energy_home_viewed') {
      homeViewsByDate.set(row.metricDate, (homeViewsByDate.get(row.metricDate) ?? 0) + count);
      continue;
    }
    const lifecycle = lifecycleField(row.eventType);
    const experience = countsByExperience.get(row.experienceId);
    if (lifecycle && experience) experience[lifecycle] += count;
  }

  const audienceByDate = new Map(audienceRows.map((row) => [row.activityDate, row]));
  const daily = consecutiveDates(startDate, window).map((date) => {
    const audience = audienceByDate.get(date);
    const dau = Number(audience?.dau ?? 0);
    const hasCompleteNextDay = date < utcYesterday;
    const d1Returning = hasCompleteNextDay ? Number(audience?.d1Returning ?? 0) : null;
    return {
      date,
      homeViews: homeViewsByDate.get(date) ?? 0,
      dau,
      d1Returning,
      d1Rate: d1Returning === null ? null : ratio(d1Returning, dau),
    };
  });

  const experiences = EXPERIENCE_IDS.map((experienceId) => {
    const counts = countsByExperience.get(experienceId) ?? emptyLifecycleCounts();
    const attempts = counts.started + counts.replayed;
    return {
      experienceId,
      ...counts,
      completionRate: ratio(counts.completed, attempts),
      replayRate: ratio(counts.replayed, attempts),
      failureRate: ratio(counts.failed, attempts),
    };
  });

  const lifecycleTotals = experiences.reduce<LifecycleCounts>(
    (total, experience) => ({
      started: total.started + experience.started,
      replayed: total.replayed + experience.replayed,
      completed: total.completed + experience.completed,
      failed: total.failed + experience.failed,
    }),
    emptyLifecycleCounts(),
  );
  const homeViews = daily.reduce((total, day) => total + day.homeViews, 0);

  return {
    window,
    startDate,
    endDate,
    daily,
    experiences,
    totals: {
      homeViews,
      ...lifecycleTotals,
      startsPerVisit: ratio(lifecycleTotals.started + lifecycleTotals.replayed, homeViews),
    },
  };
}

function lifecycleField(eventType: string): keyof LifecycleCounts | null {
  if (eventType === 'energy_experience_started') return 'started';
  if (eventType === 'energy_experience_replayed') return 'replayed';
  if (eventType === 'energy_experience_completed') return 'completed';
  if (eventType === 'energy_experience_failed') return 'failed';
  return null;
}

function emptyLifecycleCounts(): LifecycleCounts {
  return { started: 0, replayed: 0, completed: 0, failed: 0 };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function consecutiveDates(startDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftUtcDate(startDate, index));
}

function shiftUtcDate(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`);
  return new Date(start.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
