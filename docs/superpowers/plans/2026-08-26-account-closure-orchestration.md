# Account Closure Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a self-service account closure flow that freezes access immediately, permits strongly verified withdrawal for exactly 7×24 hours, then durably deletes, anonymizes, or restricts all 13 governed data categories and releases the old email/phone for a genuinely new account.

**Architecture:** Add an append-only closure request/step/effect/receipt model, route all login methods through one account-status decision, and run irreversible work in a single-concurrency database-leased worker. The API owns preview, verification, freeze, status, cancellation, and receipts; individual handlers own one stable governance category each. Finalization keeps a minimal non-login user tombstone so payment and partner references remain intact while all reusable identity keys are cleared.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM/MySQL, tRPC, React/Vite, Vitest, PM2/bash, R2-compatible `StorageProvider`, Resend email, Aliyun SMS through `cn-payment`.

**Spec:** `docs/superpowers/specs/2026-08-26-account-closure-orchestration-design.md`

## Global Constraints

- [ ] Preserve the exact user states `active`, `closure_pending`, `closure_processing`, and `closed`; never issue normal credentials to a non-`active` user.
- [ ] Preserve the exact request states `pending_grace`, `cancelled`, `processing`, `needs_attention`, and `completed`, and step states `pending`, `running`, `succeeded`, `retryable`, `blocked`, and `skipped`.
- [ ] Store the grace deadline in UTC as `requestedAt + 168 hours`; UI timezone formatting cannot alter the server deadline.
- [ ] Never accept a client-supplied user ID for closure operations. Derive identity from an active access token or a verified recovery token.
- [ ] Never log or place in checkpoints/receipts email, phone, names, addresses, task text, filenames, stock preferences, cookies, verification codes, access tokens, API keys, or arbitrary free text.
- [ ] Do not implement automatic refund, entitlement prorating, full data export, fixed legal-retention periods, or restoration of deleted/running work.
- [ ] Never delete the `users` row. Finalization must clear reusable identity/authentication fields and preserve only the internal/external tombstone identity needed by restricted financial references.
- [ ] Keep the worker globally single-concurrency, use pages of at most 100 records, never download object bodies for deletion, and stop claiming new work near a 512MB RSS ceiling.
- [ ] Keep `ACCOUNT_CLOSURE_ENABLED` and `ACCOUNT_CLOSURE_WORKER_ENABLED` disabled by default. Rollout begins with a dedicated allowlist, not real-user destructive testing.
- [ ] Complete each task with its targeted tests, typecheck where relevant, and `git diff --check`; do not hide pre-existing repository-wide lint noise.

---

## Task 1: Add the Durable Closure Schema and State Contracts

**Files:**

- Create: `apps/orchestrator/drizzle/0051_account_closures.sql`
- Create: `apps/orchestrator/src/db/schema/account-closures.ts`
- Create: `apps/orchestrator/src/account-closure/types.ts`
- Create: `apps/orchestrator/src/account-closure/state-machine.ts`
- Create: `apps/orchestrator/src/account-closure/state-machine.test.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Modify: `apps/orchestrator/src/db/schema/users.ts`
- Modify: `apps/orchestrator/scripts/verify-db-schema.ts`
- Modify: `apps/orchestrator/src/test/db-helper.ts`
- Modify: `apps/orchestrator/scripts/release-db-contract.mjs`
- Modify: `apps/orchestrator/scripts/release-db-contract.test.mjs`

**Interfaces:**

```ts
export const ACCOUNT_CLOSURE_USER_STATUSES = [
  'active', 'closure_pending', 'closure_processing', 'closed',
] as const;
export type AccountClosureUserStatus = (typeof ACCOUNT_CLOSURE_USER_STATUSES)[number];

export const ACCOUNT_CLOSURE_REQUEST_STATUSES = [
  'pending_grace', 'cancelled', 'processing', 'needs_attention', 'completed',
] as const;
export type AccountClosureRequestStatus =
  (typeof ACCOUNT_CLOSURE_REQUEST_STATUSES)[number];

export const ACCOUNT_CLOSURE_STEP_STATUSES = [
  'pending', 'running', 'succeeded', 'retryable', 'blocked', 'skipped',
] as const;

export function assertRequestTransition(
  from: AccountClosureRequestStatus,
  to: AccountClosureRequestStatus,
): void;

