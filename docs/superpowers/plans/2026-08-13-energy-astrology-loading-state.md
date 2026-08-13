# HOLA DAY 星座内容可信加载态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 DivineAPI 首次请求期间短暂出现的本地备用内容，并让顶部星座卡、星座专刊、周期面板和深度补给呈现一致、可访问的马卡龙加载态。

**Architecture:** 保留现有本地内容作为真实失败后的安全回退，但用 `loading + loaded` 区分首次请求与已有内容刷新。数据钩子同步暴露 `initialLoading`，组合组件依赖它决定是否隐藏本地内容；周期专刊直接依据当前周期的 `loading && !loaded` 渲染骨架。二次刷新保留已加载内容，形成 stale-while-revalidate 行为。

**Tech Stack:** React 18、TypeScript 5.7、Vitest 2、Testing Library、Vite 6、现有 `energy.css` 马卡龙视觉体系。

## Global Constraints

- 只改今日能量星座加载状态、对应组件、样式和测试；不修改 DivineAPI/OpenAI Key、供应商套餐或服务端数据契约。
- 不改变抽卡、测试、游戏、视频、广告、支付、规划任务、股票、文件、浏览器、图片或视频模块行为。
- 首次请求期间不得把本地备用正文、数值或来源标签渲染到可见或无障碍文本树。
- 请求确实失败或服务端明确回退后，必须继续展示本地内容和低噪备用提示。
- 已有内容刷新时不得清空正文或重新显示首次骨架。
- 骨架沿用薰衣草、蜜桃、薄荷和天蓝马卡龙配色；390px 不横向溢出；`prefers-reduced-motion` 下关闭扫光位移。
- 全程串行、测试先行；不启用子智能体。
- push、PR、合并和部署不在本计划默认授权内，执行前遵循用户在当前任务中的明确授权边界。

---

## File Map

### Modified files

- `apps/web-workbench/src/components/energy/useEnergyAstrology.ts` — 首次/刷新状态语义和 `initialLoading` 推导。
- `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx` — 首次挂载、失败回退与 stale-while-revalidate 状态测试。
- `apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx` — 顶部卡首次骨架与刷新忙碌状态。
- `apps/web-workbench/src/components/energy/zodiac-art.test.tsx` — 顶部卡加载中不泄露备用内容、失败后才展示的测试。
- `apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx` — 星座专刊封面的可访问骨架分支。
- `apps/web-workbench/src/components/energy/AstrologyWorld.tsx` — 周期级首次骨架、失败提示和刷新保留内容。
- `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx` — 日/月首次加载、失败与刷新行为测试。
- `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx` — 深度补给首次加载卡。
- `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx` — 加载中不泄露本地内容与失败回退测试。
- `apps/web-workbench/src/components/energy/energy.css` — 马卡龙骨架、刷新旋转、响应式和减少动态效果。
- `apps/web-workbench/src/components/energy/energy-css.test.ts` — 骨架动效与 reduced-motion 静态契约。

---

### Task 1: 明确首次请求与刷新状态

**Files:**
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Test: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`

**Interfaces:**
- Produces: `EnergyAstrologyState.initialLoading: boolean`。
- `initialLoading` 在日运或周运满足 `loading === true && loaded === false` 时为 `true`。
- `loadPeriod()` 在已有内容刷新时保持 `loaded === true` 和当前 `reading`；首次按需加载保持 `loaded === false` 直到请求结束。

- [ ] **Step 1: 写首次加载和刷新保留内容的失败测试**

```tsx
it('marks automatic provider periods as initial loading before either request resolves', () => {
  trpcMocks.daily.mockReturnValue(deferredDaily.promise);
  trpcMocks.weekly.mockReturnValue(deferredWeekly.promise);
  const { result } = renderHook(() => useEnergyAstrology(profile, true));

  expect(result.current.initialLoading).toBe(true);
  expect(result.current.periods.daily).toMatchObject({ loading: true, loaded: false });
  expect(result.current.periods.weekly).toMatchObject({ loading: true, loaded: false });
});

it('keeps provider content loaded while a manual refresh is pending', async () => {
  // 首次请求成功后让第二次 daily/weekly 请求保持 pending。
  await act(async () => void result.current.refresh());
  expect(result.current.initialLoading).toBe(false);
  expect(result.current.periods.daily.loaded).toBe(true);
  expect(result.current.reading.headline).toBe('远端今日提示');
});
```

- [ ] **Step 2: 运行钩子测试并确认 RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx`

