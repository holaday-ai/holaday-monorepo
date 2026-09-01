# HOLA DAY 能力中心功能闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 `/skills` 从技能开关列表升级为能够解释真实能力、展示示例并进入可编辑任务草稿的能力中心。

**Architecture:** 继续以 `packages/shared-types/src/skills.ts` 作为能力目录真相源，为每项能力增加统一体验元数据，并由现有 `skills.list` API 原样返回。Web 端把目录加载、套餐启用逻辑留在 `SkillsPage`，把可测试的选择规则与纯展示拆到独立状态模块和组件；所有“使用能力”动作仍经首页 `InputArea` 和现有 `tasks.create` 服务端校验。

**Tech Stack:** React 18、TypeScript 5.7、tRPC 11、Vitest 2、Testing Library、Happy DOM、Tailwind CSS、Lucide React。

**Spec:** `docs/superpowers/specs/2026-09-01-ability-center-functional-design.md`

## Global Constraints

- 本阶段完成真实功能闭环，不把当前视觉稿作为最终像素验收目标。
- 保留全部 13 项能力、启用/停用、套餐上限、加载/失败/空状态。
- 示例只作为可编辑任务草稿，不自动提交，不冒充真实执行结果。
- 连接器只表述为“执行时可能调用”，不得声称用户已经连接。
- 不修改套餐价格、任务计费、执行、验证或第三方授权流程。
- 保护主工作区未提交内容，所有代码只在 `codex/ability-center-functional` worktree 修改。
- 单智能体串行运行测试、类型检查、构建和浏览器验证，控制 16 GB 主机内存。

---

### Task 1: 扩展能力目录体验契约

**Files:**
- Modify: `packages/shared-types/src/skills.ts`
- Modify: `apps/orchestrator/src/trpc/routers/skills.ts`
- Test: `apps/orchestrator/src/trpc/routers/skills.test.ts`

**Interfaces:**
- Produces: `SkillExperience` and `HoladaySkill.experience`.
- Produces from API: `skills.list[*].experience` with `starterPrompts`, `requiredInputs`, `deliverables`, `boundary`, and `exampleSummary`.
- Consumes: existing `HOLADAY_SKILLS`, `SKILL_META`, and `buildSkillListRows()`.

- [x] **Step 1: Write the failing router contract test**

Add literal assertions to `skills.test.ts`:

```ts
expect(first.experience).toEqual({
  starterPrompts: [
    '复盘这场直播，找出流失点和下一场优化动作',
    '为这个产品写一份 60 秒直播讲解脚本',
    '规划未来 7 天的直播与短视频选题',
  ],
  requiredInputs: ['直播回放或数据截图', '产品与目标受众信息'],
  deliverables: ['复盘结论与问题清单', '下一轮脚本或运营计划'],
  boundary: '不会代替平台发布、投流或承诺销量；关键数据缺失时会标注待确认。',
  exampleSummary: '从直播数据和内容中提炼流失原因、有效话术与下一场行动。',
});
expect(buildSkillListRows([]).every((skill) => skill.experience.starterPrompts.length === 3)).toBe(true);
```

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/skills.test.ts
```

Expected: FAIL because `experience` is absent from skill rows.

- [x] **Step 3: Add the shared type and literal catalogue content**

Add to `skills.ts`:

```ts
export interface SkillExperience {
  starterPrompts: readonly [string, string, string];
  requiredInputs: readonly string[];
  deliverables: readonly string[];
  boundary: string;
  exampleSummary: string;
}

