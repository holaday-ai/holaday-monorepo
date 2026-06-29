# Deploy Checklist — holaday-monorepo

This file captures the deploy rules we've learned the hard way. Run
through it before every Vultr / Aliyun deploy that touches the
orchestrator or the database. Each rule has the incident that
created it; do NOT remove a rule without the same kind of incident
proving it's now obsolete.

---

## RULE 1 — Schema columns and DB migrations are atomic; migration
applies BEFORE the code that references them

**The rule:** if a deploy adds, renames, drops, or changes a column
in `apps/orchestrator/src/db/schema/*.ts`, the matching SQL migration
under `apps/orchestrator/drizzle/*.sql` must be applied to the target
database **before** the new orchestrator binary is restarted.

**Why:** Drizzle's query builder always references every column
present in the schema, even ones the code path doesn't read. The
generated INSERT / SELECT / UPDATE statements include those columns
in the field list. If the column doesn't exist on the database yet,
MariaDB rejects every query that touches that table with `Unknown
column 'X' in 'field list'` — regardless of whether the new code
path is actually exercised.

**The incident (2026-05-08, Phase 1 Day 5 deploy):** commit `94b4a60`
shipped 5 new columns on `tasks` (contract_json, evidence_json,
verification_json, verification_passed, failure_level) plus the
matching `0020_execution_columns.sql` migration. Deploy plan was:
deploy → apply migration → flip flags. After PM2 restart, every
single `tasks.create` returned 500 because the schema referenced
columns that didn't exist yet. Production was down for ~10 minutes
of restoration time. Recovery: apply migration immediately (it's
ALTER TABLE ADD COLUMN NULLABLE — instant, zero data risk), no
code rollback needed.

**The fix going forward:** apply migration first, then deploy code.
A bash recipe that does both safely:

```bash
# 1. Apply migration (fail-fast if it doesn't exist or already ran)
sshpass -p "$VULTR_PASSWORD" ssh root@VULTR_IP \
  'cd /opt/holaday-monorepo && \
   set -a && . apps/orchestrator/.env && set +a && \
   ... mysql ... < apps/orchestrator/drizzle/$NEW_MIGRATION_FILE'

# 2. THEN deploy + restart code
bash scripts/deploy-orchestrator.sh
```

The drizzle journal (`apps/orchestrator/drizzle/meta/_journal.json`)
is intentionally out of sync with prod — migrations are tracked
manually. Don't rely on `drizzle-kit migrate` for production; it
expects a clean journal that we don't maintain.

---

## RULE 2 — Feature-flagged behaviour: deploy with flags off, flip
afterwards in stages

**The rule:** any change that introduces new behaviour (writes to
DB, calls to upstream APIs, changes to the user-visible flow) ships
with a feature flag default-false. The deploy proves the off-state
is safe; subsequent flag flips prove the on-state in production.

**Why:** atomic-deploy + flag-flip lets us roll back behaviour
without rolling back code. A bug surfaced after a flip is fixed by
turning the flag back off (10 seconds), not by reverting the
commit (5 minutes plus a re-deploy plus tests).

**The pattern:**
1. Add a flag in `apps/orchestrator/src/execution/feature-flags.ts`
   (or wherever the relevant module lives) — default `false`.
2. The new code path is wrapped in `if (FLAG) { ... }` with a
   no-op fallthrough.
3. Deploy + restart with the flag still off; verify P0 smoke is
   10/10 (existing behaviour unchanged).
4. Flip the flag in `apps/orchestrator/.env` (append-only via sed:
   `sed -i '/^MYFLAG=/d' .env && echo 'MYFLAG=true' >> .env`).
5. PM2 restart picks up the new env on next boot.
6. Verify the new behaviour works (run the relevant smoke / probe).

**Independent flags for staged rollouts:** when a feature has
multiple sub-systems that can be gated separately (e.g. ledger
writes vs contract generation vs verifier execution), use one flag
each. That way a failure in one subsystem doesn't force the others
off too.

