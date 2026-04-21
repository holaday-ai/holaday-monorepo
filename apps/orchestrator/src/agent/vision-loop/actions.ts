/**
 * VisionAction — what Claude's computer-use tool_use response decodes
 * into. One of these per loop iteration; the orchestrator translates
 * it into CDP commands that the SW executes on the user's Chrome tab.
 *
 * Coordinates are always in MODEL-SPACE pixels (the resized frame the
 * commander sent to Claude, long-edge 1568px). The driver scales back
 * to viewport pixels via `modelCoordToReal` using the scale factors
 * returned from `resizeForVisionModel`.
 *
 * Kinds map 1:1 to Anthropic's computer-use tool primitives (plus a
 * `done` / `give_up` terminal, which is how Claude signals loop exit):
 *
 *   click      — move mouse to (x,y), mousedown+mouseup
 *   type       — keyboard.type(text); no IME handling at skeleton time
 *   key        — keypress for a single named key or chord ("Enter",
 *                "ctrl+a"); driver parses the chord
 *   scroll     — scroll the viewport N pixels (positive=down)
 *   wait       — pause, no user input; used when Claude wants the next
 *                screenshot to reflect a state change already in flight
 *   screenshot — re-observe; no user input. Primarily for the first
 *                tick and for cases where Claude's prior action had
 *                delayed visual feedback
 *   done       — task complete; `summary` is shown to the user
 *   give_up    — Claude concluded it can't complete; `reason` bubbles
 *                into the failure message and pauses the task
 */
export type VisionAction =
  | {
      kind: 'click';
      x: number;
      y: number;
      /** Default 'left'. 'right'/'middle' reserved for Phase B. */
      button?: 'left' | 'right' | 'middle';
    }
  | {
      kind: 'type';
      text: string;
    }
  | {
      kind: 'key';
      /** Single key or chord, e.g. "Enter", "Escape", "ctrl+a". */
      key: string;
    }
  | {
      kind: 'scroll';
      /** Positive=down, negative=up. Pixels. */
      dy: number;
    }
  | {
      kind: 'navigate';
      /** Absolute URL. Orchestrator does the goto(). */
      url: string;
    }
  | {
      kind: 'wait';
      ms: number;
    }
  | {
      kind: 'screenshot';
    }
  | {
      kind: 'done';
      summary: string;
    }
  | {
      kind: 'give_up';
      reason: string;
    };

/**
 * Anthropic tool schema for the vision loop. Each tick the commander
 * forces `tool_choice: any` (not `tool`) so Claude can pick whichever
 * action it thinks is right for the current screenshot.
 *
 * Naming convention mirrors the public computer-use beta tool names
 * (`computer_click`, `computer_type`, etc.) so users familiar with
 * the Anthropic docs have a low-friction mental model, but the schema
 * is ours — we don't use the beta `type: 'computer_20241022'` wrapper
 * at skeleton time (it's cohorted to specific models and we want a
 * cleaner tool surface that includes `done`/`give_up`).
 */
export const VISION_TOOLS = [
  {
    name: 'computer_click',
    description:
      'Click at a specific (x,y) in the screenshot coordinates. Use for buttons, links, tabs, form fields (click before typing).',
    input_schema: {
      type: 'object' as const,
      required: ['x', 'y'],
      properties: {
        x: { type: 'integer', description: 'X in screenshot pixels (0 = left edge).' },
        y: { type: 'integer', description: 'Y in screenshot pixels (0 = top edge).' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
      },
    },
  },
  {
    name: 'computer_type',
    description:
      'Type text into the currently focused field. Does not click first; issue a computer_click on the input before typing.',
    input_schema: {
      type: 'object' as const,
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Text to type, exactly as-is.' },
      },
    },
  },
  {
    name: 'computer_key',
    description:
      'Press a named key or chord ("Enter", "Tab", "Escape", "ctrl+a", "cmd+c"). Use for submitting forms, navigating fields, etc.',
    input_schema: {
      type: 'object' as const,
      required: ['key'],
      properties: {
        key: { type: 'string' },
      },
    },
  },
  {
    name: 'computer_scroll',
    description:
      'Scroll the viewport vertically. Positive dy scrolls down, negative scrolls up. Use when the element you need is off-screen.',
    input_schema: {
      type: 'object' as const,
      required: ['dy'],
      properties: {
        dy: { type: 'integer', description: 'Pixels to scroll; positive=down.' },
      },
    },
  },
  {
    name: 'computer_navigate',
    description:
      'Go directly to a URL. Use this instead of clicking the address bar + typing + Enter — it is more reliable (no coordinate guessing) and faster. Always prefer this when you need to land on a new origin or a specific path.',
    input_schema: {
      type: 'object' as const,
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL including scheme, e.g. "https://example.com/path".',
        },
      },
    },
  },
  {
    name: 'computer_wait',
    description:
      'Pause briefly (used when a prior action is still applying). Do not use as a default between steps.',
    input_schema: {
      type: 'object' as const,
      required: ['ms'],
      properties: {
        ms: { type: 'integer', minimum: 100, maximum: 10000 },
      },
    },
  },
  {
    name: 'computer_screenshot',
    description:
      'Re-observe the page without taking any action. Use only when you need a fresh view (e.g. after a navigation you did not initiate).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'task_done',
    description:
      "Mark the task complete. Call this when the user's intent has been satisfied. `summary` is shown to the user.",
    input_schema: {
      type: 'object' as const,
      required: ['summary'],
      properties: {
        summary: {
          type: 'string',
          description: 'One or two sentences describing what was accomplished.',
        },
      },
    },
  },
  {
    name: 'task_give_up',
    description:
      'Declare the task unachievable (captcha, login wall, missing affordance, ambiguous intent). `reason` is shown to the user.',
    input_schema: {
      type: 'object' as const,
      required: ['reason'],
      properties: {
        reason: { type: 'string' },
      },
    },
  },
] as const;