export interface HoladaySkill {
  // existing fields
  experience: SkillExperience;
}
```

Populate `experience` for all 13 catalogue entries with capability-specific literal content that stays inside each existing description and connector boundary.

- [x] **Step 4: Return the contract from the router**

Add the following field in `buildSkillListRows()`:

```ts
experience: {
  starterPrompts: [...skill.experience.starterPrompts],
  requiredInputs: [...skill.experience.requiredInputs],
  deliverables: [...skill.experience.deliverables],
  boundary: skill.experience.boundary,
  exampleSummary: skill.experience.exampleSummary,
},
```

- [x] **Step 5: Verify GREEN**

Run the focused router test and `pnpm --filter @holaday/shared-types typecheck`; expect both PASS.

- [x] **Step 6: Commit**

```bash
git add packages/shared-types/src/skills.ts apps/orchestrator/src/trpc/routers/skills.ts apps/orchestrator/src/trpc/routers/skills.test.ts
git commit -m "feat(skills): expose capability experience metadata"
```

### Task 2: 建立前端能力选择与任务草稿规则

**Files:**
- Modify: `apps/web-workbench/src/types/task.ts`
- Modify: `apps/web-workbench/src/lib/skills-page-state.ts`
- Test: `apps/web-workbench/src/lib/skills-page-state.test.ts`

**Interfaces:**
- Consumes: API `experience` rows from Task 1.
- Produces: `SkillStartDecision = 'start' | 'enable-and-start' | 'blocked'`.
- Produces: `skillStartDecision({ enabled, enabledCount, cap })`.
- Produces: `skillTaskDraft(skill, starterPrompt?)` with the selected sample appended after the `@技能名` mention.
- Produces: `skillConnectorLabel(connectorId)` and `pickCapabilityShowcase(skills)`.

- [x] **Step 1: Write failing normalization and start-decision tests**

Add tests with hand-derived expectations:

```ts
expect(skillStartDecision({ enabled: true, enabledCount: 5, cap: 5 })).toBe('start');
expect(skillStartDecision({ enabled: false, enabledCount: 4, cap: 5 })).toBe('enable-and-start');
expect(skillStartDecision({ enabled: false, enabledCount: 5, cap: 5 })).toBe('blocked');
expect(skillStartDecision({ enabled: false, enabledCount: 0, cap: 0 })).toBe('blocked');

expect(skillTaskDraft(skill, '分析这份周报并找出异常')).toEqual({
  skillId: 'data-report-insight',
  skillName: '数据报表解读',
  skillSource: 'manual',
  prompt: '@数据报表解读 分析这份周报并找出异常',
});
```

Extend the existing normalization fixture to assert a complete sanitized `experience`, and add a malformed fixture that receives safe empty arrays plus the boundary fallback `执行前请确认输入材料、授权范围和最终用途。`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/lib/skills-page-state.test.ts
```

Expected: FAIL because the new type, normalizer, decision helper, and sample-aware draft are absent.

- [x] **Step 3: Implement minimal pure state helpers**

Add `UiSkill.experience`, strict nested normalization, connector labels, and:

```ts
export function skillStartDecision(options: {
  enabled: boolean;
  enabledCount: number;
  cap: number;
}): SkillStartDecision {
  if (options.enabled) return 'start';
  if (options.cap <= 0 || options.enabledCount >= options.cap) return 'blocked';
  return 'enable-and-start';
}
```

`pickCapabilityShowcase()` selects `data-report-insight`, `social-media-strategy`, and `contract-risk-review` when present, then fills missing positions from remaining rows without duplicates.

- [x] **Step 4: Verify GREEN**

Run the focused state test and `pnpm --filter @holaday/web-workbench typecheck`; expect PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web-workbench/src/types/task.ts apps/web-workbench/src/lib/skills-page-state.ts apps/web-workbench/src/lib/skills-page-state.test.ts
git commit -m "feat(skills): model capability start flows"
```

### Task 3: 实现可交互的能力中心页面

**Files:**
- Create: `apps/web-workbench/src/components/skills/CapabilityCenterContent.tsx`
- Create: `apps/web-workbench/src/components/skills/CapabilityCenterContent.test.tsx`
- Modify: `apps/web-workbench/src/pages/SkillsPage.tsx`

**Interfaces:**
- Consumes: `UiSkill[]`, `pickCapabilityShowcase()`, `skillStartDecision()`, `skillTaskDraft()`, existing `SkillLogo`, `Button`, toast, `skills.toggle`, and React Router navigation.
- Produces: focused showcase, two secondary examples, selected capability details, searchable complete catalogue, and direct task-draft entry.
- `CapabilityCenterContent` callbacks:

```ts
onSelectSkill(skillId: string): void;
onStart(skill: UiSkill, prompt: string): void;
onToggle(skill: UiSkill): void;
```

- [x] **Step 1: Write failing real-component behavior tests**

Render `CapabilityCenterContent` with three real `UiSkill` fixtures and assert:

```ts
expect(screen.getByRole('heading', { name: '能力中心' })).toBeInTheDocument();
expect(screen.getByText('示例结果')).toBeInTheDocument();
expect(screen.getByText('你需要提供')).toBeInTheDocument();
expect(screen.getByText('会交付什么')).toBeInTheDocument();
expect(screen.getByText('执行时可能调用')).toBeInTheDocument();
expect(screen.getByText('边界说明')).toBeInTheDocument();
```

Use `userEvent` to click a starter prompt and assert `onStart` receives the selected real skill and the literal prompt. Click a secondary capability and assert `onSelectSkill` receives its id. Type into search and assert non-matching catalogue rows disappear while the active showcase remains stable.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/skills/CapabilityCenterContent.test.tsx
```

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement the presentational component**

