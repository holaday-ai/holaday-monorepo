import type { MessagesAdapter, NeutralMessagesRequest } from '../messages-adapter.js';
import { supportsQwenThinkingControl } from '../messages-adapter.js';
import type { ModelRole } from './model-roles.js';

/**
 * REBUILD-2 review #1 — the thinking budget a role's Qwen request carries (gateway on only).
 *
 * DashScope's Anthropic-compatible endpoint thinks by default and counts thinking tokens inside
 * `max_tokens` (REBUILD-1 D §3.1 / §3.4): a request that sets nothing can spend its whole
 * `max_tokens` thinking and come back without an answer. So every Qwen request states it:
 *
 *   - small-budget roles (short, structured output) send `thinking: disabled`;
 *   - roles that benefit from thinking send `enabled` with `budget_tokens`, and the wire
 *     `max_tokens` becomes the caller's `maxTokens` (the answer room it asked for) plus the
 *     budget, so thinking can never eat the answer.
 *
 * A caller's explicit `disabled` always wins. A caller's explicit `enabled` (no budget) gets the
 * role budget (or the default budget on a small-budget role). A forced tool call is always
 * `disabled` (DashScope may reject forced tools in thinking mode; it never needs the pass).
 */
export type RoleThinkingPolicy =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'enabled'; readonly budgetTokens: number };

/** Below this answer room a thinking role does not think: the call is a small-budget call. */
export const MIN_ANSWER_TOKENS_FOR_THINKING = 1_024;

/** Anthropic's floor for `budget_tokens`; DashScope accepts it (probed 2026-11-11). */
export const MIN_THINKING_BUDGET_TOKENS = 1_024;

/** Budget for an explicit `enabled` on a role whose policy is `disabled`. */
export const DEFAULT_THINKING_BUDGET_TOKENS = 2_048;

/**
 * Wire `max_tokens` never exceeds this (the smallest output limit of the Qwen families we route
 * to, qwen3.x max/plus/flash, is 32k). The budget shrinks first; the answer room is kept.
 */
export const MAX_WIRE_OUTPUT_TOKENS = 32_768;

export const ROLE_THINKING: Readonly<Record<ModelRole, RoleThinkingPolicy>> = Object.freeze({
  // Thinking roles: multi-step browser decisions, long answers, answer verification.
  brain: { mode: 'enabled', budgetTokens: 2_048 },
  generate: { mode: 'enabled', budgetTokens: 2_048 },
  verifier: { mode: 'enabled', budgetTokens: 2_048 },
  // Small-budget roles: short structured output; thinking only adds latency and eats max_tokens.
  plan: { mode: 'disabled' },
  judge: { mode: 'disabled' },
  suggestions: { mode: 'disabled' },
  video_edit_planner: { mode: 'disabled' },
  vision: { mode: 'disabled' }, // media QA verdicts (forced tool, 512–1536 tokens)
  // Responses-channel roles: the messages wrapper never sees them; listed for completeness.
  scrape: { mode: 'disabled' },
  search: { mode: 'disabled' },
});

/** (2) The thinking switch and wire budget a Qwen request carries for this role. */
export function withRoleThinking(
  request: NeutralMessagesRequest,
  metadata: MessagesAdapter['metadata'],
  role: ModelRole,
): NeutralMessagesRequest {
  if (metadata.provider !== 'alibaba-model-studio') return request;
  // Families we have not validated never get the parameter (the adapter strips it anyway).
  if (!supportsQwenThinkingControl(metadata.model)) return request;
  if (request.thinking?.type === 'disabled') return request;
  const forcedTool = request.toolChoice?.type === 'any' || request.toolChoice?.type === 'tool';
  if (forcedTool) return { ...request, thinking: { type: 'disabled' } };

  const policy = ROLE_THINKING[role];
  const callerEnabled = request.thinking?.type === 'enabled';
  if (!callerEnabled) {
    if (policy.mode === 'disabled' || request.maxTokens < MIN_ANSWER_TOKENS_FOR_THINKING) {
      return { ...request, thinking: { type: 'disabled' } };
    }
  }
  const wanted =
    request.thinking?.type === 'enabled' && request.thinking.budgetTokens !== undefined
      ? request.thinking.budgetTokens
      : policy.mode === 'enabled'
        ? policy.budgetTokens
        : DEFAULT_THINKING_BUDGET_TOKENS;
  const budgetTokens = Math.min(wanted, MAX_WIRE_OUTPUT_TOKENS - request.maxTokens);
  // No room left for a meaningful budget: answer without thinking rather than starve it.
  if (budgetTokens < MIN_THINKING_BUDGET_TOKENS) {
    return { ...request, thinking: { type: 'disabled' } };
  }
  return {
    ...request,
    maxTokens: request.maxTokens + budgetTokens,
    thinking: { type: 'enabled', budgetTokens },
  };
}
