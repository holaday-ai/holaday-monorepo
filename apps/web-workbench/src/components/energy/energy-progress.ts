import {
  ENERGY_POLL_IDS,
  ENERGY_PRACTICE_IDS,
  type EnergyContentTarget,
  type EnergyExperienceLaunchTarget,
  type EnergyPollId,
  type EnergyPracticeId,
  isEnergyContentTarget,
} from './energy-content-target';
import { isEnergyPollOptionId } from './experiences/poll-content';

export type EnergyCompletionKind = 'recharge' | 'tarot' | 'game' | 'test' | 'horoscope';

export interface EnergyContinuationState {
  dateKey: string;
  lastTarget: EnergyContentTarget | null;
  lastCompletedKind: EnergyCompletionKind | null;
  completedPracticeIds: string[];
  pollSelections: Record<string, string>;
  favoriteContentIds: string[];
}

const RECENT_EXPERIENCE_KIND = {
  recharge: 'recharge',
  practice: 'recharge',
  tarot: 'tarot',
  'light-test': 'test',
  horoscope: 'horoscope',
  games: 'game',
} as const satisfies Record<string, EnergyCompletionKind>;

export type EnergyRecentExperienceId = keyof typeof RECENT_EXPERIENCE_KIND;

export interface EnergyRecentExperience {
  experienceId: EnergyRecentExperienceId;
  launchTarget: EnergyExperienceLaunchTarget | null;
  kind: EnergyCompletionKind;
  completedAt: string;
}

export interface EnergyProgress {
  completedDates: string[];
  collectedKinds: EnergyCompletionKind[];
  savedCardIds: string[];
  completedTestIds: string[];
  savedTestActionIds: string[];
  seenContentIds: string[];
  completedKindsByDate: Record<string, EnergyCompletionKind[]>;
  seenContentDateKey: string | null;
  continuation: EnergyContinuationState;
  shelf: {
    recentExperiences: EnergyRecentExperience[];
  };
}

const STORAGE_PREFIX = 'holaday.energy.progress.v4';
const V3_STORAGE_PREFIX = 'holaday.energy.progress.v3';
const V2_STORAGE_PREFIX = 'holaday.energy.progress.v2';
const LEGACY_STORAGE_PREFIX = 'holaday.energy.progress.v1';
const MAX_SAVED_CARD_IDS = 100;
const MAX_TEST_IDS = 100;
const MAX_CONTENT_IDS = 100;
const MAX_DATED_COMPLETION_KEYS = 45;
const MAX_RECENT_EXPERIENCES = 12;
const RECENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const previewProgressByWindow = new WeakMap<object, EnergyProgress>();
const scopedProgressByWindow = new WeakMap<object, Map<string, EnergyProgress>>();
const COMPLETION_KINDS: readonly EnergyCompletionKind[] = [
  'recharge',
  'tarot',
  'game',
  'test',
  'horoscope',
];

function emptyProgress(now = new Date()): EnergyProgress {
  return {
    completedDates: [],
    collectedKinds: [],
    savedCardIds: [],
    completedTestIds: [],
    savedTestActionIds: [],
    seenContentIds: [],
    completedKindsByDate: {},
    seenContentDateKey: null,
    continuation: {
      dateKey: localDateKey(now),
      lastTarget: null,
      lastCompletedKind: null,
      completedPracticeIds: [],
      pollSelections: {},
      favoriteContentIds: [],
    },
    shelf: { recentExperiences: [] },
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

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function parseCompletedKindsByDate(value: unknown): Record<string, EnergyCompletionKind[]> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([dateKey, kinds]) => isDateKey(dateKey) && Array.isArray(kinds))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-MAX_DATED_COMPLETION_KEYS)
    .map(([dateKey, kinds]): [string, EnergyCompletionKind[]] => [
      dateKey,
      [...new Set((kinds as unknown[]).filter(isCompletionKind))],
    ]);
  return Object.fromEntries(entries);
}

function parsePollSelections(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    ENERGY_POLL_IDS.flatMap((pollId) => {
      const optionId = value[pollId];
      return isEnergyPollOptionId(pollId, optionId) ? [[pollId, optionId] as const] : [];
    }),
  );
}

