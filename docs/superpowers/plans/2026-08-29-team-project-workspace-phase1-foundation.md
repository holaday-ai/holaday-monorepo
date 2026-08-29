# Holaday Team Project Workspace Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有个人项目与任务归组的前提下，建立组织、成员层级、邀请、项目成员和团队项目空间的最小可上线基础。

**Architecture:** 继续使用 Orchestrator 单体，但按组织域拆出 schema、访问控制、服务和 tRPC router。`projects.organization_id IS NULL` 保持个人项目；非空时必须同时通过有效组织成员和项目成员鉴权。团队入口受服务端单一灰度 helper 控制，默认关闭且只对白名单用户开放；每个组织另有可关闭的 `team_projects_enabled` 开关，形成全局 kill switch、用户 canary 和组织开关三层门禁。前端以 `auth.me.teamProjectsEnabled` 使用同一用户门禁结论。邀请只生成一次性可复制链接，不发送邮件或短信，数据库只存 SHA-256 token hash。

**Tech Stack:** TypeScript、Node.js、tRPC、Drizzle ORM、MySQL 8、React 18、React Router、Tailwind CSS、Vitest、pnpm。

**Spec:** `docs/superpowers/specs/2026-08-29-team-project-workspace-design.md`

## Global Constraints

- 本阶段不实现团队任务状态机、验收合约、仲裁、奖励账本、充值、提现或组织报告。
- 不修改 `apps/orchestrator/src/db/schema/partner.ts`、`apps/orchestrator/src/partner/**`、`apps/cn-payment/**` 或现有通用积分/额度表。
- 不自动迁移个人项目；旧 `projects.user_id` 继续代表个人项目所有者或团队项目创建者。
- 所有团队资源查询必须先验证当前用户的 active 组织成员身份，再验证项目成员身份和操作权限。
- 对无权访问的组织和项目统一返回 `NOT_FOUND`，避免泄露资源是否存在；只有已鉴权资源的角色不足才返回 `FORBIDDEN`。
- 邀请原文只返回一次；持久层和日志不得保存或输出原始 token。
- 直属上级只能指向同组织 active 的 `owner/admin/manager`，不能指向自己；同一成员默认仅一位直属上级。
- 组织 owner 不能被普通成员移除或降级；最后一位 owner 不能离开。
- 团队项目全局开关默认关闭；组织开关可独立关闭。任一关闭时新增团队 API 返回 `NOT_FOUND`，个人项目 API 行为不变。
- 使用测试账户和合成组织数据做 QA，不使用真实员工个人数据。

---

## Target File Map

**Shared IDs**

- Modify: `packages/shared-types/src/ids.ts`
- Create: `apps/orchestrator/src/organizations/team-workspace-ids.test.ts`

**Database and migration**

