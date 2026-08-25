# HOLA DAY Privacy Truth P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HOLA DAY's unsupported privacy promises with a readable, evidence-backed disclosure and align the account-deletion request copy without pretending that self-service privacy operations already exist.

**Architecture:** Keep this release presentation-only. Render the policy as typed, static React content inside the existing `PageShell`, and mirror the same factual boundary in the static landing pages that production nginx serves for exact `/privacy` and `/terms` routes. Protect both surfaces with content tests. Account deletion remains a support-email intake; P1 export/deletion/retention orchestration and the legacy pending-cookie migration remain explicitly out of scope.

**Tech Stack:** TypeScript 5.7, React 18, React Router 7, Tailwind CSS, Testing Library, Vitest 2, existing HOLA DAY `PageShell` and `ConfirmDialog`.

**Spec:** `docs/superpowers/specs/2026-08-25-privacy-truth-design.md`

## Global Constraints

- Modify only SPA/landing copy, layout, and tests; do not add migrations, backend APIs, environment changes, providers, dependencies, or deployment configuration.
- Do not claim PIPL/GDPR certification, complete compliance, absolute security, universal encryption at rest, signed DPAs, mainland-primary hosting, a universal 90-day log purge, automatic account deletion, or tier-based task deletion.
- Say explicitly that 7/30/90-day plan history is a default visibility window, not a server deletion deadline.
- Separate domain-level browsing-history aggregates from real login Cookie values; the latter must be described as sensitive login-state data subject to a server allowlist.
- Describe third parties as feature-dependent; do not imply every provider receives every task.
- Keep account deletion as an email request and disclose that transaction, security, dispute, or audit records may be retained when required.
- Do not publish internal host IPs, database names, secret names or values, internal IDs, schema names, or the pending-cookie compatibility-column implementation.
- Preserve the current one-time purchase/manual-renewal model; do not reintroduce automatic-renewal wording.
- Preserve all unrelated untracked `.claude/`, `qa-artifacts/`, `skills/*`, and `docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md` content in the root checkout.
- Final production deployment is blocked until the business supplies and counsel confirms the legal operator identity and address; local implementation and preview may proceed.

---

## File Structure

- `apps/web-workbench/src/pages/PrivacyPage.tsx`
  - Owns the public privacy-policy presentation and the static disclosure content.
  - Defines small local render helpers and typed data arrays; it does not fetch runtime configuration or expose internal implementation details.
- `apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx`
  - Renders the route and enforces required facts, prohibited promises, navigation/accessibility structure, and manual-renewal consistency.
- `apps/web-workbench/src/pages/SettingsPage.tsx`
  - Keeps the existing mail-based deletion intake while correcting the scope and legal-retention exception.
- `apps/web-workbench/src/pages/SettingsPage.account.test.tsx`
  - Verifies deletion remains a mail request and cannot be read as automatic, immediate, or exception-free.
- `apps/holaday-landing/privacy.html` and `apps/holaday-landing/terms.html`
  - Own the production exact-route legal surfaces and mirror the verified privacy, deletion, payment, provider, and jurisdiction boundaries.
- `ops/aliyun-edge/legal-pages.test.mjs`
  - Prevents the production landing pages from drifting back to unsupported promises.

No shared runtime content module is introduced. The production route split is explicit and both static/React surfaces are protected by content contracts; a general-purpose legal-copy library would complicate the dependency boundary between the standalone landing bundle and the SPA.

---

### Task 1: Establish the privacy truth content contract

**Files:**
- Create: `apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx`
- Read: `apps/web-workbench/src/pages/PrivacyPage.tsx`
- Read: `docs/superpowers/specs/2026-08-25-privacy-truth-design.md`

**Interfaces:**
- Consumes: the exported `PrivacyPage(): JSX.Element` route component.
- Produces: a rendered-content contract that Task 2 must satisfy; no runtime API.

- [ ] **Step 1: Write the failing rendered-content tests**

Create the test with the real route component and `MemoryRouter`:

```tsx
// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

function renderPrivacy(): void {
  render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

function expectText(pattern: RegExp): void {
  expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);
}

afterEach(cleanup);

describe('PrivacyPage truth contract', () => {
  it('separates plan visibility from server deletion and describes sensitive extension data', () => {
    renderPrivacy();

    expectText(/7\/30\/90 天.*可见范围/);
    expectText(/不是服务器删除期限/);
    expectText(/不上传完整 URL、查询参数、网页标题或历史页面正文/);
    expectText(/真实 Cookie 值/);
    expectText(/服务端白名单/);
  });

  it('describes feature-dependent external processing and a mail-based rights request', () => {
    renderPrivacy();

    expectText(/取决于您使用的功能和当时启用的服务/);
    expectText(/可能在中国大陆以外处理/);
    expect(screen.getByRole('link', { name: 'privacy@holaday.ai' }).getAttribute('href')).toBe(
      'mailto:privacy@holaday.ai',
    );
    expectText(/邮件是申请入口，不代表即时或自动完成/);
    expectText(/交易、安全、争议或审计记录/);
  });

  it('states the implemented account and payment boundaries', () => {
    renderPrivacy();

    expectText(/不可逆单向哈希/);
    expectText(/付款邮箱/);
    expectText(/不直接保存银行卡号、CVV 或第三方支付账户密码/);
    expectText(/每次付款只购买所选周期/);
    expectText(/不会自动扣款/);
  });

  it('does not repeat unsupported privacy promises', () => {
    renderPrivacy();
    const body = document.body.textContent ?? '';

    for (const forbidden of [
      '服务器主要位于中国大陆',
      'Pro 永久',
      '日志默认保留 90 天',
      '密码（加密存储）',
      '持续使用本服务即视为接受',
      '完全合规',
      '按月自动续费',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('provides a concise summary, unique section anchors, and a data table', () => {
    renderPrivacy();

    expect(screen.getByRole('heading', { name: '先看重点' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: '隐私政策目录' });
    expect(within(nav).getByRole('link', { name: '我们处理什么' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '浏览器扩展' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '第三方与跨境' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '保存与删除' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'HOLA DAY 个人信息处理说明' })).toBeTruthy();

    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails against the old template**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/PrivacyPage.truth.test.tsx
```

Expected: FAIL because the current page has no “先看重点” region or data table and still contains the prohibited mainland/retention statements.

- [ ] **Step 3: Commit the failing contract**

```bash
git add apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx
git commit -m "test(privacy): define truthful disclosure contract"
```

---

### Task 2: Rebuild the privacy page around verified facts

**Files:**
- Modify: `apps/web-workbench/src/pages/PrivacyPage.tsx`
- Test: `apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx`

**Interfaces:**
- Consumes: existing `PageContainer`, `PageHeader`, `Link`, Tailwind tokens, and the Task 1 rendered-content contract.
- Produces: `PrivacyPage(): JSX.Element`, plus local `PolicySection`, `SummaryItem`, and `DataCategory` rendering helpers used only in this file.

- [ ] **Step 1: Replace the template header and introduce typed local content**

Use these exact types and navigation IDs:

```tsx
type PrivacySectionId =
  | 'data'
  | 'extension'
  | 'providers'
  | 'retention'
  | 'rights'
  | 'security'
  | 'minors'
  | 'updates'
  | 'contact';

interface DataCategory {
  label: string;
  data: string;
  purpose: string;
  processors: string;
  retention: string;
}

const POLICY_UPDATED_AT = '2026-08-25';

const POLICY_NAV: ReadonlyArray<{ id: PrivacySectionId; label: string }> = [
  { id: 'data', label: '我们处理什么' },
  { id: 'extension', label: '浏览器扩展' },
  { id: 'providers', label: '第三方与跨境' },
  { id: 'retention', label: '保存与删除' },
  { id: 'rights', label: '您的权利' },
  { id: 'security', label: '安全措施' },
  { id: 'minors', label: '未成年人' },
  { id: 'updates', label: '政策更新' },
  { id: 'contact', label: '联系我们' },
];
```

Define nine `DataCategory` rows for:

1. `账号与安全` — email/phone/display name/avatar/password hash/MFA/session;
2. `任务与执行` — intent/plan/steps/result/screenshots/page context/files/errors;
3. `跨任务 AI 记忆` — extracted preference/site state/task history/execution tips, later-task reuse, retention state and settings deletion controls;
4. `反馈与支持` — submitted free text/account email and identifier/User-Agent/optional task ID, Resend-or-log path and purpose-bound retention;
5. `扩展常用网站` — domain/visit count/last-visit time only;
6. `扩展登录态` — allowlisted real Cookie values;
7. `支付与套餐` — order/provider identifiers/amount/currency/purchase/status/payer email;
8. `媒体素材` — user images/video/audio/voice-clone identifier/consent time;
9. `分析与日志` — bounded event aggregates/anonymous digests/IP/UA/operation/error context.

