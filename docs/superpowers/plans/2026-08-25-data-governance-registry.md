# HOLA DAY Machine-Readable Data Governance Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立只读、强类型、可审计的数据治理工程事实层，完整登记当前 13 个公开数据类别及其处理方、保留和用户权利能力，并用测试阻止公开披露再次漂移。

**Architecture:** 在 Orchestrator 内新增无运行时副作用的 `data-governance` 模块，以 TypeScript 常量保存事实，并由纯函数审计器验证结构、交叉引用、源码证据和敏感值边界。一个只读 CLI 输出聚合与注册项 ID；业务路由、数据库和生产启动不导入该模块，隐私页面只通过契约测试做一致性检查，不由注册表自动生成。

**Tech Stack:** TypeScript 5.7、Vitest、Node.js `fs/path`、pnpm workspace、Biome、现有 Orchestrator 构建与测试工具链。

**Spec:** `docs/superpowers/specs/2026-08-25-data-governance-registry-design.md`

## Global Constraints

- 首阶段不得新增数据库表、migration、运行时 API、前端页面、生产配置或部署步骤。
- 审计器不得访问数据库、对象存储、支付、AI、浏览器、网络或生产主机。
- 注册表与报告不得包含密钥值、Cookie 值、用户标识、任务正文、支付标识或真实个人数据。
- 能力状态只能是 `implemented`、`manual`、`not_implemented` 或 `not_applicable`。
- 地区与法务状态只能使用已核实值或显式的 `unknown` / `pending_legal_review`，不得猜测。
- 固定天数仅能用于存在真实期限和执行路径的规则；页面可见范围、观察窗口和推断窗口不得登记为删除期限。
- 当前 13 个数据类别 ID 必须稳定，SPA 与 landing 隐私页都必须与其一一对应。
- 普通审计允许显式治理缺口并将其报告；结构错误必须返回非零退出码。
- PR 必须以 `codex/privacy-truth` 为基线形成堆叠审查，不写回 PR #140，不合并、不部署。

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/orchestrator/src/data-governance/types.ts` | 所有稳定 ID、注册对象、审计报告和能力状态类型 |
| `apps/orchestrator/src/data-governance/audit.ts` | 纯结构校验、交叉引用、证据文件和敏感值检查 |
| `apps/orchestrator/src/data-governance/audit.test.ts` | 审计器红绿测试与失败码契约 |
| `apps/orchestrator/src/data-governance/retention-policies.ts` | 13 类使用的真实保留策略 |
| `apps/orchestrator/src/data-governance/rights-capabilities.ts` | 导出、删除、更正、暂停、撤回的真实状态 |
| `apps/orchestrator/src/data-governance/lifecycle-registry.test.ts` | 保留与权利真实性契约 |
| `apps/orchestrator/src/data-governance/processors.ts` | 内部和外部处理方、触发条件、类别引用与证据 |
| `apps/orchestrator/src/data-governance/processors.test.ts` | 处理方清单、双向引用准备和配置键安全契约 |
| `apps/orchestrator/src/data-governance/data-categories.ts` | 当前 13 个公开数据类别完整定义 |
| `apps/orchestrator/src/data-governance/data-categories.test.ts` | 类别 ID、敏感级别、事实边界和证据契约 |
| `apps/orchestrator/src/data-governance/public-disclosure-map.ts` | 稳定 ID 到两处公开显示名称和边界关键词的映射 |
| `apps/orchestrator/src/data-governance/public-disclosure-map.test.ts` | 读取 SPA/landing 源文件并核对双表面覆盖 |
| `apps/orchestrator/src/data-governance/index.ts` | 汇总导出完整 `governanceRegistry` bundle |
| `apps/orchestrator/scripts/governance-audit.ts` | 参数解析、文本/JSON 输出和退出码；无其他副作用 |
| `apps/orchestrator/src/data-governance/governance-audit-cli.test.ts` | CLI 文本、JSON、退出码和隐私边界测试 |
| `package.json` | 新增根级 `governance:audit` 命令 |

---

### Task 1: Core Types and Pure Registry Auditor

**Files:**
- Create: `apps/orchestrator/src/data-governance/types.ts`
- Create: `apps/orchestrator/src/data-governance/audit.ts`
- Create: `apps/orchestrator/src/data-governance/audit.test.ts`

**Interfaces:**
- Consumes: no earlier task output.
- Produces: `GovernanceRegistryBundle`, `AuditIssue`, `AuditReport`, `auditGovernanceRegistry(bundle, options)`, and all stable ID/status types used by Tasks 2–6.

- [ ] **Step 1: Write the failing auditor contract**

Create `audit.test.ts` with a valid single-category fixture and explicit failures:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import type { GovernanceRegistryBundle } from './types.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const evidence = [{
  kind: 'source_file' as const,
  path: 'apps/orchestrator/src/db/schema/users.ts',
  fact: '账号资料保存在用户表',
}];

function validBundle(): GovernanceRegistryBundle {
  return {
    categories: [{
      id: 'account_security',
      displayName: '账号与安全',
      description: '账号注册、登录与安全数据',
      dataElements: ['邮箱', '密码哈希'],
      sources: ['用户主动提交', '登录流程'],
      purposes: ['注册与账号安全'],
      sensitivity: 'sensitive',
      storageLocations: ['HOLA DAY 数据库'],
      processorIds: ['holaday_internal'],
      retentionPolicyId: 'account_purpose_bound',
      rightsCapabilityId: 'account_manual_request',
      evidence,
    }],
    processors: [{
      id: 'holaday_internal',
      displayName: 'HOLA DAY',
      purposes: ['提供账号与任务服务'],
      categoryIds: ['account_security'],
      activation: { mode: 'always_internal', evidence },
      regionStatus: 'unknown',
      legalReviewStatus: 'pending_legal_review',
    }],
    retentionPolicies: [{
      id: 'account_purpose_bound',
      trigger: '账号创建',
      rule: { kind: 'purpose_bound', description: '账号存续及安全所需' },
      automationStatus: 'manual',
      retryStatus: 'not_implemented',
      evidence,
    }],
    rightsCapabilities: [{
      id: 'account_manual_request',
      export: {
        status: 'not_implemented', scope: '无自动导出', limitations: ['需后续建设'], evidence,
      },
      delete: {
        status: 'manual', manualEntrypoint: 'privacy@holaday.ai',
        scope: '身份核验后的账号关闭和可处理数据', limitations: ['受限保留记录除外'], evidence,
      },
      correct: {
        status: 'manual', manualEntrypoint: 'privacy@holaday.ai',
        scope: '可更正账号信息', limitations: [], evidence,
      },
      pause: {
        status: 'not_applicable', scope: '账号安全处理不可暂停', limitations: [], evidence,
      },
      withdraw: {
        status: 'manual', manualEntrypoint: 'privacy@holaday.ai',
        scope: '适用时处理撤回申请', limitations: ['不影响撤回前处理'], evidence,
      },
    }],
    publicDisclosures: [{
      categoryId: 'account_security',
      spaLabel: '账号与安全',
      landingLabel: '账号与安全',
      requiredBoundaries: ['密码哈希'],
      publiclyDisclosed: true,
    }],
  };
}

describe('auditGovernanceRegistry', () => {
  it('accepts a structurally complete registry without reading runtime data', () => {
    const report = auditGovernanceRegistry(validBundle(), { verifyEvidenceFiles: false });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'gap', code: 'governance_gap' }),
    ]));
  });

  it('rejects duplicate ids, dangling references, and implemented rights without handlers', () => {
    const bundle = validBundle();
    bundle.categories = [...bundle.categories, bundle.categories[0]!];
    bundle.categories[0] = { ...bundle.categories[0]!, processorIds: ['missing_processor'] };
    bundle.rightsCapabilities[0] = {
      ...bundle.rightsCapabilities[0]!,
      export: { status: 'implemented', scope: '导出', limitations: [], evidence },
    };
    const report = auditGovernanceRegistry(bundle, { verifyEvidenceFiles: false });
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'duplicate_id', 'dangling_reference', 'implemented_handler_missing',
    ]));
  });

  it('rejects suspicious secret values but permits configuration key names', () => {
    const safe = validBundle();
    safe.processors[0] = {
      ...safe.processors[0]!,
      activation: { ...safe.processors[0]!.activation, configKeys: ['RESEND_API_KEY'] },
    };
    expect(auditGovernanceRegistry(safe, { verifyEvidenceFiles: false }).ok).toBe(true);

    const unsafe = validBundle();
    unsafe.categories[0] = { ...unsafe.categories[0]!, description: 'sk-live-secret-example-123456789' };
    expect(auditGovernanceRegistry(unsafe, { verifyEvidenceFiles: false }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'suspicious_secret' })]));
  });

  it('enforces ids, bidirectional processors, retention rules, and disclosure cardinality', () => {
    const bundle = validBundle();
    Reflect.set(bundle.categories[0]!, 'id', 'Account Security');
    bundle.processors[0]!.categoryIds = [];
    bundle.retentionPolicies[0]!.rule = { kind: 'fixed_days', days: 0 };
    bundle.publicDisclosures.push(bundle.publicDisclosures[0]!);
    const report = auditGovernanceRegistry(bundle, {
      verifyEvidenceFiles: false,
      requirePublicDisclosures: true,
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid_id', 'processor_category_mismatch', 'invalid_fixed_days',
      'public_disclosure_duplicate',
    ]));
  });

  it('verifies exported symbols without reading runtime data', () => {
    const bundle = validBundle();
    bundle.categories[0]!.evidence = [{
      kind: 'exported_symbol',
      path: 'apps/orchestrator/src/db/schema/users.ts',
      symbol: 'DefinitelyMissingGovernanceSymbol',
      fact: '负向证据符号',
    }];
    const report = auditGovernanceRegistry(bundle, { repoRoot, verifyEvidenceFiles: true });
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'evidence_symbol_missing' }),
    ]));
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance/audit.test.ts
```