function isRecentExperienceId(value: unknown): value is EnergyRecentExperienceId {
  return typeof value === 'string' && value in RECENT_EXPERIENCE_KIND;
}

function targetMatchesExperience(
  experienceId: EnergyRecentExperienceId,
  launchTarget: EnergyExperienceLaunchTarget | null,
): boolean {
  if (launchTarget === null) return experienceId !== 'practice';
  if (experienceId === 'practice') return launchTarget.type === 'practice';
  if (experienceId === 'tarot') return launchTarget.type === 'tarot';
  if (experienceId === 'light-test') return launchTarget.type === 'test';
  if (experienceId === 'games') return launchTarget.type === 'game';
  return false;
}

export function recentExperienceKey(
  experience: Pick<EnergyRecentExperience, 'experienceId' | 'launchTarget'>,
): string {
  const { experienceId, launchTarget } = experience;
  if (!launchTarget) return `${experienceId}:default`;
  if (launchTarget.type === 'practice') return `${experienceId}:${launchTarget.practiceId}`;
  if (launchTarget.type === 'test') return `${experienceId}:${launchTarget.testId}`;
  if (launchTarget.type === 'game') return `${experienceId}:${launchTarget.gameId}`;
  if (launchTarget.type === 'tarot') {
    return `${experienceId}:${launchTarget.mode}:${launchTarget.theme ?? 'all'}`;
  }
  return `${experienceId}:default`;
}

function parseRecentExperiences(value: unknown, now: Date): EnergyRecentExperience[] {
  if (!Array.isArray(value)) return [];
  const nowMs = now.getTime();
  const earliestMs = nowMs - RECENT_RETENTION_MS;
  const latestMs = nowMs + MAX_FUTURE_SKEW_MS;
  const parsed = value.flatMap((candidate): EnergyRecentExperience[] => {
    if (!isRecord(candidate)) return [];
    if (
      !Object.keys(candidate).every((key) =>
        ['experienceId', 'launchTarget', 'kind', 'completedAt'].includes(key),
      ) ||
      !isRecentExperienceId(candidate.experienceId) ||
      !isCompletionKind(candidate.kind) ||
      candidate.kind !== RECENT_EXPERIENCE_KIND[candidate.experienceId] ||
      typeof candidate.completedAt !== 'string'
    ) {
      return [];
    }

    const completedMs = Date.parse(candidate.completedAt);
    if (
      !Number.isFinite(completedMs) ||
      new Date(completedMs).toISOString() !== candidate.completedAt ||
      completedMs < earliestMs ||
      completedMs > latestMs
    ) {
      return [];
    }

    const launchTarget =
      candidate.launchTarget === null
        ? null
        : isEnergyContentTarget(candidate.launchTarget) &&
            candidate.launchTarget.type !== 'astrology' &&
            candidate.launchTarget.type !== 'astrology-signs'
          ? candidate.launchTarget
          : undefined;
    if (
      launchTarget === undefined ||
      !targetMatchesExperience(candidate.experienceId, launchTarget)
    ) {
      return [];
    }

    return [
      {
        experienceId: candidate.experienceId,
        launchTarget,
        kind: candidate.kind,
        completedAt: candidate.completedAt,
      },
    ];
  });

  const seen = new Set<string>();
  return parsed
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .filter((experience) => {
      const key = recentExperienceKey(experience);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RECENT_EXPERIENCES);
}

function parseProgress(raw: string, now = new Date()): EnergyProgress {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!Array.isArray(parsed.completedDates) || !Array.isArray(parsed.collectedKinds)) {
    return emptyProgress(now);
  }

  const completedDates = parsed.completedDates.filter(isDateKey);
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
  const continuation = isRecord(parsed.continuation) ? parsed.continuation : {};
  const completedPracticeIds = Array.isArray(continuation.completedPracticeIds)
    ? continuation.completedPracticeIds
        .filter(
          (value): value is EnergyPracticeId =>
            typeof value === 'string' && ENERGY_PRACTICE_IDS.includes(value as EnergyPracticeId),
        )
        .slice(-MAX_CONTENT_IDS)
    : [];
  const favoriteContentIds = Array.isArray(continuation.favoriteContentIds)
    ? continuation.favoriteContentIds.filter(isContentId).slice(-MAX_CONTENT_IDS)
    : [];
  const shelf = isRecord(parsed.shelf) ? parsed.shelf : {};

  return {
    completedDates: [...new Set(completedDates)].sort(),
    collectedKinds: [...new Set(collectedKinds)],
    savedCardIds: [...new Set(savedCardIds)],
    completedTestIds: [...new Set(completedTestIds)],
    savedTestActionIds: [...new Set(savedTestActionIds)],
    seenContentIds: [...new Set(seenContentIds)],
    completedKindsByDate: parseCompletedKindsByDate(parsed.completedKindsByDate),
    seenContentDateKey: isDateKey(parsed.seenContentDateKey) ? parsed.seenContentDateKey : null,
    continuation: {
      dateKey: isDateKey(continuation.dateKey) ? continuation.dateKey : localDateKey(now),
      lastTarget: isEnergyContentTarget(continuation.lastTarget) ? continuation.lastTarget : null,
      lastCompletedKind: isCompletionKind(continuation.lastCompletedKind)
        ? continuation.lastCompletedKind
        : null,
      completedPracticeIds: [...new Set(completedPracticeIds)],
      pollSelections: parsePollSelections(continuation.pollSelections),
      favoriteContentIds: [...new Set(favoriteContentIds)],
    },
    shelf: { recentExperiences: parseRecentExperiences(shelf.recentExperiences, now) },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rememberScopedProgress(scope: string, progress: EnergyProgress): void {
  if (typeof window === 'undefined') return;
  let progressByScope = scopedProgressByWindow.get(window);
  if (!progressByScope) {
    progressByScope = new Map();
    scopedProgressByWindow.set(window, progressByScope);
  }
  progressByScope.set(storageKey(scope), progress);
}

function readRememberedScopedProgress(scope: string, now: Date): EnergyProgress | null {
  if (typeof window === 'undefined') return null;
  const progress = scopedProgressByWindow.get(window)?.get(storageKey(scope));
  return progress ? normalizeDailyState(progress, now) : null;
}

function forgetRememberedScopedProgress(scope: string): void {
  if (typeof window === 'undefined') return;
  scopedProgressByWindow.get(window)?.delete(storageKey(scope));
}

function writeProgress(scope: string | null, progress: EnergyProgress): void {
  if (scope === null) {
    if (typeof window !== 'undefined') previewProgressByWindow.set(window, progress);
    return;
  }
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(progress));
    forgetRememberedScopedProgress(scope);
  } catch {
    rememberScopedProgress(scope, progress);
  }
}

