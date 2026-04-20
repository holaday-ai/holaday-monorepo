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

import type { Browser, Page } from 'playwright';
import sharp from 'sharp';

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
  }): Promise<Buffer>;
  mouse: {
    click(x: number, y: number, opts?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
    move(x: number, y: number): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  keyboard: {
    type(text: string): Promise<void>;
    press(key: string): Promise<void>;
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

export class PlaywrightExecutor {
  private browser: Browser | null = null;
  /** Dependency-injection seam for tests that want to bypass connect(). */
  private readonly chromium: {
    connectOverCDP: (endpoint: string) => Promise<Browser>;
  };

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
  async connect(cdpEndpoint: string): Promise<ConnectResult> {
    if (this.browser) return { ok: true };
    try {
      this.browser = await this.chromium.connectOverCDP(cdpEndpoint);
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
   * Release the browser handle. Idempotent — safe to call multiple
   * times and when never connected. Does NOT close the browser
   * process (we only attached to the user's existing Chrome; closing
   * it would murder their whole session).
   */
  async disconnect(): Promise<void> {
    if (!this.browser) return;
    const b = this.browser;
    this.browser = null;
    try {
      await b.close();
    } catch {
      // best-effort — the browser may already be gone
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
    const browser = this.browser;
    if (!browser) throw new Error('PlaywrightExecutor not connected — call connect() first');
    const contexts = browser.contexts();
    const ctx = contexts[0];
    if (!ctx)
      throw new Error('PlaywrightExecutor: no browser context (is Chrome actually running?)');
    const pages = ctx.pages();
    const page = pages[0];
    if (!page) throw new Error('PlaywrightExecutor: no pages in the browser context');
    return page;
  }

  // ---------- screenshot / snapshot ----------

  /**
   * Viewport JPEG capture. Quality 80 matches the sharp-resize quality
   * already used in `image.ts`, so post-resize bytes look consistent
   * across the legacy and Playwright paths. Never throws.
   */
  async screenshot(page: PageLike): Promise<ScreenshotResult> {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
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
      await page.mouse.click(x, y, { button });
      return { ok: true, message: `clicked ${button} @ (${x},${y})` };
    } catch (err) {
      return { ok: false, message: `click failed: ${errMsg(err)}` };
    }
  }

  async type(page: PageLike, text: string): Promise<ActionResult> {
    try {
      await page.keyboard.type(text);
      return { ok: true, message: `typed ${text.length} chars` };
    } catch (err) {
      return { ok: false, message: `type failed: ${errMsg(err)}` };
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
      await loc.first().click({ timeout: 5_000 });
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
      await page.keyboard.press(normalised);
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
        await page.mouse.move(atX, atY);
      }
      await page.mouse.wheel(0, deltaY);
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
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return { ok: true, message: `navigated to ${url}` };
    } catch (err) {
      return { ok: false, message: `navigate failed: ${errMsg(err)}` };
    }
  }
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
 * Normalise a chord string to Playwright's expected form:
 *   "ctrl+a"  → "Control+a"
 *   "cmd+c"   → "Meta+c"
 *   "alt+F4"  → "Alt+F4"
 *   "Enter"   → "Enter" (unchanged)
 * Single printable chars pass through untouched.
 */
function normaliseKey(key: string): string {
  if (!key.includes('+')) return key;
  const parts = key
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
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
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      if (i === parts.length - 1) return p; // terminal key — keep as-is
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
