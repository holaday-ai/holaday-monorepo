import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import type { ClaimEvidenceLink } from '../db/schema/claim-evidence-links.js';
import type { Claim } from '../db/schema/claims.js';
import { claims as claimsTable } from '../db/schema/claims.js';
import type { EvidenceArtifact } from '../db/schema/evidence-artifacts.js';
import { tasks as tasksTable } from '../db/schema/tasks.js';
import { ClaimRepository } from './claim-repository.js';
import { EvidenceArtifactRepository } from './evidence-artifact-repository.js';

/**
 * Phase 1 #3 Pack B — `LedgerRepository` (design §4.6 read API skeleton).
 *
 * Verifier-facing facade over the Pack A repositories. Addresses tasks /
 * claims by their external id (the verifier works in external ids) and
 * resolves to internal ids internally. Provides exactly the four reads
 * the design earmarks for the answer-verifier's eventual DB-backed path:
 *
 *   - getClaimsForTask(taskExternalId)
 *   - getArtifactsForTask(taskExternalId)
 *   - getGroundedUrls(taskExternalId)
 *   - getEvidenceForClaim(claimExternalId)
 *
 * SKELETON ONLY in Pack B: NOT wired into `answer-verifier.ts`, which
 * keeps reading the in-memory ledger. This exists so Pack C / a later
 * verifier swap can adopt it without re-deriving the queries.
 */
export class LedgerRepository {
  private readonly artifacts: EvidenceArtifactRepository;
  private readonly claims: ClaimRepository;

  constructor(private readonly db: DB) {
    this.artifacts = new EvidenceArtifactRepository(db);
    this.claims = new ClaimRepository(db);
  }

  private async resolveTaskId(taskExternalId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.externalId, taskExternalId))
      .limit(1);
    return row?.id ?? null;
  }

  private async resolveClaimId(claimExternalId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: claimsTable.id })
      .from(claimsTable)
      .where(eq(claimsTable.externalId, claimExternalId))
      .limit(1);
    return row?.id ?? null;
  }

  async getClaimsForTask(taskExternalId: string): Promise<Claim[]> {
    const id = await this.resolveTaskId(taskExternalId);
    return id == null ? [] : this.claims.getClaimsForTask(id);
  }

  async getArtifactsForTask(taskExternalId: string, purpose?: string): Promise<EvidenceArtifact[]> {
    const id = await this.resolveTaskId(taskExternalId);
    return id == null ? [] : this.artifacts.listByTask(id, purpose);
  }

  /**
   * Distinct URLs the agent actually grounded the answer in — the union
   * of artifact source/final URLs and the subjects of `source` claims
   * (the write path stores each grounded URL as a source claim).
   */
  async getGroundedUrls(taskExternalId: string): Promise<string[]> {
    const id = await this.resolveTaskId(taskExternalId);
    if (id == null) return [];
    const fromArtifacts = await this.artifacts.getGroundedUrlsForTask(id);
    const claims = await this.claims.getClaimsForTask(id);
    const fromClaims = claims
      .filter((c) => c.claimType === 'source')
      .map((c) => c.subject)
      .filter((s): s is string => typeof s === 'string' && /^https?:\/\//.test(s));
    return [...new Set([...fromArtifacts, ...fromClaims])];
  }

  async getEvidenceForClaim(
    claimExternalId: string,
  ): Promise<Array<{ link: ClaimEvidenceLink; artifact: EvidenceArtifact }>> {
    const id = await this.resolveClaimId(claimExternalId);
    return id == null ? [] : this.claims.getEvidenceForClaim(id);
  }
}
