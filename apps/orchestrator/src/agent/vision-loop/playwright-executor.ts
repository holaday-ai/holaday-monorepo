/**
 * PlaywrightExecutor — vision-loop execution layer backed by Playwright
 * (`chromium.connectOverCDP`) instead of hand-rolled `chrome.debugger`
 * calls in the extension SW.
 *
 * Why: the hand-written CDP layer in `apps/extension/src/background/
 * cdp-actions.ts` had subtle bugs (string-vs-number coords, manual
 * modifier-bitmask for chord keys, fragile key-name → CDP mapping).
 * Playwright solves all of that correctly. It also unlocks
 * `page.accessibility.snapshot()` — a structured page representation
 * 10× cheaper than screenshots for the commander to consume.
 *
 * Usage pattern:
 *
 *     const exec = new PlaywrightExecutor();
 *     await exec.connect('http://127.0.0.1:9222');
 *     const page = await exec.getPage();
 *     await exec.click(page, 100, 200);
 *     await exec.disconnect();
 *
 * The executor is stateful — it owns a Browser handle after `connect()`
 * and tears it down in `disconnect()`. Reuse a single instance per
 * orchestrator lifetime; don't create-connect-disconnect per task.
 *
 * Coordinate contract: the class-level API takes REAL viewport pixels,
 * same as the `cdp-actions.ts` interface it replaces. The VisionLoopRunner
 * has already translated from Claude's model-space via `modelCoordToReal`
 * before it calls through.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { logger } from '../../config/logger.js';
import { humanClick, humanScroll, humanTypeText, isHumanizeEnabled } from './humanize.js';
import { STEALTH_INIT_SCRIPT, isStealthEnabled } from './stealth-scripts.js';

export interface ConnectResult {
  ok: boolean;
  /** Human-readable error — populated when `ok=false`. */
  error?: string;
}

export interface ScreenshotResult {
  /** Base64-encoded JPEG bytes (no `data:` prefix). Missing when `error` set. */
  base64?: string;
  /** Captured viewport pixels — handy for the commander's resize path. */
  viewportWidth?: number;
  viewportHeight?: number;
  /** Populated on failure. Never throws. */
  error?: string;
}

export interface ActionResult {
  ok: boolean;
  /** Short diagnostic fed back to the next commander tick. */
  message?: string;
}

/**
 * One node in the accessibility-snapshot serialisation. The `ref` is
 * synthesised by the executor (`e1`, `e2`, …) so Claude can reference
 * a specific element; the map lives on `AccessibilitySnapshotResult.refs`
 * for the runner to translate "click ref=e5" back to an element handle
 * (via role+name lookup — details in Step 2).
 */
export interface AccessibilityNodeRef {
  ref: string;
  role: string;
  name: string;
}

export interface AccessibilitySnapshotResult {
  /** Pretty-printed text for the prompt. One line per interesting node. */
  text: string;
  /** ref → (role, name) so the runner can re-locate elements by role+name. */
  refs: AccessibilityNodeRef[];
  /** URL + title included so the commander doesn't need a separate call. */
  url: string;
  title: string;
  /** Populated on failure. Never throws. */
  error?: string;
}

/**
 * Narrow duck type for dependency-injection in tests. The production
 * path receives a real `playwright.Page`; tests pass a stub with just
 * the surfaces we call. Kept alongside the executor so callers don't
 * need to pull `import type { Page }` transitively.
 */