function normalizeDailyState(progress: EnergyProgress, date: Date): EnergyProgress {
  const dateKey = localDateKey(date);
  const sameContinuationDay = progress.continuation.dateKey === dateKey;
  return {
    ...progress,
    seenContentIds: progress.seenContentDateKey === dateKey ? progress.seenContentIds : [],
    seenContentDateKey: dateKey,
    continuation: {
      ...progress.continuation,
      dateKey,
      lastTarget: sameContinuationDay ? progress.continuation.lastTarget : null,
      lastCompletedKind: sameContinuationDay ? progress.continuation.lastCompletedKind : null,
      pollSelections: sameContinuationDay ? progress.continuation.pollSelections : {},
    },
  };
}

export function readEnergyProgress(scope: string | null, now = new Date()): EnergyProgress {
  if (scope === null) {
    const current =
      typeof window === 'undefined'
        ? emptyProgress(now)
        : (previewProgressByWindow.get(window) ?? emptyProgress(now));
    const normalized = normalizeDailyState(current, now);
    writeProgress(null, normalized);
    return normalized;
  }
  try {
    const current = window.localStorage.getItem(storageKey(scope));
    if (current) {
      const parsed = parseProgress(current, now);
      const normalized = normalizeDailyState(parsed, now);
      forgetRememberedScopedProgress(scope);
      if (JSON.stringify(normalized) !== current) writeProgress(scope, normalized);
      return normalized;
    }

    const remembered = readRememberedScopedProgress(scope, now);
    if (remembered) return remembered;

    const v3 = window.localStorage.getItem(storageKey(scope, V3_STORAGE_PREFIX));
    if (v3) {
      const parsed = parseProgress(v3, now);
      const migrated = normalizeDailyState(parsed, now);
      writeProgress(scope, migrated);
      return migrated;
    }

    const v2 = window.localStorage.getItem(storageKey(scope, V2_STORAGE_PREFIX));
    if (v2) {
      const parsed = parseProgress(v2, now);
      const migrated = normalizeDailyState(
        { ...parsed, seenContentDateKey: parsed.seenContentDateKey ?? localDateKey(now) },
        now,
      );
      writeProgress(scope, migrated);
      return migrated;
    }

    const legacy = window.localStorage.getItem(storageKey(scope, LEGACY_STORAGE_PREFIX));
    if (!legacy) return emptyProgress(now);
    const parsed = parseProgress(legacy, now);
    const migrated = normalizeDailyState(
      { ...parsed, seenContentDateKey: parsed.seenContentDateKey ?? localDateKey(now) },
      now,
    );
    writeProgress(scope, migrated);
    return migrated;
  } catch {
    return readRememberedScopedProgress(scope, now) ?? emptyProgress(now);
  }
}

