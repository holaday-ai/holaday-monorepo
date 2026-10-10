# Local UI release gate

Run from the repository root with Node 22 and installed workspace dependencies (including Playwright Chromium):

```bash
NODE_OPTIONS='--max-old-space-size=1536 --v8-pool-size=1' \
UV_THREADPOOL_SIZE=1 GOMAXPROCS=1 pnpm ui:audit
```

The command builds **this checkout's frontend**, starts one loopback HTTP/WS seed server, and drives Chromium serially. It never starts the production orchestrator, reads an `.env`, logs into a real account or contacts a remote backend. External HTTP and WebSocket attempts are blocked and reported. Unknown seed routes fail closed. No secret, payment provider or database is required.

Outputs: `ui-suite/report.md`, `report.json`, generated `inventory.md` / `inventory.json`, and `artifacts/*.png` including interaction-state evidence and visual diffs. JSON retains each control, its action path, outcome and requests. Baselines are under `baselines/<seed-version>/`.

Exit 1 blocks a release for P1 findings, runtime errors, missing/incompatible baselines, filtered runs, startup failures or coverage gaps. P2 visual/text differences are reported for review; P3 guidance is in `known-issues.md`. A red initial baseline is expected where the candidate has real defects. Baseline creation never clears those defects.

## Baselines and repeatability

```bash
# Explicit first baseline or reviewed replacement only.
pnpm ui:audit --update-baseline
# Subsequent candidate, same OS and Chromium version:
pnpm ui:audit
# Detector calibration: intentionally broken and repaired local fixtures.
pnpm test:ui-suite
```

Screenshot comparison flags >1% pixels with an RGB channel difference >30. Time, locale, timezone, viewport height (960), color scheme and reduced motion are fixed. Browser/OS/seed/width mismatch blocks comparison; candidate SHA and source/build hashes are recorded. Review image differences before updating a baseline. Fonts and browser versions affect pixels.

To audit the other frontend branch without modifying it, keep this harness and dependencies here and set `UI_AUDIT_APP_DIR=/absolute/path/to/other-checkout/apps/web-workbench` and `UI_AUDIT_OUTPUT=/private/tmp/other-ui-audit`. The runner builds that candidate, validates its source hash, and compares against these baselines. The target's existing `dist` is replaced by a local build. Use its isolated worktree; do not point at a deployment directory. This has not been claimed as a green run of an unavailable future fix.

Debugging case filter: `UI_AUDIT_CASES='["task:generate:completed", "/projects/:projectId"]' pnpm ui:audit`. This is diagnostic only and leaves a blocking coverage gap.

Debugging filters: `UI_AUDIT_ROUTES='["/stocks"]' UI_AUDIT_WIDTHS='[1440]' pnpm ui:audit --screens-only`. Filters/screens-only **always leave a coverage gap** and cannot satisfy the release gate. `--skip-build` requires an exact candidate + source stamp from a previous build.

This copy imports PR #261 at `4b324572` without changing its branch or refreshing its visual baselines. Round 3 adds product-specific P1 assertions in `lib/round3-checks.mjs`; the inherited traversal and thresholds remain intact. A documented geometry correction now compares painted bounds after scroll clipping; `tests/visible-overlap.test.mjs` proves both the prior false positive and a real obstruction. Current delivery evidence is in [validation ledger](validation.md).

## What the evidence means

- Static route/import scanning supplies candidates; actual Playwright traversal supplies observations. Conditional states not reachable from fixtures are not certified.
- All 60 route patterns and 20 task-mode/status combinations run at all three widths. Alias pages retain their own screenshots and refer to already exercised canonical controls. Canonical identities include path, query and hash so settings sections remain distinct.
- Calendar date cells are identified by visible grid position; flipping months tests the navigation but does not recursively enumerate every future date. The current visible slots and their opened controls are exercised.
- Native open dialogs and the newest nested portal participate in modal layering; native fullscreen excludes only its hidden background; descendants of closed `details` are excluded until expanded. Repeated batch clone actions exercise the first and second rows; later identical rows explicitly reference that evidence instead of unbounded recursive cloning.
- Each distinct control within its dialog/menu scope is exercised once (newly enabled controls are revisited) from a reset local seed; alternate paths to the same scoped control are deduplicated. New menu/dialog controls are explored to depth twenty, with a declared 400-control bound per page; exhaustion is a blocking gap.
- Inputs are tested individually. Disabled submit buttons needing domain-specific multi-field workflows are recorded as disabled prerequisites. This is not end-to-end purchase, login, third-party integration, or complete workflow certification.
- Menus exposing `aria-expanded` must close on a second click or Escape (inline expanded sections require the second click); their children are tested separately. Popovers/dialogs without expanded semantics must also close with Escape; the runner then restores the path from a clean seed before exploring nested controls. Ancestor replay does not repeat dismissal tests. Visible close/cancel controls are exercised separately. No silent exemption is made for broken controls.
- Pagination must append distinct row identities. Unknown row structure is a coverage gap requiring a page-specific assertion.
- Explicit display-off/transparent upload or checkbox inputs are excluded from geometry overlap; their visible controls and input actions remain tested. Scrollable containers and declared modal/menu layers avoid intentional overlap false positives.
- Unauthenticated brand assets are replaced at exactly five known logo paths with a local SVG. Logo appearance is excluded; logo layout still participates. External popup destinations are fulfilled locally **at the requested URL**. This proves leaving `about:blank`, not the remote site's availability.
- Browser tasks use a deterministic synthetic 960×600 surface over the real screencast WebSocket protocol, plus finite ownership/takeover/return and navigation contracts. This checks panel rendering and controls; it does not execute a remote browser or validate real websites.
- Partner payments/browser-data grants remain default-off. Licensed CE.SDK media rendering is not provisioned. The default-off getProject response is the backend’s explicit 403 FORBIDDEN contract, listed in the network whitelist; no SDK fetch is needed. Any other CDN fetch remains blocked and reported.

The seed server is intentionally a finite UI contract fixture, not the real backend. Backend correctness belongs to backend tests. Unknown RPCs are listed explicitly; they must be added from actual contracts before claiming their flows covered. This suite does not authorize a deployment.

External mailto/tel links are recorded as protocol-link URI checks; this suite does not launch host applications or send messages. They are separate from clicked web URLs.

Security UI fixtures use visibly synthetic credential placeholders only; they are never provisioned, usable, or read from host secrets.