export interface PageLike {
  url(): string;
  title(): Promise<string>;
  viewportSize(): { width: number; height: number } | null;
  screenshot(opts?: {
    type?: 'jpeg' | 'png';
    quality?: number;
    fullPage?: boolean;
    timeout?: number;
  }): Promise<Buffer>;
  mouse: {
    click(x: number, y: number, opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
    move(x: number, y: number): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  keyboard: {
    type(text: string): Promise<void>;
    press(key: string): Promise<void>;
    /**
     * Atomic text insertion — Playwright 1.x exposes this. Bypasses
     * keystroke simulation, required for CJK without IME on the
     * remote X server. Optional on PageLike so unit-test stubs
     * (which only mock the surfaces they exercise) don't need to
     * implement it; the production Playwright `Page.keyboard` does.
     * Callers must runtime-check before invoking.
     */
    insertText?(text: string): Promise<void>;
  };
  /**
   * Playwright 1.55+ replaced the tree-returning `page.accessibility`
   * namespace with `page.ariaSnapshot()`, which emits YAML-ish text
   * (one line per node, nested via indentation). We pass `ref:true`
   * even though Page-level snapshot on 1.59 ignores it (the option is
   * currently honoured only via Locator.ariaSnapshot) — keeps us
   * forward-compatible if/when Playwright turns it on Page-wide — and
   * inject our own `[ref=eN]` markers on interactive lines via
   * annotateAriaSnapshot below.
   */
  ariaSnapshot(opts?: { ref?: boolean }): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  setViewportSize?: (size: { width: number; height: number }) => Promise<void>;
  /**
   * Added as part of the anti-bot recovery work: we race a trivial
   * evaluate against a timeout to check liveness. Real playwright.Page
   * provides this; test stubs that never set it fall back to a
   * tolerant default in `isPageResponsive`.
   */
  evaluate?: (expression: string) => Promise<unknown>;
  close?: () => Promise<void>;
}

/**
 * Interactive a11y roles we expose to Claude with a `ref=…` handle.
 * Non-interactive roles (generic, paragraph, …) still render in the
 * text output but don't get a ref — Claude can't click them.
 */
const INTERACTIVE_ROLES = new Set<string>([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
  'option',
  'slider',
  'spinbutton',
]);

/**
 * Phase 1 Playbook B2 — multi-signal descriptor of the element a browse
 * action targeted, read at action time by `captureTargetDescriptor`. All
 * fields are best-effort; the whole object is null when capture fails.
 */
export interface TargetDescriptor {
  /** location.href of the page at capture time. */
  url: string | null;
  /** Primary text anchor — the target element's visible text (≤200 chars). */
  visibleText: string | null;
  /** A stable selector that UNIQUELY matches the target, else null. */
  selector: string | null;
  tagName: string;
  /** Attributes used downstream to judge field sensitivity (redaction). */
  type: string | null;
  autocomplete: string | null;
  name: string | null;
  id: string | null;
  ariaLabel: string | null;
  /** B3 — the iframe's URL (≤255) when captured from INSIDE a frame; null at top level. */
  framePath?: string | null;
}

export class PlaywrightExecutor {
  private browser: Browser | null = null;
  /**
   * The page this executor treats as "the current tab" for all actions
   * (screenshot, navigate, click, …). Set by `resetPageForTask` at the
   * start of every task, and rewritten by `navigate()`'s fresh-page
   * fallback when a goto mysteriously leaves a page on about:blank.
   *
   * Without this pin, `getPage()` falls back to `contexts[0].pages()[0]`
   * — fragile, because the startup about:blank tab Chromium creates on
   * launch has been observed to accept goto() and silently not navigate.
   * Pinning a page we CREATED ourselves via ctx.newPage() sidesteps
   * that class of quirk.
   */
  private activePage: Page | null = null;
  /**
   * Endpoint remembered from connect() so we can silently reconnect
   * when the CDP WebSocket goes idle. Playwright's `connectOverCDP`
   * doesn't auto-reconnect — after an idle timeout or a Brave tab
   * cycle the Browser handle stays non-null but `contexts()` returns
   * empty. We detect that in getPage() and redial using this value.
   */
  private cdpEndpoint: string | null = null;
  /**
   * Phase 1 Playbook ④ — gated CLEAN-CONTEXT mode (default OFF). When connect()
   * is called with { cleanContext: true } (explorer only), the executor uses a
   * FRESH isolated `browser.newContext()` (no storageState, its own empty cookie
   * jar) for getPage() instead of the shared `contexts()[0]`. Off = byte-identical
   * to before (getPage uses contexts()[0]; these stay null). The zero-credential
   * GUARANTEE is the fail-closed `assertCleanContext()` below, NOT trust in newContext.
   */
  private cleanMode = false;
  private cleanContext: BrowserContext | null = null;
  /** Dependency-injection seam for tests that want to bypass connect(). */
  private readonly chromium: {
    connectOverCDP: (endpoint: string) => Promise<Browser>;
  };
  /**
   * Pages we've already stealth-ified this session. Playwright's
   * `addInitScript` only fires on the NEXT navigation, so we also
   * call `page.evaluate(STEALTH_INIT_SCRIPT)` once per page to cover
   * the currently-loaded document. Tracking avoids re-running the
   * evaluate on every getPage() call.
   */
  private readonly stealthApplied = new WeakSet<object>();
  private targetViewportSize: { width: number; height: number } | null = null;

  constructor(
    opts: {
      chromium?: { connectOverCDP: (endpoint: string) => Promise<Browser> };
    } = {},
  ) {
    // Defer the real import so `require('playwright')` only happens
    // when we actually connect — avoids paying the native-binary load
    // cost on test-only code paths.
    this.chromium = opts.chromium ?? lazyPlaywrightChromium();
  }

  /**
   * Connect to a Chromium instance that was launched with
   * `--remote-debugging-port=<port>`. Pass the full CDP endpoint:
   *   http://127.0.0.1:9222
   * Playwright fetches `/json/version` there, then opens a WS to the
   * browser-level CDP. `connectOverCDP` never creates a new browser —
   * it attaches to the already-running one.
   *
   * Never throws — returns `{ok:false, error}` on any failure so the
   * orchestrator can gracefully fall back to the legacy WS/SW/CDP path.
   */
  async connect(
    cdpEndpoint: string,
    opts: { cleanContext?: boolean } = {},
  ): Promise<ConnectResult> {
    if (this.browser) return { ok: true };
    try {
      this.browser = await this.chromium.connectOverCDP(cdpEndpoint);
      this.cdpEndpoint = cdpEndpoint;
      // Phase 1 Playbook ④ — gated CLEAN-CONTEXT mode (explorer only). Create a
      // FRESH isolated context (no storageState → its own empty cookie jar) and
      // route getPage() to it. Off by default → contexts()[0] as before.
      if (opts.cleanContext) {
        this.cleanMode = true;
        this.cleanContext = await this.browser.newContext();
      }
      if (isStealthEnabled()) {
        await this.applyStealthToContexts(this.browser);
      }
      // Best-effort: dismiss Brave's persistent chrome-side banners
      // (privacy report invite, --no-sandbox warning, "unsupported
      // command-line flag") that otherwise take up vertical space in
      // every screenshot. Runs once per connect, on every existing
      // context — the policy file suppresses most of these at the
      // browser level but a fresh profile still gets the first-run
      // invites.
      await this.dismissBraveBanners(this.browser);
      return { ok: true };
    } catch (err) {
      this.browser = null;
      return {
        ok: false,
        error: `connectOverCDP(${cdpEndpoint}) failed: ${errMsg(err)}`,
      };
    }
  }

  /**
   * Phase 1 Playbook ④ — fail-closed ZERO-CREDENTIAL assertion (clean-context mode
   * only). Globally enumerates ALL cookies (no URL filter); if ANY exist, the fresh
   * context is not actually clean → close it + throw, so the browse REFUSES to run
   * rather than ride a credential/session. The hard guarantee — does NOT trust that
   * `newContext()` is empty. Call before the first live action.
   */
  async assertCleanContext(): Promise<void> {
    if (!this.cleanMode || !this.cleanContext) {
      throw new Error('assertCleanContext: called outside clean-context mode');
    }
    const cookies = await this.cleanContext.cookies(); // global — all origins, no URL filter
    if (cookies.length > 0) {
      const domains = [...new Set(cookies.map((c) => c.domain))].slice(0, 5).join(',');
      await this.disposeCleanContext();
      throw new Error(
        `clean context is NOT clean: ${cookies.length} cookie(s) present (${domains}) — refusing to browse`,
      );
    }
  }

  /** Close + drop the clean context (call when the browse finishes). No-op when off. */
  async disposeCleanContext(): Promise<void> {
    const ctx = this.cleanContext;
    this.cleanContext = null;
    this.activePage = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        /* best-effort dispose */
      }
    }
  }

  /**
   * Phase 1 Playbook ④ — the context every page-lifecycle method operates on. In
   * clean-context mode this is the fresh isolated context and NEVER the shared
   * contexts()[0] (which can carry credentials); off, it's the shared default
   * context exactly as before. Routing reset/reopen/getPage through this is what
   * stops clean mode from leaking into the shared context (adversarial review
   * CAMERA-3/6 blocker: resetPageForTask/reopenActivePage used contexts()[0] directly).
   */
  private browseContext(browser: Browser): BrowserContext | undefined {
    if (this.cleanMode) return this.cleanContext ?? undefined;
    return browser.contexts()[0];
  }

  setViewportSize(size: { width: number; height: number } | null): void {
    if (
      size &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0
    ) {
      this.targetViewportSize = {
        width: Math.floor(size.width),
        height: Math.floor(size.height),
      };
      return;
    }
    this.targetViewportSize = null;
  }

  /**
   * Click through Brave's chrome-side dismissible banners on each
   * open page. Safe to call on any browser — the selector checks
   * all shortcut to no-ops on plain Chromium.
   *
   * Banners we target:
   *   - "Got it" / "Disable" (privacy report, command-line flag warning)
   *   - aria-label="Close" (generic dismiss X on notification ribbons)
   *
   * This runs inside page.evaluate so it only sees DOM the page
   * actually rendered — Brave's actual banners live in the browser
   * chrome (outside any page DOM) and can't be reached this way.
   * Those are governed by /etc/brave/policies/managed/holaday.json.
   * This function targets in-page dismissibles that slip past the
   * policy on first launch.
   */
  /**
   * Public entry point for the Round-3 "post-spawn re-dismiss" pass.
   * Calls the internal banner sweep against whichever browser this
   * executor is attached to; no-ops if not connected. Safe to call
   * on any schedule (once, twice, every minute) — the sweep only
   * clicks elements it recognises.
   */
  async dismissChromeBanners(): Promise<void> {
    if (!this.browser) return;
    await this.dismissBraveBanners(this.browser);
  }

