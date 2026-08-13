# HOLA DAY 今日能量沉浸式内容 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/cosmic` 从高质量入口页升级为 36 个内容入口均可真实互动、体验完成后可连续进入下一项、移动端可快速定位与回访续看的内容目的地。

**Architecture:** 保留现有马卡龙视觉、星座数据钩子和模态体验容器，在内容目录与页面编排之间加入可判别的结构化目标层。练习、投票和三种游戏各自维护小型状态机；跨体验状态、当日去重与收藏统一写入向后兼容的本地进度模型；`EnergyHome` 只负责解析目标、打开体验和编排连续推荐。

**Tech Stack:** React 18、TypeScript 5.7、Vite 6、Vitest 2、Testing Library、Radix Dialog、tRPC 11、Zod、现有 `energy.css` 马卡龙样式体系。

## Global Constraints

- 只改今日能量相关 Web Workbench、Energy tRPC 输入白名单及对应测试；不得改变支付、规划任务、股票、文件、浏览器、图片或视频模块行为。
- DivineAPI Translator、OpenAI 专用 Key、供应商套餐、视频、广告、CMS、UGC、社交评论和排行榜均不在本计划内。
- 36 条入口必须全部产生真实状态变化；目标不可用时不得标记已打开，必须显示“这个体验暂时不可用，已为你保留当前位置”。
- 互动时长控制在 30–120 秒；不得伪造投票比例、权威分析、排行榜、失败惩罚、倒计时或错失恐惧文案。
- 事件不得包含测试答案、抽卡问题、投票选择、情绪正文、供应商正文或其他自由文本。
- 390px 视口不得横向溢出，主要触控目标最小 44px；所有体验需支持键盘、Escape 关闭、关闭后焦点回到入口和 `prefers-reduced-motion`。
- 旧本地进度必须可读；非法 ID 必须丢弃；不恢复测试中途答案或抽卡问题。
- 两个里程碑分别提交、测试与浏览器验收；PR、Ready、合并和部署不属于本地实现授权，必须另行获得用户明确批准。
- 本计划串行内联执行，不启用子智能体。

---

## File Map

### New files

- `apps/web-workbench/src/components/energy/energy-content-target.ts` — `EnergyContentTarget` 联合类型、ID 白名单、目标校验与目标到成长类型映射。
- `apps/web-workbench/src/components/energy/energy-content-target.test.ts` — 36 条内容目标覆盖、非法 ID 和映射测试。
- `apps/web-workbench/src/components/energy/content-target-controller.ts` — 将内容目标解析成体验启动或星座导航命令的纯函数。
- `apps/web-workbench/src/components/energy/content-target-controller.test.ts` — 精准目标命令测试。
- `apps/web-workbench/src/components/energy/experiences/practice-content.ts` — 六个练习的步骤、时长、主题与结束反馈。
- `apps/web-workbench/src/components/energy/experiences/practice-content.test.ts` — 练习目录完整性和文案边界测试。
- `apps/web-workbench/src/components/energy/experiences/PracticeExperience.tsx` — 可键盘完成的练习状态机。
- `apps/web-workbench/src/components/energy/experiences/PracticeExperience.test.tsx` — 六练习完成、首步展示和完成回调测试。
- `apps/web-workbench/src/components/energy/experiences/poll-content.ts` — 四个投票、每项四个选项和本地反馈。
- `apps/web-workbench/src/components/energy/experiences/poll-content.test.ts` — 选项、反馈与无伪造比例测试。
- `apps/web-workbench/src/components/energy/experiences/PollExperience.tsx` — 当日本地选择、重选和结果焦点状态机。
- `apps/web-workbench/src/components/energy/experiences/PollExperience.test.tsx` — 选择、结果、重选和隐私测试。
- `apps/web-workbench/src/components/energy/experiences/game-content.ts` — 三种游戏 ID、标签、时长和说明。
- `apps/web-workbench/src/components/energy/experiences/game-content.test.ts` — 三种模式目录测试。
- `apps/web-workbench/src/components/energy/experiences/GameExperience.tsx` — 游戏目录与模式路由。
- `apps/web-workbench/src/components/energy/experiences/GameExperience.test.tsx` — 指定模式直达和三状态机集成测试。
- `apps/web-workbench/src/components/energy/experiences/games/CatchEnergyGame.tsx` — 现有 12 光点循环抽离后的状态机。
- `apps/web-workbench/src/components/energy/experiences/games/BreathRhythmGame.tsx` — 四轮呼吸与手动继续状态机。
- `apps/web-workbench/src/components/energy/experiences/games/ColorMemoryGame.tsx` — 带形状/位置标签的三轮颜色序列状态机。
- `apps/web-workbench/src/components/energy/energy-continuation.ts` — 下一项推荐、解释理由与同类去重纯函数。
- `apps/web-workbench/src/components/energy/energy-continuation.test.ts` — 未完成优先、能量需求匹配、回退测试。
- `apps/web-workbench/src/components/energy/EnergyContinueCard.tsx` — “继续上次”和结果页下一项说明。
- `apps/web-workbench/src/components/energy/EnergyContinueCard.test.tsx` — 可用、不可用与按钮语义测试。
- `apps/web-workbench/src/components/energy/EnergySectionNav.tsx` — 仅窄屏可见的章节定位导航。
- `apps/web-workbench/src/components/energy/EnergySectionNav.test.tsx` — 定位、活动章节与减少动效测试。
- `apps/web-workbench/src/components/energy/energy-event-reporter.ts` — 单次重试、会话级 warning 去重和销毁语义。
- `apps/web-workbench/src/components/energy/energy-event-reporter.test.ts` — 网络/5xx 重试、4xx 不重试、warning 一次测试。

### Modified files