Expected: FAIL because `types.ts` and `audit.ts` do not exist.

- [ ] **Step 3: Define the exact types**

In `types.ts`, define these ID unions and interfaces:

```ts
export type DataCategoryId =
  | 'account_security' | 'task_execution' | 'cross_task_memory'
  | 'energy_astrology_profile' | 'stock_preference_profile'
  | 'feedback_support' | 'external_notifications' | 'extension_site_stats'
  | 'extension_login_cookies' | 'payments_entitlements'
  | 'partner_kyc_ledger' | 'media_assets' | 'analytics_logs';

export type ProcessorId =
  | 'holaday_internal' | 'anthropic' | 'openai' | 'google' | 'dashscope'
  | 'fal_ai' | 'divineapi' | 'firecrawl' | 'apify' | 'zapier' | 'resend'
  | 'sms_gateway' | 'paypal' | 'china_payment' | 'wecom' | 'feishu'
  | 'dingtalk' | 'custom_webhook' | 'vultr' | 'cloudflare_r2' | 'aliyun';

export type RetentionPolicyId =
  | 'account_purpose_bound' | 'task_visibility_unified_unknown'
  | 'memory_entry_lifecycle' | 'browser_local_until_clear'
  | 'stock_profile_mixed' | 'feedback_purpose_bound'
  | 'notification_config_until_change' | 'domain_snapshot_replace'
  | 'cookie_injection_mixed' | 'transaction_restricted'
  | 'partner_financial_restricted' | 'media_mixed' | 'analytics_configured_mixed';

export type RightsCapabilityId =
  | 'account_manual_request' | 'task_manual_request' | 'memory_self_service'
  | 'astrology_local_self_service' | 'stock_profile_self_service'
  | 'feedback_manual_request' | 'notification_self_service'
  | 'extension_stats_manual_request' | 'extension_cookie_mixed'
  | 'payment_restricted_request' | 'partner_restricted_request'
  | 'media_mixed_control' | 'analytics_manual_request';

export type GovernanceCapabilityStatus =
  | 'implemented' | 'manual' | 'not_implemented' | 'not_applicable';
export type VerificationStatus =
  | 'verified_in_code' | 'verified_operationally' | 'unknown' | 'pending_legal_review';

export interface AuditIssue {
  severity: 'error' | 'gap';
  code:
    | 'invalid_id' | 'duplicate_id' | 'dangling_reference' | 'missing_evidence'
    | 'implemented_handler_missing' | 'manual_entrypoint_missing'
    | 'not_implemented_handler_present' | 'unknown_reason_missing'
    | 'invalid_fixed_days' | 'fixed_days_automation_missing'
    | 'processor_category_mismatch' | 'source_evidence_missing'
    | 'evidence_symbol_missing' | 'public_disclosure_missing'
    | 'public_disclosure_duplicate' | 'public_disclosure_unknown_category'
    | 'suspicious_secret' | 'suspicious_personal_data' | 'governance_gap';
  registryId: string;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  summary: {
    categories: number; processors: number; retentionPolicies: number;
    rightsCapabilities: number; unknownOrPendingProcessors: number;
    manualCapabilities: number; notImplementedCapabilities: number;
    unknownRetentionPolicies: number; errors: number; gaps: number;
  };
  issues: AuditIssue[];
}
```