- Create: `apps/orchestrator/src/db/schema/organizations.ts`
- Create: `apps/orchestrator/src/db/schema/organization-members.ts`
- Create: `apps/orchestrator/src/db/schema/organization-invitations.ts`
- Create: `apps/orchestrator/src/db/schema/project-members.ts`
- Modify: `apps/orchestrator/src/db/schema/projects.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Create: `apps/orchestrator/drizzle/0051_team_project_foundation.sql`
- Modify: `apps/orchestrator/scripts/verify-db-schema.ts`
- Test: `apps/orchestrator/scripts/release-db-contract.test.mjs`

**Feature gate and domain services**

- Modify: `apps/orchestrator/src/config/env.ts`
- Create: `apps/orchestrator/src/organizations/team-project-access.ts`
- Test: `apps/orchestrator/src/organizations/team-project-access.test.ts`
- Create: `apps/orchestrator/src/organizations/organization-permissions.ts`
- Test: `apps/orchestrator/src/organizations/organization-permissions.test.ts`
- Create: `apps/orchestrator/src/organizations/organization-service.ts`
- Test: `apps/orchestrator/src/organizations/organization-service.test.ts`
- Create: `apps/orchestrator/src/organizations/organization-invitation-service.ts`
- Test: `apps/orchestrator/src/organizations/organization-invitation-service.test.ts`
- Create: `apps/orchestrator/src/projects/project-access.ts`
- Test: `apps/orchestrator/src/projects/project-access.test.ts`

**tRPC and auth surface**

- Create: `apps/orchestrator/src/trpc/routers/organizations.ts`
- Test: `apps/orchestrator/src/trpc/routers/organizations.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/projects.ts`
- Create: `apps/orchestrator/src/trpc/routers/projects.team.test.ts`
- Modify: `apps/orchestrator/src/trpc/router.ts`
- Modify: `apps/orchestrator/src/trpc/routers/auth.ts`
- Modify: `apps/orchestrator/src/trpc/routers/auth.test.ts`

**Web workbench**

- Modify: `apps/web-workbench/src/lib/auth-me-state.ts`
- Modify: `apps/web-workbench/src/lib/auth-me-state.test.ts`
- Modify: `apps/web-workbench/src/types/task.ts`
- Modify: `apps/web-workbench/src/lib/project-page-state.ts`
- Modify: `apps/web-workbench/src/lib/project-page-state.test.ts`
- Create: `apps/web-workbench/src/lib/organization-page-state.ts`
- Test: `apps/web-workbench/src/lib/organization-page-state.test.ts`
- Create: `apps/web-workbench/src/components/projects/WorkspaceSwitcher.tsx`
- Create: `apps/web-workbench/src/components/projects/OrganizationMembersPanel.tsx`
- Create: `apps/web-workbench/src/components/projects/OrganizationInviteDialog.tsx`
- Modify: `apps/web-workbench/src/pages/ProjectsPage.tsx`
- Test: `apps/web-workbench/src/pages/ProjectsPage.test.tsx`
- Create: `apps/web-workbench/src/pages/TeamProjectPage.tsx`
- Test: `apps/web-workbench/src/pages/TeamProjectPage.test.tsx`
- Modify: `apps/web-workbench/src/App.tsx`
- Modify: `apps/web-workbench/src/components/AppShell.tsx`

**Release and QA**

- Create: `apps/web-workbench/qa-team-projects.html`
- Create: `docs/qa/team-projects-phase1-checklist.md`

---

## Task 1: Add Organization External ID Kinds

**Files:**

- Modify: `packages/shared-types/src/ids.ts`
- Create: `apps/orchestrator/src/organizations/team-workspace-ids.test.ts`

- [ ] Add failing ID-prefix tests for `organization`, `organizationMember`, `organizationInvitation`, and `projectMember`.

```ts
expect(isExternalId(newExternalId('organization'), 'organization')).toBe(true);
expect(isExternalId(newExternalId('organizationMember'), 'organizationMember')).toBe(true);
expect(isExternalId(newExternalId('organizationInvitation'), 'organizationInvitation')).toBe(true);
expect(isExternalId(newExternalId('projectMember'), 'projectMember')).toBe(true);
```

- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/organizations/team-workspace-ids.test.ts` and confirm TypeScript/test failure because the four kinds do not exist.
- [ ] Add collision-free prefixes to `ID_PREFIXES`: `organization: 'org'`, `organizationMember: 'omem'`, `organizationInvitation: 'oinv'`, `projectMember: 'pmem'`.
- [ ] Re-run `pnpm --filter @holaday/orchestrator exec vitest run src/organizations/team-workspace-ids.test.ts`; expect all ID tests to pass.
- [ ] Commit: `git add packages/shared-types/src/ids.ts apps/orchestrator/src/organizations/team-workspace-ids.test.ts && git commit -m "feat(shared-types): add team workspace ids"`

## Task 2: Define Additive Team Workspace Schema

**Files:**

