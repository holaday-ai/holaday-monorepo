# Account closure operations

This runbook covers the self-service account-closure API and its separate,
portless worker. Account closure is irreversible after object cleanup starts;
operators must prefer stopping new applications and safely draining existing
requests over rolling application or database state backward.

## Safety invariants

- Apply and verify migrations `0051_account_closures.sql` and
  `0052_feedback_cases.sql` before deploying code.
- Ship with `ACCOUNT_CLOSURE_ENABLED=false` and
  `ACCOUNT_CLOSURE_WORKER_ENABLED=false`.
- If either flag is true, `ACCOUNT_CLOSURE_HMAC_SECRET` must be a dedicated
  secret of at least 32 characters. Report only whether it exists and its
  length; never print its value or a derived subject digest.
- `ACCOUNT_CLOSURE_ALLOWLIST` is a comma-separated list of exact user external
  IDs. It is not a general entitlement switch.
- Both `ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED` and
  `ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED` default to `false`. The API
  and worker refuse to start enabled until both are true. Set them true only
  after a two-person review confirms the pre-0052 Resend inbox and PM2/ops-log
  surfaces were deleted where appropriate or placed under a documented,
  access-restricted retention control. Record only confirmation status,
  reviewer, timestamp, and evidence reference; never copy or print legacy
  message/log content into the change record.
- The worker must run as uid `998`, with exactly one PM2 instance, no listening
  port, a `512M` PM2 memory ceiling, and a `660000ms` kill timeout. The runtime
  memory guard stops new claims at 480 MiB; the kill timeout leaves 60 seconds
  beyond the reviewed 600-second maximum page duration for checkpoint writes.
- Never query or log email, phone, recovery tokens, HMAC values, subject
  digests, receipt internals, free text, file contents, or provider payloads
  while operating this queue.

## Staged enablement

1. Deploy migrations 0051 and 0052 with both closure flags and both legacy
   sanitation prerequisites false. Run the database verification gate and
   ordinary login, task, feedback, payment, and partner health checks.
2. Deploy application and dormant worker code. With the worker flag false,
   verify that no stale `holaday-account-closure-worker` process exists.
3. Complete the one-time legacy Resend/PM2 sanitation and restricted-retention
   review, then set both sanitation prerequisites true. This is a confirmation
   gate, not permission to query or export old content.
4. Configure the dedicated HMAC secret and completion email/SMS templates via
   the approved secret path. Do not paste secrets into a shell history, log,
   ticket, or pull request.
5. Put only the dedicated synthetic external ID in the allowlist, set the API
   flag true, then set the worker flag true. Restart through
   `scripts/orchestrator-runtime.sh`; do not start an extra worker manually.
6. Verify one worker process, uid 998, no worker listener, RSS below 512 MiB,
   and a healthy application before exercising submit and cancellation.
7. Expand to employee external IDs only after the synthetic flow succeeds.
   Observe at least one complete seven-day window before considering general
   availability. Small samples are insufficient evidence for policy changes.

Changing the allowlist never accelerates the fixed 168-hour grace period.

### Canary exit criteria

The synthetic submit-and-withdraw canary is complete only when all of the
following are true in one privacy-safe observation:

- submission freezes the synthetic account and creates exactly 13 steps;
- verified withdrawal restores only request-owned effects and the account can
  sign in again;
- the cancelled request has exactly 13 `skipped` steps, zero
  `pending`/`retryable`/`leased`/`blocked` steps, and the aggregate active queue
  is empty;
- the single worker remains uid `998`, owns no listener, stays below the RSS
  ceiling, and the `canary-running` preflight passes all checks;
- temporary synthetic credentials are invalidated after the browser recovery
  check without changing the verified recovery destination.

A cancelled request with any active step is a release blocker even if the user
can sign in again. Do not repair it by deleting rows or marking work complete.
Fix the withdrawal transaction, require the exact 13-row invariant, and use a
separately authorized, request-scoped transaction for any pre-fix residual
rows; a count other than 13 must roll back.

The submit-and-withdraw canary does not prove destructive completion. Before
employee expansion, the accelerated integration release gate must remain green
and a separate synthetic identity must complete the full staged completion
path without shortening the 168-hour production deadline. General availability
still requires the full seven-day observation window in step 7; elapsed time is
a release gate and cannot be replaced by a small successful sample.

## Read-only rollout preflight

Run the privacy-safe production preflight before every rollout transition. It
reads public health, aggregate closure-table counts, PM2 process facts, and
configuration presence only. Its output is limited to booleans, counts,
lengths, fixed check names, and worker RSS; it never prints secrets, allowlist
entries, template IDs, user IDs, or queue-row content.

Readiness is based on the live service process environments, with exact
whitelisted comparison against the current env files. File/runtime drift,
workers found under `/proc` but not owned by the expected PM2 entry, any TCP or
UDP worker listener, and a non-empty active queue all fail closed. The
`canary-running` check is therefore run immediately after enabling and before
submitting the synthetic closure request. The authenticated CN Payment probe
also calls Aliyun `GetSmsTemplate` for both dedicated closure templates and is
ready only when both return `TemplateStatus=1`. A configured template that is
still under review, rejected, cancelled, or cannot be queried keeps the rollout
blocked without sending an SMS. The CN Payment RAM identity therefore needs the
read-only `dysms:GetSmsTemplate` permission in addition to its reviewed send
permission.

```bash
# Current dark-launch invariant: both flags off, no worker, empty queue.
./scripts/verify-account-closure-production.sh dormant

# Before enabling: reviewed prerequisites/configuration are ready, while both
# flags remain off. The confirmation is an operator attestation and never
# carries or prints the synthetic external ID.
ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED=true \
  ./scripts/verify-account-closure-production.sh canary-ready

# After enabling the one-identity synthetic canary.
ACCOUNT_CLOSURE_PREFLIGHT_SYNTHETIC_ALLOWLIST_CONFIRMED=true \
  ./scripts/verify-account-closure-production.sh canary-running
```

