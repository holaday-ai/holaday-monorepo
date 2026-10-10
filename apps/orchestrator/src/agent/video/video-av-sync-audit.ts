/**
 * Audio-visual sync review contract + pure audit helpers. Split out of
 * `video-av-sync-verifier.ts` (whose reviewer calls the dormant Gemini
 * endpoint) so the clone / IP lanes can consume reviews without importing
 * that legacy client. The verifier re-exports everything here.
 */

export interface VideoAvSyncEvidence {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly observation: string;
}

export interface VideoAvSyncReview {
  readonly status: 'pass' | 'fail' | 'unknown';
  readonly reason: string;
  readonly evidence: VideoAvSyncEvidence[];
  readonly model: string;
}

export interface VideoAvSyncAudit {
  readonly model: string;
  readonly evidence: Array<{
    readonly startSeconds: number;
    readonly endSeconds: number;
  }>;
}

export function videoAvSyncAudit(review: VideoAvSyncReview): VideoAvSyncAudit | undefined {
  if (review.status !== 'pass' || review.evidence.length === 0) return undefined;
  return {
    model: review.model,
    evidence: review.evidence.map(({ startSeconds, endSeconds }) => ({
      startSeconds,
      endSeconds,
    })),
  };
}

export function videoAvSyncLogContext(review: VideoAvSyncReview): {
  status: VideoAvSyncReview['status'];
  model: string;
  evidenceWindows: VideoAvSyncAudit['evidence'];
} {
  return {
    status: review.status,
    model: review.model,
    evidenceWindows: review.evidence.map(({ startSeconds, endSeconds }) => ({
      startSeconds,
      endSeconds,
    })),
  };
}
