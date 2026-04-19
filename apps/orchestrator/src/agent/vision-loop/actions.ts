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

/**
 * Decode a single Anthropic tool_use block into a `VisionAction`. TODO
 * Phase A: implement with zod schemas per tool and a dispatch on
 * `block.name`. Rejects unknown tool names with a parse error so the
 * loop treats them as `give_up` rather than silently dropping them.
 */
export function decodeToolUse(_toolName: string, _input: unknown): VisionAction {
  throw new Error('vision-loop/actions.decodeToolUse: not implemented (Phase A skeleton)');
}
