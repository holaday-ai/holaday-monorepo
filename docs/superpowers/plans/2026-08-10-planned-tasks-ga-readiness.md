# Planned Tasks GA Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all three P1 and all five P2 findings from the planned-task production audit so users can trust adjusted schedules, distinguish legacy jobs, operate dialogs and forms accessibly, preserve unsaved work, understand reminders and empty states, and load the calendar without the current duplicate request waterfall.

**Architecture:** Keep scheduling truth in the orchestrator and return one mutation feedback contract to the SPA. Move editor validation, dirty-state comparison, empty-state copy, legacy presentation, and load metrics into small pure helpers covered by Vitest. Keep the calendar mounted while data refreshes, separate plan-list loading from range loading, and emit a bounded PII-free initial-load metric to the existing structured server logger. Use Radix Dialog for the repeat-scope chooser so focus trapping, Escape, and focus restoration have one accessible owner.

**Tech Stack:** TypeScript 5.7, React 18, React Router 7, tRPC 11, Zod 3, Drizzle ORM/MySQL, FullCalendar 6, Radix Dialog 1.1, Vitest 2, Testing Library, happy-dom, Pino.

**Execution Status (2026-08-11):** All three P1 and all five P2 findings are implemented in five local commits. Targeted tests, both full test suites, both typechecks, both production builds, web lint, and authenticated read-only browser acceptance are green. No production task was created or mutated. Push, merge, deployment, live-ref verification, and production GA acceptance remain intentionally pending fresh authorization.

## Global Constraints

- Deliver all eight findings in this plan: three P1 and five P2. Do not silently defer a P2 to a later backlog.
- Preserve the current scheduling rule: a past one-time time is rejected; a past recurring anchor may roll forward, but the effective first execution must be returned and shown to the user.
- An occurrence-only edit represents one concrete date. It must reject a past date rather than silently rolling the series recurrence forward.
- Keep legacy scheduled tasks read-only in the planned calendar and route clicks to the existing legacy record detail.
- The reminder helper must describe the current implemented channel accurately: site notification. It must not promise email or external webhooks.
- Load telemetry may contain only bounded numeric timings/counts and the calendar view enum. Do not send task titles, instructions, IDs, email, URLs, or credentials.
- No database schema or migration is needed for these items.
- Do not modify TaskStream, evidence, result, trust/state-machine, payment, browser execution, stock, image, or video paths.
- Preserve unrelated untracked content under `.claude/`, `qa-artifacts/`, `skills/*`, and `docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md`.
- Do not use the supplied test-account password in source, tests, screenshots, logs, commits, or plan text. Browser verification reads credentials from the existing authenticated session or environment variables.
- Run tests sequentially. Do not create subagents for implementation in this session.
- Local commits listed below are implementation checkpoints, not authorization to push, merge, or deploy. Obtain fresh, separate authorization before each external delivery step.

---

## Requirement Map

| Priority | Finding | Owning task | Acceptance signal |
| --- | --- | --- | --- |
| P1 | Recurring time is adjusted without telling the user | Task 1 | Mutation returns effective time and adjusted toast names it |
| P1 | Legacy jobs look like normal planned tasks and summary says zero | Task 4 | `旧任务` badge, friendly title, separate legacy count |
| P1 | Repeat-scope dialog does not close on Escape or trap/restore focus | Task 3 | Keyboard component test and browser focus check pass |
| P2 | Validation appears only as a toast | Task 2 | Inline errors, ARIA wiring, focus on first invalid field |
| P2 | Closing the editor discards unsaved input | Task 2 | Product confirm on X/Cancel/replacement, unload warning on refresh |
| P2 | Empty month has weak/no guidance | Task 4 | In-calendar actionable empty state for empty and legacy-only months |
| P2 | Reminder channel is ambiguous | Task 4 | “通过站内通知提醒” plus notification-settings link |
| P2 | First load is slow and not observable | Task 5 | No duplicate list request, non-blocking refresh, structured load metric |

## File Map

