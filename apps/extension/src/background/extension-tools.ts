/**
 * Phase 25 — extension-side tool executor (Mode B v0.1).
 *
 * Handles `server.extension.tool_call` frames from the orchestrator
 * by driving the user's active Chrome tab via chrome.tabs +
 * chrome.scripting + chrome.tabs.captureVisibleTab APIs. Because the
 * tab IS the user's own browser, all cookies / sessions are
 * automatically inherited — that's the whole point of Mode B.
 *
 * Tool kinds in v0.1:
 *   - `navigate`   → chrome.tabs.update to target URL, wait for
 *                    `complete` status, then chrome.scripting.executeScript
 *                    reads document.title + a body-text excerpt.
 *   - `screenshot` → chrome.tabs.captureVisibleTab with JPEG quality
 *                    50 to keep the WS payload under 200KB.
 *
 * Each handler returns a `{ ok, result?, error? }` shape that maps
 * 1:1 to the `client.extension.tool_result` schema. Errors carry a
 * short Chinese message + machine-readable code so the orchestrator's
 * verifier / SPA can render them nicely.
 *
 * Tab strategy: we operate on the user's FOCUSED tab by default. The
 * `navigate` action also re-uses that tab (chrome.tabs.update) so the
 * user's existing context (cookies + signed-in profiles) carries
 * through. If no tab is available (rare — only for headless Chrome
 * profiles) we surface 'no_active_tab' so the caller can fall back to
 * Mode A.
 */

import type { ClientMessage, ServerMessage } from '@holaday/shared-types';
import { withDeadline } from '../shared/deadline.js';
import { sendCriticalClientMessage } from './critical-send.js';
import { getCurrentWsToken } from './ws-client.js';

type ExtensionToolCall = Extract<ServerMessage, { type: 'server.extension.tool_call' }>;

/** Wait deadline for navigate complete; chrome.tabs.update returns fast but
 *  the "loaded" status is what matters for reading the body text. */
const NAVIGATE_LOAD_TIMEOUT_MS = 25_000;

/** Cap body-text extract size — typical page is < 50KB extracted plain text. */
const BODY_TEXT_CHAR_CAP = 8_000;
const DEFAULT_NAVIGATE_WAIT_MS = 1500;
const MAX_NAVIGATE_WAIT_MS = 10_000;
const BODY_TEXT_READ_TIMEOUT_MS = 5_000;
const TAB_QUERY_TIMEOUT_MS = 1_500;
const TAB_UPDATE_TIMEOUT_MS = 5_000;
const TAB_GET_TIMEOUT_MS = 2_000;
const SCREENSHOT_CAPTURE_TIMEOUT_MS = 8_000;
const SCREENSHOT_CAPTURE_QUALITIES = [50, 35, 25] as const;
const MAX_NAVIGATE_URL_LENGTH = 2048;
const MAX_SCREENSHOT_RESULT_BASE64_CHARS = 2_000_000;
const RECENT_TOOL_RESULT_TTL_MS = 60_000;
const MAX_RECENT_TOOL_RESULTS = 100;

type ExtensionToolResultPayload = Omit<
  Extract<ClientMessage, { type: 'client.extension.tool_result' }>,
  'type' | 'taskId' | 'requestId' | 'at'
>;
type ExtensionToolResultMessage = Extract<ClientMessage, { type: 'client.extension.tool_result' }>;

const recentToolCallResults = new Map<
  string,
  { at: number; ownerToken: string | null; payload: ExtensionToolResultPayload }
>();
const inFlightToolCallResults = new Map<
  string,
  { ownerToken: string | null; promise: Promise<ExtensionToolResultPayload> }
>();

function toolCallDedupeKey(taskId: string, requestId: string): string {
  return `${taskId}\u0000${requestId}`;
}

/**
 * Get the currently-focused tab. Returns null when no tab is available
 * (e.g. the only window is the extension popup itself, or a service-
 * worker-only Chrome profile).
 */
export async function getActiveTabForExtensionTool(
  opts: { allowErrorPage?: boolean } = {},
): Promise<chrome.tabs.Tab | null> {
  const queries: chrome.tabs.QueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { active: true, windowType: 'normal' },
    { windowType: 'normal' },
  ];
  const candidateGroups = await Promise.all(
    queries.map(async (query, queryIndex) => {
      try {
        const tabs = await withDeadline(
          chrome.tabs.query(query),
          TAB_QUERY_TIMEOUT_MS,
          'tab_query_timeout',
        );
        return tabs.map((tab, tabIndex) => ({ tab, queryIndex, tabIndex }));
      } catch {
        // Keep the browser-tool fallback chain alive. currentWindow can
        // reject while lastFocused/normal window lookup still succeeds.
        return [];
      }
    }),
  );
  const candidates = candidateGroups.flat();

  return pickBestTabCandidate(candidates, (tab) => isNavigablePageTab(tab, opts))
    ?? pickBestTabCandidate(candidates, (tab) => isNonInternalTab(tab, opts));
}

