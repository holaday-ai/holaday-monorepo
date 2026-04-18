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
import { type LocatorSpec, buildSelectorPlan } from './selector-plan.js';

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
      switch (action.kind) {
        case 'goto':
          return await this.doGoto(action);
        case 'wait':
          return await this.doWait(action);
        case 'click':
          return await this.doClick(action);
        case 'type':
          return await this.doType(action);
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
    }
  }

  // ---------- per-kind implementations ----------

  private async doGoto(action: DriverAction): Promise<DriverResult> {
    const url = typeof action.payload?.url === 'string' ? action.payload.url : null;
    if (!url) return driverError(DRIVER_ERRORS.PAYLOAD_MISSING, 'goto requires payload.url');
    if (!isOriginAllowed(url, this.opts.allowedOrigins)) {
      return driverError(
        DRIVER_ERRORS.ORIGIN_BLOCKED,
        `origin not in Skill allowedOrigins: ${url}`,
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
    const locator = await this.resolveLocator(page, action);
    if (!locator) {
      return driverError(
        DRIVER_ERRORS.SELECTOR_NOT_FOUND,
        `click: no strategy matched (${action.selector.description})`,
      );
    }
    try {
      await locator.click({ timeout: action.deadlineMs ?? 5_000 });
      return { status: 'ok', data: { clicked: action.selector.description } };
    } catch (err) {
      return driverError(
        DRIVER_ERRORS.CLICK_FAILED,
        err instanceof Error ? err.message : String(err),
      );
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
    const locator = await this.resolveLocator(page, action);
    if (!locator) {
      return driverError(
        DRIVER_ERRORS.SELECTOR_NOT_FOUND,
        `type: no strategy matched (${action.selector.description})`,
      );
    }
    try {
      // `fill` works for <input>/<textarea>. For contenteditable (Douyin
      // reply editor) fill fails → we fall back to focus+type. The Skill's
      // SKILL.md caveat marks those step kinds explicitly.
      try {
        await locator.fill(text, { timeout: action.deadlineMs ?? 5_000 });
      } catch {
        await locator.focus({ timeout: action.deadlineMs ?? 5_000 });
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
    const locator = await this.resolveLocator(page, action);
    if (!locator) {
      return driverError(
        DRIVER_ERRORS.SELECTOR_NOT_FOUND,
        `extract: no strategy matched (${action.selector.description})`,
      );
    }
    try {
      const limit = Math.min(
        typeof action.payload?.limit === 'number' ? action.payload.limit : 20,
        50,
      );
      const count = await locator.count();
      const texts: string[] = [];
      for (let i = 0; i < Math.min(count, limit); i += 1) {
        const t = (await locator.nth(i).innerText({ timeout: 2_000 })).trim();
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
    try {
      const fullPage = Boolean(action.payload?.fullPage);
      const buf = await page.screenshot({ type: 'png', fullPage });
      // Return base64; SW hands off to S3 upload path (W3); Phase 0
      // orchestrator just stashes the length as audit evidence.
      return {
        status: 'ok',
        data: {
          encoding: 'base64',
          bytes: buf.length,
          // Avoid shipping the blob over WS; a reference hash + size is
          // enough for Phase 0 audit.
          sizeBytes: buf.length,
        },
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
    return this.app;
  }

  private async ensurePage(initialUrl?: string): Promise<Page> {
    if (this.page) return this.page;
    const app = await this.ensureApp();
    if (this.opts.attachToTabId !== null) {
      this.page = await app.attach(this.opts.attachToTabId);
    } else {
      this.page = await app.newPage({ url: initialUrl ?? 'about:blank', active: true });
    }
    return this.page;
  }

  private async resolveLocator(page: Page, action: DriverAction): Promise<Locator | null> {
    if (!action.selector) return null;
    const plan = buildSelectorPlan(action.selector);
    const scope = plan.scopeCss ? page.locator(plan.scopeCss) : null;
    for (const spec of plan.attempts) {
      let locator: Locator | null;
      try {
        locator = buildLocator(page, scope, spec);
      } catch {
        continue;
      }
      if (!locator) continue;
      if (plan.nth !== undefined) locator = locator.nth(plan.nth);
      try {
        await locator
          .first()
          .waitFor({ state: 'attached', timeout: this.opts.perStrategyTimeoutMs });
        return locator;
      } catch {
        // strategy didn't resolve in time — fall through to next
      }
    }
    return null;
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