- Modify `apps/orchestrator/src/trpc/routers/planned-tasks.ts`: standard mutation schedule feedback and bounded load-metric endpoint.
- Create `apps/orchestrator/src/trpc/routers/planned-tasks.mutations.test.ts`: router-level schedule feedback, past-occurrence rejection, and telemetry logging tests using a minimal fake Drizzle context.
- Modify `apps/orchestrator/src/planned/planned-task-input.ts`: add a focused helper/type for effective mutation schedule feedback if router branches would otherwise duplicate it.
- Modify `apps/orchestrator/src/planned/planned-task-input.test.ts`: preserve past-once rejection and recurring roll-forward coverage.
- Create `apps/web-workbench/src/pages/planned/planned-editor-state.ts`: editor validation, error ordering, canonical fingerprint, and schedule-feedback copy.
- Create `apps/web-workbench/src/pages/planned/planned-editor-state.test.ts`: pure validation, dirty-state, and adjusted-time copy tests.
- Create `apps/web-workbench/src/pages/planned/PlannedScopeDialog.tsx`: Radix-backed repeat-scope dialog.
- Create `apps/web-workbench/src/pages/planned/PlannedScopeDialog.test.tsx`: Escape, initial focus, focus containment, selection, and restoration tests.
- Modify `apps/web-workbench/package.json` and `pnpm-lock.yaml`: add only the component-test dev dependencies needed by the new dialog test (`@testing-library/react`, `@testing-library/user-event`, `happy-dom`).
- Modify `apps/web-workbench/src/pages/planned/planned-task-state.ts`: friendly legacy titles/badges, empty-calendar state, and load-metric construction.
- Modify `apps/web-workbench/src/pages/planned/planned-task-state.test.ts`: legacy, empty-state, summary, and metric normalization tests.
- Modify `apps/web-workbench/src/pages/planned/planned-layout.test.ts`: retain the responsive invariant and add structural checks only where CSS behavior is the requirement.
- Modify `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`: consume all helpers, split the fetch lifecycle, render inline errors/confirmations/copy, and report first-load timing.
- Modify `apps/web-workbench/src/pages/planned/planned-tasks.css`: restrained badge, inline-error, empty-state, background-refresh, and dialog styling.

---

### Task 1: Make Schedule Adjustment Explicit and Consistent

**Files:**

- Modify: `apps/orchestrator/src/trpc/routers/planned-tasks.ts`
- Modify: `apps/orchestrator/src/planned/planned-task-input.ts`
- Modify: `apps/orchestrator/src/planned/planned-task-input.test.ts`
- Create: `apps/orchestrator/src/trpc/routers/planned-tasks.mutations.test.ts`
- Create: `apps/web-workbench/src/pages/planned/planned-editor-state.ts`
- Create: `apps/web-workbench/src/pages/planned/planned-editor-state.test.ts`
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`

**Contract:** Every create/update save returns:

```ts
interface PlannedMutationResult {
  ok: true;
  plannedTaskId: string;
  nextRunAt: Date | null;
  adjusted: boolean;
}
```

For occurrence-only edits, `nextRunAt` is the concrete saved occurrence time and `adjusted` is always false. For future/series edits it is the next eligible run. Create preserves the existing fields and adds `ok: true` for consistency.

- [ ] **Step 1: Add RED domain and router contract tests**

Extend `planned-task-input.test.ts` to retain these invariants:

```ts
expect(() => resolveRequestedSchedule({
  scheduledAt: '2026-08-10T08:00:00.000Z',
  repeatType: 'once',
  rrule: null,
  now,
})).toThrow('执行时间已过去');

expect(resolveRequestedSchedule({
  scheduledAt: '2026-08-09T09:00:00.000Z',
  repeatType: 'daily',
  rrule: null,
  now,
})).toMatchObject({
  nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
  adjusted: true,
});
```

In `planned-tasks.mutations.test.ts`, use `vi.useFakeTimers()` and a minimal fake transaction/select/insert/update DB to assert:

- create returns `{ ok: true, plannedTaskId, nextRunAt, adjusted: true }` for a stale daily anchor;
- a series update returns the same shape and effective next run;
- a future split returns the new series ID and its effective next run;
- an occurrence-only edit in the past rejects with `BAD_REQUEST` and `执行时间已过去`;
- an occurrence-only future edit returns its concrete saved time and never claims adjustment.

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-input.test.ts src/trpc/routers/planned-tasks.mutations.test.ts
```