function pickBestTabCandidate(
  candidates: Array<{ tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number }>,
  predicate: (tab: chrome.tabs.Tab | undefined) => tab is chrome.tabs.Tab,
): chrome.tabs.Tab | null {
  const [best] = candidates
    .filter(({ tab }) => predicate(tab))
    .sort(compareTabCandidates);
  return best?.tab ?? null;
}

function compareTabCandidates(
  a: { tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number },
  b: { tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number },
): number {
  if (a.queryIndex !== b.queryIndex) return a.queryIndex - b.queryIndex;
  const aLastAccessed = typeof a.tab.lastAccessed === 'number' ? a.tab.lastAccessed : 0;
  const bLastAccessed = typeof b.tab.lastAccessed === 'number' ? b.tab.lastAccessed : 0;
  if (aLastAccessed !== bLastAccessed) return bLastAccessed - aLastAccessed;
  return a.tabIndex - b.tabIndex;
}

function isWebPageTab(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab {
  if (!tab) return false;
  if (typeof tab.id !== 'number') return false;
  if (!tab.url) return false;
  return tab.url.startsWith('http://') || tab.url.startsWith('https://');
}

function isNavigablePageTab(
  tab: chrome.tabs.Tab | undefined,
  opts: { allowErrorPage?: boolean } = {},
): tab is chrome.tabs.Tab {
  if (!tab) return false;
  if (typeof tab.id !== 'number') return false;
  if (!tab.url) return false;
  if (tab.url.startsWith('http://') || tab.url.startsWith('https://')) return true;
  if (!opts.allowErrorPage) return false;
  return tab.url.toLowerCase().startsWith('chrome-error://');
}

function isNonInternalTab(
  tab: chrome.tabs.Tab | undefined,
  opts: { allowErrorPage?: boolean } = {},
): tab is chrome.tabs.Tab {
  if (!tab) return false;
  if (typeof tab.id !== 'number') return false;
  if (!tab.url) return true;
  const url = tab.url.toLowerCase();
  if (opts.allowErrorPage && url.startsWith('chrome-error://')) return true;
  return !/^(chrome|chrome-extension|chrome-error|edge|about|devtools|view-source|file):/i.test(
    tab.url,
  );
}

/**
 * Wait for tab status === 'complete'. We listen via chrome.tabs.onUpdated
 * rather than polling so the wake doesn't burn the SW's CPU quota.
 * Returns once the target tab reaches 'complete' or we hit timeoutMs.
 */
export function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
  opts: { previousUrl?: string; targetUrl?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let listener: ((id: number, info: chrome.tabs.TabChangeInfo) => void) | null = null;
    let removeListener: ((id: number) => void) | null = null;
    const previousUrl = opts.previousUrl ?? '';
    const targetUrl = opts.targetUrl ?? '';
    const requireNavigationSignal = Boolean(
      previousUrl &&
        targetUrl &&
        stripHash(previousUrl) !== stripHash(targetUrl),
    );
    let sawNavigationSignal = !requireNavigationSignal;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (listener) chrome.tabs.onUpdated.removeListener(listener);
      if (removeListener) chrome.tabs.onRemoved.removeListener(removeListener);
    };
    const finish = (fn: () => void): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      fn();
    };
    timer = setTimeout(() => {
      finish(() => reject(new Error('navigate_timeout')));
    }, timeoutMs);
    timer && (timer as { unref?: () => void }).unref?.();
    const maybeComplete = (tab: Pick<chrome.tabs.Tab, 'status' | 'url'>): void => {
      if (tab.url && previousUrl && stripHash(tab.url) !== stripHash(previousUrl)) {
        sawNavigationSignal = true;
      }
      if (tab.status === 'complete' && sawNavigationSignal) {
        finish(resolve);
      }
    };
    listener = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id !== tabId) return;
      if (info.status === 'loading' || (info.url && stripHash(info.url) !== stripHash(previousUrl))) {
        sawNavigationSignal = true;
      }
      maybeComplete(info);
    };
    removeListener = (id: number): void => {
      if (id !== tabId) return;
      finish(() => reject(new Error('tab_closed')));
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removeListener);
    void chrome.tabs.get(tabId).then(
      (tab) => maybeComplete(tab),
      (err) => {
        if (isTabClosedError(err)) {
          finish(() => reject(new Error('tab_closed')));
          return;
        }
        // Keep listening. tabs.get can fail briefly while Chrome
        // swaps the provisional navigation entry into the live tab.
      },
    );
  });
}

