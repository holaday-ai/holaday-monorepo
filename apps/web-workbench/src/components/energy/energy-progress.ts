export type EnergyCompletionKind = 'recharge' | 'tarot' | 'game' | 'test' | 'horoscope';

export interface EnergyProgress {
  completedDates: string[];
  collectedKinds: EnergyCompletionKind[];
}

const STORAGE_PREFIX = 'holaday.energy.progress.v1';
const COMPLETION_KINDS: readonly EnergyCompletionKind[] = [
  'recharge',
  'tarot',
  'game',
  'test',
  'horoscope',
];

function emptyProgress(): EnergyProgress {
  return { completedDates: [], collectedKinds: [] };
}

function storageKey(scope: string | null): string {
  return `${STORAGE_PREFIX}:${scope?.trim() || 'guest'}`;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isCompletionKind(value: unknown): value is EnergyCompletionKind {
  return typeof value === 'string' && COMPLETION_KINDS.includes(value as EnergyCompletionKind);
}

export function readEnergyProgress(scope: string | null): EnergyProgress {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as { completedDates?: unknown; collectedKinds?: unknown };
    if (!Array.isArray(parsed.completedDates) || !Array.isArray(parsed.collectedKinds)) {
      return emptyProgress();
    }
    const completedDates = parsed.completedDates.filter(
      (value): value is string =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    );
    const collectedKinds = parsed.collectedKinds.filter(isCompletionKind);
    return {
      completedDates: [...new Set(completedDates)].sort(),
      collectedKinds: [...new Set(collectedKinds)],
    };
  } catch {
    return emptyProgress();
  }
}

export function recordEnergyCompletion(
  scope: string | null,
  kind: EnergyCompletionKind,
  completedAt: Date = new Date(),
): EnergyProgress {
  const current = readEnergyProgress(scope);
  const next: EnergyProgress = {
    completedDates: [...new Set([...current.completedDates, localDateKey(completedAt)])].sort(),
    collectedKinds: [...new Set([...current.collectedKinds, kind])],
  };
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // The completed result still returns even when storage is unavailable.
  }
  return next;
}

export function energyStreak(
  progress: Pick<EnergyProgress, 'completedDates'>,
  today: Date = new Date(),
): number {
  const dates = new Set(progress.completedDates);
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!dates.has(localDateKey(cursor))) return 0;

  let streak = 0;
  while (dates.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
