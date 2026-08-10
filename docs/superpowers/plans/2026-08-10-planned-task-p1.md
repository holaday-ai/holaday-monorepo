# Planned Tasks P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inclusive, timezone-aware repeat end dates and immutable run-title snapshots to planned tasks.

**Architecture:** Keep the API date-only contract separate from UTC storage through focused domain helpers, then have create/update routes resolve every lifecycle case through those helpers. Snapshot the effective occurrence title when queuing a run, expose it through run history, and keep the frontend editor state/payload rules in testable pure helpers.

**Tech Stack:** TypeScript 5.7, tRPC 11, Zod 3, Drizzle ORM/MySQL, React 18, Vitest 2, Intl.DateTimeFormat.

**Execution Status:** Completed and verified on `codex/planned-tasks` without commit, push, merge, or deployment. The unchecked boxes below preserve the original executable checklist rather than Git history.

## Global Constraints

- `endsOn` is `YYYY-MM-DD | null`; the selected day is inclusive in the plan's IANA timezone.
- Store `planned_tasks.ends_at` as the exclusive UTC midnight at the start of the following local day.
- A one-time plan always stores `endsAt = null`; occurrence-only edits cannot change a series ending.
- A timezone change preserves the visible end date by recalculating the UTC boundary.
- `planned_task_runs.title` is a required immutable snapshot of the effective occurrence title.
- Modify the uncommitted `0045_planned_tasks.sql` for fresh databases; align only the already-migrated local MySQL with a targeted `ALTER` sequence.
- Do not create subagents or parallel test jobs.
- Do not commit, push, merge, migrate production, or deploy without separate authorization. Commit steps normally required by the planning skill are intentionally omitted.
- Preserve unrelated `.claude/`, `qa-artifacts/`, `skills/*`, and `docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md` content.

---

## File Map

- Create `apps/orchestrator/src/planned/planned-task-dates.ts`: strict date/timezone conversion and end-boundary resolution.
- Create `apps/orchestrator/src/planned/planned-task-dates.test.ts`: timezone, DST, reverse-formatting, and boundary tests.
- Modify `apps/orchestrator/src/planned/planned-task-input.ts`: accept `endsOn` on create inputs.
- Modify `apps/orchestrator/src/planned/planned-task-input.test.ts`: schema coverage for absent, null, valid, and malformed dates.
- Modify `apps/orchestrator/src/trpc/routers/planned-tasks.ts`: return `endsOn`; enforce create/update/scope/timezone semantics; return run titles.
- Modify `apps/orchestrator/src/db/schema/planned-tasks.ts`: add the required run `title` property.
- Modify `apps/orchestrator/src/db/schema/planned-tasks.test.ts`: lock the Drizzle column contract.
- Modify `apps/orchestrator/drizzle/0045_planned_tasks.sql`: add `planned_task_runs.title VARCHAR(200) NOT NULL` for fresh databases.
- Modify `apps/orchestrator/scripts/verify-db-schema.ts`: expect the new run-title column in database verification.
- Modify `apps/orchestrator/src/planned/planned-runner.ts`: persist the resolved occurrence title in the run transaction.
- Modify `apps/orchestrator/src/planned/planned-executor.test.ts`: prove base and occurrence-specific title selection remains stable.
- Modify `apps/web-workbench/src/pages/planned/planned-task-state.ts`: pure editor end-state and payload helpers.
- Modify `apps/web-workbench/src/pages/planned/planned-task-state.test.ts`: editor initialization, repeat transitions, and occurrence payload omission tests.
- Modify `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`: end-date editor control, API fields, payloads, and run-history titles.
- Modify `apps/web-workbench/src/pages/planned/planned-tasks.css`: style the end-mode control and history title without changing the page plane.

### Task 1: Timezone-Aware Inclusive End-Date Domain

**Interfaces:**

- Produces `endDateToExclusiveUtc(endsOn: string, timezone: string): Date`.
- Produces `exclusiveUtcToEndDate(endsAt: Date, timezone: string): string`.
- Produces `resolvePlannedEndsAt(input: { repeatType: PlannedRepeatType; endsOn: string | null | undefined; existingEndsAt?: Date | null; existingTimezone?: string; timezone: string; firstEligibleRunAt: Date }): Date | null`.
- All validation failures throw `Error` with user-facing Chinese messages for the router's existing `BAD_REQUEST` adapter.

- [ ] **Step 1: Write failing date conversion tests**

Add tests that assert:

```ts
expect(endDateToExclusiveUtc('2026-08-31', 'Asia/Shanghai'))
  .toEqual(new Date('2026-08-31T16:00:00.000Z'));
expect(endDateToExclusiveUtc('2026-11-01', 'America/New_York'))
  .toEqual(new Date('2026-11-02T05:00:00.000Z'));
expect(exclusiveUtcToEndDate(new Date('2026-11-02T05:00:00.000Z'), 'America/New_York'))
  .toBe('2026-11-01');
expect(() => endDateToExclusiveUtc('2026-02-30', 'Asia/Shanghai')).toThrow('结束日期无效');
expect(() => endDateToExclusiveUtc('2026-08-31', 'Mars/Base')).toThrow('时区无效');
```