export const ACCOUNT_CLOSURE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
export function closureGraceEndsAt(requestedAt: Date): Date;
```

`account_closure_requests` must include `id`, random `external_id`, `user_id`, nullable unique `active_user_id`, status, fixed-enum `reason_code`, all state timestamps, and audit timestamps. Receipt numbers live only in `account_closure_receipts`. `active_user_id=user_id` while active and becomes `NULL` on `cancelled` or `completed`; this is the MySQL equivalent of a partial unique index.

`account_closure_steps` must include request/category uniqueness, handler version, retry/lease fields, JSON checkpoint restricted to cursor/count values, processed count, enum error code, and lifecycle timestamps.

`account_closure_effects` must uniquely identify `(request_id, resource_type, resource_id)` and store only previous/applied state plus `restored_at`.

`account_closure_challenges` must store action (`begin` or `cancel`), delivery channel, salted code hash, attempt count, expiry and one-time `used_at`; it must not store raw destination or code.

`account_closure_receipts` must have a unique random receipt number, receipt kind (`application` or `completion`), uniqueness on `(request_id, kind)`, nullable irreversible `subject_digest` used only by the completion receipt, JSON arrays of category IDs, notification status, issue/completion times, and no raw identity field. The application and completion receipts are separate rows; neither is a public lookup credential.

- [ ] Write `state-machine.test.ts` first. Cover every allowed transition, reject `cancelled → processing`, reject `completed → *`, reject cancellation at or after the exact deadline, and assert `closureGraceEndsAt` adds precisely 168 hours through DST boundaries.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/account-closure/state-machine.test.ts`; expect failure because the module does not exist.
- [ ] Implement the constants, transition tables, deadline helper, and fixed reason/error enums in `types.ts` and `state-machine.ts`.
- [ ] Define all five Drizzle tables in `account-closures.ts`, export them from the schema barrel, and add `0051_account_closures.sql` with explicit indexes and `ON DELETE RESTRICT` from requests/receipts to users.
- [ ] Update the `users.status` documentation to describe the four states and remove the obsolete “no soft delete” statement. Do not add a nullable `deleted_at` shortcut.
- [ ] Add all new tables and required columns to `verify-db-schema.ts` and the release DB contract. Add the five tables to the integration reset list in dependency-safe order.
- [ ] Add/extend release-contract tests proving migration 0051 is discoverable, additive, and must run before app rollout.
- [ ] Run the targeted state and release-contract tests; expect all to pass.
- [ ] With a disposable local test database, run `pnpm --filter @holaday/orchestrator db:migrate:numbered` and `pnpm --filter @holaday/orchestrator db:verify`; expect the five tables and required indexes to verify.
- [ ] Run `pnpm --filter @holaday/orchestrator typecheck` and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/drizzle/0051_account_closures.sql apps/orchestrator/src/db/schema apps/orchestrator/src/account-closure apps/orchestrator/scripts/verify-db-schema.ts apps/orchestrator/src/test/db-helper.ts apps/orchestrator/scripts/release-db-contract.mjs apps/orchestrator/scripts/release-db-contract.test.mjs && git commit -m "feat(account): add durable closure state model"`

## Task 2: Build Purpose-Isolated Verification and Recovery Credentials

**Files:**

- Create: `apps/orchestrator/src/account-closure/challenge-service.ts`
- Create: `apps/orchestrator/src/account-closure/challenge-service.test.ts`
- Create: `apps/orchestrator/src/account-closure/sms-gateway-client.ts`
- Create: `apps/orchestrator/src/account-closure/sms-gateway-client.test.ts`
- Modify: `apps/orchestrator/src/auth/jwt.ts`
- Modify: `apps/orchestrator/src/auth/jwt.test.ts`
- Modify: `apps/orchestrator/src/auth/mfa-service.ts`
- Modify: `apps/orchestrator/src/auth/mfa-service.integration.test.ts`
- Modify: `apps/cn-payment/src/sms.ts`
- Create: `apps/cn-payment/src/sms.test.ts`
- Modify: `apps/cn-payment/src/index.ts`
- Modify: `apps/cn-payment/src/config/env.ts`
- Modify: `apps/cn-payment/src/index.test.ts`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/auth/jwt.test.ts src/account-closure/challenge-service.test.ts src/account-closure/sms-gateway-client.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/auth/mfa-service.integration.test.ts
pnpm --filter @holaday/cn-payment exec vitest run src/sms.test.ts src/index.test.ts
```

**Interfaces:**

```ts
export type AccountClosureChallengeAction = 'begin' | 'cancel';
export type AccountClosureChannel = 'email' | 'sms';

export interface CreateClosureChallengeInput {
  userId: number;
  requestId?: number;
  action: AccountClosureChallengeAction;
}

export interface ClosureChallengeDelivery {
  challengeId: string;
  channel: AccountClosureChannel;
  maskedDestination: string;
  expiresAt: Date;
}

export interface AccountClosureRecoveryClaims {
  sub: string;
  requestId: string;
  authVersion: number;
  aud: 'account-closure-recovery';
}

export function signAccountClosureRecoveryToken(
  claims: Omit<AccountClosureRecoveryClaims, 'aud'>,
): string;
export function verifyAccountClosureRecoveryToken(
  token: string,
): AccountClosureRecoveryClaims;
```

Closure challenges select the destination from the authenticated user record: verified email first, otherwise verified phone. A request cannot provide a destination. The Orchestrator generates the code with `crypto.randomInt`, persists only a salted hash, and is the sole verifier for both channels. Codes expire after 10 minutes, permit at most five failed attempts, and are one-use.

The `cn-payment` service is delivery-only for closure codes: an internal authenticated endpoint accepts the already-generated code and action, selects the dedicated template, sends it, and does not store or verify it. Existing public login endpoints retain their current in-memory store and implicit login purpose, but their code generation also moves from `Math.random` to `crypto.randomInt`. Public callers cannot select a closure action or supply a code.