Implement the spec interfaces `SourceEvidence`, `DataCategoryDefinition`, `ProcessorDefinition`, `RetentionPolicyDefinition`, `CapabilityDefinition`, `RightsCapability`, `PublicDisclosureDefinition`, and mutable-array `GovernanceRegistryBundle`. Keep `CapabilityDefinition.handlerRef?: string` exactly aligned with the approved spec; implemented capabilities use a repository-relative `path#exportedSymbol` reference and also carry `SourceEvidence`. `manualEntrypoint` is a public string entry point.

- [ ] **Step 4: Implement the minimal pure auditor**

In `audit.ts`, export:

```ts
export interface AuditOptions {
  repoRoot?: string;
  verifyEvidenceFiles?: boolean;
  requirePublicDisclosures?: boolean;
}

export function auditGovernanceRegistry(
  bundle: GovernanceRegistryBundle,
  options: AuditOptions = {},
): AuditReport;
```

The function must aggregate rather than throw. Implement helpers for lowercase snake-case IDs, unique IDs, reference existence, processor/category bidirectional equality, capability invariants, retention-rule invariants, evidence non-emptiness, optional `existsSync(resolve(repoRoot, evidence.path))`, optional exported-symbol verification, strict public-disclosure completeness, and recursive suspicious-value detection.

Required invariants are explicit:

- `implemented` requires `handlerRef` plus evidence; `not_implemented` rejects a handler;
- `manual` requires a public/manual entry point, non-empty scope, and an explicit limitations array;
- `fixed_days` requires a positive integer and implemented automation evidence;
- `unknown` retention requires a non-empty reason;
- `exported_symbol` evidence reads only the referenced repository source file and must find the exact exported symbol name;
- evidence resolution rejects paths that escape `repoRoot`;
- `requirePublicDisclosures: true` requires one and only one mapping per category and rejects unknown category IDs.

The suspicious-value detector must ignore strings matching `/^[A-Z][A-Z0-9_]+$/` because those are configuration key names. It flags private-key headers; token-like values beginning `sk-`, `ghp_`, `xoxb-`, `xoxp-`, or `Bearer `; Cookie assignment strings; and obvious embedded user/email/phone identifiers in fields that are not approved public contact entry points. Do not add broad entropy heuristics that would misclassify Chinese policy text.

Every explicit `manual`, `not_implemented`, `unknown`, or `pending_legal_review` state adds one deduplicated `governance_gap` issue with severity `gap`. `report.ok` is `true` exactly when there are no severity `error` issues.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance/audit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the core auditor**

```bash
git add apps/orchestrator/src/data-governance/types.ts \
  apps/orchestrator/src/data-governance/audit.ts \
  apps/orchestrator/src/data-governance/audit.test.ts
git commit -m "feat(governance): add typed registry auditor"
```

---

### Task 2: Retention Policies and Rights Capabilities

**Files:**
- Create: `apps/orchestrator/src/data-governance/retention-policies.ts`
- Create: `apps/orchestrator/src/data-governance/rights-capabilities.ts`
- Create: `apps/orchestrator/src/data-governance/lifecycle-registry.test.ts`

**Interfaces:**
- Consumes: `RetentionPolicyDefinition`, `RightsCapability`, `RetentionPolicyId`, and `RightsCapabilityId` from Task 1.
- Produces: `retentionPolicies` and `rightsCapabilities` arrays consumed by Tasks 4 and 6.

- [ ] **Step 1: Write failing lifecycle truth tests**

Create `lifecycle-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { retentionPolicies } from './retention-policies.js';
import { rightsCapabilities } from './rights-capabilities.js';

const RETENTION_IDS = [
  'account_purpose_bound', 'task_visibility_unified_unknown', 'memory_entry_lifecycle',
  'browser_local_until_clear', 'stock_profile_mixed', 'feedback_purpose_bound',
  'notification_config_until_change', 'domain_snapshot_replace', 'cookie_injection_mixed',
  'transaction_restricted', 'partner_financial_restricted', 'media_mixed',
  'analytics_configured_mixed',
] as const;

const RIGHTS_IDS = [
  'account_manual_request', 'task_manual_request', 'memory_self_service',
  'astrology_local_self_service', 'stock_profile_self_service',
  'feedback_manual_request', 'notification_self_service',
  'extension_stats_manual_request', 'extension_cookie_mixed',
  'payment_restricted_request', 'partner_restricted_request',
  'media_mixed_control', 'analytics_manual_request',
] as const;

describe('governance lifecycle registry', () => {
  it('registers each approved retention and rights id exactly once', () => {
    expect(retentionPolicies.map((item) => item.id)).toEqual(RETENTION_IDS);
    expect(rightsCapabilities.map((item) => item.id)).toEqual(RIGHTS_IDS);
  });

  it('does not turn visibility, observation, or inference windows into deletion deadlines', () => {
    const task = retentionPolicies.find((item) => item.id === 'task_visibility_unified_unknown');
    const stock = retentionPolicies.find((item) => item.id === 'stock_profile_mixed');
    expect(task?.rule.kind).toBe('unknown');
    expect(JSON.stringify(task)).toContain('可见范围不是服务器删除期限');
    expect(stock?.rule.kind).toBe('mixed');
    expect(JSON.stringify(stock)).toContain('90 天仅是推断窗口');
  });

  it('keeps account close and comprehensive export truthful', () => {
    const account = rightsCapabilities.find((item) => item.id === 'account_manual_request');
    expect(account?.delete.status).toBe('manual');
    expect(account?.delete.manualEntrypoint).toBe('privacy@holaday.ai');
    expect(account?.export.status).toBe('not_implemented');
  });

  it('records exact self-service limits for memory, astrology, stock, and cookies', () => {
    const stock = rightsCapabilities.find((item) => item.id === 'stock_profile_self_service');
    const cookie = rightsCapabilities.find((item) => item.id === 'extension_cookie_mixed');
    expect(stock?.pause.status).toBe('implemented');
    expect(stock?.delete.limitations).toContain('不会删除自选股本身');
    expect(cookie?.withdraw.status).toBe('implemented');
    expect(cookie?.delete.status).toBe('manual');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance/lifecycle-registry.test.ts
```

Expected: FAIL because both registry files are missing.

- [ ] **Step 3: Implement the 13 retention policies**

Create `retention-policies.ts` with the exact order in `RETENTION_IDS`. Use this matrix:

