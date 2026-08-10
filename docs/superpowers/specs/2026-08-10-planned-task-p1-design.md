# HOLA DAY Planned Tasks P1 Design

## Scope

This increment completes two gaps in the planned-task feature:

1. Repeating plans can end on a user-selected calendar date.
2. Every planned-task run stores the title that was effective for that occurrence.

The selected end date is inclusive in the plan's IANA timezone. Existing scheduled-task and batch-task data remains read-only and unchanged. This increment does not expand legacy recurrence instances, redesign the calendar, migrate production data, start deployment work, or alter TaskStream, evidence, result-review, payment, browser, stock, image, or video behavior.

## End-Date Semantics

The UI and API expose `endsOn` as a date-only value in `YYYY-MM-DD` form. `null` means that the series never ends. The database continues to store `planned_tasks.ends_at` as a UTC timestamp.

The backend converts the selected inclusive date into an exclusive boundary: local midnight at the start of the following day in the plan's `timezone`. For example, `endsOn = 2026-08-31` in `Asia/Shanghai` is stored as the UTC instant corresponding to `2026-09-01 00:00:00 Asia/Shanghai`. Existing runner checks remain `nextRunAt < endsAt`, so every matching occurrence on August 31 is eligible and later occurrences are not.

Conversion and formatting are backend domain functions built on `Intl.DateTimeFormat`; they must reject malformed dates and invalid IANA timezone identifiers. The reverse conversion formats `endsAt - 1ms` in the plan timezone to recover the inclusive `endsOn` value for API responses.

## API Contract

Create accepts:

- `endsOn?: string | null`
- A one-time plan must use `null` and stores `endsAt = null`.
- A repeating plan with a date stores the calculated exclusive boundary.
- The boundary must be later than the first scheduled occurrence.

Update accepts the same tri-state field:

- `undefined`: preserve the existing series boundary.
- `null`: remove the boundary, making the series unbounded.
- `YYYY-MM-DD`: replace the boundary after timezone-aware validation.

Edit-scope behavior:

- `occurrence`: changing `endsOn` is rejected because one occurrence cannot change series lifetime.
- `future`: the old series still ends at the split occurrence; the new series receives the supplied boundary, or inherits the prior series boundary when `endsOn` is omitted.
- `series`: update the current series boundary directly.

Changing a repeating plan to `once` clears `endsAt`. Changing the plan timezone while preserving an existing `endsOn` recalculates the exclusive UTC boundary in the new timezone so the visible date does not change.

Plan responses keep `endsAt` for internal compatibility and add `endsOn` for the editor. The UI uses `endsOn`, not browser-local timestamp arithmetic.

## UI Behavior

The editor shows an end control only for repeating plans:

- `永不结束`
- `结束日期`

Selecting `结束日期` reveals a native date input. Existing plans initialize it from API `endsOn`. Switching to `不重复` clears the draft end date. Saving an occurrence-only edit omits `endsOn`; saving a future or whole-series edit includes it.

Validation errors are shown through the existing toast path. The control remains in the current same-plane editor and uses the existing visual system; no new modal or page is introduced.

## Immutable Run Title

`planned_task_runs` gains a required `title VARCHAR(200)` column. The Drizzle schema names the property `title` because it is the title of that immutable run, not a live relation to the current plan.

When `queuePlannedRun` resolves occurrence content, it writes:

- the occurrence override title when an occurrence has a content override;
- otherwise the current plan title.

The run title is inserted in the same transaction as the run and run-item snapshots. No later plan or occurrence edit updates it. The `runs` API returns this title, and the history UI displays it for each row.

For a fresh database, migration `0045_planned_tasks.sql` creates the column as `NOT NULL`. Because the local development database already applied the uncommitted version of 0045, local alignment uses a targeted `ALTER TABLE`: add nullable, backfill any local rows from their owning plan, then make the column non-null. This local repair is not added as a second numbered migration and is never applied to production.

## Error Handling

The backend returns `BAD_REQUEST` for:

- invalid `YYYY-MM-DD` values;
- invalid timezone identifiers;
- an ending boundary that excludes the first/new scheduled occurrence;
- an occurrence-only edit that attempts to change the series ending date.

Runner behavior remains defensive: a plan with no eligible next occurrence becomes `completed`; a manual run does not advance or reopen the schedule.

## Test Strategy

Tests are written before production changes and must demonstrate failure for the missing behavior.

Domain tests cover:

- inclusive end date in `Asia/Shanghai`;
- a daylight-saving transition timezone;
- reverse formatting from exclusive `endsAt` to inclusive `endsOn`;
- invalid date and timezone rejection;
- same-day execution acceptance and already-ended rejection.

Router/input tests cover:

- create, clear, preserve, future-split, and series-update semantics;
- occurrence edits rejecting `endsOn`;
- switching to `once` clearing the boundary.

Run tests cover:

- default plan title snapshots;
- occurrence-specific title snapshots;
- later plan edits not changing returned run history.

Frontend state tests cover draft initialization, repeat-mode transitions, and payload omission for occurrence-only edits.

After targeted red-green cycles, verification runs sequentially:

1. planned-task orchestrator tests;
2. planned-task web tests;
3. orchestrator full tests outside the restricted loopback sandbox;
4. `db:verify` against local MySQL after local schema alignment;
5. web full tests and both production builds;
6. `git diff --check` and a sensitive-area path review.

## Delivery Boundaries

All work stays on `codex/planned-tasks`. No subagents or parallel test jobs are used. No commit, push, merge, production migration, or deployment occurs without separate authorization. Unrelated untracked content under `.claude/`, `qa-artifacts/`, `skills/*`, and `docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md` remains untouched.