function stripHash(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.href;
  } catch {
    return raw.split('#')[0] ?? raw;
  }
}

function isTabClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('tab closed') ||
    lower.includes('no tab with id') ||
    lower.includes('target closed') ||
    lower.includes('target detached') ||
    lower.includes('not attached') ||
    lower.includes('frame was detached') ||
    lower.includes('no frame with id') ||
    (lower.includes('frame with id') && lower.includes('removed'))
  );
}

interface NavigateResult {
  finalUrl: string;
  title: string;
  bodyText: string;
}

/**
 * Drive the active tab to `url`, wait for load, return the final URL,
 * page title, and a clipped body-text snapshot.
 *
 * Body-text extraction runs as a chrome.scripting.executeScript with
 * `world: 'MAIN'` so it sees the page's real DOM (not an isolated
 * world). The injected function is intentionally trivial — anything
 * fancier (selectors, AI extraction) belongs server-side.
 */
async function executeNavigate(
  url: string,
  waitMs: number,
  loadTimeoutMs: number,
): Promise<NavigateResult> {
  const tab = await getActiveTabForExtensionTool({ allowErrorPage: true });
  if (!tab?.id) {
    throw new Error('no_active_tab');
  }
  const previousUrl = tab.url;
  await focusTabWindow(tab);
  await withDeadline(
    chrome.tabs.update(tab.id, { active: true, url }),
    TAB_UPDATE_TIMEOUT_MS,
    'extension_tool_timeout',
  );
  await waitForTabComplete(tab.id, loadTimeoutMs, { previousUrl, targetUrl: url });
  // Post-load settle. Some pages defer the meaningful DOM until after
  // a microtask burst (React / Vue hydration). The default 1500ms
  // matches what the orchestrator's `defaultWait` uses too.
  if (waitMs > 0) {
    await new Promise<void>((r) => setTimeout(r, waitMs));
  }
  // Re-read the tab to get the final URL after redirects.
  const reloaded = await withDeadline(
    chrome.tabs.get(tab.id),
    TAB_GET_TIMEOUT_MS,
    'extension_tool_timeout',
  );
  const finalUrl = reloaded.url ?? url;
  const title = reloaded.title ?? '';
  if (isChromeErrorPageUrl(finalUrl)) {
    return {
      finalUrl,
      title,
      bodyText: title ? `Chrome error page: ${title}` : 'Chrome error page',
    };
  }
  let rawText = '';
  try {
    rawText = await readBodyText(tab.id);
  } catch (err) {
    if (isBodyTextTimeout(err)) {
      console.warn('[holaday] extension navigate body text read timed out');
    } else {
      console.warn('[holaday] extension navigate body text read unavailable', err);
    }
  }
  return { finalUrl, title, bodyText: rawText };
}

function isChromeErrorPageUrl(url: string): boolean {
  return url.toLowerCase().startsWith('chrome-error://');
}

async function readBodyText(tabId: number): Promise<string> {
  const [first] = await withDeadline(
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (maxChars: number) => {
        // Runs in page context — no closure over outer scope.
        const t = document.body?.innerText ?? '';
        return t.length > maxChars
          ? `${t.slice(0, maxChars)}\n…(已截断，原文 ${t.length} 字)`
          : t;
      },
      args: [BODY_TEXT_CHAR_CAP],
    }),
    BODY_TEXT_READ_TIMEOUT_MS,
    'body_text_timeout',
  );
  return typeof first?.result === 'string' ? first.result : '';
}

function isBodyTextTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes('body_text_timeout');
}

export function normalizeNavigateUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > MAX_NAVIGATE_URL_LENGTH) {
    throw new Error('bad_url');
  }

  let parsed: URL;
  try {
    parsed = new URL(hasHierarchicalUrlScheme(value) ? value : normalizeBareNavigateUrl(value));
  } catch {
    throw new Error('bad_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('bad_url');
  }
  return parsed.href;
}

function hasHierarchicalUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function normalizeBareNavigateUrl(value: string): string {
  const localHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i.test(value);
  return `${localHost ? 'http' : 'https'}://${value}`;
}

function normalizeNavigateWaitMs(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_NAVIGATE_WAIT_MS;
  return Math.max(0, Math.min(MAX_NAVIGATE_WAIT_MS, Math.trunc(raw)));
}

