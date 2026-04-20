/**
 * Vision-loop mode selector.
 *
 * Two modes the commander can run in:
 *
 *   screenshot    — the original path. Each tick ships a base64 JPEG
 *                   of the viewport to Claude via the vision tool
 *                   interface. Expensive (~70 KB / tick after resize)
 *                   but works on any page including canvas / games.
 *
 *   accessibility — ship the accessibility tree as Playwright-MCP-
 *                   style text instead. ~10× cheaper in tokens and
 *                   ~100× faster to describe the page, but blind on
 *                   pages with no meaningful a11y tree (most SPAs
 *                   render meaningful content, but canvas-heavy
 *                   dashboards can have an empty tree).
 *
 * The selector decides per-tick based on:
 *   - explicit env override (VISION_MODE=screenshot|accessibility|auto)
 *   - 'auto' heuristics:
 *     * intent contains visual keywords (截图 / 图片 / 看看 / 长什么样 /
 *       颜色 / screenshot / image / …) → start + stay in screenshot
 *     * last observation's accessibility tree had fewer than
 *       MIN_A11Y_ELEMENTS → probably canvas; downgrade to screenshot
 *     * last N consecutive actions failed → current mode isn't
 *       understanding the page; swap modes
 *
 * Pure function — no I/O, no side effects. Unit-testable in isolation.
 */

export type VisionMode = 'screenshot' | 'accessibility';
export type VisionModeEnv = 'screenshot' | 'accessibility' | 'auto';

/**
 * Keywords in the user's intent that bias towards screenshot mode.
 * When the user cares about what something LOOKS like (colour, shape,
 * layout), the accessibility tree won't help. Matched
 * case-insensitively as substrings.
 */
const VISUAL_INTENT_KEYWORDS = [
  '截图',
  '图片',
  '看看',
  '看一下',
  '长什么样',
  '颜色',
  '颜色',
  '样式',
  '布局',
  '画面',
  'screenshot',
  'image',
  'picture',
  'look like',
  'how does',
  'colour',
  'color',
  'visual',
];

/**
 * Accessibility trees with fewer "interesting" nodes than this are
 * probably canvas-only pages, SPAs that render into a single <div>,
 * or iframes. In those cases a11y-mode can't see anything useful, so
 * we downgrade. 5 is empirical — a login form with email + password +
 * submit already has 3 interactives, real content pages usually 20+.
 */
export const MIN_A11Y_ELEMENTS = 5;

/**
 * Consecutive action failures before swapping modes. One bad click
 * happens (model miscount, race). Two in a row means the current
 * mode isn't grounding the model properly — worth the swap cost.
 */
export const FAILURES_BEFORE_SWITCH = 2;

export interface VisionModeContext {
  /** Env override. Default 'auto' when unset. */
  envMode: VisionModeEnv;
  /** User's free-form intent. Lowercased internally for keyword matching. */
  intent: string;
  /**
   * Number of consecutive failed actions so far. The runner tracks
   * this from ActionResult.ok on each tick. Reset on the first ok.
   */
  consecutiveFailures: number;
  /**
   * For the 'auto' path: when the last observation was an
   * accessibility snapshot, how many interactive elements did it see?
   * Undefined before the first tick or when the last observation was
   * a screenshot (nothing to compare).
   */
  lastAccessibilityRefCount?: number;
  /**
   * The mode the previous tick ran in. Used to implement the "N
   * consecutive failures → swap" rule without ping-ponging on the
   * next tick.
   */
  previousMode?: VisionMode;
}

export interface VisionModeDecision {
  mode: VisionMode;
  /** Why the selector picked this mode, for logging. */
  reason: string;
}

/**
 * Pick a mode for the next tick.
 *
 * Precedence, highest first:
 *   1. explicit env (VISION_MODE=screenshot|accessibility)
 *   2. intent keyword → screenshot (user asked about visual features)
 *   3. prior tick's a11y tree was too shallow → screenshot
 *   4. N consecutive failures → swap from previous mode
 *   5. default: accessibility (cheaper, almost always works)
 */
export function selectVisionMode(ctx: VisionModeContext): VisionModeDecision {
  // 1. Hard env override.
  if (ctx.envMode === 'screenshot') {
    return { mode: 'screenshot', reason: 'VISION_MODE=screenshot' };
  }
  if (ctx.envMode === 'accessibility') {
    return { mode: 'accessibility', reason: 'VISION_MODE=accessibility' };
  }

  // 2. Intent keyword → screenshot (user cares about visuals).
  if (intentHasVisualKeyword(ctx.intent)) {
    return { mode: 'screenshot', reason: 'intent mentions visual features' };
  }

  // 3. Previous a11y snapshot was thin → canvas / untested page,
  //    flip to screenshot so we can at least see pixels.
  if (
    ctx.previousMode === 'accessibility' &&
    typeof ctx.lastAccessibilityRefCount === 'number' &&
    ctx.lastAccessibilityRefCount < MIN_A11Y_ELEMENTS
  ) {
    return {
      mode: 'screenshot',
      reason: `accessibility tree too thin (${ctx.lastAccessibilityRefCount} < ${MIN_A11Y_ELEMENTS})`,
    };
  }

  // 4. Repeated failures → swap. Downgrade a11y → screenshot, OR
  //    upgrade screenshot → accessibility (on a text-heavy page the
  //    a11y tree may work better after screenshot mis-clicks).
  if (ctx.consecutiveFailures >= FAILURES_BEFORE_SWITCH && ctx.previousMode) {
    const swapped = ctx.previousMode === 'accessibility' ? 'screenshot' : 'accessibility';
    return {
      mode: swapped,
      reason: `${ctx.consecutiveFailures} consecutive failures in ${ctx.previousMode} mode — swapping to ${swapped}`,
    };
  }

  // 5. Default — cheaper path wins.
  return { mode: 'accessibility', reason: 'default (auto)' };
}

/**
 * Read the VISION_MODE env var, defaulting to 'auto' for anything
 * that isn't a recognised value. Exported for call sites that want
 * to centralise the parsing.
 */
export function readVisionModeEnv(env: NodeJS.ProcessEnv = process.env): VisionModeEnv {
  const raw = (env.VISION_MODE ?? '').toLowerCase().trim();
  if (raw === 'screenshot' || raw === 'accessibility' || raw === 'auto') return raw;
  return 'auto';
}

function intentHasVisualKeyword(intent: string): boolean {
  const haystack = intent.toLowerCase();
  return VISUAL_INTENT_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
}
