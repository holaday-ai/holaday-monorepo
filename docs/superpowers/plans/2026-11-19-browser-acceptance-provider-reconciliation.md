# Browser Acceptance Provider Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, inline and serial as already directed by the user. No subagents.

**Goal:** Resume authorized acceptance safely after authoritative supplier completion without fabricating a lost client response or resetting its budget.

**Architecture:** A standard-library Python policy validates trusted local audit sidecars against an immutable ledger prefix. The existing private relay consumes that policy and a bounded HTTP transport; product runtime and old task drain tickets stay unchanged.

**Tech Stack:** Python3 standard library, Node22.23.3 native test runner, existing private SSH relay.

**Spec:** `docs/superpowers/specs/2026-11-19-browser-acceptance-provider-reconciliation-design.md`.

## Global Constraints

- One lane; no agents, new dependencies, paid probes, original-body/export replay, merge361 or deployment.
- Keep all14 attempts, clientunknown state and max25; preserve original credentials on the existing server.
- Python checks and Node tests run serially, logs to files; Node test heap512MB.
- Current runtime source8251bc1f and frozen candidate remain separately bound; these scripts are acceptance tooling.

## Review Focus

- A resealed malformed audit must fail structural/time/identity checks, not pass solely because a hash matches.
- A stale proof for attempt14 cannot authorize a new unknown attempt15.
- A changed cap or ledger prefix cannot gain slots.
- Deadline/cancel cannot cause a retry or leave a local child alive indefinitely.
- Metadata capture cannot store credentials, full headers or model text.

## Task 1: Evidence-bound admission

- [x] Add failing `scripts/browser-acceptance-model-budget.test.py` cases for trusted evidence, tampering, missing/ambiguous matches, unchanged cap, replay and atomic-write failure.
- [x] Observe RED using the standard unittest runner; no real ledger writes or network.
- [x] Implement `scripts/browser-acceptance-model-budget.py`: `seal_audit(ledger,audit_bytes)`, `authorize(ledger,scope,body_sha,permits=())`, `write_ledger(path,state)`.
- [x] Verify GREEN and pure dry-run against the real sealed14-row evidence with canonical ledger SHA unchanged.

## Task 2: Bounded transport

- [x] Add failing local-HTTP tests for delayed headers/body, trickle beyond total deadline, response cap, redirects and metadata projection.
- [x] Implement `scripts/browser-acceptance-model-transport.py`; remote program embeds the same tested bounded function.
- [x] Add Node child-process timeout/cancel tests, then update the acceptance-only wrapper to105s and bounded SIGTERM/SIGKILL cleanup.
- [x] Verify HTTP and child-process tests serially; zero provider requests.

## Task 3: Private relay integration

- [x] Freeze policy/transport modules and audited permits under the existing private runtime helper directory.
- [x] Replace the existing blanket unknown check with evidence-bound admission while retaining samebody replay denial, fixed cap, atomic reservation and actual-only received writes.
- [x] Set provider/SSH/Node total budgets75/95/105, retain the existing endpoint/identity/credential gates, and record only approved request-id/usage metadata.
- [x] Check blocked-path behavior and actual14-row dry-run before any new real task; retain old helpers and ledger snapshot.

## Task 4: Continue full acceptance

- [ ] Revalidate actual app/browser/session state, prepare an independent authorized case using preserved material or a new synthetic sheet, and run within remaining slots without replaying original work.
- [ ] Record actual task/file/stat/finish outcomes, elapsed time and receipts; fix only evidenced gaps.
- [ ] Continue owner-dependent AWS/KMS/physical/subject checks when available. Do not mark the fullGoal complete with any requirement unproven.
- [ ] Commit verified tooling/reports, update draftPR and durable takeover; leave production unchanged.

## Verified frontier

Tasks1-3 complete. Budget16, localHTTP7, Node9 and explicit private wiring7 checks pass (39 total); opt-out7 skip as intended. Final formatting/static checks pass. Actual fixed-directory admission is dry-run only, preserving all14 ledger rows and its SHA. No new provider request has been sent by this tooling work. Node envelope validation was observed failing before the correction; the wiring tests passed immediately, so no generated-escaping defect is claimed. Task4 remains open.

Ruling: Bind the local QA worker entry URL to its loader SHA before reusing its approved unpacked path/version. Actual Chrome loaded the exact old v3 loader despite new disk bytes; connection gate failed before any model call. Exact-origin cache cleanup API returned an internal error; no website data was cleared. A hashed QA entry passed all5 loaded-script hashes and actual registry connection. This changes only manual QA packaging, not formal plugin source/version/permissions or the product runtime. Keep failure receipts.

Ruling: The independent uploaded-file recovery draft was rejected by the existing local-Chrome-with-attachments front-end boundary (HTTP task create0, model0); do not broaden it. A different PR360 fixed JSON file native case was submitted once and failed terminally before model/input/download, with SQL preserved. A read-only exact background-clone diagnosis reproduced first EXTRACT_FAILED/stale_observation then success150ms later; stable selected page passed. Add one bounded150ms snapshot retry only for this exact error, restarting origin/lifecycle/redaction/freshness checks, never retrying actions/downloads/model calls. Cover fresh content, repeated staleness, other failures, disposal and cross-origin transition before rerunning genuine acceptance.

