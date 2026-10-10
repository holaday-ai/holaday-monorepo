# Round 3 validation

The harness and unchanged frozen visual baselines originate from PR #261 (`4b324572`). The product candidate is the current #260 worktree. No production account, real backend or remote browser is used.

Five product regressions are explicitly asserted in `lib/round3-checks.mjs` in addition to the existing generic traversal. They check dialog-menu hit targets/layers/dismissal/selection, settings and calendar scroll offsets, Escape without deletion, and energy heading/description geometry at 1440/1280/1024.

The final results and local screenshots are recorded in `/private/tmp/holaday-tasks/frontend-audit-1/round3/report.md`. A filtered run is diagnostic only; the full 240-case matrix is required. Existing visual baselines are not automatically updated to erase differences.

## Scroll-clipping detector calibration

The initial full run was interrupted on a cancelled browser task overlap signal. Independent normal clicking and DOM bounds showed a scroll clip ending at y=806 while the composer begins y=807. Raw hidden button bounds extended to y=824.5. A new real-Chromium test first failed on that false positive, then passed after the detector began comparing visible rectangles. The same test still requires P1 for a genuinely overlapping visible textarea. No threshold, route exemption, baseline or hit-test rule was relaxed. Evidence and interrupted run are retained in the round3 report directory.

## Settings anchors and intentional overlays

The next full run exposed a real settings hash-anchor clearance problem. All eight sections now have dedicated anchor-clearance assertions. The old full run is preserved in `diagnostic-settings-anchor` and is not accepted.

Actual scrolling and normal clicking also demonstrated two detector false positives: normal document flow beneath an opaque pinned navigation, and a dismissible fixed live notification over a lower control. New failing-then-passing Chromium cases distinguish those from fixed/sticky peer collisions and non-dismissible obstructions. The notice test requires discovery and execution of the underlying control after dismissal, so coverage is retained. No numeric geometry threshold or visual baseline was relaxed.

The stocks case additionally supplies missing quotes through an exact loopback tRPC override, asserts that empty breadth bars are absent, then removes the override before normal traversal. Reference-source screenshots use a local Eastmoney-domain fixture; the external site is never accessed.


The full run also caught real energy-card controls underneath the page's persistent task dock. The product now gives the dock a separate desktop layout row and clips scrolling content above it. A three-width regression first failed against the old layout, then passed after the fix; this is a product change, not a detector exemption. The interrupted run is retained in `diagnostic-energy-dock/`.

The energy diagnostic also exposed an idempotence false positive for the already-current navigation button. The runner already recognizes current-route links; it now recognizes `aria-current="page"` router buttons too, excluding disclosures/popups. A Chromium negative-control test still fails inactive dead navigation and broken current-page disclosures, and requires the functional Projects disclosure to be clicked.


A real-component Chromium regression also proves ConfirmDialog cancellation in native fullscreen, restoration to body after leaving fullscreen, and Escape without confirmation. The body-only portal failed this test; the component now follows fullscreenchange. This fixture is component-browser evidence, separate from the application's seeded full matrix. The interrupted pre-fix full run is kept in diagnostic-fullscreen-review and is not accepted.


The full matrix additionally found real stock research-summary/button overlap caused by a legacy absolute-position rule. Desktop suggestions now use normal flow; the fold retains its durations while using intrinsic grid height rather than a clipping 390px cap. Three-width assertions cover selecting a suggestion, expanded editing, collapse and reopening. Original failures are preserved in diagnostic-stock-suggestions; the remaining-page diagnostic is not full acceptance.


The completed remaining-page diagnostic (30 cases, two widths) found 32 P1 signals, grouped into actual creative-header transparency, video upload/remove hit-area overlap, image textarea/action overlap, occluded legacy-plan menu, an already-current Today button without state, and non-collapsing batch disclosures. Desktop layout and controls are fixed; three-width normal-click regression checks were red before and green after. The date-input signals were reproduced by filling the existing seed date again: a new positive/negative browser test now changes that value and still rejects an input that discards edits. No route, baseline or numerical threshold is exempted. The diagnostic remains non-acceptance evidence in remaining-diagnostic/.

The next completed unfiltered run reached 240/240 with six P1 signals and zero coverage gaps. Four signals were the 1024 browser text helper covering the activity-log button in executing/waiting tasks; two were already-selected schedule defaults lacking pressed semantics. Desktop activity controls now reserve a row above the helper in both rendering paths, and repeat/reminder options expose their selected state. Nine three-width product paths failed before and passed after: input/send/log expansion/closure and exclusive schedule selection. They run within the full matrix. The failed complete run remains in diagnostic-browser-input-overlap; it is not the final gate.