- `apps/web-workbench/src/components/energy/explore-content.ts` — 将 36 个字符串 `actionTarget` 替换为结构化 `target`，并为 18 测试、3 抽卡、3 游戏、4 周期给出精准 ID。
- `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx` — 只在目标成功打开后记录已看，增加收藏、耗尽主题重排和恢复提示。
- `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx` — 成功/失败打开语义、六组耗尽、重逛与收藏测试。
- `apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx` — 收藏按钮、打开失败提示和已打开语义。
- `apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx` — 收藏、恢复提示和 44px 控件测试。
- `apps/web-workbench/src/components/energy/energy-progress.ts` — v3 解析、当日完成类型、继续状态、练习、投票、收藏和当日已看。
- `apps/web-workbench/src/components/energy/energy-progress.test.ts` — v1/v2 迁移、非法值过滤、日期切换和更新函数测试。
- `apps/web-workbench/src/components/energy/energy-types.ts` — 增加 `practice`/`poll` 体验 ID、启动目标和完成上下文。
- `apps/web-workbench/src/components/energy/experience-registry.ts` — 注册目标专用练习/投票与新游戏播放器，并把结构化启动参数传给体验。
- `apps/web-workbench/src/components/energy/experience-registry.test.ts` — 目标专用体验不出现在首页玩法卡、加载参数正确。
- `apps/web-workbench/src/components/energy/EnergyExperienceDeck.tsx` — 过滤 `surface: 'target-only'` 的练习/投票入口。
- `apps/web-workbench/src/components/energy/experiences/TestExperience.tsx` — 支持 `initialTestId` 直达第一题。
- `apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx` — 直达、目录返回和关联测试。
- `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx` — 支持 `initialMode`/`initialTheme`，但保留模式与主题确认。
- `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx` — 三种推荐直达与知情确认测试。
- `apps/web-workbench/src/components/energy/AstrologyWorld.tsx` — 暴露 `openPeriod()`、`openSigns()` 和 `scrollIntoView()` 命令，临时星座不改资料。
- `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx` — 四周期直达、临时查看标识和资料不变测试。
- `apps/web-workbench/src/components/energy/ExperiencePlayer.tsx` — 结果页主 CTA 改为“继续：下一项”，次 CTA 为“返回今日内容”，保留玩法自身操作。
- `apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx` — 继续与返回语义、焦点恢复测试。
- `apps/web-workbench/src/components/energy/EnergyHero.tsx` — 当日完成后紧凑回访状态和手动展开。
- `apps/web-workbench/src/components/energy/EnergyHero.test.tsx` — 首访/回访切换与继续上次测试。
- `apps/web-workbench/src/components/energy/EnergyHome.tsx` — 统一目标执行、事件报告器、继续推荐、章节引用和体验启动参数编排。
- `apps/web-workbench/src/components/energy/EnergyHome.test.tsx` — 八条真实组件集成路径中的核心路径。
- `apps/web-workbench/src/components/energy/energy.css` — 新播放器、结果 CTA、耗尽循环、紧凑 Hero、移动导航和减少动效样式。
- `apps/web-workbench/src/components/energy/energy-css.test.ts` — 390px、44px、sticky 和 reduced-motion 静态契约。
- `apps/orchestrator/src/trpc/routers/energy.ts` — 新事件白名单、目标/模式枚举与严格隐私字段。
- `apps/orchestrator/src/trpc/routers/energy.test.ts` — 新事件接收、旧兼容和自由文本拒绝测试。

---

## Milestone 1 — 可信互动闭环

### Task 1: 结构化内容目标与 36 条精准目录

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-content-target.ts`
- Create: `apps/web-workbench/src/components/energy/energy-content-target.test.ts`
- Create: `apps/web-workbench/src/components/energy/content-target-controller.ts`
- Create: `apps/web-workbench/src/components/energy/content-target-controller.test.ts`
- Modify: `apps/web-workbench/src/components/energy/explore-content.ts`
- Modify: `apps/web-workbench/src/components/energy/explore-content.test.ts`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`

**Interfaces:**
- Produces: `EnergyContentTarget`, `EnergyPracticeId`, `EnergyPollId`, `EnergyGameId`, `EnergyTargetCommand`, `resolveEnergyContentTarget(target)` and `targetCompletionKind(target)`.
- `resolveEnergyContentTarget(target)` returns `{ type: 'experience'; experienceId: EnergyExperienceId; launchTarget: EnergyExperienceLaunchTarget } | { type: 'astrology'; period: EnergyAstrologyPeriod } | { type: 'astrology-signs' }`.
- Later tasks consume `EnergyContentItem.target: EnergyContentTarget`; no task may parse colon-delimited strings.

- [ ] **Step 1: Write failing target and catalog tests**

```ts
it('gives every one of the 36 items a valid structured target', () => {
  expect(ENERGY_EXPLORE_CONTENT).toHaveLength(36);
  expect(ENERGY_EXPLORE_CONTENT.every((item) => isEnergyContentTarget(item.target))).toBe(true);
  expect(new Set(ENERGY_EXPLORE_CONTENT.map((item) => item.id)).size).toBe(36);
});

it('resolves precise content targets without string prefix parsing', () => {
  expect(resolveEnergyContentTarget({ type: 'test', testId: 'work-focus' })).toEqual({
    type: 'experience',
    experienceId: 'light-test',
    launchTarget: { type: 'test', testId: 'work-focus' },
  });
  expect(resolveEnergyContentTarget({ type: 'astrology', period: 'weekly' })).toEqual({
    type: 'astrology',
    period: 'weekly',
  });
});
```

- [ ] **Step 2: Run tests and verify they fail for missing modules and string targets**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-content-target.test.ts src/components/energy/content-target-controller.test.ts src/components/energy/explore-content.test.ts`

Expected: FAIL because `energy-content-target.ts` and `content-target-controller.ts` do not exist and `actionTarget` is still a string.

- [ ] **Step 3: Define exact target unions and whitelist guards**

```ts
export const ENERGY_PRACTICE_IDS = [
  'breath-window', 'shoulder-release', 'five-senses',
  'water-pause', 'desk-reset', 'distance-gaze',
] as const;
export type EnergyPracticeId = (typeof ENERGY_PRACTICE_IDS)[number];

export const ENERGY_POLL_IDS = [
  'break-style', 'focus-sound', 'small-reward', 'social-battery',
] as const;
export type EnergyPollId = (typeof ENERGY_POLL_IDS)[number];

export const ENERGY_GAME_IDS = ['catch-energy', 'breath-rhythm', 'color-memory'] as const;
export type EnergyGameId = (typeof ENERGY_GAME_IDS)[number];

export type EnergyContentTarget =
  | { type: 'practice'; practiceId: EnergyPracticeId }
  | { type: 'poll'; pollId: EnergyPollId }
  | { type: 'test'; testId: LightTestId }
  | { type: 'tarot'; mode: 'single' | 'yes-no' | 'three'; theme?: HoladayCardTheme }
  | { type: 'game'; gameId: EnergyGameId }
  | { type: 'astrology'; period: EnergyAstrologyPeriod }
  | { type: 'astrology-signs' };
