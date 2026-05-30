/**
 * CDP action executor for the vision loop.
 *
 * When the orchestrator sends `server.vision.act`, the SW translates
 * the `VisionAction` into a sequence of `chrome.debugger.sendCommand`
 * calls against the Chrome DevTools Protocol (CDP). That's the only
 * way a Chrome extension can simulate real user input at arbitrary
 * (x, y) coordinates — content-script `dispatchEvent` doesn't trigger
 * native behaviours (focus rings, IME, keyboard shortcuts).
 *
 * Coordinate contract: `VisionAction.click.x/y` are already REAL
 * viewport pixels when we get them (the orchestrator pre-translated
 * from Claude's model-space via `modelCoordToReal`). No scaling here.
 *
 * Debugger attach is lazy + idempotent — we attach on the first action
 * for a given tabId and keep the session open until detach is asked
 * for explicitly (or the tab closes). Phase A: every task is a fresh
 * SW instance; Phase B will wire detach to task-teardown.
 *
 * Screenshot: delegates to the existing adapter fallback chain in
 * crx-adapter.ts (playwright clean → playwright plain → raw CDP →
 * captureVisibleTab). The vision-loop uses that path for the `SW →
 * client.vision.observation` round-trip too, so we keep one screenshot
 * implementation across classic and vision flows.
 */

import type { VisionAction } from '@holaday/shared-types';

export interface ActionResult {
  ok: boolean;
  /** Short free-text the orchestrator plumbs through to Claude on the
   *  next tick's tool_result — so Claude can see when an action's
   *  coordinate was off-screen, the debugger bounced, etc. */
  message?: string;
}

/** CDP protocol version we pin every attach to. */
const CDP_VERSION = '1.3';
/** Per-command hard cap; CDP should answer sub-second for input events. */
const CDP_COMMAND_TIMEOUT_MS = 5_000;
/** How long to wait before reporting a wait() complete (honours upper bound). */
const WAIT_CAP_MS = 10_000;
const MAX_NAVIGATE_URL_LENGTH = 2048;

/** Tabs we've already attached the debugger to this SW lifetime. */
const attachedTabs = new Set<number>();

/**
 * Idempotently attach the debugger to the target tab. Returns quietly
 * if already attached; throws if the user denied the permission dialog
 * or the tab vanished.
 */
async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, CDP_VERSION);
  attachedTabs.add(tabId);
}

/**
 * Public escape hatch — release the debugger from a specific tab (or
 * all tabs this SW has attached). Callers should invoke on task
 * teardown. Failure to detach is not fatal — Chrome auto-detaches
 * when the tab closes or the SW is torn down.
 */
export async function detachFromTab(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // best-effort: tab may already be closed / debugger was released
  } finally {
    attachedTabs.delete(tabId);
  }
}

export async function detachAll(): Promise<void> {
  await Promise.allSettled([...attachedTabs].map((id) => detachFromTab(id)));
}

/**
 * Execute one VisionAction on the given tab. Returns `{ok}` and an
 * optional diagnostic message. Never throws — CDP failures become
 * `{ok: false, message: ...}` so the loop can continue.
 *
 * Terminal actions (`done` / `give_up`) are a no-op at the driver
 * level; the orchestrator handles them without dispatching an act
 * frame to the SW. If one ever arrives here, we report ok=true so
 * the loop can close cleanly.
 */