Expected: the new router assertions fail because update branches currently return inconsistent `{ ok }` shapes and occurrence edits reuse recurring roll-forward semantics.

- [ ] **Step 3: Implement one server-side result builder**

Add a small typed helper rather than constructing response objects ad hoc. Wire it through create, occurrence, future, and series update returns. For occurrence-only update validation, resolve the requested concrete date with one-time semantics before writing the override. Do not alter the existing `rescheduleOccurrence` past-date guard.

When a full-series save does not change `scheduledAt`, return the existing `plan.nextRunAt` and `adjusted: false`. The current SPA always supplies `scheduledAt`, but the router contract remains correct for other callers.

- [ ] **Step 4: Confirm backend GREEN**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-input.test.ts src/trpc/routers/planned-tasks.mutations.test.ts src/planned/planned-task-rules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add RED frontend feedback-copy tests**

In `planned-editor-state.test.ts`, lock calm, specific copy:

```ts
expect(plannedSaveFeedback({
  action: 'create',
  adjusted: true,
  nextRunAt: '2026-08-11T09:00:00.000Z',
  timezone: 'Asia/Shanghai',
})).toContain('首次执行已调整为');

expect(plannedSaveFeedback({
  action: 'series',
  adjusted: false,
  nextRunAt: '2026-08-11T09:00:00.000Z',
  timezone: 'Asia/Shanghai',
})).toBe('整个规划已保存');
```

Use `Intl.DateTimeFormat` with the plan timezone; never format the adjusted instant in the browser's unrelated local timezone.

- [ ] **Step 6: Consume mutation results in the SPA**

Capture the return value from both `plannedTasks.create.mutate` and `plannedTasks.update.mutate`. Show the existing short success copy when `adjusted === false`; when true, show `规划已保存，首次执行已调整为 MM月DD日 HH:mm` (or the create equivalent). Keep backend errors as errors; do not relabel a rejected past one-time schedule as a success.

- [ ] **Step 7: Run focused frontend tests and typechecks**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-editor-state.test.ts
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the completed vertical slice**

```bash
git add apps/orchestrator/src/planned/planned-task-input.ts apps/orchestrator/src/planned/planned-task-input.test.ts apps/orchestrator/src/trpc/routers/planned-tasks.ts apps/orchestrator/src/trpc/routers/planned-tasks.mutations.test.ts apps/web-workbench/src/pages/planned/planned-editor-state.ts apps/web-workbench/src/pages/planned/planned-editor-state.test.ts apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx
git commit -m "fix(planned): surface effective schedule changes"
```

---

### Task 2: Add Inline Validation and Protect Unsaved Editor Work

**Files:**

- Modify: `apps/web-workbench/src/pages/planned/planned-editor-state.ts`
- Modify: `apps/web-workbench/src/pages/planned/planned-editor-state.test.ts`
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/planned/planned-tasks.css`

**Interfaces:**

```ts
type PlannedEditorErrorKey = 'instruction' | 'items' | 'scheduledAt' | 'customDays';
type PlannedEditorErrors = Partial<Record<PlannedEditorErrorKey, string>>;

validatePlannedEditor(editor: PlannedEditorDraft): PlannedEditorErrors;
firstPlannedEditorError(errors: PlannedEditorErrors): PlannedEditorErrorKey | null;
plannedEditorFingerprint(editor: PlannedEditorDraft): string;
```

- [ ] **Step 1: Add RED pure-state tests**

Cover:

- blank single-task instruction → `instruction: 请填写任务内容`;
- multi-task mode with only whitespace rows → `items: 请填写至少一个任务`;
- missing/invalid date or time → `scheduledAt` error before any `toISOString()` call;
- custom recurrence with zero days → `customDays: 请选择至少一个执行日`;
- valid recurring drafts with a past anchor are not rejected client-side because the backend may advance them;
- error ordering is `instruction/items`, then `scheduledAt`, then `customDays`;
- fingerprints are stable across object identity changes but change for every user-editable field;
- trimming API payloads does not cause an unchanged loaded editor to appear dirty.

- [ ] **Step 2: Confirm RED, implement helpers, confirm GREEN**

Run before and after:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-editor-state.test.ts
```

