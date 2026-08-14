# DivineAPI 真实内容自动升级提速 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让今日能量在首次降级为本地提示后立即静默等待 DivineAPI，并在真实内容完成时自动原位替换，同时明确告知用户无需手动刷新。

**Architecture:** 保留服务端现有 8 秒前台预算、35 秒上游硬超时、缓存和同键单飞，仅把前端静默复查序列从 `[18_000, 5_000]` 调整为 `[0, 1_000, 1_000]`。UI 直接读取已有的 `providerRefreshPending` 字段，在专刊来源、内容提示和呼吸圆点中表达“正在更新”，真实内容到达后沿用现有 request id/range/profile 守卫原位升级。

**Tech Stack:** React 18、TypeScript、tRPC 11、Vitest 2、Testing Library、CSS

## Global Constraints

- 首次 8 秒拿不到 DivineAPI 时继续立即展示本地内容，不恢复长骨架屏。
- 静默复查延迟固定为 `[0, 1_000, 1_000]` 毫秒，最多三次。
- 静默复查期间 `loading` 必须保持 `false`，不得转动手动刷新按钮。
- 只复查当前可见周期，不预热十二星座排行。
- 必须保留 request id、range key、profile、手动刷新、周期切换和卸载竞态保护。
- pending 文案固定为“真实星座内容更新中，将自动替换”。
- 普通本地降级继续显示“Holaday 本地提示”或“暂时使用本地提示”，不得承诺自动替换。
- `prefers-reduced-motion: reduce` 下禁用 pending 呼吸动画。
- 不修改 Orchestrator 服务端、DivineAPI 参数、Translator、OpenAI API Key、模型、套餐或权限。
- 不扩大到星座预览、排行、塔罗、小游戏或今日能量其他视觉模块。

---

### Task 1: 前端静默长轮询调度