export async function executeCdpAction(tabId: number, action: VisionAction): Promise<ActionResult> {
  try {
    switch (action.kind) {
      case 'click':
        return await doClick(tabId, action);
      case 'type':
        return await doType(tabId, action);
      case 'key':
        return await doKey(tabId, action);
      case 'scroll':
        return await doScroll(tabId, action);
      case 'navigate':
        return await doNavigate(tabId, action);
      case 'wait_for_human':
        // Orchestrator does the polling + Layer 4 bookkeeping for this
        // action; the extension just acknowledges so the runner sees
        // ok:true and proceeds to the wait loop (triggered server-side
        // via the runner's turn subscription).
        return { ok: true, message: `wait_for_human: ${action.reason}` };
      case 'wait':
        return await doWait(action);
      case 'screenshot':
        // A `screenshot` action means "re-observe without acting";
        // the runner takes a fresh observation on the next tick, so
        // there's nothing to dispatch here.
        return { ok: true, message: 'screenshot re-observation noop' };
      case 'done':
      case 'give_up':
        return { ok: true, message: `${action.kind} terminal; no driver work` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('bad_url')) {
      return { ok: false, message: '导航地址无效，请检查后重试' };
    }
    return { ok: false, message: `CDP error: ${message.slice(0, 400)}` };
  }
}

// ---------------------------------------------------------------------------
// Per-kind CDP implementations.
// ---------------------------------------------------------------------------

async function doClick(
  tabId: number,
  action: Extract<VisionAction, { kind: 'click' }>,
): Promise<ActionResult> {
  await ensureAttached(tabId);
  const button = action.button ?? 'left';
  // Press then release. CDP's mouseMoved first is unnecessary for a
  // single click — Input.dispatchMouseEvent with `type: 'mousePressed'`
  // implicitly moves. Keep clickCount=1; double-click would be two
  // mousePressed frames.
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button,
    x: action.x,
    y: action.y,
    clickCount: 1,
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button,
    x: action.x,
    y: action.y,
    clickCount: 1,
  });
  return { ok: true, message: `clicked ${button} @ (${action.x},${action.y})` };
}

async function doType(
  tabId: number,
  action: Extract<VisionAction, { kind: 'type' }>,
): Promise<ActionResult> {
  await ensureAttached(tabId);
  // Input.insertText dispatches a real `input` event on the focused
  // element and handles IME / composing glyphs. Works in all input
  // surfaces (text inputs, contenteditable, textareas).
  await sendCdp(tabId, 'Input.insertText', { text: action.text });
  return { ok: true, message: `typed ${action.text.length} chars` };
}

async function doKey(
  tabId: number,
  action: Extract<VisionAction, { kind: 'key' }>,
): Promise<ActionResult> {
  await ensureAttached(tabId);
  // Support simple chords ("ctrl+a", "cmd+c") by splitting on '+' and
  // folding lowered modifiers into the CDP modifiers bitmask. The
  // terminal key is the last segment.
  const parts = action.key
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { ok: false, message: `empty key descriptor: ${action.key}` };
  }
  const last = parts[parts.length - 1];
  if (!last) return { ok: false, message: `empty key descriptor: ${action.key}` };
  const mods = parts.slice(0, -1).reduce((acc, m) => acc | modifierBit(m), 0);
  const info = resolveKey(last);
  await sendCdp(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: mods,
    key: info.key,
    code: info.code,
    ...(info.text ? { text: info.text } : {}),
    ...(info.windowsVirtualKeyCode !== undefined
      ? { windowsVirtualKeyCode: info.windowsVirtualKeyCode }
      : {}),
  });
  await sendCdp(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: mods,
    key: info.key,
    code: info.code,
    ...(info.windowsVirtualKeyCode !== undefined
      ? { windowsVirtualKeyCode: info.windowsVirtualKeyCode }
      : {}),
  });
  return { ok: true, message: `key ${action.key}` };
}

async function doScroll(
  tabId: number,
  action: Extract<VisionAction, { kind: 'scroll' }>,
): Promise<ActionResult> {
  await ensureAttached(tabId);
  // Scroll via mouseWheel at viewport centre. CDP expects deltaY
  // inverted from our convention: we pass positive=down, the API
  // treats positive=down as well, so it's 1:1.
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 400, // somewhere inside the viewport
    y: 300,
    deltaX: 0,
    deltaY: action.dy,
  });
  return { ok: true, message: `scrolled ${action.dy}px` };
}