| ID | Rule | Automation | Retry | Required evidence |
|---|---|---|---|---|
| `account_purpose_bound` | purpose-bound: 账号存续及安全所需 | manual | not_implemented | `apps/orchestrator/src/db/schema/users.ts`, `apps/web-workbench/src/pages/SettingsPage.tsx` |
| `task_visibility_unified_unknown` | unknown: 套餐可见范围不是服务器删除期限，尚无统一期限 | not_implemented | not_implemented | `apps/orchestrator/src/db/schema/tasks.ts`, `apps/web-workbench/src/utils/time-buckets.ts` |
| `memory_entry_lifecycle` | mixed: 偏好可长期，其他条目按自身期限/长期状态 | implemented | not_implemented | `apps/orchestrator/src/db/schema/execution-memory.ts`, `apps/orchestrator/src/trpc/routers/memory.ts` |
| `browser_local_until_clear` | until-user-action: 本地清除资料或浏览器数据 | implemented | not_applicable | `apps/web-workbench/src/lib/astrology.ts` |
| `stock_profile_mixed` | mixed: 自动筛选依据 90 天仅是推断窗口，清空控制服务器依据 | implemented | not_implemented | `apps/orchestrator/src/stocks/stock-preference-profile.ts`, `apps/orchestrator/src/stocks/stock-preference-repository.ts` |
| `feedback_purpose_bound` | purpose-bound: 反馈、故障、安全、争议所需 | manual | not_implemented | `apps/orchestrator/src/trpc/routers/feedback.ts` |
| `notification_config_until_change` | until-user-action: 修改或删除渠道配置 | implemented | not_implemented | `apps/orchestrator/src/trpc/routers/notifications.ts` |
| `domain_snapshot_replace` | until-user-action: 下次成功同步替换旧快照 | implemented | not_implemented | `apps/orchestrator/src/browsing-history/service.ts` |
| `cookie_injection_mixed` | mixed: 即时注入或暂存；旧明文字段迁移未完成 | not_implemented | not_implemented | `apps/orchestrator/src/cookies/sync-service.ts`, `apps/orchestrator/src/db/schema/pending-cookies.ts` |
| `transaction_restricted` | purpose-bound: 交易、税务、争议及法律所需 | manual | not_implemented | `apps/orchestrator/src/db/schema/payments.ts` |
| `partner_financial_restricted` | purpose-bound: 实名、账务、反欺诈、税务和争议 | manual | not_implemented | `apps/orchestrator/src/db/schema/partner.ts` |
| `media_mixed` | mixed: 文件可用期、账号处理与安全/授权证据 | manual | not_implemented | `apps/orchestrator/src/db/schema/task-files.ts`, `apps/orchestrator/src/trpc/routers/video-onboarding.ts` |
| `analytics_configured_mixed` | mixed: 已有能量分析分级期限，其他日志无统一期限 | implemented | implemented | `apps/orchestrator/src/config/env.energy-analytics.test.ts`, `apps/orchestrator/src/energy/analytics-cleanup.ts` |

Each evidence path is repository-relative and carries a one-sentence `fact`. Do not assign `fixed_days` to any mixed or unknown policy.

- [ ] **Step 4: Implement the 13 rights capabilities**

Create `rights-capabilities.ts` in `RIGHTS_IDS` order. Use a small `capability()` helper only to fill `scope`, `limitations`, and evidence consistently; do not hide status-specific requirements.

Required exact boundaries:

- `account_manual_request`: delete/correct/withdraw manual via `privacy@holaday.ai`; export not implemented.
- `task_manual_request`: individual task deletion implemented via `trpc/routers/tasks.ts`; comprehensive export not implemented; audit/manual-hold limitations retained.
- `memory_self_service`: delete/correct implemented through `trpc/routers/memory.ts`; export not implemented.
- `astrology_local_self_service`: delete/correct implemented in browser local storage; server-wide export not implemented.
- `stock_profile_self_service`: pause and delete implemented; delete limitation includes `不会删除自选股本身`; comprehensive export not implemented.
- `feedback_manual_request`: delete/correct/withdraw manual via privacy email; export not implemented.
- `notification_self_service`: correct/delete/withdraw implemented for channel configuration; delivered recipient copies are not controlled by HOLA DAY.
- `extension_stats_manual_request`: future sync can be stopped; server deletion remains manual.
- `extension_cookie_mixed`: withdraw implemented by logout/disable/uninstall; server deletion manual; limitation states previously received data is not automatically removed.
- `payment_restricted_request` and `partner_restricted_request`: requests are manual and deletion is limited by transaction/audit/legal retention.
- `media_mixed_control`: existing per-feature cleanup is `implemented` only where handler evidence exists; comprehensive export remains not implemented.
- `analytics_manual_request`: request is manual; aggregated or legally retained records may not be attributable/deletable.

- [ ] **Step 5: Run lifecycle and auditor tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/data-governance/audit.test.ts \
  src/data-governance/lifecycle-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit lifecycle facts**

```bash
git add apps/orchestrator/src/data-governance/retention-policies.ts \
  apps/orchestrator/src/data-governance/rights-capabilities.ts \
  apps/orchestrator/src/data-governance/lifecycle-registry.test.ts
git commit -m "feat(governance): register retention and rights facts"
```

---

### Task 3: Processor Registry

**Files:**
- Create: `apps/orchestrator/src/data-governance/processors.ts`
- Create: `apps/orchestrator/src/data-governance/processors.test.ts`

**Interfaces:**
- Consumes: `ProcessorDefinition`, `ProcessorId`, and `DataCategoryId` from Task 1.
- Produces: ordered `processors` array consumed by Tasks 4 and 6.

- [ ] **Step 1: Write the failing processor inventory test**

```ts
import { describe, expect, it } from 'vitest';
import { processors } from './processors.js';

const PROCESSOR_IDS = [
  'holaday_internal', 'anthropic', 'openai', 'google', 'dashscope', 'fal_ai',
  'divineapi', 'firecrawl', 'apify', 'zapier', 'resend', 'sms_gateway',
  'paypal', 'china_payment', 'wecom', 'feishu', 'dingtalk', 'custom_webhook',
  'vultr', 'cloudflare_r2', 'aliyun',
] as const;

describe('processor registry', () => {
  it('registers the approved processor inventory exactly once', () => {
    expect(processors.map((item) => item.id)).toEqual(PROCESSOR_IDS);
  });

  it('records conditions as config key names without values', () => {
    const json = JSON.stringify(processors);
    expect(json).toContain('DIVINE_API_KEY');
    expect(json).toContain('APIFY_API_TOKEN');
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{12,}|-----BEGIN .*PRIVATE KEY-----/);
  });

  it('keeps legal status separate from code verification', () => {
    for (const processor of processors.filter((item) => item.id !== 'holaday_internal')) {
      expect(['unknown', 'pending_legal_review']).toContain(processor.legalReviewStatus);
    }
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance/processors.test.ts
```

Expected: FAIL because `processors.ts` does not exist.

- [ ] **Step 3: Implement the processor inventory**

Create `processors.ts` in `PROCESSOR_IDS` order. Use this exact source map and activation mode:

| ID | Mode | Config keys | Evidence path | Category scope |
|---|---|---|---|---|
| `holaday_internal` | always_internal | none | `apps/orchestrator/src/index.ts` | all 13 IDs in `CATEGORY_IDS` |
| `anthropic` | feature_conditional | `ANTHROPIC_API_KEY` | `apps/orchestrator/src/agent/planners/anthropic.ts` | `task_execution`, `cross_task_memory` |
| `openai` | feature_conditional | `OPENAI_API_KEY` | `apps/orchestrator/src/response-layer/openai-response-layer.ts` | `task_execution` |
| `google` | feature_conditional | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY` | `apps/orchestrator/src/http.ts`, `apps/orchestrator/src/agent/image/gemini-image-client.ts` | `account_security`, `task_execution`, `media_assets` |
| `dashscope` | feature_conditional | `DASHSCOPE_API_KEY` | `apps/orchestrator/src/agent/video/qwen-voice-clone-client.ts` | `task_execution`, `media_assets` |
| `fal_ai` | feature_conditional | `FAL_KEY` | `apps/orchestrator/src/agent/video/fal-lipsync-client.ts` | `task_execution`, `media_assets` |
| `divineapi` | feature_conditional | `DIVINE_API_KEY`, `DIVINE_ACCESS_TOKEN` | `apps/orchestrator/src/astrology/service.ts` | `energy_astrology_profile` |
| `firecrawl` | feature_conditional | `FIRECRAWL_API_KEY` | `apps/orchestrator/src/firecrawl/firecrawl-lane.ts` | `task_execution` |
| `apify` | feature_conditional | `APIFY_API_TOKEN` | `apps/orchestrator/src/agent/supercar/adapters/apify.ts` | `task_execution` |
| `zapier` | feature_conditional | `ZAPIER_API_KEY`, `ZAPIER_WEBHOOK_PATH` | `apps/orchestrator/src/agent/supercar/adapters/zapier.ts` | `task_execution` |
| `resend` | feature_conditional | `RESEND_API_KEY` | `apps/orchestrator/src/auth/email-code.ts`, `apps/orchestrator/src/trpc/routers/feedback.ts` | `account_security`, `feedback_support` |
| `sms_gateway` | feature_conditional | `ALIYUN_SMS_URL`, `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_SMS_SIGN_NAME`, `ALIYUN_SMS_TEMPLATE_CODE` | `apps/orchestrator/src/trpc/routers/auth.ts`, `apps/cn-payment/src/sms.ts`, `apps/cn-payment/src/config/env.ts` | `account_security` |
| `paypal` | feature_conditional | `PAYPAL_ENABLED`, `PAYPAL_CLIENT_ID` | `apps/orchestrator/src/payment/paypal.ts` | `payments_entitlements` |
| `china_payment` | feature_conditional | `WX_APPID`, `WX_MCHID`, `WX_API_V3_KEY`, `WX_CERT_PATH`, `WX_KEY_PATH`, `ALIPAY_APPID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY`, `ALIPAY_MODE` | `apps/cn-payment/src/index.ts`, `apps/cn-payment/src/wechat-pay.ts`, `apps/cn-payment/src/alipay.ts` | `payments_entitlements`, `partner_kyc_ledger` |
| `wecom` | user_configured | none | `apps/orchestrator/src/notifications/webhook-sender.ts` | `external_notifications` |
| `feishu` | user_configured | none | `apps/orchestrator/src/notifications/webhook-sender.ts` | `external_notifications` |
| `dingtalk` | user_configured | none | `apps/orchestrator/src/notifications/webhook-sender.ts` | `external_notifications` |
| `custom_webhook` | user_configured | none | `apps/orchestrator/src/notifications/webhook-sender.ts` | `external_notifications` |
| `vultr` | always_internal | none | `ops/vultr-nginx/holaday.conf` | `account_security`, `task_execution`, `analytics_logs` |
| `cloudflare_r2` | feature_conditional | `STORAGE_PROVIDER`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_REGION` | `apps/orchestrator/src/files/storage-provider.ts` | `task_execution`, `media_assets` |
| `aliyun` | always_internal | none | `ops/aliyun-edge/nginx-hd-app.conf` | `account_security`, `analytics_logs` |

Before implementing `sms_gateway`, rerun this discovery command to detect source drift:

```bash
rg -n "ALIYUN_SMS_URL|ALIYUN_ACCESS_KEY|ALIYUN_SMS_|sms" \
  apps/orchestrator/src/trpc/routers/auth.ts \
  apps/cn-payment/src/config/env.ts \
  apps/cn-payment/src/sms.ts
```

Expected: the Orchestrator exposes `ALIYUN_SMS_URL`, while the outbound adapter and credential schema live in `apps/cn-payment`. If the command no longer finds that boundary, stop Task 3 and update the design evidence instead of inventing a symbol or silently dropping the processor.

Use `verified_in_code` only for the existence and trigger path. Use `unknown` or `pending_legal_review` for region/legal status unless the approved spec contains current verified evidence.

- [ ] **Step 4: Run processor tests and the pure auditor test**

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/data-governance/processors.test.ts \
  src/data-governance/audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the processor registry**

```bash
git add apps/orchestrator/src/data-governance/processors.ts \
  apps/orchestrator/src/data-governance/processors.test.ts
git commit -m "feat(governance): register conditional data processors"
```

---

### Task 4: Thirteen Data Categories and Complete Bundle

**Files:**
- Create: `apps/orchestrator/src/data-governance/data-categories.ts`
- Create: `apps/orchestrator/src/data-governance/data-categories.test.ts`
- Create: `apps/orchestrator/src/data-governance/index.ts`

**Interfaces:**
- Consumes: `processors`, `retentionPolicies`, `rightsCapabilities`, and all Task 1 types.
- Produces: ordered `dataCategories` and complete `governanceRegistry` for Tasks 5–6.

- [ ] **Step 1: Write the failing category contract**

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import { dataCategories } from './data-categories.js';
import { governanceRegistry } from './index.js';

const CATEGORY_IDS = [
  'account_security', 'task_execution', 'cross_task_memory',
  'energy_astrology_profile', 'stock_preference_profile', 'feedback_support',
  'external_notifications', 'extension_site_stats', 'extension_login_cookies',
  'payments_entitlements', 'partner_kyc_ledger', 'media_assets', 'analytics_logs',
] as const;

