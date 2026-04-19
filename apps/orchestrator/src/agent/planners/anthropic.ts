import Anthropic from '@anthropic-ai/sdk';
import {
  type ResilientSelector,
  newExternalId,
  resilientSelectorSchema,
} from '@holaday/shared-types';
import { z } from 'zod';
import { logger } from '../../config/logger.js';
import { type LlmCallRecorder, NoopLlmCallRecorder } from '../llm-call-recorder.js';
import type { Planner, PlannerContext, SelfHealContext } from '../planner.js';
import type { PlannedStep } from '../task-controller.js';

/**
 * Commander-layer planner. Asks Claude Opus 4.7 to break the user's intent
 * down into a sequence of browser actions, forced through a tool-use
 * schema so the output is always structured.
 *
 * Design notes:
 * - `tool_choice` forces the `emit_plan` tool, so the model can't emit
 *   free-form prose. This is **incompatible with `thinking`** on Opus 4.7
 *   (API returns 400 "Thinking may not be enabled when tool_choice forces
 *   tool use."), so we omit the thinking block. The tool schema itself
 *   constrains the output shape.
 * - System prompt is stable across requests → cache_control ephemeral for
 *   prefix-cache hits on the skills catalogue.
 * - `model` / `maxTokens` are injected so tests can pin them.
 */

export const PLAN_TOOL_NAME = 'emit_plan';
const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 16_000;

const planStepSchema = z.object({
  kind: z.enum(['goto', 'click', 'type', 'key', 'extract', 'wait', 'eval', 'screenshot']),
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
  /**
   * LLM billing / observability sink. Default is a no-op; production
   * orchestrator boot wires `DrizzleLlmCallRecorder` so every plan call
   * lands a row in `llm_calls`.
   */
  recorder?: LlmCallRecorder;
}

export class AnthropicPlanner implements Planner {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly recorder: LlmCallRecorder;

  constructor(opts: AnthropicPlannerOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    // Env override primarily for ops / bake-offs (Sonnet vs Opus latency &
    // cost); production default stays claude-opus-4-7.
    this.model = opts.model ?? process.env.COMMANDER_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.recorder = opts.recorder ?? new NoopLlmCallRecorder();
  }

  async plan(ctx: PlannerContext): Promise<PlannedStep[]> {
    const systemBlocks = buildSystemBlocks(ctx);
    const userContent = buildUserContent(ctx);

    const startedAt = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // NOTE: `thinking` is intentionally omitted — Anthropic rejects
      // `thinking: adaptive` together with `tool_choice` forced on a
      // specific tool. The tool schema is what we rely on for structure.
      system: systemBlocks,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: PLAN_TOOL_NAME },
      messages: [{ role: 'user', content: userContent }],
    });
    const elapsedMs = Date.now() - startedAt;

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === PLAN_TOOL_NAME,
    );
    if (!toolUse) {
      if (ctx.userId) {
        // Record the burned tokens even on failure so cost accounting stays honest.
        await this.recorder.record({
          userExternalId: ctx.userId,
          provider: 'anthropic',
          model: response.model,
          purpose: 'commander.plan',
          ...usage,
          latencyMs: elapsedMs,
          status: 'error',
          errorMessage: `missing ${PLAN_TOOL_NAME} tool_use block`,
        });
      }
      throw new PlannerError(
        'NO_TOOL_USE',
        `planner response missing ${PLAN_TOOL_NAME} tool_use block`,
      );
    }

    const parsed = planSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      if (ctx.userId) {
        await this.recorder.record({
          userExternalId: ctx.userId,
          provider: 'anthropic',
          model: response.model,
          purpose: 'commander.plan',
          ...usage,
          latencyMs: elapsedMs,
          status: 'error',
          errorMessage: parsed.error.message.slice(0, 512),
        });
      }
      throw new PlannerError('INVALID_PLAN', parsed.error.message);
    }

    logger.info(
      {
        component: 'commander',
        model: this.model,
        elapsedMs,
        planSize: parsed.data.steps.length,
        usage,
      },
      'commander plan',
    );

    if (ctx.userId) {
      await this.recorder.record({
        userExternalId: ctx.userId,
        provider: 'anthropic',
        model: response.model,
        purpose: 'commander.plan',
        ...usage,
        latencyMs: elapsedMs,
        status: 'ok',
        requestMeta: { planSize: parsed.data.steps.length },
      });
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

  /**
   * SELECTOR_NOT_FOUND self-heal: send the failed step + driver
   * diagnostic (URL, title, per-strategy failure reasons, viewport
   * screenshot) back to Claude and ask for a single replacement
   * ResilientSelector. The WS server plugs the result back into the
   * in-memory plan before the controller's built-in retry re-dispatches
   * the step.
   *
   * Never throws. If the API call fails, the schema parse rejects, or
   * the model declines, returns null and the caller falls through to
   * the normal retries-exhausted path.
   */
  async healSelector(ctx: SelfHealContext): Promise<ResilientSelector | null> {
    if (!ctx.originalStep.selector) return null;
    const startedAt = Date.now();
    try {
      const userBlocks: Anthropic.ContentBlockParam[] = [];
      if (ctx.diagnostic.screenshot) {
        userBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: ctx.diagnostic.screenshot,
          },
        });
      }
      userBlocks.push({
        type: 'text',
        text: buildHealPrompt(ctx),
      });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2_000,
        system: HEAL_SYSTEM_PROMPT,
        tools: [HEAL_TOOL],
        tool_choice: { type: 'tool', name: HEAL_TOOL_NAME },
        messages: [{ role: 'user', content: userBlocks }],
      });
      const elapsedMs = Date.now() - startedAt;
      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      };

      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === HEAL_TOOL_NAME,
      );
      if (!toolUse) {
        if (ctx.userId) {
          await this.recorder.record({
            userExternalId: ctx.userId,
            provider: 'anthropic',
            model: response.model,
            purpose: 'commander.heal',
            ...usage,
            latencyMs: elapsedMs,
            status: 'error',
            errorMessage: `missing ${HEAL_TOOL_NAME} tool_use block`,
          });
        }
        return null;
      }

      const parsed = resilientSelectorSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        if (ctx.userId) {
          await this.recorder.record({
            userExternalId: ctx.userId,
            provider: 'anthropic',
            model: response.model,
            purpose: 'commander.heal',
            ...usage,
            latencyMs: elapsedMs,
            status: 'error',
            errorMessage: parsed.error.message.slice(0, 512),
          });
        }
        return null;
      }

      logger.info(
        {
          component: 'commander.heal',
          model: this.model,
          elapsedMs,
          originalStrategiesCount: ctx.originalStep.selector.strategies.length,
          healedStrategiesCount: parsed.data.strategies.length,
          usage,
        },
        'selector self-heal',
      );

      if (ctx.userId) {
        await this.recorder.record({
          userExternalId: ctx.userId,
          provider: 'anthropic',
          model: response.model,
          purpose: 'commander.heal',
          ...usage,
          latencyMs: elapsedMs,
          status: 'ok',
          requestMeta: {
            originalStrategiesCount: ctx.originalStep.selector.strategies.length,
            healedStrategiesCount: parsed.data.strategies.length,
          },
        });
      }

      return parsed.data;
    } catch (err) {
      // Anthropic 4xx/5xx, network, SDK error — any throw → decline.
      // Caller falls back to normal retry-exhausted path; user sees
      // retries_exhausted paused state, same as pre-self-heal world.
      logger.warn({ err, userId: ctx.userId }, 'selector self-heal declined (upstream error)');
      return null;
    }
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
- Use payload.url for goto steps; payload.text for type steps;
  payload.key for key steps (e.g. "Enter", "Escape").
