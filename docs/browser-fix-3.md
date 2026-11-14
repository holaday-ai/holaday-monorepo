# Browser fix 3: verify the whole loop

This branch addresses the seven Deploy-20 failures. It does not change production
configuration, deploy, merge, migrate data, or use a real model during validation.

## Changes and evidence boundaries

| Failure | Change | Regression coverage |
|---|---|---|
| B01/B02 completion evidence | Decode observed page fields, retain bounded observed passages across reads, and give concrete correction feedback. Navigation still requires a fresh read before completion. Unobserved text is rejected. | JSON escaping, earlier chunks, table cells, fabricated evidence, navigation invalidation. |
| B01/B02 additional live findings | Read-only links/tables require the same document, not a completely static DOM. View-count `B` is not interpreted as download bytes. | Live-updating unrelated DOM; billion-view count versus download receipt. |
| B03/B04 effect attribution | Track requests initiated by the operated control and its async continuations. Passive navigation/read/scroll traffic is recorded without pausing. No site-specific POST allowlist is needed. | Immediate/delayed/async writes, cached fetch, select changes, unrelated background requests, writes arriving after another action. |
| B03 lost pending effect | Await and persist the pending effect diagnostic before the loop's early return. | Real runner test checks the saved method, URL and trigger branch. |
| B05 form constraint | Interpret the boolean in a structured form receipt. Retain conservative checks for malformed receipts, contradictory submit actions, and legacy prose. | `submitted:false`, true, malformed and contradictory cases. |
| B06 iframe | Return same-origin child trees with frame-specific revisions; accept actual `f1e2` references only with frame context. Mark cross-origin parent-snapshot limits. Preserve coordinate confirmation. | Real same-origin frame click, cross-origin omission and ref parsing. |
| B07 scrolling | Scroll the visible scroll surface, including inner containers. Wait for asynchronous content at the boundary. Reuse the same logic for bounded scrolling and reject completed infinite-scroll claims without growth. | Delayed inner-container loading, no-growth completion rejection, bounded scrolling. |
| Long-page section identity | Expose a bounded heading outline and allow `get_page_text(section=N)` with document-bound pagination. This avoids confusing a repeated contents label with the actual section. | Requested section excludes the introduction and following section; cursor reads the full selected section. |

The original server's exact B03 request and B07 network cause were not available
in its saved evidence. The branch does not invent those causes: it fixes the
reproduced contract and execution gaps, preserves future diagnostics, and checks
the relevant behavior locally against real public sites.

## Repeatable full-chain command

```bash
pnpm browser:loop-audit --out /absolute/output/directory
pnpm browser:loop-audit --live --out /absolute/live-output/directory
```

The default command is deterministic and network-free except for its own loopback
fixture server. It is the first step in `release:check`, alongside `route:audit`
and `blocker:audit`. The live mode exercises the public sites; if the-internet is
unavailable, its source is explicitly labelled as a local replica. It never
labels a fixture as a live website. The local iframe fixture checks frame reading
and alerts, not TinyMCE's hosted service or editing subscription.

Both modes use a scripted `MessagesAdapter`, the real
`runUnifiedSupercarTask` / `runUnifiedBrowserLoop`, the action gate, evidence
ledger, completion rules, `verifyAndFinalize`, and final-status derivation.
The script does not replace these components with predetermined successful
results. A runner failure or verifier failure fails the case.

`--case core-03,core-04` restricts a diagnostic run. `--source /path/to/src`
selects a source snapshot for a before/after comparison. Normal use leaves this
unset. The keyless runner imports application code from an empty temporary
working directory so it does not load developer environment files. Database and
Redis endpoints are inert local placeholders; no persistence functions run.

Each run writes `results.json`, per-case actual calls/ticks/receipts, progress,
and a final screenshot. Long-page success requires `end=true`. Search results
must be distinct videos, excluding thumbnail duration links and playlist counts.
Video metadata uses the current video's accessibility labels, not animated
counter digits or recommendation dates. Infinite-scroll success needs five
receipts and actual new content.

## Validation interpretation

The historical executor-only 7/7 was insufficient. A comparable whole-loop run
on the Deploy-20 source snapshot passed 2/7 before these changes. Local regression,
live-site and final backend results are reported separately in the PR and the
delivery report; none is presented as production deployment or real-model
acceptance. The real-model run belongs to `LOCAL-MODEL-EVAL-1` after delivery.

All heavy checks run serially with Node 22.23.3, a 3 GiB Node heap and one worker.
The backend runner records a silent file after ten minutes and resumes only the
remaining files; it does not replay already completed tests.