- Create: `apps/orchestrator/src/db/schema/organizations.ts`
- Create: `apps/orchestrator/src/db/schema/organization-members.ts`
- Create: `apps/orchestrator/src/db/schema/organization-invitations.ts`
- Create: `apps/orchestrator/src/db/schema/project-members.ts`
- Modify: `apps/orchestrator/src/db/schema/projects.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Create: `apps/orchestrator/drizzle/0051_team_project_foundation.sql`
- Modify: `apps/orchestrator/scripts/verify-db-schema.ts`

- [ ] Add a failing schema contract assertion in `release-db-contract.test.mjs` that migration `0051_team_project_foundation.sql` exists once and contains the four new tables plus nullable `projects.organization_id`.
- [ ] Run `node --test apps/orchestrator/scripts/release-db-contract.test.mjs`; expect failure because migration 0051 is absent.
- [ ] Define `organizations` with `externalId`, `name`, `ownerUserId`, `status`, `teamProjectsEnabled` default false, timestamps and indexes on external ID, owner and status.
- [ ] Define `organizationMembers` with `externalId`, `organizationId`, `userId`, `role`, nullable `managerUserId`, `status`, `joinedAt`, timestamps; add unique `(organizationId, userId)` and lookup indexes.
- [ ] Define `organizationInvitations` with `externalId`, `organizationId`, `tokenHash` (64-char SHA-256 hex), `role`, nullable `managerUserId`, `invitedByUserId`, `expiresAt`, `acceptedAt`, `revokedAt`, timestamps; unique token hash and active lookup indexes.
- [ ] Define `projectMembers` with `externalId`, `projectId`, `userId`, `role`, `status`, timestamps; unique `(projectId, userId)` and user/project lookup indexes.
- [ ] Extend `projects` with nullable `organizationId` using `ON DELETE RESTRICT`; retain non-null `userId` and all existing indexes.
- [ ] Export all four schemas from `schema/index.ts`.
- [ ] Write additive migration 0051 in dependency order: organizations → organization_members → organization_invitations → projects.organization_id → project_members.
- [ ] Do not backfill `organization_id`; existing rows remain personal projects.
- [ ] Add required tables, columns and critical indexes to `verify-db-schema.ts`.
- [ ] Re-run `node --test apps/orchestrator/scripts/release-db-contract.test.mjs`; expect pass.
- [ ] Run `pnpm --filter @holaday/orchestrator typecheck`; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/db/schema apps/orchestrator/drizzle/0051_team_project_foundation.sql apps/orchestrator/scripts/verify-db-schema.ts apps/orchestrator/scripts/release-db-contract.test.mjs && git commit -m "feat(orchestrator): add team workspace schema"`

## Task 3: Add a Default-off Team Workspace Gate

**Files:**

- Modify: `apps/orchestrator/src/config/env.ts`
- Create: `apps/orchestrator/src/organizations/team-project-access.ts`
- Test: `apps/orchestrator/src/organizations/team-project-access.test.ts`

- [ ] Write failing pure-gate tests for flag off, allowlisted user, non-allowlisted user, and enabled with empty allowlist.

```ts
expect(computeTeamProjectsEnabled(false, new Set(['usr_a']), 'usr_a')).toBe(false);
expect(computeTeamProjectsEnabled(true, new Set(['usr_a']), 'usr_a')).toBe(true);
expect(computeTeamProjectsEnabled(true, new Set(['usr_a']), 'usr_b')).toBe(false);
expect(computeTeamProjectsEnabled(true, new Set(), 'usr_b')).toBe(true);
```

- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/organizations/team-project-access.test.ts`; expect module-not-found failure.
- [ ] Add `TEAM_PROJECTS_ENABLED` boolean defaulting to false and `TEAM_PROJECTS_ALLOWLIST` CSV defaulting to empty in `config/env.ts`.
- [ ] Implement `computeTeamProjectsEnabled` and `isTeamProjectsEnabledFor` using the same shape as `agent/video/video-access.ts`.
- [ ] Ensure API routers and `auth.me` import the same helper; do not duplicate flag parsing in routers.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/config/env.ts apps/orchestrator/src/organizations/team-project-access.ts apps/orchestrator/src/organizations/team-project-access.test.ts && git commit -m "feat(orchestrator): gate team workspace rollout"`