export function clearAllEnergyProgressForCurrentDevice(): void {
  if (typeof window === 'undefined') return;
  previewProgressByWindow.delete(window);
  scopedProgressByWindow.delete(window);
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (
      key &&
      [STORAGE_PREFIX, V3_STORAGE_PREFIX, V2_STORAGE_PREFIX, LEGACY_STORAGE_PREFIX].some((prefix) =>
        key.startsWith(`${prefix}:`),
      )
    ) {
      keys.push(key);
    }
  }
  for (const key of keys) window.localStorage.removeItem(key);
}

export function recordEnergyCompletion(
  scope: string | null,
  kind: EnergyCompletionKind,
  completedAt: Date = new Date(),
): EnergyProgress {
  const current = normalizeDailyState(readEnergyProgress(scope, completedAt), completedAt);
  const dateKey = localDateKey(completedAt);
  const next: EnergyProgress = {
    ...current,
    completedDates: [...new Set([...current.completedDates, dateKey])].sort(),
    collectedKinds: [...new Set([...current.collectedKinds, kind])],
    completedKindsByDate: {
      ...current.completedKindsByDate,
      [dateKey]: [...new Set([...(current.completedKindsByDate[dateKey] ?? []), kind])],
    },
    continuation: {
      ...current.continuation,
      lastCompletedKind: kind,
    },
  };
  writeProgress(scope, next);
  return next;
}

export interface CompletedEnergyExperienceInput {
  experienceId: EnergyRecentExperienceId;
  launchTarget: EnergyExperienceLaunchTarget | null;
  kind: EnergyCompletionKind;
}

export function recordCompletedEnergyExperience(
  scope: string | null,
  input: CompletedEnergyExperienceInput,
  completedAt = new Date(),
): EnergyProgress {
  const current = normalizeDailyState(readEnergyProgress(scope, completedAt), completedAt);
  if (
    !isRecentExperienceId(input.experienceId) ||
    !isCompletionKind(input.kind) ||
    input.kind !== RECENT_EXPERIENCE_KIND[input.experienceId]
  ) {
    return current;
  }
  const launchTarget =
    input.launchTarget === null
      ? null
      : isEnergyContentTarget(input.launchTarget)
        ? input.launchTarget
        : undefined;
  if (
    launchTarget === undefined ||
    !targetMatchesExperience(input.experienceId, launchTarget) ||
    !Number.isFinite(completedAt.getTime())
  ) {
    return current;
  }

  const dateKey = localDateKey(completedAt);
  const next: EnergyProgress = {
    ...current,
    completedDates: [...new Set([...current.completedDates, dateKey])].sort(),
    collectedKinds: [...new Set([...current.collectedKinds, input.kind])],
    completedKindsByDate: {
      ...current.completedKindsByDate,
      [dateKey]: [...new Set([...(current.completedKindsByDate[dateKey] ?? []), input.kind])],
    },
    continuation: {
      ...current.continuation,
      lastTarget: launchTarget ?? current.continuation.lastTarget,
      lastCompletedKind: input.kind,
    },
    shelf: {
      recentExperiences: parseRecentExperiences(
        [
          {
            experienceId: input.experienceId,
            launchTarget,
            kind: input.kind,
            completedAt: completedAt.toISOString(),
          },
          ...current.shelf.recentExperiences,
        ],
        completedAt,
      ),
    },
  };
  writeProgress(scope, next);
  return next;
}

