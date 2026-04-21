/**
 * Anti-bot signal detection — Layer 3 of the anti-detection stack.
 *
 * Given an action failure (click / type / navigate error) OR an
 * accessibility snapshot's text, classify whether the site is
 * serving us a bot wall: a captcha challenge, a "verify you're
 * human" overlay, a Cloudflare "Just a moment" interstitial, or an
 * outright 403 block. The runner uses these signals to
 *   - tag the per-step event with `antiBot` (Layer 3)
 *   - enter a "waiting for human" pause (Layer 4)
 *   - count toward the 3-strikes fallback trigger (Layer 5)
 *
 * Every check is case-insensitive. We match both English and Chinese
 * phrasings because Chinese-market sites (Douyin, Weibo, Bilibili)
 * serve Chinese-language verification flows and standard detectors
 * miss them.
 *
 * Deliberately conservative on "medium" confidence and strict on
 * "high": a runtime error containing "verify" alone might just be a
 * 500 from a verification endpoint; we want Layer 4 to escalate
 * only when the signal is strong enough that a human-in-the-loop is
 * actually worth the pause.
 */

export type AntiBotSignalKind = 'captcha' | 'verify' | 'block' | 'cloudflare';

export interface AntiBotSignal {
  type: AntiBotSignalKind;
  confidence: 'high' | 'medium';
  /** The substring that triggered the match — surfaced in logs / UI for explainability. */
  rawMatch: string;
}

/**
 * High-confidence keywords: their presence strongly implies we're
 * looking at a verification gate rather than normal content. Ordered
 * most-specific first so the returned `rawMatch` is the tightest
 * fragment we could find.
 */
const HIGH_CONFIDENCE: Array<{ pattern: RegExp; kind: AntiBotSignalKind }> = [
  // Cloudflare interstitial phrases. Distinct from a generic "verify"
  // hit because the interstitial copy is extremely stable across years.
  { pattern: /just a moment\b/i, kind: 'cloudflare' },
  { pattern: /checking your browser/i, kind: 'cloudflare' },
  { pattern: /cloudflare/i, kind: 'cloudflare' },
  { pattern: /cf[-_ ]?ray/i, kind: 'cloudflare' },

  // Explicit captcha flows.
  { pattern: /recaptcha/i, kind: 'captcha' },
  { pattern: /hcaptcha/i, kind: 'captcha' },
  { pattern: /captcha/i, kind: 'captcha' },
  { pattern: /geetest/i, kind: 'captcha' }, // common in CN market
  { pattern: /滑动验证/, kind: 'captcha' },
  { pattern: /拖动滑块/, kind: 'captcha' },
  { pattern: /人机验证/, kind: 'captcha' },
  { pattern: /请完成验证/, kind: 'verify' },
  { pattern: /完成安全验证/, kind: 'verify' },

  // Outright blocks.
  { pattern: /access denied/i, kind: 'block' },
  { pattern: /forbidden.*?\b403\b|\b403\b.*?forbidden/i, kind: 'block' },
  { pattern: /blocked by.*?security/i, kind: 'block' },
  { pattern: /you (?:have been|are) blocked/i, kind: 'block' },
  { pattern: /ip.*?blocked/i, kind: 'block' },
];

/**
 * Medium-confidence keywords: ambiguous in isolation (a normal page
 * might legitimately have a "verify email" button), but still worth
 * surfacing. We downgrade the signal so Layer 4 doesn't halt the
 * task for every accidental match — it uses `confidence` to decide.
 */
const MEDIUM_CONFIDENCE: Array<{ pattern: RegExp; kind: AntiBotSignalKind }> = [
  { pattern: /\bverify\b/i, kind: 'verify' },
  { pattern: /验证码/, kind: 'captcha' },
  { pattern: /\bverification\b/i, kind: 'verify' },
  { pattern: /security check/i, kind: 'verify' },
  { pattern: /are you human/i, kind: 'verify' },
  { pattern: /not a robot/i, kind: 'verify' },
  { pattern: /请验证/, kind: 'verify' },
  { pattern: /开启读屏标签/, kind: 'verify' }, // Douyin's specific overlay
  { pattern: /\brobot\b/i, kind: 'verify' },
];

function scan(
  text: string,
  table: Array<{ pattern: RegExp; kind: AntiBotSignalKind }>,
  confidence: 'high' | 'medium',
): AntiBotSignal | null {
  for (const { pattern, kind } of table) {
    const m = pattern.exec(text);
    if (m) {
      return { type: kind, confidence, rawMatch: m[0] };
    }
  }
  return null;
}

/**
 * Inspect a thrown / returned error message for anti-bot markers.
 * Typical inputs here are Playwright timeout messages (`locator.click:
 * Timeout 5000ms exceeded`) or goto failures that include captured
 * page text, both of which may reveal the reason for the block.
 */
export function detectFromError(err: Error | string | unknown): AntiBotSignal | null {
  const text = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
  if (!text) return null;
  return scan(text, HIGH_CONFIDENCE, 'high') ?? scan(text, MEDIUM_CONFIDENCE, 'medium');
}

/**
 * Inspect an accessibility snapshot's text for anti-bot markers. The
 * snapshot is the same YAML-ish string the commander receives, so
 * what we scan is exactly what the agent can see on the page. We
 * prefer this over HTML / DOM scans because snapshots already filter
 * out decorative nodes and keep the user-visible text.
 */
export function detectFromSnapshot(snapshot: string): AntiBotSignal | null {
  if (!snapshot) return null;
  return scan(snapshot, HIGH_CONFIDENCE, 'high') ?? scan(snapshot, MEDIUM_CONFIDENCE, 'medium');
}

/**
 * Combined entry point — takes an action failure message AND the
 * most recent snapshot text, returns the strongest signal either
 * source produced. Errors are more reliable than snapshots (a
 * snapshot can mention a "verify email" button on an otherwise
 * legitimate page), so error signals win on tie.
 */
export function detectAntiBot(opts: {
  errorMessage?: string | null;
  snapshotText?: string | null;
}): AntiBotSignal | null {
  const fromErr = opts.errorMessage ? detectFromError(opts.errorMessage) : null;
  if (fromErr?.confidence === 'high') return fromErr;
  const fromSnap = opts.snapshotText ? detectFromSnapshot(opts.snapshotText) : null;
  if (fromSnap?.confidence === 'high') return fromSnap;
  return fromErr ?? fromSnap;
}

/**
 * Human-readable tag for the UI. Short, Chinese, consistent with the
 * rest of the workbench copy.
 */
export function describeSignal(signal: AntiBotSignal): string {
  switch (signal.type) {
    case 'captcha':
      return '检测到验证码';
    case 'verify':
      return '网站要求人机验证';
    case 'block':
      return '目标站点已拦截请求';
    case 'cloudflare':
      return 'Cloudflare 质询';
  }
}