```

Implement `isEnergyContentTarget()` with explicit array membership checks, not permissive regular expressions. Implement `resolveEnergyContentTarget()` as an exhaustive `switch` and an `assertNever` guard.

- [ ] **Step 4: Replace all 36 target strings with precise target objects**

Use these required mappings:

```ts
const PRECISE_TEST_TARGETS = {
  'relationship-reply-speed': 'relationship-distance',
  'relationship-listen-or-solve': 'relationship-listening',
  'relationship-space-signal': 'relationship-expression',
  'relationship-small-invite': 'social-energy',
  'test-recommend-emotion': 'emotion-battery',
  'test-recommend-focus': 'work-focus',
  'test-recommend-boundary': 'stress-boundary',
  'test-recommend-social': 'social-recharge',
} as const;
```

The three tarot cards map to `single`, `yes-no`, and `three`; the three game cards map to `catch-energy`, `breath-rhythm`, and `color-memory`; fortune and zodiac entries retain their designed daily/weekly/monthly periods; zodiac element knowledge maps to `{ type: 'astrology-signs' }`.

Update the feed callback to receive `EnergyContentTarget` and update Home to call `resolveEnergyContentTarget()` in its existing action handler. At this task boundary, existing experience commands may still open their current generic player; practice/poll may return unavailable until Tasks 3–4. This preserves a compiling commit while Task 6 later adds success-aware opening semantics.

- [ ] **Step 5: Run target/catalog tests and typecheck**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-content-target.test.ts src/components/energy/content-target-controller.test.ts src/components/energy/explore-content.test.ts`

Expected: PASS; assertions confirm 36 valid targets, 6 practice IDs, 4 poll IDs, 8 distinct recommended test IDs, 3 tarot modes and 3 game IDs.

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS after all callers compile against `target` instead of `actionTarget`.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/web-workbench/src/components/energy/energy-content-target.ts apps/web-workbench/src/components/energy/energy-content-target.test.ts apps/web-workbench/src/components/energy/content-target-controller.ts apps/web-workbench/src/components/energy/content-target-controller.test.ts apps/web-workbench/src/components/energy/explore-content.ts apps/web-workbench/src/components/energy/explore-content.test.ts apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx
git commit -m "refactor(energy): add structured content targets"
```

### Task 2: v3 本地进度、当日状态与隐私边界

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy-progress.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.test.ts`

**Interfaces:**
- Consumes: `EnergyContentTarget`, `EnergyPracticeId`, `EnergyPollId` from Task 1.
- Produces: `EnergyContinuationState`, `completedKindsForDate()`, `recordPracticeCompletion()`, `savePollSelection()`, `recordOpenedEnergyContent()`, `toggleFavoriteEnergyContent()` and `saveLastEnergyTarget()`.
- `EnergyProgress` retains current fields and adds `completedKindsByDate: Record<string, EnergyCompletionKind[]>`, `seenContentDateKey: string | null`, and `continuation: EnergyContinuationState`.

- [ ] **Step 1: Write failing migration and update tests**

```ts
it('migrates v2 without inventing continuation data', () => {
  localStorage.setItem('holaday.energy.progress.v2:usr_a', JSON.stringify({
    completedDates: ['2026-08-13'], collectedKinds: ['tarot'], seenContentIds: ['fortune-small-luck'],
  }));
  expect(readEnergyProgress('usr_a')).toMatchObject({
    completedKindsByDate: {},
    seenContentDateKey: null,
    continuation: {
      dateKey: expect.any(String), lastTarget: null, lastCompletedKind: null,
      completedPracticeIds: [], pollSelections: {}, favoriteContentIds: [],
    },
  });
});

it('resets daily seen ids but preserves favorites and practice history on a new date', () => {
  recordOpenedEnergyContent('usr_a', 'relax-breath-window', new Date(2026, 7, 13));
  toggleFavoriteEnergyContent('usr_a', 'relax-breath-window');
  const next = recordOpenedEnergyContent('usr_a', 'fortune-small-luck', new Date(2026, 7, 14));
  expect(next.seenContentIds).toEqual(['fortune-small-luck']);
  expect(next.continuation.favoriteContentIds).toEqual(['relax-breath-window']);
});
```

- [ ] **Step 2: Run the progress test and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-progress.test.ts`

Expected: FAIL because v3 fields and update functions are missing.

- [ ] **Step 3: Implement bounded v3 parsing and mutation helpers**

Use storage key `holaday.energy.progress.v3:<scope>` and fall back through v2 then v1. Validate targets by `isEnergyContentTarget()`. Bound card/test/content/practice/favorite arrays to 100 IDs, poll selections to the four known poll IDs, and dated completion keys to the latest 45 valid `YYYY-MM-DD` entries.

```ts
export interface EnergyContinuationState {
  dateKey: string;
  lastTarget: EnergyContentTarget | null;
  lastCompletedKind: EnergyCompletionKind | null;
  completedPracticeIds: string[];
  pollSelections: Record<string, string>;
  favoriteContentIds: string[];
}

export function recordPracticeCompletion(
  scope: string | null,
  practiceId: EnergyPracticeId,
  completedAt = new Date(),
): EnergyProgress;

export function savePollSelection(
  scope: string | null,
  pollId: EnergyPollId,
  optionId: string,
  selectedAt = new Date(),
): EnergyProgress;
```

`recordPracticeCompletion()` must also record growth kind `recharge`; `savePollSelection()` stores only a bounded option ID and never accepts option body text. `scope === null` remains memory-only and must not write a guest record.

- [ ] **Step 4: Run progress tests and targeted typecheck**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-progress.test.ts`