Ruling: Actual v5 passed startup observation and received4 responses, but one applied export produced4015 native temporary bytes (exact fixed-blob SHA) with0 taskfiles; SQL executing/unknown-persistence evidence is preserved, not replayed. A distinct3182B GitHub Download-button diagnostic captured via fetch→Blob and completed native receipt. This does not identify v5 unique cause. Local Chrome reproduces another supported path: bound anchor download with no Content-Disposition reaches a native download but cannot publish bytes. Remove that format-only prerequisite while retaining exact URL/frame/completed native receipt, original-response-only bytes, scope/focus/origin and size limits. Ordinary navigation without native receipt must never yield a file. Initial red runner accidentally skipped16 due an old name filter; corrected run has1 real failure. No claim the new path fixes the untraced v5 failure until actual evidence.

Ruling update: Removing only the attachment-header prerequisite did not repair the direct-link reproduction and made ordinary navigation wait until its test deadline. That trial is reverted. Keep all production guards unchanged while recording exact local network/receipt events; do not ship a broad response capture or claim this hypothesis proved v5 cause.

Ruling update: Exact local trace shows anchor download emits Fetch.requestPaused without Network.requestWillBeSent/networkId. The repair is restricted to an actual bound DOM a[download] URL and up to8 exact allowed redirects, same clicked frame, GET; all byte/receipt/focus/scope rules remain. Arbitrary responses still require the prior attachment+Network correlation. Ordinary navigation destroys the old Blob lease and is separately quarantined by existing behavior, so the no-receipt regression uses same-document fetch instead. This is not evidence that v5 selected this link.

Ruling: The opt-in manual App now delegates the actual SelectedChromeClient download call unchanged while recording only selector hash/known Download-label boolean, revision, enum outcome/reason and captured byte/hash metadata. No selectors, page text, URLs, cookies, credentials or model responses are stored. This prevents losing the exact receipt reason if the task exits before a later model request. Audit write failure is explicit and does not change the action result. No production logging or tool capability changes.


## Follow-up: generated output read scope (actual v6 failure)

Ruling: v6 saved the exact4409B source and correct60B CSV, but read/table calls used the exact active generated file ID and were denied because only inputs/downloads enter BrowserTaskFiles. All25 calls are counted,24received/oldunknown14 retained. No more paid calls or budget changes without explicit user authorization.

- [x] Add scope tests for a verified current-task output receipt, complete read/actual numeric analysis, generated provenance, wrong owner/task/kind/expiry/receipt, revocation race and immutable content.
- [x] Keep generated outputs in a separate read-only map. Add resolveReadable for reader/table only; existing resolve/upload and input references retain their prior authority.
- [x] Admit a generated output only after FileService reload, same active user, exact live task row ID, output kind, receipt filename/size/canonical URL, expiry and stable content checks. No generic access to all account outputs.
- [x] Supply current task row identity from the SQL scope factory, and label provenance task_generated.
- [x] Extend controlled full App/SQL/Chrome fixture to analyze its newly created CSV before finish; observe RED before wiring common onCreateFile receipt admission, then GREEN. Scripted model here is component verification, not real-site acceptance.
- [ ] Run relevant checks/current candidate work serially, freeze actual v6 evidence and fixes, and request concrete additional model budget only after independent local work is reviewable. Do not clear old task state or replay any export.

Ruling: Scope-only RED11fail/5pass then16GREEN; added subsequent task/kind/source mutation checks yielded2fail/17pass, then19GREEN. Generated files remain in a separate read-only map and resolve still denies upload. First full-App RED and first attempted GREEN had a test assertion incorrectly expecting complete on describe (only aggregate carries it); those are retained but not decisive wiring proof. Correct the assertion to actual describe/source/row receipt, persist that receipt, temporarily omit the new admission hook to observe a valid RED, then re-enable and verify GREEN.

Ruling: Corrected full-App omitted-hook RED failed with task_file_work_failed on the actual generated file ID. Re-enabling admission returned task_generated/scannedRows2, then finish exposed a separate handoff parser requiring two new files. Three targeted parser cases failed (29pass), then32pass after restricting final combined-handoff recognition to a prior original download/export. Explicit two-new-file negatives still hold. Final full-App1/1 passes actual SQL completed, original export1, generatedCSV describe, history reload/two downloads at1440/390 and owned schema cleanup; scripted model0 external calls. Relevant10-file regression312/312, targeted strict types and static pass; static retains1 verified pre-existing unused-catch warning. Initial import-order failure retained and fixed. See docs/reports/2026-11-19-browser-generated-output-scope.md. Candidate refresh, actual two-site/account/KMS/physical acceptance remain open. Budget25/25 unchanged; request new budget only after independent local work is reviewable.

Ruling: Candidate81d1948e rebuilt backend/workbench/formalextension serially; three ZIP/file manifests and1827 inputs verified. FrozenZIP UI1/1 passed Chrome157/MySQL,1440/390 dual actual downloads/8facts/foreign404, model/export0, originalSQL and25-row ledger unchanged. First path-prefix gate failure and then stale14-row assertion failure retained before DB/browser. Updated manual assertion to actual25, cap25, oldunknown14; strict/static pass. No runtime change; candidate source remains81d1948e. New independent Sheets copy37rows/58.46 prepared and fully read back, private/current connected owner, visible normal Holaday验收 Chrome confirmed; source100rows unchanged, no exports/model calls. Distinct shared-types/package.json source/oracle and prompts prepared privately. Still no additional model budget authorization.
