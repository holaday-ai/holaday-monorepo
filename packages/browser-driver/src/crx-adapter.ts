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
   * ensurePage(). Needed for the raw-CDP and captureVisibleTab
   * screenshot fallbacks — both address a tab by its chrome.tabs
   * tabId, not by a Playwright Page handle.
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
      const currentPage = this.getLivePage();
      if (action.kind !== 'goto' && currentPage) {
        const allowlist = action.allowedOrigins ?? this.opts.allowedOrigins;
        if (allowlist.length > 0) {
          const currentUrl = currentPage.url();
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
    const page = this.getLivePage();
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
    const page = this.getLivePage();
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
    const page = this.getLivePage();
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
    const page = this.getLivePage();
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
    const page = this.getLivePage();
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
    const page = this.getLivePage();
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

  private async doScreenshot(_action: DriverAction): Promise<DriverResult> {
    const page = this.getLivePage();
    if (!page) return driverError(DRIVER_ERRORS.NOT_ATTACHED, 'screenshot before any goto');
    // Capture via CDP. CDP is focus-independent — works when the user
    // has switched to another window, minimized Chrome, or locked the
    // screen. This is the product-level contract: the agent runs
    // unattended.
    //
    // Three-pass strategy, ordered by increasing reliability but
    // decreasing feature-richness:
    //
    //   1. playwright `page.screenshot({ animations: 'disabled', caret: 'hide' })`
    //      — nicest diagnostic frames, but the wrapper runs page-side
    //      JS (document.getAnimations(), stable-scrollbar handling,
    //      networkidle waits) that hangs on animation-heavy SPAs
    //      (Douyin creator, Xueqiu live quotes). Expected to hang or
    //      fail on the sites we care about.
    //
    //   2. playwright `page.screenshot()` plain — drops animations/caret
    //      so the page-side JS work is lighter, but still goes through
    //      playwright's wrapper (scroll, viewport polling).
    //
    //   3. Raw CDP `Page.captureScreenshot` via newCDPSession, bypassing
    //      playwright's wrapper entirely. No page-side JS, no viewport
    //      stabilization. Just "send the bytes now". This is the actual
    //      capture primitive the other two layers eventually call into
    //      — we're cutting out the middle layers that have been hanging.
    //
    // Each pass has a 10s hard cap. Skipping is only surfaced if ALL
    // THREE fail; the reason embeds every error string so the operator
    // can see what hit. Soft-fail contract: controller treats skipped
    // like ok for cursor advancement; a missing thumbnail never fails
    // the task.
    const first = await captureViaCdpPageScreenshot(page, { clean: true });
    if (first.base64 !== null) {
      const bytes = base64ByteLength(first.base64);
      return {
        status: 'ok',
        data: {
          encoding: 'base64',
          bytes,
          sizeBytes: bytes,
          thumbnail: first.base64,
        },
      };
    }
    console.warn('[holaday][screenshot] clean capture failed, retrying plain', {
      error: first.error,
    });
    const second = await captureViaCdpPageScreenshot(page, { clean: false });
    if (second.base64 !== null) {
      const bytes = base64ByteLength(second.base64);
      return {
        status: 'ok',
        data: {
          encoding: 'base64',
          bytes,
          sizeBytes: bytes,
          thumbnail: second.base64,
          degraded: true,
        },
      };
    }
    console.warn('[holaday][screenshot] plain capture failed, falling back to raw CDP', {
      error: second.error,
    });
    const third = await captureViaRawCdp(this.tabId);
    if (third.base64 !== null) {
      const bytes = base64ByteLength(third.base64);
      return {
        status: 'ok',
        data: {
          encoding: 'base64',
          bytes,
          sizeBytes: bytes,
          thumbnail: third.base64,
          degraded: true,
          capturePath: 'raw-cdp',
        },
      };
    }
    console.warn(
      '[holaday][screenshot] raw CDP failed, falling back to captureVisibleTab (will foreground window)',
      { error: third.error },
    );
    const fourth = await captureViaVisibleTabFallback(this.tabId);
    if (fourth.base64 !== null) {
      const bytes = base64ByteLength(fourth.base64);
      return {
        status: 'ok',
        data: {
          encoding: 'base64',
          bytes,
          sizeBytes: bytes,
          thumbnail: fourth.base64,
          degraded: true,
          capturePath: 'visible-tab',
          foregroundedWindow: true,
        },
      };
    }
    // All four failed — surface every error so we can diagnose which
    // layer of playwright / CDP is actually hanging.
    const reason = `page.screenshot() failed: clean=${first.error ?? 'unknown'}; plain=${second.error ?? 'unknown'}; rawCdp=${third.error ?? 'unknown'}; visibleTab=${fourth.error ?? 'unknown'}`;
    console.error('[holaday][screenshot] all four attempts failed', {
      clean: first.error,
      plain: second.error,
      rawCdp: third.error,
      visibleTab: fourth.error,
    });
    return {
      status: 'skipped',
      data: {
        skipped: true,
        reason,
      },
    };
  }

  // ---------- private helpers ----------

  private async ensureApp(): Promise<CrxApplication> {
    if (this.app) return this.app;
    this.app = await crx.start();
    // `attached` fires on both app.newPage() and app.attach() paths per
    // playwright-crx types.d.ts, and carries the chrome tabId — the
    // one identifier our fallback screenshot paths need.
    (this.app as unknown as { on: (ev: string, cb: (d: { tabId: number }) => void) => void }).on(
      'attached',
      ({ tabId }) => {
        this.tabId = tabId;
      },
    );
    return this.app;
  }

  private async ensurePage(initialUrl?: string): Promise<Page> {
    const livePage = this.getLivePage();
    if (livePage) return livePage;
    const app = await this.ensureApp();
    if (this.opts.attachToTabId !== null) {
      this.page = await app.attach(this.opts.attachToTabId);
      // Defense in depth — some playwright-crx versions don't fire
      // `attached` on the explicit attach path. We already know the
      // tabId because the caller gave it to us, so set it directly.
      this.tabId = this.opts.attachToTabId;
    } else {
      this.page = await app.newPage({ url: initialUrl ?? 'about:blank', active: true });
    }
    return this.page;
  }

  private getLivePage(): Page | null {
    if (!this.page) return null;
    try {
      if (this.page.isClosed()) {
        this.page = null;
        this.tabId = null;
        return null;
      }
    } catch {
      this.page = null;
      this.tabId = null;
      return null;
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
    const [url, title, shot] = await Promise.all([
      safeCall(() => page.url(), ''),
      safeCall(() => page.title(), ''),
      // Diagnostic viewport capture via CDP — focus-independent.
      // On CDP timeout the helper resolves with base64=null (never
      // throws), the diagnostic still emits with strategies + url +
      // title, just no screenshot to look at.
      captureViaCdpPageScreenshot(page, { clean: true }),
    ]);
    const screenshot = shot.base64;

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

// ---------- CDP-based screenshot (focus-independent) ----------

/**
 * Capture a viewport JPEG via Playwright's page.screenshot, which
 * tunnels `Page.captureScreenshot` through the existing CDP session.
 * CDP doesn't require the target window to be focused or even
 * visible — that's the product-level invariant: the agent must
 * complete tasks while the user is in another window, has Chrome
 * minimized, or is away from the machine entirely.
 *
 * `animations: 'disabled'` pauses CSS animations at their first
 * frame so page.screenshot doesn't block waiting for a never-stable
 * layout on SPA dashboards (Baidu's carousel, Douyin's autoplay
 * strip). `caret: 'hide'` keeps the text caret out of captures
 * taken right after a type step.
 *
 * Never throws — on CDP timeout, SDK error, or evergreen target-
 * closed races, returns null. doScreenshot upgrades null to
 * `status:'skipped'`; the SELECTOR_NOT_FOUND diagnostic builder
 * just omits the screenshot field. Both paths keep the task
 * moving forward; a lost diagnostic frame is not a bug worth
 * retrying for.
 *
 * JPEG quality 40 keeps a 1280-wide viewport under ~80 KB — fits
 * over WS without saturating the dispatch channel. PNG would be
 * 3-10× larger with no visual benefit for diagnostic purposes.
 */
// Heavy SPAs (Douyin creator-center, Xueqiu quotes, etc.) need more
// than 5 seconds. Go to 10s; the step has a 30s deadline, and we
// only spend 1 screenshot per task so the budget is not a concern.
const SCREENSHOT_HARDCAP_MS = 10_000;

interface ScreenshotResult {
  base64: string | null;
  error: string | null;
}

async function captureViaCdpPageScreenshot(
  page: Page,
  opts: { clean: boolean },
): Promise<ScreenshotResult> {
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    // When `clean` is false we drop animations/caret options — those
    // run page-side JS (document.getAnimations() etc.) which can
    // hang on pages with many animations or in certain post-nav
    // states. A plain capture is more reliable as a fallback.
    const shot = page
      .screenshot({
        type: 'jpeg',
        quality: 40,
        fullPage: false,
        ...(opts.clean ? { animations: 'disabled' as const, caret: 'hide' as const } : {}),
        timeout: SCREENSHOT_HARDCAP_MS,
      })
      .then((buf) => ({
        base64: Buffer.from(buf).toString('base64'),
        error: null,
      }));
    // Outer cap in case the inner `timeout` option isn't forwarded
    // to the CDP call on this playwright-crx version (this has bit
    // us before). Resolve rather than reject — the caller decides
    // the soft-fail path.
    const hardCap = new Promise<ScreenshotResult>((resolve) => {
      hardTimer = setTimeout(
        () =>
          resolve({
            base64: null,
            error: `hardcap timeout ${SCREENSHOT_HARDCAP_MS + 500}ms`,
          }),
        SCREENSHOT_HARDCAP_MS + 500,
      );
    });
    return await Promise.race([shot, hardCap]);
  } catch (err) {
    // page.screenshot throws on target-closed / tab-navigated-away
    // during capture, or on playwright-internal timeout. Never kill
    // the step — caller decides whether to retry or skip.
    const message = err instanceof Error ? err.message : String(err);
    return { base64: null, error: message.slice(0, 500) };
  } finally {
    if (hardTimer) clearTimeout(hardTimer);
  }
}

/**
 * Last-resort CDP capture: send `Page.captureScreenshot` directly via
 * `chrome.debugger.sendCommand({tabId}, …)`, riding on the debugger
 * session playwright-crx already attached to this tab. Bypasses the
 * whole Playwright wrapper (no page-side JS, no viewport polling,
 * no scrollbar stabilization — just "send the bytes now").
 *
 * Why not `browserContext.newCDPSession(page)`: playwright-crx routes
 * that to CDP's `Target.attachToBrowserTarget`, which rejects with
 * "Either tab id or extension id must be specified". It was never
 * wired up for the CRX page->tab mapping and hasn't worked in this
 * environment. `chrome.debugger.sendCommand` on the existing session
 * sidesteps the whole thing.
 *
 * Focus-independent (CDP doesn't require the tab to be foregrounded),
 * so this preserves the unattended-agent invariant.
 *
 * Returns base64 on success (CDP returns data already base64-encoded),
 * null + error string on any failure. Never throws.
 */
async function captureViaRawCdp(tabId: number | null): Promise<ScreenshotResult> {
  if (tabId === null) {
    return { base64: null, error: 'raw-CDP: tabId unknown (listener never fired)' };
  }
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const shot = (
      chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: 40,
        captureBeyondViewport: false,
      }) as Promise<unknown>
    ).then((r: unknown): ScreenshotResult => {
      const data = (r as { data?: unknown })?.data;
      if (typeof data !== 'string' || data.length === 0) {
        return {
          base64: null,
          error: `Page.captureScreenshot returned non-string data (${typeof data})`,
        };
      }
      return { base64: data, error: null };
    });
    const hardCap = new Promise<ScreenshotResult>((resolve) => {
      hardTimer = setTimeout(
        () =>
          resolve({
            base64: null,
            error: `raw-CDP hardcap timeout ${SCREENSHOT_HARDCAP_MS}ms`,
          }),
        SCREENSHOT_HARDCAP_MS,
      );
    });
    return await Promise.race([shot, hardCap]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { base64: null, error: message.slice(0, 500) };
  } finally {
    if (hardTimer) clearTimeout(hardTimer);
  }
}

/**
 * Absolute last resort: foreground the agent's window and call
 * `chrome.tabs.captureVisibleTab(windowId, …)`. This is the ONLY
 * screenshot path that reliably works when CDP is wedged, but it
 * has a hard cost: it pulls the window in front of whatever the
 * user is doing, violating the unattended-agent invariant
 * (commit 60e3aca). Only reached after BOTH playwright
 * page.screenshot paths AND raw CDP have failed — a genuinely
 * broken state where a missing screenshot is the smaller sin
 * than a completely-silent task.
 *
 * Returns base64 JPEG on success; null + error string otherwise.
 * Never throws.
 */
async function captureViaVisibleTabFallback(tabId: number | null): Promise<ScreenshotResult> {
  if (tabId === null) {
    return { base64: null, error: 'visibleTab: tabId unknown' };
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    if (typeof windowId !== 'number') {
      return { base64: null, error: 'visibleTab: windowId missing on chrome.tabs.get result' };
    }
    // Pull the window to the foreground and make sure our tab is the
    // active one in it, otherwise captureVisibleTab grabs whatever
    // OTHER tab the user had focused in that window.
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (err) {
      // Non-fatal; some OSes block focus-steal silently, the capture
      // may still succeed if the window happened to be visible.
      console.warn('[holaday][screenshot] windows.update(focused) failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (err) {
      console.warn('[holaday][screenshot] tabs.update(active) failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    const dataUrl = (await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 40,
    })) as string;
    // captureVisibleTab returns a `data:image/jpeg;base64,…` URL; we
    // want the bare base64 payload so the downstream thumbnail path
    // matches the other capture helpers.
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    if (!base64) {
      return { base64: null, error: 'visibleTab: empty data URL' };
    }
    return { base64, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { base64: null, error: message.slice(0, 500) };
  }
}

/** Byte length of a base64 string, accounting for padding. */
function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
