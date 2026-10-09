# Known frontend audit comparison

The nine reference issues come from `/private/tmp/holaday-tasks/FRONTEND-AUDIT-1.md`. This suite leaves `codex/frontend-audit-1` untouched. An automatic signal is not automatically a confirmed product defect: seed-contract failures and unsupported execution states are listed separately.

| Known issue | Local coverage and interpretation |
| --- | --- |
| 1. Stock dropdown/cards/composer overlap and clipping | Stock page at all three widths; bounding-box and hit-target checks before/after each discovered menu action. Screenshots retain open-menu state. |
| 2. Non-browser tasks show empty browser panel or Chrome prompt | Generate/scrape/image tasks in five states; browser-copy and visible browser-region checks. |
| 3. Long generation has no phase progression | Executing seeded task renders the initial state. Long-running real model progression is not certified by a static seed; investigate separately from this baseline. |
| 4. Completed task shows alarming missing-review copy | Completed tasks deliberately have no verifier verdict. The exact missing-review phrase is a P2 regression signal. |
| 5. Raw `eastmoney:stock-news-search` label | Scrape fixture supplies this technical source title through the real web-search result contract; raw visible output is a P2 signal. |
| 6. Repeated external-link confirmation / `about:blank` | Completed task links and source links are clicked, including nested confirmation controls. Popup must leave `about:blank`; its target is fulfilled locally without visiting the external site. |
| 7. Notification count/noise/read-all/grouping | 188 synthetic notices, read-all and paging controls traversed. Grouping/noise desirability needs product judgment; URI/DOM/request evidence is retained. |
| 8. Recent browser actions overlap / terminal progress stale | Browser fixture supplies twelve steps, and executing/completed/failed/waiting/cancelled states. Geometry plus terminal copy checks run separately. |
| 9. Generation failure gets browser-style advice | Distinct rate-limit, image-timeout, scrape-timeout and browser-DNS failure fixtures; non-browser browser-copy is P1. |

`report.json` is the exhaustive raw observation ledger. The final triage and new confirmed issues are recorded in `../frontend-audit-1/extra-from-suite.md`; that file does not claim that every detector signal is a verified product bug. Licensed media editing, real account permissions, real model work and production traffic are outside this local gate.