async function doWait(action: Extract<VisionAction, { kind: 'wait' }>): Promise<ActionResult> {
  const ms = Math.min(action.ms, WAIT_CAP_MS);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return { ok: true, message: `waited ${ms}ms` };
}

async function doNavigate(
  tabId: number,
  action: Extract<VisionAction, { kind: 'navigate' }>,
): Promise<ActionResult> {
  const url = normalizeCdpNavigateUrl(action.url);
  await ensureAttached(tabId);
  await sendCdp(tabId, 'Page.navigate', { url });
  return { ok: true, message: `navigated to ${url}` };
}

export function normalizeCdpNavigateUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > MAX_NAVIGATE_URL_LENGTH) {
    throw new Error('bad_url');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('bad_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('bad_url');
  }
  return parsed.href;
}

// ---------------------------------------------------------------------------
// CDP plumbing.
// ---------------------------------------------------------------------------

/**
 * Send a CDP command with a hard-cap timeout wrapper. The underlying
 * `chrome.debugger.sendCommand` is a Promise-returning API on MV3
 * but silently hangs on detached targets; the cap protects us.
 */
async function sendCdp(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`CDP ${method} timeout ${CDP_COMMAND_TIMEOUT_MS}ms`)),
      CDP_COMMAND_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      chrome.debugger.sendCommand({ tabId }, method, params) as Promise<unknown>,
      cap,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * CDP modifier bitmask:
 *   1 = alt, 2 = ctrl, 4 = meta/cmd, 8 = shift
 * We lowercase the name so "Ctrl"/"ctrl"/"Cmd"/"cmd" all work.
 */
function modifierBit(name: string): number {
  switch (name.toLowerCase()) {
    case 'alt':
      return 1;
    case 'ctrl':
    case 'control':
      return 2;
    case 'meta':
    case 'cmd':
    case 'command':
    case 'super':
      return 4;
    case 'shift':
      return 8;
    default:
      return 0;
  }
}

interface KeyInfo {
  /** DOM KeyboardEvent.key (e.g. "Enter", "a", "ArrowDown"). */
  key: string;
  /** DOM KeyboardEvent.code (e.g. "Enter", "KeyA", "ArrowDown"). */
  code: string;
  /** Character that would be inserted; required for printable keys. */
  text?: string;
  /** Windows VK code — some CDP callers require it for correctness. */
  windowsVirtualKeyCode?: number;
}

/**
 * Map a named key (or single printable char) onto CDP's expected
 * shape. Covers the common special keys; a plain "a" or "X" falls
 * through to the printable-char branch.
 */
function resolveKey(name: string): KeyInfo {
  const named: Record<string, KeyInfo> = {
    Enter: { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', text: '\t', windowsVirtualKeyCode: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    Space: { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
    End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  };
  if (named[name]) return named[name];
  // Single printable char — emit as `text` so CDP inserts it.
  if (name.length === 1) {
    const code = /^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : name;
    return { key: name, code, text: name };
  }
  // Unknown multi-char name — let CDP try it raw and fail diagnostically.
  return { key: name, code: name };
}

/**
 * Test seam: reset the module-level attach set. Used by unit tests so
 * each scenario starts with no attachments assumed.
 */
export function _resetAttachedTabsForTests(): void {
  attachedTabs.clear();
}

// ---------------------------------------------------------------------------
// Vision-loop observation capture.
// ---------------------------------------------------------------------------

/**
 * Shape the SW reports back to the orchestrator for one tick.
 * `error` (if set) means capture failed — the orchestrator will surface
 * it as the tick's failure reason and exit the loop.
 */
export interface VisionObservationCapture {
  screenshotBase64: string;
  viewportWidth: number;
  viewportHeight: number;
  url: string;
  title: string;
  error?: string;
}

const MAX_OBSERVATION_SCREENSHOT_BASE64_CHARS = 2_000_000;
const MAX_OBSERVATION_VIEWPORT_PX = 20_000;
const MAX_OBSERVATION_URL_CHARS = 2048;
const MAX_OBSERVATION_TITLE_CHARS = 512;
const MAX_OBSERVATION_ERROR_CHARS = 1000;

function clipString(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function clampViewportSize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_OBSERVATION_VIEWPORT_PX, Math.round(value)));
}