The synthetic-allowlist confirmation may be set only after an authorized
operator verifies that the single configured entry is the dedicated synthetic
identity. It is not a substitute for the two-person legacy-sanitation review.
Any failed check blocks the transition; the preflight never changes flags,
processes, data, secrets, or deployment state.

## Privacy-safe queue inspection

Use aggregate counts and random request external IDs only. Do not select
`user_id`, identities, challenge data, receipt digests, or checkpoint JSON.

```sql
SELECT status, COUNT(*) AS request_count,
       MIN(created_at) AS oldest_created_at,
       MAX(updated_at) AS newest_updated_at
FROM account_closure_requests
GROUP BY status
ORDER BY status;

SELECT s.category_id, s.status, s.last_error_code,
       COUNT(*) AS step_count,
       MIN(s.next_attempt_at) AS earliest_retry_at,
       MAX(s.attempt_count) AS max_attempt_count
FROM account_closure_steps AS s
GROUP BY s.category_id, s.status, s.last_error_code
ORDER BY s.category_id, s.status, s.last_error_code;

SELECT
  SUM(lease_until > CURRENT_TIMESTAMP(3)) AS active_step_leases,
  SUM(status IN ('pending', 'retryable', 'blocked')
      AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP(3))) AS due_steps
FROM account_closure_steps;

SELECT
  SUM(completion_lease_until > CURRENT_TIMESTAMP(3)) AS active_completion_leases,
  SUM(status IN ('processing', 'needs_attention')
      AND completion_next_attempt_at <= CURRENT_TIMESTAMP(3)) AS due_completions
FROM account_closure_requests;
```

For a reviewed incident, the only per-request identifier allowed in an
operator note is `account_closure_requests.external_id`. Do not copy a row
dump; record category, status, fixed error code, counts, and timestamps only.

## Alerts

- Page immediately if the enabled worker count is not exactly one, uid is not
  998, a worker owns a listening port, PM2 restarts it for memory, or RSS
  reaches 480 MiB.
- Page on any `needs_attention` request, `blocked` step,
  `handler_missing`, `configuration`, or `invariant_violation` error.
- Warn when the oldest due work is more than 5 minutes old; page at 30 minutes
  or when the due count rises across three consecutive 5-minute samples.
- Alert on rejected completion notifications and on a completion lease that
  remains expired across two worker polls. Provider acceptance is not account
  completion; the final tombstone transaction remains authoritative.
- Logs and dashboards may contain only aggregate counts, fixed category/error
  enums, result names, RSS, and time ranges. Access to root-owned worker logs
  remains restricted (`0600`).

## Retry and unblock

Normal provider/storage/database failures retry automatically after 60
seconds, 5 minutes, 30 minutes, 2 hours, and 6 hours. After five failed
attempts, the request enters `needs_attention`; automatic reconsideration is
no sooner than 24 hours. Never delete a step, rewind its cursor, clear its
processed count, mark it succeeded, or forge a retention outcome.

Before an expedited retry:

1. Disable new applications if the incident is systemic.
2. Confirm the dependency is healthy and the stored lease is absent or
   expired. Confirm the registered handler version still matches the step.
3. Inspect only aggregate state plus the reviewed request external ID and
   category. Confirm there is no active lease and no concurrent operator.
4. In one transaction, lock the request and step; change only an expired
   `blocked` step to `retryable`, set `next_attempt_at` to the current time,
   clear its expired lease owner/until, and change the request from
   `needs_attention` to `processing`. Preserve checkpoint, processed count,
   attempt count, error code, and retention outcome.
5. For a completion retry, make the equivalent request-level change only
   after locking the request: preserve completion attempt/error state, clear
   only an expired completion lease, set `completion_next_attempt_at` to the
   current time, and return `needs_attention` to `processing`.
6. Commit, let the single worker claim the work, and verify one aggregate
   status transition. If the invariant no longer holds, roll back the
   transaction and escalate to engineering; never force completion.

Every manual retry needs a two-person review and an incident/change record.
There is intentionally no public endpoint that marks a step complete.

## Stop new applications and drain safely

To stop new applications, set `ACCOUNT_CLOSURE_ENABLED=false` and restart the
application through the normal deployment path. Keep
`ACCOUNT_CLOSURE_WORKER_ENABLED=true` so already-frozen accounts continue to
retry, notify, and finalize. Existing recovery-token status/cancellation flows
remain token-bound; do not delete queue rows or revoke recovery by changing the
allowlist.

If the worker itself is causing harm, set the worker flag false and restart via
the runtime script. SIGTERM must finish and persist the current page, then the
runtime removes the worker process. Do not kill it during an object operation
unless there is an active incident; object-first cleanup and durable
checkpoints make a later retry safe, but cannot recreate a deleted object.

## Roll-forward only after destructive work

Cancellation is supported only during the seven-day grace period, before
processing. Once processing starts, deleted objects, revoked provider assets,
and minimized personal fields cannot be restored. A database rollback, code
rollback, or backup restore must never be used to pretend those external side
effects did not happen or to reopen a completed account.

For a bad release, stop new applications, drain or pause the worker as above,
fix forward, and retry from the persisted checkpoint. Schema rollback is
prohibited after any request enters `processing`. Preserve restricted
financial, reviewed feedback legal/dispute, operations/security log, KYC,
ledger, closure-step, and receipt records according to their approved
policies; do not assign a made-up common expiry.
