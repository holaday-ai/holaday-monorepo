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

/**
 * Get the currently-focused tab. Returns null when no tab is available
 * (e.g. the only window is the extension popup itself, or a service-
 * worker-only Chrome profile).
 */
async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
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
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (listener) chrome.tabs.onUpdated.removeListener(listener);
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
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish(resolve);
      },
      () => {
        // Keep listening. tabs.get can fail briefly while Chrome
        // swaps the provisional navigation entry into the live tab.
      },
    );
  });
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
async function executeNavigate(url: string, waitMs: number): Promise<NavigateResult> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('no_active_tab');
  }
  await chrome.tabs.update(tab.id, { url });
  await waitForTabComplete(tab.id, NAVIGATE_LOAD_TIMEOUT_MS);
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
    rawText.length > 8000 ? `${rawText.slice(0, 8000)}\n…(已截断，原文 ${rawText.length} 字)` : rawText;
  return { finalUrl, title, bodyText };
}

interface ScreenshotResult {
  /** base64 JPEG (no data: prefix). Cap ~200KB by using quality 50. */
  imageBase64: string;
  width: number;
  height: number;
}

async function executeScreenshot(): Promise<ScreenshotResult> {
  // captureVisibleTab needs no tabId — operates on the focused window.
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 50 });
  // Strip "data:image/jpeg;base64," prefix.
  const idx = dataUrl.indexOf(',');
  const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  return { imageBase64: base64, width: 0, height: 0 };
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
  const waitMs = args?.waitMs ?? 1500;

  const finish = (payload: Omit<Extract<ClientMessage, { type: 'client.extension.tool_result' }>, 'type' | 'taskId' | 'requestId' | 'at'>): void => {
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
      const url = args?.url;
      if (!url) {
        finish({ ok: false, error: { message: 'navigate 缺少 url 参数', code: 'bad_args' } });
        return;
      }
      const r = await executeNavigate(url, waitMs);
      finish({ ok: true, result: r });
      return;
    }
    if (kind === 'screenshot') {
      const r = await executeScreenshot();
      finish({ ok: true, result: r });
      return;
    }
    finish({ ok: false, error: { message: `未知工具 kind: ${kind}`, code: 'bad_kind' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finish({
      ok: false,
      error: {
        message: msg.startsWith('no_active_tab')
          ? '浏览器当前没有活动标签页'
          : msg.includes('navigate_timeout')
            ? '页面加载超时'
            : `执行失败：${msg.slice(0, 200)}`,
        code: msg === 'no_active_tab' ? 'no_active_tab' : msg.includes('timeout') ? 'timeout' : 'exec_error',
      },
    });
  }
}
