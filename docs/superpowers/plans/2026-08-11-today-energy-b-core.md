# HOLA DAY 今日能量 B 核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/cosmic` 重构为 Staff 可在一个首屏内开始的轻量情绪陪伴入口，并用统一体验容器承载抽卡、轻测试和今日星座，同时为未来小游戏与 C 阶段内容平台保留稳定扩展接口。

**Architecture:** 新增独立 `energy` 前后端领域。服务端提供 PII 最小化的首页目录和体验事件入口；前端用玩法注册表、推荐纯函数和可访问的 `ExperiencePlayer` 统一所有玩法状态。现有 astrology provider 和纯函数继续作为星座/塔罗适配器，旧 `AstroDashboard` 在所有能力迁移完成后删除。

**Tech Stack:** React 18、TypeScript 5.7、React Router、tRPC 11、Zod、Tailwind CSS、Radix Dialog、Vitest、Testing Library、Happy DOM。

## Global Constraints

- 当前范围只包含设计规格的 P0 与 P1；P2 的最近体验、收藏、帮助反馈，以及 P3 的真实小游戏内容另立计划。
- `/cosmic` 路由、侧边栏“今日能量”名称和现有功能开关保持兼容。
- 首页只突出一个推荐行动；抽卡、轻测试、今日星座和小游戏是平级模式。
- 小游戏尚未上线时使用不可交互的说明卡，不渲染伪按钮。
- 结果不得在用户完成互动前显示；每个玩法使用 `intro → active → result | error` 状态。
- 不上传生日、出生地点、自由文本、测试答案正文或个人情绪明细。
- B 阶段继续使用按用户隔离的本地资料存储；不新增数据库迁移。
- 星座和塔罗 provider 失败时必须保留本地确定性内容。
- 互斥选择必须暴露 `aria-pressed`、单选语义或等价状态，不能只依赖颜色。
- 桌面和窄屏都必须是可读单列/分段详情，不再把长文压进五个窄列。
- 保留现有 HOLA DAY 配色、字体、按钮和 PageShell，不引入新的 UI 依赖。
- 只修改今日能量、astrology/energy 路由及相关测试；不得改动 TaskStream、支付、规划任务、股票、文件、浏览器、图片或视频行为。
- 全程单智能体串行执行，不派生子智能体。

---

## File Structure

### Server

- `apps/orchestrator/src/energy/catalog.ts`：权威玩法目录、首页响应和安全事件枚举。
- `apps/orchestrator/src/energy/catalog.test.ts`：目录过滤、推荐顺序和 PII 边界测试。
- `apps/orchestrator/src/trpc/routers/energy.ts`：`home` 与 `reportEvent` tRPC 入口。
- `apps/orchestrator/src/trpc/routers/energy.test.ts`：鉴权 caller、输入拒绝和结构化日志测试。
- `apps/orchestrator/src/trpc/router.ts`：注册 `energy` router。

### Web domain and shell

- `apps/web-workbench/src/components/energy/energy-types.ts`：体验、情绪和运行阶段类型。
- `apps/web-workbench/src/components/energy/experience-registry.ts`：客户端组件注册和按需资料声明。
- `apps/web-workbench/src/components/energy/experience-registry.test.ts`：唯一 ID、coming-soon 和推荐过滤测试。
- `apps/web-workbench/src/components/energy/energy-recommendation.ts`：状态到回应/推荐的纯函数。
- `apps/web-workbench/src/components/energy/energy-recommendation.test.ts`：四种状态和确定性推荐测试。
- `apps/web-workbench/src/components/energy/ExperiencePlayer.tsx`：统一 intro/active/result/error 容器和焦点管理。
- `apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx`：键盘、焦点恢复、阶段和重玩测试。
- `apps/web-workbench/src/components/energy/MoodCheckIn.tsx`：首屏四项状态签到。
- `apps/web-workbench/src/components/energy/EnergyHome.tsx`：页面编排、推荐和体验启动。
- `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`：首屏层级、状态回应、单一 CTA 和小游戏不可交互测试。
- `apps/web-workbench/src/components/energy/energy.css`：页面宽度、卡片、窄屏与缩放布局。

### Experiences

