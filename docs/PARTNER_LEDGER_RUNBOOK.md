# Partner Ledger Runbook

This runbook covers the isolated Holaday partner ledger launch path:
annual partner membership, KYC gate, HOLA Credit recharge, API Units
allocation, releases, withdrawals, CN payment gateway callbacks, and
admin reconciliation.

## Safety Switches

Keep partner writes dark until the database and operator paths are ready.

```bash
PARTNER_LEDGER_ENABLED=false
```

Flip to `true` only after migrations, cn-payment, admin review, and
scheduled job smoke checks pass.

Required Vultr orchestrator env:

```bash
PARTNER_LEDGER_ENABLED=true
CN_PAYMENT_URL=https://hd-pay.orangebench.tech
INTERNAL_SHARED_SECRET=<same value as cn-payment>
```

Required cn-payment env:

```bash
VULTR_INTERNAL_URL=https://holaday.ai/api/internal/payment/confirm
INTERNAL_SHARED_SECRET=<same value as orchestrator>
PUBLIC_ORIGIN=https://hd-pay.orangebench.tech
```

`VULTR_INTERNAL_URL` still points at the legacy payment confirm route.
The cn-payment bridge derives `/api/internal/partner-payment/confirm`
from the same origin for partner callbacks.

## Launch Order

1. Apply partner migrations on Vultr:

   ```bash
   pnpm --filter @holaday/orchestrator db:migrate:numbered
   ```

   Confirm `0039_partner_ledger.sql` and
   `0040_partner_activity_events.sql` have applied.

2. Deploy orchestrator with `PARTNER_LEDGER_ENABLED=false`.

3. Deploy cn-payment and confirm:

   ```bash
   curl https://hd-pay.orangebench.tech/healthz
   ```

   WeChat and Alipay should be `ready`.

4. Flip `PARTNER_LEDGER_ENABLED=true` on Vultr only.

5. Smoke admin routes:

   - `/admin/partners` loads.
   - Overview metrics load.
   - The reconciliation panel loads a 7-day window.

6. Smoke user route:

   - `/partner` loads.
   - Create a manual membership order in a non-production account.
   - Admin confirms it from `/admin/partners`.

7. Smoke online payment with a small controlled account:

   - Create partner membership with WeChat.
   - Confirm the returned intent is a real `codeUrl`, not
     `partner-payment://`.
   - After wallet payment, confirm the order completes in
     `partner_recharge_orders`.
   - Repeat Alipay redirect.

8. Smoke KYC and recharge:

   - Submit KYC with provider `cn-bankcard`.
   - If auto-provider verification is not enabled, admin sets status
     to `passed`.
   - Create recharge order.
   - Confirm callback creates a partner lot.

## Daily Jobs

Daily jobs build the API cost pool and allocate locked bonus for lots
inside their 120-day accumulation window.

Dry-run equivalent is not available because the service writes
idempotent rows. Use a historical or staging day for rehearsal.

```bash
pnpm --filter @holaday/orchestrator partner:daily -- --day 2026-07-10
```

Optional overrides:

```bash
pnpm --filter @holaday/orchestrator partner:daily -- \
  --day 2026-07-10 \
  --fx-bps 72000 \
  --allocation-budget-credit-cents 500000
```

Expected output is JSON with:

- `costPool.idempotencyKey`
- `allocation.allocatedLotCount`
- `allocation.totalLockedBonusCreditCents`

If the job is retried for the same day, idempotency keys should prevent
duplicate pool or allocation rows.

## Monthly Release

Monthly release requires an explicit budget. Do not run without an
approved finance amount.

```bash
pnpm --filter @holaday/orchestrator partner:monthly -- \
  --release-month 2026-08 \
  --budget-credit-cents 1000000
```

Expected output is JSON with:

- `release.releasedLotCount`
- `release.totalReleasedCreditCents`
- carry-forward amounts when budget is insufficient

Run monthly release only after daily allocation for the prior month has
settled and admin reconciliation has no open payment callback incidents.

## Admin Operations

Use `/admin/partners` for:

- Pending KYC review.
- Pending or review-required partner orders.
- Withdrawal approval, rejection, and paid marking.
- Risk lots requiring investigation.
- Date-window reconciliation and CSV copy.