**The success case (2026-05-08, Phase 1 Day 5):** EVIDENCE_LEDGER /
EXECUTION_CONTRACT / EXECUTION_VERIFIER were flipped one at a
time with verification at each stage. Step C, D, E each ran 1
generate + 1 scrape task and queried DB to confirm the
corresponding columns populated.

---

## RULE 3 — Run P0 smoke after every restart that changes runtime
behaviour

**The rule:** `pnpm --filter @holaday/orchestrator eval:smoke` after
each PM2 restart, before declaring the deploy / flip done. 10/10 is
the bar. Fewer means something regressed.

**Why:** the whole reason P0 smoke exists is to catch regressions
fast. Skipping it after a restart defeats the point.

**The recipe (Vultr):**
```bash
sshpass -p "$VULTR_PASSWORD" ssh root@VULTR_IP \
  'cd /opt/holaday-monorepo && \
   set -a && . apps/orchestrator/.env && set +a && \
   EVAL_BASE_URL=http://127.0.0.1:4001 \
   pnpm --filter @holaday/orchestrator eval:smoke 2>&1' | tail -25
```

P0_007 (search) flakes on Anthropic `overloaded_error`. Re-run once
before treating a single failure as a regression.

---

## RULE 4 — Sources of truth for deploy targets

| Target | IP | Auth | Env file location | Restart command |
|---|---|---|---|---|
| Vultr orchestrator | 207.148.70.106 | sshpass + password | `apps/orchestrator/.env` | `pm2 restart holaday-orchestrator` |
| Aliyun SPA | 47.99.169.186 | sshpass + password | (n/a) | (no orchestrator) |

The orchestrator HTTP port on Vultr is **4001**, not the runner's
default 3001. Always pass `EVAL_BASE_URL=http://127.0.0.1:4001`
when invoking the eval runner there.

---

## RULE 5 — fail2ban is a real constraint; batch SSH calls

**The rule:** rapid back-to-back `sshpass + ssh` calls trigger
fail2ban on the Vultr host. After ~5 failed-or-rapid attempts,
SSH is blocked for ~15-60 seconds. Plan for this:

- Combine related operations into a single SSH session (one call
  that does flip + restart + run + query).
- Between separate SSH calls, give the connection time (or wait
  for unban with `until ssh ...; do sleep 5; done`).
- A single retry after a fail2ban lockout almost always succeeds.

Don't fight fail2ban — design around it.

---

## RULE 6 — Stock features require the local AkShare data service

**The rule:** any deploy that touches the stock dashboard, A-share
briefing, or AkShare adapters must deploy and smoke
`akshare-mcp-http` before declaring orchestrator healthy. Use:

```bash
scripts/deploy-current.sh orchestrator
# or
scripts/deploy-current.sh both
```

Both paths now run `scripts/deploy-akshare-mcp.sh` first. For an
AkShare-only hotfix, use `scripts/deploy-current.sh akshare`.

**Why:** the stock UI and briefing code read real market data from
`AKSHARE_HTTP_URL` (default `http://127.0.0.1:8848`). A plain
orchestrator restart can look healthy while stock rankings degrade
or time out if the local Python service is stale or down.

**Smoke bar:** do not stop at `/healthz`. The AkShare smoke must
also fetch real ranking envelopes:

```bash
AKSHARE_HTTP_URL=http://127.0.0.1:8848 scripts/smoke-akshare-mcp.sh
```

It checks `/stock-rankings/gainers?limit=1` and
`/stock-rankings/amount?limit=1`. If either returns an error
envelope, inspect `pm2 logs akshare-mcp-http --lines 40 --nostream`.

**Security boundary:** `akshare-mcp-http` is intentionally
unauthenticated and must stay loopback-only (`127.0.0.1:8848`).
Never expose it through nginx, a public firewall rule, or a public
DNS record.
