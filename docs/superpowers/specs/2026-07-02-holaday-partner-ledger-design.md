# Holaday Partner Ledger Design

Date: 2026-07-02
Status: Design draft, no implementation yet
Scope: Independent Holaday partner ledger, HOLA Credit, API Units, recharge lots, release rules, KYC/risk controls, referral rewards, and isolated entry points.

## 1. Background

Holaday currently has a payment model centered on plans, add-ons, payment rows, and direct entitlement fulfillment. The partner plan should be an independent ledger system and must not change the existing subscription/add-on behavior.

The partner plan is not a securities product, exchange, crypto asset, transferable token, or guaranteed yield product. Product wording and implementation should keep it as a closed-loop participation/reward ledger:

- No user-to-user transfer.
- No secondary market.
- No guaranteed cash redemption date.
- No fixed investment return language.
- All releases are subject to platform budget, account status, KYC, risk controls, and withdrawal rules.

## 2. Confirmed Product Decisions

### 2.1 Naming

Use these names in user-facing surfaces:

- HOLA Credit: closed-loop account balance, with `1 HOLA Credit = ¥1`.
- API Units: standardized internal cost/weight unit, with base rate `1 HOLA Credit = 1,000 API Units`.

Avoid these names in user-facing surfaces:

- Coin
- Token
- Trade
- Buyback
- Investment
- Fixed yield

Internal code/table names may use neutral names such as `credit`, `unit`, `lot`, `ledger`, `allocation`, and `release`.

### 2.2 Partner Entry

Partner plan is independent from current Holaday plans.

User flow:

1. User buys annual partner membership for `¥999`.
2. Membership is valid for 1 year.
3. After becoming a partner, user must complete KYC2 before any HOLA Credit recharge.
4. After KYC2 passes, user may recharge HOLA Credit.
5. Recharged HOLA Credit creates independent Partner Lots.
6. Lots receive API Units according to recharge amount and tier multiplier.
7. API Units are used as allocation weight, not as withdrawable money.

### 2.3 Recharge Limits

Initial proposed recharge limits:

- Minimum single recharge: `¥10,000`.
- Maximum single recharge: `¥200,000`.
- Maximum user monthly recharge: `¥500,000`.
- Earlier annual max of `¥6,000,000` is too high for MVP and should be reduced.

MVP recommendation:

- First total platform pool cap: `¥500,000` to `¥1,000,000`.
- Per-user annual cap: `¥1,000,000` by default.
- Amount above default cap requires whitelist and enhanced review.

### 2.4 Tier Multipliers

Recharge amounts are accumulated over a 30-day rolling window. Final tier is calculated by rolling 30-day cumulative amount.

| Rolling 30-day recharge amount | API Units multiplier |
| --- | ---: |
| ¥10,000-¥50,000 | 1.05x |
| ¥50,001-¥100,000 | 1.08x |
| ¥100,001-¥200,000 | 1.12x |
| ¥200,001-¥400,000 | 1.16x |
| ¥400,001-¥500,000 | 1.20x |

When a later recharge raises the 30-day cumulative tier, do not rewrite historical ledger rows. Add a separate `tier_adjustment` ledger entry for the difference.

## 3. API Units Valuation

Base rule:

```text
1 HOLA Credit = ¥1
1 HOLA Credit = 1,000 API Units
1 API Unit = ¥0.001 reference API cost
```

API Units are not raw model tokens. They normalize real provider cost across providers, models, input tokens, output tokens, cache reads, cache writes, image generation, video generation, and other API costs.

For LLM calls, Holaday already records `llm_calls.cost_usd`. The partner system should derive cost pool units using:

```text
apiUnitsFromCost = actualCostUsd * usdToCnyRate * 1000
```

Initial exchange-rate source may reuse the existing admin finance constant (`7.2`) for internal reporting, but the production system should later move FX to a configurable table or daily rate snapshot.

Important cap rule:

```text
120% total release cap is based on principal HOLA Credit, not tier-adjusted API Units.
```

Example:

```text
Recharge: ¥10,000
Principal: 10,000 HOLA Credit
Tier multiplier: 1.05x
API Units: 10,000 * 1,000 * 1.05 = 10,500,000
Maximum total release: 10,000 * 120% = 12,000 HOLA Credit
Maximum bonus part: 2,000 HOLA Credit
```

This prevents top tier users from receiving both `1.20x` weight and `120%` principal cap as a compounded 144% effect.

## 4. Partner Lot Model

Every recharge creates one immutable Partner Lot.

Lot fields:

- `principalCredit`: actual HOLA Credit recharged.
- `tierMultiplier`: multiplier at creation or adjusted by later 30-day cumulative tier changes.
- `apiUnits`: principal credit multiplied by 1,000 and tier multiplier.
- `principalClaim`: principal amount eligible for future release.
- `bonusCap`: `principalCredit * 20%`.
- `totalClaimCap`: `principalCredit * 120%`.
- `lockStartAt`: lot creation time.
- `accumulationEndsAt`: lock start plus 120 days.
- `releaseStartsAt`: day 121.
- `releaseEndsAt`: release start plus 8 months.
- `status`: lifecycle state.

Lot lifecycle:

```text
created
  -> accumulating
  -> release_pending
  -> releasing
  -> completed
```

Risk lifecycle overlays:

```text
normal
  -> review_required
  -> frozen
  -> resumed
  -> closed
```

## 5. 12-Month Release Algorithm

Use the updated stable model:

- First 4 months: accumulation period. Calculate and lock bonus allocation, but do not allow withdrawal.
- Next 8 months: monthly release period. Release principal plus accumulated bonus to withdrawable HOLA Credit, subject to KYC, membership, and risk controls.
- Full target cycle: 12 months.

### 5.1 First 120 Days: Accumulation, No Withdrawal

For each lot:

```text
P = principalCredit
bonusCap = P * 20%
targetAccumulationDays = 120
targetDailyBonus = bonusCap / 120
```

Daily allocation is budget-gated:

```text
actualDailyBonus = min(targetDailyBonus, budgetAllocatedToThisLot, remainingBonusCap)
```

Accumulated bonus remains locked during this period:

```text
lockedBonus += actualDailyBonus
availableCredit += 0
withdrawableCredit += 0
```

Product wording should call this "accumulated locked bonus" or "locked release amount", not withdrawable income.

### 5.2 Months 5-12: Monthly Release

After the 120-day accumulation period, the lot enters 8 monthly release windows.

Target monthly release:

```text
targetMonthlyRelease = (principalCredit + lockedBonus) / 8
```

If the lot reaches full target bonus, this equals:

```text
targetMonthlyRelease = principalCredit * 120% / 8
targetMonthlyRelease = principalCredit * 15%
```

Example for `¥10,000` recharge with full bonus:

| Period | State | Target release |
| --- | --- | ---: |
| Months 1-4 | Accumulation, no withdrawal | 0 |
| Month 5 | Release 1/8 | 1,500 HOLA Credit |
| Month 6 | Release 2/8 | 1,500 HOLA Credit |
| Month 7 | Release 3/8 | 1,500 HOLA Credit |
| Month 8 | Release 4/8 | 1,500 HOLA Credit |
| Month 9 | Release 5/8 | 1,500 HOLA Credit |
| Month 10 | Release 6/8 | 1,500 HOLA Credit |
| Month 11 | Release 7/8 | 1,500 HOLA Credit |
| Month 12 | Release 8/8 | 1,500 HOLA Credit |

Internally each release should track principal and bonus portions:

```text
principalReleasePortion = principalCredit / 8
bonusReleasePortion = lockedBonus / 8
monthlyRelease = principalReleasePortion + bonusReleasePortion
```

For the `¥10,000` full-bonus example:

```text
principalReleasePortion = 10,000 / 8 = 1,250
bonusReleasePortion = 2,000 / 8 = 250
monthlyRelease = 1,500
```

### 5.3 Budget Constraint

All accumulation and release operations are constrained by platform budget.

Daily/monthly platform release budget:

```text
platformReleaseBudget = min(
  configuredBudget,
  recentNetRevenue * releaseRatio,
  reserveBalance,
  riskBudget
)
```

If monthly release budget is insufficient:

```text
carryForward = targetMonthlyRelease - actualMonthlyRelease
```

Carry-forward is delayed to future release windows. It should not disappear, but it also should not be marketed as guaranteed by a fixed date.

### 5.4 Allocation Priority

When budget is insufficient, use this order:

1. Earlier eligible lot first (FIFO by release eligibility date).
2. Same eligibility day sorted by weighted API Units.
3. Same weighted score sorted by original lot creation time.
4. Risk-frozen lots receive no release until resumed.

Weight formula:

```text
lotWeight = apiUnits * ageFactor * activityFactor * riskFactor
```

Recommended defaults:

```text
ageFactor = 1.00 to 1.20
activityFactor = 1.00 to 1.10
riskFactor = 1 for normal, 0 for frozen, 0.5 for review_required
```

## 6. Cost Pool and Platform Budget

The system should separate two concepts:

1. API Units cost pool: derived from actual Holaday API usage and real provider cost.
2. HOLA Credit release budget: derived from platform finance capacity.

Recommended hybrid model:

```text
dailyApiUnitsPool = sum(actual API cost for day) * FX * 1000
dailyCreditReleaseBudget = min(configured budget, recent net revenue ratio, reserve balance, risk budget)
```

Why separate them:

- API Units pool keeps the system tied to real Holaday R&D usage.
- Release budget prevents cash-flow pressure and avoids run-like behavior.
- Partner allocation can be transparent without becoming a fixed redemption promise.

Current Holaday cost reference from project records:

| Scenario | Monthly API cost estimate | Monthly API Units |
| --- | ---: | ---: |
| Strict smoke/dev only | < $1 | < 7,200 |
| Light R&D, 10 sites/month | $10-$16 | 72,000-115,200 |
| Normal R&D, 30 sites/month | $30-$48 | 216,000-345,600 |
| Active R&D, 50 sites/month | $50-$80 | 360,000-576,000 |
| Current exploration hard cap | $200/month | 1,440,000 |

Because a single `¥10,000` recharge at 1.05x creates `10,500,000 API Units`, API Units should be treated as weight, not literal monthly redeemable output from current API cost.

## 7. HOLA Credit Ledger

Use append-only ledger entries. Do not mutate balances directly except as derived snapshots.

Recommended account buckets:

- `availableCredit`: can be used inside Holaday.
- `lockedCredit`: principal or bonus under lock.
- `withdrawableCredit`: eligible for withdrawal request.
- `pendingWithdrawalCredit`: withdrawal requested, not paid.
- `frozenCredit`: held by risk control.

Monthly releases should move credit from locked state to `withdrawableCredit` in the MVP. A withdrawal request then moves eligible credit from `withdrawableCredit` into `pendingWithdrawalCredit` after active membership, KYC, same-name bank, amount, cooldown, and risk checks pass. Future inside-Holaday spending can use `availableCredit` without making it cash-withdrawable by default.

Ledger entry types:

- `partner_membership_purchase`
- `recharge`
- `api_unit_grant`
- `tier_adjustment`
- `bonus_accrual_locked`
- `release_principal`
- `release_bonus`
- `withdrawal_requested`
- `withdrawal_paid`
- `withdrawal_rejected`
- `withdrawal_returned`
- `referral_reward_locked`
- `referral_reward_released`
- `risk_freeze`
- `risk_unfreeze`
- `admin_adjustment`

Every ledger entry should include:

- `externalId`
- `userId`
- `lotId` when related to a lot
- `amountCredit`
- `amountApiUnits` when relevant
- `direction`
- `entryType`
- `status`
- `idempotencyKey`
- `metadata`
- `createdAt`

## 8. KYC and Risk Controls

### 8.1 KYC Sequence

Confirmed sequence:

1. User registers/logs in.
2. User buys annual partner membership (`¥999`) before KYC2.
3. Before first recharge, user completes KYC2.
4. Recharges require KYC2 pass.
5. Withdrawal requires KYC2 pass, same-name bank account, and withdrawal risk review.
6. High-value or abnormal users may require enhanced review.

