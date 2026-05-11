/**
 * Phase 3 R2 — post-navigation hook.
 *
 * Called by the supercar agent loop AFTER each navigation lands and
 * before the screenshot is sent to the model. If a SiteConfig matches
 * the new URL, we click any visible cookie banner / age gate / popup
 * dismiss button so the agent's screenshot reflects the actual page,
 * not the overlay. Best-effort — silently swallows failures.
 *
 * The matching is intentionally text-based (innerText substring)
 * rather than CSS-selector based: site selectors change frequently
 * (build hashes, A/B variants), but visible text is stable. We
 * scope to <button>, <a>, and `[role="button"]` elements only —
 * this excludes article body text that incidentally contains
 * "同意" or "Accept".
 *
 * Returns the list of clicked text labels for logging / eval
 * assertions; empty array when nothing was found.
 */
import type { SiteConfig } from './types.js';

interface PageLike {
  url: () => string;
  evaluate: (
    fn: (texts: string[]) => unknown,
    arg: string[],
  ) => Promise<unknown>;
}

/**
 * Click the first visible button whose text matches one of `texts`.
 * Returns the label that was clicked, or null if no match.
 *
 * The browser-context function:
 *   1. Gathers candidates: <button>, <a>, [role="button"].
 *   2. For each candidate, reads `(el.innerText || el.textContent || '').trim()`.
 *   3. Matches by exact equality OR substring (substring matters for
 *      buttons like "我同意继续访问" where we want to match "同意").
 *   4. Skips elements that are display:none / visibility:hidden /
 *      offsetParent === null (off-screen), so we don't accidentally
 *      click a hidden modal trigger.
 *   5. Calls `.click()` on the first hit and returns its label.
 *
 * Does NOT scroll into view — if the button is below the fold the
 * site presumably auto-shows it, and clicking off-screen is a sign
 * of a wrong selector match anyway.
 */
/**
 * Codex P3 follow-up — `page.evaluate` hangs occasionally on
 * heavy-JS sites (taobao's main runtime can pin the renderer for
 * seconds during sliding-captcha bootstrap). Without a ceiling the
 * site-config hook could add a multi-second tail latency to every
 * navigation. 800 ms is generous for a `querySelectorAll('button')`
 * walk over the visible DOM but tight enough that an unhealthy page
 * just skips the dismiss pass and the agent moves on. On timeout
 * we return null (same as a no-match), which means the post-nav
 * hook reports `dismissed: []` and the screenshot still goes to
 * the model — degraded behaviour, not failure.
 */
const EVALUATE_TIMEOUT_MS = 800;

async function clickFirstByText(
  page: PageLike,
  texts: readonly string[],
): Promise<string | null> {
  if (texts.length === 0) return null;
  try {
    // The function below runs in the BROWSER context — orchestrator
    // TypeScript doesn't see DOM globals (HTMLElement, etc.). Cast
    // through `any` to express that the lambda is opaque to Node.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const evalFn = (targets: string[]): string | null => {
      const w = globalThis as any;
      const doc = w.document;
      if (!doc) return null;
      const candidates: any[] = Array.from(
        doc.querySelectorAll('button, a, [role="button"]'),
      );
      for (const el of candidates) {
        if (!el.offsetParent && el.tagName !== 'BODY') continue;
        const style = w.getComputedStyle ? w.getComputedStyle(el) : null;
        if (style && (style.visibility === 'hidden' || style.display === 'none')) continue;
        const raw = ((el.innerText ?? el.textContent ?? '') as string).trim();
        if (!raw || raw.length > 30) continue;
        for (const target of targets) {
          if (raw === target || raw.includes(target)) {
            try {
              el.click();
            } catch {
              /* swallow — element became stale */
            }
            return target;
          }
        }
      }
      return null;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const evaluatePromise = page.evaluate(
      evalFn as unknown as (arg: string[]) => unknown,
      texts as unknown as string[],
    );
    // Race against an 800 ms timeout — see EVALUATE_TIMEOUT_MS rationale.
    // clearTimeout in the .finally so a fast evaluate doesn't leave a
    // dangling Node handle keeping the event loop alive (vitest flags
    // those as unhandled in CI).
    const timeoutSentinel = Symbol('site-config:evaluate-timeout');
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<typeof timeoutSentinel>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(timeoutSentinel), EVALUATE_TIMEOUT_MS);
    });
    try {
      const raceResult = await Promise.race([evaluatePromise, timeoutPromise]);
      if (raceResult === timeoutSentinel) return null;
      return (raceResult as string | null) ?? null;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch {
    return null;
  }
}

export interface ApplySiteConfigResult {
  /** The config that matched, or null if no match. */
  config: SiteConfig | null;
  /** Labels of buttons clicked, in the order they fired. */
  dismissed: string[];
}

/**
 * Run the dismiss patterns from a SiteConfig against the page.
 * Tries cookieBanner first, then ageGate, then popupDismiss in
 * a single pass each (one click per category). Multiple-pass
 * dismissal isn't needed: most overlays are mutually exclusive,
 * and clicking the cookie banner usually reveals the actual
 * page underneath in one go.
 *
 * Returns which labels fired so the agent loop can log them and
 * eval cases can assert on them.
 */
export async function applySiteConfigPostNavigation(
  config: SiteConfig | null,
  page: PageLike,
): Promise<ApplySiteConfigResult> {
  const dismissed: string[] = [];
  if (!config?.dismiss) return { config, dismissed };
  const { cookieBannerTexts, ageGateTexts, popupDismissTexts } = config.dismiss;
  if (cookieBannerTexts && cookieBannerTexts.length > 0) {
    const hit = await clickFirstByText(page, cookieBannerTexts);
    if (hit) dismissed.push(hit);
  }
  if (ageGateTexts && ageGateTexts.length > 0) {
    const hit = await clickFirstByText(page, ageGateTexts);
    if (hit) dismissed.push(hit);
  }
  if (popupDismissTexts && popupDismissTexts.length > 0) {
    const hit = await clickFirstByText(page, popupDismissTexts);
    if (hit) dismissed.push(hit);
  }
  return { config, dismissed };
}
