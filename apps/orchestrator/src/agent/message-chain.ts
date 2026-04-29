/**
 * MessageChainGuard — defensive validator for Anthropic message arrays.
 *
 * Anthropic's API requires that every assistant `tool_use` block be
 * paired with a `tool_result` block of the matching `tool_use_id` in
 * the immediately following user message. Missing pairs → 400.
 *
 * The vision-loop's `buildMessages()` already constructs the array
 * correctly (see commander.ts:728-737). This module is belt-and-
 * suspenders for the supercar path and any future call site — if a
 * malformed array reaches `validate()` we patch it in place with a
 * synthetic tool_result rather than 400 the user.
 *
 * NOT a fix for an observed production bug — the spec named this as
 * a problem but the codebase already handles it correctly. We keep
 * the guard so future regressions surface as "agent saw a generic
 * placeholder result" instead of "the whole task crashed with a
 * 400."
 */

import type Anthropic from '@anthropic-ai/sdk';

const PLACEHOLDER_TEXT =
  '[执行结果未返回，可能因为超时或系统错误。请基于当前已知信息继续。]';

/**
 * Walk `messages` and ensure every `tool_use` block has a matching
 * `tool_result` in the next user message. Mutates a deep-ish copy and
 * returns it; the input array is not modified.
 *
 * Behaviour:
 * - Unpaired tool_use at end of array → append a new user message
 *   carrying placeholder tool_results.
 * - Tool_use followed by user message that's missing some ids →
 *   append the missing tool_results to that user message.
 * - Existing valid pairs are passed through unchanged.
 *
 * Returns the (possibly extended) array. Always safe to call;
 * idempotent on already-valid arrays.
 */
export function validateMessageChain(
  messages: readonly Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = messages.map((m) => ({
    ...m,
    content: Array.isArray(m.content) ? [...m.content] : m.content,
  }));

  for (let i = 0; i < out.length; i++) {
    const msg = out[i];
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlockParam => isToolUseBlock(b),
    );
    if (toolUses.length === 0) continue;

    const next = out[i + 1];
    if (!next || next.role !== 'user') {
      const synthResults: Anthropic.ToolResultBlockParam[] = toolUses.map(
        (tu) => synthesisedToolResult(tu.id),
      );
      out.splice(i + 1, 0, { role: 'user', content: synthResults });
      continue;
    }

    if (!Array.isArray(next.content)) {
      next.content = [next.content as unknown as Anthropic.TextBlockParam];
    }
    const presentIds = new Set(
      (next.content as readonly unknown[])
        .filter(isToolResultBlock)
        .map((b) => b.tool_use_id),
    );
    const missing = toolUses.filter((tu) => !presentIds.has(tu.id));
    if (missing.length === 0) continue;

    const additions = missing.map((tu) => synthesisedToolResult(tu.id));
    (next.content as Anthropic.ToolResultBlockParam[]).push(...additions);
  }

  return out;
}

function isToolUseBlock(block: unknown): block is Anthropic.ToolUseBlockParam {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use' &&
    typeof (block as { id?: unknown }).id === 'string'
  );
}

function isToolResultBlock(
  block: unknown,
): block is Anthropic.ToolResultBlockParam {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_result' &&
    typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string'
  );
}

function synthesisedToolResult(toolUseId: string): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: PLACEHOLDER_TEXT,
    is_error: true,
  };
}