Reconciliation is based on `updated_at`, not `created_at`. Use it for
settlement activity in a window, not raw order origination.

## Risk Lot Review

Risk lots appear when `partner_lots.risk_status` is `review`,
`review_required`, `frozen`, or the lot status is `frozen`.

Use Freeze when a lot needs manual containment. The service:

- Saves the pre-freeze lot status and risk status into metadata.
- Sets both `status` and `risk_status` to `frozen`.
- Writes a `partner_risk_events` row with reviewer id and reason.
- Stops new withdrawal requests, withdrawal approval, and paid marking
  while any user lot remains frozen.

Use Resume only after review evidence is cleared. The service restores
the pre-freeze status from metadata, writes a `lot_resumed` risk event,
and leaves the original freeze audit trail intact.

Use Close only after refund, fraud handling, or another terminal finance
decision is complete. The service sets `status='closed'`, keeps
`risk_status='frozen'`, writes a `lot_closed` risk event, and blocks
future resume attempts for that lot. Close requires the lot to already
be frozen.

If the incident requires refund, fraud handling, or account-wide
containment, keep the lot frozen and handle the finance action manually
before resuming or closing the customer path.

## KYC Rules

Current KYC provider behavior is conservative:

- `cn-bankcard` with no verified provider reference goes to
  `review_required`.
- `cn-bankcard` with provider reference still requires server/provider
  verification unless mock auto-pass is explicitly enabled in test/dev.
- Recharge and withdrawal require KYC status `passed`.
- Withdrawal also requires same bank-card fingerprint and risk pass.

Until a real bank-card provider is wired, production KYC pass should be
set from admin only after external verification evidence is recorded in
the provider reference or review note.

## Withdrawal Controls

Before approving a withdrawal:

1. Confirm KYC status is `passed`.
2. Confirm the withdrawal bank fingerprint matches the KYC bank card.
3. Confirm risk score and lot status are acceptable.
4. Confirm available platform cash budget.
5. Approve, then mark paid only after the bank payout has a provider
   payout id.

If a withdrawal is rejected, the service releases held credit back to
withdrawable/pending buckets idempotently.

## Reconciliation Checks

Daily:

- Compare cn-payment successful provider notifications with
  `partner_recharge_orders.status='completed'`.
- Search admin reconciliation by date window.
- Confirm `payments` table remains unchanged by partner purchases.
- Confirm `partner_recharge_orders.provider_capture_id` is unique per
  provider.

Monthly:

- Compare monthly release output with finance-approved release budget.
- Export/copy reconciliation CSV before and after release.
- Confirm paid withdrawals match bank payout statements.

## Incident Response

### Partner Callback Returns 401

Cause: `INTERNAL_SHARED_SECRET` mismatch.

Action:

1. Compare Vultr and Aliyun env values.
2. Restart the process with the wrong value.
3. Let provider retries re-deliver callback.
4. If retries are exhausted, use admin manual order confirmation with a
   provider capture id from provider records.

### Partner Callback Returns `partner_ledger_disabled`

Cause: Vultr `PARTNER_LEDGER_ENABLED` is missing or false.

Action:

1. Confirm migrations are applied.
2. Set `PARTNER_LEDGER_ENABLED=true`.
3. Restart orchestrator.
4. Let cn-payment/provider retry.

### Gateway Creates Placeholder Intent

Cause: orchestrator is missing `CN_PAYMENT_URL` or
`INTERNAL_SHARED_SECRET`.

Action:

1. Set both env vars.
2. Restart orchestrator.
3. Create a new order, or retry the same idempotency key if the order
   is still pending.

### Recharge Moves To `review_required`

Cause: KYC, cap, lot creation, or risk guard failed after payment
capture.

Action:

1. Review `reviewReason`, `errorName`, and `errorMessage` in admin.
2. Confirm funds captured in provider dashboard.
3. If valid, use `approveReviewRequiredOrder` from admin.
4. If invalid, freeze the account path and handle refund manually.

## Rollback

Soft rollback:

```bash
PARTNER_LEDGER_ENABLED=false
```

Then restart orchestrator. Existing partner pages return disabled state
and partner callbacks are refused with 503 so cn-payment/provider can
retry while the issue is fixed.

Do not roll back database migrations unless explicitly approved. The
partner schema is additive and isolated; disabling the flag is the safe
rollback path.