- `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`：远端 daily/tarot 加载、请求竞争和本地降级。
- `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`：远端成功、失败和过期请求测试。
- `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx`：主题、抽取、翻牌和结果。
- `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx`：结果不可提前显示、重玩和降级测试。
- `apps/web-workbench/src/components/energy/experiences/TestExperience.tsx`：心理状态、关系合拍和今日数字三个轻测试入口。
- `apps/web-workbench/src/components/energy/experiences/test-content.ts`：测试问题、选项和结果纯数据。
- `apps/web-workbench/src/components/energy/experiences/test-content.test.ts`：完整路径、结果映射和禁止临床标签测试。
- `apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx`：选择前无结果、选择状态和返回测试目录。
- `apps/web-workbench/src/components/energy/experiences/horoscope-content.ts`：星盘档案、流年提醒和分段运势纯数据映射。
- `apps/web-workbench/src/components/energy/experiences/horoscope-content.test.ts`：现有深度星座能力迁移回归。
- `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx`：总览、工作、人际、财务、身心和本周节奏分段详情。
- `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx`：分段切换、单列内容和 provider 状态测试。
- `apps/web-workbench/src/components/energy/EnergyProfileDrawer.tsx`：按需星象资料编辑。
- `apps/web-workbench/src/components/energy/EnergyProfileDrawer.test.tsx`：用途说明、保存、清除和焦点恢复测试。

### Integration and cleanup

- `apps/web-workbench/src/pages/AstrologyPage.tsx`：用 `EnergyHome` 替换 `AstroDashboard`。
- `apps/web-workbench/src/components/astrology/AstroDashboard.tsx`：能力全部迁移后删除。
- `apps/web-workbench/src/lib/astrology.ts`：只保留星座资料、reading、task companion 所需纯函数；删除页面专用存储和编排数据。
- `apps/web-workbench/src/lib/astrology.test.ts`：保留生日边界、用户隔离和确定性 reading 回归。
- `apps/web-workbench/src/pages/AstrologyPage.test.tsx`：渲染真实页面壳并验证 EnergyHome 首屏。

---

### Task 1: 建立服务端 energy 目录与安全事件入口

**Files:**
- Create: `apps/orchestrator/src/energy/catalog.ts`
- Create: `apps/orchestrator/src/energy/catalog.test.ts`
- Create: `apps/orchestrator/src/trpc/routers/energy.ts`
- Create: `apps/orchestrator/src/trpc/routers/energy.test.ts`
- Modify: `apps/orchestrator/src/trpc/router.ts`

**Interfaces:**
- Produces: `EnergyExperienceKind`, `EnergyMood`, `EnergyExperienceCatalogItem`, `buildEnergyHome()`, `energyRouter.home`, `energyRouter.reportEvent`。
- Consumes: `protectedProcedure`、`ctx.logger`，不访问数据库。

- [ ] **Step 1: 写目录失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { buildEnergyHome } from './catalog.js';