interface ScreenshotResult {
  /** base64 JPEG (no data: prefix). Cap ~200KB by using quality 50. */
  imageBase64: string;
  width: number;
  height: number;
}

export function normalizeScreenshotCaptureDataUrl(dataUrl: string): ScreenshotResult {
  const idx = dataUrl.indexOf(',');
  if (idx >= 0 && !dataUrl.slice(0, idx).toLowerCase().startsWith('data:image/')) {
    throw new Error('screenshot_invalid');
  }
  const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  if (!base64.trim()) {
    throw new Error('screenshot_empty');
  }
  if (base64.length > MAX_SCREENSHOT_RESULT_BASE64_CHARS) {
    throw new Error('screenshot_too_large');
  }
  return { imageBase64: base64, width: 0, height: 0 };
}

async function executeScreenshot(): Promise<ScreenshotResult> {
  const tab = await getActiveTabForExtensionTool({ allowErrorPage: true });
  if (!tab?.id) {
    throw new Error('no_active_tab');
  }
  if (tab.active === false) {
    await withDeadline(
      chrome.tabs.update(tab.id, { active: true }),
      TAB_UPDATE_TIMEOUT_MS,
      'extension_tool_timeout',
    );
  }
  await focusTabWindow(tab);
  let lastError: unknown = null;
  for (const quality of SCREENSHOT_CAPTURE_QUALITIES) {
    const dataUrl = await withDeadline(
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality }),
      SCREENSHOT_CAPTURE_TIMEOUT_MS,
      'extension_tool_timeout',
    );
    try {
      return normalizeScreenshotCaptureDataUrl(dataUrl);
    } catch (err) {
      lastError = err;
      if (!isScreenshotTooLargeError(err)) throw err;
    }
  }
  throw lastError ?? new Error('screenshot_too_large');
}

async function focusTabWindow(tab: chrome.tabs.Tab): Promise<void> {
  if (typeof tab.windowId !== 'number' || !chrome.windows?.update) return;
  try {
    await withDeadline(
      chrome.windows.update(tab.windowId, { focused: true }),
      TAB_UPDATE_TIMEOUT_MS,
      'extension_tool_timeout',
    );
  } catch (err) {
    console.warn('[holaday] extension tool window focus unavailable', err);
  }
}

function isScreenshotTooLargeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes('screenshot_too_large');
}

export function extensionToolErrorPayload(
  err: unknown,
): { message: string; code: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (msg.startsWith('no_active_tab')) {
    return { message: '浏览器当前没有活动标签页', code: 'no_active_tab' };
  }
  if (msg.startsWith('bad_url')) {
    return { message: '导航地址无效，请检查后重试', code: 'bad_args' };
  }
  if (lower.includes('navigate_timeout') || lower.includes('extension_tool_timeout')) {
    return {
      message: '页面响应超时，请保持标签页打开后重试',
      code: 'timeout',
    };
  }
  if (lower.includes('screenshot_too_large')) {
    return {
      message: '截图过大，浏览器已停止发送该帧，请缩小窗口或重试',
      code: 'screenshot_too_large',
    };
  }
  if (lower.includes('screenshot_empty') || lower.includes('screenshot_invalid')) {
    return {
      message: '浏览器没有返回有效截图，请确认页面可见后重试',
      code: 'screenshot_unavailable',
    };
  }
  if (
    lower.includes('cannot access contents of url') ||
    lower.includes('missing host permission') ||
    lower.includes('host permission') ||
    lower.includes('activetab permission') ||
    lower.includes('cannot access a chrome:// url') ||
    lower.includes('cannot access a chrome-extension:// url') ||
    lower.includes('cannot access a file:// url') ||
    lower.includes('extensions gallery cannot be scripted') ||
    lower.includes('cannot be scripted')
  ) {
    return {
      message: '扩展没有这个网站的访问权限，请检查浏览器扩展权限后重试',
      code: 'host_permission',
    };
  }
  if (
    lower.includes('receiving end does not exist') ||
    lower.includes('message port closed') ||
    lower.includes('tab closed') ||
    lower.includes('no tab with id') ||
    lower.includes('target closed') ||
    lower.includes('target detached') ||
    lower.includes('not attached') ||
    lower.includes('frame was detached') ||
    lower.includes('target navigated or closed') ||
    lower.includes('execution context was destroyed') ||
    lower.includes('cannot find context with specified id') ||
    lower.includes('no frame with id') ||
    (lower.includes('frame with id') && lower.includes('removed'))
  ) {
    return {
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    };
  }
  return {
    message: '浏览器操作失败，请稍后重试',
    code: 'exec_error',
  };
}