### 8.2 KYC2 Components

For China mainland users, prefer automated verification where available:

- Real name + resident ID verification.
- Face liveness / real-person check.
- Bank card 3-factor or 4-factor verification.
- Reserved phone verification.
- Same-name bank account binding.

Manual review should be avoided for normal users and reserved for exceptions.

### 8.3 Manual Review Triggers

Trigger manual review when any of these happen:

- Identity, face, phone, or bank card mismatch.
- Same ID, card, device, IP, or payment instrument appears across many accounts.
- High recharge amount or rapid repeated recharge.
- Withdrawal requested soon after release.
- Referral rewards concentrated around one inviter.
- Many accounts connected by device fingerprint or bank account.
- Chargeback, refund, or provider callback anomaly.
- Admin-configured threshold exceeded.

### 8.4 Withdrawal Rules

Recommended MVP withdrawal controls:

- Withdrawals only to verified same-name bank account.
- Minimum withdrawal amount: `¥100` or `¥500`, final value to be configured.
- Withdrawal review delay: `T+7` normal, `T+15` high-risk or high-amount.
- Daily platform withdrawal cap.
- Monthly user withdrawal cap.
- Cooldown after bank card change.
- No withdrawal for frozen accounts.

## 9. Referral and Reward Rules

Existing invitation should become "invite friends, earn HOLA Credit".

Rules:

- Invite success: grant task quota or locked HOLA Credit reward.
- Invite success and friend recharges: inviter receives `20%` reward.
- Third-party recharge / assisted recharge: reward rate `10%`.

Recommended safety design:

- Referral rewards are locked first, not immediately withdrawable.
- Release referral rewards over time, or release only after invited user's recharge lot passes refund/risk window.
- Referral rewards count toward risk review if concentrated.
- Referral rewards should not create API Units unless explicitly configured.
- Referral rewards should not increase principal cap for 120% release.

For MVP, referral reward should be HOLA Credit usable inside Holaday first. Withdrawal eligibility can be added after fraud data is available.

## 10. Daily Activity Game

Daily mining/game mechanics should not directly create withdrawable HOLA Credit.

Recommended design:

- Daily login, task completion, viewing R&D progress, and valid invitation can increase `activityFactor`.
- `activityFactor` range: `1.00` to `1.10`.
- Activity boost affects next-day or next-cycle allocation weight.
- Activity boost expires quickly, for example 7 days.
- No activity can bypass lock period, risk freeze, KYC, or withdrawal limits.

This gives users a reason to return without increasing platform liabilities beyond budget.

## 11. Independent Architecture

The partner system should be isolated from the current plan/add-on flow.

Current system:

- `payments` table records provider payment attempts.
- Subscription and add-on fulfillment directly update user plan or quota.
- CN payment app confirms provider callbacks into orchestrator internal payment confirm endpoint.

Partner system should add separate modules:

- `partner_memberships`
- `hola_credit_accounts`
- `hola_credit_ledger_entries`
- `partner_recharge_orders`
- `partner_lots`
- `api_unit_lot_events`
- `api_cost_pool_events`
- `partner_daily_allocations`
- `partner_monthly_releases`
- `partner_withdrawal_requests`
- `partner_kyc_profiles`
- `partner_risk_events`
- `partner_referrals`

Services:

- `PartnerMembershipService`
- `KycService`
- `RechargeService`
- `CreditLedgerService`
- `ApiUnitsService`
- `AllocationService`
- `ReleaseService`
- `WithdrawalService`
- `PartnerRiskService`
- `ReferralService`

Schedulers:

- Daily API cost pool builder.
- Daily accumulation allocator.
- Monthly release scheduler.
- Withdrawal review processor.
- Risk scan job.

All partner writes should be idempotent and append-only where money-like balance changes are involved.

## 12. Entry Points and Pages

Create a new independent entrance. Do not mix it into existing plan purchase flow.

Suggested pages:

- Partner landing/overview page.
- Annual partner membership purchase page.
- KYC status page.
- Recharge page with slider and tier preview.
- Partner dashboard.
- Lot detail page.
- HOLA Credit ledger page.
- API Units allocation page.
- Release schedule page.
- Withdrawal request page.
- Referral page.
- Risk/KYC action-required page.

Billing page may link to partner dashboard, but existing subscription billing behavior should remain unchanged.

## 13. User-Facing Wording

Use:

- "HOLA Credit"
- "API Units"
- "locked"
- "scheduled release"
- "estimated"
- "subject to platform budget and account status"
- "closed-loop balance"

Avoid:

- "coin"
- "token"
- "investment"
- "guaranteed return"
- "fixed income"
- "buyback"
- "cash out any time"
- "annualized yield"

Recommended wording:

```text
前120天为累计观察期，期间累计额度仅锁定展示，不支持提现。
第121天起进入8个月释放期，按月释放至 HOLA Credit 账户。
实际释放受平台可分配预算、账户状态、实名信息及风控规则影响。
```

## 14. MVP Operating Caps

Recommended first launch:

- Platform total partner recharge pool cap: `¥500,000` to `¥1,000,000`.
- Single recharge: `¥10,000` to `¥200,000`.
- User monthly recharge: max `¥500,000`, but MVP may lower this.
- User annual recharge: default max `¥1,000,000`.
- Above default annual cap: whitelist plus enhanced review.
- First withdrawal capability can be delayed until first lots enter release period.

## 15. Implementation Boundaries

Do not implement yet until this spec is reviewed and converted into an implementation plan.

Implementation should follow these boundaries:

- Additive database changes only.
- No migration that changes current plan/add-on semantics.
- No change to existing subscription entitlements.
- Partner payment confirmation path can reuse provider integrations, but fulfillment must go through partner services.
- Ledger entries must be idempotent.
- All scheduled jobs must be re-runnable.
- Risk freeze must be able to stop releases and withdrawals without deleting ledger history.

## 16. Testing Strategy

When implementation starts, test these areas:

- Tier calculation across rolling 30-day windows.
- Tier adjustment entries without rewriting historical rows.
- Lot cap calculations.
- 120-day accumulation without available/withdrawable balance changes.
- 12-month total cycle with an 8-month release schedule after the 120-day accumulation period.
- Budget insufficiency and carry-forward.
- FIFO plus weighted allocation ordering.
- Risk freeze and resume.
- KYC gate before recharge.
- Withdrawal gate after release.
- Referral reward lock/release behavior.
- Idempotency for payment callbacks and scheduler reruns.
- Isolation from existing subscription/add-on payment flows.

## 17. Open Decisions

These should be confirmed before implementation planning:

1. MVP total platform recharge cap: `¥500,000` or `¥1,000,000`.
2. User annual cap: keep `¥1,000,000` default or choose another number.
3. Withdrawal minimum: `¥100`, `¥500`, or another value.
4. Withdrawal review period: normal `T+7`, high-risk `T+15`.
5. Referral recharge reward: locked HOLA Credit only, or partly usable immediately.
6. Whether partner annual membership purchase needs lightweight phone/account risk screening before payment.
7. Whether HOLA Credit can be used to buy current plans/add-ons, or only partner-related products.
8. Whether API costs beyond `llm_calls`, such as image/video providers, enter the same cost pool in MVP.

## 18. Current Design Summary

The accepted direction is a hybrid model:

- API Units are generated from real Holaday API cost and also granted to user lots as allocation weight.
- HOLA Credit is a closed-loop balance with `1 = ¥1`.
- Recharges create immutable lots.
- Tier multipliers increase API Units weight only.
- Total release is capped at `120%` of principal.
- First 4 months calculate locked bonus but do not allow withdrawal.
- Months 5-12 release principal plus locked bonus monthly.
- Actual accumulation, release, and withdrawal are constrained by platform budget and risk controls.
- MVP should cap total recharge pool tightly until real API usage, revenue, fraud data, and cash-flow behavior are validated.
