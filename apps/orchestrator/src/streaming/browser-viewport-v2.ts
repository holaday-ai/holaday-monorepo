import { randomBytes } from 'node:crypto';
import type {
  BrowserActionRequest,
  BrowserFrameGeometry,
  BrowserFrameReference,
} from '@holaday/shared-types';

export const BROWSER_FRAME_MAX_AGE_MS = 5_000;
// A just-painted frame can be superseded while its human input is in flight.
// Keep only a 250ms bounded transport grace within the SAME target/revision.
const INPUT_FRAME_TRANSIT_MS = 250;
export class BrowserFrameGuard {
  private frame: BrowserFrameGeometry | null = null;
  private recent = new Map<string, { frame: BrowserFrameGeometry; supersededAt: number }>();
  observe(frame: BrowserFrameGeometry): void {
    const previous = this.frame;
    if (
      previous &&
      previous.tabId === frame.tabId &&
      previous.viewportRevision === frame.viewportRevision &&
      previous.cssWidth === frame.cssWidth &&
      previous.cssHeight === frame.cssHeight
    ) {
      this.recent.set(previous.frameId, { frame: previous, supersededAt: frame.capturedAt });
      for (const [id, entry] of this.recent)
        if (frame.capturedAt - entry.supersededAt > INPUT_FRAME_TRANSIT_MS) this.recent.delete(id);
      while (this.recent.size > 32) this.recent.delete(this.recent.keys().next().value!);
    } else this.recent.clear();
    this.frame = frame;
  }
  invalidate(): void {
    this.frame = null;
    this.recent.clear();
  }
  validate(ref: BrowserFrameReference | undefined, now = Date.now()): boolean {
    if (!ref || !this.frame) return false;
    const prior = this.recent.get(ref.frameId);
    const f =
      ref.frameId === this.frame.frameId
        ? this.frame
        : prior && now - prior.supersededAt <= INPUT_FRAME_TRANSIT_MS
          ? prior.frame
          : null;
    return !!(
      f &&
      ref.tabId === f.tabId &&
      ref.viewportRevision === f.viewportRevision &&
      now >= f.capturedAt &&
      now - f.capturedAt <= BROWSER_FRAME_MAX_AGE_MS
    );
  }
}

/** Instance belongs to one authenticated connection. Only the server's
 * authenticated confirmation handler may issue; client claims never mint tokens. */
export class BrowserActionConfirmations {
  private pending = new Map<string, { action: string; issued: number; expires: number }>();
  issue(action: BrowserActionRequest, now = Date.now()): string {
    for (const [key, entry] of this.pending) if (entry.expires <= now) this.pending.delete(key);
    if (this.pending.size >= 32) throw new Error('browser_confirmation_capacity');
    const nonce = randomBytes(32).toString('base64url');
    this.pending.set(nonce, { action: actionKey(action), issued: now, expires: now + 60_000 });
    return nonce;
  }
  consume(nonce: string | undefined, action: BrowserActionRequest, now = Date.now()): boolean {
    if (!nonce) return false;
    const entry = this.pending.get(nonce);
    this.pending.delete(nonce); // even mismatches burn the token
    return (
      !!entry && now >= entry.issued && now < entry.expires && entry.action === actionKey(action)
    );
  }
  invalidate(): void {
    this.pending.clear();
  }
}
function actionKey(a: BrowserActionRequest): string {
  return JSON.stringify([
    a.taskId,
    a.runId,
    a.actor,
    a.lane,
    a.tabId,
    a.origin,
    a.observationRevision,
    a.actionDigest,
    a.lease,
  ]);
}
