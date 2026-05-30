/**
 * Phase 25b — auth-bridge content script.
 *
 * Runs ONLY on the workbench origins (holaday.ai, hd-app.orangebench.tech,
 * localhost dev). Watches `localStorage['holaday.access_token']` for
 * changes and pushes them to the SW so the extension's WS connection
 * stays in sync with whichever account is logged in on the web side.
 *
 * Why a content script (push) and not the existing tab-scan (pull)?
 *   - The pull path (background/index.ts → tryAutoLogin → chrome.scripting
 *     into open tabs) only fires on SW boot / keepalive / popup open.
 *     Logout / account swap could go undetected for up to 30 s.
 *   - The push path makes auth changes reactive: SPA writes token →
 *     storage event / poll observes → content script posts to SW →
 *     SW updates chrome.storage → ws-client's onChanged listener
 *     swaps the WS connection. Whole loop is < 1 s.
 *
 * Two observation channels:
 *
 *   1. `storage` event — fires when ANOTHER tab on the same origin
 *      mutates localStorage. Catches cross-tab account swaps but
 *      NOT the writes that happen in THIS tab (browser-spec behaviour).
 *
 *   2. Periodic poll (POLL_INTERVAL_MS) — catches in-tab writes that
 *      `storage` doesn't fire for. Cheap: a single localStorage read
 *      + string compare every 3 s.
 *
 * Both call through `observe()` which is idempotent — dedupe inside
 * the helper means redundant fires only cost a string compare.
 */

import { decideAction, looksLikeToken, TOKEN_KEY } from './auth-bridge-core.js';

/**
 * Poll cadence. Chosen so:
 *   - login + popup open within 3 s of redirect-callback lands the
 *     extension as already-authed (no manual reconnect needed).
 *   - logout is observable within 3 s (popup shows logged-out state).
 *   - The work per tick (one localStorage.getItem + one ===) is so
 *     cheap that the cadence cost is irrelevant.
 *
 * Faster than 1 s buys nothing user-visible; slower than 5 s makes
 * "I just logged in" / "I just logged out" feel laggy.
 */
const POLL_INTERVAL_MS = 3000;

/**
 * SW message type. Mirrored by the handler in background/index.ts —
 * must stay in sync with the literal string there.
 *
 * Payload contract:
 *   { type: 'holaday.auth.token', token: string | null }
 *
 * `token === null` means SPA logged out / cleared localStorage. The
 * SW treats this as the "clear" action and disconnects the WS.
 */
const SW_MESSAGE_TYPE = 'holaday.auth.token';

interface AuthBridgeState {
  /** Last token we successfully posted to the SW. Null = SPA was
   *  logged out as of the last observation. */
  lastSent: string | null;
  /** Has the initial observation been performed? */
  initialised: boolean;
}

const state: AuthBridgeState = {
  lastSent: null,
  initialised: false,
};

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Some sites disable localStorage (cookie-blocker extensions,
    // private mode mods); pretend we saw null so we don't crash.
    return null;
  }
}

function postToSw(token: string | null): void {
  try {
    chrome.runtime.sendMessage({ type: SW_MESSAGE_TYPE, token }, () => {
      // sendResponse intentionally ignored — SW does the work, no
      // ack required. Reading `chrome.runtime.lastError` here
      // suppresses the harmless "Unchecked runtime.lastError" warning
      // some Chromes emit when the SW respawns mid-frame.
      if (chrome.runtime.lastError) {
        // Don't log every transient SW-respawn race; only persistent
        // failures (the SW is unreachable) would matter.
      }
    });
  } catch {
    // Extension reloaded under us, page is mid-unload, etc. Either
    // way the next poll tick will retry — no recovery needed.
  }
}

function observe(): void {
  const current = readToken();
  const decision = decideAction(state.lastSent, current);
  const wasInitialised = state.initialised;
  if (decision.kind === 'unchanged' && wasInitialised) return;
  state.initialised = true;
  if (decision.kind === 'set') {
    if (!looksLikeToken(decision.token)) {
      // The SPA wrote something that doesn't look like a real token.
      // Treat as a clear (forces the SW to disconnect if it was
      // mid-flight on the previous value) but don't ship the garbage.
      if (state.lastSent !== null) {
        state.lastSent = null;
        postToSw(null);
      }
      return;
    }
    state.lastSent = decision.token;
    postToSw(decision.token);
    return;
  }
  if (decision.kind === 'clear') {
    state.lastSent = null;
    postToSw(null);
    return;
  }
  // 'unchanged' but not yet initialised — first run, even null counts
  // as "tell the SW the current state so it can sync".
  if (!wasInitialised) {
    if (current !== null) {
      state.lastSent = current;
      postToSw(current);
    } else {
      postToSw(null);
    }
  }
}

// Initial observation immediately on script load (not deferred to the
// first poll tick) so the SW gets the SPA's current state within a
// few ms of the page settling.
observe();

// Cross-tab observations. `storage` events fire on OTHER tabs / windows
// of the same origin when a key mutates — useful for the account-swap
// scenario where the user logs into a different account in another tab.
window.addEventListener('storage', (event) => {
  if (event.key !== TOKEN_KEY) return;
  observe();
});

// In-tab observations. `storage` events do NOT fire on the tab that
// performed the mutation, so a login/logout that happens in THIS tab
// needs the poll fallback to be observed. The cadence is bounded by
// POLL_INTERVAL_MS.
setInterval(observe, POLL_INTERVAL_MS);