Expected: FAIL，因为 `initialLoading` 尚不存在，且自动周期初始仍是 `loaded: true`。

- [ ] **Step 3: 实现最小状态修复**

增加一个纯函数，根据 `liveProvider` 复制本地周期状态：日运、周运初始设为 `{ loading: true, loaded: false, error: null }`，月运、年运保留按需状态。`useState` 初始化和资料变化后的 effect 重置必须同时使用该函数，避免 effect 运行前的一帧闪烁。

```ts
const initialLoading = PERIODS.some(
  (period) => periods[period].loading && !periods[period].loaded,
);
```

`loadPeriod()` 继续只覆盖 `loading` 与 `error`，不得把已加载内容的 `loaded` 改回 `false`。

- [ ] **Step 4: 运行钩子测试并确认 GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx`

Expected: PASS，首次加载、独立失败、资料竞态和刷新保留内容全部通过。

- [ ] **Step 5: 提交状态模型**

```bash
git add apps/web-workbench/src/components/energy/useEnergyAstrology.ts apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx
git commit -m "fix(energy): distinguish initial astrology loading"
```

### Task 2: 顶部星座卡与深度补给加载态

**Files:**
- Modify: `apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx`
- Modify: `apps/web-workbench/src/components/energy/zodiac-art.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx`

**Interfaces:**
- Consumes: `EnergyAstrologyState.initialLoading`。
- Produces: `.energy-astrology-panel__skeleton` 和 `.energy-horoscope-loading` 结构；两者使用 `aria-busy="true"` 和“正在读取星座能量”的 live 文案。

- [ ] **Step 1: 写加载中不泄露备用内容的失败测试**

```tsx
it('shows a trusted loading state without local fallback copy', () => {
  const astrology = astrologyFor(profile);
  astrology.initialLoading = true;
  astrology.loading = true;
  render(<EnergyAstrologyPanel profile={profile} astrology={astrology} {...handlers} />);

  expect(screen.getByText('正在读取星座能量')).toBeTruthy();
  expect(screen.queryByText('本地备用提示')).toBeNull();
  expect(screen.queryByText(astrology.reading.headline)).toBeNull();
});
```

为 `HoroscopeExperience` 添加等价测试，断言加载中不出现 `暂时使用本地提示`、本地 headline 或能量值；现有失败回退测试继续保留。

- [ ] **Step 2: 运行两个组件测试并确认 RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/zodiac-art.test.tsx src/components/energy/experiences/HoroscopeExperience.test.tsx`

Expected: FAIL，因为组件仍直接渲染本地备用正文。

- [ ] **Step 3: 实现两个最小加载分支**

顶部卡保留星座插画、标题与操作按钮；身份区只显示资料确定的星座名和加载标签，其余位置用 `aria-hidden="true"` 的骨架块占位。深度补给在 `initialLoading` 时返回独立加载卡，避免渲染本地日运和周运。

刷新按钮在 `loading` 时添加 `data-loading="true"` 和 `aria-busy="true"`；当 `initialLoading === false` 时继续渲染已有内容，即使 `loading === true`。

- [ ] **Step 4: 运行组件测试并确认 GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/zodiac-art.test.tsx src/components/energy/experiences/HoroscopeExperience.test.tsx`

Expected: PASS；备用内容只在完成回退后出现。

- [ ] **Step 5: 提交顶部与弹层行为**

```bash
git add apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx apps/web-workbench/src/components/energy/zodiac-art.test.tsx apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx
git commit -m "feat(energy): add trusted astrology loading cards"
```

### Task 3: 星座专刊与周期面板加载态

**Files:**
- Modify: `apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`
- Test: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`

**Interfaces:**
- `AstrologyMagazineCover` 新增 `loading: boolean`。
- `AstrologyWorld` 使用 `const initialPeriodLoading = selectedState.loading && !selectedState.loaded`。
- 首次周期加载隐藏 `AstrologyDimensionGrid` 和 `LuckyInsights`；刷新已有周期仍显示二者。

- [ ] **Step 1: 写周期加载和 stale-while-revalidate 失败测试**

