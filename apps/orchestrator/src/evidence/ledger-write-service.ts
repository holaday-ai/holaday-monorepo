import { createHash } from 'node:crypto';
import { newExternalId } from '@holaday/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { tasks as tasksTable } from '../db/schema/tasks.js';
import { type EvidenceLedger, getLedger } from '../execution/evidence-ledger.js';
import { getFeatureFlags } from '../execution/feature-flags.js';
import { type StorageProvider, getSharedStorageProvider } from '../files/storage-provider.js';
import { ClaimRepository } from './claim-repository.js';
import { EvidenceArtifactRepository } from './evidence-artifact-repository.js';

const LEDGER_WRITE_SOURCE_STATUSES = [
  'completed',
  'partial_success',
  'failed',
  'cancelled',
] as const;

/**
 * Phase 1 #3 Pack B — Evidence Ledger DB write path (design §4.6).
 *
 * At task terminal, the existing pipeline writes `tasks.evidence_json`
 * (the in-memory ledger snapshot) for backward compatibility. This
 * service ADDITIONALLY mirrors the ledger into the queryable Ledger
 * tables so the verifier / front-end / competitor analysis can pull
 * claims + evidence by task:
 *
 *   - One `evidence_artifacts` row (kind `raw_response`, purpose
 *     `task_evidence`) holding the ledger snapshot as an R2 object the
 *     artifact EXCLUSIVELY owns (so the retention reaper can delete it
 *     safely). retention_policy `task_30d`, expires_at now+30d.
 *   - One `answer` claim carrying the verifier verdict.
 *   - One `source` claim per grounded URL the agent actually visited.
 *   - `claim_evidence_links` grounding every claim in the artifact.
 *
 * Gated by `LEDGER_DB_WRITE` (default off). Fully best-effort: any
 * failure is logged and swallowed so the task's terminal path and the
 * answer verifier are never affected (acceptance: verifier unchanged).
 */

/**
 * Days a `task_evidence` artifact is retained before the retention reaper
 * may sweep it. env-configurable via `LEDGER_RETENTION_DAYS`; defaults to
 * 60 — a conservative window for the first reaper enablement (observe
 * before tightening). Invalid / non-positive / NaN / Infinity values fall
 * back to the default — same guard as `outputFileTtlMs` (file-service.ts)
 * so behaviour is consistent across the codebase.
 *
 * NOTE: this only affects NEWLY written artifacts. Existing rows keep the
 * `expires_at` stamped at write time; the reaper reads each row's own
 * `expires_at` (there is no global retention constant on the reaper side),
 * so changing this never retroactively re-dates rows already in the table.
 */
