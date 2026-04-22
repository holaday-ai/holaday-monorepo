import { describe, expect, it } from 'vitest';
import { VISION_TOOLS, decodeToolUse } from './actions.js';

/**
 * Unit tests for the Anthropic tool_use decoder.
 *
 * These never hit the network — we just hand `decodeToolUse` the
 * (name, input) pair the SDK would give us and check that every
 * supported tool round-trips and every malformed / unknown shape
 * falls back to a `give_up` action (the contract: "never throw").
 */

describe('decodeToolUse', () => {
  it('decodes computer_click with default button', () => {
    const a = decodeToolUse('computer_click', { x: 100, y: 200 });
    expect(a).toEqual({ kind: 'click', x: 100, y: 200, button: 'left' });
  });

  it('decodes computer_click with explicit button', () => {
    const a = decodeToolUse('computer_click', { x: 10, y: 20, button: 'right' });
    expect(a).toEqual({ kind: 'click', x: 10, y: 20, button: 'right' });
  });

  it('decodes computer_type', () => {
    const a = decodeToolUse('computer_type', { text: 'hello world' });
    expect(a).toEqual({ kind: 'type', text: 'hello world' });
  });

  it('decodes computer_key (named key)', () => {
    expect(decodeToolUse('computer_key', { key: 'Enter' })).toEqual({
      kind: 'key',
      key: 'Enter',
    });
  });

  it('decodes computer_key (chord)', () => {
    expect(decodeToolUse('computer_key', { key: 'ctrl+a' })).toEqual({
      kind: 'key',
      key: 'ctrl+a',
    });
  });

  it('decodes computer_scroll (positive = down)', () => {
    expect(decodeToolUse('computer_scroll', { dy: 400 })).toEqual({ kind: 'scroll', dy: 400 });
  });

  it('decodes computer_scroll (negative = up)', () => {
    expect(decodeToolUse('computer_scroll', { dy: -250 })).toEqual({ kind: 'scroll', dy: -250 });
  });

  it('decodes computer_wait', () => {
    expect(decodeToolUse('computer_wait', { ms: 1500 })).toEqual({ kind: 'wait', ms: 1500 });
  });

  it('decodes computer_screenshot (empty input tolerated)', () => {
    expect(decodeToolUse('computer_screenshot', {})).toEqual({ kind: 'screenshot' });
    expect(decodeToolUse('computer_screenshot', { junk: 1 })).toEqual({ kind: 'screenshot' });
  });

  it('decodes task_done', () => {
    expect(decodeToolUse('task_done', { summary: 'Posted the comment.' })).toEqual({
      kind: 'done',
      summary: 'Posted the comment.',
    });
  });

  it('decodes task_give_up', () => {
    expect(decodeToolUse('task_give_up', { reason: 'login wall' })).toEqual({
      kind: 'give_up',
      reason: 'login wall',
    });
  });

  it('unknown tool names fall back to give_up with a diagnostic reason', () => {
    const a = decodeToolUse('bogus_tool', { x: 1 });
    expect(a.kind).toBe('give_up');
    if (a.kind === 'give_up') {
      expect(a.reason).toMatch(/unknown tool_use.*bogus_tool/);
    }
  });

  it('missing required field (computer_click without y) falls back to give_up', () => {
    const a = decodeToolUse('computer_click', { x: 100 });
    expect(a.kind).toBe('give_up');
    if (a.kind === 'give_up') {
      expect(a.reason).toMatch(/computer_click bad input/);
    }
  });

  it('coerces string coordinates to numbers (Claude sometimes emits "325" not 325)', () => {
    const click = decodeToolUse('computer_click', { x: '325', y: '400' });
    expect(click).toEqual({ kind: 'click', x: 325, y: 400, button: 'left' });
    const scroll = decodeToolUse('computer_scroll', { dy: '-200' });
    expect(scroll).toEqual({ kind: 'scroll', dy: -200 });
    const wait = decodeToolUse('computer_wait', { ms: '1500' });
    expect(wait).toEqual({ kind: 'wait', ms: 1500 });
  });

  it('wrong type (negative wait) falls back to give_up', () => {
    const a = decodeToolUse('computer_wait', { ms: 50 });
    expect(a.kind).toBe('give_up');
    if (a.kind === 'give_up') {
      expect(a.reason).toMatch(/computer_wait bad input/);
    }
  });

  it('task_give_up without a reason still exits the loop (fabricates a reason)', () => {
    const a = decodeToolUse('task_give_up', {});
    expect(a.kind).toBe('give_up');
    if (a.kind === 'give_up') {
      // Text is Chinese now ("未提供原因"); keep this test forgiving so
      // a future wording tweak doesn't force a test update — all we
      // care about is non-empty fallback text.
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });

  it('task_done without a summary emits a placeholder instead of failing the task', () => {
    // Reason: Claude occasionally calls task_done with {} — pre-fix
    // that became a give_up with `summary Required` and failed the
    // whole task. The fix must let the loop exit with a placeholder.
    const a = decodeToolUse('task_done', {});
    expect(a.kind).toBe('done');
    if (a.kind === 'done') {
      expect(a.summary.length).toBeGreaterThan(0);
    }
  });

  it('computer_wait_for_human decodes with the reason text', () => {
    const a = decodeToolUse('computer_wait_for_human', { reason: '需要 Cloudflare 验证' });
    expect(a.kind).toBe('wait_for_human');
    if (a.kind === 'wait_for_human') expect(a.reason).toBe('需要 Cloudflare 验证');
  });

  it('computer_wait_for_human with no reason falls back to placeholder text', () => {
    const a = decodeToolUse('computer_wait_for_human', {});
    expect(a.kind).toBe('wait_for_human');
    if (a.kind === 'wait_for_human') expect(a.reason.length).toBeGreaterThan(0);
  });
});

describe('VISION_TOOLS schema', () => {
  it('exposes exactly 10 tool primitives', () => {
    expect(VISION_TOOLS).toHaveLength(10);
  });

  it('every tool has a name, description, and input_schema.type=object', () => {
    for (const t of VISION_TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(t.input_schema.type).toBe('object');
    }
  });

  it('tool names match the switch arms in decodeToolUse', () => {
    // If this ever grows, decodeToolUse must also grow. Check explicitly.
    const names = VISION_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'computer_click',
        'computer_key',
        'computer_navigate',
        'computer_screenshot',
        'computer_scroll',
        'computer_type',
        'computer_wait',
        'computer_wait_for_human',
        'task_done',
        'task_give_up',
      ].sort(),
    );
  });
});
