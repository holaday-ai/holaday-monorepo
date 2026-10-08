# User Chrome Routing V2 Implementation Plan

> **For agentic workers:** Execute serially with superpowers:executing-plans. User authorized implementation in BROWSER-PR2.md.

**Goal:** Version-bound real target descriptions unlock safe selected-Chrome actions and identity-aware routing.
**Architecture:** Shared protocol v2; extension prepares a unique pinned target and consumes its ticket once after DOM/version/origin revalidation. Both Chrome and OTA reuse the unified action gate and Chrome observe/act/tab port. Routing never silently replaces identity-required Chrome with cloud.
**Tech Stack:** TypeScript, Zod, playwright-crx, Vitest, local Chromium extension harness.
**Spec:** /private/tmp/holaday-tasks/BROWSER-PR2.md and browser-parity/plan.md B1/C/D contracts.

## Global Constraints
- Base ed9a029b, branch codex/user-chrome-routing-v2, USER_BROWSER_ROUTING_V2 default false.
- No deploy, production changes, SSH, force push, secret files or account login.
- Single agent; serial bounded tests with logs; exact-origin grants and protected unrelated tabs.

## Review Focus
- Multiple matches never resolve via first(); stale ticket cannot activate a replacement.
- Focused Enter/Space, nested frames and open shadow roots use actual target/form.
- Redirect/new-origin documents cannot be read before a new exact-origin grant.
- Offline/old extension stops with guidance and no cloud allocation.
- Cancellation, human handback and changed target revoke pending confirmation.

### Task 1: Real targets and handshake
Files: shared-types browser-user-contract/ws; browser-driver selected-target/crx-adapter; extension session/transport/bridge.
Interfaces: protocol v2 capabilities, describe(action, observationRevision) -> target ticket; act consumes ticket after fresh comparison.
- [x] RED shared command schemas, unique target/form binding, stale/ambiguous/focus tests.
- [x] Implement protocol and pinned target resolver, fail closed on version/target/origin changes.
- [x] GREEN focused tests and local repository-extension Chromium checks.

### Task 2: Shared gate and browser port
Files: unified-action-gate, selected-chrome-client/runner, OTA runner, reply lifecycle.
Interfaces: description-based gate using the same onBeforeAction; shared observe/act/confirm/tab commands.
- [x] RED normal/sensitive/missing targets, confirmation cancellation and revision tests.
- [x] Reuse gate; add scroll/select and task-only list/new/switch (no close of user tabs).
- [x] GREEN unit tests and Chromium side-effect assertions.

### Task 3: Routing and grants
Files: user-browser-routing, tasks.ts, feature-flags, local-chrome-selection, Chrome picker.
Interfaces: decide route -> cloud/user Chrome/awaiting_user; explicit public-cloud choice; exact origin selection grant.
- [x] RED cohort, flag-off, offline, public-cloud opt-in, malicious URL and origin mismatch cases.
- [x] Wire early routing before cloud pool/direct-open; guide connection/update/origin grant.
- [x] GREEN route/integration and UI tests.

### Task 4: Delivery
- [x] Full backend suite, relevant extension/shared/driver/UI suites; typechecks and builds serially.
- [x] Review diff and safety boundaries, diff --check; evidence report.
- [x] Ordinary push and draft stacked PR; attach PR. Rebase only after #248 merges.

## Execution record
- Tasks 1–3 implemented serially; protocol/gate/route RED → GREEN evidence retained in /private/tmp/holaday-tasks/browser-pr2.
- Final review strengthened submitter overrides, externally associated form fields, action-query transaction signals, source URL identity and task-tab navigation gating.
- Ruling: user explicitly requires one agent, so final review is a source self-review; no reviewer subagent.
- Ruling: preserve large-file baseline formatting; lint compared with ed9a029b and new files checked independently.
- Ruling: delivery is an authorized ordinary push + draft stacked PR; do not merge/deploy or rebase until #248 merges.
- Final backend test uses Node 22, sanitized dummy test environment, 1536 MiB old-space, one Vitest thread, bounded Chromium renderers.

- Verification: frozen-source backend 565 files / 9162 passed / 1 existing skip; Node prelude 73 passed; driver 58, extension 465, related UI 162, real extension Chromium 7 passed. All typechecks and builds exit 0; backend typecheck uses 2048 MiB after the initial 1536 MiB OOM.

- Delivery: implementation 73a15038 pushed normally; draft PR https://github.com/holaday-ai/holaday-monorepo/pull/250 created against claude/fix-unified-action-gate and attached to this chat. No merge/deploy.
