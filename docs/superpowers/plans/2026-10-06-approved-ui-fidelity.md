# Approved UI fidelity implementation plan

> Execute serially in this session; preserve the original reference and existing backend contracts.

**Goal:** Restore all approved Holaday page layouts and motion using the final local prototype, rather than restyling the old layouts.

**Architecture:** Keep React state, routing, authorization, queries and mutations. Replace presentation composition with the prototype's structure and scoped styles. Reuse exact motion values/keyframes, approved assets and component dimensions. The approved brand override is #FF0061.

**Spec:** `/Users/yaleiqi/.codex/visualizations/2026/10/04/01a10561-f8e9-74d2-8b98-a5b54a8ed143/sidebar-preview/` final live files and DESIGN-DECISIONS.md; subsequent human instructions override older notes.

## Global constraints
- Do not modify backend, migrations, deployment scripts or production servers.
- Preserve every capability-recovery entry and operation, including admin, models, self-check, browser, quota retry, plugins and A-share freshness.
- Never copy sample data into real responses or fabricate missing backend capabilities.
- Single agent; bounded serial tests and file logs. No deployment in this repair pass.
- Record every mismatch, unimplemented prototype interaction, and unapproved page.
- Reduced motion and accessible names remain supported.

## Review focus
- Collapsed sidebar and short viewports retain all navigation and task history.
- Real data loading/error/empty states retain actions and truthful status.
- Media upload/model/quote/confirmation retain existing contracts.
- Portalled dialogs inherit route theme and restore theme on exit.
- Permissions and identity remain real; static prototype labels do not grant access.

## Tasks
- [x] Inventory final reference assets, page hierarchy and motion; freeze hashes and mismatch ledger.
- [ ] Shared shell: Sidebar.tsx, AppShell, theme CSS, account/usage menus; implement reference geometry and reversible 620ms motion. Verify full-row projects and light/dark parity.
- [ ] New task: MainPanel.tsx, InputArea.tsx; reference heading/grid/composer/tool grouping; preserve chrome, attachment, plan and execution handlers. Verify input and expansion.
- [ ] Media: VideoPage.tsx, ImagePage.tsx and composers; mode tabs, inspiration cards, model/context chips and unified prompt; verify all modes, overlays and quote/submit contracts.
- [ ] Files: FilesPage.tsx; date grouping, authenticated media thumbnails, list/grid, sort and preview. Verify controls and download/reference/delete callbacks.
- [ ] Projects: ProjectsPage.tsx, TeamProjectPage.tsx; overview covers, detail task/reference/member layout and approved avatars. Preserve workspaces, tasks and member operations.
- [ ] Planned: PlannedTasksPage.tsx and styles; month/day two-column view, timeline, tabs and dots. Verify recurring edit scope, legacy entries, timezone and execution states.
- [ ] Skills/stocks: approved catalog and restored stock layout with docked input; retain capability flows, live freshness and operational controls.
- [ ] Today Energy and remaining component surfaces: use approved assets/layout where supplied, otherwise document missing page-level reference and apply shared component rules only.
- [ ] Same-size browser comparison for every page, relevant interactions and exact motion properties; desktop + narrow viewport; log remaining differences explicitly.
- [ ] Run frontend tests (known baseline 3 failures), lint/typecheck/build and backend-contract audit. Commit deliverable and provide review evidence; do not deploy.

## Progress
2026-10-06: Base 811dd1e6; branch codex/approved-ui-fidelity. Prior eight-page comparison failed fidelity; screenshots in /private/tmp/holaday-ui-comparison. Implementation begins from the reviewed live code, not the unrelated primary checkout.

2026-10-06 checkpoint: implemented first-pass React compositions for shell, new task, media, files, projects, planned, skills and stocks. These are NOT fidelity-accepted yet. Local offline fixture runs at :4323; approved reference at :4317. No backend or deployment changes. Typecheck first pass found and corrected catalog group.items access. Remaining work includes exact layout/motion comparisons, Energy, skills detail, team project detail, media secondary modes and truthful backend capability gaps.

2026-10-06 evidence checkpoint: all eight primary page families and Energy were compared locally; source hashes, screenshot pairs and an explicit remaining-gap ledger are in `docs/ui-fidelity/2026-10-06/report.md`. Full frontend suite: 2569 passed / 3 known baseline failures; lint, both TypeScript configs and production build passed. Secondary video modes, team project composition, personal project references/members, stock research controls and complete motion/overlay acceptance remain unfinished. The unchecked tasks above remain deliberately unchecked: implementation progress is not fidelity acceptance. No backend or deployment work occurred.

2026-10-06 second repair pass: completed media secondary-mode composition and personal project attachment, compact team project layout with real members and preserved advanced controls, stock research controls and attachment contracts, Energy height/overlay motion, floating planned editor and new-task grid alignment. Full suite 2576 passed / 3 inherited failures; browser evidence and explicit remaining integration/fidelity gaps are in report.md. Checkboxes continue to denote complete acceptance, not merely implementation. No backend, push, merge or deploy.

## Final frontend closeout — user scope 2026-10-06
- Baseline 32b9ad02, remote PR #240 already merged at 811dd1e6; authorized delivery is fast-forward push to original codex/capability-recovery-ui and update closed PR body, not reopening, new merge or deployment.
- Work: project references noninteractive coming-soon state; media overlay keyboard/focus and 460ms reference motion; disclosure620ms; light library states/labels; file preview metadata/use action and scoped approved overlay geometry; local secondary/state and mobile checks.
- Backend-dependent real generation/refund/market-data validation is explicitly deferred to post-release acceptance. Pages without approved references are unchanged. Missing authorized example assets deferred without dead buttons.
- Ruling: continue single-agent, bounded serial verification per existing project constraint; final self-review with recorded evidence. Low-impact styling/copy verified in browser rather than mirror implementation tests; behavior changes receive regression tests.
- Delivery gate: fresh full frontend suite plus lint/typecheck/build; document all failures, three classified lists, push exact authorized ref, update PR #240 body.

2026-10-06 final closeout: user narrowed acceptance to frontend-only local states and explicit post-release/deferred lists. Completed scoped media/library/file/project overlays, retained planned/energy exit frames and focus restoration, guarded stale energy completion callbacks. Project-file UI is noninteractive coming-soon. Report classifies all remaining backend/no-reference/asset gaps instead of claiming universal fidelity. Final verification is recorded in docs/ui-fidelity/2026-10-06/closeout-verification.json. Earlier unchecked tasks described unrestricted acceptance; this bounded frontend round is closed without claiming that deferred acceptance.