```tsx
it('hides local period content and source while the first period request is pending', () => {
  const daily = periodState('daily', { loading: true, loaded: false, source: 'local-fallback' });
  render(<AstrologyWorld astrology={state({ periods: { ...periods, daily } })} {...handlers} />);
  expect(screen.getByText('正在读取这一段星座内容…')).toBeTruthy();
  expect(screen.queryByText('Holaday 本地提示')).toBeNull();
  expect(screen.queryByText(daily.reading.summary)).toBeNull();
});

it('keeps loaded provider details visible during refresh', () => {
  const daily = periodState('daily', { loading: true, loaded: true });
  render(<AstrologyWorld astrology={state({ periods: { ...periods, daily } })} {...handlers} />);
  expect(screen.getByText('工作提示')).toBeTruthy();
  expect(screen.queryByTestId('astrology-period-skeleton')).toBeNull();
});
```

- [ ] **Step 2: 运行专刊测试并确认 RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/AstrologyWorld.test.tsx`

Expected: FAIL，因为专刊来源、摘要、维度和幸运信息仍来自本地备用 reading。

- [ ] **Step 3: 实现专刊和周期骨架**

`AstrologyMagazineCover` 在 `loading` 时保留星座名与插画，但把摘要、来源和三项数据改为固定高度骨架。`AstrologyWorld` 的 panel 首次加载时渲染六格骨架和幸运信息骨架；失败后恢复现有 notice 与本地内容；已加载刷新只旋转刷新按钮并保留内容。

- [ ] **Step 4: 运行专刊测试并确认 GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/AstrologyWorld.test.tsx`

Expected: PASS，包括月运按需加载、临时星座预览和完整排行诚实性测试。

- [ ] **Step 5: 提交专刊行为**

```bash
git add apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx
git commit -m "feat(energy): add period-aware astrology skeletons"
```

### Task 4: 马卡龙骨架样式与完整验证

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Modify: `apps/web-workbench/src/components/energy/energy-css.test.ts`

**Interfaces:**
- Produces: `.energy-astrology-skeleton` 基础样式、`energy-astrology-shimmer` 关键帧、刷新图标旋转以及 reduced-motion 覆盖。

- [ ] **Step 1: 写样式契约失败测试**

```ts
it('provides macaron astrology skeletons with reduced-motion fallback', () => {
  expect(css).toContain('@keyframes energy-astrology-shimmer');
  expect(css).toMatch(/\.energy-astrology-skeleton[\s\S]*linear-gradient/);
  expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.energy-astrology-skeleton[\s\S]*animation:\s*none/);
});
```

- [ ] **Step 2: 运行样式测试并确认 RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-css.test.ts`

Expected: FAIL，因为骨架关键帧和 reduced-motion 规则尚不存在。

- [ ] **Step 3: 实现响应式马卡龙骨架样式**

使用低对比薰衣草—蜜桃—天蓝渐变、1.6 秒扫光、与对应文本/卡片一致的圆角和固定最小高度。390px 下六格周期骨架改为单列。刷新按钮只旋转内部图标。reduced-motion 媒体查询中把骨架和刷新动画设为 `none !important`。

- [ ] **Step 4: 运行今日能量目标测试**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx src/components/energy/zodiac-art.test.tsx src/components/energy/AstrologyWorld.test.tsx src/components/energy/experiences/HoroscopeExperience.test.tsx src/components/energy/energy-css.test.ts`

Expected: PASS，0 failures。

- [ ] **Step 5: 运行静态与构建门禁**

Run: `pnpm --filter @holaday/web-workbench typecheck`

Run: `pnpm --filter @holaday/web-workbench lint`

Run: `pnpm --filter @holaday/web-workbench build`

Run: `git diff --check origin/claude/musing-keller-ae1d05...HEAD`

Expected: 四条命令均 exit 0；如仓库既有 lint 噪音存在，必须另跑触及文件的 ESLint 并如实记录完整限制，不得将局部通过表述为全量通过。

- [ ] **Step 6: 浏览器验收**

在桌面和 390px 视口验证：首次加载无备用提示闪烁、成功后显示 DivineAPI 来源、真实失败才显示本地提示、二次刷新不清空内容、无横向溢出、减少动态效果可用。记录控制台和截图证据。

- [ ] **Step 7: 提交样式和验证契约**

```bash
git add apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/energy-css.test.ts
git commit -m "style(energy): polish astrology loading feedback"
```

- [ ] **Step 8: 完成前自检**

核对设计文档每一项目标都映射到实现或验证证据；检查 `git status --short`、`git diff --stat origin/claude/musing-keller-ae1d05...HEAD` 和提交历史。只在新鲜测试、类型检查、lint、构建与浏览器证据完整后声明完成。