  private async dismissBraveBanners(browser: Browser): Promise<void> {
    const contexts = browser.contexts();
    for (const ctx of contexts) {
      for (const page of ctx.pages()) {
        try {
          // The orchestrator is a Node build (no DOM lib), so `document`
          // and HTMLElement aren't typed here. The callback body runs
          // inside the page's JS context where both exist — we cast
          // through `any` so tsc accepts it without forcing a lib.dom
          // dependency on the whole package.
          //
          // 2-second cap because connect() chains this on every Brave
          // resume; an evaluate() that hangs (service-worker stall,
          // CDP debugger paused) used to block the entire connect
          // path indefinitely. The banner dismissal is best-effort
          // anyway — losing one cycle doesn't break the loop.
          await withTimeout(
            page.evaluate(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const doc = (globalThis as any).document;
              if (!doc) return;
              const labels = new Set(['Got it', 'Disable', 'Dismiss']);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              doc.querySelectorAll('button').forEach((b: any) => {
                const txt = (b.textContent ?? '').trim();
                if (labels.has(txt)) b.click();
              });
              doc
                .querySelectorAll('[aria-label="Close"]')
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .forEach((el: any) => {
                  if (typeof el.click === 'function') el.click();
                });
            }),
            2_000,
            'dismissBraveBanners.evaluate',
          );
        } catch {
          // Page might be about:blank, chrome://, mid-navigation, or
          // hung past 2 s. evaluate rejects in all those cases.
          // Safe to skip — banner dismissal is best-effort.
        }
      }
    }
  }

  /**
   * Install the stealth init script on every existing context so any
   * future page opened in those contexts picks it up before the first
   * navigation. Called once at connect; `getPage` covers brand-new
   * contexts that appear later.
   *
   * Best-effort — a failure here is logged and doesn't block connect.
   * The individual evasions in STEALTH_INIT_SCRIPT are already
   * wrapped in try/catch, so a locked-down browser with strict CSP
   * just falls back to un-stealthed behaviour.
   */
  private async applyStealthToContexts(browser: Browser): Promise<void> {
    const contexts = browser.contexts();
    for (const ctx of contexts) {
      try {
        await (ctx as BrowserContext).addInitScript({ content: STEALTH_INIT_SCRIPT });
      } catch {
        // non-fatal — see docstring
      }
    }
  }

  /**
   * Release the browser handle. Idempotent — safe to call multiple
   * times and when never connected. Does NOT close the browser
   * process (we only attached to the user's existing Chrome; closing
   * it would murder their whole session).
   */
  async disconnect(): Promise<void> {
    if (!this.browser) return;
    const b = this.browser;
    this.browser = null;
    this.activePage = null;
    try {
      await b.close();
    } catch {
      // best-effort — the browser may already be gone
    }
  }

  /**
   * Heal a stale CDP connection.
   *
   * Symptom: `browser.contexts()` returns [] even though the Chromium
   * itself is alive and serves /json/version. Playwright's
   * connectOverCDP WebSocket has silently gone away (idle timeout,
   * Brave tab cycle, network flap) and no reconnection is attempted
   * by the library. The Browser handle stays non-null so callers get
   * a surprising "no browser context" rather than a clean
   * "disconnected" signal.
   *
   * Called from getPage / resetPageForTask on the no-context path.
   * Returns true when a fresh browser handle with ≥1 context was
   * obtained, false when reconnect can't help (e.g. endpoint missing,
   * Chromium is actually down). On success, side effects: replace
   * this.browser, clear this.activePage, re-run stealth + banner
   * dismissals exactly like a first-time connect.
   */
  private async reconnectIfStale(): Promise<boolean> {
    const endpoint = this.cdpEndpoint;
    if (!endpoint) return false;
    // Drop whatever we were holding — next connectOverCDP gives us a
    // fresh Browser. We can't `close()` the old handle because that
    // can block on the dead WebSocket.
    this.browser = null;
    this.activePage = null;
    try {
      const browser = await this.chromium.connectOverCDP(endpoint);
      this.browser = browser;
      if (browser.contexts().length === 0) {
        logger.warn(
          { endpoint },
          'reconnectIfStale: reconnected but still 0 contexts — giving up',
        );
        return false;
      }
      if (isStealthEnabled()) {
        await this.applyStealthToContexts(browser);
      }
      await this.dismissBraveBanners(browser);
      logger.info({ endpoint }, 'reconnectIfStale: reconnected CDP after stale');
      return true;
    } catch (err) {
      logger.warn(
        { endpoint, err: err instanceof Error ? err.message : String(err) },
        'reconnectIfStale: connectOverCDP failed',
      );
      return false;
    }
  }

  /**
   * Get the active Page for a given tab. Without a `tabId`, returns
   * the first page of the first context — the user's visible tab in
   * a single-window Chrome. Phase D doesn't try to match a specific
   * chrome.tabs tabId against Playwright's targets (that would require
   * CDP Target.getTargets / title matching, which is brittle); the
   * single-window assumption is fine for dogfood.
   *
   * Throws when not connected OR when there are no pages. Callers
   * should wrap in try/catch + fall back to legacy on failure.
   */
  async getPage(_tabId?: number): Promise<Page> {
    let browser = this.browser;
    if (!browser) throw new Error('PlaywrightExecutor not connected — call connect() first');
    // Phase 1 Playbook ④ — clean-context mode uses the fresh isolated context, not
    // the shared contexts()[0]. Off → contexts()[0] exactly as before.
    let ctx = this.browseContext(browser);
    if (!ctx) {
      // Stale CDP. Try one redial — if the underlying Chromium is
      // actually up (common case: idle WebSocket, not crash) this
      // gets us a live context back.
      const recovered = await this.reconnectIfStale();
      if (!recovered || !this.browser) {
        throw new Error(
          'PlaywrightExecutor: no browser context (is Chrome actually running?)',
        );
      }
      browser = this.browser;
      // Phase 1 Playbook ④ — in clean-context mode, NEVER fall back to the shared
      // contexts()[0] (it can carry credentials). A lost clean context = hard fail.
      if (this.cleanMode) {
        throw new Error(
          'PlaywrightExecutor: clean context lost on reconnect — refusing to use the shared context',
        );
      }
      ctx = browser.contexts()[0];
      if (!ctx) {
        throw new Error(
          'PlaywrightExecutor: no browser context after reconnect',
        );
      }
    }
    // Prefer the pinned activePage. It was either set by resetPageForTask
    // (fresh ctx.newPage at task start) or by navigate()'s fallback when
    // a goto left the prior page stuck. Only re-pick from ctx.pages()[0]
    // when the pinned page is gone or has been closed.
    //
    // Critical: we SKIP the responsiveness probe + soft-reset when the
    // page is our pinned activePage. A just-navigated page (e.g. right
    // after computer_navigate succeeded) can transiently fail
    // `evaluate('1')` while Playwright is rebuilding the JS context,
    // and the soft-reset path below does `goto('about:blank')` which
    // would silently *erase* the task's successful navigation. The
    // probe is still useful for stale `pages[0]` we didn't create, so
    // keep it on that code path — it's what the anti-bot recovery path
    // was originally designed for.
    let page: Page | undefined = this.activePage ?? undefined;
    if (page && typeof page.isClosed === 'function' && page.isClosed()) {
      this.activePage = null;
      page = undefined;
    }
    if (page) {
      await this.applyStealthToPageIfNeeded(page as unknown as PageLike);
      return page;
    }
    const pages = ctx.pages();
    page = pages[0];
    // No pages at all: open one.
    if (!page) {
      page = await ctx.newPage();
      this.activePage = page;
      await this.applyTargetViewportToPage(page as unknown as PageLike);
      await this.applyStealthToPageIfNeeded(page as unknown as PageLike);
      return page;
    }
    // Liveness probe + auto-recovery. Anti-bot modals (e.g. Douyin's
    // "开启读屏标签 / 第二次验证" overlay) can freeze the tab so that
    // page.screenshot() hangs for the full 30 s Playwright default,
    // and every subsequent task fails the same way because we keep
    // handing back the same stuck pages[0]. We check responsiveness
    // cheaply (evaluate('1') with a 3s race), try a soft reset
    // (goto about:blank, 5s), then hard-reset by opening a fresh
    // page and best-effort closing the old one.
    const responsive = await this.isPageResponsive(
      page as unknown as PageLike,
      antiBotResponsiveTimeoutMs(),
    );
    if (responsive) {
      this.activePage = page;
      await this.applyStealthToPageIfNeeded(page as unknown as PageLike);
      return page;
    }
    try {
      await (page as unknown as PageLike).goto('about:blank', {
        timeout: antiBotSoftResetTimeoutMs(),
      });
      this.activePage = page;
      await this.applyStealthToPageIfNeeded(page as unknown as PageLike);
      return page;
    } catch {
      // soft reset failed — fall through to hard reset
    }
    const fresh = await ctx.newPage();
    const stuck = page;
    this.activePage = fresh;
    await this.applyTargetViewportToPage(fresh as unknown as PageLike);
    // Fire-and-forget close so we don't re-hang on the stuck page.
    void (async () => {
      const closer = (stuck as unknown as PageLike).close;
      if (typeof closer === 'function') await closer().catch(() => {});
    })();
    await this.applyStealthToPageIfNeeded(fresh as unknown as PageLike);
    return fresh;
  }

  private async applyTargetViewportToPage(page: PageLike): Promise<void> {
    const size = this.targetViewportSize;
    if (!size || typeof page.setViewportSize !== 'function') return;
    try {
      await page.setViewportSize(size);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), size },
        'setViewportSize failed — continuing with browser window geometry',
      );
    }
  }

  /**
   * Apply the stealth script to a page if we haven't already this
   * session. We do two things:
   *   1. `page.addInitScript` — the script runs on every NEXT
   *      navigation, so newly opened URLs start stealthed.
   *   2. `page.evaluate` — the script runs RIGHT NOW against the
   *      currently-loaded document, so detectors on the current page
   *      see stealthed values too.
   *
   * Both calls are guarded behind `stealthApplied` to avoid
   * re-running on every `getPage()` hit (the evasions are idempotent
   * but the IPC round-trips are not free).
   *
   * `isStealthEnabled()` is re-checked per call so an operator can
   * flip the env var mid-run and have it take effect without a
   * restart.
   */
  private async applyStealthToPageIfNeeded(page: PageLike): Promise<void> {
    if (!isStealthEnabled()) return;
    if (this.stealthApplied.has(page as unknown as object)) return;
    this.stealthApplied.add(page as unknown as object);
    const anyPage = page as unknown as {
      addInitScript?: (script: { content: string } | string) => Promise<void>;
      evaluate?: (expr: string) => Promise<unknown>;
    };
    try {
      if (anyPage.addInitScript) {
        await anyPage.addInitScript({ content: STEALTH_INIT_SCRIPT });
      }
    } catch {
      // non-fatal — best-effort
    }
    // Fire-and-forget the immediate-doc evaluate. If the page is
    // still half-stuck, we don't want our best-effort stealth call to
    // wedge the task start. addInitScript (above) has already armed
    // the NEXT navigation, which is what matters for captcha tests
    // that fingerprint via `new Navigator()` on load.
    if (anyPage.evaluate) {
      void anyPage.evaluate(STEALTH_INIT_SCRIPT).catch(() => {});
    }
  }

  /**
   * Cheap liveness probe. Races `page.evaluate('1')` against a
   * timeout — real Playwright pages respond in <10ms when healthy, so
   * anything past a few seconds is hung on a modal / disconnected
   * renderer. Never throws; returns false on any error.
   *
   * Exposed as a public method so tests can wire a pending-evaluate
   * stub, and so the runner can reuse the probe pre-tick if we ever
   * want that.
   */
  async isPageResponsive(page: PageLike, timeoutMs = 3_000): Promise<boolean> {
    if (typeof page.evaluate !== 'function') {
      // Test stubs without an evaluate method default to "responsive"
      // so they don't accidentally trip the recovery path.
      return true;
    }
    const evaluator = page.evaluate;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      evaluator('1').then(
        () => finish(true),
        () => finish(false),
      );
    });
  }

  // ---------- screenshot / snapshot ----------

  /**
   * Viewport JPEG capture. Quality 80 matches the sharp-resize quality
   * already used in `image.ts`, so post-resize bytes look consistent
   * across the legacy and Playwright paths. Never throws.
   *
   * `timeoutMs` defaults to `SCREENSHOT_TIMEOUT_MS` — way below
   * Playwright's built-in 30 s. The old 30 s default made a single
   * stuck tab (anti-bot modal, renderer hang) burn 30 s per tick on
   * every subsequent task until someone restarted Chrome. 10 s is
   * still generous for a healthy page (sub-second in practice) and
   * surfaces trouble fast.
   */
  async screenshot(page: PageLike, opts: { timeoutMs?: number } = {}): Promise<ScreenshotResult> {
    const timeout = opts.timeoutMs ?? SCREENSHOT_TIMEOUT_MS;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false, timeout });
      // `page.viewportSize()` returns null when Playwright is attached
      // via `connectOverCDP` to an externally-launched Chrome (the
      // whole point of Phase D) — Playwright didn't configure the
      // viewport so it refuses to guess. Fall back to decoding the
      // actual JPEG bytes, which always carries the real capture dims.
      // Downstream (modelCoordToReal + the commander's resize path)
      // needs real pixels or the vision loop can't translate clicks.
      const vp = page.viewportSize();
      if (vp) {
        return {
          base64: buf.toString('base64'),
          viewportWidth: vp.width,
          viewportHeight: vp.height,
        };
      }
      const meta = await sharp(buf).metadata();
      if (typeof meta.width === 'number' && typeof meta.height === 'number') {
        return {
          base64: buf.toString('base64'),
          viewportWidth: meta.width,
          viewportHeight: meta.height,
        };
      }
      return {
        error: `screenshot captured but both page.viewportSize() and sharp metadata returned no dimensions (buf=${buf.length} bytes)`,
      };
    } catch (err) {
      return { error: `screenshot failed: ${errMsg(err)}` };
    }
  }

  /**
   * Accessibility-tree snapshot, rendered as Playwright-MCP-style text
   * plus a `refs` table Claude can cite.
   *
   * The `interestingOnly: true` option skips nodes the AT would hide
   * (generic containers, decorative images, etc.) so the output is
   * dense and useful for a screen-reader-grade operator — which is
   * exactly the persona Claude plays here. In practice this drops the
   * token count ~10× vs a base64 screenshot on typical news / dashboard
   * pages; Step 2 wires it into the commander.
   */
  async accessibilitySnapshot(page: PageLike): Promise<AccessibilitySnapshotResult> {
    let yaml = '';
    try {
      yaml = await page.ariaSnapshot({ ref: true });
    } catch (err) {
      return {
        text: '',
        refs: [],
        url: safeUrl(page),
        title: '',
        error: `ariaSnapshot failed: ${errMsg(err)}`,
      };
    }
    const { text, refs } = annotateAriaSnapshot(yaml);
    let title = '';
    try {
      title = await page.title();
    } catch {
      // non-fatal — title best-effort
    }
    return { text, refs, url: safeUrl(page), title };
  }

  // ---------- input actions ----------

  async click(
    page: PageLike,
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle' = 'left',
  ): Promise<ActionResult> {
    try {
      if (isHumanizeEnabled()) {
        // humanClick moves via bezier + jitter + settle delay and then
        // fires mouse.click. Whole sequence is still bounded by
        // CLICK_TIMEOUT_MS so a hung renderer can't burn the tick.
        await withTimeout(humanClick(page, x, y, button), CLICK_TIMEOUT_MS, `click @ (${x},${y})`);
      } else {
        await withTimeout(
          page.mouse.click(x, y, { button }),
          CLICK_TIMEOUT_MS,
          `click @ (${x},${y})`,
        );
      }
      return { ok: true, message: `clicked ${button} @ (${x},${y})` };
    } catch (err) {
      return { ok: false, message: `click failed: ${errMsg(err)}` };
    }
  }

  async type(page: PageLike, text: string): Promise<ActionResult> {
    try {
      if (isHumanizeEnabled()) {
        // Per-char delays push long strings past the 10s default; scale
        // the cap with length (200ms per char headroom) but never below
        // the configured minimum.
        const bound = Math.max(TYPE_TIMEOUT_MS, text.length * 250);
        await withTimeout(humanTypeText(page, text), bound, `type ${text.length} chars`);
      } else {
        await withTimeout(page.keyboard.type(text), TYPE_TIMEOUT_MS, `type ${text.length} chars`);
      }
      return { ok: true, message: `typed ${text.length} chars` };
    } catch (err) {
      return { ok: false, message: `type failed: ${errMsg(err)}` };
    }
  }

  /**
   * Atomic text insertion — bypasses keyboard simulation. Required
   * for CJK / non-Latin input because page.keyboard.type() emits
   * per-character keydown/keyup events, and Chinese characters can't
   * be produced by single keystrokes without a server-side IME
   * (fcitx5 / ibus). The remote Brave on Xvfb has no IME, so all CJK
   * goes through this path: user composes in their LOCAL OS IME,
   * the SPA ships the composed text via `client.vision.user_input`
   * kind='insert_text', and this method fires Playwright's atomic
   * insertText API which writes directly to the focused element.
   *
   * Caller is responsible for ensuring focus is on the right input —
   * a click/click_ref before insertText is the expected pre-step.
   */
  async insertText(page: PageLike, text: string): Promise<ActionResult> {
    if (!page.keyboard.insertText) {
      return {
        ok: false,
        message: 'insertText not supported by underlying page (stub or older Playwright)',
      };
    }
    try {
      await withTimeout(
        page.keyboard.insertText(text),
        TYPE_TIMEOUT_MS,
        `insertText ${text.length} chars`,
      );
      return { ok: true, message: `inserted ${text.length} chars` };
    } catch (err) {
      return { ok: false, message: `insertText failed: ${errMsg(err)}` };
    }
  }

  /**
   * Phase 1 Playbook B2 — best-effort multi-signal capture of the element
   * a click/type targets, at action time. Runs `document.elementFromPoint`
   * (or `document.activeElement` when no coordinate — e.g. a `type` action)
   * and reads visible text (primary anchor), a UNIQUE stable selector
   * candidate when one exists, the URL, and the attributes needed to judge
   * field sensitivity. PURE READ — never mutates the page.
   *
   * HOT-PATH SAFE: bounded by CAPTURE_TIMEOUT_MS + try/catch; ANY failure
   * (eval error, navigation mid-eval, timeout) returns null so the caller
   * degrades to coordinate-only and the browse action is never affected.
   * Takes a real `Page` (not `PageLike`) because `page.evaluate` runs a
   * function in the browser context.
   */
  async captureTargetDescriptor(
    page: Page,
    x?: number,
    y?: number,
    diag?: { taskId?: string; actionIndex?: number },
  ): Promise<TargetDescriptor | null> {
    // Coordinate (or null → activeElement, e.g. a `type` action). Guarded to
    // FINITE numbers so ONLY a numeric or `null` literal is interpolated below.
    const cx = typeof x === 'number' && Number.isFinite(x) ? x : null;
    const cy = typeof y === 'number' && Number.isFinite(y) ? y : null;
    // B2.1 instrument — metadata-only context for the diagnostic logs below.
    // NEVER carries any captured field value / user input.
    const ctx = { taskId: diag?.taskId, actionIndex: diag?.actionIndex };
    // B2.2 ROOT FIX — author the in-page probe as a STRING IIFE, NOT a function
    // value. tsx/esbuild `keepNames` wraps named/arrow functions with
    // `__name(fn, ...)`; when Playwright serialised the function into the page,
    // `__name` (a Node-side build helper) was undefined → page.evaluate threw
    // `ReferenceError: __name is not defined` on EVERY click (proven by the
    // B2.1 diagnostic). A string literal is opaque to the transpiler, so no
    // `__name` is ever injected — root fix, not a workaround. The IIFE is fully
    // self-contained (no closures / outer helpers; its inner `function`s live
    // INSIDE the string, untouched by the build); the coordinate is interpolated
    // as a numeric / `null` literal. Pure DOM read — never mutates the page.
    // B3 — `buildProbe` runs in NODE to assemble the probe STRING. Its own
    // esbuild `__name` wrapping is harmless (it is NEVER serialised into the
    // page; only the returned STRING is, and a string literal is opaque to the
    // build — B2.2 root fix preserved). `iframeMarker` lets the TOP probe signal
    // an iframe hit ('iframe' → route into the frame) and the IN-FRAME probe
    // signal a NESTED iframe ('nested' → B3 v1 does NOT recurse → coordinate
    // fallback). Coordinates interpolated as numeric / `null` literals. Pure read.
    const buildProbe = (px: number | null, py: number | null, iframeMarker: string): string => `(function () {
  var doc = document;
  if (!doc) return { __probe: 'no-doc', tagName: null };
  var cx = ${px};
  var cy = ${py};
  var el = (cx !== null && cy !== null) ? doc.elementFromPoint(cx, cy) : doc.activeElement;
  if (!el || el === doc.body || el === doc.documentElement) {
    return { __probe: 'no-element', tagName: el ? String(el.tagName || '').toLowerCase() : null };
  }
  if (String(el.tagName || '').toLowerCase() === 'iframe') {
    return { __probe: '${iframeMarker}', tagName: 'iframe' };
  }
  var text = String(el.innerText || el.textContent || '').trim().slice(0, 200);
  function attr(n) { return el.getAttribute(n); }
  function esc(v) { return (window.CSS && typeof window.CSS.escape === 'function') ? window.CSS.escape(v) : v; }
  function tryUnique(sel) { try { return doc.querySelectorAll(sel).length === 1 ? sel : null; } catch (e) { return null; } }
  var tag = String(el.tagName || '').toLowerCase();
  var selector = null;
  if (el.id) selector = tryUnique('#' + esc(el.id));
  if (!selector && attr('data-testid')) selector = tryUnique('[data-testid="' + attr('data-testid') + '"]');
  if (!selector && attr('data-id')) selector = tryUnique('[data-id="' + attr('data-id') + '"]');
  if (!selector && attr('name')) selector = tryUnique(tag + '[name="' + attr('name') + '"]');
  if (!selector && attr('aria-label')) selector = tryUnique('[aria-label="' + attr('aria-label') + '"]');
  return {
    url: doc.location ? doc.location.href : null,
    visibleText: text || null,
    selector: selector,
    tagName: tag,
    type: attr('type'),
    autocomplete: attr('autocomplete'),
    name: attr('name'),
    id: el.id || null,
    ariaLabel: attr('aria-label')
  };
})()`;
    type Probe =
      | TargetDescriptor
      | { __probe: 'no-doc' | 'no-element' | 'iframe' | 'nested'; tagName: string | null };
    try {
      const result = (await withTimeout(
        page.evaluate(buildProbe(cx, cy, 'iframe')),
        CAPTURE_TIMEOUT_MS,
        'captureTargetDescriptor',
      )) as Probe | null;
      // B2.1: map the in-browser probe back to the SAME external contract
      // (TargetDescriptor | null) and log WHY a null happens.
      if (!result) {
        logger.warn(ctx, 'capture: empty evaluate result (returning null)');
        return null;
      }
      if ('__probe' in result) {
        if (result.__probe === 'iframe') {
          // ───────── B3 — route into the iframe (ONE level only) ─────────
          // Fully bounded + guarded: ANY failure (no handle / no contentFrame /
          // no boundingBox / sandboxed-or-detached frame / frame.evaluate throw /
          // nested iframe / timeout) → return null → caller degrades to the
          // existing coordinate-only capture. Never blocks/throws. Only runs on
          // the ~1% iframe-hit path; the 99% path pays ZERO extra latency.
          if (cx === null || cy === null) return null;
          try {
            return await withTimeout(
              (async (): Promise<TargetDescriptor | null> => {
                const handle = await page.evaluateHandle(`document.elementFromPoint(${cx}, ${cy})`);
                const elH = handle.asElement();
                if (!elH) {
                  logger.warn(ctx, 'capture: iframe hit but no element handle (returning null)');
                  return null;
                }
                const frame = await elH.contentFrame();
                if (!frame) {
                  logger.warn(ctx, 'capture: iframe element has no contentFrame (returning null)');
                  return null;
                }
                const box = await elH.boundingBox();
                if (!box) {
                  logger.warn(ctx, 'capture: iframe has no boundingBox (returning null)');
                  return null;
                }
                // frame-local coordinate = top coordinate − iframe top-left.
                const framed = (await frame.evaluate(
                  buildProbe(cx - box.x, cy - box.y, 'nested'),
                )) as Probe | null;
                if (!framed || '__probe' in framed) {
                  logger.warn(
                    { ...ctx, framed: framed && '__probe' in framed ? framed.__probe : 'empty' },
                    'capture: in-frame probe found no target (returning null)',
                  );
                  return null; // nested iframe / no element in frame → coordinate fallback
                }
                if (!framed.visibleText) {
                  logger.warn(
                    { ...ctx, inFrame: true, tagName: framed.tagName, hasSelector: !!framed.selector },
                    'capture: frame descriptor without visible_text',
                  );
                }
                // Provenance: which frame the action targeted (≤255 = the
                // frame_path column width). Top-level captures leave it null.
                return { ...framed, framePath: (frame.url() || '').slice(0, 255) || null };
              })(),
              500, // frame-routing budget (ms) — tight; on timeout → coordinate fallback
              'captureInsideFrame',
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const kind = msg.includes('timed out') ? 'timeout' : 'threw';
            logger.warn(
              { ...ctx, stage: 'frame', kind, error: msg },
              'capture: frame routing failed (returning null)',
            );
            return null;
          }
        }
        logger.warn(
          { ...ctx, probe: result.__probe, tagName: result.tagName },
          'capture: no target element (returning null)',
        );
        return null;
      }
      if (!result.visibleText) {
        // Descriptor resolved but the primary text anchor is empty — log
        // which OTHER signals did resolve (metadata only, no values).
        logger.warn(
          {
            ...ctx,
            tagName: result.tagName,
            hasUrl: !!result.url,
            hasSelector: !!result.selector,
            hasName: !!result.name,
            hasAriaLabel: !!result.ariaLabel,
          },
          'capture: descriptor without visible_text',
        );
      }
      return result;
    } catch (err) {
      // B2.1: distinguish a hard timeout from an in-page evaluate failure
      // (CSP / detached context / serialization). Metadata + error message
      // only — never a captured value.
      const msg = err instanceof Error ? err.message : String(err);
      const kind = msg.includes('timed out') ? 'timeout' : 'threw';
      logger.warn({ ...ctx, kind, error: msg }, 'capture: evaluate failed (returning null)');
      return null;
    }
  }

  /**
   * Resolve + click an element by its ARIA role + accessible name —
   * the only addressing scheme accessibility mode has (refs are names
   * after all). Name is matched case-sensitively with `exact: false`
   * so Claude's abbreviations land on close variants. Times out at
   * 5s per click; bubbles failures as `{ok:false}` rather than
   * throwing.
   *
   * Typed loosely against PageLike for the unit-test seam, but the
   * production value is always a real playwright.Page (which has
   * getByRole). See build dispatchers in task-runner.ts.
   */
  async clickByRoleName(page: PageLike, role: string, name: string): Promise<ActionResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: duck-typed access to Page.getByRole
      const anyPage = page as any;
      if (typeof anyPage.getByRole !== 'function') {
        return { ok: false, message: 'page.getByRole unavailable (test stub?)' };
      }
      const loc = anyPage.getByRole(role, name ? { name } : undefined);
      await loc.first().click({ timeout: CLICK_BY_ROLE_TIMEOUT_MS });
      return { ok: true, message: `clicked ${role}${name ? ` "${name}"` : ''}` };
    } catch (err) {
      return { ok: false, message: `clickByRoleName failed: ${errMsg(err)}` };
    }
  }

  /**
   * Press a single named key or chord. Playwright accepts any of:
   *   "Enter" / "Escape" / "Tab" / "Backspace" / "ArrowLeft" / …
   *   "Control+A" / "Meta+C" / "Shift+Tab" (note: capital "Control"/"Meta")
   * Our tool schema feeds through lowercased chords like "ctrl+a" from
   * the main planner — normalise here so the model doesn't need to
   * remember Playwright's capitalisation quirks.
   */
  async pressKey(page: PageLike, key: string): Promise<ActionResult> {
    const normalised = normaliseKey(key);
    try {
      await withTimeout(page.keyboard.press(normalised), KEY_TIMEOUT_MS, `press ${normalised}`);
      return { ok: true, message: `pressed ${normalised}` };
    } catch (err) {
      return { ok: false, message: `press failed: ${errMsg(err)}` };
    }
  }

  /**
   * Scroll the viewport. `deltaY` positive = scroll down (same as CDP
   * convention). Optional (x, y) moves the cursor first so scrolling
   * applies to the right scroll container — default uses the viewport
   * centre, which is where Playwright's implicit mouse position starts.
   */
  async scroll(page: PageLike, deltaY: number, atX?: number, atY?: number): Promise<ActionResult> {
    try {
      if (typeof atX === 'number' && typeof atY === 'number') {
        await withTimeout(page.mouse.move(atX, atY), SCROLL_TIMEOUT_MS, 'mouse.move');
      }
      if (isHumanizeEnabled()) {
        // Chunked scroll pushes past the default 5s when the delta is
        // big — 2–5 chunks × ~300ms gap can be 1.5s alone. Scale the
        // cap so we don't trip our own timeout on a legitimate
        // scroll-through-a-long-page.
        const bound = Math.max(SCROLL_TIMEOUT_MS, 2_500);
        await withTimeout(humanScroll(page, deltaY), bound, `scroll ${deltaY}px`);
      } else {
        await withTimeout(page.mouse.wheel(0, deltaY), SCROLL_TIMEOUT_MS, `scroll ${deltaY}px`);
      }
      return { ok: true, message: `scrolled ${deltaY}px` };
    } catch (err) {
      return { ok: false, message: `scroll failed: ${errMsg(err)}` };
    }
  }

  async wait(page: PageLike, ms: number): Promise<ActionResult> {
    try {
      await page.waitForTimeout(Math.min(Math.max(ms, 0), 10_000));
      return { ok: true, message: `waited ${ms}ms` };
    } catch (err) {
      return { ok: false, message: `wait failed: ${errMsg(err)}` };
    }
  }

  async navigate(page: PageLike, url: string): Promise<ActionResult> {
    const urlBefore = page.url();
    const t0 = Date.now();
    try {
      const resp = (await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATE_TIMEOUT_MS,
      })) as { status?: () => number } | null;
      const urlAfter = page.url();
      const status = typeof resp?.status === 'function' ? resp.status() : null;
      const elapsedMs = Date.now() - t0;
      let title = '';
      try {
        title = await page.title();
      } catch {
        /* best-effort */
      }
      logger.info(
        { action: 'navigate', target: url, urlBefore, urlAfter, httpStatus: status, title, elapsedMs },
        'page.goto returned',
      );

      // Goto-no-op fallback. We've seen Playwright + connectOverCDP
      // return successfully from goto() while the page silently stays
      // on its prior URL (esp. Chromium's startup about:blank). Detect
      // and heal by opening a fresh context page and retrying there.
      if (isBlankUrl(urlAfter) && !isBlankUrl(url)) {
        logger.warn(
          { target: url, urlBefore, urlAfter },
          'navigate: page.goto returned but url stayed blank — falling back to fresh ctx.newPage()',
        );
        const fresh = await this.reopenActivePage(page);
        if (!fresh) {
          return {
            ok: false,
            message: `navigate stuck: goto returned but url=${urlAfter}; no context to reopen`,
          };
        }
        const resp2 = (await fresh.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: NAVIGATE_TIMEOUT_MS,
        })) as { status?: () => number } | null;
        const urlAfter2 = fresh.url();
        const status2 = typeof resp2?.status === 'function' ? resp2.status() : null;
        logger.info(
          { target: url, urlAfter2, httpStatus: status2 },
          'navigate: fallback newPage goto done',
        );
        if (isBlankUrl(urlAfter2)) {
          return {
            ok: false,
            message: `navigate still stuck after fresh-page fallback: url=${urlAfter2}`,
          };
        }
        return { ok: true, message: `navigated to ${url} (via fresh page fallback)` };
      }
      return { ok: true, message: `navigated to ${url}` };
    } catch (err) {
      const message = errMsg(err);
      logger.error({ target: url, urlBefore, err: message }, 'navigate threw');
      return { ok: false, message: `navigate failed: ${message}` };
    }
  }

  /**
   * Open a fresh page in the current context, pin it as activePage,
   * and best-effort close the stuck one. Returns null when we can't
   * recover a context (shouldn't happen post-connect but be defensive).
   *
   * Used by `navigate()` when goto returns success but the URL stayed
   * blank, and by `resetPageForTask()` to force a clean slate.
   */
  private async reopenActivePage(stuck: PageLike | null): Promise<Page | null> {
    const browser = this.browser;
    if (!browser) return null;
    // Phase 1 Playbook ④ — clean mode reopens in the fresh context, NOT contexts()[0].
    const ctx = this.browseContext(browser);
    if (!ctx) return null;
    const fresh = await ctx.newPage();
    this.activePage = fresh;
    await this.applyTargetViewportToPage(fresh as unknown as PageLike);
    await this.applyStealthToPageIfNeeded(fresh as unknown as PageLike);
    if (stuck) {
      void (async () => {
        const closer = stuck.close;
        if (typeof closer === 'function') await closer().catch(() => {});
      })();
    }
    return fresh;
  }

  /**
   * Park the active page on about:blank. Called by `task-runner.ts`
   * at the top of every vision-loop task so leftover state (pending
   * fetches, verification overlays, console spam, big JS heap) from
   * the prior task doesn't bleed into the new one. Silently no-ops
   * when the executor isn't wired up.
   *
   * This compounds with `getPage`'s hard-reset: getPage is the
   * *reactive* recovery (page already stuck), `resetPageForTask` is
   * the *proactive* one (start clean so we never get stuck).
   */
  async resetPageForTask(): Promise<void> {
    if (!this.browser) return;
    try {
      // Always start from a freshly-created page. Goto-ing the prior
      // active page (or Chromium's startup about:blank) has been seen
      // to leave navigation stuck in prod; newPage() gives a clean
      // target and navigate() can goto from there with full confidence.
      // Phase 1 Playbook ④ — clean mode resets the FRESH context, never contexts()[0]
      // (else the browse + the tab-close below would hit the shared user session).
      let ctx = this.browseContext(this.browser);
      if (!ctx) {
        // Clean mode: a missing context = the clean context was lost. Do NOT
        // reconnect into the shared (credential-bearing) context — bail; the next
        // getPage() throws a proper error.
        if (this.cleanMode) return;
        // Stale CDP (same failure mode getPage recovers from). Try a
        // reconnect; if that fails we bail silently — the outer loop
        // will throw a proper error on the next getPage() anyway.
        if (!(await this.reconnectIfStale()) || !this.browser) return;
        ctx = this.browseContext(this.browser);
        if (!ctx) return;
      }
      const fresh = await ctx.newPage();
      const prior = this.activePage;
      this.activePage = fresh;
      await this.applyTargetViewportToPage(fresh as unknown as PageLike);
      await this.applyStealthToPageIfNeeded(fresh as unknown as PageLike);
      // Close all existing pages that aren't our new one. Fire-and-
      // forget so we don't block task start on a flaky close. Skips
      // `fresh` itself because ctx.pages() includes it now.
      for (const p of ctx.pages()) {
        if (p === fresh) continue;
        void p.close().catch(() => {});
      }
      logger.info(
        {
          action: 'resetPageForTask',
          priorPinned: prior ? 'yes' : 'no',
          freshUrl: fresh.url(),
          remainingTabs: ctx.pages().length,
        },
        'reset for task: pinned a fresh page, closed the rest',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'resetPageForTask failed — continuing',
      );
    }
  }
}