Expected: PASS for v1/v2 migration, corrupt JSON fallback, illegal target filtering, date rollover, per-day completed kinds, practice, poll and favorite updates.

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/web-workbench/src/components/energy/energy-progress.ts apps/web-workbench/src/components/energy/energy-progress.test.ts
git commit -m "feat(energy): persist daily continuation state"
```

### Task 3: 六个真实放松练习

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/practice-content.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/practice-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/PracticeExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/PracticeExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy-types.ts`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.test.ts`
- Modify: `apps/web-workbench/src/components/energy/EnergyExperienceDeck.tsx`

**Interfaces:**
- Consumes: `EnergyPracticeId` and `recordPracticeCompletion()`.
- Produces: `PRACTICE_CONTENT`, `PracticeExperience({ initialPracticeId, ... })`, `EnergyExperienceId` including `'practice'`, and registry `surface: 'deck' | 'target-only'`.
- `EnergyExperienceLaunchTarget` is the extract of practice, poll, test, tarot or game targets; registry loaders read `props.launchTarget` without casting unknown strings.

- [ ] **Step 1: Write failing catalog and component tests**

```tsx
it.each(ENERGY_PRACTICE_IDS)('completes %s after showing its first step', async (practiceId) => {
  const onComplete = vi.fn();
  render(<PracticeExperience initialPracticeId={practiceId} phase="active" onPhaseChange={vi.fn()} onComplete={onComplete} profileStorageScope="usr_a" />);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.getByRole('button', { name: '立即完成' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '立即完成' }));
  expect(onComplete).toHaveBeenCalledOnce();
});
```

Also assert every practice has 2–4 non-empty steps, estimated time 30–120 seconds, a completion title, a completion action, and no free-text input.

- [ ] **Step 2: Run practice tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/practice-content.test.ts src/components/energy/experiences/PracticeExperience.test.tsx src/components/energy/experience-registry.test.ts`

Expected: FAIL because practice files and registry entry do not exist.

- [ ] **Step 3: Build the six data definitions and state machine**

Define 2–4 short steps for `breath-window`, `shoulder-release`, `five-senses`, `water-pause`, `desk-reset`, and `distance-gaze`. The active view uses `<progress max={steps.length} value={stepIndex + 1}>`, “上一步 / 下一步 / 立即完成” buttons, and `aria-live="polite"` only around step labels. Do not automatically advance with timers.

On completion, call in this order:

```ts
recordPracticeCompletion(profileStorageScope, initialPracticeId);
onComplete();
onPhaseChange('result');
```

The component must never render `<input type="text">` or `<textarea>`.

- [ ] **Step 4: Register practice as target-only and keep the homepage deck at three cards**

Extend `EnergyExperienceDefinition` with `surface?: 'deck' | 'target-only'`; default existing entries to `deck`. Add a `practice` entry whose loader verifies `launchTarget?.type === 'practice'`. Update `EnergyExperienceDeck` to render only non-target-only active entries.

- [ ] **Step 5: Run practice, registry and deck tests**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/practice-content.test.ts src/components/energy/experiences/PracticeExperience.test.tsx src/components/energy/experience-registry.test.ts src/components/energy/EnergyExperienceDeck.test.tsx`

Expected: PASS; all six IDs complete, growth kind is `recharge`, and the homepage still exposes exactly three playful choices.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/web-workbench/src/components/energy/experiences/practice-content.ts apps/web-workbench/src/components/energy/experiences/practice-content.test.ts apps/web-workbench/src/components/energy/experiences/PracticeExperience.tsx apps/web-workbench/src/components/energy/experiences/PracticeExperience.test.tsx apps/web-workbench/src/components/energy/energy-types.ts apps/web-workbench/src/components/energy/experience-registry.ts apps/web-workbench/src/components/energy/experience-registry.test.ts apps/web-workbench/src/components/energy/EnergyExperienceDeck.tsx apps/web-workbench/src/components/energy/EnergyExperienceDeck.test.tsx
git commit -m "feat(energy): add six guided practices"
```

### Task 4: 四个真实投票与本地反馈

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/poll-content.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/poll-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/PollExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/PollExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.test.ts`

**Interfaces:**
- Consumes: `EnergyPollId` and `savePollSelection()`.
- Produces: `POLL_CONTENT` and `PollExperience({ initialPollId, profileStorageScope, phase, onPhaseChange })`.
- Poll completion changes phase to `result` but does not claim one of the five growth kinds.

- [ ] **Step 1: Write failing data and interaction tests**

```tsx
it.each(ENERGY_POLL_IDS)('shows four local choices and actionable feedback for %s', async (pollId) => {
  render(<PollExperience initialPollId={pollId} profileStorageScope="usr_a" phase="active" onPhaseChange={vi.fn()} />);
  const options = screen.getAllByRole('radio');
  expect(options).toHaveLength(4);
  await userEvent.click(options[0]!);
  expect(await screen.findByRole('heading', { name: /你的选择/ })).toBeTruthy();
  expect(screen.queryByText(/%|全网|用户选择/)).toBeNull();
});
```

Assert each option has a stable slug ID, a one-sentence interpretation and a concrete suggestion. Assert `savePollSelection()` receives only poll ID and option ID.

- [ ] **Step 2: Run poll tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/poll-content.test.ts src/components/energy/experiences/PollExperience.test.tsx`

Expected: FAIL because poll content and component do not exist.

- [ ] **Step 3: Implement accessible poll state and re-selection**

Render options inside `<fieldset>` and `<legend>`, using radio semantics. After selection, move programmatic focus to a result heading with `tabIndex={-1}`, show “重新选择”, persist only the latest ID, and call `onPhaseChange('result')`. Re-selection returns to active options and keeps the previous choice visually selected.

- [ ] **Step 4: Register poll as target-only**

Add a `poll` registry entry with `surface: 'target-only'`; its loader requires `launchTarget?.type === 'poll'` and passes `pollId` without fallback to a generic directory.

- [ ] **Step 5: Run poll and registry tests**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/poll-content.test.ts src/components/energy/experiences/PollExperience.test.tsx src/components/energy/experience-registry.test.ts`

Expected: PASS for all 16 option paths, no percentage copy, result focus, local re-selection and target-only registration.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/web-workbench/src/components/energy/experiences/poll-content.ts apps/web-workbench/src/components/energy/experiences/poll-content.test.ts apps/web-workbench/src/components/energy/experiences/PollExperience.tsx apps/web-workbench/src/components/energy/experiences/PollExperience.test.tsx apps/web-workbench/src/components/energy/experience-registry.ts apps/web-workbench/src/components/energy/experience-registry.test.ts
git commit -m "feat(energy): add honest local polls"
```

### Task 5: 测试、抽卡与星座精准直达

**Files:**
- Modify: `apps/web-workbench/src/components/energy/experiences/TestExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`

**Interfaces:**
- Consumes: exact `test`, `tarot`, `astrology` and `astrology-signs` targets.
- Produces: `TestExperience.initialTestId`, `TarotExperience.initialMode`, `TarotExperience.initialTheme`, and `AstrologyWorldHandle`.

