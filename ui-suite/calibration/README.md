# Detector calibration

`pnpm test:ui-suite` runs the committed negative and positive fixtures. The frozen full run at 935348a4 passed 51/51 framework tests. The calibrated code at ff1e30d9 passed 55/55; final execution details are in `../validation.md`.

The real 434417b4 frontend was also opened with the same local seed. Its skill picker menu is below the surrounding dialog: the detector reported three occluded controls (search, automatic match, and the seeded skill). Applying a temporary **in-memory CSS override only** to the menu and portal wrapper made those three occlusion findings disappear. No product source was changed and this is not a delivered frontend fix.

- [Original lower menu: red](skill-menu-before.png)
- [Temporary CSS calibration: green](skill-menu-after-temporary-css.png)

Other committed regressions cover native fullscreen, native dialogs, nested portals, closed details, no-op buttons, page changes, pagination identity, checkbox/selection distinction, deterministic visual differences, wrong task copy, local popup navigation (including the pre-frame race), and finite browser ownership/stream/checkpoint contracts. A passing detector fixture does not make the candidate UI pass its release gate.

Native label calibration: direct clicks on 1px `sr-only` inputs failed. Normal clicks on their visible wrapping/associated labels toggled the actual frontend settings switch and stock checkbox from false to true. The implementation now follows that visible pointer target and still applies normal Playwright occlusion checks.

- [Settings label click](settings-label-click.png)
- [Stock preference label click](stock-label-click.png)

New negative/positive fixtures also ensure an already-selected video category is idempotent while an inactive category must change state, and only the exact disabled-editor 403 request/console message is whitelisted. Unknown paths, statuses and arbitrary console errors are not excused.