/**
 * Per-action deadlines. Playwright's own defaults are 30 s (or none
 * at all for mouse / keyboard), which means a hung renderer burns a
 * full 30 s per action — on a 10-action task, that's 5 real minutes
 * before the task-timeout finally kicks in and we give up. These
 * caps surface trouble fast; `ACTION_TIMEOUT_MS` uniformly overrides
 * every knob below for operators who want a custom cap (e.g. very
 * slow test networks).
 */
const ACTION_TIMEOUT_OVERRIDE = readEnvTimeoutOrNull('ACTION_TIMEOUT_MS');
const CLICK_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 10_000;
const TYPE_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 10_000;
const KEY_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 5_000;
// Phase 1 Playbook B2 — best-effort target capture is bounded tight so it
// never adds meaningful latency to a click/type; on timeout it yields null.
const CAPTURE_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 400;
const SCROLL_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 5_000;
const NAVIGATE_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 15_000;
const SCREENSHOT_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 10_000;
const CLICK_BY_ROLE_TIMEOUT_MS = ACTION_TIMEOUT_OVERRIDE ?? 10_000;

// Anti-bot recovery uses two probes. Both honour `ACTION_TIMEOUT_MS`
// so unit tests (which set it to e.g. 200 ms) don't sit on the
// 3 s / 5 s production defaults — the auto-recovery suite was
// occasionally tripping vitest's 5 s per-test cap when `evaluate`
// was stubbed to hang forever.
function antiBotResponsiveTimeoutMs(): number {
  return readEnvTimeoutOrNull('ACTION_TIMEOUT_MS') ?? 3_000;
}
function antiBotSoftResetTimeoutMs(): number {
  return readEnvTimeoutOrNull('ACTION_TIMEOUT_MS') ?? 5_000;
}

