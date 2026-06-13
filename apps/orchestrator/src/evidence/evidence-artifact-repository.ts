import { newExternalId } from '@holaday/shared-types';
import { and, desc, eq, lte, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import {
  type EvidenceArtifact,
  type NewEvidenceArtifact,
  evidenceArtifacts,
} from '../db/schema/evidence-artifacts.js';

/**
 * Phase 1 指令 #3 — `EvidenceArtifactRepository` (Pack A storage foundation).
 *
 * Single touch-point for the unified `evidence_artifacts` table (both
 * Playbook exploration artifacts and Ledger task evidence). Holds only
 * metadata + the R2 pointer; bytes live in R2 (key built by
 * `evidence/r2-keys.ts`). Skeleton scope — write + the reads the verifier
 * (§4.6) and the Pack B retention reaper need. NOT wired into runtime in
 * Pack A.
 *
 * Deletion semantics are application-layer (design §4.9), NOT FK cascade:
 * `task_id` is SET NULL so audit / manual_hold artifacts survive a task
 * delete. `deleteByExternalId` here only drops the MySQL row — the caller
 * (reaper / task-delete path, Pack B) is responsible for deleting the R2
 * object first.
 */

export interface CreateArtifactInput {
  ownerUserId?: number | null;
  siteId?: number | null;
  taskId?: number | null;
  explorationRunId?: number | null;
  artifactKind: string;
  purpose: string;
  sourceUrl?: string | null;
  finalUrl?: string | null;
  r2Bucket: string;
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  capturedAt: Date;
  collectorLane: string;
  collectorVersion?: string | null;
  viewportJson?: unknown;
  domHash?: string | null;
  screenshotHash?: string | null;
  rawExcerpt?: string | null;
  confidence?: string;
  retentionPolicy?: string;
  expiresAt?: Date | null;
  metadataJson?: unknown;
}

export class EvidenceArtifactRepository {
  constructor(private readonly db: DB) {}

  async create(input: CreateArtifactInput): Promise<EvidenceArtifact> {
    const externalId = newExternalId('evidenceArtifact');
    const values: NewEvidenceArtifact = {
      externalId,
      ownerUserId: input.ownerUserId ?? null,
      siteId: input.siteId ?? null,
      taskId: input.taskId ?? null,
      explorationRunId: input.explorationRunId ?? null,
      artifactKind: input.artifactKind,
      purpose: input.purpose,
      sourceUrl: input.sourceUrl ?? null,
      finalUrl: input.finalUrl ?? null,
      r2Bucket: input.r2Bucket,
      r2Key: input.r2Key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      capturedAt: input.capturedAt,
      collectorLane: input.collectorLane,
      collectorVersion: input.collectorVersion ?? null,
      ...(input.viewportJson !== undefined ? { viewportJson: input.viewportJson } : {}),
      domHash: input.domHash ?? null,
      screenshotHash: input.screenshotHash ?? null,
      rawExcerpt: input.rawExcerpt ?? null,
      ...(input.confidence ? { confidence: input.confidence } : {}),
      ...(input.retentionPolicy ? { retentionPolicy: input.retentionPolicy } : {}),
      expiresAt: input.expiresAt ?? null,
      ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
    };
    const insert = await this.db.insert(evidenceArtifacts).values(values);
    return { ...(values as EvidenceArtifact), id: readInsertId(insert) };
  }

  async findByExternalId(externalId: string): Promise<EvidenceArtifact | null> {
    const [row] = await this.db
      .select()
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.externalId, externalId))
      .limit(1);
    return row ?? null;
  }

  /** Artifacts for a task, optionally filtered by `purpose`. (§4.6 read API.) */
  async listByTask(taskId: number, purpose?: string): Promise<EvidenceArtifact[]> {
    const where = purpose
      ? and(eq(evidenceArtifacts.taskId, taskId), eq(evidenceArtifacts.purpose, purpose))
      : eq(evidenceArtifacts.taskId, taskId);
    return this.db
      .select()
      .from(evidenceArtifacts)
      .where(where)
      .orderBy(desc(evidenceArtifacts.capturedAt));
  }

  /** Distinct grounded URLs (source + final) for a task. (§4.6 read API.) */
  async getGroundedUrlsForTask(taskId: number): Promise<string[]> {
    const rows = await this.db
      .select({
        sourceUrl: evidenceArtifacts.sourceUrl,
        finalUrl: evidenceArtifacts.finalUrl,
      })
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.taskId, taskId));
    const urls = new Set<string>();
    for (const r of rows) {
      if (r.sourceUrl) urls.add(r.sourceUrl);
      if (r.finalUrl) urls.add(r.finalUrl);
    }
    return [...urls];
  }

  /**
   * Expired artifacts for the Pack B retention reaper: `expires_at <= now`
   * and not `manual_hold`. Capped by `limit` so the reaper can page.
   */
  async listExpired(now: Date, limit = 200): Promise<EvidenceArtifact[]> {
    return this.db
      .select()
      .from(evidenceArtifacts)
      .where(
        and(
          lte(evidenceArtifacts.expiresAt, now),
          ne(evidenceArtifacts.retentionPolicy, 'manual_hold'),
        ),
      )
      .orderBy(desc(evidenceArtifacts.expiresAt))
      .limit(limit);
  }

  /** Delete the MySQL row. Caller deletes the R2 object first. */
  async deleteByExternalId(externalId: string): Promise<boolean> {
    const res = await this.db
      .delete(evidenceArtifacts)
      .where(eq(evidenceArtifacts.externalId, externalId));
    return readAffectedRows(res) > 0;
  }
}
