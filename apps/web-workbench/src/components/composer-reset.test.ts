import { describe, expect, it } from 'vitest';
import { shouldResetComposerOnSelectionChange } from './composer-reset.js';

describe('shouldResetComposerOnSelectionChange', () => {
  it('null → null is not a reset (chip-click on empty home)', () => {
    expect(shouldResetComposerOnSelectionChange(null, null)).toBe(false);
  });

  it('null → task is not a reset (JSX swap handles it)', () => {
    expect(shouldResetComposerOnSelectionChange(null, 'tsk_A')).toBe(false);
  });

  it('task → same task is not a reset (no transition)', () => {
    expect(shouldResetComposerOnSelectionChange('tsk_A', 'tsk_A')).toBe(false);
  });

  it('task → different task IS a reset (same JSX branch, need forced remount)', () => {
    expect(shouldResetComposerOnSelectionChange('tsk_A', 'tsk_B')).toBe(true);
  });

  /**
   * The regression case that prompted this rewrite. Before commit
   * 8f00568 the guard was `selectedTaskId && prev !== next`, which
   * skipped this transition because `next` is null/falsy. With the
   * `prev != null` guard the reset fires correctly — typed-but-
   * unsent text in the composer from a reply / follow-up session
   * is wiped when the user clicks "新任务".
   */
  it('task → null IS a reset (new-task click from a task page wipes draft)', () => {
    expect(shouldResetComposerOnSelectionChange('tsk_A', null)).toBe(true);
  });

  it('empty-string ids are treated as truthy task ids (defensive)', () => {
    // External ids in our system are always non-empty strings, but
    // assert the predicate doesn't silently coerce "" to null and
    // suppress a legitimate reset.
    expect(shouldResetComposerOnSelectionChange('', 'tsk_A')).toBe(true);
    expect(shouldResetComposerOnSelectionChange('', null)).toBe(true);
  });
});