- [ ] **Step 3: Replace toast-only validation with accessible inline errors**

Track `editorErrors` separately from the draft. On save:

1. validate before constructing `Date`/RRULE payloads;
2. render error text immediately below the owning control;
3. add `aria-invalid="true"` and `aria-describedby` to the invalid control/group;
4. focus the first invalid control using stable refs;
5. clear only the edited field's error when it becomes valid.

For multiple items, focus the first task input. For custom days, focus the weekday group. Rename the title legend to `名称（选填）` so optionality is explicit.

- [ ] **Step 4: Add a canonical editor baseline and close intent**

Store the baseline fingerprint whenever a new draft is opened or a plan detail finishes loading. Add a `requestEditorClose` path used by:

- inspector X;
- inspector Cancel;
- clicking another planned occurrence while the current editor is dirty;
- clicking a date/New Plan while the current editor is dirty.

If clean, apply the intent immediately. If dirty, open the existing product `ConfirmDialog` with:

- title: `放弃未保存的更改？`
- description: `当前修改尚未保存，关闭后将无法恢复。`
- confirm: `放弃更改`
- cancel: `继续编辑`
- destructive styling enabled.

On confirmed save, clear the editor directly without showing this confirmation. Do not use `window.confirm`.

- [ ] **Step 5: Guard browser refresh/close**

Register `beforeunload` only while the editor fingerprint differs from its baseline, and remove it immediately after save/close/unmount. This provides the browser-native safety net for refresh/tab close without introducing a global router migration. In-app navigation outside the planned page is not intercepted by this scoped component; the audit finding is satisfied for the destructive editor actions that currently call `setEditor(null)`.

- [ ] **Step 6: Style errors and run targeted tests**

Add small red helper text and error borders without changing field heights when no error is present. Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-editor-state.test.ts src/pages/planned/planned-layout.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the editor-safety slice**

```bash
git add apps/web-workbench/src/pages/planned/planned-editor-state.ts apps/web-workbench/src/pages/planned/planned-editor-state.test.ts apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx apps/web-workbench/src/pages/planned/planned-tasks.css
git commit -m "fix(planned): validate drafts and protect unsaved edits"
```

---

### Task 3: Replace the False Modal with an Accessible Scope Dialog

**Files:**

- Create: `apps/web-workbench/src/pages/planned/PlannedScopeDialog.tsx`
- Create: `apps/web-workbench/src/pages/planned/PlannedScopeDialog.test.tsx`
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/planned/planned-tasks.css`
- Modify: `apps/web-workbench/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the minimal component-test harness**

Add dev-only `@testing-library/react`, `@testing-library/user-event`, and `happy-dom`. Configure only `PlannedScopeDialog.test.tsx` with `// @vitest-environment happy-dom`; do not change the default environment for the rest of the suite.

- [ ] **Step 2: Write RED keyboard/focus tests**

Render a trigger plus an open `PlannedScopeDialog` and assert:

- focus initially lands on `仅这一次`;
- Tab/Shift+Tab remain within the dialog;
- Escape invokes `onClose` once;
- clicking `这次及以后` invokes `onSelect('future')` once;
- closing restores focus to the recorded trigger;
- title and description are connected with `aria-labelledby` and `aria-describedby`.

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/PlannedScopeDialog.test.tsx
```

Expected: FAIL because the component does not yet exist.

- [ ] **Step 3: Implement with Radix Dialog**

Use `Dialog.Root`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Dialog.Title`, and `Dialog.Description`. Preserve the three existing scope choices and explanatory copy. `onOpenChange(false)` cancels; selecting a scope calls `onSelect` and lets the parent execute the mutation. Record the active element before setting `pendingScope` and restore it through `onCloseAutoFocus`.

Remove the current `<dialog open aria-modal="true">` block entirely. Do not retain duplicate Escape listeners or manual focus traps.

- [ ] **Step 4: Confirm component and page GREEN**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/PlannedScopeDialog.test.tsx src/pages/planned/planned-layout.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the dialog slice**

