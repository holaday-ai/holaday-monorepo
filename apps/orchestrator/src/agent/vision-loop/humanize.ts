/**
 * Humanized input — Layer 2 of the anti-detection stack.
 *
 * Real humans don't fire `mouse.click(500, 300)` as a single atomic
 * CDP event. Their cursor drifts along a non-linear path, they pause
 * briefly before clicking, they type at 50–200 ms per key instead of
 * flushing a full string instantaneously, and they scroll in bursts
 * instead of one giant wheel delta. Sophisticated bot detectors
 * (Cloudflare Bot Management, DataDome, reCAPTCHA v3) score these
 * motion-timing signals; straight-line clicks and zero-delay `.type`
 * are dead giveaways.
 *
 * This module wraps the raw Playwright primitives with humanized
 * versions. Opt-out via `HUMANIZE_ENABLED=false` for the E2E path
 * that wants deterministic timing (tests assert durations) and for
 * operators profiling real throughput.
 *
 * Kept transport-agnostic: every function here takes a `PageLike`
 * (the executor's narrow duck type) and never imports from the
 * executor. The executor wraps its own `click` / `type` / `scroll`
 * in these helpers behind the env gate.
 */

import type { PageLike } from './playwright-executor.js';

/**
 * Sleep for a uniformly random duration in the inclusive `[min, max]`
 * range (ms). Exported so the executor can insert an inter-action
 * pause before / after each dispatch ("I clicked, now let me think
 * for a beat before the next thing").
 */
export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * Math.max(0, maxMs - minMs);
  await new Promise((resolve) => setTimeout(resolve, Math.round(ms)));
}

/**
 * Track the cursor position per page so each humanMouseMove starts
 * from the previous target instead of teleporting from (0, 0). Keyed
 * by PageLike identity via a WeakMap so we don't leak entries on
 * disconnect.
 */
const cursorPosByPage = new WeakMap<object, { x: number; y: number }>();

function getCursor(page: PageLike): { x: number; y: number } {
  return cursorPosByPage.get(page as unknown as object) ?? { x: 0, y: 0 };
}

function setCursor(page: PageLike, x: number, y: number): void {
  cursorPosByPage.set(page as unknown as object, { x, y });
}

/**
 * Non-linear cursor path between the current position and (targetX,
 * targetY). We draw a quadratic bezier with a randomly-offset control
 * point, then sample 3–5 intermediate points along it and fire a
 * `mouse.move` for each. Total: start + N intermediates + target,
 * always >= 4 moves so the bezier assert in tests doesn't flake on
 * short paths.
 *
 * The control-point offset is perpendicular to the straight line
 * from start to end, scaled by ~15–35% of the path length. This
 * gives a visible "arc" on long moves and a nearly-straight curve
 * on very short ones — matching how humans actually move.
 */
export async function humanMouseMove(
  page: PageLike,
  targetX: number,
  targetY: number,
): Promise<void> {
  const start = getCursor(page);
  const dx = targetX - start.x;
  const dy = targetY - start.y;
  const pathLen = Math.hypot(dx, dy);

  // Random 3–5 intermediate steps (plus the final target move).
  const steps = 3 + Math.floor(Math.random() * 3);

  // Control-point perpendicular offset, 15–35% of path length.
  const perpScale = 0.15 + Math.random() * 0.2;
  const perpMag = Math.max(5, pathLen * perpScale);
  // Perpendicular direction: rotate (dx, dy) 90° and normalise.
  const perpLen = Math.hypot(-dy, dx) || 1;
  const perpSign = Math.random() < 0.5 ? -1 : 1;
  const ctrlX = start.x + dx / 2 + ((-dy / perpLen) * perpMag * perpSign);
  const ctrlY = start.y + dy / 2 + ((dx / perpLen) * perpMag * perpSign);

  for (let i = 1; i <= steps; i++) {
    const tBase = i / (steps + 1);
    const tJitter = (Math.random() - 0.5) * 0.05; // ±2.5%
    const t = Math.min(0.999, Math.max(0.001, tBase + tJitter));
    const mt = 1 - t;
    // Quadratic bezier: B(t) = (1-t)² P0 + 2(1-t)t P1 + t² P2
    const bx = mt * mt * start.x + 2 * mt * t * ctrlX + t * t * targetX;
    const by = mt * mt * start.y + 2 * mt * t * ctrlY + t * t * targetY;
    await page.mouse.move(Math.round(bx), Math.round(by));
    // Small per-step delay so the renderer actually paints the move.
    await randomDelay(8, 22);
  }
  await page.mouse.move(targetX, targetY);
  setCursor(page, targetX, targetY);
}

/**
 * Move-then-click with a ±3 px jitter on the landing point and a
 * short settle delay between arrival and the button press. Used by
 * the executor's `click` in humanize mode.
 */
export async function humanClick(
  page: PageLike,
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle' = 'left',
): Promise<void> {
  // "Think beat" before the action — mimics the 200–800 ms a real
  // user spends deciding where to click. Applied uniformly across
  // click / type / scroll in humanize mode so automation doesn't
  // read as "instantly-responsive to prompts" to behavioural
  // detectors.
  await randomDelay(200, 800);
  const jitterX = Math.round((Math.random() - 0.5) * 6);
  const jitterY = Math.round((Math.random() - 0.5) * 6);
  await humanMouseMove(page, x + jitterX, y + jitterY);
  await randomDelay(50, 150);
  await page.mouse.click(x, y, { button });
  setCursor(page, x, y);
}

/**
 * Type a string one character at a time with a random 50–200 ms gap
 * between keystrokes. Playwright's `keyboard.type(text, { delay })`
 * takes a fixed delay; we want per-char variance, so we loop.
 *
 * Uses `Array.from(text)` so multi-byte Unicode (emoji, Chinese
 * surrogate pairs) types as one codepoint per step instead of split
 * surrogates.
 */
export async function humanTypeText(page: PageLike, text: string): Promise<void> {
  // Think beat before the first keystroke — see humanClick for why.
  await randomDelay(200, 800);
  for (const ch of Array.from(text)) {
    await page.keyboard.type(ch);
    await randomDelay(50, 200);
  }
}

/**
 * Chunk a wheel scroll into 2–5 smaller scrolls with a 100–300 ms
 * gap between each. Large single-shot wheel events are distinctive —
 * trackpads and mouse-wheels deliver continuous streams of small
 * deltas.
 */
export async function humanScroll(page: PageLike, deltaY: number): Promise<void> {
  if (deltaY === 0) return;
  // Think beat before the first chunk.
  await randomDelay(200, 800);
  const chunkCount = 2 + Math.floor(Math.random() * 4); // 2..5
  const per = deltaY / chunkCount;
  for (let i = 0; i < chunkCount; i++) {
    await page.mouse.wheel(0, per);
    if (i < chunkCount - 1) {
      await randomDelay(100, 300);
    }
  }
}

/**
 * Env gate: humanize on by default. Set `HUMANIZE_ENABLED=false` /
 * `0` / empty to bypass — e.g. during E2E timing measurements or on
 * machines where the extra 200 – 800 ms inter-action pause makes
 * dogfood feel sluggish.
 */
export function isHumanizeEnabled(): boolean {
  const raw = process.env.HUMANIZE_ENABLED;
  if (raw === undefined) return true;
  const lower = raw.trim().toLowerCase();
  return !(lower === 'false' || lower === '0' || lower === 'no' || lower === '');
}
