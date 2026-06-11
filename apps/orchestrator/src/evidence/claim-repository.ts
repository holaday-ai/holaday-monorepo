import { newExternalId } from '@holaday/shared-types';
import { desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readInsertId } from '../db/mysql-result.js';
import {
  type ClaimEvidenceLink,
  type NewClaimEvidenceLink,
  claimEvidenceLinks,
} from '../db/schema/claim-evidence-links.js';
import { type Claim, type NewClaim, claims } from '../db/schema/claims.js';
import { type EvidenceArtifact, evidenceArtifacts } from '../db/schema/evidence-artifacts.js';

/**
 * Phase 1 指令 #3 — `ClaimRepository` (Pack A storage foundation).
 *
 * Single touch-point for `claims` + `claim_evidence_links`. A claim is a
 * conclusion; a link grounds it in an `evidence_artifacts` row. Skeleton
 * scope — write + the verifier read API (§4.6: getClaimsForTask /
 * getEvidenceForClaim). NOT wired into the verifier in Pack A.
 */

export interface CreateClaimInput {
  taskId?: number | null;
  siteId?: number | null;
  capabilityId?: number | null;
  claimType: string;
  subject: string;
  predicate: string;
  objectText?: string | null;
  objectJson?: unknown;
  confidence?: string | null;
  verificationStatus?: string;
  createdByLane?: string | null;
}

export interface LinkEvidenceInput {
  claimId: number;
  artifactId: number;
  supportType?: string;
  excerptStart?: number | null;
  excerptEnd?: number | null;
  quotedExcerpt?: string | null;
  confidence?: string | null;
}

export class ClaimRepository {
  constructor(private readonly db: DB) {}

  async createClaim(input: CreateClaimInput): Promise<Claim> {
    const externalId = newExternalId('claim');
    const values: NewClaim = {
      externalId,
      taskId: input.taskId ?? null,
      siteId: input.siteId ?? null,
      capabilityId: input.capabilityId ?? null,
      claimType: input.claimType,
      subject: input.subject,
      predicate: input.predicate,
      objectText: input.objectText ?? null,
      ...(input.objectJson !== undefined ? { objectJson: input.objectJson } : {}),
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
      ...(input.verificationStatus ? { verificationStatus: input.verificationStatus } : {}),
      createdByLane: input.createdByLane ?? null,
    };
    const insert = await this.db.insert(claims).values(values);
    return { ...(values as Claim), id: readInsertId(insert) };
  }

  /** Ground a claim in an artifact. Idempotent on (claim, artifact, supportType). */
  async linkEvidence(input: LinkEvidenceInput): Promise<ClaimEvidenceLink> {
    const values: NewClaimEvidenceLink = {
      claimId: input.claimId,
      artifactId: input.artifactId,
      ...(input.supportType ? { supportType: input.supportType } : {}),
      excerptStart: input.excerptStart ?? null,
      excerptEnd: input.excerptEnd ?? null,
      quotedExcerpt: input.quotedExcerpt ?? null,
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
    };
    const insert = await this.db.insert(claimEvidenceLinks).values(values);
    return { ...(values as ClaimEvidenceLink), id: readInsertId(insert) };
  }

  /** All claims for a task, newest first. (§4.6 read API.) */
  async getClaimsForTask(taskId: number): Promise<Claim[]> {
    return this.db
      .select()
      .from(claims)
      .where(eq(claims.taskId, taskId))
      .orderBy(desc(claims.createdAt));
  }

  /**
   * Evidence supporting a claim: the link row joined to its artifact.
   * (§4.6 read API — powers the future VerificationBanner source list.)
   */
  async getEvidenceForClaim(
    claimId: number,
  ): Promise<Array<{ link: ClaimEvidenceLink; artifact: EvidenceArtifact }>> {
    const rows = await this.db
      .select({ link: claimEvidenceLinks, artifact: evidenceArtifacts })
      .from(claimEvidenceLinks)
      .innerJoin(evidenceArtifacts, eq(claimEvidenceLinks.artifactId, evidenceArtifacts.id))
      .where(eq(claimEvidenceLinks.claimId, claimId));
    return rows;
  }
}