export function sanitizeVisionObservationCapture(
  observation: VisionObservationCapture,
): VisionObservationCapture {
  let screenshotBase64 = observation.screenshotBase64;
  let error = observation.error;

  if (screenshotBase64.length > MAX_OBSERVATION_SCREENSHOT_BASE64_CHARS) {
    screenshotBase64 = '';
    error = error
      ? `${error}; Page.captureScreenshot returned oversized image`
      : 'Page.captureScreenshot returned oversized image';
  }

  return {
    screenshotBase64,
    viewportWidth: clampViewportSize(observation.viewportWidth),
    viewportHeight: clampViewportSize(observation.viewportHeight),
    url: clipString(observation.url, MAX_OBSERVATION_URL_CHARS),
    title: clipString(observation.title, MAX_OBSERVATION_TITLE_CHARS),
    ...(error ? { error: clipString(error, MAX_OBSERVATION_ERROR_CHARS) } : {}),
  };
}

/**
 * Pick the currently-active tab in the foreground window — the tab the
 * user is looking at. The vision loop always operates on whatever's
 * in front; we don't try to track a specific task's tab (Phase B).
 *
 * Returns null when there's no active tab (e.g. SW launched during
 * Chrome startup before any window has focus) so callers can surface
 * a clean error instead of crashing.
 */
export async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== 'number') return null;
  return tab.id;
}

/**
 * Capture one observation via raw CDP: screenshot + viewport dims +
 * url + title. Single round-trip through the debugger session (two
 * CDP calls: Page.captureScreenshot, Runtime.evaluate for dims/url/
 * title). Attaches debugger idempotently via ensureAttached.
 *
 * Never throws — any CDP failure returns a result with `error` set
 * plus best-effort defaults for the other fields. The orchestrator
 * checks `error` first; populated = failed tick.
 */
export async function captureVisionObservation(tabId: number): Promise<VisionObservationCapture> {
  try {
    await ensureAttached(tabId);
  } catch (err) {
    return sanitizeVisionObservationCapture({
      screenshotBase64: '',
      viewportWidth: 0,
      viewportHeight: 0,
      url: '',
      title: '',
      error: `debugger attach failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Read viewport + url + title FIRST so we still have metadata even
  // if the screenshot capture then fails.
  let viewportWidth = 0;
  let viewportHeight = 0;
  let url = '';
  let title = '';
  try {
    const evalResp = (await sendCdp(tabId, 'Runtime.evaluate', {
      expression:
        'JSON.stringify({ w: innerWidth, h: innerHeight, u: location.href, t: document.title })',
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    const raw = evalResp?.result?.value;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as { w?: number; h?: number; u?: string; t?: string };
      viewportWidth = Math.round(parsed.w ?? 0);
      viewportHeight = Math.round(parsed.h ?? 0);
      url = parsed.u ?? '';
      title = parsed.t ?? '';
    }
  } catch {
    // Tab may be an extension page, chrome://, or otherwise not
    // evaluable. Fall through with zeros; screenshot may still succeed.
  }

  let screenshotBase64 = '';
  let error: string | undefined;
  try {
    const shot = (await sendCdp(tabId, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 80,
      captureBeyondViewport: false,
    })) as { data?: unknown };
    if (typeof shot?.data === 'string' && shot.data.length > 0) {
      screenshotBase64 = shot.data;
    } else {
      error = `Page.captureScreenshot returned non-string data (${typeof shot?.data})`;
    }
  } catch (err) {
    error = `Page.captureScreenshot failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return sanitizeVisionObservationCapture({
    screenshotBase64,
    viewportWidth,
    viewportHeight,
    url,
    title,
    ...(error ? { error } : {}),
  });
}
