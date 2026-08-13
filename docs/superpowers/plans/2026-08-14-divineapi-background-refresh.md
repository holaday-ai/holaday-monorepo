# DivineAPI Background Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Today Energy usable after eight seconds while one shared DivineAPI request continues for up to 35 seconds, then silently replace local horoscope copy with cached provider-backed Chinese content.

**Architecture:** The Orchestrator separates the foreground response budget from the provider hard timeout and stores one in-flight promise per credential-free cache key. Period fallbacks explicitly report whether provider work is still pending. The web hook schedules at most two guarded, invisible rechecks only for those pending period fallbacks and upgrades state only when a provider response is available.

**Tech Stack:** TypeScript, Node.js fetch/AbortController, tRPC, React hooks, Vitest, Testing Library, pnpm.

## Global Constraints

- Foreground wait budget remains 8,000 ms by default.
- Provider hard timeout is 35,000 ms by default.
- Same cache key has at most one provider fetch in flight.
- Cache and in-flight keys exclude `api_key` and include the actual base URL.
- Only daily, weekly, monthly, and yearly period fallbacks expose pending refresh state to the UI.
- Silent retries never set `loading` to true and run at most twice: 18,000 ms after fallback, then 5,000 ms after another pending response.
- Profile, period, or range changes invalidate old timers and responses.
- Ranking remains user-triggered and is never preheated.
- No OpenAI key, permission, DivineAPI model, plan, database, or migration changes.

---

### Task 1: Separate foreground budget from provider hard timeout

**Files:**
- Modify: `apps/orchestrator/src/astrology/service.ts`
- Test: `apps/orchestrator/src/astrology/service.test.ts`

**Interfaces:**
- Consumes: existing `postDivineApiJson`, `divineApiCache`, `DivineApiContractError`, `DIVINE_API_REQUEST_TIMEOUT_MS`.
- Produces: `providerRefreshPending: boolean` on `AstrologyPeriodReading`; `DIVINE_API_PROVIDER_TIMEOUT_MS` with 35,000 ms default; one in-flight provider promise per cache key.

- [ ] **Step 1: Write the foreground/background failing test**

Add a test using fake timers and a deferred valid DivineAPI response. Configure `DIVINE_API_REQUEST_TIMEOUT_MS=50` and `DIVINE_API_PROVIDER_TIMEOUT_MS=200`. Start `getDailyAstrologyReading`, advance 50 ms, and assert that the returned reading is `local-fallback` with `providerRefreshPending: true` while the captured signal remains un-aborted. Resolve the deferred response, flush promises, query the same reading again, and assert it is `divineapi`, `fresh`, and does not issue another fetch.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts -t "keeps a timed-out horoscope request running and caches its result"
```

Expected: FAIL because the current 50 ms timer aborts the signal and no `providerRefreshPending` field exists.

- [ ] **Step 3: Write the single-flight failing test**

Start two identical daily queries before resolving the deferred fetch. Advance the 50 ms foreground budget for both and assert `fetchImpl` was called once and both results report `providerRefreshPending: true`. Resolve the shared provider promise and confirm a later query uses the cache.

- [ ] **Step 4: Run the single-flight test and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts -t "shares one in-flight DivineAPI request"
```

Expected: FAIL because the current implementation creates two fetches.

- [ ] **Step 5: Write the provider hard-timeout failing test**

Use a hanging fetch with foreground budget 50 ms and provider timeout 100 ms. Assert the first reading returns pending at 50 ms, the fetch signal aborts at 100 ms, and a subsequent query calls fetch again rather than reusing a stuck in-flight entry.

