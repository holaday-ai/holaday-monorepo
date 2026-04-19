/**
 * PlaywrightCrxAdapter — runs inside the extension's MV3 Service Worker.
 *
 * Only the SW can `import { crx } from 'playwright-crx'` at runtime
 * (the package uses `chrome.*` globals). Node tests never import this
 * module; they use `MockDriver` via `@holaday/browser-driver/mock`.
 *
 * Lifecycle: the adapter lazy-starts a CrxApplication on the first
 * execute(), opens/attaches a page for the first `goto`, and reuses
 * that page for subsequent actions. Phase 0 = single active page per
 * task; tab multiplexing comes with the Skill's own plan.
 */

import { type CrxApplication, type Locator, type Page, crx } from 'playwright-crx';
import {
  DRIVER_ERRORS,
  type DriverAction,
  type DriverResult,
  type HolaDayBrowserDriver,
  driverError,
} from './driver.js';
import { isOriginAllowed } from './origin-guard.js';
import { type LocatorSpec, buildSelectorPlan, renderLocatorSpec } from './selector-plan.js';

/**
 * Per-strategy failure record. Included in the DriverResult.data for
 * any SELECTOR_NOT_FOUND path (click / type / extract) so the operator —
 * and eventually a self-heal planner — can see exactly which selector
 * attempts the adapter tried and why each one didn't land.
 */
export interface StrategyFailure {
  kind: LocatorSpec['how'];
  selector: string;
  reason: string;
}

/**
 * Payload attached to DriverResult.data when selector resolution fails.
 * `screenshot` is raw base64 PNG (no data: URL prefix) so the DB column
 * keeps the bytes intact; `screenshotKey` is a short logical key that
 * orchestrator persists to task_steps.screenshot_key — W3 will point
 * that key at an S3 upload, for now it's a local handle.
 */
export interface SelectorNotFoundDiagnostic {
  url: string;
  title: string;
  strategies: StrategyFailure[];
  screenshotKey?: string;
  screenshot?: string;
}

type ResolveLocatorResult = { locator: Locator } | { failures: StrategyFailure[] };

/** Cap on error_message length to keep MySQL TEXT column from ballooning. */
const ERROR_MESSAGE_CAP = 2000;

export interface PlaywrightCrxAdapterOptions {
  /** Origin allowlist from the active Skill's `allowedOrigins`. */
  allowedOrigins?: readonly string[];
  /** Per-strategy waitFor budget in ms (total plan timeout is honored separately). */
  perStrategyTimeoutMs?: number;
  /** If set, attach to this chrome.tabs tabId instead of opening a new tab on first goto. */
  attachToTabId?: number | null;
}

export class PlaywrightCrxAdapter implements HolaDayBrowserDriver {
  private app: CrxApplication | null = null;
  private page: Page | null = null;
  /**
   * Chrome tab id of the page this adapter is driving. Populated from
   * `CrxApplication.on('attached', {page, tabId})` during ensureApp(),
   * and defensively from `opts.attachToTabId` on the attach branch of
   * ensurePage(). Needed so screenshots hit the *agent's* tab, not
   * whatever tab is currently active in the focused window (the popup
   * was sneaking in as the "focused" surface and we were screenshotting
   * our own UI).
   */
  private tabId: number | null = null;
  private readonly opts: Required<PlaywrightCrxAdapterOptions>;

  constructor(opts: PlaywrightCrxAdapterOptions = {}) {
    this.opts = {
      allowedOrigins: opts.allowedOrigins ?? [],
      perStrategyTimeoutMs: opts.perStrategyTimeoutMs ?? 2_000,
      attachToTabId: opts.attachToTabId ?? null,
    };
  }