```bash
git add apps/web-workbench/package.json pnpm-lock.yaml apps/web-workbench/src/pages/planned/PlannedScopeDialog.tsx apps/web-workbench/src/pages/planned/PlannedScopeDialog.test.tsx apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx apps/web-workbench/src/pages/planned/planned-tasks.css
git commit -m "fix(planned): make repeat scope dialog keyboard safe"
```

---

### Task 4: Clarify Legacy Events, Empty Months, and Reminder Delivery

**Files:**

- Modify: `apps/web-workbench/src/pages/planned/planned-task-state.ts`
- Modify: `apps/web-workbench/src/pages/planned/planned-task-state.test.ts`
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/planned/planned-tasks.css`

**Interfaces:**

```ts
friendlyLegacyTaskTitle(intent: string, scheduledTaskId: string): string;
plannedCalendarEmptyState(input: {
  loading: boolean;
  plannedCount: number;
  legacyCount: number;
}): { title: string; description: string } | null;
```

- [ ] **Step 1: Write RED presentation-state tests**

Add assertions that:

- `__ashare_premarket_briefing__` displays as `A股盘前简报`;
- `__ashare_postmarket_briefing__` displays as `A股盘后复盘`;
- any unknown `__technical_marker__` falls back to `旧定时任务`, never exposes the marker;
- normal human intent remains unchanged;
- legacy event extended props include `legacy: true` and a visible `旧任务` label;
- summary counts planned tasks and legacy tasks separately;
- empty planned + empty legacy returns `点击日期或新建规划` guidance;
- empty planned + non-empty legacy explains that gray entries are old tasks;
- loading or any planned occurrence returns no empty overlay.

- [ ] **Step 2: Confirm RED, implement pure helpers, confirm GREEN**

Run before and after:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-task-state.test.ts
```

- [ ] **Step 3: Render legacy identity in every relevant surface**

Update `renderEventContent` to render a compact `旧任务` badge when `extendedProps.legacy` is true. Keep the gray accent and read-only behavior. Add `另有 N 个旧任务` to the summary only when legacy rows exist, and keep click-through to `/planned/legacy-scheduled` with the existing focus query.

Do not count legacy rows as active planned tasks or planned task items.

- [ ] **Step 4: Add an in-calendar empty state**

Keep FullCalendar mounted. Overlay guidance inside `.planned-calendar-panel` only after the current range finishes loading and the helper returns a state. Include a small `新建规划` action for the fully empty case; for legacy-only months, explain the gray entries and link to `旧任务记录`. Do not rely on FullCalendar's `noEventsContent`, which is not consistently visible in month view.

- [ ] **Step 5: Explain reminder delivery precisely**

Under the reminder select, add:

```tsx
<p className="planned-field-hint">
  通过站内通知提醒 · <Link to="/settings#notifications">通知设置</Link>
</p>
```

The helper appears regardless of whether `不提醒` is selected so the meaning of the control is stable. Do not mention email/webhooks until planned-task delivery actually uses them.

- [ ] **Step 6: Run tests and visual layout checks**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-task-state.test.ts src/pages/planned/planned-layout.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Verify 390px and desktop widths: badge does not obscure time/title, empty overlay does not block date clicks outside its action, and the settings link has visible keyboard focus.

- [ ] **Step 7: Commit the clarity slice**

```bash
git add apps/web-workbench/src/pages/planned/planned-task-state.ts apps/web-workbench/src/pages/planned/planned-task-state.test.ts apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx apps/web-workbench/src/pages/planned/planned-tasks.css
git commit -m "fix(planned): clarify legacy events and empty states"
```

---

### Task 5: Remove the Initial Request Waterfall and Add Load Monitoring

**Files:**