- [ ] Write failing JWT tests proving an access-token verifier rejects recovery tokens, a recovery verifier rejects access/MFA tokens, and recovery tokens expire after 10 minutes.
- [ ] Write failing challenge tests for purpose separation, one-time consumption, expiry, five-attempt lockout, masked destination only, and no raw destination/code in persisted/logged structures.
- [ ] Write failing SMS tests proving the internal closure-send route rejects absent/wrong secrets, the public route cannot select a closure action or supply a code, the supplied code is never stored by the gateway, and existing login codes use `crypto.randomInt`.
- [ ] Run the three targeted suites; expect missing exports and purpose failures.
- [ ] Add the recovery JWT audience and sign/verify functions without weakening existing access or MFA verification.
- [ ] Implement the durable challenge service using the new table, constant-time hash comparison, server-selected channel, `EmailSender` for email, and `sms-gateway-client.ts` for SMS delivery. Persist the challenge before sending; mark a delivery error without consuming the challenge.
- [ ] Add `verifyUserFactor(userExternalId, code): Promise<void>` to `MfaService`, reusing the existing replay and lockout logic without issuing an access token.
- [ ] Add `sendAccountClosureCode(rawPhone, code, action)` plus `sendAccountClosureComplete(rawPhone, receiptNumber)` and their internal endpoints, protected by `x-internal-secret`. Do not add a closure verify route; verification remains durable in Orchestrator. Keep existing public login behavior compatible.
- [ ] Add `ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE` and `ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE` as required production values when closure SMS is enabled. Never fall back to the login template.
- [ ] Rerun targeted tests, `pnpm --filter @holaday/orchestrator typecheck`, `pnpm --filter @holaday/cn-payment typecheck`, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/account-closure apps/orchestrator/src/auth apps/cn-payment/src && git commit -m "feat(account): add isolated closure verification"`

## Task 3: Enforce Account Status Across Every Authentication Path

**Files:**

- Modify: `apps/orchestrator/src/auth/service.ts`
- Modify: `apps/orchestrator/src/auth/service.test.ts`
- Modify: `apps/orchestrator/src/auth/mfa-service.ts`
- Modify: `apps/orchestrator/src/auth/middleware.ts`
- Modify: `apps/orchestrator/src/auth/middleware.test.ts`
- Modify: `apps/orchestrator/src/api-keys/webhook-handler.ts`
- Modify: `apps/orchestrator/src/api-keys/webhook-handler.test.ts`
- Modify: `apps/orchestrator/src/http.ts`
- Create: `apps/orchestrator/src/http.account-closure.test.ts`
- Modify: `apps/cn-payment/src/sync-to-vultr.ts`
- Modify: `apps/web-workbench/src/lib/auth.ts`
- Create: `apps/web-workbench/src/lib/auth.closure.test.ts`
- Modify: `apps/web-workbench/src/components/LoginGate.tsx`
- Create: `apps/web-workbench/src/components/LoginGate.closure.test.tsx`
- Modify: `apps/web-workbench/src/pages/LoginPage.tsx`
- Modify: `apps/web-workbench/src/pages/RegisterPage.tsx`
- Modify: `apps/web-workbench/src/components/AppShell.tsx`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/auth/service.test.ts src/auth/middleware.test.ts src/api-keys/webhook-handler.test.ts src/http.account-closure.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/auth/service.integration.test.ts src/auth/mfa-service.integration.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/lib/auth.closure.test.ts src/components/LoginGate.closure.test.tsx src/components/LoginGate.mfa.test.tsx
```

**Interfaces:**

```ts
export interface ClosureRecoveryRequiredResult {
  user: PublicUser;
  closureRecoveryRequired: true;
  recoveryToken: string;
  closureStatus: 'pending_grace' | 'processing' | 'needs_attention';
}

export type LoginResult =
  | AuthenticatedResult
  | MfaRequiredResult
  | ClosureRecoveryRequiredResult;

export function isClosureRecoveryResult(
  result: LoginResult,
): result is ClosureRecoveryRequiredResult;
```

- [ ] Add table-driven failing auth tests for password, email code, Google, phone, MFA completion, bearer refresh/revalidation, API key, and WebSocket paths. For each path assert `active` succeeds, `closure_pending` returns only a recovery result, and `closure_processing`/`closed` never receives a normal token.
- [ ] Add tests that `closure_pending` registration/login by a matching email/phone/Google identity does not create a second user during the grace window.
- [ ] Run targeted auth/HTTP/API-key tests; expect current login issuance to violate the new cases.
- [ ] Centralize the status decision inside `issueLoginResult`: only `active` can issue access/MFA credentials; `closure_pending` issues a 10-minute recovery token; processing/attention can issue a status-only recovery token; `closed` returns the same generic authentication failure as an absent account.
- [ ] Recheck user status inside `MfaService.verifyChallenge` immediately before access-token issuance to close the login→freeze→MFA race.
- [ ] Preserve the existing middleware status-plus-`authVersion` gate and add regression tests for revoked access/stream/WebSocket tokens after freeze and after withdrawal.
- [ ] Pass the closure recovery union through Google callback and the internal SMS bridge. Google callback may emit `#closure=<token>` but must not log raw email/Google subject in the new closure branch.
- [ ] Store recovery tokens in `sessionStorage`, never `localStorage`; clear access, MFA, and stale recovery state when switching modes. Extend `LoginGate` with `onClosureRecovery` and route to `/account/closure-recovery`.
- [ ] Rerun the targeted suites, both app typechecks, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/auth apps/orchestrator/src/api-keys apps/orchestrator/src/http.ts apps/cn-payment/src/sync-to-vultr.ts apps/web-workbench/src && git commit -m "feat(auth): gate closure accounts across login paths"`

## Task 4: Implement Atomic Freeze, Immediate Effects, and Exact Withdrawal Restoration

**Files:**

- Create: `apps/orchestrator/src/account-closure/repository.ts`
- Create: `apps/orchestrator/src/account-closure/immediate-effects.ts`
- Create: `apps/orchestrator/src/account-closure/immediate-effects.test.ts`
- Create: `apps/orchestrator/src/account-closure/immediate-effects.integration.test.ts`
- Modify: `apps/orchestrator/src/agent/task-repository.ts`
- Modify: `apps/orchestrator/src/agent/supercar/agent-loop.ts`
- Modify: `apps/orchestrator/src/agent/scheduled-runner.ts`
- Modify: `apps/orchestrator/src/agent/scheduled-runner.test.ts`
- Modify: `apps/orchestrator/src/planned/planned-runner.ts`
- Modify: `apps/orchestrator/src/planned/planned-runner.test.ts`
- Modify: `apps/orchestrator/src/stocks/stock-risk-monitor-executor.ts`
- Modify: `apps/orchestrator/src/stocks/stock-risk-monitor-executor.test.ts`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/account-closure/immediate-effects.test.ts src/agent/scheduled-runner.test.ts src/planned/planned-runner.test.ts src/stocks/stock-risk-monitor-executor.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/account-closure/immediate-effects.integration.test.ts
```

**Interfaces:**

```ts
export interface ClosureEffectSummary {
  cancelledTaskIds: string[];
  pausedPlannedTaskIds: string[];
  pausedScheduledTaskIds: string[];
  disabledNotificationChannelIds: string[];
}

export async function applyImmediateClosureEffects(
  db: DB,
  input: { requestId: number; userId: number; userExternalId: string },
): Promise<ClosureEffectSummary>;

export async function restoreImmediateClosureEffects(
  db: DB,
  input: { requestId: number; userId: number },
): Promise<void>;
```