  async execute(action: DriverAction): Promise<DriverResult> {
    try {
      // Pre-step origin guard for NON-goto actions. `goto` handles its
      // own validation inside doGoto (we need to check payload.url,
      // not page.url()). For everything else: if the agent is already
      // on a page AND an allowlist is in effect, the page's current
      // URL must satisfy it. This catches cases where a prior step
      // (or an in-page JS redirect) walked us off the Skill's origin
      // boundary and a subsequent click/extract would run on an
      // unrelated site. Empty list / no page attached = no-op.
      if (action.kind !== 'goto' && this.page) {
        const allowlist = action.allowedOrigins ?? this.opts.allowedOrigins;
        if (allowlist.length > 0) {
          const currentUrl = this.page.url();
          if (!isOriginAllowed(currentUrl, allowlist)) {
            return driverError(
              DRIVER_ERRORS.ORIGIN_BLOCKED,
              `current page ${currentUrl} not in Skill allowedOrigins: [${allowlist.join(', ')}]`,
            );
          }
        }
      }
      switch (action.kind) {
        case 'goto':
          return await this.doGoto(action);
        case 'wait':
          return await this.doWait(action);
        case 'click':
          return await this.doClick(action);
        case 'type':
          return await this.doType(action);
        case 'key':
          return await this.doKey(action);
        case 'extract':
          return await this.doExtract(action);
        case 'eval':
          return await this.doEval(action);
        case 'screenshot':
          return await this.doScreenshot(action);
        default:
          return driverError(
            DRIVER_ERRORS.UNKNOWN_KIND,
            `unknown action kind: ${String(action.kind)}`,
          );
      }
    } catch (err) {
      return {
        status: 'error',
        error: {
          code: 'UNEXPECTED',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.app?.close();
    } finally {
      this.app = null;
      this.page = null;
      this.tabId = null;
    }
  }

  // ---------- per-kind implementations ----------

  private async doGoto(action: DriverAction): Promise<DriverResult> {
    const url = typeof action.payload?.url === 'string' ? action.payload.url : null;
    if (!url) return driverError(DRIVER_ERRORS.PAYLOAD_MISSING, 'goto requires payload.url');
    // Per-dispatch list from the orchestrator wins over the adapter's
    // constructor default; both respect the "empty = unrestricted"
    // contract from isOriginAllowed.
    const allowlist = action.allowedOrigins ?? this.opts.allowedOrigins;
    if (!isOriginAllowed(url, allowlist)) {
      return driverError(
        DRIVER_ERRORS.ORIGIN_BLOCKED,
        `origin not in Skill allowedOrigins: ${url} (allowlist: [${allowlist.join(', ')}])`,
      );
    }
    const page = await this.ensurePage(url);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: action.deadlineMs ?? 30_000 });
      return { status: 'ok', data: { url: page.url() } };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.NAV_FAILED,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async doWait(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'wait before any goto');

    if (action.selector) {
      const locator = await this.resolveLocator(page, action);
      if (!locator) {
        return driverError(
          DRIVER_ERRORS.WAIT_TIMEOUT,
          `wait: no strategy matched (${action.selector.description})`,
        );
      }
      return { status: 'ok', data: { matched: action.selector.description } };
    }

    const ms = typeof action.payload?.ms === 'number' ? action.payload.ms : 500;
    await page.waitForTimeout(Math.min(ms, 30_000));
    return { status: 'ok', data: { waited: ms } };
  }