```ts
export interface AstrologyWorldHandle {
  openPeriod(period: EnergyAstrologyPeriod): void;
  openSigns(): void;
  scrollIntoView(): void;
}
```

- [ ] **Step 1: Write failing direct-entry tests**

```tsx
it('opens a recommended test on its first question and can return to the 18-test directory', () => {
  render(<TestExperience initialTestId="work-focus" phase="active" {...callbacks} />);
  expect(screen.getByText(/专注入口 · 1\/5/)).toBeTruthy();
  userEvent.click(screen.getByRole('button', { name: '返回测试目录' }));
  expect(screen.getAllByRole('button', { name: /测试/ })).toHaveLength(18);
});

it('opens the three-card recommendation at theme confirmation, not at an already drawn result', () => {
  render(<TarotExperience initialMode="three" phase="active" {...callbacks} />);
  expect(screen.getByRole('heading', { name: '这一次想看哪个方向？' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '开始抽卡' })).toBeTruthy();
  expect(screen.queryByText('翻开三张牌')).toBeNull();
});
```

Add imperative-ref tests for weekly/monthly/yearly selection and `openSigns()` showing “临时查看” without calling profile mutation.

- [ ] **Step 2: Run direct-entry tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/TestExperience.test.tsx src/components/energy/experiences/TarotExperience.test.tsx src/components/energy/AstrologyWorld.test.tsx`

Expected: FAIL because initial target props and imperative handle do not exist.

- [ ] **Step 3: Implement idempotent initial targets**

On component mount or a new launch key, initialize Test at `questions` with index 0 and Tarot at `theme` with the requested mode/theme. Do not reinitialize when internal result state changes. Keep the existing directory/history controls and do not restore answers or question text.

- [ ] **Step 4: Add controlled astrology navigation and temporary sign mode**

Use `React.useImperativeHandle()` to expose the three methods. `openPeriod(period)` must select and load the matching period before scrolling. `openSigns()` opens the existing 12-sign picker, sets a local temporary sign, displays “临时查看”, and never calls profile storage functions. In `useEnergyAstrology`, build local daily/weekly/monthly/yearly readings with their matching range labels and distinct period-specific overview/advice text; test that the four fallback bodies are not identical.

- [ ] **Step 5: Run direct-entry tests and component typecheck**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/TestExperience.test.tsx src/components/energy/experiences/TarotExperience.test.tsx src/components/energy/AstrologyWorld.test.tsx src/components/energy/useEnergyAstrology.test.tsx src/components/energy/experience-registry.test.ts`

Expected: PASS for eight exact test targets, three tarot modes, optional theme and four astrology periods.

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/web-workbench/src/components/energy/experiences/TestExperience.tsx apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx apps/web-workbench/src/components/energy/useEnergyAstrology.ts apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx apps/web-workbench/src/components/energy/experience-registry.ts apps/web-workbench/src/components/energy/experience-registry.test.ts
git commit -m "feat(energy): open recommended content precisely"
```

### Task 6: 目标执行器、成功打开语义与事件去噪

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-event-reporter.ts`
- Create: `apps/web-workbench/src/components/energy/energy-event-reporter.test.ts`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`
- Modify: `apps/orchestrator/src/trpc/routers/energy.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.test.ts`

**Interfaces:**
- Consumes: `resolveEnergyContentTarget()`, `EnergyExperienceLaunchTarget`, registry target entries, `AstrologyWorldHandle`, and progress updates.
- Produces: `onActionTarget(target, trigger): boolean`, `createEnergyEventReporter({ send, warn, schedule })`, and bounded `EnergyAnalyticsEvent`.
- The feed marks opened and persists seen only if `onActionTarget()` returns `true`.

- [ ] **Step 1: Write failing success/failure and reporter tests**

```tsx
it('keeps a card unopened when the target controller rejects it', async () => {
  render(<EnergyExploreFeed onActionTarget={() => false} {...props} />);
  const action = screen.getAllByRole('button', { name: /打开/ })[0]!;
  await userEvent.click(action);
  expect(action.closest('article')).toHaveAttribute('data-opened', 'false');
  expect(screen.getByText('这个体验暂时不可用，已为你保留当前位置')).toBeTruthy();
  expect(readEnergyProgress('usr_a').seenContentIds).toEqual([]);
});

it('retries one network failure and warns once after repeated failure', async () => {
  const send = vi.fn().mockRejectedValue(new TypeError('network'));
  const warn = vi.fn();
  const reporter = createEnergyEventReporter({ send, warn, schedule: (job) => job() });
  reporter.report({ type: 'energy_feed_refreshed' });
  await reporter.flushForTest();
  expect(send).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledTimes(1);
});
```

Also test 4xx once/no retry, 5xx twice, dispose dropping queued retries, and two failed events producing only one structured warning per reporter session.

- [ ] **Step 2: Run feed/home/reporter/server tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-event-reporter.test.ts src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/EnergyHome.test.tsx`

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/energy.test.ts`

Expected: FAIL because current feed marks visible cards seen, callback returns void, Home ignores practice/poll, and reporter/new event schemas do not exist.

- [ ] **Step 3: Implement single event reporter and strict server whitelist**

`createEnergyEventReporter()` owns a bounded in-memory set of pending promises, retries network/5xx exactly once, never retries 4xx, and emits once:

```ts
warn('energy event delivery failed', {
  eventType: event.type,
  retryable,
  attempts,
});
```

Do not include the payload itself in warning metadata. Add bounded server events: `energy_content_opened` with `contentId` and `targetType`; `energy_experience_started/completed/failed` with experience ID, optional stable mode ID, energy need, duration bucket and outcome; `energy_continuation_opened`; `energy_feed_exhausted`; and `energy_section_navigated`. Retain current event inputs during this branch for compatibility, but migrate EnergyHome to new names.

- [ ] **Step 4: Execute all target commands synchronously and return success**

In `EnergyHome`, hold `selectedLaunchTarget` beside `selectedExperience`. For `experience` commands, require an active/actionable registry entry and loader before opening. For astrology commands, call the corresponding handle. Return `false` on unavailable targets and `true` only after a command is accepted. Pass the exact launch target through `EnergyExperienceProps`.

- [ ] **Step 5: Change feed opened semantics**

Remove the effect that persists every displayed item. Keep `sessionDisplayedIds` only for current-session batch de-duplication. On card click, call the controller first; only on `true` set `openedId`, call `recordOpenedEnergyContent()`, and report `energy_content_opened`. Add a non-modal `role="status"` recovery message on `false`.

- [ ] **Step 6: Run the full Milestone 1 test gate**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-content-target.test.ts src/components/energy/content-target-controller.test.ts src/components/energy/energy-progress.test.ts src/components/energy/experiences/practice-content.test.ts src/components/energy/experiences/PracticeExperience.test.tsx src/components/energy/experiences/poll-content.test.ts src/components/energy/experiences/PollExperience.test.tsx src/components/energy/experiences/TestExperience.test.tsx src/components/energy/experiences/TarotExperience.test.tsx src/components/energy/AstrologyWorld.test.tsx src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/EnergyHome.test.tsx src/components/energy/energy-event-reporter.test.ts`

