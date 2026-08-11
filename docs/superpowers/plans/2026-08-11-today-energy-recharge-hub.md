# HOLA DAY 今日能量补给站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/cosmic` 升级为明亮、可互动、可回访的每日能量补给站，并增加真实周运、是/否塔罗与首个轻量小游戏。

**Architecture:** 保留现有 `ExperiencePlayer`、玩法注册表与 astrology adapter，在其上新增独立补给体验、小游戏、按用户隔离的本地成长记录和首页分区组件。服务端只扩展有明确数据契约的 DivineAPI weekly/yes-no 能力；真实本命盘所需地点标准化与隐私资料另立后续计划。

**Tech Stack:** React 18、TypeScript 5.7、tRPC 11、Zod、Vitest、Testing Library、Happy DOM、CSS keyframes、Lucide React、DivineAPI。

## Global Constraints

- 精确复现已选修订视觉稿的明亮方向，不使用大面积暗紫、深蓝或深青。
- 只修改今日能量、astrology/energy 路由、相关测试、设计文档与今日能量图片资产。
- 不修改 TaskStream、支付、规划任务、股票、文件、浏览器、图片或视频行为。
- 不伪造社交人数，不把本地规则结果命名为真实星盘或流年。
- 图片资产必须由 Image Gen 独立生成；UI 图标使用现有 `lucide-react`。
- 全程单智能体串行执行，不派生子智能体。
- 所有新增循环与位移动画必须在 `prefers-reduced-motion: reduce` 下关闭。
- 生日、情绪、测试答案、问题正文和自由文本不得写入成长记录或体验事件。

---

### Task 1: 锁定资产、布局与页面契约

**Files:**
- Create: `apps/web-workbench/public/energy/recharge-island.webp`
- Create: `apps/web-workbench/public/energy/tarot-cards.webp`
- Create: `apps/web-workbench/public/energy/mini-game.webp`
- Create: `apps/web-workbench/public/energy/quick-test.webp`
- Create: `apps/web-workbench/public/energy/aries-badge.webp`
- Create: `apps/web-workbench/public/energy/energy-capsules.webp`
- Modify: `apps/web-workbench/src/pages/AstrologyPageShell.tsx`
- Modify: `apps/web-workbench/src/pages/AstrologyPage.test.tsx`

**Interfaces:**
- Produces: public assets under `/energy/*`; `AstrologyPageShell` with `max-w-[1180px]` content width.

- [ ] Generate each raster asset independently from the selected reference and inspect it at original resolution.
- [ ] Write a failing `AstrologyPage.test.tsx` assertion for the 1180px shell class and the visible date label.
- [ ] Run `pnpm --filter @holaday/web-workbench exec vitest run src/pages/AstrologyPage.test.tsx`; expect the new assertion to fail.
- [ ] Update `AstrologyPageShell` to keep one H1 while providing the selected compact date/header structure.
- [ ] Re-run the page test; expect PASS.
- [ ] Commit with `feat(energy): establish recharge hub shell and assets`.

### Task 2: 新增能量需求、30 秒补给和成长记录

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-progress.ts`
- Create: `apps/web-workbench/src/components/energy/energy-progress.test.ts`
- Create: `apps/web-workbench/src/components/energy/EnergyHero.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyHero.test.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/RechargeExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/RechargeExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy-types.ts`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Modify: `apps/orchestrator/src/energy/catalog.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.ts`
- Test: `apps/orchestrator/src/energy/catalog.test.ts`
- Test: `apps/orchestrator/src/trpc/routers/energy.test.ts`

**Interfaces:**
- Produces: `EnergyNeed`, `EnergyProgress`, `readEnergyProgress(scope)`, `recordEnergyCompletion(scope, kind, date)`, `RechargeExperience`.
- Event contract: `experienceId` includes `recharge`; bounded `energyNeed` replaces misleading mood values.

- [ ] Write failing pure-function tests for same-day deduplication, consecutive streaks and scope isolation.
- [ ] Run `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-progress.test.ts`; expect FAIL because the module is absent.
- [ ] Implement local storage parsing with invalid-data fallback and no PII fields.
- [ ] Write failing component tests for four `aria-pressed` energy choices, CTA copy change and reduced-motion-safe completion.
- [ ] Implement `EnergyHero` and `RechargeExperience` with `intro → active → result` phases.
- [ ] Update server catalog/event tests to expect `recharge` and `energyNeed: focus | relax | confidence | uplift`.
- [ ] Implement the strict Zod/event changes and registry loading.
- [ ] Run web and orchestrator target tests; expect PASS.
- [ ] Commit with `feat(energy): add interactive daily recharge`.

### Task 3: 上线首个键盘可玩的小游戏

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/MiniGameExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/MiniGameExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Modify: `apps/orchestrator/src/energy/catalog.ts`
- Modify: `apps/orchestrator/src/energy/catalog.test.ts`

**Interfaces:**
- Produces: active `games` registration loading `MiniGameExperience`.
- Game state: `ready | playing | complete`, 12 rounds, pointer and Enter/Space input.

- [ ] Write failing tests that no result appears before start, keyboard activation advances a round, round 12 completes, and replay resets score.
- [ ] Run the focused test and confirm FAIL.
- [ ] Implement the minimal game state machine; do not use timers as the only way to advance.
- [ ] Change the server catalog from coming-soon to active/actionable.
- [ ] Run registry, catalog and game tests; expect PASS.
- [ ] Commit with `feat(energy): activate first mini game`.

### Task 4: 扩展真实 DivineAPI 周运与是/否塔罗

**Files:**
- Modify: `apps/orchestrator/src/astrology/service.ts`
- Modify: `apps/orchestrator/src/astrology/service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/astrology.ts`
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx`

