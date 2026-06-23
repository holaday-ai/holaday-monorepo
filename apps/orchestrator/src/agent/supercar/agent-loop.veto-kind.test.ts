import { describe, expect, it } from 'vitest';
import { vetoActionKind } from './agent-loop.js';

/**
 * Phase 1 Playbook ④ — regression for the adversarial-review CAMERA-2 BLOCKER:
 * a click decomposed into mouse primitives (left_mouse_down + left_mouse_up) or a
 * drag-to-confirm slider (left_click_drag) must NOT slip past the live-veto. The
 * gate fires only when vetoActionKind returns non-null, so these — and any unknown /
 * future computer action — must map to a write kind (FAIL-CLOSED), not null.
 */
describe('vetoActionKind — fail-closed coverage of every write action', () => {
  it('maps the mouse PRIMITIVES that compose a click → click (the bypass the review found)', () => {
    expect(vetoActionKind('left_mouse_down')).toBe('click');
    expect(vetoActionKind('left_mouse_up')).toBe('click');
    expect(vetoActionKind('left_click_drag')).toBe('click');
  });

  it('maps all click variants → click', () => {
    for (const a of ['left_click', 'right_click', 'middle_click', 'double_click', 'triple_click']) {
      expect(vetoActionKind(a)).toBe('click');
    }
  });

  it('maps keyboard writes → type', () => {
    for (const a of ['type', 'key', 'hold_key']) {
      expect(vetoActionKind(a)).toBe('type');
    }
  });

  it('an UNKNOWN / future action fails closed → click (vetoed), never null', () => {
    expect(vetoActionKind('some_new_2027_action')).toBe('click');
    expect(vetoActionKind('paste')).toBe('click');
    expect(vetoActionKind(undefined)).toBe('click');
  });

  it('genuine read-class actions are NOT vetoed (null)', () => {
    for (const a of ['screenshot', 'cursor_position', 'mouse_move', 'scroll', 'wait', 'zoom']) {
      expect(vetoActionKind(a)).toBeNull();
    }
  });
});