describe('data category registry', () => {
  it('registers the thirteen public categories in stable order', () => {
    expect(dataCategories.map((item) => item.id)).toEqual(CATEGORY_IDS);
  });

  it('marks cookies, KYC, and exact-birthday profiles as sensitive', () => {
    for (const id of ['extension_login_cookies', 'partner_kyc_ledger', 'energy_astrology_profile']) {
      expect(dataCategories.find((item) => item.id === id)?.sensitivity)
        .toBe('highly_sensitive');
    }
  });

  it('passes complete cross-reference and source-evidence audit', () => {
    const report = auditGovernanceRegistry(governanceRegistry, {
      repoRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
      verifyEvidenceFiles: true,
    });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.summary.categories).toBe(13);
  });

  it('preserves the stock and extension-cookie control limits', () => {
    expect(JSON.stringify(dataCategories.find((item) => item.id === 'stock_preference_profile')))
      .toContain('可能优势与潜在盲点');
    expect(JSON.stringify(dataCategories.find((item) => item.id === 'extension_login_cookies')))
      .toContain('真实 Cookie');
  });
});
```

Use `fileURLToPath` as shown so spaces and platform path encoding cannot corrupt evidence resolution.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance/data-categories.test.ts
```

Expected: FAIL because `data-categories.ts` and `index.ts` do not exist.

- [ ] **Step 3: Implement all 13 category definitions**

Create `data-categories.ts` in `CATEGORY_IDS` order. Use the following exact linkage matrix; copy data elements and purposes from the approved privacy-truth table without broadening them:

| Category | Retention | Rights | Required processors | Minimum evidence |
|---|---|---|---|---|
| `account_security` | `account_purpose_bound` | `account_manual_request` | `holaday_internal`, `google`, `resend`, `sms_gateway`, `vultr`, `aliyun` | `apps/orchestrator/src/db/schema/users.ts`, `apps/orchestrator/src/db/schema/sessions.ts`, `apps/orchestrator/src/db/schema/user-mfa-recovery-codes.ts` |
| `task_execution` | `task_visibility_unified_unknown` | `task_manual_request` | `holaday_internal`, `anthropic`, `openai`, `google`, `dashscope`, `fal_ai`, `firecrawl`, `apify`, `zapier`, `vultr`, `cloudflare_r2` | `apps/orchestrator/src/db/schema/tasks.ts`, `apps/orchestrator/src/db/schema/task-files.ts`, `apps/orchestrator/src/db/schema/task-steps.ts` |
| `cross_task_memory` | `memory_entry_lifecycle` | `memory_self_service` | `holaday_internal`, `anthropic` | `apps/orchestrator/src/db/schema/execution-memory.ts`, `apps/orchestrator/src/agent/supercar/memory-service.ts`, `apps/orchestrator/src/trpc/routers/memory.ts` |
| `energy_astrology_profile` | `browser_local_until_clear` | `astrology_local_self_service` | `holaday_internal`, `divineapi` | `apps/web-workbench/src/lib/astrology.ts`, `apps/orchestrator/src/astrology/service.ts` |
| `stock_preference_profile` | `stock_profile_mixed` | `stock_profile_self_service` | `holaday_internal` | `apps/orchestrator/src/stocks/stock-preference-profile.ts`, `apps/orchestrator/src/stocks/stock-preference-repository.ts` |
| `feedback_support` | `feedback_purpose_bound` | `feedback_manual_request` | `holaday_internal`, `resend` | `apps/orchestrator/src/trpc/routers/feedback.ts` |
| `external_notifications` | `notification_config_until_change` | `notification_self_service` | `holaday_internal`, `wecom`, `feishu`, `dingtalk`, `custom_webhook` | `apps/orchestrator/src/notifications/notification-service.ts`, `apps/orchestrator/src/notifications/scheduled-copy.ts` |
| `extension_site_stats` | `domain_snapshot_replace` | `extension_stats_manual_request` | `holaday_internal` | `apps/orchestrator/src/browsing-history/service.ts`, `apps/extension/src/background/history-sync.ts` |
| `extension_login_cookies` | `cookie_injection_mixed` | `extension_cookie_mixed` | `holaday_internal` | `apps/extension/src/background/cookie-sync.ts`, `apps/orchestrator/src/cookies/sync-service.ts`, `apps/orchestrator/src/db/schema/pending-cookies.ts` |
| `payments_entitlements` | `transaction_restricted` | `payment_restricted_request` | `holaday_internal`, `paypal`, `china_payment` | `apps/orchestrator/src/db/schema/payments.ts`, `apps/orchestrator/src/payment/paypal.ts`, `apps/orchestrator/src/trpc/routers/payment.ts` |
| `partner_kyc_ledger` | `partner_financial_restricted` | `partner_restricted_request` | `holaday_internal`, `china_payment` | `apps/orchestrator/src/db/schema/partner.ts`, `apps/orchestrator/src/partner/kyc-service.ts`, `apps/orchestrator/src/partner/withdrawal-service.ts` |
| `media_assets` | `media_mixed` | `media_mixed_control` | `holaday_internal`, `google`, `dashscope`, `fal_ai`, `cloudflare_r2` | `apps/orchestrator/src/db/schema/task-files.ts`, `apps/orchestrator/src/agent/image/gemini-image-client.ts`, `apps/orchestrator/src/agent/video/qwen-voice-clone-client.ts`, `apps/orchestrator/src/agent/video/fal-lipsync-client.ts`, `apps/orchestrator/src/trpc/routers/video-onboarding.ts` |
| `analytics_logs` | `analytics_configured_mixed` | `analytics_manual_request` | `holaday_internal`, `vultr`, `aliyun` | `apps/orchestrator/src/db/schema/energy-analytics.ts`, `apps/orchestrator/src/config/env.energy-analytics.test.ts`, `apps/orchestrator/src/energy/analytics-cleanup.ts` |

For every category:

- `dataElements`, `sources`, `purposes`, and `storageLocations` are non-empty;
- evidence uses repository-relative paths that exist;
- processor IDs match Task 3 exactly;
- no internal host, IP, secret value, user ID, or sample personal data is present.

- [ ] **Step 4: Export the complete bundle**

Create `index.ts`:

```ts
import { dataCategories } from './data-categories.js';
import { processors } from './processors.js';
import { retentionPolicies } from './retention-policies.js';
import { rightsCapabilities } from './rights-capabilities.js';
import type { GovernanceRegistryBundle } from './types.js';

export const governanceRegistry = {
  categories: dataCategories,
  processors,
  retentionPolicies,
  rightsCapabilities,
  publicDisclosures: [],
} satisfies GovernanceRegistryBundle;

export * from './types.js';
export { auditGovernanceRegistry } from './audit.js';
```

The empty disclosure list is intentional until Task 5; Task 4 tests must not require public mapping completeness yet. Add an audit option `requirePublicDisclosures?: boolean` defaulting to `false`; Task 5 will enable it.