- [ ] **Step 6: Run the hard-timeout test and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts -t "aborts and clears a provider request at the hard timeout"
```

Expected: FAIL because there is no independent provider timeout or in-flight cleanup.

- [ ] **Step 7: Implement the minimal service behavior**

In `service.ts`:

1. Add `providerRefreshPending: boolean` to `AstrologyPeriodReading` and initialize it to `false` in every local and provider period builder.
2. Rename the config meaning without breaking the environment contract: keep `requestTimeoutMs` as the foreground budget from `DIVINE_API_REQUEST_TIMEOUT_MS`; add `providerTimeoutMs` from `DIVINE_API_PROVIDER_TIMEOUT_MS`, default 35,000 ms.
3. Add a module-level map:

```ts
const divineApiInFlight = new Map<string, Promise<unknown>>();
```

Use the same credential-free `cacheKey` already used by `divineApiCache`.
4. Extract provider execution into a promise that owns the 35-second AbortController, validates the response, writes the cache, records only actual contract failures, and deletes itself from `divineApiInFlight` in `finally`.
5. Reuse the map promise for identical concurrent requests. Attach a handled rejection branch so a promise that outlives all foreground callers cannot become unhandled.
6. Race the shared provider promise against a foreground timer. Return a discriminated `{ pending: true }` result when the foreground timer wins. Clear only the foreground timer; do not abort the provider controller.
7. If a valid stale value exists, return it on provider rejection or foreground timeout. Otherwise surface the pending result or error to the period caller.
8. In daily, weekly, monthly, and yearly callers, convert the pending result into their existing local reading with `providerRefreshPending: true`. Other failures keep `providerRefreshPending: false`.
9. Update `clearDivineApiCacheForTest()` to clear `divineApiInFlight` in addition to existing maps.

- [ ] **Step 8: Update the old timeout tests**

Change the old “bounds a hanging provider request” test to assert the two-stage behavior: pending local result at the foreground budget and aborted signal only at `DIVINE_API_PROVIDER_TIMEOUT_MS`. Keep the invalid huge timer test, but apply it separately to both foreground and provider timeout parsing so unsafe values use their defaults.

- [ ] **Step 9: Run the focused service suite and verify GREEN**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts
```

Expected: all service tests pass with no unhandled rejection warnings.

- [ ] **Step 10: Commit Task 1**

```bash
git add apps/orchestrator/src/astrology/service.ts apps/orchestrator/src/astrology/service.test.ts
git commit -m "fix(astrology): complete slow provider requests in background"
```

---

### Task 2: Silently upgrade pending local periods in the web hook

**Files:**
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Test: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`

**Interfaces:**
- Consumes: `providerRefreshPending` returned by the period routers; existing per-period request IDs, range keys, `queryPeriod`, and compatibility projections.
- Produces: at most two invisible retries per pending period using delays `[18_000, 5_000]`; provider result upgrades period and compatibility state without visible loading.

- [ ] **Step 1: Write the silent-upgrade failing test**

Use fake timers. Make the first daily query return a local reading with `providerRefreshPending: true`, then return a provider reading on the second call. After initial load, assert `loading=false` and local copy is visible. Advance 18,000 ms, assert the second call occurs while `loading` remains false, then assert the provider headline replaces local copy and the local warning clears.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx -t "silently upgrades a pending local period"
```

Expected: FAIL because the hook never schedules a second query.

- [ ] **Step 3: Write bounded-retry and stale-guard failing tests**

Add tests that:

- return pending local content three times and assert only the initial call plus two silent retries occur after 18,000 ms and 5,000 ms;
- rerender from Aries to Taurus before the silent Aries result resolves and assert the late Aries provider response cannot replace Taurus state;
- return an ordinary local fallback with `providerRefreshPending: false` and assert no silent retry occurs;
- verify `trpc.astrology.ranking.query` remains uncalled throughout automatic period refresh.