The freeze transaction must conditionally update `users.status='active'`, create one active request, increment `authVersion`, revoke sessions/API keys, and seed exactly 13 category steps. Immediate effects run after that transaction and are durable/retryable; failure never rolls back the frozen account.

- [ ] Write a failing integration test that submits twice concurrently and proves only one active request is created and the user is frozen once.
- [ ] Write failing effect tests with mixed resource states. Assert only active/running tasks are cancelled, only enabled/active planned/scheduled/notification resources are changed, and effects are recorded only for resources this request changed.
- [ ] Add the cancellation-vs-worker-claim race test: one conditional update wins; if processing wins, withdrawal returns a stable “deadline passed/processing” error without restoring anything.
- [ ] Add runner race tests where work is claimed before freeze but dispatch occurs after freeze. Scheduled, planned, and stock runners must re-read `users.status='active'` before external execution and before any transition that would reactivate future work.
- [ ] Run targeted tests; expect failures because current runners do not share the closure gate.
- [ ] Implement repository transactions with compare-and-set predicates and row locks only inside short transactions. Never hold a DB lock while calling an external provider or aborting an in-memory agent.
- [ ] Implement `applyImmediateClosureEffects`: persist guarded state changes, emit normal task cancellation events, call `supercarAbort` after commit for local running handles, and leave retryable effect work for external cancellation failures.
- [ ] Implement restoration by reading effect rows, rechecking ownership and current `closureAppliedState`, and restoring only resources unchanged since freeze. Mark each effect `restoredAt`; do not restart cancelled tasks.
- [ ] Preserve original plan expiry/quota values by not mutating them during the grace period. Withdrawal changes only status/authVersion and recorded effects.
- [ ] Add the active-user guard to all three runners and their retry/finalize paths.
- [ ] Rerun targeted unit/integration tests, orchestrator typecheck, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/account-closure apps/orchestrator/src/agent apps/orchestrator/src/planned apps/orchestrator/src/stocks && git commit -m "feat(account): freeze execution and restore exact effects"`

## Task 5: Expose the Closure Service and tRPC Contract

**Files:**

- Create: `apps/orchestrator/src/account-closure/service.ts`
- Create: `apps/orchestrator/src/account-closure/service.test.ts`
- Create: `apps/orchestrator/src/account-closure/receipt-service.ts`
- Create: `apps/orchestrator/src/account-closure/receipt-service.test.ts`
- Create: `apps/orchestrator/src/trpc/routers/account-closure.ts`
- Create: `apps/orchestrator/src/trpc/routers/account-closure.test.ts`
- Modify: `apps/orchestrator/src/trpc/router.ts`
- Modify: `apps/orchestrator/src/config/env.ts`
- Create: `apps/orchestrator/src/config/env.account-closure.test.ts`

**Targeted test command:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/account-closure/service.test.ts src/account-closure/receipt-service.test.ts src/trpc/routers/account-closure.test.ts src/config/env.account-closure.test.ts
```

**Interfaces:**

```ts
export const closureReasonSchema = z.enum([
  'not_using', 'privacy', 'cost', 'missing_features', 'other_fixed',
]);

export const beginClosureSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  mfaCode: z.string().min(6).max(12).optional(),
  reasonCode: closureReasonSchema.optional(),
  acknowledgements: z.object({
    immediateSignOut: z.literal(true),
    runningWorkStops: z.literal(true),
    noAutomaticRefund: z.literal(true),
  }),
});

export interface ClosurePreview {
  graceEndsAt: string;
  plan: { name: string; expiresAt: string | null };
  counts: {
    activeTasks: number;
    futureTasks: number;
    files: number;
    stockItems: number;
    notificationChannels: number;
  };
  retainedCategoryIds: string[];
  automaticRefund: false;
}
```

Routes:

- `accountClosure.preview`, `requestVerification`, and `begin` use `protectedProcedure` and never accept user ID/destination.
- `status`, `requestCancellationVerification`, `cancel`, and `applicationReceipt` accept only the recovery token, verify its audience/request/user/authVersion, then derive server identity.
- Completion receipts are not publicly enumerable; the receipt number is for support, not public lookup.

- [ ] Write failing router tests for all seven procedures, exact acknowledgement requirements, generic anti-enumeration errors, rate limits, challenge replay, MFA requirement, allowlist behavior, and feature-disabled behavior.
- [ ] Add preview tests proving the response contains aggregate counts only and never task titles, filenames, identity values, or internal row IDs.
- [ ] Add receipt serialization tests with a sentinel forbidden-data object and recursively assert no forbidden keys/values appear. Assert one immutable application receipt is created at submission and at most one completion receipt is created during finalization.
- [ ] Run targeted service/router tests; expect missing router failures.
- [ ] Add environment flags:
  `ACCOUNT_CLOSURE_ENABLED=false`, `ACCOUNT_CLOSURE_WORKER_ENABLED=false`, `ACCOUNT_CLOSURE_ALLOWLIST=''`, and `ACCOUNT_CLOSURE_HMAC_SECRET=''`. Require a minimum 32-character HMAC secret whenever either flag is enabled.
- [ ] Implement the service orchestration: preview, server-selected verification, begin/freeze, status, cancellation verification, conditional cancellation/restoration, and application receipt.
- [ ] Create the `application` receipt at submission with a cryptographically random non-sequential number, timestamps, category IDs, and no raw content. `applicationReceipt` returns only this row; it never exposes the later restricted subject digest.
- [ ] Register the router in `trpc/router.ts`; keep all response schemas explicit so accidental DB-row leakage fails tests.
- [ ] Rerun targeted tests, orchestrator typecheck, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/account-closure apps/orchestrator/src/trpc apps/orchestrator/src/config && git commit -m "feat(account): expose self-service closure API"`

## Task 6: Lock the 13-Category Handler Contract and Implement Relational Cleanup

**Files:**

- Create: `apps/orchestrator/src/account-closure/handler-contract.ts`
- Create: `apps/orchestrator/src/account-closure/handler-registry.ts`
- Create: `apps/orchestrator/src/account-closure/handler-registry.test.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/account-security.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/task-execution.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/cross-task-memory.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/energy-astrology-profile.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/stock-preference-profile.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/feedback-support.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/external-notifications.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/extension-site-stats.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/extension-login-cookies.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/analytics-logs.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/relational-handlers.integration.test.ts`
- Modify: `apps/orchestrator/src/data-governance/types.ts`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/account-closure/handler-registry.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/account-closure/handlers/relational-handlers.integration.test.ts
```