Expected: PASS; the integration test clicks one card of every target type and a catalog test proves all 36 targets resolve to an accepted command.

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/energy.test.ts`

Expected: PASS; private/free-text fields are rejected.

Run: `pnpm --filter @holaday/web-workbench typecheck && pnpm --filter @holaday/orchestrator typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Milestone 1**

```bash
git add apps/web-workbench/src/components/energy apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/trpc/routers/energy.test.ts
git commit -m "feat(energy): close all content interaction loops"
```

## Milestone 2 — 连续沉浸与回访

### Task 7: 三个不同小游戏

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/game-content.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/game-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/GameExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/GameExperience.test.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/games/CatchEnergyGame.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/games/BreathRhythmGame.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/games/ColorMemoryGame.tsx`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Modify: `apps/web-workbench/src/components/energy/experiences/MiniGameExperience.test.tsx`

**Interfaces:**
- Consumes: `EnergyGameId` and `launchTarget.type === 'game'`.
- Produces: `ENERGY_GAMES` and `GameExperience({ initialGameId, phase, onPhaseChange, onComplete })`.
- Each child receives `{ onComplete(): void; reducedMotion: boolean }` and owns only its own round state.

- [ ] **Step 1: Write failing mode-specific tests**

```tsx
it('completes catch-energy through twelve keyboard presses', async () => {
  render(<GameExperience initialGameId="catch-energy" {...props} />);
  for (let round = 1; round <= 12; round += 1) {
    await userEvent.click(screen.getByRole('button', { name: `接住第 ${round} 个能量光点` }));
  }
  expect(props.onComplete).toHaveBeenCalledOnce();
});

it('uses static stage cards for breath rhythm when reduced motion is enabled', () => {
  mockReducedMotion(true);
  render(<GameExperience initialGameId="breath-rhythm" {...props} />);
  expect(screen.getByTestId('breath-stage')).toHaveAttribute('data-motion', 'static');
});

it('repeats a wrong color-memory round with a shorter sequence and no failure label', async () => {
  render(<GameExperience initialGameId="color-memory" {...props} />);
  await chooseWrongSequence();
  expect(screen.getByText('再看一次，这一轮会更短')).toBeTruthy();
  expect(screen.queryByText(/失败|扣分|连胜中断/)).toBeNull();
});
```

- [ ] **Step 2: Run game tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/game-content.test.ts src/components/energy/experiences/GameExperience.test.tsx`

Expected: FAIL because only the existing single `MiniGameExperience` exists.

- [ ] **Step 3: Extract catch game and implement breath/color state machines**

Preserve current catch labels and 12-round behavior. Breath uses four user-advanced inhale/exhale cycles and never requires animation timing. Color memory uses shapes `圆 / 方 / 星 / 菱` plus visible positions; sequence lengths progress 3, 4, 5, with a wrong attempt repeating the round at `Math.max(3, length - 1)`.

- [ ] **Step 4: Route exact game targets and keep deck default**

Replace the registry `MiniGameExperience` loader with `GameExperience`. A content target supplies its exact game ID; the existing homepage deck defaults to `catch-energy`; the game directory remains reachable from the result or “换个玩法”.

- [ ] **Step 5: Run game and registry tests**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/game-content.test.ts src/components/energy/experiences/GameExperience.test.tsx src/components/energy/experience-registry.test.ts src/components/energy/EnergyHome.test.tsx`

Expected: PASS for three distinct entry labels, state machines, completion callbacks and keyboard controls.

- [ ] **Step 6: Commit Task 7**

```bash
git add apps/web-workbench/src/components/energy/experiences/game-content.ts apps/web-workbench/src/components/energy/experiences/game-content.test.ts apps/web-workbench/src/components/energy/experiences/GameExperience.tsx apps/web-workbench/src/components/energy/experiences/GameExperience.test.tsx apps/web-workbench/src/components/energy/experiences/games apps/web-workbench/src/components/energy/experience-registry.ts apps/web-workbench/src/components/energy/experience-registry.test.ts apps/web-workbench/src/components/energy/EnergyHome.test.tsx
git commit -m "feat(energy): add three distinct mini games"
```

### Task 8: 跨体验继续推荐与结果页闭环

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-continuation.ts`
- Create: `apps/web-workbench/src/components/energy/energy-continuation.test.ts`
- Create: `apps/web-workbench/src/components/energy/EnergyContinueCard.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyContinueCard.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/ExperiencePlayer.tsx`
- Modify: `apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`

**Interfaces:**
- Consumes: `completedKindsForDate()`, continuation state, structured targets and `targetCompletionKind()`.
- Produces: `EnergyContinuationRecommendation` and `recommendNextEnergyTarget(input)`.

```ts
export interface EnergyContinuationRecommendation {
  target: EnergyContentTarget;
  label: string;
  reason: string;
}

export function recommendNextEnergyTarget(input: {
  energyNeed: EnergyNeed;
  completedKinds: EnergyCompletionKind[];
  lastCompletedKind: EnergyCompletionKind | null;
  unavailableTypes?: EnergyContentTarget['type'][];
}): EnergyContinuationRecommendation | null;
```

- [ ] **Step 1: Write failing recommendation and result CTA tests**

```ts
it('prefers an unfinished kind and never repeats the just-completed kind', () => {
  const next = recommendNextEnergyTarget({
    energyNeed: 'relax', completedKinds: ['recharge'], lastCompletedKind: 'recharge',
  });
  expect(targetCompletionKind(next?.target ?? null)).not.toBe('recharge');
  expect(next?.reason).toContain('因为你选择了放松');
});
```

