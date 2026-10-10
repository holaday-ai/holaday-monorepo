import { AsyncLocalStorage } from 'node:async_hooks';
import { asc, eq, inArray, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  modelCatalog,
  modelCatalogEvents,
  taskModelSelections,
} from '../db/schema/model-catalog.js';
import { users } from '../db/schema/users.js';
import { CORE_MODEL_LANES, type CoreModelLane } from './model-runtime-policy.js';

export const BRAIN_PROVIDERS = ['alibaba-model-studio', 'anthropic', 'openai'] as const;
export type BrainProvider = (typeof BRAIN_PROVIDERS)[number];

/** Every core lane plus the browser screenshot (vision) purpose. */
export const BRAIN_LANES = [...CORE_MODEL_LANES, 'vision'] as const;
export type BrainLane = CoreModelLane | 'vision';
export type BrainLaneModels = Partial<Record<BrainLane, string>>;

export interface BrainEntry {
  id: string;
  provider: BrainProvider;
  label: string;
  userVisible: boolean;
  isDefault: boolean;
  /** Admins may use the brain even while it is hidden from ordinary users. */
  adminOnly: boolean;
  sortOrder: number;
  laneModels: BrainLaneModels;
  updatedAt: Date | null;
}

export type BrainFallbackReason = 'NOT_FOUND' | 'NOT_VISIBLE' | 'PROVIDER_NOT_CONFIGURED';

export interface ResolvedBrain {
  brain: BrainEntry;
  requestedBrainId: string | null;
  fallbackReason: BrainFallbackReason | null;
}

export type ProviderConfigured = (provider: BrainProvider) => boolean;

/** Mirrors the 0061 seed so the product keeps working before the migration lands. */
export const BUILTIN_MODEL_CATALOG: readonly BrainEntry[] = Object.freeze([
  {
    id: 'qwen',
    provider: 'alibaba-model-studio',
    label: '千问',
    userVisible: true,
    isDefault: true,
    adminOnly: false,
    sortOrder: 10,
    laneModels: {
      browser: 'qwen3.8-max',
      generate: 'qwen3.7-plus',
      scrape: 'qwen3.7-plus',
      plan: 'qwen3.8-flash',
      suggestions: 'qwen3.8-flash',
      verifier: 'qwen3.8-max',
      vision: 'qwen3.8-max',
      video_edit_planner: 'qwen3.8-flash',
    },
    updatedAt: null,
  },
  {
    id: 'claude',
    provider: 'anthropic',
    label: 'Claude',
    userVisible: false,
    isDefault: false,
    adminOnly: true,
    sortOrder: 20,
    laneModels: {
      browser: 'claude-sonnet-4-6',
      generate: 'claude-sonnet-4-6',
      scrape: 'claude-sonnet-4-6',
      plan: 'claude-haiku-4-5',
      suggestions: 'claude-haiku-4-5',
      verifier: 'claude-sonnet-4-6',
      vision: 'claude-sonnet-4-6',
      video_edit_planner: 'claude-haiku-4-5',
    },
    updatedAt: null,
  },
  {
    id: 'gpt',
    provider: 'openai',
    label: 'GPT',
    userVisible: false,
    isDefault: false,
    adminOnly: true,
    sortOrder: 30,
    laneModels: {
      browser: 'gpt-4o',
      generate: 'gpt-4o',
      scrape: 'gpt-4o',
      plan: 'gpt-4o-mini',
      suggestions: 'gpt-4o-mini',
      verifier: 'gpt-4o',
      vision: 'gpt-4o',
      video_edit_planner: 'gpt-4o-mini',
    },
    updatedAt: null,
  },
]);

export class ModelCatalogError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_UPDATE',
    message: string,
  ) {
    super(message);
    this.name = 'ModelCatalogError';
  }
}

// ── Pure rules ────────────────────────────────────────────────────────────

/** Exactly one default. A broken table never leaves the product brainless. */
export function selectDefaultBrain(entries: readonly BrainEntry[]): BrainEntry {
  const sorted = sortEntries(entries);
  const defaults = sorted.filter((entry) => entry.isDefault);
  if (defaults.length === 1 && defaults[0]) return defaults[0];
  const fallback =
    sorted.find((entry) => entry.provider === 'alibaba-model-studio') ??
    sorted[0] ??
    BUILTIN_MODEL_CATALOG[0];
  if (!fallback) throw new Error('model catalog has no entries');
  return fallback;
}