Do not put host IPs, env keys, schema names, retention defaults, or internal IDs in the arrays.

- [ ] **Step 2: Implement the summary and navigation**

At the top of `PrivacyPage`, render:

```tsx
<PageContainer width="form">
  <PageHeader title="隐私政策" description={`最后更新：${POLICY_UPDATED_AT}`} />
  <article className="space-y-6 text-sm leading-7 text-foreground">
    <section aria-labelledby="privacy-summary-heading" className="rounded-[10px] border border-[#E8DFE5] bg-gradient-to-br from-[#FFF8FA] via-white to-[#F7FBFF] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
      <h2 id="privacy-summary-heading" className="text-lg font-semibold">先看重点</h2>
      <p className="mt-2 text-muted-foreground">本政策说明 HOLA DAY 在您使用网站、浏览器扩展和相关服务时如何处理个人信息。</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {/* Four concise SummaryItem cards from spec section 6.1. */}
      </div>
    </section>
    <nav aria-label="隐私政策目录" className="rounded-[8px] border border-border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        {POLICY_NAV.map((item) => (
          <a key={item.id} href={`#${item.id}`} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            {item.label}
          </a>
        ))}
      </div>
    </nav>
    {/* Policy sections. */}
  </article>
</PageContainer>
```

The four summary cards must say:

- HOLA DAY processes account, task, and execution data to perform the user's request;
- browsing-history analysis uploads domain-level aggregates, while login-state sync handles real Cookie values;
- content may be sent to feature-dependent AI, media, storage, communications, or payment providers and may be processed outside mainland China;
- rights requests currently use email; email is an intake, not immediate automatic completion.

- [ ] **Step 3: Render the responsive data-category disclosure**

Inside `id="data"`, render one semantic desktop table and one mobile card list:

```tsx
<div className="hidden overflow-hidden rounded-[8px] border border-border md:block">
  <table aria-label="HOLA DAY 个人信息处理说明" className="w-full table-fixed border-collapse text-left text-xs leading-5">
    <caption className="sr-only">HOLA DAY 处理的数据类别、用途、处理方与保存标准</caption>
    <thead className="bg-muted/60">...</thead>
    <tbody>{DATA_CATEGORIES.map(...)}</tbody>
  </table>
</div>
<div className="space-y-3 md:hidden">
  {DATA_CATEGORIES.map((category) => (
    <section key={category.label} className="rounded-[8px] border border-border bg-muted/20 p-4">...</section>
  ))}
</div>
```

Keep the table available in the accessibility tree on desktop. The mobile cards must render the same five fields and must not use an overflowing table.

- [ ] **Step 4: Implement the factual policy sections**

Use these exact factual boundaries:

- `extension`: clearly separate domain aggregates from real Cookie values and mention server allowlisting; stopping/uninstalling prevents future access but does not automatically delete received data.
- `providers`: say use depends on the feature and current service configuration. Group the verified provider names by function: infrastructure/storage (`Vultr`, `Cloudflare R2`, `Aliyun`); AI/scraping/media (`Anthropic`, `Google`, `OpenAI`, `Alibaba Cloud DashScope`, `fal.ai`, `Firecrawl`, `Apify`, `DivineAPI`); automation (`Zapier`); identity/communications/feedback/payments (`Google`, `Resend`, SMS gateway, `PayPal` or China payment provider). Disclose that the configured Zapier path receives task intent and task ID for cross-platform automation, and that feedback can carry user-entered text, account details, User-Agent and an optional task ID to Resend or service logs. State only the minimum data needed for the requested feature is sent and that processing may occur outside mainland China.
- `retention`: say 7/30/90 days is default task-history visibility, not server deletion; files follow visible expiry; common-site aggregates are replaced by the next successful sync; pending Cookies are injected immediately or held for the next browser injection; transaction/security/dispute/audit records follow necessary legal and operational criteria; do not give a universal log deadline.
- `rights`: list access/copy/correction/deletion/withdrawal/restriction/objection/complaint subject to applicable law; identify email as the current intake; explain identity verification and lawful retention exceptions.
- `security`: describe Argon2id-equivalent wording as “不可逆单向哈希”, MFA secret encryption, transport/access control and sensitive-header redaction; state no security method is absolute and do not claim all stored data is encrypted.
- `minors`: the service is not directed at children under 14; requests concerning a child should be emailed, subject to guardian verification and applicable law.
- `updates`: show version date, reasonable notice for material changes, and explicit/separate consent when law requires it; no continued-use deemed consent.
- `contact`: expose `privacy@holaday.ai`, `support@holaday.ai`, and a `Link` to `/terms`. Do not invent operator name, address, registration number, or jurisdiction.

In the payment paragraph include this exact sentence to keep the billing boundary aligned:

```text
每次付款只购买所选周期，到期前由您手动续费，不会自动扣款。
```

- [ ] **Step 5: Run the privacy contract and make it pass**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/PrivacyPage.truth.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Run lint and typecheck on the rebuilt route**

Run:

```bash
pnpm --filter @holaday/web-workbench exec eslint src/pages/PrivacyPage.tsx src/pages/PrivacyPage.truth.test.tsx
pnpm --filter @holaday/web-workbench typecheck
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the rebuilt route**

