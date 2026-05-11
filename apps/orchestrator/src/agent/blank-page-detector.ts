/**
 * Phase 3 R4 — blank-page (a.k.a. white-screen) detection.
 *
 * Design choice: DOM-based, not pixel-based. The agent's screenshot
 * is a JPEG buffer; decoding it to sample 10 pixel values would need
 * a JPEG decoder dependency, and even then "all pixels white" is
 * brittle (modern pages often render a solid hero background).
 *
 * Instead we probe the live DOM. A page is "blank" iff ALL of:
 *   - body.innerText.trim().length < TEXT_FLOOR (10 chars)
 *   - document.images.length === 0
 *   - document.getElementsByTagName('iframe').length === 0
 *   - document.getElementsByTagName('input').length === 0
 *   - document.getElementsByTagName('button').length === 0
 *
 * Conservative by design (per Phase 3 R4 spec: "宁可漏检不要误判"):
 * a real page that fails this needs to have essentially NO visible
 * content AND no media AND no interactive widgets. That covers the
 * relevant failure modes:
 *   - chrome-error://chromewebdata/ (the error page Chromium shows
 *     after DNS / SSL / timeout failures — no body content)
 *   - SPA shells that haven't loaded their bundle yet (empty <div
 *     id="root"></div> with no other DOM)
 *   - Sites that redirect via JS but the redirect hasn't fired
 *
 * Pages that DON'T trip this (correct rejections):
 *   - Real article / search-result / login pages (always have many
 *     inputs / buttons / text)
 *   - example.com (has the "Example Domain" h1 + 2 paragraphs)
 *   - chromium error pages with translated copy (rare; the URL is
 *     also chrome-error:// so caller has another signal)
 */

const TEXT_FLOOR = 10;

interface BlankProbePage {
  evaluate: <T>(fn: (...args: unknown[]) => T) => Promise<T>;
}

export interface BlankPageResult {
  blank: boolean;
  /** When blank=true, why (for log + retry decision). */
  reason?: string;
  /** Snapshot of probed numbers for diagnostics. */
  diagnostics: {
    textLength: number;
    images: number;
    iframes: number;
    inputs: number;
    buttons: number;
  };
}

/**
 * Probe the live page. Pure read — does not modify DOM. Always
 * resolves; throws are swallowed and treated as `blank: false`
 * (better to miss a blank page than block on a probe error).
 */
export async function detectBlankPage(page: BlankProbePage): Promise<BlankPageResult> {
  try {
    // The function below runs in the browser context. Cast through
    // unknown to keep orchestrator typecheck happy (no DOM globals).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const result = await page.evaluate((): {
      textLength: number;
      images: number;
      iframes: number;
      inputs: number;
      buttons: number;
    } => {
      const w = globalThis as any;
      const doc = w.document;
      if (!doc?.body) {
        return { textLength: 0, images: 0, iframes: 0, inputs: 0, buttons: 0 };
      }
      const rawText = (doc.body.innerText ?? doc.body.textContent ?? '') as string;
      return {
        textLength: rawText.trim().length,
        images: doc.images?.length ?? 0,
        iframes: doc.getElementsByTagName('iframe').length,
        inputs: doc.getElementsByTagName('input').length,
        buttons: doc.getElementsByTagName('button').length,
      };
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const diagnostics = result;
    const blank =
      diagnostics.textLength < TEXT_FLOOR &&
      diagnostics.images === 0 &&
      diagnostics.iframes === 0 &&
      diagnostics.inputs === 0 &&
      diagnostics.buttons === 0;
    const reason = blank
      ? `body 几乎无内容（text=${diagnostics.textLength}, images=0, iframes=0, inputs=0, buttons=0）`
      : undefined;
    return reason !== undefined ? { blank, reason, diagnostics } : { blank, diagnostics };
  } catch {
    // Probe failed. Treat as non-blank — false-negative is preferable
    // to mistakenly blocking a real page.
    return {
      blank: false,
      diagnostics: { textLength: -1, images: -1, iframes: -1, inputs: -1, buttons: -1 },
    };
  }
}
