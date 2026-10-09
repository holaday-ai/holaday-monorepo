# UI regression suite — validation ledger

状态：实现、完整基线、局部校准及前端检查均已完成。**产品发布门禁仍失败**，实际 P1 需由前端修复后重跑；本任务不合并、不部署。

## Frozen full baseline

- Product frontend: `434417b42711c6cf2251787cdd86fee3aa407c6e`; no frontend product source was changed.
- Suite commit: `935348a472a77852ff0fd5636a981de4d8a5e806`.
- Started `2026-10-09T16:46:04.243Z`; finished `2026-10-09T19:31:42.619Z` (165m38s).
- **240/240 unique route × width scenes**: 60 route patterns plus 20 mode/status combinations, each at 1440 / 1280 / 1024px. All 240 screenshots and baseline metadata files exist.
- **0 coverage gaps**. Exit 1 / gate **failed**, with 1,044 raw signals (660 P1, 384 P2). These are repeated observations, not 1,044 distinct confirmed defects.
- 15,864 control records: 5,300 passed actions; 252 already-current/idempotent; 9,403 explicit shared references; 705 disabled prerequisites; 39 protocol links; 165 failed actions. Shared references and disabled prerequisites are not successful clicks.
- Frontend source hash: `345eb8b47855551898ea5f1e0f49e55e1b9ac197ce1d7262fea418b0fc5243a4`.
- Suite source hash: `e292454956ec4f6b4097c5fb0a8fffb8f494633c6a392c4de9487d2654a69a31`. All 13 frozen source/test hashes still matched after the run.
- [Original full JSON](report.json), [full Markdown](report.md), [240 initial screenshots](baselines/README.md). Interaction evidence remains under local `artifacts/` (not all large images are committed).

## Detector calibration and independent reproduction

The frozen full report is retained unchanged. It predates three narrow detector corrections; the follow-up below is separate evidence and must not be described as a second complete 240-scene run.

- Hidden native checkbox/switch inputs: click their visible associated label using a normal Playwright click. No force-click or direct state mutation. Independent actual-frontend reproduction changed the notification switch and stock preference checkbox from false to true through their labels; direct 1px input clicks timed out.
- Already-selected video style category: source-confirmed active tab is idempotent and gets a selected-semantics advisory. Other categories still need an observable effect.
- Default-off editor: only the exact `videoEditing.getProject` pathname, editor scenario and HTTP 403 are allowed, including query parameters. The actual Chromium console line is tested; arbitrary error text, other paths, routes and statuses remain failures.
- The three original calibration tests were red, then green. Final framework tests: **55/55 pass**, serial (32.6s). Log: `/private/tmp/holaday-tasks/ui-suite-final-tests.log`.
- Real frontend layer calibration: original skill menu yielded three occluded controls; a temporary in-memory CSS change yielded zero. [Before/after](calibration/README.md). This is detector validation, not a shipped product fix.
- Independent deletion reproduction: New scheduled task → intent “UI audit” → Create → event → Delete scheduled task → Escape; confirmation remains visible after one second. [Screenshot](../frontend-audit-1/evidence/schedule-delete-escape.png).
- Independent scroll reproduction: `/schedule` → month view → main scroll container `scrollTop=100`; header create button moves to y=19.75 and collides with global controls. [Screenshot](../frontend-audit-1/evidence/schedule-header-overlap-current.png).

## Follow-up validation