**Interfaces:**
- Produces: `WeeklyAstrologyReading`, `YesNoTarotReading`, `getWeeklyAstrologyReading()`, `getYesNoTarotReading()`, tRPC `astrology.weekly` and `astrology.yesNoTarot`.
- Provider endpoints: `/api/v5/weekly-horoscope`, `/api/v2/yes-or-no-tarot`.

- [ ] Add failing service tests for official endpoint paths, response mapping, cache reuse and mock fallback.
- [ ] Add failing router/type tests for `weekly` and on-demand `yesNoTarot`.
- [ ] Update default Horoscope/Tarot host to `https://astroapi-5.divineapi.com` while preserving env override.
- [ ] Implement bounded response adapters; never pass a user question to the provider.
- [ ] Add client hook tests: daily+weekly load together; yes/no fetch occurs only after the user starts that mode; stale calls cannot overwrite current profile.
- [ ] Add a two-mode Tarot experience: “今日卡” and “是/否卡”.
- [ ] Run orchestrator astrology tests, web hook tests and Tarot tests; expect PASS.
- [ ] Commit with `feat(astrology): add weekly and yes-no readings`.

### Task 5: 重组首页与诚实的星座补给

**Files:**
- Create: `apps/web-workbench/src/components/energy/EnergyExperienceDeck.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyGrowthPanel.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/horoscope-content.ts`
- Modify: `apps/web-workbench/src/components/energy/experiences/horoscope-content.test.ts`

**Interfaces:**
- Consumes: Hero, registry, progress, daily/weekly provider data and generated assets.
- Produces: selected reference hierarchy with one primary CTA and three active secondary experiences.

- [ ] Replace `EnergyHome.test.tsx` expectations with selected visual hierarchy, functional three-choice deck, growth panel and astrology panel.
- [ ] Add a regression test that the UI no longer renders synthetic “月亮倾向 / 上升倾向 / 流年提醒”.
- [ ] Implement the three new section components and wire all controls to the existing player/profile drawer.
- [ ] Remove synthetic natal/transit presentation from `HoroscopeExperience`; show daily/weekly provider sections and honest profile requirements only.
- [ ] Run all energy tests; expect PASS.
- [ ] Commit with `refactor(energy): build the recharge hub home`.

### Task 6: 实现明亮视觉、动效和响应式

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Test: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`

**Interfaces:**
- Produces: class-level motion and visual states from the approved spec.

- [ ] Add test assertions for semantic motion hooks and reduced-motion class/state coverage where observable.
- [ ] Implement the approved palette, 1180px composition, Hero fog background, tactile cards and visible focus states.
- [ ] Implement entry stagger, island float, orbit, CTA pulse, selected spring, card lift and reward-node lighting.
- [ ] Add `@media (prefers-reduced-motion: reduce)` that disables all looping and transform motion.
- [ ] Verify 1440×1024, 1024×768 and 390×844 layouts in the selected in-app browser.
- [ ] Commit with `feat(energy): add bright motion system`.

### Task 7: 质量门禁与视觉对比

**Files:**
- Create: `design-qa.md`
- Modify: touched files only if QA finds P0/P1/P2 issues.

**Interfaces:**
- Produces: same-viewport reference and implementation captures; `design-qa.md` with `final result: passed`.

- [ ] Run `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy src/pages/AstrologyPage.test.tsx`.
- [ ] Run `pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts src/energy/catalog.test.ts src/trpc/routers/astrology.test.ts src/trpc/routers/energy.test.ts` using only files that exist.
- [ ] Run `pnpm --filter @holaday/web-workbench typecheck`, targeted ESLint for touched files and `pnpm --filter @holaday/web-workbench build`.
- [ ] Run `git diff --check` and inspect `git status --short` for unrelated files.
- [ ] Start the existing local app, capture the selected production states in the in-app browser and verify primary interactions plus console errors.
- [ ] Open the selected reference and latest implementation screenshot together, write `design-qa.md`, fix every P0/P1/P2 and repeat until `final result: passed`.
- [ ] Commit with `test(energy): verify recharge hub experience`.

