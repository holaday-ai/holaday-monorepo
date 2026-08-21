# Eval Origin Lifecycle Isolation Design

## Problem

PR #112 gave server-signed eval sessions an `eval` task origin and isolated task creation,
listing, detail reads, follow-up parents, and reply ownership checks. Generic lifecycle
controls still rebuild `TaskRepository` with its default `user` origin, while
`TaskRepository.rehydrateInFlight()` reads every active origin. An eval session that knows a
product task ID can therefore pause, resume, or confirm the product task. Restart recovery can
also rehydrate eval rows through the default product repository.

## Root cause

`TaskRepository.taskOrigin` is currently applied only when inserting a task. The active-task
rehydration query is origin-agnostic, and the generic control routes do not pass the trusted
`ctx.taskOrigin` into their repository instances. Direct abort ownership checks are pinned to
`origin='user'` rather than the authenticated origin.

## Required behavior

- A repository created for `user` rehydrates only active `user` tasks.
- A repository created for `eval` rehydrates only active `eval` tasks.
- `pause`, `resume`, `confirm`, and `abort` operate only on the authenticated
  `ctx.taskOrigin`.
- Internal reply persistence keeps the same authenticated origin on every repository instance.
- `smokeTest` writes using the authenticated origin so an eval diagnostic cannot pollute product
  history.
- Product-only UI and paid-video operations remain explicitly pinned to `user`; eval traffic
  must not unlock billable video confirmation or user history-management controls.
- No schema, migration, production data backfill, secret, feature-flag, billing, AkShare,
  DivineAPI, Translator, or OpenAI-key change.

## Implementation boundary

Add the origin predicate at the active-task rehydration boundary, then pass
`ctx.taskOrigin` through generic lifecycle repositories and the abort ownership query. This is
the smallest change that closes the observed cross-origin control path without rewriting every
internal task mutation. Task external IDs remain globally unique; after an origin-scoped
ownership/rehydration read, existing guarded mutations continue to operate on the already
authorized task ID.

## Verification

- Real-MySQL repository integration proves user/eval rehydration separation.
- Real HTTP+tRPC integration proves an eval token cannot pause or abort a user task and can
  control its own eval task.
- Existing confirm, batch-confirm, list/detail, JWT, middleware, and repository tests remain
  green.
- Orchestrator typecheck, build, complete test suite, and `git diff --check` pass before release.
