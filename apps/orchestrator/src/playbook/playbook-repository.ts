import { newExternalId } from '@holaday/shared-types';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import {
  type CanaryResult,
  type NewCanaryResult,
  canaryResults,
} from '../db/schema/canary-results.js';
import {
  type ExplorationRun,
  type NewExplorationRun,
  explorationRuns,
} from '../db/schema/exploration-runs.js';
import {
  type NewOperationPathStep,
  type OperationPathStep,
  operationPathSteps,
} from '../db/schema/operation-path-steps.js';
import {
  type NewOperationPath,
  type OperationPath,
  operationPaths,
} from '../db/schema/operation-paths.js';
import {
  type NewSiteCapability,
  type SiteCapability,
  siteCapabilities,
} from '../db/schema/site-capabilities.js';

/**
 * Phase 1 指令 #3 — `PlaybookRepository` (Pack A storage foundation).
 *
 * Single touch-point for the Playbook tables below `sites`:
 * `site_capabilities`, `operation_paths`, `operation_path_steps`,
 * `exploration_runs`, `canary_results`. Skeleton scope — CRUD + the
 * version-chain / verified-path lookups the later packs need. NOT wired
 * into any runtime path in Pack A; the operation-path state machine
 * (draft → canary_pending → verified/...) lands in Pack C.
 */

export interface CreateCapabilityInput {
  siteId: number;
  capabilityKey: string;
  displayName: string;
  description?: string | null;
  inputSchemaJson?: unknown;
  outputSchemaJson?: unknown;
  authRequirement?: string;
  riskTagsJson?: unknown;
  sensitiveActionLevel?: string;
  status?: string;
  confidence?: string | null;
}

export interface CreateOperationPathInput {
  siteId: number;
  capabilityId: number;
  /** Omit to auto-assign the next version for the capability. */
  version?: number;
  parentPathId?: number | null;
  status?: string;
  entryUrlTemplate?: string | null;
  inputBindingJson?: unknown;
  preconditionsJson?: unknown;
  postconditionsJson?: unknown;
  laneHint?: string | null;
  selectorStrategyJson?: unknown;
  coordinateFallbackJson?: unknown;
  screenshotAnchorJson?: unknown;
  riskTagsJson?: unknown;
  sensitivePolicyRef?: string | null;
  authWallMapJson?: unknown;
  antiBotNotesJson?: unknown;
}

export interface CreateStepInput {
  pathId: number;
  stepIndex: number;
  stepType: string;
  intent: string;
  targetSelectorJson?: unknown;
  targetTextJson?: unknown;
  coordinateFallbackJson?: unknown;
  screenshotAnchorId?: number | null;
  inputKey?: string | null;
  expectedObservationJson?: unknown;
  failureModesJson?: unknown;
  sensitiveAction?: boolean;
  sensitiveActionLevel?: string;
  notes?: string | null;
}

export interface CreateExplorationRunInput {
  siteId: number;
  watchTargetId?: number | null;
  triggerType: string;
  runnerType: string;
  status?: string;
  metadataJson?: unknown;
}

export interface CreateCanaryResultInput {
  pathId: number;
  taskId?: number | null;
  explorationRunId?: number | null;
  status?: string;
  failureType?: string | null;
  verifiedOutputsJson?: unknown;
  evidenceSummaryJson?: unknown;
}

export class PlaybookRepository {
  constructor(private readonly db: DB) {}

  // --- capabilities -------------------------------------------------------