```tsx
it('renders one primary continuation and one secondary return action on result', () => {
  render(<ExperiencePlayer phase="result" continuation={recommendation} {...props} />);
  expect(screen.getByRole('button', { name: `继续：${recommendation.label}` })).toBeTruthy();
  expect(screen.getByRole('button', { name: '返回今日内容' })).toBeTruthy();
});
```

- [ ] **Step 2: Run continuation/player tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-continuation.test.ts src/components/energy/EnergyContinueCard.test.tsx src/components/energy/ExperiencePlayer.test.tsx`

Expected: FAIL because recommender and continuation CTA do not exist.

- [ ] **Step 3: Implement deterministic, explainable recommendation**

Use the fixed priority `recharge → tarot → test → game → horoscope`, rotate after `lastCompletedKind`, filter completed/unavailable kinds, then apply need-specific targets: relax→`breath-rhythm`/`emotion-recovery`; focus→`work-focus`/`catch-energy`; confidence→`single+confidence`; uplift→`color-memory`/`single+uplift`. If all five are complete, return a favorite/content-flow fallback handled by Home rather than repeating an unavailable target.

- [ ] **Step 4: Wire completion state and result navigation**

When phase first changes to result, store the exact last target and completion kind, update progress, compute a recommendation, and pass it to `ExperiencePlayer`. Clicking primary closes/replaces the current experience and opens the recommended target while reporting `energy_continuation_opened`; secondary closes the modal, scrolls to `#energy-today-content`, and restores focus there.

- [ ] **Step 5: Run continuation integration tests**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-continuation.test.ts src/components/energy/EnergyContinueCard.test.tsx src/components/energy/ExperiencePlayer.test.tsx src/components/energy/EnergyHome.test.tsx`

Expected: PASS for practice→next, test→next, all-complete fallback, unavailable fallback and focus return.

- [ ] **Step 6: Commit Task 8**

```bash
git add apps/web-workbench/src/components/energy/energy-continuation.ts apps/web-workbench/src/components/energy/energy-continuation.test.ts apps/web-workbench/src/components/energy/EnergyContinueCard.tsx apps/web-workbench/src/components/energy/EnergyContinueCard.test.tsx apps/web-workbench/src/components/energy/ExperiencePlayer.tsx apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/EnergyHome.test.tsx
git commit -m "feat(energy): add continuous experience recommendations"
```

### Task 9: 收藏、内容耗尽与今日精选重逛

**Files:**
- Modify: `apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/explore-content.ts`
- Modify: `apps/web-workbench/src/components/energy/explore-content.test.ts`

**Interfaces:**
- Consumes: `toggleFavoriteEnergyContent()`, `favoriteContentIds`, current theme and exact target callback.
- Produces: feed mode `'fresh' | 'revisit' | 'favorites'` and `EnergyFeedExhaustionAction`.

- [ ] **Step 1: Write failing exhaustion and favorite tests**

```tsx
it('offers three recoverable actions after six fresh batches', async () => {
  render(<EnergyExploreFeed {...props} />);
  for (let batch = 0; batch < 6; batch += 1) {
    for (const button of screen.getAllByRole('button', { name: /打开/ })) await userEvent.click(button);
    if (batch < 5) await userEvent.click(screen.getByRole('button', { name: '再来一组' }));
  }
  await userEvent.click(screen.getByRole('button', { name: '再来一组' }));
  expect(screen.getByRole('button', { name: '换个能量主题' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '继续收藏' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '完成今日能量' })).toBeTruthy();
});
```

Add a test that saving one card, changing six batches and entering favorites still displays it; add a test that revisit copy says “今日精选重逛” and may reuse IDs without saying “没有看过”.

- [ ] **Step 2: Run feed/card tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyMagazineCard.test.tsx src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/explore-content.test.ts`

Expected: FAIL because current empty state has only a terminal message and no favorites.

- [ ] **Step 3: Add favorite control and bounded theme re-ranking**

Add a heart button with `aria-label` and native `title`, independent from the open button and at least 44px. In fresh mode, exclude current-session displayed IDs; in revisit mode, allow IDs again but sort with selected energy need affinity. Favorites mode filters the catalog by saved IDs and shows a clear empty fallback if older content is unavailable.

- [ ] **Step 4: Implement the three exhaustion actions**

“换个能量主题” shows the four existing needs and begins revisit mode; “继续收藏” appears enabled only when favorites exist but remains present with explanatory disabled text otherwise; “完成今日能量” calls Home with a request to scroll to growth/continuation. Report `energy_feed_exhausted` once per exhaustion transition, not on every render.

- [ ] **Step 5: Run feed/card tests**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyMagazineCard.test.tsx src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/explore-content.test.ts src/components/energy/EnergyHome.test.tsx`

Expected: PASS for six unique fresh batches, no marking on display, favorites persistence, three recovery actions and revisit labeling.

- [ ] **Step 6: Commit Task 9**

```bash
git add apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx apps/web-workbench/src/components/energy/explore-content.ts apps/web-workbench/src/components/energy/explore-content.test.ts
git commit -m "feat(energy): keep the content feed recoverable"
```

### Task 10: 回访紧凑 Hero 与移动端章节导航

**Files:**
- Create: `apps/web-workbench/src/components/energy/EnergySectionNav.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergySectionNav.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHero.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHero.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Modify: `apps/web-workbench/src/components/energy/energy-css.test.ts`

**Interfaces:**
- Consumes: today's completed kinds, last target and Home target executor.
- Produces: `EnergyHero` modes `'full' | 'compact'` and `EnergySectionNav({ sections, onNavigate })`.

```ts
export interface EnergySectionLink {
  id: 'energy-recharge' | 'energy-play' | 'energy-astrology-world' | 'energy-today-content';
  label: '补给' | '玩法' | '星座' | '今日内容';
}
```

- [ ] **Step 1: Write failing return-visit and navigation tests**

```tsx
it('shows a compact hero after one completion today and expands on request', async () => {
  render(<EnergyHero mode="compact" completedCount={1} totalCount={5} {...props} />);
  expect(screen.getByText('今日完成 1/5')).toBeTruthy();
  expect(screen.getByRole('button', { name: '继续上次' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '重新选择能量' }));
  expect(screen.getByRole('heading', { name: '今天想补哪一种能量？' })).toBeTruthy();
});

it('uses instant section positioning when reduced motion is enabled', async () => {
  mockReducedMotion(true);
  render(<EnergySectionNav sections={SECTIONS} />);
  await userEvent.click(screen.getByRole('button', { name: '星座' }));
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
});
```