## Task 4: Implement Pure Permission Rules

**Files:**

- Create: `apps/orchestrator/src/organizations/organization-permissions.ts`
- Test: `apps/orchestrator/src/organizations/organization-permissions.test.ts`

- [ ] Write a table-driven failing permission matrix for `owner`, `admin`, `manager`, `member` and project roles `lead`, `member`, `viewer`.
- [ ] Cover create project, invite member, edit reporting line, rename team project, remove project member and delete team project.
- [ ] Add negative tests: inactive member, self-manager, manager target outside organization, member inviting owner/admin, viewer mutating project, and removal/demotion of the last owner.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/organizations/organization-permissions.test.ts`; expect failure because helpers do not exist.
- [ ] Implement narrow pure functions returning `{ allowed: true } | { allowed: false; reason: PermissionReason }`.
- [ ] Keep role strings as exported const arrays and inferred union types; reuse the same arrays in zod inputs.
- [ ] Re-run the focused test; expect all matrix cases pass.
- [ ] Commit: `git add apps/orchestrator/src/organizations/organization-permissions.ts apps/orchestrator/src/organizations/organization-permissions.test.ts && git commit -m "feat(orchestrator): define organization permissions"`

## Task 5: Implement Organization Creation and Membership Service

**Files:**

- Create: `apps/orchestrator/src/organizations/organization-service.ts`
- Test: `apps/orchestrator/src/organizations/organization-service.test.ts`

- [ ] Build a minimal fake Drizzle context following `trpc/routers/watchlists.test.ts`, recording transactions, inserts and updates.
- [ ] Write failing tests that organization creation inserts organization and owner membership in one transaction.
- [ ] Write failing tests that listing returns only active memberships, with role, manager display name and active member count.
- [ ] Write failing tests for updating a reporting line: manager must be active in the same organization, must have owner/admin/manager role, and cannot be the target user.
- [ ] Write failing tests for deactivating a member: project memberships become inactive in the same transaction, but audit rows are not deleted.
- [ ] Write failing tests that the last owner cannot be deactivated or demoted.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/organizations/organization-service.test.ts`; expect failure.
- [ ] Implement `createOrganization`, `listOrganizationsForUser`, `listOrganizationMembers`, `updateReportingLine`, `updateMemberRole`, and `deactivateMember`; a canary-created organization starts with `teamProjectsEnabled=true`, while the stored organization switch remains independently disableable for rollback.
- [ ] Resolve caller external ID to internal ID once per service call; never trust a client-provided user ID as actor identity.
- [ ] Use DB transactions for create and deactivation operations.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/organizations/organization-service.ts apps/orchestrator/src/organizations/organization-service.test.ts && git commit -m "feat(orchestrator): add organization membership service"`

## Task 6: Implement One-time Invitation Links

**Files:**

- Create: `apps/orchestrator/src/organizations/organization-invitation-service.ts`
- Test: `apps/orchestrator/src/organizations/organization-invitation-service.test.ts`

- [ ] Write failing tests for a 32-byte URL-safe random token whose SHA-256 hex hash is persisted while plaintext is returned exactly once.
- [ ] Write failing tests for default 7-day expiry, revoked token, expired token, already accepted token and token replay.
- [ ] Write failing tests that acceptance creates or reactivates exactly one organization membership and marks the invitation accepted in one transaction.
- [ ] Write failing tests that role and manager come from the invitation row, not from accept-request input.
- [ ] Write failing tests that owner invitations are rejected; only owner/admin may invite admin, and owner/admin/manager may invite manager/member according to the permission matrix.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/organizations/organization-invitation-service.test.ts`; expect failure.
- [ ] Implement `createInvitation`, `acceptInvitation`, and `revokeInvitation`; hash tokens using `node:crypto` and compare only hashes.
- [ ] Never log plaintext token, token hash, invitee email/phone or raw request input.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/organizations/organization-invitation-service.ts apps/orchestrator/src/organizations/organization-invitation-service.test.ts && git commit -m "feat(orchestrator): add organization invite links"`

## Task 7: Add Tenant-safe Project Access

**Files:**

- Create: `apps/orchestrator/src/projects/project-access.ts`
- Test: `apps/orchestrator/src/projects/project-access.test.ts`

- [ ] Write failing tests for personal project owner access and rejection of every other user.
- [ ] Write failing tests for team projects requiring both active organization membership and active project membership.
- [ ] Write failing tests for cross-organization ID substitution, inactive member, inactive project member, viewer mutation and project lead mutation.
- [ ] Define access outputs containing the internal project ID, scope, caller organization role and caller project role; callers must not re-query roles independently.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/projects/project-access.test.ts`; expect failure.
- [ ] Implement `requireReadableProject` and `requireMutableProject` with `NOT_FOUND` for hidden resources and `FORBIDDEN` only after membership is established.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/projects/project-access.ts apps/orchestrator/src/projects/project-access.test.ts && git commit -m "feat(orchestrator): enforce team project tenancy"`

## Task 8: Expose Organizations Through tRPC

**Files:**

- Create: `apps/orchestrator/src/trpc/routers/organizations.ts`
- Test: `apps/orchestrator/src/trpc/routers/organizations.test.ts`
- Modify: `apps/orchestrator/src/trpc/router.ts`

- [ ] Write failing createCaller tests for `list`, `create`, `members`, `createInvitation`, `acceptInvitation`, `revokeInvitation`, `updateReportingLine`, `updateMemberRole`, and `deactivateMember`.
- [ ] Verify all procedures fail closed when the global/user gate is off; organization-scoped procedures additionally require `organizations.team_projects_enabled=true`, including `acceptInvitation`, so links cannot bypass rollout or an organization rollback.
- [ ] Verify `create` trims name and rejects blank/over-100-character names.
- [ ] Verify invite response contains `inviteUrl` once and never returns `tokenHash`.
- [ ] Verify list/member DTOs expose only external IDs, display name/avatar needed for collaboration, role, manager reference and status; do not expose email, phone, auth role or credentials.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/organizations.test.ts`; expect failure.
- [ ] Implement router procedures as thin validation/adaptation layers calling domain services.
- [ ] Register `organizations: organizationsRouter` in `trpc/router.ts`.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/trpc/routers/organizations.ts apps/orchestrator/src/trpc/routers/organizations.test.ts apps/orchestrator/src/trpc/router.ts && git commit -m "feat(orchestrator): expose organization workspace api"`

## Task 9: Extend Projects Router Without Breaking Personal Projects

**Files:**

- Modify: `apps/orchestrator/src/trpc/routers/projects.ts`
- Create: `apps/orchestrator/src/trpc/routers/projects.team.test.ts`

- [ ] Add regression tests locking current no-input `projects.list()` output and personal `create/rename/delete` behavior.
- [ ] Add failing tests for optional `organizationId` list/create input plus team `get`, returning `scope`, `organizationId`, `organizationName`, `memberRole` and task count.
- [ ] Add failing tests that a team project creator becomes `lead` in `project_members` in the same transaction.
- [ ] Add failing tests for member listing/addition/removal, with the target required to be an active organization member.
- [ ] Add failing tests for rename/delete using `project-access.ts`, including cross-tenant and viewer denial.
- [ ] Add a team-project delete test confirming task rows are preserved and `project_id` becomes null through the existing FK.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/projects.team.test.ts`; expect failure.
- [ ] Refactor only shared `requireUserId` lookup as needed; preserve no-input personal fast path and DTO compatibility.
- [ ] Implement team list/create and project member procedures behind the rollout gate.
- [ ] Re-run focused team tests and the full orchestrator test suite.
- [ ] Expected: `pnpm --filter @holaday/orchestrator test` exits 0.
- [ ] Commit: `git add apps/orchestrator/src/trpc/routers/projects.ts apps/orchestrator/src/trpc/routers/projects.team.test.ts && git commit -m "feat(orchestrator): support tenant-safe team projects"`