  async createCapability(input: CreateCapabilityInput): Promise<SiteCapability> {
    const externalId = newExternalId('siteCapability');
    const values: NewSiteCapability = {
      externalId,
      siteId: input.siteId,
      capabilityKey: input.capabilityKey,
      displayName: input.displayName,
      description: input.description ?? null,
      ...(input.inputSchemaJson !== undefined ? { inputSchemaJson: input.inputSchemaJson } : {}),
      ...(input.outputSchemaJson !== undefined ? { outputSchemaJson: input.outputSchemaJson } : {}),
      ...(input.authRequirement ? { authRequirement: input.authRequirement } : {}),
      ...(input.riskTagsJson !== undefined ? { riskTagsJson: input.riskTagsJson } : {}),
      ...(input.sensitiveActionLevel ? { sensitiveActionLevel: input.sensitiveActionLevel } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
    };
    const insert = await this.db.insert(siteCapabilities).values(values);
    return { ...(values as SiteCapability), id: readInsertId(insert) };
  }

  async listCapabilitiesForSite(
    siteId: number,
    opts: { status?: string } = {},
  ): Promise<SiteCapability[]> {
    const where = opts.status
      ? and(eq(siteCapabilities.siteId, siteId), eq(siteCapabilities.status, opts.status))
      : eq(siteCapabilities.siteId, siteId);
    return this.db.select().from(siteCapabilities).where(where);
  }

  // --- operation paths ----------------------------------------------------

  /** Highest existing version for a capability, or 0 when none. */
  async maxPathVersion(capabilityId: number): Promise<number> {
    const [row] = await this.db
      .select({ version: operationPaths.version })
      .from(operationPaths)
      .where(eq(operationPaths.capabilityId, capabilityId))
      .orderBy(desc(operationPaths.version))
      .limit(1);
    return row?.version ?? 0;
  }

  async createOperationPath(input: CreateOperationPathInput): Promise<OperationPath> {
    const version = input.version ?? (await this.maxPathVersion(input.capabilityId)) + 1;
    const externalId = newExternalId('operationPath');
    const values: NewOperationPath = {
      externalId,
      siteId: input.siteId,
      capabilityId: input.capabilityId,
      version,
      parentPathId: input.parentPathId ?? null,
      ...(input.status ? { status: input.status } : {}),
      entryUrlTemplate: input.entryUrlTemplate ?? null,
      ...(input.inputBindingJson !== undefined ? { inputBindingJson: input.inputBindingJson } : {}),
      ...(input.preconditionsJson !== undefined
        ? { preconditionsJson: input.preconditionsJson }
        : {}),
      ...(input.postconditionsJson !== undefined
        ? { postconditionsJson: input.postconditionsJson }
        : {}),
      laneHint: input.laneHint ?? null,
      ...(input.selectorStrategyJson !== undefined
        ? { selectorStrategyJson: input.selectorStrategyJson }
        : {}),
      ...(input.coordinateFallbackJson !== undefined
        ? { coordinateFallbackJson: input.coordinateFallbackJson }
        : {}),
      ...(input.screenshotAnchorJson !== undefined
        ? { screenshotAnchorJson: input.screenshotAnchorJson }
        : {}),
      ...(input.riskTagsJson !== undefined ? { riskTagsJson: input.riskTagsJson } : {}),
      sensitivePolicyRef: input.sensitivePolicyRef ?? null,
      ...(input.authWallMapJson !== undefined ? { authWallMapJson: input.authWallMapJson } : {}),
      ...(input.antiBotNotesJson !== undefined ? { antiBotNotesJson: input.antiBotNotesJson } : {}),
    };
    const insert = await this.db.insert(operationPaths).values(values);
    return { ...(values as OperationPath), id: readInsertId(insert) };
  }

  /**
   * Verified operation paths for a site, freshest first. This is the
   * runtime read the browser lane uses (Pack C) to pick a prior.
   */
  async getVerifiedPathsForSite(siteId: number): Promise<OperationPath[]> {
    return this.db
      .select()
      .from(operationPaths)
      .where(and(eq(operationPaths.siteId, siteId), eq(operationPaths.status, 'verified')))
      .orderBy(desc(operationPaths.lastVerifiedAt));
  }

  async updatePathStatus(
    externalId: string,
    status: string,
    extra: Partial<Pick<OperationPath, 'staleReason' | 'lastVerifiedAt'>> = {},
  ): Promise<boolean> {
    const res = await this.db
      .update(operationPaths)
      .set({ status, ...extra })
      .where(eq(operationPaths.externalId, externalId));
    return readAffectedRows(res) > 0;
  }

  // --- steps --------------------------------------------------------------

  async addStep(input: CreateStepInput): Promise<OperationPathStep> {
    const values: NewOperationPathStep = {
      pathId: input.pathId,
      stepIndex: input.stepIndex,
      stepType: input.stepType,
      intent: input.intent,
      ...(input.targetSelectorJson !== undefined
        ? { targetSelectorJson: input.targetSelectorJson }
        : {}),
      ...(input.targetTextJson !== undefined ? { targetTextJson: input.targetTextJson } : {}),
      ...(input.coordinateFallbackJson !== undefined
        ? { coordinateFallbackJson: input.coordinateFallbackJson }
        : {}),
      screenshotAnchorId: input.screenshotAnchorId ?? null,
      inputKey: input.inputKey ?? null,
      ...(input.expectedObservationJson !== undefined
        ? { expectedObservationJson: input.expectedObservationJson }
        : {}),
      ...(input.failureModesJson !== undefined ? { failureModesJson: input.failureModesJson } : {}),
      ...(input.sensitiveAction !== undefined ? { sensitiveAction: input.sensitiveAction } : {}),
      ...(input.sensitiveActionLevel ? { sensitiveActionLevel: input.sensitiveActionLevel } : {}),
      notes: input.notes ?? null,
    };
    const insert = await this.db.insert(operationPathSteps).values(values);
    return { ...(values as OperationPathStep), id: readInsertId(insert) };
  }

  async listStepsForPath(pathId: number): Promise<OperationPathStep[]> {
    return this.db
      .select()
      .from(operationPathSteps)
      .where(eq(operationPathSteps.pathId, pathId))
      .orderBy(asc(operationPathSteps.stepIndex));
  }

  // --- exploration runs ---------------------------------------------------

  async createExplorationRun(input: CreateExplorationRunInput): Promise<ExplorationRun> {
    const externalId = newExternalId('explorationRun');
    const values: NewExplorationRun = {
      externalId,
      siteId: input.siteId,
      watchTargetId: input.watchTargetId ?? null,
      triggerType: input.triggerType,
      runnerType: input.runnerType,
      ...(input.status ? { status: input.status } : {}),
      ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
    };
    const insert = await this.db.insert(explorationRuns).values(values);
    return { ...(values as ExplorationRun), id: readInsertId(insert) };
  }

  // --- canary results -----------------------------------------------------

  async recordCanaryResult(input: CreateCanaryResultInput): Promise<CanaryResult> {
    const externalId = newExternalId('canaryResult');
    const values: NewCanaryResult = {
      externalId,
      pathId: input.pathId,
      taskId: input.taskId ?? null,
      explorationRunId: input.explorationRunId ?? null,
      ...(input.status ? { status: input.status } : {}),
      failureType: input.failureType ?? null,
      ...(input.verifiedOutputsJson !== undefined
        ? { verifiedOutputsJson: input.verifiedOutputsJson }
        : {}),
      ...(input.evidenceSummaryJson !== undefined
        ? { evidenceSummaryJson: input.evidenceSummaryJson }
        : {}),
    };
    const insert = await this.db.insert(canaryResults).values(values);
    return { ...(values as CanaryResult), id: readInsertId(insert) };
  }

  async listCanaryResultsForPath(pathId: number): Promise<CanaryResult[]> {
    return this.db
      .select()
      .from(canaryResults)
      .where(eq(canaryResults.pathId, pathId))
      .orderBy(desc(canaryResults.createdAt));
  }
}
