/**
 * Phase 24 fix #3 — patch orphaned server_tool_use blocks.
 *
 * Sonnet 4.6 + computer-use-2025-11-24 implicitly enables the server-
 * side `code_execution` tool. Anthropic NORMALLY emits the
 * `server_tool_use(code_execution)` block paired with a matching
 * `code_execution_tool_result` block in the same response.content. But
 * the API occasionally returns the use without its paired result block
 * — likely a sandbox-cold-start race. When we then echo response.content
 * back as the assistant message, the next messages.create rejects with:
 *
 *   "messages.1: code_execution tool use with id `srvtoolu_…` was found
 *    without a corresponding code_execution_tool_result block"
 *
 * This kills the task at iteration 2 — exactly what BOSS hit on the
 * 知乎 task tsk_xHJwbNaUEg65W9Rjm8AeT (反爬 redirect → model called
 * code_execution → orphan block → 400 → status:failed).
 *
 * We can't drop the orphan: the response carries thinking blocks whose
 * signatures are validated against the surrounding content order. So
 * the fix INSERTS a synthetic *_tool_result block right after every
 * orphaned server_tool_use, using the exact `*_tool_result_error`
 * shape Anthropic itself emits when the tool fails. Insertion preserves
 * relative ordering so thinking signatures stay valid.
 */

import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { patchOrphanServerToolUses } from './agent-loop.js';

type Block = Anthropic.Beta.BetaContentBlock;

function textBlock(text: string): Block {
  return { type: 'text', text } as unknown as Block;
}
function thinkingBlock(): Block {
  return {
    type: 'thinking',
    thinking: 'reasoning',
    signature: 'sig_abc',
  } as unknown as Block;
}
function clientToolUse(id: string, name = 'navigate'): Block {
  return {
    type: 'tool_use',
    id,
    name,
    input: {},
  } as unknown as Block;
}
function serverToolUse(id: string, name: 'code_execution' | 'web_search'): Block {
  return {
    type: 'server_tool_use',
    id,
    name,
    input: name === 'web_search' ? { query: 'q' } : { code: 'print(1)' },
  } as unknown as Block;
}
function codeExecResult(id: string): Block {
  return {
    type: 'code_execution_tool_result',
    tool_use_id: id,
    content: {
      type: 'code_execution_tool_result_error',
      error_code: 'execution_time_exceeded',
    },
  } as unknown as Block;
}
function webSearchResult(id: string): Block {
  return {
    type: 'web_search_tool_result',
    tool_use_id: id,
    content: [],
  } as unknown as Block;
}

describe('patchOrphanServerToolUses', () => {
  it('empty content stays empty, no orphans', () => {
    const out = patchOrphanServerToolUses([]);
    expect(out.patched).toEqual([]);
    expect(out.orphansFixed).toEqual([]);
  });

  it('plain text + thinking is unchanged', () => {
    const input = [thinkingBlock(), textBlock('hi')];
    const out = patchOrphanServerToolUses(input);
    expect(out.patched).toEqual(input);
    expect(out.orphansFixed).toEqual([]);
  });

  it('paired server_tool_use + tool_result unchanged', () => {
    const input = [
      serverToolUse('srvtoolu_1', 'code_execution'),
      codeExecResult('srvtoolu_1'),
      textBlock('done'),
    ];
    const out = patchOrphanServerToolUses(input);
    expect(out.patched).toEqual(input);
    expect(out.orphansFixed).toEqual([]);
  });

  it('orphaned code_execution server_tool_use gets synthetic error result inserted right after', () => {
    const orphan = serverToolUse('srvtoolu_orphan', 'code_execution');
    const input = [thinkingBlock(), orphan, textBlock('continuing')];
    const out = patchOrphanServerToolUses(input);

    expect(out.orphansFixed).toEqual([
      { name: 'code_execution', id: 'srvtoolu_orphan' },
    ]);
    expect(out.patched).toHaveLength(4);
    expect(out.patched[0]).toBe(input[0]); // thinking preserved by reference
    expect(out.patched[1]).toBe(orphan); // orphan kept
    const synth = out.patched[2] as {
      type: string;
      tool_use_id: string;
      content: { type: string; error_code: string };
    };
    expect(synth.type).toBe('code_execution_tool_result');
    expect(synth.tool_use_id).toBe('srvtoolu_orphan');
    expect(synth.content.type).toBe('code_execution_tool_result_error');
    expect(synth.content.error_code).toBe('unavailable');
    expect(out.patched[3]).toBe(input[2]); // trailing text preserved
  });

  it('orphaned web_search server_tool_use gets synthetic error result inserted right after', () => {
    const orphan = serverToolUse('srvtoolu_ws', 'web_search');
    const input = [orphan];
    const out = patchOrphanServerToolUses(input);

    expect(out.orphansFixed).toEqual([{ name: 'web_search', id: 'srvtoolu_ws' }]);
    expect(out.patched).toHaveLength(2);
    const synth = out.patched[1] as {
      type: string;
      tool_use_id: string;
      content: { type: string; error_code: string };
    };
    expect(synth.type).toBe('web_search_tool_result');
    expect(synth.tool_use_id).toBe('srvtoolu_ws');
    expect(synth.content.type).toBe('web_search_tool_result_error');
    expect(synth.content.error_code).toBe('unavailable');
  });

  it('mixed paired + orphan: only orphan patched, paired left alone', () => {
    const ok = serverToolUse('srvtoolu_ok', 'code_execution');
    const orphan = serverToolUse('srvtoolu_bad', 'code_execution');
    const input = [
      ok,
      codeExecResult('srvtoolu_ok'),
      textBlock('between'),
      orphan,
    ];
    const out = patchOrphanServerToolUses(input);

    expect(out.orphansFixed).toEqual([
      { name: 'code_execution', id: 'srvtoolu_bad' },
    ]);
    expect(out.patched).toHaveLength(5);
    expect(out.patched[0]).toBe(ok);
    expect(out.patched[1]).toBe(input[1]); // existing result preserved
    expect(out.patched[2]).toBe(input[2]); // text preserved
    expect(out.patched[3]).toBe(orphan);
    expect((out.patched[4] as { tool_use_id: string }).tool_use_id).toBe(
      'srvtoolu_bad',
    );
  });

  it('client tool_use blocks ignored (those round-trip via user tool_result, not server)', () => {
    const input = [clientToolUse('toolu_1', 'navigate')];
    const out = patchOrphanServerToolUses(input);
    expect(out.patched).toEqual(input);
    expect(out.orphansFixed).toEqual([]);
  });

  it('multiple orphans of different types each get their own synthetic result', () => {
    const a = serverToolUse('srvtoolu_a', 'code_execution');
    const b = serverToolUse('srvtoolu_b', 'web_search');
    const input = [a, b];
    const out = patchOrphanServerToolUses(input);

    expect(out.orphansFixed.length).toBe(2);
    expect(out.patched).toHaveLength(4);
    expect((out.patched[1] as { type: string }).type).toBe('code_execution_tool_result');
    expect((out.patched[3] as { type: string }).type).toBe('web_search_tool_result');
  });

  it('does not mutate the input array', () => {
    const input = [serverToolUse('srvtoolu_x', 'code_execution')];
    const before = input.length;
    patchOrphanServerToolUses(input);
    expect(input.length).toBe(before);
    expect(input[0]?.type).toBe('server_tool_use');
  });
});
