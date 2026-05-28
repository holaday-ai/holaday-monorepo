/**
 * Phase 25 follow-up — composer-reset decision logic.
 *
 * The MainPanel effect that wipes the composer (bumps composerKey to
 * force InputArea remount + clears prefillIntent) must fire on:
 *
 *   - task A → task B    (different tasks, same JSX branch — the
 *                          InputArea component instance is reused, so
 *                          local `value` state survives without an
 *                          explicit reset)
 *   - task A → null      (user clicked "新任务" from a task detail —
 *                          previously SKIPPED in the guard, which left
 *                          any typed-but-unsent text in the composer.
 *                          This was the "occasionally doesn't clear
 *                          old content" bug)
 *
 * And must NOT fire on:
 *
 *   - null → task        (initial deep-link / sidebar pick from empty
 *                          home — InputArea unmounts in the empty-home
 *                          JSX branch and mounts fresh in the task-
 *                          detail branch, so the structural reset
 *                          handles this; an extra remount is harmless
 *                          but pointless)
 *   - null → null        (suggestion-chip click on empty home —
 *                          setPrefillIntent flows through InputArea's
 *                          effect to seed `value`. Bumping composerKey
 *                          would unmount InputArea between the
 *                          setPrefillIntent and the prefill-consume
 *                          handshake, dropping the chip text the user
 *                          just clicked)
 *
 * Truth table:
 *
 *    prev | next | reset?  | rationale
 *   ------|------|---------|--------------------------------
 *    null | null | false   | chip click, preserve prefill
 *    null |  A   | false   | structural JSX swap handles it
 *     A   |  A   | false   | no transition
 *     A   |  B   | true    | same JSX branch, needs forced remount
 *     A   | null | true    | typed text on task page must clear
 *
 * Captured as `prev != null && prev !== next` — pure boolean, no
 * React-side ceremony to test.
 */
export function shouldResetComposerOnSelectionChange(
  prev: string | null,
  next: string | null,
): boolean {
  return prev != null && prev !== next;
}
