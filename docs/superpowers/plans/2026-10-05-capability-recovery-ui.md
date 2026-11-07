# Capability Recovery UI Integration Implementation Plan

**Goal:** Integrate the approved HOLADAY preview appearance into the real frontend without removing current capabilities or changing backend contracts.
**Architecture:** Retain route components, business handlers, stores and API clients; add shared visual tokens and narrowly scoped presentation classes, then adapt page composition only where existing data and controls remain intact.
**Tech Stack:** React 18, TypeScript, React Router, Tailwind, Radix, Vite, Vitest.
**Spec:** User request on 2026-10-05 and approved sidebar-preview artifacts; stocks editorial experiment was explicitly rolled back.

## Ownership and constraints
- This chat owns frontend UI implementation and local verification on codex/capability-recovery-ui.
- HD主线优化3 owns eventual deployment, not this worktree. Claude Code owns independent code review.
- Base: claude/capability-recovery at 85329cb3; 2223898f..85329cb3 changes only an ops test, frontend identical.
- Do not edit backend, deploy scripts, migrations, environment files, production server or database.
- Preserve all existing sidebar entries and routes, model management, system self-check, refund/retry, browser live viewport, A-share overview and plugin compatibility surface.
- Preserve route /plugins -> /skills from baseline; do not invent backend plugin functionality.
- Preserve Today Energy approved assets. Do not move static sample state, balances or dates into real components.
- Serial bounded validation; logs outside source. No release. Hand off to Claude Code/Cowork after completion.

## Review focus
- Sidebar collapse and browser adaptive collapse must not hide essential actions.
- Project navigation must not silently remove unrelated global task history.
- Image/video selection/settings/attachments/quote/submit handlers must remain wired.
- Refund/retry states and admin route access must remain exactly functional.
- Mobile layouts, dark dialog portals and reduced-motion preferences must remain usable.

## Tasks
- [x] Baseline: establish isolated checkout/dependencies; snapshot route and protected-file hashes; run targeted baseline tests.
- [x] Shell: AppShell.tsx, Sidebar.tsx, presentation CSS and existing sidebar tests. Shared floating 24px sidebar, 16px desktop inset, consistent light/dark dimensions, full-row project disclosure, existing feature navigation and quota/admin controls retained.
- [x] Creation: InputArea/empty-workbench visual presentation; video/image page-scoped dark surfaces, purple translucent selected controls and existing model/settings/submit workflow.
- [x] Content: PageShell and scoped skills/files/project/planned/stocks visual hooks; actual data/API controls retained. File badges use type labels, project/task spacing matches approved preview, calendar status color stays semantic.
- [x] Verification: affected tests, frontend typecheck/lint/build, protected API/backend diff check and local browser checks. Fix regressions; document remaining gaps honestly.
- [x] Delivery: one branch with audit diff, screenshots, acceptance matrix and commit references. No deploy or merge; reviewer is Claude Code as specified by user.