- [ ] **Step 2: Run hero/nav/CSS tests and confirm RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyHero.test.tsx src/components/energy/EnergySectionNav.test.tsx src/components/energy/energy-css.test.ts`

Expected: FAIL because compact mode and navigation do not exist.

- [ ] **Step 3: Implement compact return state without hiding control**

Home chooses compact mode only when `completedKindsForDate(progress, today).length > 0`. Compact Hero displays need, `n/5`, “继续上次”, “重新选择能量”, and an expand control; the next natural day returns to full mode. If `lastTarget` is invalid/unavailable, “继续上次” becomes “继续今日内容” and scrolls to the feed.

- [ ] **Step 4: Implement active-section navigation**

Render buttons for the four stable section IDs. Use `IntersectionObserver` to update the active tab only after sections enter the viewport; if unavailable, keep no forced active tab. Use `scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })`.

- [ ] **Step 5: Add responsive and reduced-motion CSS contracts**

At `max-width: 640px`, show a sticky nav below the app chrome, add section scroll margins, keep every button `min-height: 44px`, collapse practice/poll/game grids to one column, and ensure `max-width: 100%`/`min-width: 0` prevents horizontal overflow. Hide the persistent nav above 640px. In the existing reduced-motion block, disable breath scaling, card reveals, feed translations and smooth scroll behavior.

- [ ] **Step 6: Run return/mobile tests**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyHero.test.tsx src/components/energy/EnergySectionNav.test.tsx src/components/energy/energy-css.test.ts src/components/energy/EnergyHome.test.tsx`

Expected: PASS for same-day compact mode, next-day reset, valid/invalid continuation, sticky nav, 44px targets and reduced motion.

- [ ] **Step 7: Commit Task 10**

```bash
git add apps/web-workbench/src/components/energy/EnergySectionNav.tsx apps/web-workbench/src/components/energy/EnergySectionNav.test.tsx apps/web-workbench/src/components/energy/EnergyHero.tsx apps/web-workbench/src/components/energy/EnergyHero.test.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/EnergyHome.test.tsx apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/energy-css.test.ts
git commit -m "feat(energy): add return visits and mobile navigation"
```

### Task 11: 全链路回归、浏览器证据与交付记录

**Files:**
- Modify if assertions require correction: only files already listed in Tasks 1–10.
- Create: `qa-artifacts/today-energy-immersive-content/README.md` only if `qa-artifacts/` is tracked in this worktree; otherwise keep screenshots outside Git and report absolute paths.

**Interfaces:**
- Consumes: all milestone APIs.
- Produces: passing checks, 1280px/390px evidence, console/network findings, and a precise handoff; it does not push, create a PR, merge or deploy.

- [ ] **Step 1: Run focused unit and component suite**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy`

Expected: PASS for every energy test with no unhandled promise rejection.

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/energy/catalog.test.ts src/trpc/routers/energy.test.ts`

Expected: PASS.

- [ ] **Step 2: Run static gates**

Run: `pnpm --filter @holaday/web-workbench lint`

Expected: PASS for Web Workbench energy changes.

Run: `pnpm --filter @holaday/web-workbench typecheck && pnpm --filter @holaday/orchestrator typecheck`

Expected: PASS.

Run: `pnpm --filter @holaday/web-workbench build`

Expected: PASS and Vite emits the production bundle.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Start the production-equivalent local app and verify eight real paths**

Use the repository's documented authenticated local start command. In the browser, verify:

1. relaxation card → exact practice → result → next item;
2. poll card → option → local feedback → return feed;
3. recommended test → exact first question → result → related test;
4. three-card recommendation → theme confirmation → reveal → save;
5. each of the three games completes;
6. weekly astrology recommendation selects weekly;
7. six fresh batches → exhaustion → choose theme → “今日精选重逛”;
8. reload same day → compact Hero → continue last target.

Expected: all eight paths complete without empty clicks, stale generic directories or dead ends.

- [ ] **Step 4: Capture desktop and mobile evidence**

At 1280px capture full page, practice result, poll result, all three game modes, weekly astrology, exhaustion and compact return state. At 390px capture full page, sticky nav, modal content and compact Hero. Confirm `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at 390px.

- [ ] **Step 5: Inspect accessibility, console and network behavior**

Keyboard-complete practice, poll, test, tarot and all games; close each with Escape and verify focus returns to the originating button. Emulate `prefers-reduced-motion: reduce` and verify no semantic state relies on scaling or transitions. Confirm there is no related console error and a forced failed event request yields at most one structured warning after one retry.

- [ ] **Step 6: Review changed scope and commit verification-only corrections**

Run: `git status --short && git diff --stat && git log --oneline --decorate -12`

Expected: only planned energy/orchestrator/docs files are changed; unrelated `.claude/`, `qa-artifacts/`, `skills/` drafts in the main checkout remain untouched.

If Step 3–5 exposed a product defect, first add a failing regression test, fix only that defect, rerun Steps 1–5, then commit:

```bash
git add apps/web-workbench/src/components/energy apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/trpc/routers/energy.test.ts
git commit -m "fix(energy): close immersive QA regressions"
```

- [ ] **Step 7: Prepare the local handoff without publishing**

Report branch name, HEAD, clean/dirty status, milestone commits, exact command results, screenshots, browser console/network findings, remaining risks, sensitive areas confirmed untouched, and the single next action “授权 push 并创建 Draft PR”. Do not push, create PR, mark Ready, merge or deploy in this task.

---

## Final Acceptance Matrix

| Requirement | Evidence task |
|---|---|
| 36/36 real targets | Tasks 1, 6, 11 |
| 6 practices | Task 3 |
| 4 honest polls | Task 4 |
| 18 precise tests | Tasks 1, 5 |
| 3 tarot modes with confirmation | Task 5 |
| 3 distinct games | Task 7 |
| 4 astrology periods + temporary signs | Task 5 |
| Result continuation and no dead end | Task 8 |
| Favorites and recoverable exhaustion | Task 9 |
| Same-day return + compact Hero | Task 10 |
| 390px navigation and 44px controls | Tasks 10, 11 |
| One-retry event diagnostics, no PII | Task 6 |
| Keyboard, focus return, reduced motion | Tasks 3–7, 10, 11 |
| No Translator/provider/payment scope drift | Global Constraints and Task 11 |
