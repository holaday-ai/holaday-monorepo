import Anthropic from '@anthropic-ai/sdk';
import {
  type ResilientSelector,
  newExternalId,
  resilientSelectorSchema,
} from '@holaday/shared-types';
import { z } from 'zod';
import type { Planner, PlannerContext } from '../planner.js';
import type { PlannedStep } from '../task-controller.js';

/**
 * Commander-layer planner. Asks Claude Opus 4.7 to break the user's intent
 * down into a sequence of browser actions, forced through a tool-use
 * schema so the output is always structured.
 *
 * Design notes:
 * - Adaptive thinking on Opus 4.7 (no budget_tokens, no temperature/top_p/top_k).
 * - System prompt is stable across requests → cache_control ephemeral for
 *   prefix-cache hits on the skills catalogue.
 * - Uses tool_choice to force the `emit_plan` tool, so the model can't
 *   emit free-form prose.
 * - `model` / `maxTokens` are injected so tests can pin them.
 */

export const PLAN_TOOL_NAME = 'emit_plan';
const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 16_000;

const planStepSchema = z.object({
  kind: z.enum(['goto', 'click', 'type', 'extract', 'wait', 'eval', 'screenshot']),
  selector: resilientSelectorSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  requiresConfirm: z.boolean().optional(),
});

const planSchema = z.object({
  steps: z.array(planStepSchema).min(1).max(50),
});

export interface AnthropicPlannerOptions {
  client?: Anthropic;
  model?: string;
  maxTokens?: number;
}

export class AnthropicPlanner implements Planner {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicPlannerOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async plan(ctx: PlannerContext): Promise<PlannedStep[]> {
    const systemBlocks = buildSystemBlocks(ctx);
    const userContent = buildUserContent(ctx);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      system: systemBlocks,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: PLAN_TOOL_NAME },
      messages: [{ role: 'user', content: userContent }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === PLAN_TOOL_NAME,
    );
    if (!toolUse) {
      throw new PlannerError(
        'NO_TOOL_USE',
        `planner response missing ${PLAN_TOOL_NAME} tool_use block`,
      );
    }

    const parsed = planSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new PlannerError('INVALID_PLAN', parsed.error.message);
    }

    return parsed.data.steps.map((step) => ({
      id: newExternalId('taskStep'),
      kind: step.kind,
      selector: step.selector as ResilientSelector | undefined,
      payload: step.payload,
      risk: step.risk,
      ...(step.requiresConfirm !== undefined ? { requiresConfirm: step.requiresConfirm } : {}),
    }));
  }
}

export class PlannerError extends Error {
  constructor(
    public readonly code: 'NO_TOOL_USE' | 'INVALID_PLAN',
    message: string,
  ) {
    super(message);
    this.name = 'PlannerError';
  }
}

// ---------- Prompts & tool schema ----------

const SYSTEM_PROMPT = `You are the commander layer of HOLA DAY, a browser agent that drives a user's
own Chrome session to complete real work tasks (e-commerce operations,
customer service, research, social media, etc.). You decompose a user
intent into a short, explicit plan of browser actions that a downstream
executor will dispatch one step at a time.

Output rules:
- Always call the tool \`${PLAN_TOOL_NAME}\` exactly once.
- Keep plans short and unambiguous. Prefer 5–15 steps for Phase 0.
- Mark any step that can affect money, delete data, send messages,
  change account settings, or push content live as risk="high".
  Anything the user could want to review before it happens is high risk.
- Selector strategies, when provided, list stable-first candidates
  (role > text > testid > css > xpath). Include 2–3 fallbacks where
  possible; the executor self-heals when all fail.
- Use payload.url for goto steps; payload.text for type steps.
- Never emit credential-like payloads; the user is already signed in.

The user's occupation and available Skills (if any) are listed below.`;

function buildSystemBlocks(ctx: PlannerContext): Anthropic.TextBlockParam[] {
  const catalogue: string[] = [];
  if (ctx.occupation) catalogue.push(`User occupation tag: ${ctx.occupation}`);
  if (ctx.skillSlugs?.length) {
    catalogue.push(`Available skill slugs: ${ctx.skillSlugs.join(', ')}`);
  }
  return [
    {
      type: 'text',
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
    ...(catalogue.length > 0
      ? [
          {
            type: 'text' as const,
            text: catalogue.join('\n'),
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : []),
  ];
}

function buildUserContent(ctx: PlannerContext): string {
  return ctx.intent.trim();
}

const PLAN_TOOL: Anthropic.Tool = {
  name: PLAN_TOOL_NAME,
  description: 'Emit the ordered plan of browser actions for the user intent.',
  input_schema: {
    type: 'object',
    required: ['steps'],
    properties: {
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          required: ['kind', 'risk'],
          properties: {
            kind: {
              type: 'string',
              enum: ['goto', 'click', 'type', 'extract', 'wait', 'eval', 'screenshot'],
              description: 'The browser action to perform.',
            },
            selector: {
              type: 'object',
              description:
                'ResilientSelector with ordered fallback strategies. Omit for kinds that do not target an element (goto, wait).',
              required: ['description', 'strategies'],
              properties: {
                description: { type: 'string' },
                strategies: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['kind'],
                    properties: {
                      kind: {
                        type: 'string',
                        enum: ['role', 'text', 'testid', 'css', 'xpath', 'label', 'placeholder'],
                      },
                      value: { type: 'string' },
                      role: { type: 'string' },
                      name: { type: 'string' },
                      attr: { type: 'string' },
                      exact: { type: 'boolean' },
                    },
                  },
                },
                scope: {
                  type: 'object',
                  properties: {
                    within: { type: 'string' },
                    nth: { type: 'integer', minimum: 0 },
                    timeoutMs: { type: 'integer', minimum: 100 },
                  },
                },
                selfHeal: { type: 'boolean' },
              },
            },
            payload: {
              type: 'object',
              description:
                'Free-form parameters for the step, e.g. {url} for goto, {text} for type.',
              additionalProperties: true,
            },
            risk: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
            },
            requiresConfirm: {
              type: 'boolean',
              description:
                'When true, the executor must pause for user confirm even if the action succeeds.',
            },
          },
        },
      },
    },
  },
};