**Interfaces:**

```ts
export type ClosureCheckpoint = { afterId?: number; processed: number } | null;

export interface ClosureHandlerContext {
  db: DB;
  logger: Logger;
  storage: StorageProvider;
  request: {
    id: number;
    externalId: string;
    userId: number;
    userExternalId: string;
  };
  checkpoint: ClosureCheckpoint;
  pageSize: 100;
}

export type ClosureHandlerResult =
  | { kind: 'continue'; checkpoint: NonNullable<ClosureCheckpoint>; processed: number }
  | {
      kind: 'complete';
      processed: number;
      retention: 'deleted' | 'anonymized' | 'restricted' | 'not_present';
    };

export interface AccountClosureHandler {
  categoryId: DataCategoryId;
  version: 1;
  run(context: ClosureHandlerContext): Promise<ClosureHandlerResult>;
}
```

- [ ] Write a failing registry test that imports the canonical governance category list and asserts one and only one versioned handler for each of the 13 stable IDs. Assert an invented 14th category makes the release contract fail.
- [ ] Write integration fixtures that place records for two users in sessions, tasks and child rows, execution memory/stats, profiles, feedback, notifications, site stats, pending cookies, watchlists, stock preferences/signals/monitors/snapshots, analytics association tables, and verification codes.
- [ ] For each handler, test pagination, repeated execution, crash after a saved page, other-user isolation, and `skipped` only when a verified existence query returns zero.
- [ ] Run the registry and relational integration tests; expect missing-handler failures.
- [ ] Implement the contract and registry with the exact category IDs from the governance registry. Do not dynamically treat an unknown category as skipped.
- [ ] Implement relational handlers with deterministic primary-key order, at most 100 rows per call, user ownership predicates on every mutation, and checkpoints containing only numeric cursors/counts.
- [ ] Use explicit child-before-parent deletion where needed. Do not delete the `users` row and do not rely on an undocumented cascade as evidence that a category completed.
- [ ] For `feedback_support`, preserve only records already marked for legal/active dispute retention and replace user-facing identity fields with the tombstone reference; delete ordinary feedback.
- [ ] For `analytics_logs`, remove reversible user/visitor associations and retain only existing irreversible aggregates; do not invent a new cross-account tracking identifier.
- [ ] Rerun tests, orchestrator typecheck, governance audit, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/account-closure apps/orchestrator/src/data-governance && git commit -m "feat(account): add governed closure handlers"`

## Task 7: Delete Files and Media Object-First with Durable Checkpoints

**Files:**

- Modify: `apps/orchestrator/src/files/file-service.ts`
- Create: `apps/orchestrator/src/files/file-service-account-closure.test.ts`
- Modify: `apps/orchestrator/src/files/storage-provider.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/media-assets.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/media-assets.integration.test.ts`
- Modify: `apps/orchestrator/src/account-closure/handlers/task-execution.ts`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/files/file-service-account-closure.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/account-closure/handlers/media-assets.integration.test.ts
```

**Interfaces:**

```ts
export interface DeleteUserFilesPageInput {
  userIdInternal: number;
  afterId?: number;
  limit: number;
}

export interface DeleteUserFilesPageResult {
  nextAfterId: number | null;
  deleted: number;
  done: boolean;
}

export async function deleteUserFilesPage(
  input: DeleteUserFilesPageInput,
): Promise<DeleteUserFilesPageResult>;
```

- [ ] Write a failing fake-storage test with 205 files. Assert batches never exceed 100, object deletion precedes row deletion, missing objects are success, and the final result needs three calls.
- [ ] Add a failure test where object 51 times out. Assert its DB row remains, the checkpoint does not advance beyond the failed object, and a retry deletes it exactly once semantically.
- [ ] Add media tests for avatar, base video, generated images/video/audio, voice-clone provider identifiers, and authorization evidence. Assert deletable objects are removed while a specifically retained dispute/authorization record is minimized and restricted.
- [ ] Run targeted tests; expect no paged deletion method.
- [ ] Implement `deleteUserFilesPage` using ordered metadata reads and `StorageProvider.delete` without fetching object contents. Delete the row only after object deletion reports success/not-found.
- [ ] Make task execution and media handlers share this primitive while maintaining separate category evidence. A file may be claimed by only one handler via an explicit ownership/kind rule; document and test that partition to avoid double-counting.
- [ ] Clear `users.avatarUrl`, `baseVideoFileId`, `qwenVoiceId`, and `videoSelfUseAuthorizedAt` only after associated object/provider cleanup has succeeded.
- [ ] Rerun targeted tests, orchestrator typecheck, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/files apps/orchestrator/src/account-closure/handlers && git commit -m "feat(account): delete closure media object-first"`

## Task 8: Restrict Financial Records, Finalize the Tombstone, and Prove Identity Reuse

**Files:**

- Create: `apps/orchestrator/src/account-closure/handlers/payments-entitlements.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/partner-kyc-ledger.ts`
- Create: `apps/orchestrator/src/account-closure/handlers/financial-retention.test.ts`
- Create: `apps/orchestrator/src/account-closure/tombstone-service.ts`
- Create: `apps/orchestrator/src/account-closure/tombstone-service.integration.test.ts`
- Modify: `apps/orchestrator/src/account-closure/handler-registry.ts`
- Modify: `apps/orchestrator/src/db/schema/payments.ts`
- Modify: `apps/orchestrator/src/db/schema/partner.ts`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/account-closure/handlers/financial-retention.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/account-closure/tombstone-service.integration.test.ts
```