- Modify: `apps/orchestrator/src/trpc/routers/planned-tasks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/planned-tasks.mutations.test.ts`
- Modify: `apps/web-workbench/src/pages/planned/planned-task-state.ts`
- Modify: `apps/web-workbench/src/pages/planned/planned-task-state.test.ts`
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/planned/planned-tasks.css`

**Performance contract:**

- First mount sends exactly one `plannedTasks.list`, one `plannedTasks.calendar`, and one `scheduledTasks.list` after FullCalendar establishes its range.
- Month/view changes refetch only the two range queries, not the plan list.
- Explicit successful mutations refresh both the plan list and the current range.
- The calendar shell remains visible while range data refreshes; stale responses cannot overwrite a newer range.
- One fire-and-forget metric is emitted after the first complete load; it never delays rendering or turns a successful page load into an error.

- [ ] **Step 1: Add RED pure metric tests**

Add `buildPlannedLoadMetric` tests that clamp/round timings and counts and reject non-finite values. The payload is exactly:

```ts
{
  view: 'dayGridMonth' | 'listMonth';
  plansMs: number;
  calendarMs: number;
  totalMs: number;
  plannedCount: number;
  legacyCount: number;
  slow: boolean;
}
```

Set `slow` when `totalMs > 2500`. Do not include task content or identifiers.

- [ ] **Step 2: Add RED endpoint tests**

In `planned-tasks.mutations.test.ts`, call `reportLoadMetric` with a fake authenticated context and assert:

- valid input logs one Pino event named `planned_tasks_initial_load` and returns `{ ok: true }`;
- negative, non-finite, or over-60-second timings are rejected by Zod;
- unknown view and unexpected content fields are rejected/stripped according to the chosen strict schema;
- the logger payload contains no `userId`, title, instruction, URL, or email.

- [ ] **Step 3: Confirm RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/planned-tasks.mutations.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-task-state.test.ts
```

Expected: FAIL because the metric builder and endpoint do not exist.

- [ ] **Step 4: Implement bounded structured logging**

Add `plannedTasks.reportLoadMetric` as a protected mutation with a strict Zod schema. It writes one `ctx.logger.info({ event: 'planned_tasks_initial_load', ...input }, 'planned tasks initial load')` record and returns immediately. It performs no DB write and sends no email. Keep this endpoint in the planned router because the metric is page-specific.

- [ ] **Step 5: Split list and range fetch lifecycles**

In `PlannedTasksPage.tsx`:

- replace one `loading` flag with `plansLoading` and `calendarLoading`;
- run `refreshPlans()` once on mount and after mutations;
- run `refreshCalendar(range)` only after `datesSet` produces a stable range and whenever that range changes;
- keep `refreshAll()` only for explicit post-mutation refreshes;
- track a monotonically increasing calendar request ID and apply only the latest response;
- retain old events during range refresh and show a quiet toolbar progress indicator instead of replacing the calendar with a 540px loading panel;
- render the FullCalendar shell immediately so `datesSet` is not blocked by plan-list network latency.

- [ ] **Step 6: Measure and report the first complete load**

Capture `performance.now()` at page mount and around the first list/range requests. Once both first requests settle successfully, build the metric and call `trpc.plannedTasks.reportLoadMetric.mutate(metric)` without awaiting it. Catch and ignore telemetry failure after a development-only debug message; never show a user toast for monitoring failure.

Do not report mutation refreshes or month-navigation refreshes in this slice; the metric is intentionally one record per page mount.

- [ ] **Step 7: Confirm targeted GREEN**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/planned-tasks.mutations.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-task-state.test.ts src/pages/planned/planned-layout.test.ts
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
```

Expected: PASS.

- [ ] **Step 8: Browser-network acceptance**

With the existing authenticated local browser session:

1. hard-reload `/planned` with the Network panel cleared;
2. assert one list request and one pair of range requests, with no repeated loop;
3. navigate next month and assert only the range pair repeats;
4. return to today and confirm prior events remain visible under the quiet refresh indicator;
5. inspect the server log for one `planned_tasks_initial_load` event with numeric fields only;
6. capture five warm loads and record median/P75; block GA if P75 remains above 2.5 seconds after duplicate requests are removed.

- [ ] **Step 9: Commit the performance slice**

```bash
git add apps/orchestrator/src/trpc/routers/planned-tasks.ts apps/orchestrator/src/trpc/routers/planned-tasks.mutations.test.ts apps/web-workbench/src/pages/planned/planned-task-state.ts apps/web-workbench/src/pages/planned/planned-task-state.test.ts apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx apps/web-workbench/src/pages/planned/planned-tasks.css
git commit -m "perf(planned): remove duplicate loads and report latency"
```

---

### Task 6: Full Gates, Production Acceptance, and Delivery Boundaries

**Files:**

- Review all files listed above.
- Do not create or modify migrations.
- Do not update production state until fresh deployment authorization is recorded.

- [ ] **Step 1: Run all planned-task focused suites sequentially**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-input.test.ts src/planned/planned-task-dates.test.ts src/planned/planned-task-rules.test.ts src/planned/planned-executor.test.ts src/db/schema/planned-tasks.test.ts src/trpc/routers/planned-tasks.mutations.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-editor-state.test.ts src/pages/planned/PlannedScopeDialog.test.tsx src/pages/planned/planned-task-state.test.ts src/pages/planned/planned-layout.test.ts
```

