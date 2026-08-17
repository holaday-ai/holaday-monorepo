# Stock Screening Production P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the production full-market screening universe available across cold refreshes and keep a validated same-day screening result visible while the dashboard refreshes.

**Architecture:** The AkShare HTTP layer will serve the last successful full-market snapshot during a bounded stale window and refresh it in one daemon thread, while the deployment smoke blocks until the initial real universe is warm. The web workbench will treat the server-validated result date as the display boundary: same-day snapshot-id or trust-mode changes may disable a new run but may not erase an in-flight or completed result.

**Tech Stack:** Python 3.10, FastAPI, pytest, Bash smoke tests, React 18, TypeScript, Vitest, Testing Library.

## Global Constraints

- Real market data only; never substitute mock, fixture, synthetic, or silently relaxed screening data.
- A cold production deployment must not be declared healthy until the real screening universe is populated.
- A new screening run still requires `trustMode === 'current'` and a server-validated snapshot.
- A result may survive only same-date refreshes; a different non-null trading date clears it.
- No database migration, watchlist mutation, screening-criteria relaxation, or unrelated dashboard redesign.

---

### Task 1: Stale-while-revalidate full-market cache

**Files:**
- Modify: `apps/akshare-mcp/tests/test_cache.py`
- Modify: `apps/akshare-mcp/tests/test_http_server.py`
- Modify: `apps/akshare-mcp/akshare_mcp/cache.py`
- Modify: `apps/akshare-mcp/akshare_mcp/http_server.py`
- Modify: `apps/akshare-mcp/ecosystem.config.cjs`

**Interfaces:**
- Consumes: `cached(ttl_seconds, wait_timeout_seconds)` and `_cached_adapter(ttl_seconds)`.
- Produces: `cached(..., stale_while_revalidate_seconds=...)`, which returns a bounded stale value immediately while exactly one daemon refresh runs; `_screening_universe` opts into that behavior.

- [x] **Step 1: Write the failing cache regression test**

  Add a test that primes a value, lets its fresh TTL expire, blocks the second underlying fetch with events, and proves two callers receive the old value promptly while only one background refresh runs. Release the fetch and prove later calls receive the new value.

- [x] **Step 2: Verify the cache regression test fails for the missing behavior**

  Run: `apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_cache.py -q`

  Expected: FAIL because `cached` does not yet accept or implement bounded stale-while-revalidate behavior.

- [x] **Step 3: Implement the minimal cache behavior**

  Extend `TTLCache` with a fresh/stale/miss lookup that retains a value only through `ttl_seconds + stale_while_revalidate_seconds`. Extend `cached` so a stale hit returns immediately, creates at most one `_Flight`, and refreshes in a daemon thread; cold misses retain the existing bounded single-flight wait.

- [x] **Step 4: Verify the cache tests pass**

  Run: `apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_cache.py -q`

  Expected: all cache tests pass, including the new concurrency regression.

- [x] **Step 5: Write the failing screening-cache scheduling tests**

  Add behavior tests proving the configured market prewarm interval is shorter than `TTL_SPOT` and the screening wrapper retains its actual fetch timestamp while serving the stale value during a background refresh.

- [x] **Step 6: Verify the scheduling tests fail**

  Run: `apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_http_server.py -q`

  Expected: FAIL because the screening wrapper has no bounded stale window and the background loop still sleeps five hours.

- [x] **Step 7: Wire screening into bounded stale service**

  Add `AKSHARE_MCP_SCREENING_STALE_SECONDS` with a 900-second default, pass it only to `_screening_universe`, and make the background prewarm interval less than `TTL_SPOT`. Preserve the original `fetched_at` from the last successful source call while stale data is served.

- [x] **Step 8: Verify all AkShare unit tests pass**

  Run: `apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_cache.py apps/akshare-mcp/tests/test_http_server.py -q`

  Expected: all tests pass; only the pre-existing FastAPI `on_event` deprecation warnings may remain.

### Task 2: Deployment warm-universe gate

**Files:**
- Modify: `scripts/smoke-akshare-mcp.test.sh`
- Modify: `scripts/smoke-akshare-mcp.sh`

**Interfaces:**
- Consumes: local-only `GET /screening-universe` AkShare envelope.
- Produces: a deploy gate that requires a real source, a configurable minimum universe count (production default 4,000), and a configurable cold timeout (production default 240 seconds).