- [ ] **Step 2: Run the new test and confirm RED**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-dates.test.ts`

Expected: FAIL because the module/functions do not exist.

- [ ] **Step 3: Implement strict conversion**

Use `Intl.DateTimeFormat(...).formatToParts()` to compare local calendar parts, increment the parsed date by one calendar day, and iteratively solve the UTC instant for local midnight. Validate both the input Gregorian date and the final formatted timezone parts; do not use browser/system-local timestamp arithmetic.

- [ ] **Step 4: Add failing end-resolution tests**

Cover:

```ts
expect(resolvePlannedEndsAt({
  repeatType: 'daily',
  endsOn: '2026-08-10',
  timezone: 'Asia/Shanghai',
  firstEligibleRunAt: new Date('2026-08-10T01:00:00.000Z'),
})).toEqual(new Date('2026-08-10T16:00:00.000Z'));

expect(() => resolvePlannedEndsAt({
  repeatType: 'daily',
  endsOn: '2026-08-09',
  timezone: 'Asia/Shanghai',
  firstEligibleRunAt: new Date('2026-08-10T01:00:00.000Z'),
})).toThrow('结束日期早于下一次执行');
```

Also cover `once -> null`, explicit `null -> null`, omitted value preserving the current boundary, and omitted value plus timezone change preserving the visible date.

- [ ] **Step 5: Implement resolution and confirm GREEN**

Resolve `undefined` from the existing boundary/date, resolve `null` as unbounded, always clear for `once`, and require `firstEligibleRunAt < endsAt` for bounded repeating plans.

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-dates.test.ts`

Expected: PASS.

### Task 2: API End-Date Contract and Edit-Scope Semantics

**Interfaces:**

- Consumes the three Task 1 helpers.
- Produces plan responses with `endsOn: string | null` while retaining `endsAt`.
- Create and update inputs accept `endsOn?: string | null`.

- [ ] **Step 1: Add failing input-schema tests**

Add `endsOn` cases to `planned-task-input.test.ts`:

```ts
expect(plannedTaskCreateInputSchema.parse({
  instruction: '每日巡检',
  repeatType: 'daily',
  scheduledAt: '2026-08-10T01:00:00.000Z',
  endsOn: '2026-08-31',
}).endsOn).toBe('2026-08-31');

expect(() => plannedTaskCreateInputSchema.parse({
  instruction: '每日巡检',
  repeatType: 'daily',
  scheduledAt: '2026-08-10T01:00:00.000Z',
  endsOn: '08/31/2026',
})).toThrow();
```

- [ ] **Step 2: Confirm RED, add the date-only Zod field, confirm GREEN**

Run before and after implementation:

`pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-input.test.ts`

The field uses `/^\d{4}-\d{2}-\d{2}$/`, remains optional/nullable, and semantic calendar validation stays in Task 1.

- [ ] **Step 3: Wire create and response mapping**

In `create`, resolve `endsAt` using `schedule.nextRunAt` as `firstEligibleRunAt`, write it in the same plan insert, and adapt any thrown error to `TRPCError({ code: 'BAD_REQUEST' })`. In `planView`, derive `endsOn` with the plan timezone.

- [ ] **Step 4: Wire update semantics**

Extend the update input with `endsOn`. Reject `editScope === 'occurrence' && input.endsOn !== undefined`. For future splits, resolve the new series boundary using the new series timezone/repeat type/schedule and preserve the old series split boundary. For series edits, compute the next schedule first, then resolve the boundary so changing to `once` clears it and changing timezone preserves the visible end date.

- [ ] **Step 5: Add pure regression tests for every lifecycle case**

Use `resolvePlannedEndsAt` tests to lock create/clear/preserve/timezone/once behavior, and add a small exported `assertPlannedEndsOnScope(editScope, endsOn)` helper if needed to test occurrence rejection without mocking Drizzle. Future-split tests must verify omitted `endsOn` inherits and explicit `null` clears.

- [ ] **Step 6: Run planned-task backend tests**

Run sequentially:

1. `pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-dates.test.ts`
2. `pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-task-input.test.ts src/planned/planned-task-rules.test.ts`

Expected: PASS.

### Task 3: Immutable Run-Title Snapshot

**Interfaces:**

- `plannedTaskRuns.title` is a non-null `varchar(200)`.
- `queuePlannedRun` inserts `title: occurrenceContent?.title ?? plan.title` in the same transaction as run-item snapshots.
- `plannedTasks.runs` returns `title` for each history row.

- [ ] **Step 1: Add failing schema assertions**

Update `planned-tasks.test.ts` to expect the Drizzle run table to contain a non-null `title` column and update the SQL migration contract assertion to include `` `title` VARCHAR(200) NOT NULL ``.