import { z } from 'zod';

/**
 * Per-tool zod schemas for Claude's tool_use input blobs. One for each
 * entry in `VISION_TOOLS`; the dispatcher in `decodeToolUse` picks by
 * tool name. Using zod rather than trusting the API keeps us honest
 * about what Claude actually sent — Anthropic's JSON Schema isn't a
 * parse-guarantee, just a model hint.
 *
 * Numeric fields use `z.coerce.number()` because Claude occasionally
 * returns coordinates / dys / ms as strings ("325" instead of 325) —
 * the JSON Schema says integer but the sampler sometimes emits a
 * stringified number anyway, and a strict z.number() would reject
 * those and synthesise an unnecessary `give_up`. Coerce first, then
 * validate integer + range.
 */
const clickInputSchema = z.object({
  x: z.coerce.number().int().nonnegative(),
  y: z.coerce.number().int().nonnegative(),
  button: z.enum(['left', 'right', 'middle']).default('left'),
});
const typeInputSchema = z.object({
  text: z.string().min(0),
});
const keyInputSchema = z.object({
  key: z.string().min(1),
});
const scrollInputSchema = z.object({
  dy: z.coerce.number().int(),
});
const navigateInputSchema = z.object({
  url: z.string().url().max(2048),
});
const waitInputSchema = z.object({
  ms: z.coerce.number().int().min(100).max(10_000),
});
const screenshotInputSchema = z.object({}).passthrough();
const doneInputSchema = z.object({
  summary: z.string().min(1),
});
const giveUpInputSchema = z.object({
  reason: z.string().min(1),
});

/**
 * Decode a single Anthropic `tool_use` content block into a structured
 * `VisionAction`. Caller passes the block's `name` and `input`; this
 * dispatches on `name` and validates `input` against the matching
 * zod schema.
 *
 * Never throws — unknown tool names or malformed input become a
 * `give_up` action so the loop exits cleanly with a descriptive
 * reason instead of the whole task crashing. Anthropic occasionally
 * emits plausible-looking but wrong tool names (esp. under rate-limit
 * retries) so we treat that as a model fail, not a code bug.
 */
export function decodeToolUse(toolName: string, input: unknown): VisionAction {
  switch (toolName) {
    case 'computer_click': {
      const r = clickInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `computer_click bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'click', x: r.data.x, y: r.data.y, button: r.data.button };
    }
    case 'computer_type': {
      const r = typeInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `computer_type bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'type', text: r.data.text };
    }
    case 'computer_key': {
      const r = keyInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `computer_key bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'key', key: r.data.key };
    }
    case 'computer_scroll': {
      const r = scrollInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `computer_scroll bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'scroll', dy: r.data.dy };
    }
    case 'computer_navigate': {
      const r = navigateInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `computer_navigate bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'navigate', url: r.data.url };
    }
    case 'computer_wait': {
      const r = waitInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `computer_wait bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'wait', ms: r.data.ms };
    }
    case 'computer_screenshot': {
      screenshotInputSchema.safeParse(input); // tolerant: ignores extra keys
      return { kind: 'screenshot' };
    }
    case 'task_done': {
      const r = doneInputSchema.safeParse(input);
      if (!r.success) {
        return {
          kind: 'give_up',
          reason: `task_done bad input: ${r.error.message.slice(0, 200)}`,
        };
      }
      return { kind: 'done', summary: r.data.summary };
    }
    case 'task_give_up': {
      const r = giveUpInputSchema.safeParse(input);
      if (!r.success) {
        // Fallback: if Claude called task_give_up without a reason,
        // we still want to exit the loop — manufacture a reason rather
        // than recursing.
        return { kind: 'give_up', reason: 'Claude called task_give_up without a valid reason' };
      }
      return { kind: 'give_up', reason: r.data.reason };
    }
    default:
      return {
        kind: 'give_up',
        reason: `unknown tool_use from Claude: ${toolName}`,
      };
  }
}