- Never emit credential-like payloads; the user is already signed in.

Selector rules — READ CAREFULLY; these are the most common cause of
plan failure in dogfood.

(1) Prioritize by semantic stability. The FIRST strategy in a
    ResilientSelector must be the highest-available item from this
    list; later fallbacks walk down it:
      a. role+name          (e.g. {kind:"role", role:"button",
                              name:"Submit"}) — survives CSS rewrites
                              because accessibility stays put.
      b. text=exact         for elements whose visible text is stable
                              and unique on the page.
      c. testid             (data-testid / data-qa / data-cy) when
                              the site exposes it.
      d. id                 (#some-id) — fine when present, but many
                              modern sites omit ids on dynamic cards.
      e. css class          (.some-class) — LAST RESORT. Class names
                              are the most rewritten part of any
                              modern bundle; prefer role/text unless
                              there truly is no semantic handle.
      f. xpath              — last-ditch only; hard to self-heal.

(2) Emit AT LEAST 3 fallback strategies per selector, ordered from
    most to least semantic. A single CSS class is a guaranteed
    future bug.

(3) Before any \`extract\` step, emit a \`wait\` step targeting the
    same element (or its container). A \`goto\` is NOT enough — SPAs
    keep lazy-rendering content for several seconds after
    DOMContentLoaded. Without the wait, extract will race the
    render and miss.

(4) Prefer \`key\` with key="Enter" over clicking a submit button on
    search forms. Submit buttons (Baidu #su, Douyin search glass,
    Xueqiu header search, etc.) are frequently detached briefly
    during hydration and are the least reliable element on the
    page. A keyboard submit is human-equivalent and bypasses this
    whole failure mode.

(5) If you are not confident about the target site's DOM, emit a
    short diagnostic prefix first:
      goto <url> → wait (generous timeout, ~10s) → screenshot
    The executor captures the page and on a SELECTOR_NOT_FOUND
    failure the commander gets one self-heal turn to rewrite the
    selector from a real DOM snapshot. Short-circuiting straight
    to a click/extract when the DOM is unknown wastes that
    self-heal budget on a guess.

Site-specific context (Phase 0 first-launch sites — fold into your
plans when the intent points at one of these):

  * \`creator.douyin.com\` (抖音创作者中心) — single-page app.
    The whole UI lives under \`/creator/...\`; navigation between
    panels is left-side nav clicks (NOT goto-to-new-URL), and the
    URL hash often updates without a full page navigation. Always
    \`wait\` ~2-5s after a left-nav click for the panel content to
    re-render before extracting. The dashboard summary
    (粉丝/播放/点赞/评论 数据概览) lives under "数据" in the left
    nav. CSS class names on Douyin are hashed and rotate per-deploy,
    so role+name selectors and Chinese-text anchors (\`text="数据"\`,
    \`text="粉丝数"\`) outlast id/class hooks; use them.

  * \`compass.jinritemai.com\` (抖音电商罗盘) — also SPA. Tabs at
    the top (商品 / 直播 / 流量); time-window picker top-right.
    Numbers are rendered into Canvas charts AND DOM tables — only
    extract from DOM tables, never the Canvas pixels.

  * \`xueqiu.com\` (雪球) — multi-page; portfolio lives at
    \`/p/<userid>\`. Uses real semantic h1/h2 headings — role-based
    selectors work well here.

The user's occupation and available Skills (if any) are listed below.`;

function buildSystemBlocks(ctx: PlannerContext): Anthropic.TextBlockParam[] {
  const lines: string[] = [];
  if (ctx.occupation) lines.push(`User occupation tag: ${ctx.occupation}`);
  if (ctx.skills?.length) {
    lines.push('');
    lines.push('Available Skills (slug — one-line description). Reference by slug only;');
    lines.push('full SKILL.md is fetched on demand via SkillLoader, not sent here.');
    for (const skill of ctx.skills) {
      lines.push(`- ${skill.slug} — ${skill.description}`);
    }
  }
  return [
    {
      type: 'text',
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
    ...(lines.length > 0
      ? [
          {
            type: 'text' as const,
            text: lines.join('\n'),
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
              enum: ['goto', 'click', 'type', 'key', 'extract', 'wait', 'eval', 'screenshot'],
              description:
                'The browser action to perform. `key` presses a keyboard key (payload.key, e.g. "Enter") on the focused element or the resolved selector — use this to submit forms where clicking the button is unreliable.',
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

// ---------- Self-heal tool & prompt ----------

export const HEAL_TOOL_NAME = 'emit_selector';

const HEAL_SYSTEM_PROMPT = `You are the self-heal layer for a browser agent. The executor tried a
ResilientSelector and every fallback strategy failed. You will be shown
a viewport screenshot of the page at the moment of failure, the current
URL and <title>, the selector description the original plan used, the
action verb (click / type / extract / wait / key), and the specific
strategies that were tried with their failure reasons.

Your job: emit ONE replacement ResilientSelector via the
\`${HEAL_TOOL_NAME}\` tool, picking strategies that match what the
screenshot actually shows. Do NOT repeat any strategy that the original
plan already tried — those are listed for you and they don't work.

Priorities (same as the main planner):
  role+name  →  text=exact  →  testid  →  id  →  css class  →  xpath

Rules:
- Provide AT LEAST 3 strategies, most semantic first.
- If the screenshot shows a captcha, login wall, empty state, or the
  target element is clearly not present, emit strategies anyway but
  make the description mention the obstacle — the caller will surface
  it in the final error message.
- Keep the description short and specific ("Baidu result headline h3
  link", not "the thing we want").`;

const HEAL_TOOL: Anthropic.Tool = {
  name: HEAL_TOOL_NAME,
  description: 'Emit a replacement ResilientSelector for a failed step.',
  input_schema: {
    type: 'object',
    required: ['description', 'strategies'],
    properties: {
      description: { type: 'string' },
      strategies: {
        type: 'array',
        minItems: 3,
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
};

function buildHealPrompt(ctx: SelfHealContext): string {
  const step = ctx.originalStep;
  const lines: string[] = [];
  if (ctx.intent) lines.push(`User intent: ${ctx.intent}`);
  lines.push(`Failed action verb: ${step.kind}`);
  lines.push(`Original selector description: "${step.selector?.description ?? '(none)'}"`);
  lines.push(`Current URL: ${ctx.diagnostic.url || '(unknown)'}`);
  lines.push(`Current page title: ${ctx.diagnostic.title || '(unknown)'}`);
  lines.push('');
  lines.push('Strategies already tried (all failed — do NOT re-emit these):');
  if (ctx.diagnostic.strategies.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const s of ctx.diagnostic.strategies) {
      lines.push(`  - ${s.kind} ${s.selector}  →  ${s.reason}`);
    }
  }
  lines.push('');
  lines.push(
    `The attached screenshot is the viewport at the moment of failure. Read the DOM structure from the pixels and emit a new ResilientSelector via ${HEAL_TOOL_NAME}.`,
  );
  return lines.join('\n');
}