```bash
git add apps/web-workbench/src/pages/PrivacyPage.tsx apps/web-workbench/src/pages/PrivacyPage.truth.test.tsx
git commit -m "fix(privacy): replace template claims with verified facts"
```

---

### Task 3: Align the account-deletion request boundary

**Files:**
- Modify: `apps/web-workbench/src/pages/SettingsPage.account.test.tsx`
- Modify: `apps/web-workbench/src/pages/SettingsPage.tsx:119-159`

**Interfaces:**
- Consumes: existing `SUPPORT_EMAIL`, `supportMailtoHref`, `ConfirmDialog`, and the existing “邮件申请删除” button.
- Produces: no new component or API; preserves the current mailto behavior with truthful scope.

- [ ] **Step 1: Add failing deletion-boundary assertions**

Extend the second account-hub test and add a third test:

```tsx
it('describes deletion as a reviewed request with lawful retention exceptions', async () => {
  const user = userEvent.setup();
  renderSettings();

  const account = screen.getByRole('region', { name: '账号' });
  expect(within(account).getByText(/通过邮件提交申请/)).toBeTruthy();
  expect(within(account).getByText(/交易、安全或审计记录可能继续受限保存/)).toBeTruthy();

  await user.click(within(account).getByRole('button', { name: '邮件申请删除' }));
  const dialog = screen.getByRole('dialog', { name: '申请删除账号？' });
  expect(within(dialog).getByText(/邮件是申请入口，不代表账号会即时自动删除/)).toBeTruthy();
  expect(within(dialog).getByText(/依法需要保留/)).toBeTruthy();

  const text = dialog.textContent ?? '';
  expect(text).not.toContain('删除会清除任务记录、浏览器数据和订阅信息');
  expect(text).not.toContain('再完成账号关闭');
});
```

- [ ] **Step 2: Run the focused settings test and verify it fails**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/SettingsPage.account.test.tsx
```

Expected: FAIL because the old copy promises broad clearing and does not disclose retention exceptions.

- [ ] **Step 3: Replace the settings row and dialog copy**

Use this row description:

```text
通过邮件提交申请。确认身份后处理账号关闭和关联数据；依法需要保留的交易、安全或审计记录可能继续受限保存
```

Use this dialog description:

```text
账号删除不可撤销。邮件是申请入口，不代表账号会即时自动删除。我们会先确认账号归属，并处理账号关闭和可删除的关联数据；依法需要保留的交易、安全、争议或审计记录可能继续受限保存。

将打开系统邮件应用；若未自动打开，请手动发送到 ${SUPPORT_EMAIL}。请勿在邮件中发送密码、验证码、身份证件照片或完整支付信息。
```

Keep the button label `邮件申请删除`, the confirm label `打开邮件应用`, and the current email subject/body. The body may ask only for registered email and optional reason.

- [ ] **Step 4: Run focused privacy/settings tests**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/SettingsPage.account.test.tsx src/pages/PrivacyPage.truth.test.tsx
```

Expected: PASS, both files.

- [ ] **Step 5: Run lint on all touched TSX files**

Run:

```bash
pnpm --filter @holaday/web-workbench exec eslint src/pages/PrivacyPage.tsx src/pages/PrivacyPage.truth.test.tsx src/pages/SettingsPage.tsx src/pages/SettingsPage.account.test.tsx
```

Expected: exit 0.

- [ ] **Step 6: Commit the deletion boundary**

```bash
git add apps/web-workbench/src/pages/SettingsPage.tsx apps/web-workbench/src/pages/SettingsPage.account.test.tsx
git commit -m "fix(settings): clarify account deletion request scope"
```

---

### Task 4: Align the production exact-route legal pages

