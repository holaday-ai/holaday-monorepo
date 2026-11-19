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
