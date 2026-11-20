# UI Regression Suite implementation plan

Goal: repeatable local seeded UI release gate for every route and interactive control at 1440, 1280 and 1024px; JSON/Markdown evidence, screenshots and visual comparison; initial findings against 434417b4.

Spec: /private/tmp/holaday-tasks/UI-REGRESSION-SUITE.md. The user explicitly requests implementation, branch delivery and a draft PR. Execution is serial in this isolated worktree. No production login, deployment, SSH or secret files.

## Design and decisions
- Reuse route/control discovery principles from existing e2e tools, but keep this harness isolated from their production auth workflow.
- Serve the unmodified candidate frontend and a loopback-only seeded HTTP/WS backend. Unknown API contracts fail explicitly and become coverage gaps; never return generic success to hide unsupported routes.
- Inspect all page/control identities. Record observable interaction outcomes, explained disabled states and explicit uncovered states; gaps cannot be counted as passes.
- Record geometry findings with explicit intentional overlay handling, terminal/type consistency, real popup URL checks, console/rejection/network issues and baseline diffs.
- First run reports real existing UI failures; framework tests prove detectors go red on broken fixtures and green on corrected fixtures. This PR does not fix UI owned by frontend-audit-1.
- Baselines are explicit, candidate-SHA-bound, width-bound and fixture-version-bound; missing or changed baseline is never silently accepted in verify mode.

## Tasks
1. [x] Build inventory generation and seeded backend contracts; unit tests first for route gaps, unsupported RPC and local-only request policy.
2. [x] Build observable control/geometry/console/visual auditors; red/green browser fixtures for dead buttons, clipping, overlap, escaped dropdowns, popup blank, stale terminal labels and pixel differences.
3. [x] Add pnpm ui:audit orchestration, all routes and states, serial widths, local safety, deterministic screenshots, Markdown/JSON gate report and deployment-template integration.
4. [x] Run 434417b4 candidate, triage P1/P2/P3 against known nine issues; write frontend-audit-1/extra-from-suite.md and preserve evidence.
5. [x] Verify unit/browser tests, frontend checks and clean source scope; commit, push own branch, create draft PR and attach it.

## Review focus
Mutation detection must not confuse a no-op with a click. Generic query mocks must not fake feature success. Intentional overlays must not cause blanket geometry exemptions. Uncovered routes/states and swallowed exceptions must make coverage incomplete. Screenshot baseline creation must be explicit and independently distinguishable from a passed comparison.

## Ledger
- Task-file scope is the approved implementation brief; continuing without repeating authorization. No parallel agents or heavy parallel execution.

## Delivery

Draft PR: https://github.com/holaday-ai/holaday-monorepo/pull/261. Runtime verification is frozen at 935348a4 (full matrix) and ff1e30d9 (calibration). Complete evidence was pushed and the remote SHA was verified. The product release gate remains red; see validation.md.
