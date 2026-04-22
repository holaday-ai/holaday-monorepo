/**
 * Accessibility-mode tool schema + decoder.
 *
 * In a11y mode the commander ships the page as Playwright-MCP-style
 * text (see PlaywrightExecutor.accessibilitySnapshot) instead of a
 * screenshot. Claude references elements by the `ref=eN` handles the
 * serialiser assigned, rather than (x, y) coordinates.
 *
 * Tool surface mirrors screenshot mode's logical operations but
 * swaps coordinates for refs:
 *
 *   click_ref        — click the element with the given ref
 *   type_in_ref      — click the ref first, then type text (common
 *                      enough that we bundle it, avoiding a wasted
 *                      round-trip for "click input then type")
 *   press_key        — keyboard key / chord (no ref needed; applies
 *                      to whatever is focused)
 *   scroll           — wheel scroll by dy; same as screenshot mode
 *   wait / screenshot / task_done / task_give_up are identical to
 *                      screenshot mode — shared semantics, shared
 *                      schemas
 *   navigate         — goto URL. Extra in both modes going forward,
 *                      because the screenshot-mode "click the address
 *                      bar → type → Enter" dance is brittle and now
 *                      that we have Playwright, a direct goto is
 *                      lossless.
 *
 * Decoded into the `A11yAction` discriminated union. Never throws
 * on bad input — falls back to `give_up` with a diagnostic reason,
 * same contract as `decodeToolUse` in actions.ts.
 */

import { z } from 'zod';

export type A11yAction =
  | { kind: 'click_ref'; ref: string }
  | { kind: 'type_in_ref'; ref: string; text: string }
  | { kind: 'press_key'; key: string }
  | { kind: 'scroll'; dy: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'screenshot' }
  | { kind: 'navigate'; url: string }
  | { kind: 'wait_for_human'; reason: string }
  | { kind: 'done'; summary: string }
  | { kind: 'give_up'; reason: string };

/**
 * Per-tool zod schemas for the a11y tool_use input blobs. Numeric
 * fields use `z.coerce.number()` for the same reason as the screenshot
 * mode (Claude sometimes stringifies integers).
 */
const clickRefSchema = z.object({
  ref: z.string().min(1),
});
const typeInRefSchema = z.object({
  ref: z.string().min(1),
  text: z.string().min(0),
});
const pressKeySchema = z.object({
  key: z.string().min(1),
});
const scrollSchema = z.object({
  dy: z.coerce.number().int(),
});
const waitSchema = z.object({
  ms: z.coerce.number().int().min(100).max(10_000),
});
const screenshotSchema = z.object({}).passthrough();
const navigateSchema = z.object({
  url: z.string().url(),
});
const waitForHumanSchema = z.object({
  reason: z.string().min(1).max(512),
});
// Matches actions.ts — a missing `summary` / `reason` must not fail
// the task (models sometimes emit naked terminal calls). Keep optional
// + default to empty; the decoder below fills in a placeholder so the
// UI never shows a blank result card.
const doneSchema = z.object({
  summary: z.string().max(4_000).optional().default(''),
});
const giveUpSchema = z.object({
  reason: z.string().max(4_000).optional().default(''),
});

/**
 * Anthropic tool schema for a11y mode. Names use the `a11y_` prefix
 * to prevent accidental mis-routing through the screenshot-mode
 * decoder during the Phase D transition (both modes can coexist in
 * the commander; dispatch by tool-name prefix).
 */