**Files:**
- Modify: `apps/holaday-landing/privacy.html`
- Modify: `apps/holaday-landing/terms.html`
- Create: `ops/aliyun-edge/legal-pages.test.mjs`

**Interfaces:**
- Consumes: the verified factual boundaries from Tasks 1–3 and the exact `/privacy`/`/terms` nginx routing.
- Produces: truth-aligned standalone pages shipped by both Vultr and Aliyun edge bundles.

- [ ] **Step 1: Add a failing static-content contract**

Require the implemented password, retention, extension, cross-task memory, feedback, Apify, Zapier, rights and manual-renewal boundaries; reject the old fixed deletion/log deadlines, automatic-renewal cancellation and Singapore-jurisdiction claims.

- [ ] **Step 2: Rebuild the landing privacy content**

Mirror the SPA facts without exposing internal hostnames, IPs, schema details or secrets. On mobile, render the processing table as readable cards rather than compressed columns.

- [ ] **Step 3: Align landing terms**

State one-time purchased periods and manual renewal, make account deletion an identity-checked request with lawful-retention exceptions, and remove the unverified specific jurisdiction.

- [ ] **Step 4: Verify the routed artifact**

Run `node --test ops/aliyun-edge/legal-pages.test.mjs` and `pnpm test:ops`, then inspect both pages at desktop and 390px widths with no overflow and valid anchors.

---

### Task 5: Verify the complete P0 story and prepare review evidence

**Files:**
- Read: `docs/superpowers/specs/2026-08-25-privacy-truth-design.md`
- Read: all four touched SPA files
- Do not modify unrelated files.

**Interfaces:**
- Consumes: Tasks 1–4 commits.
- Produces: verified branch evidence suitable for review; it does not authorize production deployment.

- [ ] **Step 1: Run the full web test suite**

Run:

```bash
pnpm --filter @holaday/web-workbench test
```

Expected: all baseline 206 files / 1513 tests plus the new privacy tests pass; exact final counts must be reported from output rather than predicted.

- [ ] **Step 2: Run lint, typecheck, and production build**

Run:

```bash
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run copy and diff gates**

Run:

```bash
rg -n "服务器主要位于中国大陆|Pro 永久|日志默认保留 90 天|密码（加密存储）|持续使用本服务即视为接受|完全合规|按月自动续费" apps/web-workbench/src/pages/PrivacyPage.tsx apps/web-workbench/src/pages/SettingsPage.tsx
git diff --check e9352de7409f98b52148154873d3ee9a15b27f28...HEAD
git status --short
```

Expected: `rg` has no matches, `git diff --check` is clean, and the worktree has no uncommitted tracked changes.

- [ ] **Step 4: Perform a local browser review**

Start the existing Vite app on a non-conflicting port, authenticate only if the route requires it, and inspect `/privacy` and `/settings#account` at:

- desktop width around 1440px;
- mobile width 390px;
- light and dark themes;
- keyboard navigation through the policy directory and delete-request dialog.

Verify:

- no horizontal overflow;
- table becomes readable cards on mobile;
- every section anchor lands below the fixed app chrome;
- external email links and `/terms` link are correct;
- summary is calm and readable, not styled as a marketing or security-certification page;
- delete dialog returns focus and does not imply immediate deletion.

Save screenshots only under a new task-specific `qa-artifacts/privacy-truth-*` directory inside the isolated worktree if evidence is needed; never touch the root checkout's existing `qa-artifacts/`.

- [ ] **Step 5: Review scope and unresolved production blocker**

Confirm the branch contains no backend, migration, env, payment, provider, extension, or deployment changes. Record in the handoff:

```text
P0 complete: public disclosure and mail-based deletion boundary are factually aligned.
P1 not complete: automated export/deletion, unified retention, policy-consent receipts, provider legal register, and pending-cookie legacy-column removal remain separate.
Production blocker: legal operator identity/address and counsel review are not supplied.
```

- [ ] **Step 6: Apply the finishing and verification skills**

Before claiming completion, read and follow:

- `superpowers:verification-before-completion`;
- `superpowers:requesting-code-review`;
- `superpowers:finishing-a-development-branch`.

Because team subagents are not authorized for this task, perform inline self-review and use the repository's available PR review workflow; do not spawn a review subagent.

When the branch is complete and verified, push it and create a PR by default. Do not merge or deploy merely because the branch and PR exist. Production deployment remains blocked until the legal operator information and counsel review are supplied.