function readEnvTimeoutOrNull(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Race a promise against a timeout. Playwright's `mouse.click` /
 * `keyboard.type` / `mouse.wheel` don't take a timeout option — when
 * the renderer freezes they just sit forever. This helper is how we
 * apply a hard cap anyway. Rejects with a labelled `Error` on
 * timeout; never leaves a timer dangling.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function safeUrl(page: PageLike): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}

/**
 * Treat empty/`about:blank`/`chrome://newtab/` as "no real page loaded".
 * Exported so BrowserPanel's UX placeholder and navigate()'s fallback
 * agree on what counts as blank — duplicate predicates would drift.
 */
export function isBlankUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return u === '' || u === 'about:blank' || u === 'chrome://newtab/';
}

/**
 * Normalise a chord string to Playwright's expected form:
 *   "ctrl+a"  → "Control+a"
 *   "cmd+c"   → "Meta+c"
 *   "alt+F4"  → "Alt+F4"
 *   "Enter"   → "Enter" (unchanged)
 *   "Return"  → "Enter"  (Playwright rejects "Return")
 *   "Esc"     → "Escape"
 *   "Del"     → "Delete"
 *   "Space"   → " "
 * Terminal-key aliases are applied to bare keys and to the last
 * segment of a chord. Single printable chars pass through untouched.
 */
