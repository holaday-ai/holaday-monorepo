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
import { send } from './ws-client.js';

type ExtensionToolCall = Extract<ServerMessage, { type: 'server.extension.tool_call' }>;

/** Wait deadline for navigate complete; chrome.tabs.update returns fast but
 *  the "loaded" status is what matters for reading the body text. */
const NAVIGATE_LOAD_TIMEOUT_MS = 25_000;

/** Cap body-text extract size — typical page is < 50KB extracted plain text. */
const BODY_TEXT_CHAR_CAP = 8_000;
const DEFAULT_NAVIGATE_WAIT_MS = 1500;
const MAX_NAVIGATE_WAIT_MS = 10_000;
const MAX_NAVIGATE_URL_LENGTH = 2048;
const MAX_SCREENSHOT_RESULT_BASE64_CHARS = 2_000_000;

/**
 * Get the currently-focused tab. Returns null when no tab is available
 * (e.g. the only window is the extension popup itself, or a service-
 * worker-only Chrome profile).
 */
async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [currentWindowTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (currentWindowTab) return currentWindowTab;

    const [lastFocusedTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (lastFocusedTab) return lastFocusedTab;

    const [normalWindowTab] = await chrome.tabs.query({
      active: true,
      windowType: 'normal',
    });
    return normalWindowTab ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait for tab status === 'complete'. We listen via chrome.tabs.onUpdated
 * rather than polling so the wake doesn't burn the SW's CPU quota.
 * Returns once the target tab reaches 'complete' or we hit timeoutMs.
 */
export function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let listener: ((id: number, info: chrome.tabs.TabChangeInfo) => void) | null = null;
    let removeListener: ((id: number) => void) | null = null;
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
    listener = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id !== tabId) return;
      if (info.status === 'complete') {
        finish(resolve);
      }
    };
    removeListener = (id: number): void => {
      if (id !== tabId) return;
      finish(() => reject(new Error('tab_closed')));
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removeListener);
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish(resolve);
      },
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

function isTabClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('tab closed') ||
    lower.includes('no tab with id') ||
    lower.includes('target closed')
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
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('no_active_tab');
  }
  await chrome.tabs.update(tab.id, { url });
  await waitForTabComplete(tab.id, loadTimeoutMs);
  // Post-load settle. Some pages defer the meaningful DOM until after
  // a microtask burst (React / Vue hydration). The default 1500ms
  // matches what the orchestrator's `defaultWait` uses too.
  if (waitMs > 0) {
    await new Promise<void>((r) => setTimeout(r, waitMs));
  }
  // Re-read the tab to get the final URL after redirects.
  const reloaded = await chrome.tabs.get(tab.id);
  const finalUrl = reloaded.url ?? url;
  const title = reloaded.title ?? '';
  // Read body text via injected script.
  const [first] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => {
      // Runs in page context — no closure over outer scope.
      const t = document.body?.innerText ?? '';
      return t;
    },
  });
  const rawText = typeof first?.result === 'string' ? first.result : '';
  const bodyText =
    rawText.length > BODY_TEXT_CHAR_CAP
      ? `${rawText.slice(0, BODY_TEXT_CHAR_CAP)}\n…(已截断，原文 ${rawText.length} 字)`
      : rawText;
  return { finalUrl, title, bodyText };
}

export function normalizeNavigateUrl(raw: unknown): string {
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
  const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  if (base64.length > MAX_SCREENSHOT_RESULT_BASE64_CHARS) {
    throw new Error('screenshot_too_large');
  }
  return { imageBase64: base64, width: 0, height: 0 };
}

async function executeScreenshot(): Promise<ScreenshotResult> {
  // captureVisibleTab needs no tabId — operates on the focused window.
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 50 });
  return normalizeScreenshotCaptureDataUrl(dataUrl);
}

function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer && (timer as { unref?: () => void }).unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  if (
    lower.includes('cannot access contents of url') ||
    lower.includes('missing host permission') ||
    lower.includes('host permission') ||
    lower.includes('cannot access a chrome:// url')
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
    lower.includes('target closed')
  ) {
    return {
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    };
  }
  return {
    message: `执行失败：${msg.slice(0, 200)}`,
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
  const waitMs = normalizeNavigateWaitMs(args?.waitMs);
  const callTimeoutMs = Math.max(1000, Math.min(60_000, call.timeoutMs ?? 30_000));
  const operationBudgetMs = Math.max(500, callTimeoutMs - 500);
  const navigateLoadTimeoutMs = Math.max(
    1000,
    Math.min(NAVIGATE_LOAD_TIMEOUT_MS, operationBudgetMs - waitMs - 250),
  );
  let settled = false;

  const finish = (payload: Omit<Extract<ClientMessage, { type: 'client.extension.tool_result' }>, 'type' | 'taskId' | 'requestId' | 'at'>): void => {
    if (settled) return;
    settled = true;
    send({
      type: 'client.extension.tool_result',
      taskId,
      requestId,
      at: Date.now(),
      ...payload,
    });
  };

  try {
    if (kind === 'navigate') {
      const url = normalizeNavigateUrl(args?.url);
      const r = await withDeadline(
        executeNavigate(url, waitMs, navigateLoadTimeoutMs),
        operationBudgetMs,
        'extension_tool_timeout',
      );
      finish({ ok: true, result: r });
      return;
    }
    if (kind === 'screenshot') {
      const r = await withDeadline(
        executeScreenshot(),
        operationBudgetMs,
        'extension_tool_timeout',
      );
      finish({ ok: true, result: r });
      return;
    }
    finish({ ok: false, error: { message: `未知工具 kind: ${kind}`, code: 'bad_kind' } });
  } catch (err) {
    finish({
      ok: false,
      error: extensionToolErrorPayload(err),
    });
  }
}
