# Billing Ledger Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed recent-payment-attempt list with a trustworthy paginated payment ledger plus a secondary lazy-loaded unfinished-payment list.

**Architecture:** Add a backward-compatible protected `payment.ledger` query with section-scoped keyset pagination and a strict safe-field response. Keep billing formatting and response normalization in `billing-page-state.ts`, place asynchronous ledger UI/state in a focused `PaymentLedgerSection` component, and leave `BillingPage` responsible for subscription and payment-return coordination.

**Tech Stack:** TypeScript, tRPC 11, Drizzle ORM, React 18, Tailwind CSS, Vitest, Testing Library, happy-dom.

**Spec:** `docs/superpowers/specs/2026-08-24-billing-ledger-trust-design.md`

## Global Constraints

- Do not change payment creation, capture, callback, refund, entitlement, or idempotent settlement behavior.
- Do not modify the `payments` schema, payment-provider configuration, environment variables, or historical payment data.
- `settled` contains only `completed` and `refunded`; `unfinished` contains only `pending` and `failed`.
- Every server query is tenant-scoped by `payments.userExternalId = ctx.userId`; clients never supply a user ID.
- Never return `metadata`, `providerOrderId`, `providerCaptureId`, `userExternalId`, database `id`, payer details, or raw gateway payloads.
- Use `createdAt DESC, externalId DESC` keyset pagination, default limit 10, maximum limit 20.
- Keep `payment.history` for backward compatibility.
- Unfinished payments are collapsed and not requested until first expansion.
- All controls have visible focus; icon-only controls have both `aria-label` and native `title`; touch targets are at least 44×44px.
- Verify desktop and 390px without horizontal overflow.

---

## File Structure

- Modify `apps/orchestrator/src/trpc/routers/payment.ts`: define the ledger input and protected section-scoped query.
- Modify `apps/orchestrator/src/trpc/routers/payment.test.ts`: pin status separation, pagination, safe fields, validation, and account isolation.
- Modify `apps/web-workbench/src/lib/billing-page-state.ts`: define ledger page/cursor types, normalize untrusted responses, merge pages safely, and build receipt/invoice support copy.
- Modify `apps/web-workbench/src/lib/billing-page-state.test.ts`: test the new pure state contract.
- Create `apps/web-workbench/src/components/billing/PaymentLedgerSection.tsx`: own settled/unfinished request state and render the responsive, accessible ledger.
- Create `apps/web-workbench/src/components/billing/PaymentLedgerSection.test.tsx`: exercise initial load, lazy unfinished load, independent pagination, errors, copy, and mail actions.
- Modify `apps/web-workbench/src/pages/BillingPage.tsx`: remove the legacy history state/rendering and coordinate payment-return refresh through `refreshKey`.

---

### Task 1: Protected Payment Ledger API

**Files:**
- Modify: `apps/orchestrator/src/trpc/routers/payment.ts`
- Test: `apps/orchestrator/src/trpc/routers/payment.test.ts`

**Interfaces:**
- Consumes: `payments` schema and authenticated `ctx.userId`.
- Produces: `payment.ledger(input)` returning `{ items, nextCursor }` with the exact `PaymentLedgerPage` contract from the spec.

- [ ] **Step 1: Write failing status and safe-field tests**

Add `describe('ledger — paginated customer payment records')` with a Drizzle mock that records `limit`, returns completed, refunded, pending, failed, and another user's rows, then assert:

```ts
const settled = await paymentRouter.createCaller(ctx).ledger({
  section: 'settled',
  limit: 2,
});
expect(settled.items.map((row) => row.orderId)).toEqual(['pay_completed', 'pay_refunded']);
expect(settled.nextCursor).toEqual({
  createdAt: '2026-08-04T14:00:00.000Z',
  orderId: 'pay_refunded',
});
expect(requestedLimit).toBe(3);
expect(settled.items[0]).not.toHaveProperty('metadata');
expect(settled.items[0]).not.toHaveProperty('userExternalId');
expect(settled.items[0]).not.toHaveProperty('providerOrderId');
```