function normaliseKey(key: string): string {
  const modMap: Record<string, string> = {
    ctrl: 'Control',
    control: 'Control',
    cmd: 'Meta',
    command: 'Meta',
    meta: 'Meta',
    super: 'Meta',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
  };
  // Models sometimes emit legacy / OS-specific key names that Playwright
  // doesn't recognise ("Return" from macOS, "Esc" shorthand). Alias them
  // to Playwright's canonical form. Lookup is lowercased so "RETURN",
  // "return", "Return" all hit the same entry.
  const terminalAliases: Record<string, string> = {
    return: 'Enter',
    esc: 'Escape',
    del: 'Delete',
    ins: 'Insert',
    space: ' ',
    spacebar: ' ',
  };
  const aliasTerminal = (seg: string): string => terminalAliases[seg.toLowerCase()] ?? seg;
  if (!key.includes('+')) return aliasTerminal(key);
  const parts = key
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts
    .map((p, i) => {
      if (i === parts.length - 1) return aliasTerminal(p);
      const lower = p.toLowerCase();
      return modMap[lower] ?? p;
    })
    .join('+');
}

/**
 * Parse Playwright's `ariaSnapshot()` YAML output, inject `[ref=eN]`
 * markers on lines whose role is interactive, and return the augmented
 * text + a refs table.
 *
 * ariaSnapshot output looks like:
 *
 *   - generic:
 *     - heading "Hello" [level=1]
 *     - link "Home":
 *       - /url: "https://..."
 *     - button "Submit"
 *     - textbox "Search"
 *
 * Sub-properties (`/url`, `/description`, etc.) are NOT interactive
 * nodes — they're metadata on the parent line and get left untouched.
 * Non-interactive roles (generic, heading, img, …) also pass through.
 *
 * Produced output for the snippet above:
 *
 *   - generic:
 *     - heading "Hello" [level=1]
 *     - link "Home" [ref=e1]:
 *       - /url: "https://..."
 *     - button "Submit" [ref=e2]
 *     - textbox "Search" [ref=e3]
 *
 * Exported so unit tests can exercise the parser in isolation.
 */