describe('buildEnergyHome', () => {
  it('returns three active modes and one non-interactive coming-soon game', () => {
    const home = buildEnergyHome();
    expect(home.experiences.map((item) => [item.id, item.status])).toEqual([
      ['tarot', 'active'],
      ['light-test', 'active'],
      ['horoscope', 'active'],
      ['games', 'coming-soon'],
    ]);
    expect(home.experiences.find((item) => item.id === 'games')?.actionable).toBe(false);
  });

  it('does not expose profile values or free-form payload fields', () => {
    expect(JSON.stringify(buildEnergyHome())).not.toMatch(/birthday|birthPlace|answerText/);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/energy/catalog.test.ts`

Expected: FAIL，提示 `./catalog.js` 不存在。

- [ ] **Step 3: 实现最小目录类型与响应**

```ts
export type EnergyExperienceKind = 'card' | 'test' | 'horoscope' | 'game';
export type EnergyExperienceStatus = 'active' | 'coming-soon' | 'hidden';
export type EnergyMood = 'good' | 'tired' | 'stressed' | 'unwind';

export interface EnergyExperienceCatalogItem {
  id: 'tarot' | 'light-test' | 'horoscope' | 'games';
  kind: EnergyExperienceKind;
  title: string;
  description: string;
  estimatedSeconds: number;
  status: EnergyExperienceStatus;
  actionable: boolean;
}

const EXPERIENCES: EnergyExperienceCatalogItem[] = [
  { id: 'tarot', kind: 'card', title: '抽张卡', description: '给当下一个轻提示', estimatedSeconds: 30, status: 'active', actionable: true },
  { id: 'light-test', kind: 'test', title: '轻测试', description: '用一分钟看见现在的状态', estimatedSeconds: 60, status: 'active', actionable: true },
  { id: 'horoscope', kind: 'horoscope', title: '今日星座', description: '看看今天适合怎样安排节奏', estimatedSeconds: 60, status: 'active', actionable: true },
  { id: 'games', kind: 'game', title: '小游戏', description: '轻量小游戏正在准备中', estimatedSeconds: 180, status: 'coming-soon', actionable: false },
];

export function buildEnergyHome(): { experiences: EnergyExperienceCatalogItem[] } {
  return { experiences: EXPERIENCES.map((item) => ({ ...item })) };
}
```

- [ ] **Step 4: 写 router caller 与日志失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { energyRouter } from './energy.js';

describe('energyRouter', () => {
  it('returns the catalog for an authenticated caller', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);
    await expect(caller.home()).resolves.toMatchObject({ experiences: [{ id: 'tarot' }] });
  });

  it('logs only bounded event fields', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);
    await caller.reportEvent({
      type: 'completed',
      experienceId: 'tarot',
      mood: 'tired',
      durationBucket: 'under-60s',
      outcome: 'success',
    });
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'energy_experience_event',
        type: 'completed',
        experienceId: 'tarot',
        mood: 'tired',
        durationBucket: 'under-60s',
        outcome: 'success',
      },
      'energy experience event',
    );
  });
});
```

- [ ] **Step 5: 实现 router 并注册到 appRouter**

使用严格 Zod schema，只接受：

```ts
const energyEventInput = z.object({
  type: z.enum(['started', 'completed', 'replayed', 'failed']),
  experienceId: z.enum(['tarot', 'light-test', 'horoscope', 'games']),
  mood: z.enum(['good', 'tired', 'stressed', 'unwind']).nullable(),
  durationBucket: z.enum(['under-60s', 'one-to-three-minutes', 'over-three-minutes']).nullable(),
  outcome: z.enum(['success', 'abandoned', 'error']).nullable(),
}).strict();
```

`reportEvent` 只调用 `ctx.logger.info`，返回 `{ ok: true }`。在 `appRouter` 中加入 `energy: energyRouter`。

- [ ] **Step 6: 运行目标测试和类型检查**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/energy/catalog.test.ts src/trpc/routers/energy.test.ts`

Expected: PASS。

Run: `pnpm --filter @holaday/orchestrator typecheck`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/orchestrator/src/energy apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/trpc/routers/energy.test.ts apps/orchestrator/src/trpc/router.ts
git commit -m "feat(energy): add experience catalog and events"
```

### Task 2: 建立前端玩法注册与推荐纯函数

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-types.ts`
- Create: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Create: `apps/web-workbench/src/components/energy/experience-registry.test.ts`
- Create: `apps/web-workbench/src/components/energy/energy-recommendation.ts`
- Create: `apps/web-workbench/src/components/energy/energy-recommendation.test.ts`

**Interfaces:**
- Consumes: Task 1 的稳定 ID 和枚举字面量。
- Produces: `EnergyMood`, `ExperiencePhase`, `EnergyExperienceDefinition`, `ENERGY_EXPERIENCES`, `energyResponseForMood()`, `recommendExperience()`。

- [ ] **Step 1: 写注册表和推荐失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { ENERGY_EXPERIENCES, activeEnergyExperiences } from './experience-registry';
import { energyResponseForMood, recommendExperience } from './energy-recommendation';

describe('energy registry', () => {
  it('has stable unique ids and excludes games from actionable entries', () => {
    expect(new Set(ENERGY_EXPERIENCES.map((item) => item.id)).size).toBe(4);
    expect(activeEnergyExperiences().map((item) => item.id)).toEqual(['tarot', 'light-test', 'horoscope']);
    expect(ENERGY_EXPERIENCES.find((item) => item.id === 'games')?.actionable).toBe(false);
  });
});

describe('energy recommendations', () => {
  it.each([
    ['good', 'light-test'],
    ['tired', 'tarot'],
    ['stressed', 'tarot'],
    ['unwind', 'light-test'],
  ] as const)('maps %s to one actionable recommendation', (mood, expected) => {
    expect(recommendExperience(mood).id).toBe(expected);
    expect(energyResponseForMood(mood).action.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experience-registry.test.ts src/components/energy/energy-recommendation.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 定义类型和注册表**

```ts
export type EnergyMood = 'good' | 'tired' | 'stressed' | 'unwind';
export type EnergyExperienceId = 'tarot' | 'light-test' | 'horoscope' | 'games';
export type ExperiencePhase = 'intro' | 'active' | 'result' | 'error';

export interface EnergyExperienceDefinition {
  id: EnergyExperienceId;
  kind: 'card' | 'test' | 'horoscope' | 'game';
  title: string;
  description: string;
  estimatedSeconds: number;
  status: 'active' | 'coming-soon' | 'hidden';
  actionable: boolean;
  requiredProfileFields: Array<'birthday' | 'birthTime' | 'birthPlace'>;
}

export interface EnergyExperienceProps {
  mood: EnergyMood | null;
  profileStorageScope: string | null;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
}
```

注册表必须与 Task 1 顺序和文案一致。`activeEnergyExperiences()` 返回 `status === 'active' && actionable` 的新数组。

- [ ] **Step 4: 实现四种状态回应和确定性推荐**

```ts
const RESPONSES = {
  good: { title: '把这股状态留给真正重要的一件事', body: '不用把今天塞满，选一件值得推进的小事就好。', action: '开始一个轻测试' },
  tired: { title: '先让自己松一点', body: '疲惫不是拖延。给身体半分钟，再决定下一步。', action: '抽一张轻提示卡' },
  stressed: { title: '你不用现在解决全部事情', body: '先把最吵的一件事放到旁边，留一个可以呼吸的空格。', action: '抽一张安定卡' },
  unwind: { title: '这几分钟只用来放空', body: '不需要产出，也不需要证明什么。玩一个轻体验就好。', action: '玩一个轻测试' },
} satisfies Record<EnergyMood, { title: string; body: string; action: string }>;
```

- [ ] **Step 5: 运行测试、lint 和类型检查**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experience-registry.test.ts src/components/energy/energy-recommendation.test.ts`

Expected: PASS。

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web-workbench/src/components/energy/energy-types.ts apps/web-workbench/src/components/energy/experience-registry.ts apps/web-workbench/src/components/energy/experience-registry.test.ts apps/web-workbench/src/components/energy/energy-recommendation.ts apps/web-workbench/src/components/energy/energy-recommendation.test.ts
git commit -m "feat(energy): add experience registry and recommendations"
```

### Task 3: 建立可访问的统一体验容器

**Files:**
- Create: `apps/web-workbench/src/components/energy/ExperiencePlayer.tsx`
- Create: `apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx`

**Interfaces:**
- Consumes: `ExperiencePhase`, `EnergyExperienceDefinition`。
- Produces: `ExperiencePlayer`，props 为 `open`, `experience`, `phase`, `returnFocusRef`, `onClose`, `onStart`, `onReplay`, `children`。

- [ ] **Step 1: 写焦点和阶段失败测试**

测试必须覆盖：打开后焦点进入“开始体验”；Escape 关闭；关闭后焦点返回启动按钮；`intro` 不渲染结果插槽；`result` 显示“再来一次”和“换个玩法”。使用 `// @vitest-environment happy-dom`、Testing Library 和 `userEvent`。

核心断言：

```tsx
expect(screen.getByRole('dialog', { name: '抽张卡' })).toBeTruthy();
expect(document.activeElement).toBe(screen.getByRole('button', { name: '开始体验' }));
expect(screen.queryByText('结果内容')).toBeNull();
await user.keyboard('{Escape}');
expect(document.activeElement).toBe(trigger);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/ExperiencePlayer.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现容器**

使用现有 Radix Dialog 依赖。`Dialog.Title` 使用玩法标题，`Dialog.Description` 使用预计时长和说明。`intro` 只显示开始按钮；`active` 与 `result` 通过具名 children 渲染；`error` 显示重试与返回。不要在容器内保存具体玩法答案。

```ts
interface ExperiencePlayerProps {
  open: boolean;
  experience: EnergyExperienceDefinition | null;
  phase: ExperiencePhase;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onStart: () => void;
  onReplay: () => void;
  onChooseAnother: () => void;
  children: React.ReactNode;
}
```

Radix `onCloseAutoFocus` 必须 `preventDefault()` 后聚焦 `returnFocusRef.current`。`onEscapeKeyDown` 只关闭，不提交事件结果。

- [ ] **Step 4: 运行测试和控制提示门槛**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/ExperiencePlayer.test.tsx src/components/control-tooltip.test.ts`

Expected: PASS。所有图标按钮同时具备 `aria-label` 与 native `title`。

- [ ] **Step 5: 提交**

```bash
git add apps/web-workbench/src/components/energy/ExperiencePlayer.tsx apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx
git commit -m "feat(energy): add accessible experience player"
```

### Task 4: 建立一个首屏内的 EnergyHome

**Files:**
- Create: `apps/web-workbench/src/components/energy/MoodCheckIn.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`
- Create: `apps/web-workbench/src/components/energy/energy.css`

**Interfaces:**
- Consumes: `ENERGY_EXPERIENCES`, `energyResponseForMood`, `recommendExperience`, `ExperiencePlayer`, `trpc.energy.home`, `trpc.energy.reportEvent`。
- Produces: `EnergyHome({ profileStorageScope })`。

- [ ] **Step 1: 写首屏层级失败测试**

测试使用 mock registry，不发真实网络。断言：

```tsx
expect(screen.getByRole('heading', { name: '你现在感觉怎么样？' })).toBeTruthy();
const moodGroup = screen.getByRole('group', { name: '当前状态' });
expect(within(moodGroup).getAllByRole('button', { pressed: false })).toHaveLength(4);
expect(screen.getAllByRole('button', { name: /开始|抽一张|看看/ })).toHaveLength(1);
expect(screen.getByText('小游戏正在准备中')).toBeTruthy();
expect(screen.queryByRole('button', { name: /小游戏/ })).toBeNull();
```

点击“有点累”后断言回应原位更新，按钮具有 `aria-pressed="true"`，推荐只有 tarot 一个主 CTA。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyHome.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现 MoodCheckIn**

使用 `role="group" aria-label="当前状态"` 和四个 `button type="button" aria-pressed={selected}`。组件只接收 `value` 与 `onChange`，不读取存储、不调用 API。

- [ ] **Step 4: 实现 EnergyHome 编排**

顺序固定为：状态签到 → 原位回应/今日推荐 → 四个玩法入口 → 我的能量入口。页面 mount 时调用一次 `trpc.energy.home.query()`；失败时使用本地注册表，不显示全页错误。

状态仅保留在当前 React state。启动、完成、重玩和失败通过 fire-and-forget `reportEvent` 上报；catch 只记录 `console.warn('energy event report failed')`，不得阻断体验。

- [ ] **Step 5: 实现响应式 CSS**

`energy.css` 必须包含：

```css
.energy-page { max-width: 1180px; margin: 0 auto; }
.energy-mode-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.energy-detail-copy { max-width: 68ch; }
@media (max-width: 900px) { .energy-mode-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .energy-mode-grid { grid-template-columns: 1fr; } }
```

不得在 `energy.css` 给 PageShell 根容器重设顶部 padding。真实桌面、窄屏、200% 缩放和水平滚动由 Task 9 的浏览器验收负责，不用读取 CSS 源码制造 change-detector 测试。

- [ ] **Step 6: 运行目标测试和类型检查**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyHome.test.tsx`

Expected: PASS。

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web-workbench/src/components/energy/MoodCheckIn.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/EnergyHome.test.tsx apps/web-workbench/src/components/energy/energy.css
git commit -m "feat(energy): build focused energy home"
```

### Task 5: 迁移轻测试并禁止提前结果

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/test-content.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/test-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/TestExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx`

**Interfaces:**
- Consumes: `AstroProfile`, `ZodiacSign` 和体验容器 active/result 回调。
- Produces: 三个测试定义 `psychology`, `compatibility`, `daily-number`，以及 `TestExperience`。

- [ ] **Step 1: 写内容完整性失败测试**

每个测试必须有 1 到 3 个问题、每题至少两个选项、所有结果 ID 可达。加入临床词扫描：

```ts
const forbidden = /抑郁症|焦虑症|人格障碍|诊断|治疗方案/;
expect(JSON.stringify(LIGHT_TESTS)).not.toMatch(forbidden);
```

心理测试沿用现有 fast/steady/soft 内容；合盘匹配和今日数字沿用现有确定性算法，但从 UI 文件提取为纯函数。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/test-content.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现测试内容和结果函数**

定义：

```ts
interface LightTestDefinition {
  id: 'psychology' | 'compatibility' | 'daily-number';
  title: string;
  estimatedSeconds: number;
  questions: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string; body: string }> }>;
  resultFor: (answers: string[], context: LightTestContext) => LightTestResult;
}
```

`LightTestResult` 固定包含 `title`, `body`, `strength`, `reminder`, `action`。不返回诊断或分数排名。

- [ ] **Step 4: 写 UI 失败测试**

进入心理测试后，选择前 `queryByText('今日心理画像')` 必须为空；完成最后一题后才显示结果。被选选项必须 `aria-pressed="true"`。点击“再来一次”后答案和结果都清空。

- [ ] **Step 5: 实现 TestExperience**

体验内先显示三个测试入口；选择一个后进入题目。目录与题目是同一组件的内部状态，但最终阶段通过 `onPhaseChange('result')` 告知容器。切换测试会重置答案。

- [ ] **Step 6: 运行目标测试**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/test-content.test.ts src/components/energy/experiences/TestExperience.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web-workbench/src/components/energy/experiences/test-content.ts apps/web-workbench/src/components/energy/experiences/test-content.test.ts apps/web-workbench/src/components/energy/experiences/TestExperience.tsx apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx
git commit -m "feat(energy): add focused light tests"
```

### Task 6: 迁移塔罗并统一 astrology 降级

**Files:**
- Create: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Create: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx`

**Interfaces:**
- Consumes: `trpc.astrology.daily`, `trpc.astrology.tarot`, `buildAstroReading`, `AstroProfile`。
- Produces: `useEnergyAstrology(profile, liveProvider)` 和 `TarotExperience`。

- [ ] **Step 1: 写 provider hook 失败测试**

通过依赖注入或模块 mock 覆盖：远端 daily/tarot 成功合并；远端 reject 后 `source === 'local-fallback'`；profile 快速变化时旧请求不得覆盖新请求。

返回类型固定为：

```ts
interface EnergyAstrologyState {
  reading: AstroReading;
  tarot: { title: string; subtitle: string; body: string };
  source: 'provider' | 'local-fallback';
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
```

- [ ] **Step 2: 运行 hook 测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx`

Expected: FAIL，hook 不存在。

- [ ] **Step 3: 实现请求竞争保护和降级**

沿用旧组件的递增 `requestIdRef`。远端失败时不清空本地 reading/tarot；只设置低噪声错误文案“暂时使用本地提示”。卸载时递增 request id。

- [ ] **Step 4: 写塔罗流程失败测试**

流程断言：intro 选择主题；点击“开始抽卡”进入 active；active 阶段不出现牌名；点击“翻开这张卡”后才出现结果；replay 返回主题选择。主题使用 `work`, `relationship`, `space` 三个值并暴露互斥状态。

- [ ] **Step 5: 实现 TarotExperience**

结果固定由 provider tarot 加上主题对应的行动文案组成。不要在点击开始前调用复制、保存或事件上报。Reduced-motion 下不播放翻转动画，只即时切换内容。

- [ ] **Step 6: 运行目标测试和既有 astrology 测试**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx src/components/energy/experiences/TarotExperience.test.tsx src/lib/astrology.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web-workbench/src/components/energy/useEnergyAstrology.ts apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx
git commit -m "feat(energy): migrate tarot with local fallback"
```

### Task 7: 迁移今日星座与按需个人资料

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/horoscope-content.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/horoscope-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx`
- Create: `apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyProfileDrawer.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyProfileDrawer.test.tsx`

**Interfaces:**
- Consumes: `EnergyAstrologyState`, `readAstroProfile`, `saveAstroProfile`, `clearAstroProfile`, `zodiacOptions`。
- Produces: `HoroscopeExperience` 与 `EnergyProfileDrawer`。

- [ ] **Step 1: 写深度星座内容迁移失败测试**

从旧组件迁移 `buildNatalSnapshot` 和流年提醒映射。固定日期与 profile 下，测试必须得到太阳星座、月亮提示、上升提示、长期建议和七日节奏；输出不得包含 React 节点或本地存储调用。

- [ ] **Step 2: 运行纯数据测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/horoscope-content.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 horoscope-content 纯函数**

将旧 `buildNatalSnapshot`、`buildTransitReportText` 所依赖的计算迁入该文件。导出 `buildNatalSnapshot(profile, reading)` 和 `buildTransitSnapshot(reading)`，保持现有确定性结果，不读取 UI state。

- [ ] **Step 4: 写分段详情失败测试**

默认只显示“总览”。切换“工作”“人际”“财务”“身心”“本周”后，只存在当前 panel 的长文；不得同时渲染五个长文列。二级入口“星盘档案”和“流年提醒”继续保留旧能力，但不与日运 tabs 同时展开。tabs 使用 `role="tablist"`, `role="tab"`, `aria-selected` 和关联 `tabpanel`。

- [ ] **Step 5: 运行 UI 测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/HoroscopeExperience.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 6: 实现 HoroscopeExperience**

将 `reading.fortune` 映射为分段内容；“本周”显示七日紧凑列表，在窄屏保持单列。source 为 fallback 时显示“暂时使用本地提示”，不显示错误红屏。

- [ ] **Step 7: 写个人资料抽屉失败测试**

断言生日字段显示用途“用于计算星座”；出生时间和地点默认隐藏；点击“完善星象资料”后出现；保存调用 `saveAstroProfile`；清除要求二次确认；关闭后焦点返回“我的能量”。

- [ ] **Step 8: 实现 EnergyProfileDrawer**

使用 Radix Dialog。资料 state 只在抽屉打开时初始化，避免用户切换玩法时覆盖草稿。保存后调用 `onProfileChange(next)` 触发 hook 刷新。

- [ ] **Step 9: 运行目标测试**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/horoscope-content.test.ts src/components/energy/experiences/HoroscopeExperience.test.tsx src/components/energy/EnergyProfileDrawer.test.tsx src/lib/astrology.test.ts`

Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add apps/web-workbench/src/components/energy/experiences/horoscope-content.ts apps/web-workbench/src/components/energy/experiences/horoscope-content.test.ts apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.tsx apps/web-workbench/src/components/energy/experiences/HoroscopeExperience.test.tsx apps/web-workbench/src/components/energy/EnergyProfileDrawer.tsx apps/web-workbench/src/components/energy/EnergyProfileDrawer.test.tsx
git commit -m "feat(energy): add segmented horoscope and profile drawer"
```

### Task 8: 接入页面并删除旧编排

**Files:**
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/pages/AstrologyPage.tsx`
- Delete: `apps/web-workbench/src/components/astrology/AstroDashboard.tsx`
- Modify: `apps/web-workbench/src/lib/astrology.ts`
- Modify: `apps/web-workbench/src/lib/astrology.test.ts`
- Create: `apps/web-workbench/src/pages/AstrologyPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 2-7 全部组件和现有 AppShell `me.userId`。
- Produces: `/cosmic` 完整 B 阶段页面，不再引用 `AstroDashboard`。

- [ ] **Step 1: 写页面渲染失败测试**

将 `AstrologyPageShell` 导出用于真实组件测试，使用 `liveProvider={false}` 和 `profileStorageScope={null}` 渲染。断言页面包含“今日能量”、`当前状态` group、四个状态按钮和一个主推荐 CTA；不得 mock `EnergyHome`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/pages/AstrologyPage.test.tsx`

Expected: FAIL，页面仍引用旧组件。

- [ ] **Step 3: 为注册表加入组件懒加载**

在 `experience-registry.ts` 增加：

```ts
export interface EnergyExperienceRegistration extends EnergyExperienceDefinition {
  load: () => Promise<{ default: React.ComponentType<EnergyExperienceProps> }>;
}
```

三个 active 项使用动态 import，并把命名导出映射为 default；`games` 不提供 loader。为 loader 增加测试，确认只在调用 `load()` 后解析玩法模块。

- [ ] **Step 4: 连接三个玩法与统一容器**

`EnergyHome` 根据 active experience ID 渲染 `TarotExperience`, `TestExperience`, `HoroscopeExperience`。关闭或换玩法时清理体验内部 state。`games` 永远不能成为 active ID。

- [ ] **Step 5: 替换 AstrologyPage**

PageHeader 文案改为：

```tsx
<PageHeader
  title="今日能量"
  description="工作间隙，给自己一点轻松、鼓励和重新出发的空间。"
/>
```

生产 `/cosmic` 继续使用 `me.userId`；非 live preview 使用 `null` scope。

- [ ] **Step 6: 删除旧编排并收紧 astrology lib**

删除 `AstroDashboard.tsx`。只从 `lib/astrology.ts` 移除已搬到 energy 域且没有其他引用的页面常量/存储函数；必须保留 `AstroTaskCompanion` 依赖的 `buildAstroTaskInsight`、profile 和 reading 函数。

- [ ] **Step 7: 运行引用搜索和目标测试**

Run: `rg -n "AstroDashboard|多元化命理|任务等待模式" apps/web-workbench/src`

Expected: 无生产代码命中；测试可以出现禁止项断言。

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/pages/AstrologyPage.test.tsx src/components/energy src/lib/astrology.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/web-workbench/src/pages/AstrologyPage.tsx apps/web-workbench/src/pages/AstrologyPage.test.tsx apps/web-workbench/src/components/energy apps/web-workbench/src/lib/astrology.ts apps/web-workbench/src/lib/astrology.test.ts
git rm apps/web-workbench/src/components/astrology/AstroDashboard.tsx
git commit -m "refactor(energy): replace the cosmic dashboard"
```

### Task 9: 完整验证、真实浏览器验收与交付记录

**Files:**
- Modify only if validation finds an in-scope defect: `apps/web-workbench/src/components/energy/**`, `apps/orchestrator/src/energy/**`, `apps/orchestrator/src/trpc/routers/energy.ts`
- Create: `docs/qa/today-energy-b-release-checklist.md`

**Interfaces:**
- Consumes: 完成后的 B 页面。
- Produces: 可复核的测试与浏览器证据；不部署。

- [ ] **Step 1: 运行后端目标测试**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/energy/catalog.test.ts src/trpc/routers/energy.test.ts src/astrology/service.test.ts`

Expected: PASS。

- [ ] **Step 2: 运行前端目标测试**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/energy src/pages/AstrologyPage.test.tsx src/lib/astrology.test.ts src/lib/sidebar-feature-nav.test.ts src/components/control-tooltip.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行完整门槛**

Run serially:

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
git diff --check
```

Expected: 全部 PASS。若全仓 lint 存在任务外历史噪声，额外运行触及文件的 ESLint 并在清单中逐项记录，不得把部分门槛表述成完整通过。

- [ ] **Step 4: 启动本地应用并做桌面浏览器验收**

目标路径：`/cosmic → 选择状态 → 启动推荐玩法 → 完成结果 → 重玩 → 返回首页`。

验收：页面标题正确、首屏非空、无框架错误覆盖层、console warn/error 为零、小游戏不可点击、只有一个主推荐 CTA、个人资料抽屉焦点恢复。

- [ ] **Step 5: 做窄屏与键盘验收**

使用 390×844 viewport。Tab/Shift+Tab/Escape 完成状态签到、打开/关闭玩法、三类玩法主路径。检查无水平滚动、长文不进入多列、触控目标至少 44×44。

- [ ] **Step 6: 做 provider 失败验收**

在本地 mock 远端 astrology 请求失败，确认首页、抽卡和星座仍展示本地内容，只有低噪声 fallback 提示。

- [ ] **Step 7: 写发布清单**

清单必须记录：commit 范围、实际测试数量、浏览器 URL/viewport、截图路径、控制台结果、未验证项、数据库/支付/TaskStream 影响为无、部署仍需单独授权。

- [ ] **Step 8: 提交验证记录**

```bash
git add docs/qa/today-energy-b-release-checklist.md
git commit -m "docs(energy): record B release verification"
```

---

## Deferred Plans

- P2：最近体验、结果收藏、“有帮助”反馈、服务端最小化保留策略。
- P3：首批独立小游戏、懒加载隔离、完成页和效果验证。
- C：内容运营后台、版本发布、活动编排、游戏资源管理和运营分析。

这些范围不得在 B 核心实现中顺手加入。