export const DEFAULT_LEDGER_RETENTION_DAYS = 60;
export function ledgerRetentionDays(): number {
  const raw = Number(process.env.LEDGER_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEDGER_RETENTION_DAYS;
}

const NOOP_LOGGER = {
  warn() {},
  info() {},
  error() {},
  debug() {},
  child() {
    return NOOP_LOGGER;
  },
} as unknown as Logger;

export interface WriteLedgerInput {
  taskExternalId: string;
  /** Verifier verdict (structural subset of VerificationResult). */
  verification: { passed: boolean; failureLevel?: string } | null;
  db: DB;
  logger?: Logger;
  /** Injectable for tests; defaults to the shared provider. */
  storage?: StorageProvider;
  /** Injectable for tests; defaults to `new Date()`. */
  now?: Date;
}

export interface WriteLedgerResult {
  artifactExternalId: string;
  answerClaimExternalId: string;
  sourceClaimCount: number;
}

/** Last URL the agent actually navigated to (browser_state), if any. */
function pickFinalUrl(ledger: EvidenceLedger): string | null {
  const entries = ledger.entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.sourceType === 'browser_state') {
      const m = e.fact.match(/https?:\/\/[^\s,;'")\]]+/);
      if (m) return m[0];
    }
  }
  return null;
}

/**
 * Flag-gated, best-effort entry point called from the task terminal
 * hook (after persistExecution, before disposeExecution). No-op when
 * the flag is off or no in-memory ledger exists for the task.
 */
export async function writeLedgerToDb(input: WriteLedgerInput): Promise<WriteLedgerResult | null> {
  if (!getFeatureFlags().LEDGER_DB_WRITE) return null;
  const ledger = getLedger(input.taskExternalId);
  if (!ledger) return null;
  try {
    return await writeLedgerToDbUnchecked(input, ledger);
  } catch (err) {
    input.logger?.warn(
      { err: err instanceof Error ? err.message : String(err), taskId: input.taskExternalId },
      'ledger-write: DB mirror failed (non-blocking)',
    );
    return null;
  }
}

/**
 * The actual write, with no flag/ledger guards — exported for unit
 * tests that inject a fake db + storage and drive it directly.
 */
export async function writeLedgerToDbUnchecked(
  input: WriteLedgerInput,
  ledger: EvidenceLedger,
): Promise<WriteLedgerResult | null> {
  const now = input.now ?? new Date();
  const db = input.db;

  const [row] = await db
    .select({ id: tasksTable.id, userId: tasksTable.userId, intent: tasksTable.intent })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.externalId, input.taskExternalId),
        inArray(tasksTable.status, [...LEDGER_WRITE_SOURCE_STATUSES]),
      ),
    )
    .limit(1);
  if (!row) return null;

  const storage =
    input.storage ?? getSharedStorageProvider({ logger: input.logger ?? NOOP_LOGGER });

  // Upload the ledger snapshot as an R2 object the artifact owns.
  const snapshot = ledger.toJSON();
  const buffer = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const { storagePath } = await storage.put({
    userExternalId: input.taskExternalId,
    kind: 'output',
    fileExternalId: newExternalId('file'),
    filename: 'evidence-ledger.json',
    buffer,
    mimetype: 'application/json',
  });

  const groundedUrls = ledger.getGroundedUrls();
  const firstFact = ledger.getObservedFacts()[0]?.fact ?? ledger.entries[0]?.fact ?? null;
  const expiresAt = new Date(now.getTime() + ledgerRetentionDays() * 86_400_000);

  const artifactRepo = new EvidenceArtifactRepository(db);
  const artifact = await artifactRepo.create({
    ownerUserId: row.userId,
    taskId: row.id,
    artifactKind: 'raw_response',
    purpose: 'task_evidence',
    finalUrl: pickFinalUrl(ledger),
    r2Bucket: process.env.R2_BUCKET ?? 'local',
    r2Key: storagePath,
    contentType: 'application/json',
    sizeBytes: buffer.byteLength,
    sha256,
    capturedAt: now,
    collectorLane: 'ledger',
    confidence: 'observed',
    retentionPolicy: 'task_30d',
    expiresAt,
    rawExcerpt: firstFact ? firstFact.slice(0, 2000) : null,
    metadataJson: {
      entryCount: snapshot.entries.length,
      truncated: snapshot.truncated,
      groundedUrlCount: groundedUrls.length,
    },
  });

  const claimRepo = new ClaimRepository(db);
  const verificationStatus = input.verification
    ? input.verification.passed
      ? 'supported'
      : 'unsupported'
    : 'unverified';
  const answerClaim = await claimRepo.createClaim({
    taskId: row.id,
    claimType: 'answer',
    subject: row.intent.slice(0, 512),
    predicate: 'task_result',
    objectJson: {
      verificationPassed: input.verification?.passed ?? null,
      failureLevel: input.verification?.failureLevel ?? null,
    },
    verificationStatus,
    createdByLane: 'ledger',
  });
  await claimRepo.linkEvidence({
    claimId: answerClaim.id,
    artifactId: artifact.id,
    supportType: 'supports',
  });

  for (const url of groundedUrls) {
    const sourceClaim = await claimRepo.createClaim({
      taskId: row.id,
      claimType: 'source',
      subject: url.slice(0, 512),
      predicate: 'grounds_answer',
      objectJson: { url },
      verificationStatus: 'supported',
      createdByLane: 'ledger',
    });
    await claimRepo.linkEvidence({
      claimId: sourceClaim.id,
      artifactId: artifact.id,
      supportType: 'supports',
    });
  }

  return {
    artifactExternalId: artifact.externalId,
    answerClaimExternalId: answerClaim.externalId,
    sourceClaimCount: groundedUrls.length,
  };
}