export function annotateAriaSnapshot(yaml: string): {
  text: string;
  refs: AccessibilityNodeRef[];
} {
  const refs: AccessibilityNodeRef[] = [];
  const lines = yaml.split('\n');
  // Match: leading spaces, the "- ", role word, optional quoted name,
  // then whatever trailing metadata (`[attr=val]`, `:`, sub-content).
  // Group 1 captures everything up through and including the name/role;
  // group 2 captures the bare role token for the interactive check;
  // group 3 captures the raw name (quotes stripped); group 4 is the
  // trailing colon/attrs so we can re-attach them after `[ref=eN]`.
  const roleLine = /^(\s*-\s*(\w+)(?:\s+"((?:[^"\\]|\\.)*)")?)(.*)$/;
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(roleLine);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, head, role, quotedName, tail] = m;
    if (!head || !role) {
      out.push(line);
      continue;
    }
    if (!INTERACTIVE_ROLES.has(role)) {
      out.push(line);
      continue;
    }
    const ref = `e${refs.length + 1}`;
    refs.push({ ref, role, name: (quotedName ?? '').trim() });
    out.push(`${head} [ref=${ref}]${tail ?? ''}`);
  }
  return { text: out.join('\n'), refs };
}

/**
 * Lazy require('playwright') wrapper so the binary / types only load
 * when `connect()` is actually invoked. Tests usually skip this by
 * passing their own chromium stub to the constructor.
 */
function lazyPlaywrightChromium(): {
  connectOverCDP: (endpoint: string) => Promise<Browser>;
} {
  return {
    async connectOverCDP(endpoint: string): Promise<Browser> {
      const pw = await import('playwright');
      return pw.chromium.connectOverCDP(endpoint);
    },
  };
}