- [ ] **Step 5: Run all registry tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance
```

Expected: PASS with 13 categories and no severity-error issues.

- [ ] **Step 6: Commit the complete engineering registry**

```bash
git add apps/orchestrator/src/data-governance/data-categories.ts \
  apps/orchestrator/src/data-governance/data-categories.test.ts \
  apps/orchestrator/src/data-governance/index.ts \
  apps/orchestrator/src/data-governance/audit.ts
git commit -m "feat(governance): register public data categories"
```

---

### Task 5: Public Disclosure Consistency Contract

**Files:**
- Create: `apps/orchestrator/src/data-governance/public-disclosure-map.ts`
- Create: `apps/orchestrator/src/data-governance/public-disclosure-map.test.ts`
- Modify: `apps/orchestrator/src/data-governance/index.ts`
- Modify: `apps/orchestrator/src/data-governance/audit.ts`

**Interfaces:**
- Consumes: 13 stable category IDs and `PublicDisclosureDefinition`.
- Produces: `publicDisclosures` and strict `requirePublicDisclosures` validation used by Task 6.

- [ ] **Step 1: Write the failing cross-surface contract**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import { governanceRegistry } from './index.js';
import { publicDisclosures } from './public-disclosure-map.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const spa = readFileSync(`${repoRoot}/apps/web-workbench/src/pages/PrivacyPage.tsx`, 'utf8');
const landing = readFileSync(`${repoRoot}/apps/holaday-landing/privacy.html`, 'utf8');

describe('public disclosure map', () => {
  it('maps every registered public category to both policy surfaces', () => {
    expect(publicDisclosures).toHaveLength(13);
    expect(new Set(publicDisclosures.map((item) => item.categoryId)).size).toBe(13);
    for (const item of publicDisclosures) {
      expect(spa).toContain(item.spaLabel);
      expect(landing).toContain(item.landingLabel);
      for (const boundary of item.requiredBoundaries) {
        expect(spa).toContain(boundary);
        expect(landing).toContain(boundary);
      }
    }
  });

  it('passes strict public-disclosure registry audit', () => {
    const report = auditGovernanceRegistry(governanceRegistry, {
      repoRoot,
      verifyEvidenceFiles: true,
      requirePublicDisclosures: true,
    });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/data-governance/public-disclosure-map.test.ts
```

Expected: FAIL because the mapping file is missing and the bundle list is empty.

- [ ] **Step 3: Implement the explicit 13-row mapping**

Create `public-disclosure-map.ts` with category ID and identical SPA/landing label:

```ts
const LABELS = [
  ['account_security', '账号与安全'],
  ['task_execution', '任务与执行'],
  ['cross_task_memory', '跨任务 AI 记忆'],
  ['energy_astrology_profile', '今日能量星座资料'],
  ['stock_preference_profile', '股票偏好画像'],
  ['feedback_support', '反馈与支持'],
  ['external_notifications', '外部通知渠道'],
  ['extension_site_stats', '扩展常用网站'],
  ['extension_login_cookies', '扩展登录态'],
  ['payments_entitlements', '支付与套餐'],
  ['partner_kyc_ledger', '合伙人 KYC 与账本'],
  ['media_assets', '媒体素材'],
  ['analytics_logs', '分析与日志'],
] as const;
```

Set `publiclyDisclosed: true` on all 13. Required boundaries must remain short and stable:

- task: `不是服务器删除期限`;
- memory: `偏好可能长期保留`;
- astrology: `DivineAPI`;
- stock: `90 天是推断窗口`;
- feedback: `Resend`;
- notifications: `webhook`;
- extension stats: `域名`;
- extension cookies: `真实 Cookie`;
- payment: `不会自动扣款`;
- partner: `风险评分`;
- media: `声音克隆`;
- analytics: `匿名摘要`;
- account: `密码哈希`.

Update `index.ts` to include `publicDisclosures`. Update `audit.ts` so strict mode emits `public_disclosure_missing`, `public_disclosure_duplicate`, or `public_disclosure_unknown_category` as appropriate. The 13-ID stable-order test is the migration guard: deleting, renaming, reordering, or repurposing one of the approved IDs fails unless the spec and an explicit migration plan are revised first.

- [ ] **Step 4: Run policy, registry, and landing contracts**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance
pnpm --filter @holaday/web-workbench exec vitest run src/pages/PrivacyPage.truth.test.tsx
node --test ops/aliyun-edge/legal-pages.test.mjs
```

Expected: all PASS. This task must not modify either privacy page merely to satisfy the mapping; a mismatch means revisit the registered boundary or the already-reviewed policy facts.

- [ ] **Step 5: Commit the disclosure contract**

```bash
git add apps/orchestrator/src/data-governance/public-disclosure-map.ts \
  apps/orchestrator/src/data-governance/public-disclosure-map.test.ts \
  apps/orchestrator/src/data-governance/index.ts \
  apps/orchestrator/src/data-governance/audit.ts
git commit -m "test(governance): bind registry to public disclosures"
```

---

### Task 6: Read-Only Audit CLI

**Files:**
- Create: `apps/orchestrator/scripts/governance-audit.ts`
- Create: `apps/orchestrator/src/data-governance/governance-audit-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `governanceRegistry`, `auditGovernanceRegistry`, and `AuditReport`.
- Produces: `runGovernanceAuditCli(args, io)` returning exit code `0 | 1 | 2`, plus root `pnpm governance:audit` command.

- [ ] **Step 1: Write the failing CLI contract**

Export CLI logic from the script so tests do not spawn a process:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runGovernanceAuditCli } from '../../scripts/governance-audit.js';

function io() {
  return { stdout: vi.fn(), stderr: vi.fn() };
}