Run a separate `unfinished` call and assert only `pending/failed` survive. Assert selected fields are exactly `externalId`, `userExternalId`, `provider`, `kind`, `plan`, `amountCents`, `currency`, `status`, `createdAt`, and `completedAt`.

- [ ] **Step 2: Write failing validation and cursor tests**

Assert a valid cursor is accepted and passed through a `limit + 1` query, while these reject before the DB call:

```ts
await expect(caller.ledger({ section: 'settled', limit: 21 })).rejects.toMatchObject({
  code: 'BAD_REQUEST',
});
await expect(
  caller.ledger({
    section: 'settled',
    cursor: { createdAt: 'not-a-date', orderId: '../other' },
  }),
).rejects.toMatchObject({ code: 'BAD_REQUEST' });
```

Include same-millisecond rows and assert `nextCursor` uses the last returned `{createdAt, orderId}` so the second page can continue without an offset.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
cd apps/orchestrator
pnpm exec vitest run src/trpc/routers/payment.test.ts --reporter=dot
```

Expected: FAIL because `paymentRouter.ledger` does not exist.

- [ ] **Step 4: Implement the ledger input and query**

Extend Drizzle imports with `inArray`, `lt`, and `or`. Add:

```ts
const paymentLedgerInput = z.object({
  section: z.enum(['settled', 'unfinished']),
  cursor: z
    .object({
      createdAt: z.coerce.date(),
      orderId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    })
    .optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

const PAYMENT_LEDGER_STATUSES = {
  settled: ['completed', 'refunded'],
  unfinished: ['pending', 'failed'],
} as const;
```

Add `ledger` beside the retained `history` query. Build `whereParts` from tenant equality, status membership, and this optional keyset clause:

```ts
or(
  lt(payments.createdAt, input.cursor.createdAt),
  and(
    eq(payments.createdAt, input.cursor.createdAt),
    lt(payments.externalId, input.cursor.orderId),
  ),
)
```

Select only the ten safe columns, order by both descending columns, query `input.limit + 1`, defensively retain only the current user and allowed statuses, slice to `input.limit`, serialize dates, and derive `nextCursor` from the last returned row only when `hasMore` is true.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
cd apps/orchestrator
pnpm exec vitest run src/trpc/routers/payment.test.ts --reporter=dot
pnpm typecheck
```

Expected: all payment tests pass and orchestrator typecheck exits 0.

- [ ] **Step 6: Commit the API slice**

```bash
git add apps/orchestrator/src/trpc/routers/payment.ts apps/orchestrator/src/trpc/routers/payment.test.ts
git commit -m "feat: add paginated payment ledger"
```

---

### Task 2: Billing Ledger State Contract

**Files:**
- Modify: `apps/web-workbench/src/lib/billing-page-state.ts`
- Test: `apps/web-workbench/src/lib/billing-page-state.test.ts`

**Interfaces:**
- Consumes: unknown tRPC responses and existing `BillingPaymentRecord` formatting helpers.
- Produces: `BillingPaymentLedgerSection`, `BillingPaymentCursor`, `BillingPaymentPage`, `normalizeBillingPaymentPage`, `appendBillingPaymentPage`, and `billingPaymentReceiptMailOptions`.

- [ ] **Step 1: Write failing page-normalization tests**

Import the new functions and assert strict section filtering and cursor validation:

```ts
expect(
  normalizeBillingPaymentPage(
    {
      items: [completedRecord, pendingRecord, { metadata: { secret: true } }],
      nextCursor: {
        createdAt: '2026-08-04T15:14:34.852Z',
        orderId: 'pay_completed',
      },
    },
    'settled',
  ),
).toEqual({
  items: [normalizedCompletedRecord],
  nextCursor: {
    createdAt: '2026-08-04T15:14:34.852Z',
    orderId: 'pay_completed',
  },
});
expect(normalizeBillingPaymentPage({ items: [], nextCursor: '../bad' }, 'settled')).toEqual({
  items: [],
  nextCursor: null,
});
```

- [ ] **Step 2: Write failing append and receipt-copy tests**

Assert `appendBillingPaymentPage` preserves order and removes duplicate `orderId` values when pages overlap. Assert receipt options contain order ID, product, formatted amount, payment time, and blank invoice fields, but not user, gateway, or metadata fields:

```ts
expect(appendBillingPaymentPage([completedRecord], [completedRecord, refundedRecord])).toEqual([
  completedRecord,
  refundedRecord,
]);
expect(billingPaymentReceiptMailOptions(completedRecord)).toMatchObject({
  subject: 'HOLA DAY 付款凭证与发票申请 · pay_completed',
});
expect(billingPaymentReceiptMailOptions(completedRecord).body).toContain('发票抬头：');
```

- [ ] **Step 3: Run the focused test and verify RED**

```bash
cd apps/web-workbench
pnpm exec vitest run src/lib/billing-page-state.test.ts --reporter=dot
```

Expected: FAIL because the new state functions are not exported.

- [ ] **Step 4: Implement the pure state helpers**

Add exact types:

```ts
export type BillingPaymentLedgerSection = 'settled' | 'unfinished';

export interface BillingPaymentCursor {
  readonly createdAt: string;
  readonly orderId: string;
}

export interface BillingPaymentPage {
  readonly items: BillingPaymentRecord[];
  readonly nextCursor: BillingPaymentCursor | null;
}
```

Implement `normalizeBillingPaymentPage(value, section)` by normalizing `value.items`, retaining `completed/refunded` for `settled` or `pending/failed` for `unfinished`, and accepting `nextCursor` only when its date parses and its order ID matches `/^[A-Za-z0-9_-]{1,64}$/`. Implement dedupe with a `Set<string>` keyed by `orderId`.

Implement:

```ts
export function billingPaymentReceiptMailOptions(
  record: BillingPaymentRecord,
): { subject: string; body: string } {
  const product = billingPaymentProduct(record.kind, record.plan);
  const amount = billingPaymentAmount(record.amountCents, record.currency);
  const paidAt = billingPaymentDate(record.completedAt ?? record.createdAt);
  return {
    subject: `HOLA DAY 付款凭证与发票申请 · ${record.orderId}`,
    body: [
      '请协助处理以下付款的凭证或发票申请。',
      '',
      `订单号：${record.orderId}`,
      `产品：${product}`,
      `金额：${amount}`,
      `付款时间：${paidAt}`,
      '',
      '需要：付款凭证 / 发票（请保留所需项）',
      '发票抬头：',
      '税号：',
      '接收邮箱：',
    ].join('\n'),
  };
}
```

- [ ] **Step 5: Run tests and verify GREEN**

```bash
cd apps/web-workbench
pnpm exec vitest run src/lib/billing-page-state.test.ts --reporter=dot
pnpm typecheck
```

Expected: helper tests and typecheck pass.

- [ ] **Step 6: Commit the state slice**

```bash
git add apps/web-workbench/src/lib/billing-page-state.ts apps/web-workbench/src/lib/billing-page-state.test.ts
git commit -m "feat: model paginated billing records"
```

---

### Task 3: Responsive Payment Ledger Component

**Files:**
- Create: `apps/web-workbench/src/components/billing/PaymentLedgerSection.tsx`
- Create: `apps/web-workbench/src/components/billing/PaymentLedgerSection.test.tsx`

**Interfaces:**
- Consumes: `trpc.payment.ledger`, helpers from `billing-page-state.ts`, `supportMailtoHref`, and optional `refreshKey: number`.
- Produces: `<PaymentLedgerSection refreshKey={number} />` with isolated settled and unfinished query state.

- [ ] **Step 1: Write failing initial-load and lazy-load tests**

Use happy-dom and mock `trpc.payment.ledger.query`. Return a settled page for `{section:'settled'}` and an unfinished page for `{section:'unfinished'}`. Assert:

```ts
render(<PaymentLedgerSection refreshKey={0} />);
expect(await screen.findByText('Basic 套餐')).toBeTruthy();
expect(ledgerQuery).toHaveBeenCalledWith({ section: 'settled', limit: 10 });
expect(ledgerQuery).not.toHaveBeenCalledWith(
  expect.objectContaining({ section: 'unfinished' }),
);
await user.click(screen.getByRole('button', { name: /查看未完成支付/ }));
expect(await screen.findByText('没有确认扣款')).toBeTruthy();
expect(ledgerQuery).toHaveBeenCalledWith({ section: 'unfinished', limit: 10 });
```

Assert the trigger exposes `aria-expanded="false"` before the click and `true` afterward.

- [ ] **Step 2: Write failing pagination, copy, mail, and error tests**

Return `nextCursor` for settled, click “加载更多”, and assert the second request includes that cursor while existing rows remain. Mock `navigator.clipboard.writeText`, click `复制订单号`, and assert the exact HOLA DAY order ID plus visible `已复制`. Assert the `申请凭证/发票` link is a `mailto:support@holaday.ai` URL whose decoded query includes that order ID.

Reject a load-more request and assert the original row remains with a local retry control. Reject unfinished first load and assert settled rows remain visible.

- [ ] **Step 3: Run the component test and verify RED**

```bash
cd apps/web-workbench
pnpm exec vitest run src/components/billing/PaymentLedgerSection.test.tsx --reporter=dot
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement independent request state**

Inside `PaymentLedgerSection`, define one state object per section:

```ts
interface LedgerState {
  items: BillingPaymentRecord[];
  nextCursor: BillingPaymentCursor | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
}
```

Load settled on mount and whenever `refreshKey` changes. Load unfinished only on first expansion. Use separate request sequence refs so stale responses cannot overwrite new results. Send `{section, limit: 10}` for page one and add `cursor` only for later pages. Merge later pages with `appendBillingPaymentPage`; never clear existing items on a load-more error.

- [ ] **Step 5: Implement responsive and accessible rendering**

Render a primary white panel titled `付款记录` with `已确认到账或已退款的记录`. Render skeleton, first-load error, empty state, rows, and load-more state separately. Each row includes product, provider, time, order ID, amount, status, copy button, and settled-only receipt link.

Render unfinished as a lighter bordered disclosure after the primary panel:

```tsx
<button
  type="button"
  aria-expanded={unfinishedExpanded}
  aria-controls="billing-unfinished-payments"
  className="flex min-h-11 w-full ... focus-visible:ring-2 ..."
>
  <span>查看未完成支付</span>
  <span>包括取消、失败或仍待确认的结账记录，不代表已扣款</span>
</button>
```

Use mobile-first vertical rows and `sm:` two-column alignment, `min-w-0`, `break-all`, `tabular-nums`, and minimum 44px controls. Use restrained green/gray/amber status styles and no red alarm treatment. Add `aria-live="polite"` for loading/errors/copy result. If an action is icon-only, add both `aria-label` and `title`; prefer visible text actions.

- [ ] **Step 6: Run component and state tests and verify GREEN**

```bash
cd apps/web-workbench
pnpm exec vitest run src/components/billing/PaymentLedgerSection.test.tsx src/lib/billing-page-state.test.ts --reporter=dot
pnpm typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 7: Commit the component slice**

```bash
git add apps/web-workbench/src/components/billing/PaymentLedgerSection.tsx apps/web-workbench/src/components/billing/PaymentLedgerSection.test.tsx
git commit -m "feat: add trustworthy payment ledger UI"
```

---

### Task 4: Billing Page Integration

**Files:**
- Modify: `apps/web-workbench/src/pages/BillingPage.tsx`
- Test: `apps/web-workbench/src/components/billing/PaymentLedgerSection.test.tsx`

**Interfaces:**
- Consumes: `<PaymentLedgerSection refreshKey={paymentLedgerRefreshKey} />`.
- Produces: `/billing` with no `payment.history` call or legacy mixed list.

- [ ] **Step 1: Extend the test to pin refresh behavior**

Render a harness that changes `refreshKey` from 0 to 1 and assert the component requests settled page one again, replaces the settled snapshot, and does not automatically expand or reload unfinished.

Add a source-level regression assertion only if needed to pin removal of the obsolete call:

```ts
expect(BillingPageSource).not.toContain('trpc.payment.history.query');
expect(BillingPageSource).toContain('<PaymentLedgerSection');
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd apps/web-workbench
pnpm exec vitest run src/components/billing/PaymentLedgerSection.test.tsx --reporter=dot
```

Expected: refresh assertion fails until integration state is wired.

- [ ] **Step 3: Replace legacy history wiring**

In `BillingPage.tsx` remove imports/state/request refs/callbacks used only by the legacy history list. Add:

```ts
const [paymentLedgerRefreshKey, setPaymentLedgerRefreshKey] = React.useState(0);
```

After confirmed payment, call `setPaymentLedgerRefreshKey((value) => value + 1)` beside `refresh()`. Render:

```tsx
<PaymentLedgerSection refreshKey={paymentLedgerRefreshKey} />
```

after the subscription/payment sections. Do not make payment-return polling wait for the ledger component.

- [ ] **Step 4: Run integration tests and verify GREEN**

```bash
cd apps/web-workbench
pnpm exec vitest run src/components/billing/PaymentLedgerSection.test.tsx src/lib/billing-page-state.test.ts src/pages/SettingsPage.account.test.tsx --reporter=dot
pnpm typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit the integration**

```bash
git add apps/web-workbench/src/pages/BillingPage.tsx apps/web-workbench/src/components/billing/PaymentLedgerSection.test.tsx
git commit -m "refactor: separate payments from checkout attempts"
```

---

### Task 5: Full Verification and Delivery

**Files:**
- Verify all files changed in Tasks 1–4.
- Do not create deployment or database files.

**Interfaces:**
- Consumes: complete branch implementation.
- Produces: verified branch, reviewable PR, application deployment, and production evidence.

- [ ] **Step 1: Run focused and repository-proportional checks**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/payment.test.ts --reporter=dot
pnpm --filter @holaday/web-workbench exec vitest run src/lib/billing-page-state.test.ts src/components/billing/PaymentLedgerSection.test.tsx src/pages/SettingsPage.account.test.tsx --reporter=dot
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/orchestrator lint
pnpm --filter @holaday/web-workbench lint
git diff --check
```

Expected: touched behavior passes. If repository-wide lint reports pre-existing unrelated issues, lint touched files, record exact unrelated failures, and do not misreport the global gate as passing.

- [ ] **Step 2: Run local browser verification**

Open the existing app in the user's chosen browser and verify authenticated `/billing` at desktop and 390px. Capture evidence for settled-only primary list, collapsed/lazy unfinished payments, independent load-more, copy feedback, prefilled receipt mail link, error states, and no horizontal overflow or clipped actions.

- [ ] **Step 3: Review the complete diff**

```bash
git status --short
git diff origin/claude/musing-keller-ae1d05...HEAD --stat
git diff origin/claude/musing-keller-ae1d05...HEAD
```

Check every spec section against the implementation and remove stale imports, legacy copy, debug output, placeholders, and accidental user-owned files.

- [ ] **Step 4: Commit verification-only fixes**

If verification changes exact files, rerun affected checks and commit those files only with:

```bash
git commit -m "fix: harden billing ledger experience"
```

- [ ] **Step 5: Push, create PR, review, merge, and deploy application**

Push `codex/billing-ledger-trust`, create a ready PR against the current production branch, resolve actionable review threads with tests, merge after required checks, and deploy only `application`. Do not deploy payment providers or database services.

- [ ] **Step 6: Verify production read-only**

Confirm both production health endpoints return 200/`status: ok`. In authenticated production `/billing`, verify successful payments appear only in `付款记录`, unfinished attempts appear only after disclosure expansion, copy/mail actions are safe, and 390px has no horizontal overflow. Check payment-ledger error logs without reading or outputting payer information, raw metadata, or gateway identifiers.

- [ ] **Step 7: Apply the bounded rollback rule if production verification fails**

Record the pre-deploy application SHA before deployment. If the new query or billing page creates a blocking regression, roll back only `application` to that SHA and repeat both health checks; do not change payment rows, repeat captures, issue refunds, migrate the database, or deploy provider services.