- [ ] **Step 2: Run repository gates sequentially**

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build
pnpm --filter @holaday/web-workbench lint
git diff --check
```

If root `pnpm lint` is run and reports known repository-wide Biome noise outside the touched paths, report it separately and run `pnpm exec biome check` against the touched orchestrator/web files. Do not claim root lint is green unless it actually is.

- [ ] **Step 3: Run the no-cost browser acceptance matrix**

Verify desktop and 390px viewport without triggering a real planned execution:

- create form: every invalid case shows inline text and focuses correctly;
- dirty X/Cancel/new-date/new-plan: product confirmation appears and cancel preserves the draft;
- refresh with dirty draft: native unload warning is registered;
- repeat scope: initial focus, Tab containment, Escape close, and trigger focus restoration;
- stale recurring anchor: save feedback names the adjusted effective time;
- past one-time and past occurrence edit: rejected without silent movement;
- legacy event: friendly title, `旧任务` badge, gray/read-only style, detail routing;
- empty and legacy-only months: correct guidance;
- reminder helper: site-notification copy and `/settings#notifications` target;
- initial and month-navigation request counts: match Task 5 contract;
- browser console: zero uncaught error, zero accessibility diagnostic introduced by this slice.

- [ ] **Step 4: Review security and sensitive-area impact**

Confirm:

- metric payload is strict, bounded, PII-free, authenticated, log-only, and non-blocking;
- no password/token/test-account value appears in `git diff` or test fixtures;
- no TaskStream/evidence/result/trust/state-machine/payment/browser/stock/image/video files changed;
- no schema/migration drift;
- unrelated untracked drafts remain untouched.

Record `git status --short`, `git diff --stat`, and the exact test counts in the delivery report.

- [ ] **Step 5: Obtain fresh push/merge/deploy authorization**

Stop after local verification and report the commits. Push only after explicit push authorization. Merge only after explicit merge authorization and a fast-forward/base reconciliation check. Deploy only after explicit deployment authorization.

- [ ] **Step 6: If authorized, push and run preflight before deployment**

```bash
git push origin codex/trust-loop-round1
```

Before any deploy, verify the live ref and confirm it is an ancestor of the intended branch using the repository preflight. Do not use `ALLOW_DIVERGENT_DEPLOY=1` unless the user explicitly authorizes an intentional cutover.

- [ ] **Step 7: If separately authorized, deploy orchestrator then SPA**

The telemetry endpoint and mutation contract require the orchestrator first; the SPA must not ship first against an old contract.

```bash
./scripts/deploy-orchestrator.sh codex/trust-loop-round1
pnpm --filter @holaday/web-workbench build
./scripts/deploy-spa.sh
```

Both deploy scripts must complete their built-in health/smoke and rollback gates.

- [ ] **Step 8: Production verification and GA decision**

Verify:

- orchestrator `/healthz` is 200 with `status=ok`;
- `https://holaday.ai/app/planned` and the Aliyun SPA entry return 200 and the new bundle hash;
- the eight-item browser acceptance matrix passes against production without starting a paid/real task;
- one bounded load metric appears per page mount;
- five warm production loads meet P75 ≤ 2.5s;
- no fresh PM2 errors or repeated client request loop appears.

If any P1 fails, roll back the affected service and keep GA blocked. A P2 failure also blocks declaring this combined plan complete because the user explicitly included all P2 items.

---

## Completion Definition

This plan is complete only when all checklist items are implemented and verified, all eight audit findings pass production acceptance, the exact live refs/bundle hash are recorded, and the final report distinguishes local commit, push, merge, orchestrator deployment, SPA deployment, and production verification as separate facts.
