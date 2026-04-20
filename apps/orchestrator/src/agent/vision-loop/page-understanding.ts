/**
 * PageUnderstanding — abstracts the per-tick "observe the page" step.
 *
 * Two concrete modes (see `vision-mode.ts` for when each applies):
 *
 *   ScreenshotObservation    kind='screenshot'. Carries a base64
 *                            JPEG + viewport dims + url + title.
 *                            The commander's current screenshot-mode
 *                            decideNextAction consumes this.
 *
 *   AccessibilityObservation kind='accessibility'. Carries the
 *                            Playwright-MCP-style text + a `refs`
 *                            table + url + title. The commander's
 *                            accessibility-mode path (Step 3+) will
 *                            consume this.
 *
 * The runner calls `pageUnderstanding.observe(mode)` each tick; the
 * impl is responsible for producing the right shape for the mode the
 * selector picked.
 */

import type {
  AccessibilityNodeRef,
  AccessibilitySnapshotResult,
  PageLike,
  PlaywrightExecutor,
  ScreenshotResult,
} from './playwright-executor.js';
import type { VisionMode } from './vision-mode.js';

export interface ScreenshotObservation {
  kind: 'screenshot';
  /** Raw base64 JPEG, no `data:` prefix. */
  screenshotBase64: string;
  viewportWidth: number;
  viewportHeight: number;
  url: string;
  title: string;
  tickIndex: number;
}

export interface AccessibilityObservation {
  kind: 'accessibility';
  /** Playwright-MCP-style text serialisation of the a11y tree. */
  text: string;
  /** ref → (role, name) lookup so the runner can resolve click_ref etc. */
  refs: AccessibilityNodeRef[];
  url: string;
  title: string;
  tickIndex: number;
}

export type PageObservation = ScreenshotObservation | AccessibilityObservation;

export interface PageUnderstanding {
  /**
   * Produce one observation for the given mode + tick. Implementations
   * MUST NOT throw — return a payload whose `kind` matches the
   * requested mode even on failure (empty text / empty screenshot +
   * best-effort metadata). The runner treats a zero-content
   * observation as a failed tick and fails the loop cleanly.
   */
  observe(mode: VisionMode, tickIndex: number): Promise<PageObservation>;
}

// ---------------------------------------------------------------------------
// PlaywrightPageUnderstanding — backed by a connected PlaywrightExecutor.
// Used in Step 3 when the orchestrator talks to Chrome directly, for
// BOTH modes (the executor supports screenshot AND accessibility.snapshot).
// ---------------------------------------------------------------------------

export class PlaywrightPageUnderstanding implements PageUnderstanding {
  private readonly executor: PlaywrightExecutor;

  constructor(executor: PlaywrightExecutor) {
    this.executor = executor;
  }

  async observe(mode: VisionMode, tickIndex: number): Promise<PageObservation> {
    let page: PageLike;
    try {
      // Cast through unknown: Playwright's real Page has a richer
      // Accessibility type than our PageLike duck type (PageLike's
      // snapshot param is narrower). Structurally compatible for
      // the subset we actually touch.
      page = (await this.executor.getPage()) as unknown as PageLike;
    } catch {
      return emptyObservation(mode, tickIndex);
    }
    if (mode === 'accessibility') {
      const snap = await this.executor.accessibilitySnapshot(page);
      return toAccessibilityObservation(snap, tickIndex);
    }
    // Screenshot mode (default fallback branch).
    const shot = await this.executor.screenshot(page);
    let title = '';
    try {
      title = await page.title();
    } catch {
      // best-effort
    }
    return toScreenshotObservation(shot, page.url(), title, tickIndex);
  }
}

/**
 * Callback-backed PageUnderstanding — for the legacy WS/SW/CDP path
 * where the runner already has a `screenshotFn`. Accessibility mode
 * isn't available here (the SW can't produce an a11y tree without a
 * Playwright session); requests for mode='accessibility' degrade to
 * screenshot silently. Runner's mode selector should have already
 * consulted the env and rejected accessibility for this path.
 */
export class LegacyScreenshotPageUnderstanding implements PageUnderstanding {
  private readonly screenshotFn: (tickIndex: number) => Promise<ScreenshotObservation>;

  constructor(screenshotFn: (tickIndex: number) => Promise<ScreenshotObservation>) {
    this.screenshotFn = screenshotFn;
  }

  async observe(_mode: VisionMode, tickIndex: number): Promise<PageObservation> {
    // Always returns screenshot regardless of requested mode; caller
    // is responsible for not asking for accessibility.
    return this.screenshotFn(tickIndex);
  }
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests).
// ---------------------------------------------------------------------------

export function toScreenshotObservation(
  shot: ScreenshotResult,
  url: string,
  title: string,
  tickIndex: number,
): ScreenshotObservation {
  return {
    kind: 'screenshot',
    screenshotBase64: shot.base64 ?? '',
    viewportWidth: shot.viewportWidth ?? 0,
    viewportHeight: shot.viewportHeight ?? 0,
    url,
    title,
    tickIndex,
  };
}

export function toAccessibilityObservation(
  snap: AccessibilitySnapshotResult,
  tickIndex: number,
): AccessibilityObservation {
  return {
    kind: 'accessibility',
    text: snap.text,
    refs: snap.refs,
    url: snap.url,
    title: snap.title,
    tickIndex,
  };
}

function emptyObservation(mode: VisionMode, tickIndex: number): PageObservation {
  if (mode === 'accessibility') {
    return {
      kind: 'accessibility',
      text: '',
      refs: [],
      url: '',
      title: '',
      tickIndex,
    };
  }
  return {
    kind: 'screenshot',
    screenshotBase64: '',
    viewportWidth: 0,
    viewportHeight: 0,
    url: '',
    title: '',
    tickIndex,
  };
}