- [ ] **Step 2: Confirm schema RED**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/planned-tasks.test.ts`

Expected: FAIL because the column is absent.

- [ ] **Step 3: Add the schema/migration/verifier column**

Add `title: varchar('title', { length: 200 }).notNull()` after `plannedTaskId` in Drizzle and after `planned_task_id` in `0045_planned_tasks.sql`. Add the same column contract to `verify-db-schema.ts` so `db:verify` rejects stale local schemas.

- [ ] **Step 4: Add failing runner snapshot tests**

Extend the executor/runner-focused test seam so these expectations are explicit:

```ts
expect(resolveOccurrenceContent(null, plan).title).toBe('当前系列标题');
expect(resolveOccurrenceContent(encodedOverride, plan).title).toBe('本次标题');
```

The saved run title must be a primitive string captured before any later plan edits.

- [ ] **Step 5: Persist and expose the snapshot**

Select `plan.title` in `queuePlannedRun`, parse the occurrence override once, insert the effective title with the run, and add `title: plannedTaskRuns.title` to the `runs` query projection.

- [ ] **Step 6: Confirm runner/schema GREEN**

Run sequentially:

1. `pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/planned-tasks.test.ts`
2. `pnpm --filter @holaday/orchestrator exec vitest run src/planned/planned-executor.test.ts`

Expected: PASS.

### Task 4: Editor End Control and Run-History Title

**Interfaces:**

- `EditorState.endsOn` is `string | null`.
- `nextPlannedEndState(repeatType, currentEndsOn)` clears on `once` and preserves for repeating modes.
- `plannedEndsOnPayload(editScope, endsOn)` returns `{}` for occurrence edits and `{ endsOn }` for future/series/create saves.

- [ ] **Step 1: Add failing frontend state tests**

Add tests such as:

```ts
expect(nextPlannedEndState('once', '2026-08-31')).toBeNull();
expect(nextPlannedEndState('weekly', '2026-08-31')).toBe('2026-08-31');
expect(plannedEndsOnPayload('occurrence', '2026-08-31')).toEqual({});
expect(plannedEndsOnPayload('future', null)).toEqual({ endsOn: null });
```

- [ ] **Step 2: Confirm RED, implement helpers, confirm GREEN**

Run before and after:

`pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-task-state.test.ts`

- [ ] **Step 3: Extend API row/editor/run types and initialization**

Add `endsOn: string | null` to plan rows and editor state; initialize new editors to `null`, existing editors from `plan.endsOn`, and run rows with `title: string`.

- [ ] **Step 4: Build the in-plane end control**

For non-`once` repeats, render `永不结束` and `结束日期` buttons. Selecting the date mode seeds an empty value from the editor start date and reveals `<Input type="date">`. Selecting never sets `endsOn: null`; selecting `once` calls `nextPlannedEndState` and hides the control.

- [ ] **Step 5: Send scope-correct payloads and display run titles**

Spread `plannedEndsOnPayload(editScope ?? 'series', editor.endsOn)` into update payloads and `{ endsOn: editor.endsOn }` into create payloads. Render `run.title` as the primary run-row label and the scheduled time/progress as secondary metadata.

- [ ] **Step 6: Add restrained CSS and run targeted web tests**

Reuse the existing segmented-button vocabulary and add only focused `.planned-end-*` and run-title rules.

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/planned-task-state.test.ts`

Expected: PASS.

### Task 5: Local Schema Alignment and Sequential Gates

**Interfaces:**

- Fresh databases receive the complete modified `0045` definition.
- The current local MySQL is aligned without creating a second migration file.
- No production database is touched.

- [ ] **Step 1: Inspect local column state**

Run a read-only `INFORMATION_SCHEMA.COLUMNS` query for `holaday.planned_task_runs.title`. If absent, continue with the exact local alignment below; if present and non-null `varchar(200)`, skip the mutation.

- [ ] **Step 2: Align only local MySQL**

Execute sequentially against the `holaday-mysql` container:

```sql
ALTER TABLE planned_task_runs ADD COLUMN title VARCHAR(200) NULL AFTER planned_task_id;
UPDATE planned_task_runs r
JOIN planned_tasks p ON p.id = r.planned_task_id
SET r.title = p.title
WHERE r.title IS NULL;
ALTER TABLE planned_task_runs MODIFY COLUMN title VARCHAR(200) NOT NULL;
```

- [ ] **Step 3: Run targeted planned-task suites**

Run backend planned-task tests, then the frontend planned state test. Do not run them concurrently.

- [ ] **Step 4: Run full verification sequentially**

1. `pnpm --filter @holaday/orchestrator test` outside the restricted loopback sandbox if required.
2. `pnpm --filter @holaday/orchestrator db:verify` against local MySQL.
3. `pnpm --filter @holaday/web-workbench test`.
4. `pnpm --filter @holaday/orchestrator build`.
5. `pnpm --filter @holaday/web-workbench build`.
6. `git diff --check`.

- [ ] **Step 5: Review delivery boundaries and sensitive paths**

Confirm `git status --short`, inspect the changed-path list, and verify no changes under TaskStream/evidence/result/trust/payment/browser/stock/image/video areas or the preserved unrelated untracked paths. Report local-DB mutation separately. Do not commit, push, merge, or deploy.