export function isBrainAccessible(entry: BrainEntry, isAdmin: boolean): boolean {
  return entry.userVisible || (isAdmin && entry.adminOnly);
}

export interface BrainListItem {
  id: string;
  label: string;
  provider: BrainProvider;
  isDefault: boolean;
  /** Shown to this viewer only because they are an admin. */
  adminOnly: boolean;
  configured: boolean;
}

export function listBrainsForViewer(
  entries: readonly BrainEntry[],
  viewer: { isAdmin: boolean },
  isProviderConfigured: ProviderConfigured,
): BrainListItem[] {
  const defaultId = selectDefaultBrain(entries).id;
  return sortEntries(entries)
    .filter((entry) => entry.id === defaultId || isBrainAccessible(entry, viewer.isAdmin))
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      provider: entry.provider,
      isDefault: entry.id === defaultId,
      adminOnly: !entry.userVisible && entry.id !== defaultId,
      configured: isProviderConfigured(entry.provider),
    }));
}

export function resolveBrainFromEntries(
  entries: readonly BrainEntry[],
  input: { isAdmin: boolean; requestedBrainId?: string | null },
  isProviderConfigured: ProviderConfigured,
): ResolvedBrain {
  const fallback = selectDefaultBrain(entries);
  const requestedBrainId = input.requestedBrainId?.trim() || null;
  if (!requestedBrainId || requestedBrainId === fallback.id) {
    return { brain: fallback, requestedBrainId, fallbackReason: null };
  }
  const requested = entries.find((entry) => entry.id === requestedBrainId);
  if (!requested) return { brain: fallback, requestedBrainId, fallbackReason: 'NOT_FOUND' };
  if (!isBrainAccessible(requested, input.isAdmin)) {
    return { brain: fallback, requestedBrainId, fallbackReason: 'NOT_VISIBLE' };
  }
  if (!isProviderConfigured(requested.provider)) {
    return { brain: fallback, requestedBrainId, fallbackReason: 'PROVIDER_NOT_CONFIGURED' };
  }
  return { brain: requested, requestedBrainId, fallbackReason: null };
}

/** The concrete model name a lane uses for this brain, or null to keep the provider route default. */
export function brainLaneModel(brain: BrainEntry, lane: BrainLane): string | null {
  const model = brain.laneModels[lane];
  return typeof model === 'string' && model.trim() ? model.trim() : null;
}

export interface BrainUpdatePatch {
  userVisible?: boolean;
  adminOnly?: boolean;
  isDefault?: true;
  laneModels?: BrainLaneModels;
}

/** Applies one admin change and returns the next catalog, keeping exactly one visible default. */
export function applyBrainUpdate(
  entries: readonly BrainEntry[],
  id: string,
  patch: BrainUpdatePatch,
): BrainEntry[] {
  const target = entries.find((entry) => entry.id === id);
  if (!target) throw new ModelCatalogError('NOT_FOUND', '模型不存在');
  const currentDefault = selectDefaultBrain(entries);
  const becomesDefault = patch.isDefault === true;
  const nextVisible = patch.userVisible ?? (becomesDefault ? true : target.userVisible);
  if (target.id === currentDefault.id && !becomesDefault && patch.userVisible === false) {
    throw new ModelCatalogError('INVALID_UPDATE', '默认模型必须对用户可见，请先把其他模型设为默认');
  }
  if (becomesDefault && !nextVisible) {
    throw new ModelCatalogError('INVALID_UPDATE', '默认模型必须对用户可见');
  }
  const laneModels = patch.laneModels ? sanitizeLaneModels(patch.laneModels) : undefined;
  return entries.map((entry) => {
    if (entry.id === id) {
      return {
        ...entry,
        userVisible: nextVisible,
        adminOnly: patch.adminOnly ?? entry.adminOnly,
        isDefault: becomesDefault ? true : entry.id === currentDefault.id,
        laneModels: laneModels ? { ...entry.laneModels, ...laneModels } : entry.laneModels,
      };
    }
    return { ...entry, isDefault: becomesDefault ? false : entry.id === currentDefault.id };
  });
}

function sanitizeLaneModels(value: BrainLaneModels): BrainLaneModels {
  const next: BrainLaneModels = {};
  for (const lane of BRAIN_LANES) {
    const model = value[lane];
    if (model === undefined) continue;
    const trimmed = model.trim();
    if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(trimmed)) {
      throw new ModelCatalogError('INVALID_UPDATE', `通道 ${lane} 的模型名不合法`);
    }
    next[lane] = trimmed;
  }
  return next;
}