/**
 * Top-level entry. Handles ONE server.extension.tool_call frame:
 *   1. Dispatch on `kind`
 *   2. Convert success / failure into the matching
 *      client.extension.tool_result frame
 *   3. Send it back over WS
 *
 * Caller (background/index.ts onServerMessage) just calls this and
 * moves on; we own the result-send path so errors don't escape.
 */
export async function handleExtensionToolCall(call: ExtensionToolCall): Promise<void> {
  const { taskId, requestId, kind, args } = call;
  const ownerToken = getCurrentWsToken();
  const dedupeKey = toolCallDedupeKey(taskId, requestId);
  const cached = recentToolCallResults.get(dedupeKey);
  if (cached && Date.now() - cached.at <= RECENT_TOOL_RESULT_TTL_MS) {
    console.warn('[holaday] duplicate completed extension tool call replayed', {
      taskId,
      requestId,
      kind,
    });
    sendExtensionToolResult(taskId, requestId, cached.payload, cached.ownerToken);
    return;
  }
  if (cached) recentToolCallResults.delete(dedupeKey);
  const pending = inFlightToolCallResults.get(dedupeKey);
  if (pending) {
    console.warn('[holaday] duplicate in-flight extension tool call replayed', {
      taskId,
      requestId,
      kind,
    });
    await pending.promise;
    return;
  }
  const callTimeoutMs = Math.max(1000, Math.min(60_000, call.timeoutMs ?? 30_000));
  const operationBudgetMs = Math.max(500, callTimeoutMs - 500);
  const waitMs = Math.min(
    normalizeNavigateWaitMs(args?.waitMs),
    Math.max(0, operationBudgetMs - 1250),
  );
  const navigateLoadTimeoutMs = Math.max(
    1000,
    Math.min(NAVIGATE_LOAD_TIMEOUT_MS, operationBudgetMs - waitMs - 250),
  );

  const promise = computeExtensionToolResult(
    kind,
    args,
    waitMs,
    navigateLoadTimeoutMs,
    operationBudgetMs,
  ).finally(() => {
    inFlightToolCallResults.delete(dedupeKey);
  });
  inFlightToolCallResults.set(dedupeKey, { ownerToken, promise });
  const payload = await promise;
  rememberRecentToolCallResult(dedupeKey, payload, ownerToken);
  sendExtensionToolResult(taskId, requestId, payload, ownerToken);
}

async function computeExtensionToolResult(
  kind: ExtensionToolCall['kind'],
  args: ExtensionToolCall['args'],
  waitMs: number,
  navigateLoadTimeoutMs: number,
  operationBudgetMs: number,
): Promise<ExtensionToolResultPayload> {
  try {
    if (kind === 'navigate') {
      const url = normalizeNavigateUrl(args?.url);
      const result = await withDeadline(
        executeNavigate(url, waitMs, navigateLoadTimeoutMs),
        operationBudgetMs,
        'extension_tool_timeout',
      );
      return { ok: true, result };
    }
    if (kind === 'screenshot') {
      const result = await withDeadline(
        executeScreenshot(),
        operationBudgetMs,
        'extension_tool_timeout',
      );
      return { ok: true, result };
    }
    return { ok: false, error: { message: `未知工具 kind: ${kind}`, code: 'bad_kind' } };
  } catch (err) {
    return {
      ok: false,
      error: extensionToolErrorPayload(err),
    };
  }
}

export function _resetExtensionToolInFlightForTests(): void {
  inFlightToolCallResults.clear();
  recentToolCallResults.clear();
}

function sendExtensionToolResult(
  taskId: string,
  requestId: string,
  payload: ExtensionToolResultPayload,
  ownerToken: string | null,
): boolean {
  const message: ExtensionToolResultMessage = {
    type: 'client.extension.tool_result',
    taskId,
    requestId,
    at: Date.now(),
    ...payload,
  };
  return sendCriticalClientMessage(message, 'extension tool result', { ownerToken });
}

function rememberRecentToolCallResult(
  dedupeKey: string,
  payload: ExtensionToolResultPayload,
  ownerToken: string | null,
): void {
  const now = Date.now();
  recentToolCallResults.set(dedupeKey, { at: now, ownerToken, payload });
  for (const [key, value] of recentToolCallResults) {
    if (now - value.at > RECENT_TOOL_RESULT_TTL_MS) recentToolCallResults.delete(key);
  }
  while (recentToolCallResults.size > MAX_RECENT_TOOL_RESULTS) {
    const oldest = recentToolCallResults.keys().next().value;
    if (!oldest) break;
    recentToolCallResults.delete(oldest);
  }
}