describe('governance audit CLI', () => {
  it('prints aggregate text and explicit gap ids without raw data', () => {
    const output = io();
    const code = runGovernanceAuditCli([], output);
    expect(code).toBe(0);
    const text = output.stdout.mock.calls.flat().join('\n');
    expect(text).toContain('categories: 13');
    expect(text).toContain('not_implemented');
    expect(text).not.toMatch(/cookie=.*|Bearer\s+|sk-[A-Za-z0-9]{12,}/i);
  });

  it('emits valid JSON containing only summaries and issues', () => {
    const output = io();
    expect(runGovernanceAuditCli(['--format=json'], output)).toBe(0);
    const parsed = JSON.parse(output.stdout.mock.calls[0][0]);
    expect(parsed).toHaveProperty('summary.categories', 13);
    expect(parsed).toHaveProperty('summary.unknownOrPendingProcessors');
    expect(parsed).toHaveProperty('summary.manualCapabilities');
    expect(parsed).toHaveProperty('summary.notImplementedCapabilities');
    expect(parsed).toHaveProperty('summary.unknownRetentionPolicies');
    expect(parsed).toHaveProperty('issues');
    expect(parsed).not.toHaveProperty('categories');
    expect(parsed).not.toHaveProperty('processors');
  });

  it('turns explicit gaps into a strict-mode failure without changing normal mode', () => {
    expect(runGovernanceAuditCli([], io())).toBe(0);
    expect(runGovernanceAuditCli(['--strict'], io())).toBe(1);
  });

  it('returns 2 for unsupported arguments', () => {
    const output = io();
    expect(runGovernanceAuditCli(['--show-secrets'], output)).toBe(2);
    expect(output.stderr).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/data-governance/governance-audit-cli.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement deterministic CLI parsing and output**

In `governance-audit.ts`, export:

```ts
export interface GovernanceAuditIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export function runGovernanceAuditCli(
  args: readonly string[],
  io: GovernanceAuditIo,
): 0 | 1 | 2;
```

Accepted arguments are only no args, `--format=text`, `--format=json`, and optional `--strict`. Build the report with repository-root evidence verification and public-disclosure strictness enabled. JSON output is exactly `{ summary, issues }`; never serialize the registry bundle.

Text output prints all approved summary counts—registry totals, unknown/pending processors, manual capabilities, not-implemented capabilities, unknown retention policies, errors, and gaps—followed by one line per issue:

```text
[governance:<code>] <registry-id>: <message>
```

Normal mode returns 1 only for severity `error`. `--strict` also returns 1 when gaps exist. Parse or report-construction errors must be written to `stderr` and return 2; they must never fall back to a passing report. At module bottom, compare `import.meta.url` with `pathToFileURL(process.argv[1]).href`, execute only when they match, and set `process.exitCode` to the returned code.

- [ ] **Step 4: Add the root command**

Add to root `package.json`:

```json
"governance:audit": "pnpm --filter @holaday/orchestrator exec tsx scripts/governance-audit.ts"
```

- [ ] **Step 5: Run CLI tests and both real formats**

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/data-governance/governance-audit-cli.test.ts
pnpm governance:audit
pnpm governance:audit --format=json
pnpm governance:audit --strict
```

Expected: tests PASS; normal text and JSON commands return 0; strict mode returns 1 because explicit gaps exist; output contains 13 categories and gap IDs but no raw registry contents or sensitive values.

- [ ] **Step 6: Commit the CLI**

```bash
git add apps/orchestrator/scripts/governance-audit.ts \
  apps/orchestrator/src/data-governance/governance-audit-cli.test.ts \
  package.json
git commit -m "feat(governance): add read-only audit command"
```

---

### Task 7: Full Verification and Scope Guard

**Files:**
- Modify only if a verified correction is needed: files created in Tasks 1–6.
- Do not modify: database migrations, runtime routers, production configuration, privacy copy, or deployment scripts.

**Interfaces:**
- Consumes: complete registry and CLI.
- Produces: verified branch evidence ready for review.

- [ ] **Step 1: Run the complete governance test directory**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/data-governance
```

Expected: PASS.

- [ ] **Step 2: Run Orchestrator full tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
```

Expected: PASS. Do not classify pre-existing failures as caused by this branch without reproducing them on the base worktree.

- [ ] **Step 3: Run policy and ops regression gates**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/PrivacyPage.truth.test.tsx
node --test ops/aliyun-edge/legal-pages.test.mjs
pnpm test:ops
```

Expected: privacy truth contract, landing contract, 36 ops tests, and all shell gates PASS.

- [ ] **Step 4: Run formatting, diff, and forbidden-scope checks**

```bash
pnpm exec biome check \
  apps/orchestrator/src/data-governance \
  apps/orchestrator/scripts/governance-audit.ts \
  package.json
git diff --check codex/privacy-truth...HEAD
git diff --name-only codex/privacy-truth...HEAD
rg -n --glob '!*.test.ts' --glob '!audit.ts' -- \
  "-----BEGIN .*PRIVATE KEY-----|sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{12,}|Bearer [A-Za-z0-9._-]{12,}" \
  apps/orchestrator/src/data-governance \
  apps/orchestrator/scripts/governance-audit.ts
```

Expected: Biome and diff checks pass; forbidden-value search has no matches; changed-file list contains only the design, plan, Task 1–6 module/test/script files, and root `package.json`.

- [ ] **Step 5: Run the real audit and inspect only aggregate output**

```bash
pnpm governance:audit
pnpm governance:audit --format=json
```

Expected: both return 0; JSON top-level keys are exactly `summary` and `issues`; no registry objects or config values are printed.

- [ ] **Step 6: Commit any verification-only corrections**

If and only if Steps 1–5 required a code correction:

```bash
git add apps/orchestrator/src/data-governance \
  apps/orchestrator/scripts/governance-audit.ts \
  package.json
git commit -m "fix(governance): close registry verification gaps"
```

If no correction was needed, do not create an empty commit.

---

### Task 8: Push and Create the Stacked Review PR

**Files:**
- Read: `docs/superpowers/specs/2026-08-25-data-governance-registry-design.md`
- Read: `docs/superpowers/plans/2026-08-25-data-governance-registry.md`
- Read: final `git diff --stat codex/privacy-truth...HEAD`

**Interfaces:**
- Consumes: fully verified branch.
- Produces: reviewable stacked PR based on `codex/privacy-truth`; no merge or deployment.

- [ ] **Step 1: Confirm final branch state**

```bash
git status --short
git branch --show-current
git log --oneline codex/privacy-truth..HEAD
git diff --stat codex/privacy-truth...HEAD
```

Expected: clean worktree; branch `codex/data-governance-registry`; only planned commits and files.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin codex/data-governance-registry
```

- [ ] **Step 3: Create a PR with base `codex/privacy-truth`**

PR title:

```text
feat(governance): add machine-readable data registry
```

PR body must include:

- 13 registered data categories;
- implemented/manual/not-implemented/not-applicable distinctions;
- processor, retention, rights, source-evidence, public-disclosure, and CLI coverage;
- exact test counts and commands from Task 7;
- no database, migration, runtime API, production configuration, user-data access, merge, or deployment;
- explicit remaining gaps: comprehensive export, account-close orchestration, unified retention, pending-cookie legacy-column removal, policy/consent receipts, legal provider register;
- stacked-base note: this PR depends on PR #140 facts and must be retargeted/rebased after PR #140 can legally merge.

- [ ] **Step 4: Request review and stop at the release boundary**

Request code review for the latest head. Resolve only technically valid findings with tests. Do not merge or deploy: PR #140 remains blocked on legal operator identity/address, jurisdiction/dispute review, privacy mailbox ownership, and counsel sign-off.