**Files:**
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Test: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`

**Interfaces:**
- Consumes: 服务端周期读取返回的 `providerRefreshPending: boolean`、现有 `queryPeriod()` 和每周期 request id/range key 守卫。
- Produces: `SILENT_REFRESH_DELAYS_MS = [0, 1_000, 1_000]`；pending 周期最多执行三次无 loading 的静默查询。

- [ ] **Step 1: 写“立即复查且保持本地内容可见”的失败测试**

把现有 `silently upgrades a pending local period without showing loading again` 测试改为让第二次查询保持 deferred，并证明第一次本地响应后下一个事件循环已经发起静默查询：

```tsx
it('immediately starts a silent recheck without showing loading again', async () => {
  vi.useFakeTimers();
  const silentDaily = deferred<ReturnType<typeof remoteReading>>();
  trpcMocks.daily
    .mockResolvedValueOnce(pendingLocalDaily())
    .mockReturnValueOnce(silentDaily.promise);
  const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
  const { result } = renderHook(() => useEnergyAstrology(profile, true));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  expect(trpcMocks.daily).toHaveBeenCalledTimes(2);
  expect(result.current.periods.daily).toMatchObject({
    source: 'local-fallback',
    loading: false,
    error: '暂时使用本地提示',
  });

  await act(async () => {
    silentDaily.resolve(remoteReading('aries', '后台真实中文提示'));
    await silentDaily.promise;
  });

  expect(result.current.periods.daily.source).toBe('divineapi');
  expect(result.current.periods.daily.error).toBeNull();
  expect(result.current.reading.headline).toBe('后台真实中文提示');
});
```

- [ ] **Step 2: 写“最多三次复查”的失败测试并同步生命周期用例**

将原来的“两次 pending 复查”改成下面的上限断言；现有可见周期、切换周期、手动刷新、范围变化、卸载和过期资料测试中的 `18_000`/`5_000` 推进值同步改为 `0`/`1_000`，但保留各自原有竞态断言：

```tsx
it('stops after three pending silent rechecks and does not preheat ranking', async () => {
  vi.useFakeTimers();
  trpcMocks.daily.mockResolvedValue(pendingLocalDaily());
  const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

  renderHook(() => useEnergyAstrology(profile, true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(trpcMocks.daily).toHaveBeenCalledTimes(4);
  expect(trpcMocks.ranking).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 运行 Hook 测试并确认按旧实现失败**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx
```

Expected: FAIL；立即复查用例只观察到一次 daily 查询，旧上限用例仍按 `[18_000, 5_000]` 工作。

- [ ] **Step 4: 实现最小调度变更**

在 `useEnergyAstrology.ts` 中只修改静默延迟常量；复用现有调度、request id、范围和 profile 守卫：

```ts
const SILENT_REFRESH_DELAYS_MS = [0, 1_000, 1_000] as const;
```

不得为静默查询设置 `loading: true`，不得改服务端路由或请求参数。

- [ ] **Step 5: 运行 Hook 测试并确认通过**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx
```

Expected: `useEnergyAstrology.test.tsx` 全部 PASS，且没有未处理 promise 或 fake timer 警告。

- [ ] **Step 6: 提交调度变更**

```bash
git add apps/web-workbench/src/components/energy/useEnergyAstrology.ts apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx
git commit -m "fix(energy): accelerate DivineAPI auto upgrade"
```

---

### Task 2: Pending 状态文案、可访问性与马卡龙动效

**Files:**
- Modify: `apps/web-workbench/src/components/energy/astrology-content.ts`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Test: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`
- Test: `apps/web-workbench/src/components/energy/AstrologyMagazineCover.test.tsx`
- Test: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx`
- Test: `apps/web-workbench/src/components/energy/energy-css.test.ts`

**Interfaces:**
- Consumes: `EnergyPeriodState.source`、`EnergyPeriodState.reading.freshness`、`EnergyPeriodState.reading.providerRefreshPending`。
- Produces: `PROVIDER_REFRESH_PENDING_COPY` 常量和 `periodSourceLabel(state: Pick<EnergyPeriodState, 'source' | 'reading'>): string`；来源标签的 `data-refreshing` 与 polite live region。

- [ ] **Step 1: 写来源文案和 pending 展示的失败测试**

在 `AstrologyWorld.test.tsx` 构造 pending daily 状态，要求专刊标签和提示区都表达自动替换，同时普通降级仍保持本地来源：

```tsx
it('explains that pending provider content will replace the local fallback', () => {
  const astrology = state();
  astrology.periods.daily = periodState('daily', {
    source: 'local-fallback',
    error: '暂时使用本地提示',
    reading: periodReading('daily', {
      provider: 'mock',
      source: 'local-fallback',
      freshness: 'local',
      providerRefreshPending: true,
    }),
  });

  render(
    <AstrologyWorld astrology={astrology} onOpenEnergyCard={vi.fn()} onOpenLightTest={vi.fn()} />,
  );

  expect(screen.getAllByText('真实星座内容更新中，将自动替换')).toHaveLength(2);
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
});
```

另加普通 `local-fallback + providerRefreshPending: false` 用例，断言仍出现“Holaday 本地提示”，且不存在“将自动替换”。

- [ ] **Step 2: 写专刊状态标记、深度补给文案和减弱动画的失败测试**

在 `AstrologyMagazineCover.test.tsx` 传入 pending reading，断言来源元素具备 `data-refreshing="true"`、`role="status"` 和 `aria-live="polite"`。在 `HoroscopeExperience.test.tsx` 给 `periods.daily.reading.providerRefreshPending` 设为 `true`，断言显示固定 pending 文案；普通本地降级测试继续断言“暂时使用本地提示”。在 `energy-css.test.ts` 增加：

```ts
expect(css).toContain('@keyframes energy-provider-pending-pulse');
expect(css).toMatch(
  /\.energy-astrology-magazine-cover__source\[data-refreshing="true"\]::before\s*\{[^}]*animation:/s,
);
expect(css).toMatch(
  /prefers-reduced-motion:[\s\S]*\.energy-astrology-magazine-cover__source\[data-refreshing="true"\]::before[\s\S]*animation:\s*none\s*!important/,
);
```

- [ ] **Step 3: 运行四个组件/样式测试并确认失败**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/AstrologyWorld.test.tsx src/components/energy/AstrologyMagazineCover.test.tsx src/components/energy/experiences/HoroscopeExperience.test.tsx src/components/energy/energy-css.test.ts
```

Expected: FAIL；当前页面只显示本地提示，没有 pending 专用文案、live region 或呼吸圆点。

- [ ] **Step 4: 集中实现来源文案选择**

在 `astrology-content.ts` 新增：

```ts
import type { EnergyPeriodReading, EnergyPeriodState } from './useEnergyAstrology';

export const PROVIDER_REFRESH_PENDING_COPY = '真实星座内容更新中，将自动替换';

export function periodSourceLabel(
  state: Pick<EnergyPeriodState, 'source' | 'reading'>,
): string {
  if (state.source === 'local-fallback') {
    return state.reading.providerRefreshPending
      ? PROVIDER_REFRESH_PENDING_COPY
      : 'Holaday 本地提示';
  }
  return state.reading.freshness === 'stale'
    ? 'DivineAPI 最近成功数据'
    : 'DivineAPI 内容';
}
```

`AstrologyWorld.tsx` 使用 `periodSourceLabel(selectedState)` 替换组件内来源分支；错误提示区在 `providerRefreshPending` 时渲染 `PROVIDER_REFRESH_PENDING_COPY`，普通错误仍渲染 `selectedState.error`。

- [ ] **Step 5: 实现状态标记和深度补给文案**

`AstrologyMagazineCover.tsx` 的来源标签读取 `reading.providerRefreshPending`：

```tsx
<span
  className="energy-astrology-magazine-cover__source"
  data-refreshing={reading.providerRefreshPending ? 'true' : undefined}
  role={reading.providerRefreshPending ? 'status' : undefined}
  aria-live={reading.providerRefreshPending ? 'polite' : undefined}
>
  {sourceLabel}
</span>
```

`HoroscopeExperience.tsx` 在本地降级时根据 daily pending 状态选择文案：

```tsx
{astrology.source === 'local-fallback' ? (
  <small>
    {astrology.periods.daily?.reading.providerRefreshPending
      ? PROVIDER_REFRESH_PENDING_COPY
      : '暂时使用本地提示'}
  </small>
) : null}
```

- [ ] **Step 6: 实现马卡龙呼吸圆点并关闭减弱动画**

在 `energy.css` 的来源标签样式附近增加：

```css
.energy-astrology-magazine-cover__source[data-refreshing="true"] {
  align-items: center;
  gap: 7px;
  border-color: rgb(116 190 181 / 28%);
  background: rgb(237 253 249 / 84%);
  color: #417d78;
}

.energy-astrology-magazine-cover__source[data-refreshing="true"]::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #70cbbb;
  content: "";
  box-shadow: 0 0 0 0 rgb(112 203 187 / 28%);
  animation: energy-provider-pending-pulse 1.6s ease-out infinite;
}

@keyframes energy-provider-pending-pulse {
  70% { box-shadow: 0 0 0 6px rgb(112 203 187 / 0%); }
  100% { box-shadow: 0 0 0 0 rgb(112 203 187 / 0%); }
}
```

在已有 `@media (prefers-reduced-motion: reduce)` 的 `animation: none !important` 列表中加入该伪元素。

- [ ] **Step 7: 运行组件/样式测试并确认通过**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/AstrologyWorld.test.tsx src/components/energy/AstrologyMagazineCover.test.tsx src/components/energy/experiences/HoroscopeExperience.test.tsx src/components/energy/energy-css.test.ts
```

Expected: 四个测试文件全部 PASS。

- [ ] **Step 8: 提交状态表达变更**

```bash
git add apps/web-workbench/src/components/energy/astrology-content.ts apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx apps/web-workbench/src/components/energy/AstrologyMagazineCover.test.tsx apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx apps/web-workbench/src/components/energy/energy-css.test.ts
git commit -m "feat(energy): show DivineAPI auto upgrade state"
```

---

### Task 3: 完整回归、边界审计与交付准备

**Files:**
- Verify only: `apps/web-workbench/**`
- Verify only: `apps/orchestrator/**`
- Verify: repository diff and branch history

**Interfaces:**
- Consumes: Task 1 的有界静默调度和 Task 2 的 pending 状态表达。
- Produces: 可创建 PR 的干净分支、完整门禁证据和明确的敏感配置零改动结论。

- [ ] **Step 1: 运行 Web 完整门禁**

Run:

```bash
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
```

Expected: 179 个测试文件及全部测试通过，lint/typecheck/build exit 0；若测试总数因新增用例增加，以实际输出为准。

- [ ] **Step 2: 运行 Orchestrator 完整门禁**

Run:

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
```

Expected: 253 个测试文件及全部测试通过，typecheck/build exit 0；服务端源文件保持无差异。

- [ ] **Step 3: 审计范围、格式和敏感配置**

Run:

```bash
git diff --check origin/claude/musing-keller-ae1d05...HEAD
git diff --stat origin/claude/musing-keller-ae1d05...HEAD
git diff --name-only origin/claude/musing-keller-ae1d05...HEAD
git status --short
```

Expected: 只出现设计/计划文档与 Task 1–2 列出的 Web 文件；不得出现 `.env`、服务端 astrology、Translator、key、模型或部署配置文件；工作区干净。

- [ ] **Step 4: 做最终自审**

逐项确认：

```text
- pending 只在 providerRefreshPending=true 时承诺自动替换
- 最多三次复查，第四次不会发生
- 静默期间 loading=false
- 普通 local fallback 不自动重试
- 旧 profile/range/period 响应不能覆盖新状态
- reduced motion 禁用新动画
- 没有服务端、密钥或 Translator 变更
```

发现问题时回到对应任务补失败测试、最小修复和提交；全部满足后再创建 PR。

- [ ] **Step 5: 记录交付证据**

在交付说明中记录分支、HEAD、变更文件、每条命令的实际通过数量、未修改的敏感范围，以及生产验收仍需在合并部署后执行。不得把本地通过描述为已上线。
