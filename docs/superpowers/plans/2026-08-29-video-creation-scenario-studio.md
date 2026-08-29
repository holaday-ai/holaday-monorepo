# 视频创作场景工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已选方案 3 落地为不破坏现有视频生成链路的场景化视频创作工作台。

**Architecture:** 新增纯数据场景模型和可复用场景选择器，把四个用户目标映射到现有 `normal/pet/ip` 三条链路。普通视频将提示词、素材和主行动提升到两列工作台，技术设置收进可展开面板；复刻和 IP 表单保持后端契约与授权边界，仅统一入口和视觉层级。

**Tech Stack:** React 18、TypeScript、Tailwind CSS、Vitest、Testing Library、Vite。

**Spec:** `docs/superpowers/specs/2026-08-29-video-creation-scenario-studio.md`

## Global Constraints

- 保留普通视频、复刻视频、IP 人物视频现有提交、报价、授权、历史与结果链路。
- “继续剪辑”在商业许可未就绪时仅显示“即将开放”。
- 使用真实位图素材和现有图标库，不使用占位图、CSS 绘画或手写 SVG。
- 主工作区用户未提交内容不得修改。

---

### Task 1: 场景模型与选择器

**Files:**
- Create: `apps/web-workbench/src/components/video/video-creation-scenarios.ts`
- Create: `apps/web-workbench/src/components/video/video-creation-scenarios.test.ts`
- Create: `apps/web-workbench/src/components/video/VideoCreationScenarioPicker.tsx`
- Create: `apps/web-workbench/src/components/video/VideoCreationScenarioPicker.test.tsx`

**Interfaces:**
- Produces: `VideoCreationScenarioId`, `VIDEO_CREATION_SCENARIOS`, `videoTabForScenario(id)`, `scenarioForVideoTab(tab, preferredNormal?)`。
- Produces: `<VideoCreationScenarioPicker value onChange disabled />`。

- [ ] **Step 1: Write the failing tests**

```ts
expect(videoTabForScenario('product_highlight')).toBe('normal');
expect(videoTabForScenario('action_remake')).toBe('pet');
expect(videoTabForScenario('ip_presenter')).toBe('ip');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/video/video-creation-scenarios.test.ts src/components/video/VideoCreationScenarioPicker.test.tsx`
Expected: FAIL because the scene model and picker do not exist.

- [ ] **Step 3: Implement the minimal scene model and accessible picker**

Create immutable scenario definitions with title, description, duration, aspect, image path, default prompt, video tab and storyboard beats. Render them as image-backed buttons with `aria-pressed` and a visible selected state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/video/video-creation-scenarios.test.ts src/components/video/VideoCreationScenarioPicker.test.tsx`
Expected: PASS.

### Task 2: 场景化普通视频工作台

**Files:**
- Create: `apps/web-workbench/src/components/video/VideoCreationStoryboard.tsx`
- Create: `apps/web-workbench/src/components/video/VideoCreationStoryboard.test.tsx`
- Modify: `apps/web-workbench/src/pages/VideoPage.tsx`
- Modify: `apps/web-workbench/src/pages/video-page-style-state.test.ts`

**Interfaces:**
- Consumes: `VIDEO_CREATION_SCENARIOS` and `VideoCreationScenarioId` from Task 1.
- Produces: `VideoCreationStoryboard` and scenario-aware `/video` composition without changing `VideoCreationOptions` contracts.

- [ ] **Step 1: Write failing tests for storyboard copy and source structure**

```ts
expect(screen.getByRole('heading', { name: '这次想完成哪种视频？' })).toBeTruthy();
expect(screen.getByRole('button', { name: /生成设置/ })).toBeTruthy();
expect(source).toContain('继续剪辑');
expect(source).toContain('即将开放');
```

- [ ] **Step 2: Run tests to verify they fail for the missing workbench**

Run the new component test and `video-page-style-state.test.ts`; expected failure is missing scene workbench copy/structure.

- [ ] **Step 3: Implement the two-column workbench**

Move the normal-video prompt, attachments and submit CTA into the right column; render scenario storyboard on the left. Put model/style/duration/aspect/resolution controls in an expandable generation-settings panel and preserve the current submit handler unchanged.

- [ ] **Step 4: Verify normal, clone and IP behavior**

Run targeted page, video type, IP estimate and history tests; expected all PASS.

### Task 3: Production image assets and compact history

**Files:**
- Create: `apps/web-workbench/public/design-ref/video-scenario-product.jpg`
- Create: `apps/web-workbench/public/design-ref/video-scenario-vlog.jpg`
- Create: `apps/web-workbench/public/design-ref/video-scenario-action.jpg`
- Create: `apps/web-workbench/public/design-ref/video-scenario-presenter.jpg`
- Modify: `apps/web-workbench/src/pages/VideoPage.tsx`
- Modify: `apps/web-workbench/src/lib/video-history-row.test.ts`

**Interfaces:**
- Consumes: image paths stored in the scene model.
- Produces: real scenario imagery and a smaller expired-history presentation while preserving availability semantics.

- [ ] **Step 1: Generate and inspect four slot-fit real image assets**

Use built-in ImageGen with one prompt per asset, 16:9 card composition, consistent warm editorial direction, no embedded text or logos. Copy final files into `public/design-ref/`.

- [ ] **Step 2: Write the failing compact-history regression assertion**

Assert that expired/unavailable presentation is classified compactly and still reports the truthful unavailable state.

- [ ] **Step 3: Implement compact history layout and pending edit label**

Reduce expired placeholder height and keep filters, pin, title, date, download state and navigation visible. When editing capability is false, render the non-interactive copy `继续剪辑 · 即将开放`.

- [ ] **Step 4: Run history and accessibility tests**

Run `video-history-row.test.ts` and `control-tooltip.test.ts`; expected PASS.

### Task 4: Visual QA, review and release

**Files:**
- Create: `design-qa.md`

**Interfaces:**
- Consumes: selected 1440×1024 visual target and local browser capture.
- Produces: passed design QA, reviewed commit, merged PR, deployed application and production verification evidence.

- [ ] **Step 1: Run full web verification**

Run targeted tests, full web tests, typecheck, lint, build and `git diff --check`; expected zero new failures.

- [ ] **Step 2: Capture implementation at the target viewport and compare**

Open the local `/video` page in the in-app browser, exercise scenario changes and settings, capture `1440 x 1024`, combine it with the selected source and inspect full and focused regions.

- [ ] **Step 3: Fix every P0/P1/P2 finding and record QA**

Repeat capture and comparison until `design-qa.md` ends with exactly `final result: passed`.

- [ ] **Step 4: Review, PR, merge, deploy and verify**

Request code review for the final commit range, fix all Critical/Important findings, push, create/ready/merge the PR, deploy only `application`, verify both health endpoints and production `/video` without submitting a paid generation.