export function normalizeLaneModels(value: unknown): BrainLaneModels {
  if (typeof value === 'string') {
    try {
      return normalizeLaneModels(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const next: BrainLaneModels = {};
  for (const lane of BRAIN_LANES) {
    const model = record[lane];
    if (typeof model === 'string' && model.trim()) next[lane] = model.trim();
  }
  return next;
}

function sortEntries(entries: readonly BrainEntry[]): BrainEntry[] {
  return [...entries].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

// ── Storage + cache ───────────────────────────────────────────────────────

export interface ModelCatalogStore {
  load(): Promise<BrainEntry[]>;
  /** Persists the full next catalog and its audit event atomically. */
  save(input: {
    next: readonly BrainEntry[];
    changedId: string;
    action: string;
    before: BrainEntry;
    after: BrainEntry;
    actorExternalId: string;
  }): Promise<void>;
}

export interface ModelCatalogService {
  /** Synchronous view for runtime wiring; never blocks a model call on the database. */
  snapshot(): readonly BrainEntry[];
  list(): Promise<readonly BrainEntry[]>;
  isProviderConfigured: ProviderConfigured;
  resolveBrain(input: {
    isAdmin: boolean;
    requestedBrainId?: string | null;
  }): Promise<ResolvedBrain>;
  update(input: {
    id: string;
    patch: BrainUpdatePatch;
    actorExternalId: string;
  }): Promise<readonly BrainEntry[]>;
  invalidate(): void;
}

export const MODEL_CATALOG_CACHE_MS = 10_000;

export function createModelCatalogService(input: {
  store: ModelCatalogStore | null;
  isProviderConfigured: ProviderConfigured;
  now?: () => number;
  ttlMs?: number;
  onLoadError?: (error: unknown) => void;
}): ModelCatalogService {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs ?? MODEL_CATALOG_CACHE_MS;
  let entries: readonly BrainEntry[] = BUILTIN_MODEL_CATALOG;
  let loadedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<readonly BrainEntry[]> | null = null;
  let generation = 0;

  const load = (): Promise<readonly BrainEntry[]> => {
    if (!input.store) return Promise.resolve(entries);
    if (inflight) return inflight;
    const startedGeneration = generation;
    inflight = input.store
      .load()
      .then((rows) => {
        if (startedGeneration === generation && rows.length > 0) {
          entries = rows;
          loadedAt = now();
        }
        return entries;
      })
      .catch((error: unknown) => {
        // Missing table (pre-0061) or a transient DB error keeps the last good view.
        loadedAt = now();
        input.onLoadError?.(error);
        return entries;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const fresh = () => now() - loadedAt < ttlMs;

  return {
    isProviderConfigured: input.isProviderConfigured,
    snapshot() {
      if (!fresh()) void load();
      return entries;
    },
    async list() {
      return fresh() ? entries : load();
    },
    async resolveBrain(request) {
      const current = fresh() ? entries : await load();
      return resolveBrainFromEntries(current, request, input.isProviderConfigured);
    },
    async update(request) {
      if (!input.store) throw new ModelCatalogError('INVALID_UPDATE', '模型目录尚未就绪');
      generation += 1;
      inflight = null;
      const current = await input.store.load();
      const before = current.find((entry) => entry.id === request.id);
      const next = applyBrainUpdate(current, request.id, request.patch);
      const after = next.find((entry) => entry.id === request.id);
      if (!before || !after) throw new ModelCatalogError('NOT_FOUND', '模型不存在');
      await input.store.save({
        next,
        changedId: request.id,
        action: describeUpdate(request.patch),
        before,
        after,
        actorExternalId: request.actorExternalId,
      });
      generation += 1;
      entries = next.map((entry) =>
        entry.id === request.id ? { ...entry, updatedAt: new Date(now()) } : entry,
      );
      loadedAt = now();
      return entries;
    },
    invalidate() {
      generation += 1;
      loadedAt = Number.NEGATIVE_INFINITY;
    },
  };
}

function describeUpdate(patch: BrainUpdatePatch): string {
  if (patch.isDefault) return 'set_default';
  if (patch.laneModels) return 'update_lane_models';
  if (patch.userVisible !== undefined) return patch.userVisible ? 'show' : 'hide';
  if (patch.adminOnly !== undefined) return patch.adminOnly ? 'admin_enable' : 'admin_disable';
  return 'update';
}

export function createDrizzleModelCatalogStore(db: DB): ModelCatalogStore {
  return {
    async load() {
      const rows = await db.select().from(modelCatalog).orderBy(asc(modelCatalog.sortOrder));
      return rows.flatMap((row) => {
        if (!(BRAIN_PROVIDERS as readonly string[]).includes(row.provider)) return [];
        return [
          {
            id: row.id,
            provider: row.provider as BrainProvider,
            label: row.label,
            userVisible: Boolean(row.userVisible),
            isDefault: Boolean(row.isDefault),
            adminOnly: Boolean(row.adminOnly),
            sortOrder: row.sortOrder,
            laneModels: normalizeLaneModels(row.laneModels),
            updatedAt: row.updatedAt ?? null,
          },
        ];
      });
    },
    async save(change) {
      await db.transaction(async (tx) => {
        const after = change.after;
        if (after.isDefault) {
          await tx
            .update(modelCatalog)
            .set({ isDefault: false })
            .where(ne(modelCatalog.id, after.id));
        }
        await tx
          .update(modelCatalog)
          .set({
            userVisible: after.userVisible,
            adminOnly: after.adminOnly,
            isDefault: after.isDefault,
            laneModels: after.laneModels,
            updatedAt: new Date(),
          })
          .where(eq(modelCatalog.id, after.id));
        const [actor] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.externalId, change.actorExternalId))
          .limit(1);
        if (!actor) throw new ModelCatalogError('INVALID_UPDATE', '操作人不存在');
        await tx.insert(modelCatalogEvents).values({
          modelId: change.changedId,
          actorUserId: actor.id,
          action: change.action,
          beforeJson: auditView(change.before),
          afterJson: auditView(after),
        });
      });
    },
  };
}

function auditView(entry: BrainEntry) {
  return {
    userVisible: entry.userVisible,
    adminOnly: entry.adminOnly,
    isDefault: entry.isDefault,
    laneModels: entry.laneModels,
  };
}

/** Best-effort record of the brain a task ran with. Never blocks task creation. */
export async function recordTaskModelSelection(
  db: DB,
  taskExternalId: string,
  resolved: ResolvedBrain,
): Promise<void> {
  await db
    .insert(taskModelSelections)
    .values({
      taskExternalId,
      brainId: resolved.brain.id,
      provider: resolved.brain.provider,
      requestedBrainId: resolved.requestedBrainId,
      fallbackReason: resolved.fallbackReason,
      laneModels: resolved.brain.laneModels,
    })
    .onDuplicateKeyUpdate({ set: { taskExternalId } });
}

export async function readTaskModelSelections(
  db: DB,
  taskExternalIds: readonly string[],
): Promise<Map<string, { brainId: string; provider: string; label: string | null }>> {
  const result = new Map<string, { brainId: string; provider: string; label: string | null }>();
  if (taskExternalIds.length === 0) return result;
  const rows = await db
    .select({
      taskExternalId: taskModelSelections.taskExternalId,
      brainId: taskModelSelections.brainId,
      provider: taskModelSelections.provider,
      label: modelCatalog.label,
    })
    .from(taskModelSelections)
    .leftJoin(modelCatalog, eq(modelCatalog.id, taskModelSelections.brainId))
    .where(inArray(taskModelSelections.taskExternalId, [...taskExternalIds]));
  for (const row of rows) {
    result.set(row.taskExternalId, {
      brainId: row.brainId,
      provider: row.provider,
      label: row.label ?? null,
    });
  }
  return result;
}

// ── Per-task brain context ────────────────────────────────────────────────

const brainContext = new AsyncLocalStorage<ResolvedBrain>();

/**
 * Binds a task's resolved brain to everything the task starts asynchronously,
 * so every lane resolved inside (generate, verifier, plan, browser, …) uses it
 * without threading a parameter through each call site.
 */
export function runWithBrain<T>(resolved: ResolvedBrain, fn: () => T): T {
  return brainContext.run(resolved, fn);
}

export function currentBrain(): ResolvedBrain | undefined {
  return brainContext.getStore();
}

/**
 * Binds the brain to the rest of the current async execution (one tRPC
 * request) when it can only be resolved midway through a handler, e.g. after
 * ownership checks. Work the request starts afterwards resolves lanes with it.
 */
export function enterBrain(resolved: ResolvedBrain): void {
  brainContext.enterWith(resolved);
}