- [x] **Step 1: Extend the fake smoke transport and write the failing gate cases**

  Add a valid three-row screening-universe response plus failure scenarios for a non-production source and insufficient coverage. Configure tests with `AKSHARE_SMOKE_MIN_UNIVERSE_COUNT=2` so the fixture stays small while the one-row scenario fails closed.

- [x] **Step 2: Verify the smoke test fails before the gate exists**

  Run: `bash scripts/smoke-akshare-mcp.test.sh`

  Expected: FAIL because the invalid screening-universe scenarios are not requested or rejected.

- [x] **Step 3: Add the production screening-universe smoke gate**

  Fetch `/screening-universe` with `AKSHARE_SMOKE_SCREENING_TIMEOUT` (default 240), validate the production source and minimum count, and include the verified universe count in the successful smoke summary.

- [x] **Step 4: Verify the strict smoke suite passes**

  Run: `bash scripts/smoke-akshare-mcp.test.sh`

  Expected: all valid trading-session scenarios pass and both new universe failures fail closed without a traceback.

### Task 3: Preserve same-day screening results across dashboard refreshes

**Files:**
- Create: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx`
- Modify: `apps/web-workbench/src/components/stocks/stock-screening-state.ts`
- Modify: `apps/web-workbench/src/components/stocks/stock-screening-state.test.ts`

**Interfaces:**
- Consumes: the server-validated `StockScreeningResult` containing `snapshotId` and `dataAsOf`.
- Produces: same-day display acceptance based on `dataAsOf`; transient null/delayed trust and same-day snapshot-id rotation do not discard the result, while a different non-null `dataAsOf` clears it.

- [x] **Step 1: Write the failing component regression test**

  Render the real workbench with a deferred `api.run`, submit valid criteria, rerender from current snapshot A to delayed snapshot B on the same date, resolve the deferred server result, and assert the result heading and 5,538-stock coverage remain visible.

- [x] **Step 2: Verify the component regression test fails**

  Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockScreeningWorkbench.test.tsx`

  Expected: FAIL because the existing effect clears state on `snapshotId/trustMode` changes and the completion guard rejects the result.

- [x] **Step 3: Implement same-date result retention**

  Keep new-run eligibility unchanged. Accept a server result when the current dashboard date is null during a transient refresh or equals the result date. Clear an existing result only when a different non-null trading date arrives; do not clear it for same-day snapshot-id or trust-mode changes.

- [x] **Step 4: Update the state contract test**

  Replace the obsolete assertion that same-day snapshot rotation always rejects a result with assertions for same-day acceptance, transient-null acceptance, and different-date rejection.

- [x] **Step 5: Verify the focused web tests pass**

  Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockScreeningWorkbench.test.tsx src/components/stocks/stock-screening-state.test.ts src/lib/stock-dashboard-trust.test.ts src/pages/StockTasksPage.test.ts`

  Expected: all focused tests pass.

### Task 4: Cross-service verification and branch delivery

**Files:**
- Verify all files changed in Tasks 1-3.

**Interfaces:**
- Consumes: the AkShare cache/smoke behavior and the web workbench result-retention contract.
- Produces: a verified branch suitable for review; merge and production deployment remain separately authorized.

- [x] **Step 1: Run targeted test suites**

  Run the full AkShare cache/HTTP tests, strict smoke test, orchestrator screening/dashboard tests, and focused web screening/dashboard tests.

- [x] **Step 2: Run static and build gates**

  Run `pnpm --filter @holaday/orchestrator typecheck`, `pnpm --filter @holaday/web-workbench typecheck`, `pnpm --filter @holaday/web-workbench lint`, `pnpm --filter @holaday/orchestrator build`, `pnpm --filter @holaday/web-workbench build`, and `git diff --check`.

- [x] **Step 3: Review the final diff against the P0 acceptance criteria**

  Confirm there is no fallback data, no relaxed criteria, no watchlist write, no unrelated file change, and no secret in the diff.

- [ ] **Step 4: Commit, push, and create a pull request**

  Commit only the plan, tests, cache/smoke changes, and workbench result-retention changes. Push `codex/stock-screening-production-p0` and create a PR against `claude/musing-keller-ae1d05`; do not merge or deploy without the separate authorization gate.
