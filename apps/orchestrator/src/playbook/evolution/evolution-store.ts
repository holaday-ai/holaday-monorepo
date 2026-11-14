import type { Generalizer } from './generalize.js';
import type { PathTemplate } from './path-template.js';
import type { Trajectory } from './trajectory.js';

/**
 * Batch 06 — persistence port of the self-evolution loop.
 *
 * The loop's logic (sediment / canary / reuse) is written against this port so
 * the whole capture → verified → replay → repair flow is unit-testable with
 * `InMemoryEvolutionStore`; production binds `DrizzleEvolutionStore`
 * (operation_paths / canary_results / operation_path_replays / task_action_captures).
 */

export type PathStatus = 'draft' | 'verified' | 'stale';
export type PathGeneralizer = Generalizer | 'repair';

export interface StoredPath {
  id: number;
  siteDomain: string;
  capabilityKey: string;
  version: number;
  status: PathStatus;
  template: PathTemplate;
  generalizer: PathGeneralizer | null;
  canaryPassStreak: number;
  sourceTaskIds: number[];
  parentPathId: number | null;
  lastVerifiedAt: Date | null;
  staleReason: string | null;
}

export interface CreateTemplatePathInput {
  siteDomain: string;
  capabilityKey: string;
  template: PathTemplate;
  generalizer: PathGeneralizer;
  sourceTaskIds: number[];
  status: PathStatus;
  parentPathId?: number | null;
  canaryPassStreak?: number;
}

export interface PathStatePatch {
  status?: PathStatus;
  canaryPassStreak?: number;
  lastVerifiedAt?: Date | null;
  staleReason?: string | null;
}

export interface CanaryRecord {
  passed: boolean;
  failureType?: string | null;
  evidence: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date;
}

export interface ReplayRecord {
  pathId: number;
  taskId: number | null;
  outcome: 'success' | 'repaired' | 'failed';
  stepsTotal: number;
  stepsDeterministic: number;
  stepsRepaired: number;
  modelCalls: number;
  modelCallsSaved: number;
  repairedPathId: number | null;
  failedStepIndex: number | null;
  failureReason: string | null;
  durationMs: number | null;
}

export interface EvolutionStore {
  /** Successful tasks' trajectories that carry 0062 replay descriptors. */
  loadTrajectories(opts: { limit: number }): Promise<Trajectory[]>;
  /** All template-bearing versions of one capability, newest version first. */
  findTemplatePaths(siteDomain: string, capabilityKey: string): Promise<StoredPath[]>;
  createTemplatePath(input: CreateTemplatePathInput): Promise<StoredPath>;
  /** Template paths due for canary replay (draft or verified). */
  listCanaryPaths(limit: number): Promise<StoredPath[]>;
  recordCanaryResult(pathId: number, record: CanaryRecord): Promise<void>;
  updatePathState(pathId: number, patch: PathStatePatch): Promise<void>;
  listVerifiedPaths(siteDomain: string): Promise<StoredPath[]>;
  recordReplay(record: ReplayRecord): Promise<void>;
}

/** Test/dev implementation; also documents the exact semantics the Drizzle store must honour. */
export class InMemoryEvolutionStore implements EvolutionStore {
  trajectories: Trajectory[] = [];
  paths: StoredPath[] = [];
  canary: Array<{ pathId: number } & CanaryRecord> = [];
  replays: ReplayRecord[] = [];
  private nextId = 1;

  async loadTrajectories(opts: { limit: number }): Promise<Trajectory[]> {
    return this.trajectories.slice(0, opts.limit);
  }

  async findTemplatePaths(siteDomain: string, capabilityKey: string): Promise<StoredPath[]> {
    return this.paths
      .filter((p) => p.siteDomain === siteDomain && p.capabilityKey === capabilityKey)
      .sort((a, b) => b.version - a.version);
  }

  async createTemplatePath(input: CreateTemplatePathInput): Promise<StoredPath> {
    const versions = this.paths
      .filter((p) => p.siteDomain === input.siteDomain && p.capabilityKey === input.capabilityKey)
      .map((p) => p.version);
    const path: StoredPath = {
      id: this.nextId++,
      siteDomain: input.siteDomain,
      capabilityKey: input.capabilityKey,
      version: (versions.length ? Math.max(...versions) : 0) + 1,
      status: input.status,
      template: input.template,
      generalizer: input.generalizer,
      canaryPassStreak: input.canaryPassStreak ?? 0,
      sourceTaskIds: [...input.sourceTaskIds],
      parentPathId: input.parentPathId ?? null,
      lastVerifiedAt: null,
      staleReason: null,
    };
    this.paths.push(path);
    return path;
  }

  async listCanaryPaths(limit: number): Promise<StoredPath[]> {
    return this.paths
      .filter((p) => p.status === 'draft' || p.status === 'verified')
      .slice(0, limit);
  }

  async recordCanaryResult(pathId: number, record: CanaryRecord): Promise<void> {
    this.canary.push({ pathId, ...record });
  }

  async updatePathState(pathId: number, patch: PathStatePatch): Promise<void> {
    const p = this.paths.find((x) => x.id === pathId);
    if (!p) return;
    if (patch.status !== undefined) p.status = patch.status;
    if (patch.canaryPassStreak !== undefined) p.canaryPassStreak = patch.canaryPassStreak;
    if (patch.lastVerifiedAt !== undefined) p.lastVerifiedAt = patch.lastVerifiedAt;
    if (patch.staleReason !== undefined) p.staleReason = patch.staleReason;
  }

  async listVerifiedPaths(siteDomain: string): Promise<StoredPath[]> {
    return this.paths.filter((p) => p.siteDomain === siteDomain && p.status === 'verified');
  }

  async recordReplay(record: ReplayRecord): Promise<void> {
    this.replays.push(record);
  }
}
