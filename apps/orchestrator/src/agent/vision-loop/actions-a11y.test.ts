import { describe, expect, it } from 'vitest';
import { A11Y_TOOLS, decodeA11yToolUse } from './actions-a11y.js';

/**
 * Unit tests for the a11y-mode tool decoder. Mirrors the contract
 * of actions.ts's screenshot-mode decoder: round-trip every tool,
 * malformed inputs → give_up, unknown tool names → give_up.
 */

describe('decodeA11yToolUse', () => {
  it('decodes a11y_click_ref', () => {
    expect(decodeA11yToolUse('a11y_click_ref', { ref: 'e5' })).toEqual({
      kind: 'click_ref',
      ref: 'e5',
    });
  });

  it('decodes a11y_type_in_ref', () => {
    expect(decodeA11yToolUse('a11y_type_in_ref', { ref: 'e3', text: 'hola@holaday.test' })).toEqual(
      { kind: 'type_in_ref', ref: 'e3', text: 'hola@holaday.test' },
    );
  });

  it('decodes a11y_press_key (chord)', () => {
    expect(decodeA11yToolUse('a11y_press_key', { key: 'ctrl+a' })).toEqual({
      kind: 'press_key',
      key: 'ctrl+a',
    });
  });

  it('decodes a11y_scroll (with string coercion)', () => {
    expect(decodeA11yToolUse('a11y_scroll', { dy: '500' })).toEqual({ kind: 'scroll', dy: 500 });
    expect(decodeA11yToolUse('a11y_scroll', { dy: -250 })).toEqual({ kind: 'scroll', dy: -250 });
  });

  it('decodes a11y_wait (with string coercion)', () => {
    expect(decodeA11yToolUse('a11y_wait', { ms: '1500' })).toEqual({ kind: 'wait', ms: 1500 });
  });

  it('decodes a11y_screenshot tolerantly', () => {
    expect(decodeA11yToolUse('a11y_screenshot', {})).toEqual({ kind: 'screenshot' });
    expect(decodeA11yToolUse('a11y_screenshot', { junk: 1 })).toEqual({ kind: 'screenshot' });
  });

  it('decodes a11y_navigate (full URL required)', () => {
    expect(decodeA11yToolUse('a11y_navigate', { url: 'https://www.baidu.com/' })).toEqual({
      kind: 'navigate',
      url: 'https://www.baidu.com/',
    });
  });

  it('a11y_navigate without scheme → give_up', () => {
    const r = decodeA11yToolUse('a11y_navigate', { url: 'www.baidu.com' });
    expect(r.kind).toBe('give_up');
    if (r.kind === 'give_up') expect(r.reason).toMatch(/a11y_navigate bad input/);
  });

  it('decodes a11y_task_done', () => {
    expect(decodeA11yToolUse('a11y_task_done', { summary: '已提交表单' })).toEqual({
      kind: 'done',
      summary: '已提交表单',
    });
  });

  it('decodes a11y_task_give_up', () => {
    expect(decodeA11yToolUse('a11y_task_give_up', { reason: '需要登录' })).toEqual({
      kind: 'give_up',
      reason: '需要登录',
    });
  });

  it('unknown tool name → give_up with diagnostic', () => {
    const r = decodeA11yToolUse('not_a_real_tool', {});
    expect(r.kind).toBe('give_up');
    if (r.kind === 'give_up') expect(r.reason).toMatch(/unknown a11y tool_use.*not_a_real_tool/);
  });

  it('missing ref on click_ref → give_up', () => {
    const r = decodeA11yToolUse('a11y_click_ref', {});
    expect(r.kind).toBe('give_up');
    if (r.kind === 'give_up') expect(r.reason).toMatch(/a11y_click_ref bad input/);
  });

  it('empty key on press_key → give_up', () => {
    const r = decodeA11yToolUse('a11y_press_key', { key: '' });
    expect(r.kind).toBe('give_up');
    if (r.kind === 'give_up') expect(r.reason).toMatch(/a11y_press_key bad input/);
  });

  it('task_give_up without a reason still returns give_up (fallback)', () => {
    const r = decodeA11yToolUse('a11y_task_give_up', {});
    expect(r.kind).toBe('give_up');
    if (r.kind === 'give_up') expect(r.reason).toMatch(/without a valid reason/);
  });
});

describe('A11Y_TOOLS schema', () => {
  it('exposes exactly 9 tool primitives', () => {
    expect(A11Y_TOOLS).toHaveLength(9);
  });

  it('every tool name starts with a11y_', () => {
    for (const t of A11Y_TOOLS) {
      expect(t.name.startsWith('a11y_')).toBe(true);
    }
  });

  it('tool names align with decoder switch arms', () => {
    const names = A11Y_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'a11y_click_ref',
        'a11y_navigate',
        'a11y_press_key',
        'a11y_screenshot',
        'a11y_scroll',
        'a11y_task_done',
        'a11y_task_give_up',
        'a11y_type_in_ref',
        'a11y_wait',
      ].sort(),
    );
  });
});
