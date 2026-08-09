# Browser Workbench Design QA

## Scope

- Viewport: 831 x 1134 compact desktop workbench.
- Reference: the supplied Codex-style three-plane workbench screenshot.
- Core states: browser open, browser collapsed, browser fullscreen, task complete, live task, manual takeover, cross-origin navigation, and browser error page.

## Visual Comparison

- Compared the reference and implementation side by side at the same 831 x 1134 app viewport.
- Sidebar, task stream, and browser render as sibling layout planes; the browser does not overlay or dim the task stream.
- Open state uses a 64 px navigation rail with balanced task/browser widths.
- Collapsed state restores the full sidebar and full-width task stream without leaving a reserved browser gutter.
- The browser canvas fills its available height; there is no thumbnail-sized page or unused lower region.
- Toolbars, account controls, divider handle, result cards, and composer remain separated without overlap.

## Interaction QA

- Created and reran a real browser task against a live page.
- Verified address-bar navigation, refresh, manual takeover, fullscreen enter/exit, collapse/restore, and completed-session recovery.
- Verified renderer-changing navigation and browser error pages reapply the latest live viewport.
- Verified static pages remain connected without false hard restarts.
- Verified the task stream remains readable and scrollable while the browser is open.
- Browser console showed no application errors; development diagnostics were the only warnings.

## Automated Gates

- Web: 114 test files and 896 tests passed.
- Orchestrator: 211 test files and 3608 tests passed.
- Web typecheck, lint, and production build passed.
- Orchestrator typecheck, database schema verification, and production build passed.

## Residual Notes

- Compact desktop intentionally switches the full sidebar to an icon rail while the browser is open. Closing the browser restores the original full sidebar.
- The browser remains an execution workspace rather than a replacement for the task result and evidence record.

final result: passed

---

# Stock Discovery Editorial Layout Design QA

## Comparison

- Source visual truth: https://www.perplexity.ai/discover/top
- Source screenshot: `/private/tmp/perplexity-discover-reference.png`
- Implementation: https://hd-app.orangebench.tech/stocks/discovery?rev=7146c34c
- Implementation screenshot: `/private/tmp/holaday-discovery-7146c34c.png`
- Viewport: 1280 x 720 CSS px at 1x density.
- State: loaded desktop discovery feed with real production data.

## Full-View Comparison

- Perplexity uses a horizontal lead story at 616 x 250 with a right-side 292 x 195 cover, followed by three equal cards with 195 x 130 covers.
- Holaday now uses a horizontal lead story at 912 x 280 with a right-side 400 x 278 cover, followed by three equal cards with 291 x 194 covers.
- The implementation no longer forces the lead story to match a separate column's total height. There is no giant blank region, non-proportional image stretch, or horizontal overflow.

## Focused Region

- Layout: one full-width lead story followed by three equal supporting stories in natural document flow.
- Image quality: supporting covers use a stable 3:2 frame and `object-fit: cover`; the lead cover fills its bounded media column without changing aspect ratio.
- Typography: Holaday's existing design tokens are retained while the lead and supporting story hierarchy follows the reference.
- Spacing: 16 px gaps separate the lead and supporting grid without nested-card effects.
- Content: real source-backed production news and announcement data remains unchanged.

## Comparison History

- Initial P1 mismatch: the lead card and image were forced to the combined height of the right-hand story column.
- Fix: replaced the equal-height two-column priority grid with one bounded lead row and a three-column supporting row; removed the 468 px minimum height.
- Post-fix verification: production measurements confirm a 280 px lead and 3:2 supporting covers.

## Findings

- No actionable P0, P1, or P2 mismatch remains for the requested discovery-layout correction.

## Interaction QA

- Real production data loaded across all discovery categories.
- Browser console contained no application errors.
- No horizontal overflow was detected.
- Existing card and detail interactions were not changed by this layout correction.

final result: passed