export const A11Y_TOOLS = [
  {
    name: 'a11y_click_ref',
    description:
      'Click the element with the given ref (e.g. "e5"). Use for buttons, links, tabs, and for focusing input fields before typing.',
    input_schema: {
      type: 'object' as const,
      required: ['ref'],
      properties: {
        ref: { type: 'string', description: 'Element ref from the snapshot, e.g. "e3".' },
      },
    },
  },
  {
    name: 'a11y_type_in_ref',
    description:
      'Click the given ref (focusing the field) then type text. Use for search boxes, email fields, text areas.',
    input_schema: {
      type: 'object' as const,
      required: ['ref', 'text'],
      properties: {
        ref: { type: 'string' },
        text: { type: 'string', description: 'Text to type into the field.' },
      },
    },
  },
  {
    name: 'a11y_press_key',
    description:
      'Press a named key or chord on whatever element currently has focus. "Enter" / "Tab" / "Escape" / "ctrl+a" / "cmd+c".',
    input_schema: {
      type: 'object' as const,
      required: ['key'],
      properties: {
        key: { type: 'string' },
      },
    },
  },
  {
    name: 'a11y_scroll',
    description:
      'Scroll the viewport vertically by dy pixels. Positive = down. Use when the element you need is off-screen.',
    input_schema: {
      type: 'object' as const,
      required: ['dy'],
      properties: {
        dy: { type: 'integer' },
      },
    },
  },
  {
    name: 'a11y_wait',
    description: 'Pause briefly after an action. Use for navigations / modal transitions.',
    input_schema: {
      type: 'object' as const,
      required: ['ms'],
      properties: {
        ms: { type: 'integer', minimum: 100, maximum: 10_000 },
      },
    },
  },
  {
    name: 'a11y_screenshot',
    description:
      'Re-observe the page. Rare — only when you need a fresh view of a page change you did not initiate.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'a11y_navigate',
    description:
      'Navigate to a URL directly (equivalent to pasting in the address bar and hitting Enter). Preferred over the click-address-bar-and-type dance.',
    input_schema: {
      type: 'object' as const,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Full URL including scheme.' },
      },
    },
  },
  {
    name: 'a11y_wait_for_human',
    description:
      'Pause the task and request human help (captcha, 2FA, age gate, cookie consent). Orchestrator polls the accessibility tree until the challenge clears, then resumes the loop. Prefer over a11y_task_give_up for ANY security-verification surface.',
    input_schema: {
      type: 'object' as const,
      required: ['reason'],
      properties: {
        reason: { type: 'string' },
      },
    },
  },
  {
    name: 'a11y_task_done',
    description: 'Mark the task complete. Include a Chinese summary of what was accomplished.',
    input_schema: {
      type: 'object' as const,
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
      },
    },
  },
  {
    name: 'a11y_task_give_up',
    description:
      'Declare the task unachievable (captcha, login wall, missing affordance). Provide a reason.',
    input_schema: {
      type: 'object' as const,
      required: ['reason'],
      properties: {
        reason: { type: 'string' },
      },
    },
  },
] as const;

/**
 * Decode a single Anthropic `tool_use` block into an `A11yAction`.
 * Mirrors `decodeToolUse` in actions.ts (screenshot mode): never
 * throws, unknown tools + malformed inputs fall back to `give_up`.
 */
export function decodeA11yToolUse(toolName: string, input: unknown): A11yAction {
  switch (toolName) {
    case 'a11y_click_ref': {
      const r = clickRefSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `a11y_click_ref bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'click_ref', ref: r.data.ref };
    }
    case 'a11y_type_in_ref': {
      const r = typeInRefSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `a11y_type_in_ref bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'type_in_ref', ref: r.data.ref, text: r.data.text };
    }
    case 'a11y_press_key': {
      const r = pressKeySchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `a11y_press_key bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'press_key', key: r.data.key };
    }
    case 'a11y_scroll': {
      const r = scrollSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `a11y_scroll bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'scroll', dy: r.data.dy };
    }
    case 'a11y_wait': {
      const r = waitSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `a11y_wait bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'wait', ms: r.data.ms };
    }
    case 'a11y_screenshot': {
      screenshotSchema.safeParse(input);
      return { kind: 'screenshot' };
    }
    case 'a11y_navigate': {
      const r = navigateSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `a11y_navigate bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'navigate', url: r.data.url };
    }
    case 'a11y_wait_for_human': {
      const r = waitForHumanSchema.safeParse(input);
      const reason = (r.success ? r.data.reason : '') || '需要人工验证';
      return { kind: 'wait_for_human', reason };
    }
    case 'a11y_task_done': {
      const r = doneSchema.safeParse(input);
      const summary =
        (r.success ? r.data.summary : '') || '(commander 未提供摘要)';
      return { kind: 'done', summary };
    }
    case 'a11y_task_give_up': {
      const r = giveUpSchema.safeParse(input);
      const reason =
        (r.success ? r.data.reason : '') || 'Claude 调用 a11y_task_give_up 但未提供原因';
      return { kind: 'give_up', reason };
    }
    default:
      return {
        kind: 'give_up',
        reason: `unknown a11y tool_use from Claude: ${toolName}`,
      };
  }
}