**Interfaces:**

```ts
const RETAINED_PAYMENT_METADATA_KEYS = [
  'provider', 'environment', 'cycle', 'packId', 'providerStatus',
  'currency', 'settledAt', 'refundedAt', 'disputeStatus',
] as const;

export function sanitizePaymentMetadataForClosure(
  metadata: unknown,
): Record<string, unknown>;

export async function finalizeUserTombstone(input: {
  db: DB;
  requestId: number;
  userId: number;
  identityDigest: string;
}): Promise<void>;
```

The tombstone mutation must set email/phone/Google ID/display name/avatar/media IDs/MFA secrets/selected roles/selected skills to null or empty safe values, set verification flags false, replace the password hash with a non-authenticating value, set plan to `free`, expire/null entitlements, increment `authVersion`, and set status `closed`. Keep internal ID and old external ID only for restricted references; never place email/phone into a placeholder string.

- [ ] Write failing metadata sanitizer tests. Include payer email, approve URL, raw provider payload, address and free text; assert all are removed while only the explicit allowlist survives.
- [ ] Add partner fixtures covering KYC, ledger, commission, withdrawal, risk hold, referral and arbitrary metadata. Assert necessary financial/KYC rows survive, arbitrary display/marketing/activity content is deleted, and retained metadata is minimized without automatically changing a financial obligation’s semantic status.
- [ ] Write the finalization integration test: close an old account, then register using the same email and phone. Assert a new user ID/external ID, no old tasks/files/plan/quota/preferences, and no product query can join new identity to retained records.
- [ ] Add a negative cascade test proving payment and partner core rows remain after tombstoning.
- [ ] Run targeted tests; expect sanitizer/finalizer failures.
- [ ] Implement strict payment metadata allowlisting and partner minimization. Do not copy provider blobs into receipts or checkpoints.
- [ ] Compute `subjectDigest = HMAC-SHA-256(ACCOUNT_CLOSURE_HMAC_SECRET, canonical original identity tuple)` immediately before clearing identity. Store only the digest in the restricted receipt; never log it.
- [ ] Implement the final tombstone mutation as the last identity step after category handlers and completion-notification acceptance. Release unique identity keys by setting them to `NULL`.
- [ ] Rerun targeted tests, orchestrator typecheck, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/account-closure apps/orchestrator/src/db/schema/payments.ts apps/orchestrator/src/db/schema/partner.ts && git commit -m "feat(account): retain ledgers and finalize tombstones"`

## Task 9: Run a Single-Concurrency Leased Worker with Bounded Retries and Completion Receipts

**Files:**

- Create: `apps/orchestrator/src/account-closure/worker.ts`
- Create: `apps/orchestrator/src/account-closure/worker.test.ts`
- Create: `apps/orchestrator/src/account-closure/worker-entry.ts`
- Create: `apps/orchestrator/src/account-closure/worker.integration.test.ts`
- Modify: `apps/orchestrator/src/account-closure/repository.ts`
- Modify: `apps/orchestrator/src/account-closure/receipt-service.ts`
- Modify: `apps/orchestrator/package.json`
- Create: `scripts/start-account-closure-worker-production.sh`
- Modify: `scripts/orchestrator-runtime.sh`
- Modify: `scripts/orchestrator-runtime.test.sh`
- Modify: `scripts/deploy-current.sh`
- Modify: `scripts/deploy-migration-gate.test.sh`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/account-closure/worker.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/account-closure/worker.integration.test.ts
bash scripts/orchestrator-runtime.test.sh
bash scripts/deploy-migration-gate.test.sh
```

**Interfaces:**

```ts
export type WorkerTickResult = 'disabled' | 'idle' | 'progress' | 'attention' | 'memory_guard';

export interface AccountClosureWorkerDeps {
  db: DB;
  handlers: ReadonlyMap<DataCategoryId, AccountClosureHandler>;
  workerId: string;
  now: () => Date;
  rssBytes: () => number;
}

export async function runAccountClosureWorkerTick(
  deps: AccountClosureWorkerDeps,
): Promise<WorkerTickResult>;

export const CLOSURE_RETRY_DELAYS_MS = [
  60_000, 300_000, 1_800_000, 7_200_000, 21_600_000,
] as const;
```

One tick claims at most one due request, executes at most one page from one category, persists the result/checkpoint, and releases/renews the lease. After five automatic failures, mark the step blocked and request `needs_attention`; retry no more often than every 24 hours until operators fix the cause. Missing handler is `blocked`, never `skipped`.