  private async doClick(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'click before any goto');
    if (!action.selector) {
      return driverError(DRIVER_ERRORS.SELECTOR_MISSING, 'click requires selector');
    }
    const resolved = await this.resolveLocator(page, action);
    if ('failures' in resolved) {
      return this.buildSelectorNotFoundResult(page, action, 'click', resolved.failures);
    }
    const timeout = action.deadlineMs ?? 5_000;
    try {
      await resolved.locator.click({ timeout });
      return { status: 'ok', data: { clicked: action.selector.description } };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Playwright strict-mode: selector resolved to N>1 elements and
      // `.click()` refuses to guess. For Phase 0 dogfood it's better
      // to click the first match than to fail the whole step — asking
      // Opus to regenerate "a more specific selector" via self-heal
      // is slow and often produces the same candidate set (the page
      // just HAS several matching nodes). Log + flag the ambiguity
      // so the operator can tighten the Skill's selector later.
      if (raw.includes('strict mode violation')) {
        console.warn('[holaday] click strict-mode violation — retrying with .first()', {
          description: action.selector.description,
          err: raw.slice(0, 300),
        });
        try {
          await resolved.locator.first().click({ timeout });
          return {
            status: 'ok',
            data: {
              clicked: action.selector.description,
              ambiguousFallback: true,
              originalError: raw.slice(0, 200),
            },
          };
        } catch (firstErr) {
          return driverError(
            DRIVER_ERRORS.CLICK_FAILED,
            firstErr instanceof Error ? firstErr.message : String(firstErr),
          );
        }
      }
      return driverError(DRIVER_ERRORS.CLICK_FAILED, raw);
    }
  }

  private async doType(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'type before any goto');
    if (!action.selector) {
      return driverError(DRIVER_ERRORS.SELECTOR_MISSING, 'type requires selector');
    }
    const text = typeof action.payload?.text === 'string' ? action.payload.text : null;
    if (text === null) {
      return driverError(DRIVER_ERRORS.PAYLOAD_MISSING, 'type requires payload.text');
    }
    const resolved = await this.resolveLocator(page, action);
    if ('failures' in resolved) {
      return this.buildSelectorNotFoundResult(page, action, 'type', resolved.failures);
    }
    try {
      // `fill` works for <input>/<textarea>. For contenteditable (Douyin
      // reply editor) fill fails → we fall back to focus+type. The Skill's
      // SKILL.md caveat marks those step kinds explicitly.
      try {
        await resolved.locator.fill(text, { timeout: action.deadlineMs ?? 5_000 });
      } catch {
        await resolved.locator.focus({ timeout: action.deadlineMs ?? 5_000 });
        await page.keyboard.type(text);
      }
      return { status: 'ok', data: { typedChars: text.length } };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.TYPE_FAILED,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Press a keyboard key (e.g. "Enter", "Escape", "Tab", or combos like
   * "Control+A"). If `selector` is provided, focus that element first so
   * the key targets the right input — otherwise the press lands wherever
   * focus currently is. `payload.key` names the key using Playwright's
   * key-name vocabulary (same as page.keyboard.press).
   *
   * Motivation for having this as a separate action kind: some sites
   * (Baidu, Douyin search) re-render their submit button during
   * hydration, so a 2s `attached` probe on the button can flap. Pressing
   * Enter in the already-focused input bypasses the whole button-
   * selector problem and matches how a human submits the form.
   */
  private async doKey(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'key before any goto');
    const key = typeof action.payload?.key === 'string' ? action.payload.key : null;
    if (!key) return driverError(DRIVER_ERRORS.PAYLOAD_MISSING, 'key requires payload.key');

    if (action.selector) {
      const resolved = await this.resolveLocator(page, action);
      if ('failures' in resolved) {
        return this.buildSelectorNotFoundResult(page, action, 'key', resolved.failures);
      }
      try {
        await resolved.locator.focus({ timeout: action.deadlineMs ?? 5_000 });
      } catch (err) {
        return driverError(
          DRIVER_ERRORS.KEY_FAILED,
          `focus failed before key press: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      await page.keyboard.press(key);
      return { status: 'ok', data: { pressed: key } };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.KEY_FAILED,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async doExtract(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'extract before any goto');

    // Mode: selector-scoped innerText vs page-wide title/URL.
    if (!action.selector) {
      return {
        status: 'ok',
        data: {
          url: page.url(),
          title: await page.title(),
        },
      };
    }
    const resolved = await this.resolveLocator(page, action);
    if ('failures' in resolved) {
      return this.buildSelectorNotFoundResult(page, action, 'extract', resolved.failures);
    }
    try {
      const limit = Math.min(
        typeof action.payload?.limit === 'number' ? action.payload.limit : 20,
        50,
      );
      const count = await resolved.locator.count();
      const texts: string[] = [];
      for (let i = 0; i < Math.min(count, limit); i += 1) {
        const t = (await resolved.locator.nth(i).innerText({ timeout: 2_000 })).trim();
        if (t) texts.push(t);
      }
      return {
        status: 'ok',
        data: {
          matched: action.selector.description,
          count,
          texts,
        },
      };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.EXTRACT_FAILED,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async doEval(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'eval before any goto');
    const expression =
      typeof action.payload?.expression === 'string' ? action.payload.expression : null;
    if (!expression) {
      return driverError(DRIVER_ERRORS.PAYLOAD_MISSING, 'eval requires payload.expression');
    }
    // Phase 0 minimal: run the expression. W3 SafetyFilter will wrap this
    // with an allowlist + signed-only execution model. For now we just
    // evaluate.
    try {
      const result = await page.evaluate(expression);
      return { status: 'ok', data: { result } };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.EVAL_FAILED,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async doScreenshot(action: DriverAction): Promise<DriverResult> {
    const page = this.page;
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'screenshot before any goto');
    // page.screenshot() via playwright-crx 0.15 hangs indefinitely in
    // MV3 SW — earlier commits (ae1b49a, 94d0b2b) tried the inner
    // `timeout` option and an outer Promise.race; both cases still saw
    // the Playwright default 30s fire because the CDP call backing it
    // is stuck somewhere we can't reach. Swap to the native Chrome
    // extension API `chrome.tabs.captureVisibleTab` which runs entirely
    // inside the SW's own runtime and doesn't round-trip through CDP.
    //
    // Tradeoff: captureVisibleTab only captures the visible viewport,
    // not the full page. `action.payload.fullPage=true` is now a
    // silent no-op — noted here rather than surfacing an error because
    // every current caller wants viewport-only (smoke test, SELECTOR_
    // NOT_FOUND diagnostic). When we need fullPage we can scroll +
    // stitch, but that's Phase 1 work.
    const timeoutMs = action.deadlineMs ?? 10_000;
    try {
      const base64 = await captureViewportPngBase64(timeoutMs, this.tabId);
      const bytes = base64ByteLength(base64);
      return {
        status: 'ok',
        data: { encoding: 'base64', bytes, sizeBytes: bytes },
      };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.SCREENSHOT_FAILED,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ---------- private helpers ----------

  private async ensureApp(): Promise<CrxApplication> {
    if (this.app) return this.app;
    this.app = await crx.start();
    // CrxApplication emits `attached` with `{page, tabId}` whenever a
    // page is attached (both `app.attach(tabId)` and `app.newPage(...)`
    // paths). Track the tabId so screenshot / diagnostic-capture code
    // can pass it to chrome.tabs.captureVisibleTab instead of
    // defaulting to the currently focused window — which, at the
    // moment the user clicks Run in the popup, is the popup itself.
    this.app.on('attached', ({ tabId }) => {
      this.tabId = tabId;
    });
    return this.app;
  }

  private async ensurePage(initialUrl?: string): Promise<Page> {
    if (this.page) return this.page;
    const app = await this.ensureApp();
    if (this.opts.attachToTabId !== null) {
      this.page = await app.attach(this.opts.attachToTabId);
      // Defensive: set tabId in case the `attached` event wasn't
      // emitted (older playwright-crx versions on some paths). On
      // attach we already have the tabId from the caller, so this is
      // authoritative anyway.
      this.tabId = this.opts.attachToTabId;
    } else {
      this.page = await app.newPage({ url: initialUrl ?? 'about:blank', active: true });
      // newPage path: the `attached` listener above populates tabId.
    }
    return this.page;
  }

  private async resolveLocator(page: Page, action: DriverAction): Promise<ResolveLocatorResult> {
    const failures: StrategyFailure[] = [];
    if (!action.selector) return { failures };
    const plan = buildSelectorPlan(action.selector);
    const scope = plan.scopeCss ? page.locator(plan.scopeCss) : null;
    for (const spec of plan.attempts) {
      const label = renderLocatorSpec(spec);
      let locator: Locator | null;
      try {
        locator = buildLocator(page, scope, spec);
      } catch (err) {
        failures.push({
          kind: spec.how,
          selector: label,
          reason: `buildLocator threw: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      if (!locator) {
        failures.push({ kind: spec.how, selector: label, reason: 'buildLocator returned null' });
        continue;
      }
      if (plan.nth !== undefined) locator = locator.nth(plan.nth);
      try {
        await locator
          .first()
          .waitFor({ state: 'attached', timeout: this.opts.perStrategyTimeoutMs });
        return { locator };
      } catch (err) {
        // Most frequent reason is Playwright's own `TimeoutError: ...exceeded`
        // but if the selector engine rejected the query itself we want that
        // text instead of a generic "timeout".
        const raw = err instanceof Error ? err.message : String(err);
        const isTimeout = raw.toLowerCase().includes('timeout');
        failures.push({
          kind: spec.how,
          selector: label,
          reason: isTimeout
            ? `waitFor(state=attached) timeout ${this.opts.perStrategyTimeoutMs}ms`
            : raw.slice(0, 200),
        });
      }
    }
    return { failures };
  }

  /**
   * Build a SELECTOR_NOT_FOUND DriverResult with rich diagnostic data:
   * the current page URL + title, each strategy's selector + failure
   * reason, and a viewport screenshot (base64 PNG). The screenshot's
   * logical key lands on `task_steps.screenshot_key` via the orchestrator
   * repo; the bytes sit in the step's `output` JSON alongside the
   * strategy list. All of it is bounded so a noisy failure can't
   * explode the DB row.
   *
   * Failure to capture url / title / screenshot degrades gracefully —
   * we still emit the error with whatever we got, never throw from
   * inside the diagnostic builder.
   */
  private async buildSelectorNotFoundResult(
    page: Page,
    action: DriverAction,
    verb: 'click' | 'type' | 'key' | 'extract',
    failures: StrategyFailure[],
  ): Promise<DriverResult> {
    const desc = action.selector?.description ?? '(no description)';
    const [url, title, screenshot] = await Promise.all([
      safeCall(() => page.url(), ''),
      safeCall(() => page.title(), ''),
      // Use chrome.tabs.captureVisibleTab — same reason as doScreenshot:
      // page.screenshot() hangs in playwright-crx 0.15 under MV3 SW.
      safeCall(() => captureViewportPngBase64(5_000, this.tabId), null as string | null),
    ]);

    const strategiesTxt =
      failures.length === 0
        ? 'no strategies emitted by planner'
        : failures.map((f) => `${f.kind}[${f.selector}]→${f.reason}`).join(' ; ');
    const message = (
      `${verb}: no strategy matched "${desc}"` +
      ` at ${url || '<url unknown>'} (title="${title || ''}"); tried: ${strategiesTxt}`
    ).slice(0, ERROR_MESSAGE_CAP);

    // screenshotKey is a logical handle. W3 will wire this to an S3
    // upload; for now the bytes live in `data.screenshot` and the key
    // lets the task_steps column carry a stable reference string.
    const screenshotKey = screenshot ? `diag-${verb}-${Date.now().toString(36)}` : undefined;

    const data: SelectorNotFoundDiagnostic = {
      url,
      title,
      strategies: failures,
      ...(screenshot ? { screenshot, screenshotKey: screenshotKey as string } : {}),
    };

    return {
      status: 'error',
      data,
      error: { code: DRIVER_ERRORS.SELECTOR_NOT_FOUND, message },
    };
  }
}

async function safeCall<T>(fn: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ---------- Locator construction (page-agnostic so unit-testable via mock page) ----------

function buildLocator(page: Page, scope: Locator | null, spec: LocatorSpec): Locator | null {
  const root = scope ?? page;
  switch (spec.how) {
    case 'role':
      return root.getByRole(spec.role as Parameters<typeof root.getByRole>[0], {
        ...(spec.name ? { name: spec.name } : {}),
        exact: spec.exact,
      });
    case 'text':
      return root.getByText(spec.value, { exact: spec.exact });
    case 'testid':
      if (spec.attr === 'data-testid') {
        return root.getByTestId(spec.value);
      }
      return root.locator(`[${spec.attr}="${cssEscape(spec.value)}"]`);
    case 'css':
      return root.locator(spec.value);
    case 'xpath':
      return root.locator(`xpath=${spec.value}`);
    case 'label':
      return root.getByLabel(spec.value, { exact: spec.exact });
    case 'placeholder':
      return root.getByPlaceholder(spec.value);
    default:
      return null;
  }
}

function cssEscape(v: string): string {
  return v.replace(/[\\"]/g, (c) => `\\${c}`);
}

// ---------- SW-native screenshot via chrome.tabs.captureVisibleTab ----------

/**
 * Capture a PNG of the currently-focused Chrome window's active tab,
 * returning raw base64 (no `data:image/png;base64,` prefix). Runs
 * entirely inside the extension SW — unlike page.screenshot() it
 * doesn't hang when playwright-crx's CDP channel gets stuck.
 *
 * Requires `<all_urls>` or `activeTab` permission — we declare
 * `<all_urls>` in manifest.config.ts so this works on every page
 * the agent can navigate to.
 *
 * The `windowId` arg is intentionally omitted so Chrome captures
 * whichever window currently has focus; for our dispatch-driven
 * flow that's always the tab playwright-crx opened via
 * `newPage({ active: true })`.
 */
async function captureViewportPngBase64(timeoutMs: number, tabId: number | null): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    throw new Error('chrome.tabs.captureVisibleTab unavailable (not in extension SW)');
  }

  // Resolve the target tab's windowId. chrome.tabs.captureVisibleTab
  // takes (windowId, options) and captures the ACTIVE tab in that
  // window — passing the agent tab's window means the popup's own
  // floating UI no longer counts as "current focused window", which
  // was the bug. When tabId is unknown we fall back to the default
  // (current-focused window); behaviour then matches pre-fix.
  let windowId: number | undefined;
  if (tabId !== null) {
    try {
      const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
        chrome.tabs.get(tabId, (t) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message ?? 'chrome.tabs.get failed'));
          resolve(t);
        });
      });
      windowId = tab.windowId;
    } catch {
      // Tab was likely closed mid-task; degrade gracefully to the
      // no-windowId path rather than failing the whole screenshot.
    }
  }

  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const capture = new Promise<string>((resolve, reject) => {
      const cb = (dataUrl: string | undefined): void => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message ?? 'captureVisibleTab failed'));
          return;
        }
        if (!dataUrl) {
          reject(new Error('captureVisibleTab returned empty dataUrl'));
          return;
        }
        resolve(dataUrl);
      };
      // `captureVisibleTab` has overloaded signatures; the windowId
      // variant takes (windowId, options, callback), the other takes
      // (options, callback). Dispatching explicitly here keeps TS and
      // the runtime happy on both Chrome 120 (callback-only) and 121+
      // (promise-supporting).
      if (windowId !== undefined) {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, cb);
      } else {
        chrome.tabs.captureVisibleTab({ format: 'png' }, cb);
      }
    });
    const hardCap = new Promise<never>((_resolve, reject) => {
      hardTimer = setTimeout(
        () => reject(new Error(`captureVisibleTab timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    const dataUrl = await Promise.race([capture, hardCap]);
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('malformed data URL from captureVisibleTab');
    return dataUrl.slice(comma + 1);
  } finally {
    if (hardTimer) clearTimeout(hardTimer);
  }
}

/** Byte length of a base64 string, accounting for padding. */
function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
