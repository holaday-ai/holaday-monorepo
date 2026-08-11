export type EnergyCompletionKind = 'recharge' | 'tarot' | 'game' | 'test' | 'horoscope';

export interface EnergyProgress {
  completedDates: string[];
  collectedKinds: EnergyCompletionKind[];
  savedCardIds: string[];
  completedTestIds: string[];
  savedTestActionIds: string[];
  seenContentIds: string[];
}

const STORAGE_PREFIX = 'holaday.energy.progress.v2';
const LEGACY_STORAGE_PREFIX = 'holaday.energy.progress.v1';
const MAX_SAVED_CARD_IDS = 100;
const MAX_TEST_IDS = 100;
const MAX_CONTENT_IDS = 100;
const COMPLETION_KINDS: readonly EnergyCompletionKind[] = [
  'recharge',
  'tarot',
  'game',
  'test',
  'horoscope',
];

function emptyProgress(): EnergyProgress {
  return {
    completedDates: [],
    collectedKinds: [],
    savedCardIds: [],
    completedTestIds: [],
    savedTestActionIds: [],
    seenContentIds: [],
  };
}

function storageKey(scope: string | null, prefix = STORAGE_PREFIX): string {
  return `${prefix}:${scope?.trim() || 'guest'}`;
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

function isCardId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z-]+-\d{2}$/.test(value);
}

function isTestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]+(?:-[a-z]+)+$/.test(value);
}

function isTestOutcomeId(value: unknown): value is string {
  return value === 'recover' || value === 'steady' || value === 'build' || value === 'charge';
}

function isTestActionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const [testId, outcomeId, extra] = value.split(':');
  return extra === undefined && isTestId(testId) && isTestOutcomeId(outcomeId);
}

function isContentId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64
  );
}

function parseProgress(raw: string): EnergyProgress {
  const parsed = JSON.parse(raw) as {
    completedDates?: unknown;
    collectedKinds?: unknown;
    savedCardIds?: unknown;
    completedTestIds?: unknown;
    savedTestActionIds?: unknown;
    seenContentIds?: unknown;
  };
  if (!Array.isArray(parsed.completedDates) || !Array.isArray(parsed.collectedKinds)) {
    return emptyProgress();
  }
  const completedDates = parsed.completedDates.filter(
    (value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
  );
  const collectedKinds = parsed.collectedKinds.filter(isCompletionKind);
  const savedCardIds = Array.isArray(parsed.savedCardIds)
    ? parsed.savedCardIds.filter(isCardId).slice(-MAX_SAVED_CARD_IDS)
    : [];
  const completedTestIds = Array.isArray(parsed.completedTestIds)
    ? parsed.completedTestIds.filter(isTestId).slice(-MAX_TEST_IDS)
    : [];
  const savedTestActionIds = Array.isArray(parsed.savedTestActionIds)
    ? parsed.savedTestActionIds.filter(isTestActionId).slice(-MAX_TEST_IDS)
    : [];
  const seenContentIds = Array.isArray(parsed.seenContentIds)
    ? parsed.seenContentIds.filter(isContentId).slice(-MAX_CONTENT_IDS)
    : [];
  return {
    completedDates: [...new Set(completedDates)].sort(),
    collectedKinds: [...new Set(collectedKinds)],
    savedCardIds: [...new Set(savedCardIds)],
    completedTestIds: [...new Set(completedTestIds)],
    savedTestActionIds: [...new Set(savedTestActionIds)],
    seenContentIds: [...new Set(seenContentIds)],
  };
}

function writeProgress(scope: string | null, progress: EnergyProgress): void {
  if (scope === null) return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(progress));
  } catch {
    // The in-memory result remains usable when storage is unavailable.
  }
}

export function readEnergyProgress(scope: string | null): EnergyProgress {
  if (scope === null) return emptyProgress();
  try {
    const current = window.localStorage.getItem(storageKey(scope));
    if (current) return parseProgress(current);
    const legacy = window.localStorage.getItem(storageKey(scope, LEGACY_STORAGE_PREFIX));
    if (!legacy) return emptyProgress();
    const migrated = parseProgress(legacy);
    writeProgress(scope, migrated);
    return migrated;
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
    ...current,
    completedDates: [...new Set([...current.completedDates, localDateKey(completedAt)])].sort(),
    collectedKinds: [...new Set([...current.collectedKinds, kind])],
  };
  writeProgress(scope, next);
  return next;
}

export function saveEnergyCardIds(scope: string | null, cardIds: string[]): EnergyProgress {
  const current = readEnergyProgress(scope);
  const validIds = cardIds.filter(isCardId);
  const savedCardIds = [...new Set([...current.savedCardIds, ...validIds])].slice(
    -MAX_SAVED_CARD_IDS,
  );
  const next = { ...current, savedCardIds };
  writeProgress(scope, next);
  return next;
}

export function recordLightTestCompletion(scope: string | null, testId: string): EnergyProgress {
  const current = readEnergyProgress(scope);
  if (!isTestId(testId)) return current;
  const completedTestIds = [...new Set([...current.completedTestIds, testId])].slice(-MAX_TEST_IDS);
  const next = { ...current, completedTestIds };
  writeProgress(scope, next);
  return next;
}

export function saveLightTestAction(
  scope: string | null,
  testId: string,
  outcomeId: string,
): EnergyProgress {
  const current = readEnergyProgress(scope);
  if (!isTestId(testId) || !isTestOutcomeId(outcomeId)) return current;
  const actionId = `${testId}:${outcomeId}`;
  const savedTestActionIds = [...new Set([...current.savedTestActionIds, actionId])].slice(
    -MAX_TEST_IDS,
  );
  const next = { ...current, savedTestActionIds };
  writeProgress(scope, next);
  return next;
}

export function saveSeenEnergyContentIds(
  scope: string | null,
  contentIds: string[],
): EnergyProgress {
  const current = readEnergyProgress(scope);
  const validIds = contentIds.filter(isContentId);
  const seenContentIds = [...new Set([...current.seenContentIds, ...validIds])].slice(
    -MAX_CONTENT_IDS,
  );
  const next = { ...current, seenContentIds };
  writeProgress(scope, next);
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