- [ ] Write failing worker tests for disabled flags, due-time selection, a single global claim, lease expiry takeover, one-page-per-tick behavior, saved continuation, exact retry schedule, missing handler, and `needs_attention` without reopening access.
- [ ] Add crash integration tests at: after claim, after provider deletion before checkpoint, after checkpoint before lease release, and after receipt creation before final user update. Each restart must converge idempotently.
- [ ] Add finalization tests proving `completed` is impossible while any step is pending/running/retryable/blocked, an object remains, notification is unaccepted, identity keys remain, or entitlement remains active.
- [ ] Add notification tests: create one idempotent `completion` receipt, send its number in a minimum completion message to the still-valid verified email or phone, require provider acceptance, then clear identity and finish. Failure reuses the same completion receipt and retries delivery without issuing a false completed state or duplicate receipt.
- [ ] Add memory/concurrency tests using synthetic pages: one handler call at a time, page size 100, no unbounded `Promise.all`, and `memory_guard` before a new claim at 480MB RSS (leaving headroom below the 512MB PM2 restart limit).
- [ ] Run targeted worker/integration tests; expect missing worker failures.
- [ ] Implement lease repository methods with conditional updates: `claimDueRequest`, `claimNextStep`, `renewLease`, `markStepContinuation`, `markStepSucceeded`, `markStepRetryable`, `markStepBlocked`, and `completeRequest`.
- [ ] Implement a 30-second polling entrypoint whose durable truth is the database. Handle SIGTERM by finishing/persisting the current page and refusing a new claim.
- [ ] Add the package script `account-closure:worker` and a production start script using the built worker entry.
- [ ] Extend PM2 runtime management with a separate `holaday-account-closure-worker` process running as the same dedicated uid (expected production uid 998), no ports, one instance, and `--max-memory-restart 512M`. Start it only when `ACCOUNT_CLOSURE_WORKER_ENABLED=true`; delete a stale worker entry when disabled.
- [ ] Extend runtime/deploy tests to prove application deployment applies migration 0051 before enabling the worker, preserves the HTTP/WS ownership checks, and never starts two workers.
- [ ] Rerun targeted tests, `pnpm test:ops`, orchestrator build/typecheck, and `git diff --check`.
- [ ] Commit: `git add apps/orchestrator/src/account-closure apps/orchestrator/package.json scripts && git commit -m "feat(account): run durable closure worker"`

## Task 10: Build the Settings Wizard and Closure Recovery Page

**Files:**

- Create: `apps/web-workbench/src/components/settings/AccountClosureSection.tsx`
- Create: `apps/web-workbench/src/components/settings/AccountClosureSection.test.tsx`
- Create: `apps/web-workbench/src/pages/AccountClosureRecoveryPage.tsx`
- Create: `apps/web-workbench/src/pages/AccountClosureRecoveryPage.test.tsx`
- Create: `apps/web-workbench/src/lib/account-closure-state.ts`
- Create: `apps/web-workbench/src/lib/account-closure-state.test.ts`
- Modify: `apps/web-workbench/src/pages/SettingsPage.tsx`
- Modify: `apps/web-workbench/src/pages/SettingsPage.account.test.tsx`
- Modify: `apps/web-workbench/src/App.tsx`
- Modify: `apps/web-workbench/src/lib/auth.ts`
- Modify: `apps/web-workbench/src/lib/astrology.ts`
- Modify: `apps/web-workbench/src/pages/RedirectIfAuthed.tsx`

**Targeted test command:**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/settings/AccountClosureSection.test.tsx src/pages/AccountClosureRecoveryPage.test.tsx src/lib/account-closure-state.test.ts src/pages/SettingsPage.account.test.tsx src/lib/auth.closure.test.ts
```

**Interfaces:**

```ts
export type ClosureRecoveryView =
  | { kind: 'grace'; graceEndsAt: string; receiptNumber: string; canCancel: true }
  | { kind: 'processing'; receiptNumber: string; canCancel: false }
  | { kind: 'attention'; receiptNumber: string; canCancel: false }
  | { kind: 'completed'; receiptNumber: string; canCancel: false };

export function clearCurrentDeviceClosureData(): void;
```

- [ ] Replace the existing mailto expectation with failing settings tests for preview loading, resource counts, exact deadline, plan expiry, “no automatic refund,” three acknowledgements, verification, MFA, repeat-click idempotency, and successful sign-out to recovery.
- [ ] Write failing recovery-page tests for grace countdown, exact date/time, request receipt, verified cancellation, processing/attention non-withdrawable states, generic errors, and redirect denial to all normal product routes.
- [ ] Add mobile/keyboard tests: focus is trapped in each confirmation dialog, labels are announced, errors receive focus, controls have `aria-label` plus native `title` where icon-only, and the flow works at 390px width.
- [ ] Run the targeted web tests; expect missing components/routes.
- [ ] Build `AccountClosureSection` as a calm danger section at the bottom of Account & Security. Use three short steps and checkboxes rather than typed confirmation phrases; never use coercive copy.
- [ ] Add `/account/closure-recovery` outside `AppShell`. Recovery-token sessions can render only this route; normal app navigation must redirect back to it.
- [ ] On begin success, clear access/MFA tokens, ordinary authenticated caches, and current-device astrology profile, then store only the recovery token in `sessionStorage`.
- [ ] Implement “立即清除本机资料” and automatic best-effort cleanup on final/processing views. Explicitly state that other devices, browser extensions, downloaded files, and local copies cannot be remotely erased.
- [ ] Display original plan expiry on the grace screen and state that withdrawal restores the original expiry/quota without adding seven days.
- [ ] Rerun targeted web tests, web lint/typecheck/build, and `git diff --check`.
- [ ] Commit: `git add apps/web-workbench/src && git commit -m "feat(settings): add account closure and recovery UX"`

## Task 11: Align Governance, Privacy Disclosures, and Release Gates

**Files:**

- Modify: `apps/orchestrator/src/data-governance/rights-capabilities.ts`
- Modify: `apps/orchestrator/src/data-governance/lifecycle-registry.test.ts`
- Modify: `apps/orchestrator/scripts/governance-audit.ts`
- Create: `apps/orchestrator/scripts/governance-audit.account-closure.test.ts`
- Modify: `apps/web-workbench/src/pages/PrivacyPage.tsx`
- Modify: `apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx`
- Create: `apps/orchestrator/src/account-closure/release-gates.integration.test.ts`
- Create: `docs/runbooks/account-closure-operations.md`

**Targeted test commands:**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance/lifecycle-registry.test.ts scripts/governance-audit.account-closure.test.ts
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/account-closure/release-gates.integration.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/pages/PrivacyPage.truth.test.tsx
```

**Interfaces and declarations:**

```ts
account_manual_request: {
  delete: {
    status: 'implemented',
    handlerRef: 'accountClosure.begin',
    scope: 'Self-service account closure with a 7-day grace period',
    limitations: [
      'Does not provide a full data export',
      'Required payment, dispute, security, KYC, and ledger records may be retained in restricted form',
      'Cannot remotely erase copies on other devices or user-downloaded files',
    ],
  },
  export: { status: 'not_implemented' },
}
```