Build the approved complete-content structure with semantic sections and existing Tailwind/Lucide primitives. Mark every static output preview with the visible label `示例结果`; use real text/table semantics rather than decorative placeholder art. Keep primary targets at least 44px and use `aria-pressed` for active capability selectors.

- [x] **Step 4: Replace the list-only page body and wire start behavior**

Keep current load, error, cap, optimistic toggle, and server reconciliation logic. Add a single async start path:

```ts
const decision = skillStartDecision({ enabled: skill.enabled, enabledCount, cap });
if (decision === 'blocked') {
  toast.show(skillLimitMessage({ cap, planId }), 'error');
  return;
}
if (decision === 'enable-and-start') {
  const enabled = await setSkillEnabled(skill, true);
  if (!enabled) return;
}
navigate('/', {
  state: { newTask: true, skillTaskDraft: skillTaskDraft(skill, prompt) },
});
```

Refactor the existing optimistic toggle into `setSkillEnabled(skill, desired)` so a failed enable never navigates and the server remains the source of truth.

- [x] **Step 5: Verify GREEN**

Run component tests, skills state tests, and `pnpm --filter @holaday/web-workbench typecheck`; expect PASS.

- [x] **Step 6: Commit**

```bash
git add apps/web-workbench/src/components/skills/CapabilityCenterContent.tsx apps/web-workbench/src/components/skills/CapabilityCenterContent.test.tsx apps/web-workbench/src/pages/SkillsPage.tsx
git commit -m "feat(skills): build functional capability center"
```

### Task 4: 完成质量门禁与本地体验验证

**Files:**
- Modify: touched files only when verification exposes a reproducible defect.
- Create: `docs/superpowers/reports/2026-09-01-ability-center-functional-verification.md`

**Interfaces:**
- Produces: reproducible test, build, browser, responsive, and scope evidence for the branch.

- [x] **Step 1: Run focused and full automated gates serially**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/skills.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/lib/skills-page-state.test.ts src/components/skills/CapabilityCenterContent.test.tsx
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench build
git diff --check
```

- [x] **Step 2: Verify the core flow in the selected browser**

Start the existing local app, open `/skills`, and verify at desktop and narrow viewport:

1. catalogue loads;
2. featured and secondary examples switch correctly;
3. details show input, output, connector wording, and boundary;
4. search filters the complete catalogue;
5. an enabled skill opens a populated editable composer draft;
6. a disabled skill enables before draft navigation when the plan allows it;
7. cap-blocked skills stay on the page with the accurate message;
8. browser console has no new errors.

- [x] **Step 3: Record evidence and fix only reproducible defects**

Write exact commands, pass counts, browser states, known non-blocking limitations, and untouched sensitive areas to the verification report. Any defect found must first receive a failing regression test before implementation.

- [x] **Step 4: Final commit**

```bash
git add docs/superpowers/specs/2026-09-01-ability-center-functional-design.md docs/superpowers/plans/2026-09-01-ability-center-functional.md docs/superpowers/reports/2026-09-01-ability-center-functional-verification.md
git commit -m "docs(skills): record capability center verification"
```
