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
// FIX-61 复审 #2 #2: most keys carry no position — they go to the focused element, which the
// action gate binds at dispatch. A screen that paints the newest frame late (a large frame on
// a busy machine or phone) still names the previous one, and every key typed meanwhile was
// refused silently (「holaday」 arrived as 「h」). A mouse-up ends a press the server already
// accepted: refusing it left the button held in the browser, and at handback the browser was
// stopped as 「input outcome unknown」. Both accept a superseded frame of the SAME tab and
// revision for as long as a frame is fresh at all; any navigation, resize or tab change still
// clears it. Presses, moves, scrolls and keys that activate the focused element (Enter, Space —
// see frameGraceFor) keep the 250ms bound.
const LENIENT_INPUT_FRAME_GRACE_MS = BROWSER_FRAME_MAX_AGE_MS;
// HOTFIX-R4A (DEPLOY-R4 单列 5): an animating page (reCAPTCHA fading tiles, a video, a spinner)
// publishes frames without pause, so the frame a press names is superseded within milliseconds
// and, with the cross-border round trip, most presses were refused (「页面刚变了」, 7 of 11). A
// press, move or scroll on a frame of the SAME document — same tab, same revision (no navigation,
// no new history entry, no resize or tab change: those move the revision) and the same URL (no
// replaceState in between) — gets this grace. Dialogs are checked by the proxy; the document is
// checked again at dispatch (FIX-62). Enter / Space keep their own focus check.
export const SAME_DOCUMENT_FRAME_GRACE_MS = 1_500;
const SUPERSEDED_FRAMES_KEPT = 512;

/**
 * FIX-61 DEPLOY-61 第 0 步 #1 (safety): which frame grace a human input gets. Keys that ACTIVATE
 * the focused element — Enter (incl. the numpad one) and Space — keep the 250ms bound: a change
 * inside the page (a confirm dialog, focus moving to 「确认支付」) does not bump the viewport
 * revision, so a user looking at an older frame could otherwise fire a button they never saw.
 * Other keys, text and the release of an accepted press stay lenient. Exported for the proxy.
 */
export function frameGraceFor(message: {
  type: string;
  key?: string;
  code?: string;
  keyCode?: number;
}): 'pointer' | 'lenient' {
  if (message.type === 'keyDown') return activatesFocused(message) ? 'pointer' : 'lenient';
  return message.type === 'keyUp' || message.type === 'insertText' || message.type === 'mouseUp'
    ? 'lenient'
    : 'pointer';
}

function activatesFocused(m: { key?: string; code?: string; keyCode?: number }): boolean {
  const key = m.key;
  const code = m.code;
  return (
    key === 'Enter' ||
    key === ' ' ||
    key === 'Spacebar' ||
    code === 'Enter' ||
    code === 'NumpadEnter' ||
    code === 'Space' ||
    m.keyCode === 13 ||
    m.keyCode === 32
  );
}
/** How long a superseded frame still names a human input (see the constants above). */
export type BrowserFrameGrace = 'pointer' | 'lenient' | 'document';

export class BrowserFrameGuard {
  private frame: BrowserFrameGeometry | null = null;
  private recent = new Map<string, { frame: BrowserFrameGeometry; supersededAt: number }>();
  /** HOTFIX-R4A: the page URL each known frame was published under ('' = unknown). */
  private urls = new Map<string, string>();
  observe(frame: BrowserFrameGeometry, url = ''): void {
    this.urls.set(frame.frameId, url);
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
        if (frame.capturedAt - entry.supersededAt > LENIENT_INPUT_FRAME_GRACE_MS)
          this.recent.delete(id);
      while (this.recent.size > SUPERSEDED_FRAMES_KEPT)
        this.recent.delete(this.recent.keys().next().value!);
    } else this.recent.clear();
    for (const id of this.urls.keys())
      if (id !== frame.frameId && !this.recent.has(id)) this.urls.delete(id);
    this.frame = frame;
  }
  invalidate(): void {
    this.frame = null;
    this.recent.clear();
    this.urls.clear();
  }
  /** HOTFIX-R4A: when a frame still known to this guard was captured. */
  capturedAtOf(frameId: string): number | undefined {
    if (this.frame?.frameId === frameId) return this.frame.capturedAt;
    return this.recent.get(frameId)?.frame.capturedAt;
  }
  validate(
    ref: BrowserFrameReference | undefined,
    now = Date.now(),
    input: BrowserFrameGrace = 'pointer',
    /** HOTFIX-R4A: for 'document', the page URL now — it must be the frame's. */
    currentUrl?: string,
  ): boolean {
    if (!ref || !this.frame) return false;
    if (input === 'document') {
      const url = this.urls.get(ref.frameId);
      if (!url || !currentUrl || url !== currentUrl) return false;
    }
    const prior = this.recent.get(ref.frameId);
    const grace =
      input === 'lenient'
        ? LENIENT_INPUT_FRAME_GRACE_MS
        : input === 'document'
          ? SAME_DOCUMENT_FRAME_GRACE_MS
          : INPUT_FRAME_TRANSIT_MS;
    const f =
      ref.frameId === this.frame.frameId
        ? this.frame
        : prior && now - prior.supersededAt <= grace
          ? prior.frame
          : null;
    // HOTFIX-R4A (复审 P1-b): the same document scrolled or zoomed since is not the same picture —
    // a point on the old frame is another element now.
    if (
      input === 'document' &&
      f &&
      (f.scrollOffset.x !== this.frame.scrollOffset.x ||
        f.scrollOffset.y !== this.frame.scrollOffset.y ||
        f.pageScaleFactor !== this.frame.pageScaleFactor ||
        f.offsetTop !== this.frame.offsetTop)
    )
      return false;
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
  ]);
}