## Task 10: Publish the Single Gate Result Through auth.me

**Files:**

- Modify: `apps/orchestrator/src/trpc/routers/auth.ts`
- Modify: `apps/orchestrator/src/trpc/routers/auth.test.ts`
- Modify: `apps/web-workbench/src/lib/auth-me-state.ts`
- Modify: `apps/web-workbench/src/lib/auth-me-state.test.ts`

- [ ] Add failing backend tests that `auth.me.teamProjectsEnabled` mirrors `isTeamProjectsEnabledFor(ctx.userId)`.
- [ ] Add failing frontend normalization tests that absent/invalid values default false and literal true remains true.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/auth.test.ts` and `pnpm --filter @holaday/web-workbench exec vitest run src/lib/auth-me-state.test.ts`; expect failures for the missing field.
- [ ] Add the backend field and frontend normalized field without changing existing auth response values.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit: `git add apps/orchestrator/src/trpc/routers/auth.ts apps/orchestrator/src/trpc/routers/auth.test.ts apps/web-workbench/src/lib/auth-me-state.ts apps/web-workbench/src/lib/auth-me-state.test.ts && git commit -m "feat(auth): expose team workspace rollout state"`

## Task 11: Normalize Personal and Team Workspace DTOs

**Files:**

- Modify: `apps/web-workbench/src/types/task.ts`
- Modify: `apps/web-workbench/src/lib/project-page-state.ts`
- Modify: `apps/web-workbench/src/lib/project-page-state.test.ts`
- Create: `apps/web-workbench/src/lib/organization-page-state.ts`
- Test: `apps/web-workbench/src/lib/organization-page-state.test.ts`

- [ ] Extend `UiProject` with `scope: 'personal' | 'organization'`, nullable organization fields and nullable `memberRole`.
- [ ] First add failing regression tests showing old project payloads normalize to `scope: 'personal'` with null team fields.
- [ ] Add failing tests for strict team row normalization and rejection of a team row missing organization ID.
- [ ] Add organization state tests for safe names, roles, member counts, selected workspace, invite-link state and member action visibility.
- [ ] Run `pnpm --filter @holaday/web-workbench exec vitest run src/lib/project-page-state.test.ts src/lib/organization-page-state.test.ts`; expect failure.
- [ ] Implement tolerant legacy normalization and strict team normalization; keep raw API objects out of React state.
- [ ] Re-run focused tests; expect pass.
- [ ] Commit: `git add apps/web-workbench/src/types/task.ts apps/web-workbench/src/lib/project-page-state.ts apps/web-workbench/src/lib/project-page-state.test.ts apps/web-workbench/src/lib/organization-page-state.ts apps/web-workbench/src/lib/organization-page-state.test.ts && git commit -m "feat(web): model personal and team workspaces"`

## Task 12: Build the Team Project Space Shell

**Files:**

- Create: `apps/web-workbench/src/components/projects/WorkspaceSwitcher.tsx`
- Create: `apps/web-workbench/src/components/projects/OrganizationMembersPanel.tsx`
- Create: `apps/web-workbench/src/components/projects/OrganizationInviteDialog.tsx`
- Modify: `apps/web-workbench/src/pages/ProjectsPage.tsx`
- Test: `apps/web-workbench/src/pages/ProjectsPage.test.tsx`
- Create: `apps/web-workbench/src/pages/TeamProjectPage.tsx`
- Test: `apps/web-workbench/src/pages/TeamProjectPage.test.tsx`
- Modify: `apps/web-workbench/src/App.tsx`

- [ ] Write component tests for gate off: page description, personal project creation and old project cards remain unchanged; no organization controls render.
- [ ] Write gate-on tests for workspace switcher, personal/team sections, create organization, create team project and invitation link copy.
- [ ] Write role tests: member cannot invite or remove, manager sees permitted member actions, admin/owner see role and reporting-line controls, viewer cannot mutate a team project.
- [ ] Write team-project detail tests for `/projects/:projectId`: readable overview, member roster, current role, honest Phase 1 task status, forbidden mutation controls, missing project and stale-load states.
- [ ] Write empty/loading/stale/error tests separately for personal projects, organizations, members and selected team projects.
- [ ] Run `pnpm --filter @holaday/web-workbench exec vitest run src/pages/ProjectsPage.test.tsx`; expect failure.
- [ ] Implement a calm Holaday project shell: workspace switcher at top, selected workspace summary, project grid as primary content, member panel as secondary content; no finance/reward/report tabs in Phase 1.
- [ ] Add `/projects/:projectId` in `App.tsx`; `TeamProjectPage` uses `projects.get` and project-member data, shows overview and members, and labels team-task execution as not yet enabled instead of routing to the personal task filter.
- [ ] Use existing `PageContainer`, `PageHeader`, dialog, dropdown, toast, typography and spacing tokens; do not introduce a parallel design system.
- [ ] Show invite link only after successful creation with “复制邀请链接” and expiry; closing the dialog clears plaintext token from component state.
- [ ] Preserve the current delete explanation that tasks return to the default list.
- [ ] Re-run `pnpm --filter @holaday/web-workbench exec vitest run src/pages/ProjectsPage.test.tsx src/pages/TeamProjectPage.test.tsx`; expect pass.
- [ ] Commit: `git add apps/web-workbench/src/components/projects apps/web-workbench/src/pages/ProjectsPage.tsx apps/web-workbench/src/pages/ProjectsPage.test.tsx apps/web-workbench/src/pages/TeamProjectPage.tsx apps/web-workbench/src/pages/TeamProjectPage.test.tsx apps/web-workbench/src/App.tsx && git commit -m "feat(web): add team project workspace shell"`

## Task 13: Keep the Global Sidebar on the Personal Compatibility Path

**Files:**

- Modify: `apps/web-workbench/src/components/AppShell.tsx`
- Modify: `apps/web-workbench/src/lib/project-page-state.test.ts`

- [ ] Add a regression test or extracted-helper test proving AppShell's startup `projects.list.query()` continues to request the no-input personal list.
- [ ] Add a test that project-page team refresh does not overwrite the AppShell personal-project collection used by move-to-project and sidebar filters.
- [ ] Make only the minimal AppShell changes needed to pass `teamProjectsEnabled` into the project page context; do not add team projects to the global task move menu in Phase 1.
- [ ] Run `pnpm --filter @holaday/web-workbench test`; expect pass.
- [ ] Run `pnpm --filter @holaday/web-workbench typecheck`; expect pass.
- [ ] Commit: `git add apps/web-workbench/src/components/AppShell.tsx apps/web-workbench/src/lib/project-page-state.test.ts && git commit -m "fix(web): preserve personal project sidebar behavior"`

## Task 14: Verify Migration, Packages and Static Quality

**Files:**

- Modify only if a verification defect is found in files already listed above.

- [ ] Run `pnpm --filter @holaday/orchestrator test`; expect exit 0.
- [ ] Run `pnpm --filter @holaday/orchestrator typecheck`; expect exit 0.
- [ ] Run `pnpm --filter @holaday/orchestrator build`; expect exit 0.
- [ ] Run `pnpm --filter @holaday/web-workbench test`; expect exit 0.
- [ ] Run `pnpm --filter @holaday/web-workbench typecheck`; expect exit 0.
- [ ] Run `pnpm --filter @holaday/web-workbench build`; expect exit 0.
- [ ] Run `pnpm --filter @holaday/orchestrator db:verify` against the isolated test database after applying 0051; expect all required tables/columns/indexes present.
- [ ] Run `pnpm lint` only after targeted lint/build gates; if repository-wide pre-existing Biome issues remain, record exact untouched paths and run targeted Biome/ESLint on every changed file.
- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Review `git status --short` and confirm unrelated `.claude/`, `qa-artifacts/`, `skills/*`, dream export and design drafts remain untouched.
- [ ] Commit any verification-only corrections with a scoped message; do not fold unrelated cleanup into this feature.

## Task 15: Add Manual QA Evidence and Accessibility Checks

**Files:**

- Create: `apps/web-workbench/qa-team-projects.html`
- Create: `docs/qa/team-projects-phase1-checklist.md`

- [ ] Build a deterministic QA fixture covering personal-only, owner, manager, member, viewer, empty organization, populated organization, expired invitation and load-error states.
- [ ] Record desktop widths 1440 and 1024 plus mobile width 390; verify no clipped controls, horizontal overflow or hidden role actions.
- [ ] Verify keyboard order, visible focus, dialog focus trap, Escape behavior, copy feedback, accessible names, and 44px mobile action targets.
- [ ] Verify invite plaintext disappears after dialog close/reload and never appears in console/network error output.
- [ ] Verify visual hierarchy: project work stays primary; member administration does not dominate the page; disabled future task/reward/report features are not rendered as misleading live controls.
- [ ] Save screenshots/evidence under the existing QA convention without committing sensitive tokens or user data.
- [ ] Commit: `git add apps/web-workbench/qa-team-projects.html docs/qa/team-projects-phase1-checklist.md && git commit -m "test(web): document team workspace qa"`

## Task 16: PR, Review, Deployment and Production Canary

**Files:**

- No source changes unless review identifies a reproducible defect; fixes require a failing test first.

- [ ] Rebase the isolated feature branch on the intended base and rerun Task 14 gates.
- [ ] Create a PR summarizing schema compatibility, tenant permission matrix, feature gate, invitation privacy, tests, migration and rollback.
- [ ] Request code review focused on cross-tenant access, last-owner safety, token leakage, legacy project compatibility and migration replay.
- [ ] For every valid review finding: reproduce, add failing test, fix, rerun focused and affected package gates, reply with evidence, resolve thread.
- [ ] Merge only when checks pass and no unresolved tenant/security review remains.
- [ ] Before deployment, capture `/api/healthz`, current application revision, orchestrator process health, database migration level and `TEAM_PROJECTS_ENABLED=false` baseline.
- [ ] Apply migration 0051 before enabling the feature; verify schema; deploy application with feature still disabled.
- [ ] Verify production personal projects: list, create, rename, move a task, delete project, task preservation.
- [ ] Enable `TEAM_PROJECTS_ENABLED=true` with `TEAM_PROJECTS_ALLOWLIST` containing only the synthetic test accounts; ensure only the synthetic organization has `team_projects_enabled=true`, restart Orchestrator and verify health.
- [ ] With synthetic accounts, verify create organization, copy invite, accept once, reject replay, set manager, create team project, project membership and unauthorized cross-tenant denial.
- [ ] Verify a non-allowlisted account sees old UI and receives no team API surface.
- [ ] Remove/close synthetic invitation plaintext from browser state; do not store it in QA documents or logs.
- [ ] If any canary fails, set `TEAM_PROJECTS_ENABLED=false`, restart Orchestrator, verify old personal project path, and file a forward-fix PR; do not roll back or delete additive tables.
- [ ] Keep the feature on the single-account allowlist until tenant isolation, error logs and legacy project behavior are stable across the agreed observation window.

## Completion Evidence

Phase 1 is complete only when the final handoff contains:

- PR number, merge commit, deployed application revision and migration 0051 status.
- Exact test/typecheck/build results and any known repository-wide lint limitation.
- Production health before/after, whitelist scope and old personal-project regression result.
- Positive team flow plus negative cross-tenant, expired/replayed invite and inactive-member results.
- Confirmation that no reward, payment, Partner Ledger, withdrawal, `cn-payment`, DivineAPI or OpenAI-key code/config changed.
- Remaining Stage 2 work linked back to the roadmap; no claim that task acceptance, arbitration or cash rewards are already available.