export function completedKindsForDate(
  progress: Pick<EnergyProgress, 'completedKindsByDate'>,
  date = new Date(),
): EnergyCompletionKind[] {
  return [...(progress.completedKindsByDate[localDateKey(date)] ?? [])];
}

export function saveLastEnergyTarget(
  scope: string | null,
  target: EnergyContentTarget,
  kind: EnergyCompletionKind | null,
  completedAt = new Date(),
): EnergyProgress {
  const current = normalizeDailyState(readEnergyProgress(scope, completedAt), completedAt);
  const next: EnergyProgress = {
    ...current,
    continuation: {
      ...current.continuation,
      lastTarget: target,
      lastCompletedKind: kind,
    },
  };
  writeProgress(scope, next);
  return next;
}

export function recordPracticeCompletion(
  scope: string | null,
  practiceId: EnergyPracticeId,
  completedAt = new Date(),
): EnergyProgress {
  const completed = recordEnergyCompletion(scope, 'recharge', completedAt);
  const next: EnergyProgress = {
    ...completed,
    continuation: {
      ...completed.continuation,
      completedPracticeIds: [
        ...new Set([...completed.continuation.completedPracticeIds, practiceId]),
      ].slice(-MAX_CONTENT_IDS),
    },
  };
  writeProgress(scope, next);
  return next;
}

export function savePollSelection(
  scope: string | null,
  pollId: EnergyPollId,
  optionId: string,
  selectedAt = new Date(),
): EnergyProgress {
  const current = normalizeDailyState(readEnergyProgress(scope, selectedAt), selectedAt);
  if (!isEnergyPollOptionId(pollId, optionId)) return current;
  const next: EnergyProgress = {
    ...current,
    continuation: {
      ...current.continuation,
      pollSelections: { ...current.continuation.pollSelections, [pollId]: optionId },
    },
  };
  writeProgress(scope, next);
  return next;
}

export function recordOpenedEnergyContent(
  scope: string | null,
  contentId: string,
  openedAt = new Date(),
): EnergyProgress {
  const current = normalizeDailyState(readEnergyProgress(scope, openedAt), openedAt);
  if (!isContentId(contentId)) return current;
  const next: EnergyProgress = {
    ...current,
    seenContentIds: [...new Set([...current.seenContentIds, contentId])].slice(-MAX_CONTENT_IDS),
  };
  writeProgress(scope, next);
  return next;
}

export function toggleFavoriteEnergyContent(
  scope: string | null,
  contentId: string,
): EnergyProgress {
  const current = readEnergyProgress(scope);
  if (!isContentId(contentId)) return current;
  const favorites = new Set(current.continuation.favoriteContentIds);
  if (favorites.has(contentId)) favorites.delete(contentId);
  else favorites.add(contentId);
  const next: EnergyProgress = {
    ...current,
    continuation: {
      ...current.continuation,
      favoriteContentIds: [...favorites].slice(-MAX_CONTENT_IDS),
    },
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

export function removeSavedEnergyCard(scope: string | null, cardId: string): EnergyProgress {
  const current = readEnergyProgress(scope);
  if (!isCardId(cardId) || !current.savedCardIds.includes(cardId)) return current;
  const next = {
    ...current,
    savedCardIds: current.savedCardIds.filter((savedId) => savedId !== cardId),
  };
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

export function removeSavedLightTestAction(
  scope: string | null,
  testId: string,
  outcomeId: string,
): EnergyProgress {
  const current = readEnergyProgress(scope);
  if (!isTestId(testId) || !isTestOutcomeId(outcomeId)) return current;
  const actionId = `${testId}:${outcomeId}`;
  if (!current.savedTestActionIds.includes(actionId)) return current;
  const next = {
    ...current,
    savedTestActionIds: current.savedTestActionIds.filter(
      (savedActionId) => savedActionId !== actionId,
    ),
  };
  writeProgress(scope, next);
  return next;
}

export function saveSeenEnergyContentIds(
  scope: string | null,
  contentIds: string[],
): EnergyProgress {
  let next = readEnergyProgress(scope);
  for (const contentId of contentIds) {
    if (!isContentId(contentId)) continue;
    next = recordOpenedEnergyContent(scope, contentId);
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