- Frozen calibration commit: `ff1e30d9b357c7d499335f47f1604cb108030a49`.
- **27/27 unique affected scenes** (six settings entries, stocks, video, video editor × three widths), completed `2026-10-09T20:36:08.257Z`. [Separate report](calibration/followup/report.md). The only coverage gap is deliberate case filtering. Exit 1 / gate failed: 546 raw signals (457 P1, 89 P2), not distinct defects.
- All 99 hidden stock checkboxes and 18 DailyBriefing switches passed through normal visible-label clicks. All three selected video categories were correctly idempotent. All three editor scenes had zero issues. Six remaining failed clicks are obscured settings navigation entries, documented in the handoff.
- All 27 visual comparisons are below 1%; maximum changed-pixel ratio `0.0001637777` (about **0.0164%**). These scenes are a calibration follow-up, not a complete rerun at the new suite commit.
- Frontend Vitest: **280 files / 2,645 tests passed**, one fork worker, 110.17s. Typecheck and lint: **passed, exit 0**. Vite build: **passed, 12.38s**, existing chunk-size warning only.
- **9/9** repeated screenshots for `/stocks`, `/schedule`, `/skills` × three widths completed at `2026-10-09T20:39:35.735Z`; **zero differing pixels**. [Separate visual report](calibration/visual-repeat/report.md). Exit 1 remains expected for deliberate route filtering/screens-only mode and 16 existing geometry signals; this is not release acceptance.
- Runtime source/test freeze checks still match after all verification. Product frontend source remains byte-identical to 434417b4. Build hash: `f8a3ea427b5f5777cb14e3d583db14c25f1ba974ef442403464ca0cffd632e39`; calibrated suite source hash: `ea71676782cf114c00ae00a876a49cbe5752c749e823d8a580c9c6feda616395`.
- Node `22.23.3`, Chromium `147.0.7727.15`, Darwin; locale `zh-CN`, timezone `Asia/Shanghai`, viewport height 960, fixed date and reduced motion. Heavy checks ran serially, with a 1536 MiB Node heap cap, one test worker and a two-renderer Chromium cap.
- [Saved logs and freeze manifests](verification/README.md), [machine-readable evidence manifest](evidence-manifest.json). Full and partial reports retain their original run commits even when a later documentation-only delivery commit is pushed.

Commands used (from repository root with the Node 22 binary first on `PATH`):

```bash
NODE_OPTIONS='--max-old-space-size=1536 --v8-pool-size=1' UV_THREADPOOL_SIZE=1 GOMAXPROCS=1 pnpm ui:audit --update-baseline
NODE_OPTIONS='--max-old-space-size=1536 --v8-pool-size=1' UV_THREADPOOL_SIZE=1 GOMAXPROCS=1 pnpm test:ui-suite
pnpm --filter @holaday/web-workbench exec vitest run --maxWorkers=1 --minWorkers=1 --pool=forks
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench lint
UI_AUDIT_CASES='["/settings/appearance","/settings/api-keys","/settings/memory","/settings/notifications","/settings/account","/settings","/stocks","/video","/video/edit/:projectId"]' UI_AUDIT_WIDTHS='[1440,1280,1024]' UI_AUDIT_OUTPUT="$PWD/ui-suite/calibration/followup" pnpm ui:audit
UI_AUDIT_ROUTES='["/stocks","/schedule","/skills"]' UI_AUDIT_WIDTHS='[1440,1280,1024]' UI_AUDIT_OUTPUT="$PWD/ui-suite/calibration/visual-repeat" pnpm ui:audit --screens-only --skip-build
```

All commands used the same bounded Node environment. The full matrix is frozen at 935348a4; the framework tests, affected-scene follow-up and visual repeat used ff1e30d9. `--skip-build` was used only while its exact candidate/source stamp matched.

## Interpretation and limits

[Confirmed new issues and known-nine comparison](../frontend-audit-1/extra-from-suite.md) distinguish defects from raw detector signals. The release gate remains red for actual P1 issues including hidden skill menus and conflicting header controls. This PR changes the inspection framework, inventory and deployment checklist; it does not fix product UI or modify `codex/frontend-audit-1`.

Static candidates, shared references, disabled prerequisites, synthetic request effects and real backend correctness are different evidence classes. The finite fixture is not a production backend. Long-running model progress, actual notifications policy, real tenant isolation, licensed media editing and external site availability are not certified. Browser panels render a synthetic 960×600 stream over the real frontend protocol. External links are locally fulfilled at the requested URL; no real account is used.

Geometry signals require triage for intentional overlays, scroll-recoverable content and tooltip-backed collapsed navigation. Curated screenshots support confirmed issues; the raw ledger stays available for investigation. Baseline creation is not a successful visual comparison and never clears existing P1 findings.