- [ ] Write failing governance tests requiring the implemented delete capability to reference a real registered route and requiring every category to have a handler/retention rule/test.
- [ ] Add privacy truth tests for the exact 7-day flow, immediate freeze, verification requirement, no automatic refund, restricted-retention boundary, identity reuse as a new account, local-copy limitation, and export remaining unavailable/manual.
- [ ] Add an end-to-end synthetic release gate covering: submit, revoked credentials, stopped work, cancellation, exact restoration, second submit, 168-hour advance, forced storage failure/retry, completion notification, tombstone, and new registration with the old identity.
- [ ] Run the tests; expect governance/privacy mismatch because the current UI says manual mail request.
- [ ] Update the rights registry from manual delete to implemented self-service delete while leaving export `not_implemented`.
- [ ] Extend the governance audit to fail on category/handler mismatch, missing retention mode, duplicate category IDs, raw-content receipt fields, and public claims exceeding capability status.
- [ ] Update the privacy page with user-readable, non-legalistic truth. Do not state a fixed retention duration unless the approved retention policy supplies one.
- [ ] Write `account-closure-operations.md` with: feature flags, allowlist rollout, queue/lease inspection using aggregate identifiers, safe retry/unblock procedure, log privacy rules, worker RSS/queue alerts, disabling new applications, and the prohibition on rolling back irreversible cleanup.
- [ ] Run `pnpm governance:audit --format=json`; require `ok=true` and `errors=0`. Record informational gap counts without treating them as closure failure.
- [ ] Run all closure/auth/task/storage/financial integration suites, `pnpm --filter @holaday/orchestrator typecheck`, `pnpm --filter @holaday/orchestrator build`, `pnpm --filter @holaday/web-workbench test`, `pnpm --filter @holaday/web-workbench build`, `pnpm test:ops`, and `git diff --check`.
- [ ] Inspect generated logs/receipts with sentinel personal strings and assert no sentinel appears. Verify worker process count=1 and measured RSS remains below 512MB in the synthetic large-account test.
- [ ] Commit: `git add apps/orchestrator/src/data-governance apps/orchestrator/scripts apps/orchestrator/src/account-closure apps/web-workbench/src/pages/PrivacyPage.tsx apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx docs/runbooks/account-closure-operations.md && git commit -m "docs(account): align closure governance and release gates"`

## Task 12: Perform the Staged Non-Destructive Release

**Files:**

- Modify only if evidence requires it: `docs/runbooks/account-closure-operations.md`
- Do not change product code during production verification; fixes return to their owning task and repeat all affected gates.

- [ ] Rebase the completed branch onto the current protected base, resolve only in-scope conflicts, and rerun the complete Task 11 gate.
- [ ] Push the branch and create a PR that links the approved spec and this plan. Include migration order, flags-default-off statement, retention boundary, test evidence, and rollback limitations.
- [ ] Resolve review findings with `superpowers:receiving-code-review`; rerun the smallest reproducing test and all affected release gates before marking threads resolved.
- [ ] Merge only after required checks pass and review is complete.
- [ ] Deploy migration 0051, then additive migration 0052, with both closure flags and both legacy-sanitation prerequisites false. Run `db:verify` and verify existing login/task/feedback/payment/partner health before deploying application code.
- [ ] Deploy application and dormant worker code. Confirm no closure worker process exists while `ACCOUNT_CLOSURE_WORKER_ENABLED=false`.
- [ ] Configure the dedicated HMAC secret and completion email/SMS templates through the approved production secret path; report only presence and length, never values.
- [ ] Enable API and worker only for the dedicated synthetic allowlisted account. Confirm worker uid=998, process count=1, no public worker listener, RSS under 512MB, and host steady-state memory near/below the 10GB target.
- [ ] Exercise submit and withdrawal on the synthetic account, then a separate synthetic account through accelerated staging-time closure. Production keeps the real 168-hour deadline; do not alter it to make a live test faster.
- [ ] Verify aggregate queue/step metrics, object absence, retained financial references, completion notification acceptance, tombstone state, and successful new registration with released identity. Never print raw personal data or digests.
- [ ] Expand allowlist to employees, observe at least one full 7-day window, then decide whether to enable for all users. Samples too small for product decisions remain “样本不足”; do not loosen safety gates based on absence of traffic.
- [ ] If an error appears, disable new applications and stop new worker claims while retaining leases/checkpoints. Never roll back completed irreversible cleanup; fix forward and resume from the safe checkpoint.

## Final Acceptance Checklist

- [ ] Every normal authentication and execution path rejects non-active users.
- [ ] Submission is atomic, idempotent, immediately revokes access, and records exactly 13 steps.
- [ ] Withdrawal before the deadline is strongly verified and restores only resources changed by this request.
- [ ] Worker claim and withdrawal cannot both win; failures never reopen the account.
- [ ] All 13 categories have real handlers, stable IDs, retention modes, and category-specific tests.
- [ ] Object storage deletion is object-first, paged, retryable, and leaves no orphan claims.
- [ ] Financial/KYC/ledger retention is minimized and restricted; no required record is cascade-deleted.
- [ ] Final identity release permits a new, unlinked account with the same email/phone.
- [ ] Receipts, logs, checkpoints, alerts, and metrics contain no raw personal content.
- [ ] Completion is impossible until all steps, identity release, entitlement invalidation, and completion-notification acceptance succeed.
- [ ] UI truthfully describes 7 days, no automatic refund, local-copy limits, restricted retention, and original-expiry restoration.
- [ ] Full export remains explicitly unimplemented; the release does not claim otherwise.
- [ ] Worker concurrency is one, worker RSS is below 512MB, and production host memory stays around the agreed 10GB target.
- [ ] Feature flags default off, staged rollout evidence is recorded, and operators can stop claims without corrupting in-flight work.
