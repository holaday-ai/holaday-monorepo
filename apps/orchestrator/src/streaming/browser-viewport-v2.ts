import { randomBytes } from 'node:crypto';
import type { BrowserActionRequest } from '@holaday/shared-types';

// HOTFIX-R4A（协调方改，2026-11-14）: the frame freshness guard (BrowserFrameGuard, the 250 ms /
// lenient grace, frameGraceFor) is gone — the person's input is delivered like a remote desktop's.
// What stays: the server-owned one-use confirmations for sensitive actions.

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
  ]);
}