- [ ] **Step 4: Run the guard tests and verify RED**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx -t "silent refresh|ordinary local fallback|ranking"
```

Expected: at least the retry tests fail because silent refresh behavior is missing.

- [ ] **Step 5: Implement minimal timer and retry logic**

In `useEnergyAstrology.ts`:

1. Include `providerRefreshPending` in `EnergyPeriodReading` and set it to `false` for all local client-built periods.
2. Add `SILENT_REFRESH_DELAYS_MS = [18_000, 5_000] as const`.
3. Add one timer ref per period and a helper that clears a period timer.
4. Add `scheduleSilentPeriodRefresh(period, rangeKey, requestId)` that captures the active request id and range key. Its callback queries the period without modifying loading state.
5. Before and after the query, require both captured request id and current range key to match. On `source: divineapi`, replace the period state and update daily/weekly compatibility projections. On another pending local response, schedule only the next configured delay. On ordinary fallback or error, stop quietly.
6. At the start of every visible `loadPeriod`, clear that period's silent timer before incrementing its request ID. Schedule a silent refresh only when the returned reading has `providerRefreshPending: true`.
7. In the profile/lifecycle effect cleanup, clear all four timers and invalidate request IDs.

- [ ] **Step 6: Run the hook suite and verify GREEN**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx
```

Expected: all hook tests pass without React act warnings or pending timers.

- [ ] **Step 7: Run rendered astrology component tests**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run \
  src/components/energy/AstrologyMagazineCover.test.tsx \
  src/components/energy/AstrologyWorld.test.tsx \
  src/components/energy/experiences/HoroscopeExperience.test.tsx \
  src/components/energy/useEnergyAstrology.test.tsx
```

Expected: all tests pass; no component requires a second loading state.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/web-workbench/src/components/energy/useEnergyAstrology.ts apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx
git commit -m "feat(energy): silently upgrade cached horoscope content"
```

---

### Task 3: Full verification and release handoff

**Files:**
- Verify: `apps/orchestrator/src/astrology/service.ts`
- Verify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Verify: `docs/superpowers/specs/2026-08-14-divineapi-background-refresh-design.md`
- Verify: `docs/superpowers/plans/2026-08-14-divineapi-background-refresh.md`

**Interfaces:**
- Consumes: completed Tasks 1–2.
- Produces: verified branch ready for review, PR, deployment, and production timing validation.

- [ ] **Step 1: Run orchestrator verification**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
```

- [ ] **Step 2: Run web verification**

```bash
pnpm --filter @holaday/web-workbench exec vitest run \
  src/components/energy/AstrologyMagazineCover.test.tsx \
  src/components/energy/AstrologyWorld.test.tsx \
  src/components/energy/energy-css.test.ts \
  src/components/energy/experiences/HoroscopeExperience.test.tsx \
  src/components/energy/useEnergyAstrology.test.tsx \
  src/components/energy/zodiac-art.test.tsx
pnpm --filter @holaday/web-workbench build
```

- [ ] **Step 3: Run repository hygiene checks**

```bash
git diff --check
git status --short
git diff --stat origin/claude/musing-keller-ae1d05...HEAD
```

Confirm only the two implementation files, their two tests, and the two design/plan documents are in scope.

- [ ] **Step 4: Review the implementation against the spec**

Verify each global constraint explicitly: 8-second foreground, 35-second provider hard limit, one in-flight fetch, no credential in key, two silent retries, no loading reset, stale/profile/range guards, and no ranking preheat.

- [ ] **Step 5: Push and open a draft PR**

```bash
git push -u origin codex/divineapi-background-refresh
```

Create a draft PR against `claude/musing-keller-ae1d05` with the diagnosis, TDD evidence, and deployment plan.

- [ ] **Step 6: Perform review, merge, and deploy after authorization**

Address any Important or Critical review finding, rerun affected checks, mark the PR Ready, merge with a merge commit, then deploy `application` from the exact merge SHA using the established release script.

- [ ] **Step 7: Verify production behavior**

Confirm:

- local or stale content is usable after about eight seconds;
- the visible period upgrades to `source: divineapi` within 25–35 seconds without a second skeleton;
- repeated same-period refresh hits cache quickly;
- page logs contain no errors;
- PM2 is online with restart count 0;
- Vultr and Aliyun use the same SPA bundle and both health endpoints return 200;
- post-deploy P0 smoke passes.
