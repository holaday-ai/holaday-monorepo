# HOLA DAY “我的能量架” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagent-driven development unless the user explicitly replaces the single-agent constraint below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在今日能量页面底部增加仅存本机的“最近玩过 / 我的收藏”能量架，让用户跨日找回已完成体验并集中查看现有收藏。

**Architecture:** 将 v3 本地进度无损迁移为 v4，在 `energy-progress.ts` 中增加经过严格验证的最近体验引用；收藏继续从现有三组稳定 ID 派生。新的 `energy-shelf.ts` 只负责把本地引用解析为展示模型，`EnergyShelf.tsx` 负责标签与视觉卡片，`EnergyHome.tsx` 继续掌握体验打开、完成和收藏变更动作。

**Tech Stack:** React 18、TypeScript 5.7、Vitest 2、Testing Library、Happy DOM、现有 CSS 与 Lucide 图标

## Global Constraints

- 不增加“有帮助 / 不适合”、评分、点赞或任何反馈入口。
- 不新增数据库、migration、tRPC 路由、分析事件或管理后台。
- 不保存状态签到、测试答案、测试得分轨迹、塔罗自由问题、生日、出生地或自由文本。
- 本地进度键升级为 `holaday.energy.progress.v4`，必须兼容并迁移 v3、v2 和 v1。
- 最近体验只记录真实 `onExperienceComplete`；轻投票、星座专刊周期切换和十二星座浏览不制造伪完成。
- 最近体验最多 12 项、保留 30 天、相同入口重复完成只置顶。
- 收藏继续由 `savedCardIds`、`savedTestActionIds` 和 `continuation.favoriteContentIds` 派生。
- 登录用户按用户 ID 隔离；预览模式只使用当前窗口级内存，不创建 guest localStorage。
- 图标按钮必须同时提供 `aria-label` 与原生 `title`；触控目标不小于 44×44 CSS 像素。
- 新增动效必须在 `prefers-reduced-motion: reduce` 下关闭。
- 只修改今日能量 Web 领域与相关文档，不修改 Orchestrator、DivineAPI、Translator、OpenAI、支付或部署配置。
- 执行时使用单智能体串行流程，不派生子智能体。

---

## File Structure

### New files

- `apps/web-workbench/src/components/energy/energy-shelf.ts`：把最近体验与三类收藏解析为稳定的展示模型；不读写 storage。
- `apps/web-workbench/src/components/energy/energy-shelf.test.ts`：解析、过滤、日期标签和重新进入目标的纯逻辑测试。
- `apps/web-workbench/src/components/energy/EnergyShelf.tsx`：标签、空状态、视觉卡片、打开和取消收藏动作。
- `apps/web-workbench/src/components/energy/EnergyShelf.test.tsx`：ARIA、键盘、按钮与空状态测试。

### Modified files

- `apps/web-workbench/src/components/energy/energy-progress.ts`：v4 迁移、最近记录验证、原子完成写入、收藏移除。
- `apps/web-workbench/src/components/energy/energy-progress.test.ts`：迁移、隐私、保留、去重、上限与用户隔离。
- `apps/web-workbench/src/components/energy/EnergyHome.tsx`：完成时写最近记录、渲染能量架、复用现有打开与收藏动作。
- `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`：完成 → 能量架 → 重新进入的集成路径和零服务端新增事件。
- `apps/web-workbench/src/components/energy/energy.css`：能量架马卡龙容器、卡片、响应式与动效。
- `apps/web-workbench/src/components/energy/energy-css.test.ts`：布局和 reduced-motion 规则门禁。

---

### Task 1: v4 本地进度与最近体验写入

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy-progress.ts`
- Test: `apps/web-workbench/src/components/energy/energy-progress.test.ts`

**Interfaces:**
- Consumes: `EnergyExperienceLaunchTarget`、`EnergyCompletionKind`、现有 `readEnergyProgress()` 与窗口级预览存储。
- Produces: `EnergyRecentExperience`、`recordCompletedEnergyExperience()`、`removeSavedEnergyCard()`、`removeSavedLightTestAction()`，供 Task 2 与 Task 4 使用。

- [ ] **Step 1: 写 v3 → v4 迁移失败测试**

在 `energy-progress.test.ts` 增加 v3 fixture，证明旧完成记录与收藏保留、最近列表为空，并且读取后创建 v4：

```ts
it('migrates v3 progress into v4 without losing completion or favorites', () => {
  window.localStorage.setItem(
    'holaday.energy.progress.v3:usr_a',
    JSON.stringify({
      completedDates: ['2026-08-14'],
      collectedKinds: ['tarot'],
      savedCardIds: ['work-01'],
      completedTestIds: ['work-focus'],
      savedTestActionIds: ['work-focus:steady'],
      seenContentIds: ['relax-breath-window'],
      completedKindsByDate: { '2026-08-14': ['tarot'] },
      seenContentDateKey: '2026-08-14',
      continuation: {
        dateKey: '2026-08-14',
        lastTarget: { type: 'tarot', mode: 'single', theme: 'work' },
        lastCompletedKind: 'tarot',
        completedPracticeIds: [],
        pollSelections: {},
        favoriteContentIds: ['relax-breath-window'],
      },
    }),
  );

  const progress = readEnergyProgress('usr_a', new Date(2026, 7, 14, 12));

  expect(progress.shelf.recentExperiences).toEqual([]);
  expect(progress.savedCardIds).toEqual(['work-01']);
  expect(progress.savedTestActionIds).toEqual(['work-focus:steady']);
  expect(progress.continuation.favoriteContentIds).toEqual(['relax-breath-window']);
  expect(window.localStorage.getItem('holaday.energy.progress.v4:usr_a')).not.toBeNull();
});
```

- [ ] **Step 2: 写最近记录失败测试**

覆盖写入、重复置顶、30 天清理、12 项上限和不匹配数据拒绝：

```ts
it('keeps twelve recent completed experiences, dedupes and removes expired entries', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-14T03:00:00.000Z'));

  recordCompletedEnergyExperience(
    'usr_a',
    {
      experienceId: 'tarot',
      launchTarget: { type: 'tarot', mode: 'single', theme: 'work' },
      kind: 'tarot',
    },
    new Date('2026-07-01T03:00:00.000Z'),
  );
  recordCompletedEnergyExperience(
    'usr_a',
    {
      experienceId: 'tarot',
      launchTarget: { type: 'tarot', mode: 'single', theme: 'work' },
      kind: 'tarot',
    },
    new Date('2026-08-14T02:00:00.000Z'),
  );
  recordCompletedEnergyExperience(
    'usr_a',
    {
      experienceId: 'tarot',
      launchTarget: { type: 'tarot', mode: 'single', theme: 'work' },
      kind: 'tarot',
    },
    new Date('2026-08-14T02:30:00.000Z'),
  );

  const progress = readEnergyProgress('usr_a');
  expect(progress.shelf.recentExperiences).toEqual([
    expect.objectContaining({
      experienceId: 'tarot',
      completedAt: '2026-08-14T02:30:00.000Z',
    }),
  ]);
});
```

为 12 项上限使用不同的合法 `experienceId + launchTarget` 组合；另加测试证明默认 `tarot` / `light-test` / `games` 的空目标合法，而 `practice + null`、kind 不匹配和 `poll` 被拒绝。为隐私边界直接向 v4 storage 注入带未知 `question` 字段的 tarot 目标，并断言读取后被过滤。

- [ ] **Step 3: 写收藏移除失败测试**

```ts
it('removes saved cards and test actions without deleting completion history', () => {
  const completedAt = new Date('2026-08-14T02:00:00.000Z');
  recordEnergyCompletion('usr_a', 'tarot', completedAt);
  saveEnergyCardIds('usr_a', ['work-01']);
  saveLightTestAction('usr_a', 'work-focus', 'steady');

  removeSavedEnergyCard('usr_a', 'work-01');
  removeSavedLightTestAction('usr_a', 'work-focus', 'steady');

  const progress = readEnergyProgress('usr_a', completedAt);
  expect(progress.savedCardIds).toEqual([]);
  expect(progress.savedTestActionIds).toEqual([]);
  expect(progress.completedKindsByDate['2026-08-14']).toEqual(['tarot']);
});
```

- [ ] **Step 4: 运行进度测试并确认旧实现失败**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-progress.test.ts
```

Expected: FAIL；`shelf`、`recordCompletedEnergyExperience` 和两个移除函数尚不存在。

- [ ] **Step 5: 实现 v4 类型、校验与迁移**

在 `energy-progress.ts` 增加：

```ts
const STORAGE_PREFIX = 'holaday.energy.progress.v4';
const V3_STORAGE_PREFIX = 'holaday.energy.progress.v3';
const MAX_RECENT_EXPERIENCES = 12;
const RECENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const RECENT_EXPERIENCE_KIND = {
  recharge: 'recharge',
  practice: 'recharge',
  tarot: 'tarot',
  'light-test': 'test',
  horoscope: 'horoscope',
  games: 'game',
} as const satisfies Record<string, EnergyCompletionKind>;

export type EnergyRecentExperienceId = keyof typeof RECENT_EXPERIENCE_KIND;

export interface EnergyRecentExperience {
  experienceId: EnergyRecentExperienceId;
  launchTarget: EnergyExperienceLaunchTarget | null;
  kind: EnergyCompletionKind;
  completedAt: string;
}
```

为 `EnergyProgress` 增加：

```ts
shelf: {
  recentExperiences: EnergyRecentExperience[];
};
```

新增 `parseRecentExperiences(value, now)`：逐项验证 experienceId、kind、ISO 时间、未来偏移、30 天范围和 launchTarget 配对；按标准化 key 去重、按时间倒序并裁到 12 项。非空目标的合法配对固定为：

```ts
const TARGET_TYPE_BY_EXPERIENCE = {
  practice: 'practice',
  tarot: 'tarot',
  'light-test': 'test',
  games: 'game',
} as const;
```

目标匹配规则必须写成显式函数：`launchTarget === null` 时允许 `recharge`、`tarot`、`light-test`、`horoscope` 和 `games`，只拒绝必须带练习 ID 的 `practice`；非空时只允许上表中的同类型目标。`kind` 必须等于 `RECENT_EXPERIENCE_KIND[experienceId]`。去重键由一个共享的 `recentExperienceKey()` 生成：默认入口为 `${experienceId}:default`；practice/test/game 使用稳定内容 ID；tarot 使用 `mode + theme ?? 'all'`，不对原始对象直接 `JSON.stringify()`。

`readEnergyProgress()` 的读取顺序改为 v4 → v3 → v2 → v1；任何旧版本成功读取后都写入 v4。已有字段解析逻辑不改变。同步更新本文件现有测试的完整 `EnergyProgress` 期望对象，增加 `shelf: { recentExperiences: [] }`；旧的 v3 写入断言改为 v4，避免靠宽松 matcher 掩盖迁移错误。

- [ ] **Step 6: 实现原子完成与收藏移除**

新增签名：

```ts
interface CompletedEnergyExperienceInput {
  experienceId: EnergyRecentExperienceId;
  launchTarget: EnergyExperienceLaunchTarget | null;
  kind: EnergyCompletionKind;
}

export function recordCompletedEnergyExperience(
  scope: string | null,
  input: CompletedEnergyExperienceInput,
  completedAt = new Date(),
): EnergyProgress;

export function removeSavedEnergyCard(scope: string | null, cardId: string): EnergyProgress;

export function removeSavedLightTestAction(
  scope: string | null,
  testId: string,
  outcomeId: string,
): EnergyProgress;
```

`recordCompletedEnergyExperience()` 在一次写入中完成：更新日期完成种类、更新 `lastCompletedKind`、仅在 launchTarget 非空时更新 `lastTarget`、插入并标准化最近记录。无效输入返回当前进度且不写入。

- [ ] **Step 7: 运行进度测试并确认通过**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-progress.test.ts
```

Expected: PASS；v3/v2/v1 迁移、用户隔离和现有完成/收藏测试无回归。

- [ ] **Step 8: 提交本地进度变更**

```bash
git add apps/web-workbench/src/components/energy/energy-progress.ts apps/web-workbench/src/components/energy/energy-progress.test.ts
git commit -m "feat(energy): persist recent shelf activity"
```

---

### Task 2: 能量架展示模型与内容解析

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-shelf.ts`
- Create: `apps/web-workbench/src/components/energy/energy-shelf.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `EnergyProgress` 与 `EnergyRecentExperience`、`ENERGY_EXPERIENCES`、`HOLADAY_ENERGY_CARDS`、`LIGHT_TESTS`、`ENERGY_EXPLORE_CONTENT`、`allocateMagazineVisuals()`。
- Produces: `EnergyShelfModel`、`EnergyShelfItem`、`buildEnergyShelfModel()` 和 `energyShelfDateLabel()`，供 Task 3 与 Task 4 使用。

- [ ] **Step 1: 写展示模型失败测试**

创建 `energy-shelf.test.ts`，覆盖最近条目、三类收藏、未知 ID 和日期标签：

```ts
function progressFixture(overrides: {
  recent?: EnergyRecentExperience[];
  savedCardIds?: string[];
  savedTestActionIds?: string[];
  favoriteContentIds?: string[];
} = {}): EnergyProgress {
  return {
    completedDates: [],
    collectedKinds: [],
    savedCardIds: overrides.savedCardIds ?? [],
    completedTestIds: [],
    savedTestActionIds: overrides.savedTestActionIds ?? [],
    seenContentIds: [],
    completedKindsByDate: {},
    seenContentDateKey: null,
    continuation: {
      dateKey: '2026-08-14',
      lastTarget: null,
      lastCompletedKind: null,
      completedPracticeIds: [],
      pollSelections: {},
      favoriteContentIds: overrides.favoriteContentIds ?? [],
    },
    shelf: { recentExperiences: overrides.recent ?? [] },
  };
}

it('resolves recent experiences and all three favorite sources', () => {
  const progress = progressFixture({
    recent: [
      {
        experienceId: 'games',
        launchTarget: { type: 'game', gameId: 'color-memory' },
        kind: 'game',
        completedAt: '2026-08-14T01:00:00.000Z',
      },
    ],
    savedCardIds: ['work-01', 'missing-01'],
    savedTestActionIds: ['work-focus:steady', 'missing-test:steady'],
    favoriteContentIds: ['relax-breath-window', 'missing-content'],
  });

  const model = buildEnergyShelfModel(progress, 'aries', new Date('2026-08-14T03:00:00.000Z'));

  expect(model.recent).toEqual([
    expect.objectContaining({ title: '颜色记忆', imageSrc: '/energy/mini-game.jpg' }),
  ]);
  expect(model.favorites.map((item) => item.source)).toEqual([
    'energy-card',
    'test-action',
    'magazine-content',
  ]);
});
```

日期测试固定本地时区输入，分别断言“今天”“昨天”“8月10日”。

- [ ] **Step 2: 运行展示模型测试并确认失败**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-shelf.test.ts
```

Expected: FAIL；模块与导出尚不存在。

- [ ] **Step 3: 实现统一展示类型**

在 `energy-shelf.ts` 定义：

```ts
export type EnergyShelfFavoriteSource = 'energy-card' | 'test-action' | 'magazine-content';

export type EnergyShelfFavoriteRef =
  | { source: 'energy-card'; cardId: string }
  | { source: 'test-action'; testId: LightTestId; outcomeId: LightTestOutcome['id'] }
  | { source: 'magazine-content'; contentId: EnergyExploreContentId };

export interface EnergyShelfItem {
  id: string;
  section: 'recent' | 'favorite';
  source: EnergyShelfFavoriteSource | 'experience';
  title: string;
  summary: string;
  eyebrow: string;
  imageSrc: string;
  imageObjectPosition: string;
  estimatedSeconds: number;
  completedLabel: string | null;
  recent: EnergyRecentExperience | null;
  target: EnergyContentTarget | null;
  favoriteRef: EnergyShelfFavoriteRef | null;
}

export interface EnergyShelfModel {
  recent: EnergyShelfItem[];
  favorites: EnergyShelfItem[];
}
```

新增：

```ts
export function buildEnergyShelfModel(
  progress: EnergyProgress,
  zodiacSign: ZodiacSign,
  now = new Date(),
): EnergyShelfModel;

export function energyShelfDateLabel(completedAt: string, now = new Date()): string;
```

解析规则：

- recent：有 launchTarget 时从 practice/test/game 数据或目标类型解析精确标题；无目标时通常从 `ENERGY_EXPERIENCES` 读取默认标题、描述和时长，但默认 `games` 必须按注册表的真实默认值解析为 `catch-energy` / “接住能量”；
- recent 的 `id` 固定由 `recentExperienceKey()` 派生为 `recent:${key}`，仅作 React key 与测试定位，不反向解析；游戏、测试、抽卡、补给/练习分别使用 `/energy/mini-game.jpg`、`/energy/quick-test.jpg`、`/energy/tarot-cards.jpg`、`/energy/recharge-island.jpg`，星座使用 `zodiacBadgeImage(zodiacSign)`；默认图片位置为 `50% 50%`；
- energy-card：用 card ID 找牌，目标固定为 `{ type: 'tarot', mode: 'single', theme: card.primaryTheme }`，并携带 `{ source: 'energy-card', cardId }`；
- test-action：把 `testId:outcomeId` 拆开，从 `LIGHT_TESTS` 找测试与 outcome，目标为 `{ type: 'test', testId }`，并携带 `{ source: 'test-action', testId, outcomeId }`；
- magazine-content：从 `ENERGY_EXPLORE_CONTENT` 找 item，并通过 `allocateMagazineVisuals([item], zodiacSign)[0]` 获取图片和 `visual.objectPosition`，携带 `{ source: 'magazine-content', contentId }`；
- 未知 ID、无效 outcome 或无法解析的定义返回空数组项，不抛错。

- [ ] **Step 4: 运行展示模型测试并确认通过**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-shelf.test.ts
```

Expected: PASS；不存在原始 ID 直接暴露到标题或摘要。

- [ ] **Step 5: 提交展示模型**

```bash
git add apps/web-workbench/src/components/energy/energy-shelf.ts apps/web-workbench/src/components/energy/energy-shelf.test.ts
git commit -m "feat(energy): resolve shelf content"
```

---

### Task 3: 能量架组件、马卡龙视觉与可访问性

**Files:**
- Create: `apps/web-workbench/src/components/energy/EnergyShelf.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyShelf.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Test: `apps/web-workbench/src/components/energy/energy-css.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `EnergyShelfModel` 与 `EnergyShelfItem`。
- Produces: `EnergyShelf` 组件，供 Task 4 放入页面并连接动作。

- [ ] **Step 1: 写标签、空状态和动作失败测试**

创建 `EnergyShelf.test.tsx`：

```tsx
const recentFixture: EnergyShelfItem = {
  id: 'recent:games:color-memory',
  section: 'recent',
  source: 'experience',
  title: '颜色记忆',
  summary: '观察颜色与形状，再按顺序轻轻点回去',
  eyebrow: '小游戏',
  imageSrc: '/energy/mini-game.jpg',
  imageObjectPosition: '50% 50%',
  estimatedSeconds: 60,
  completedLabel: '今天',
  recent: {
    experienceId: 'games',
    launchTarget: { type: 'game', gameId: 'color-memory' },
    kind: 'game',
    completedAt: '2026-08-14T01:00:00.000Z',
  },
  target: null,
  favoriteRef: null,
};

const favoriteFixture: EnergyShelfItem = {
  id: 'favorite:energy-card:work-01',
  section: 'favorite',
  source: 'energy-card',
  title: '先推一厘米',
  summary: '动量比完整更重要',
  eyebrow: '已收藏能量牌',
  imageSrc: '/energy/tarot-cards.jpg',
  imageObjectPosition: '50% 50%',
  estimatedSeconds: 30,
  completedLabel: null,
  recent: null,
  target: { type: 'tarot', mode: 'single', theme: 'work' },
  favoriteRef: { source: 'energy-card', cardId: 'work-01' },
};

function modelFixture(): EnergyShelfModel {
  return { recent: [recentFixture], favorites: [favoriteFixture] };
}

it('switches between recent and favorites and exposes accessible actions', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  const onRemoveFavorite = vi.fn();
  render(
    <EnergyShelf
      model={modelFixture()}
      onOpen={onOpen}
      onRemoveFavorite={onRemoveFavorite}
    />,
  );

  expect(screen.getByRole('tab', { name: '最近玩过' }).getAttribute('aria-selected')).toBe('true');
  await user.click(screen.getByRole('button', { name: '再体验颜色记忆' }));
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'recent:games:color-memory' }),
    expect.any(HTMLButtonElement),
  );

  await user.click(screen.getByRole('tab', { name: '我的收藏' }));
  const remove = screen.getByRole('button', { name: '取消收藏先推一厘米' });
  expect(remove.title).toBe('取消收藏先推一厘米');
  await user.click(remove);
  expect(onRemoveFavorite).toHaveBeenCalled();
});
```

另加三个测试：recent/favorites 各自空状态，断言只出现真实可执行下一步且不出现 disabled 假卡片；在 tab 上按 `ArrowLeft` / `ArrowRight` 会移动焦点、切换 `aria-selected` 和面板。测试沿用项目现有的 `getAttribute()` / `textContent` 断言，不引入 jest-dom matcher。

- [ ] **Step 2: 写 CSS 失败门禁**

在 `energy-css.test.ts` 增加：

```ts
expect(css).toMatch(/\.energy-shelf__grid\s*\{[^}]*grid-template-columns:/s);
expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*\.energy-shelf__grid[\s\S]*grid-template-columns:\s*1fr/);
expect(css).toContain('@keyframes energy-shelf-card-arrive');
expect(css).toMatch(/\.energy-shelf__remove\s*\{[^}]*(?:min-width|width):\s*44px[^}]*(?:min-height|height):\s*44px/s);
expect(css).toMatch(
  /prefers-reduced-motion:[\s\S]*\.energy-shelf__card[\s\S]*animation:\s*none\s*!important/,
);
```

- [ ] **Step 3: 运行组件与 CSS 测试并确认失败**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyShelf.test.tsx src/components/energy/energy-css.test.ts
```

Expected: FAIL；组件与样式规则尚不存在。

- [ ] **Step 4: 实现 EnergyShelf 组件**

组件签名固定为：

```tsx
interface EnergyShelfProps {
  model: EnergyShelfModel;
  onOpen: (item: EnergyShelfItem, trigger: HTMLButtonElement) => void;
  onRemoveFavorite: (item: EnergyShelfItem) => void;
}

export function EnergyShelf({ model, onOpen, onRemoveFavorite }: EnergyShelfProps): JSX.Element;
```

组件内部只保存 `activeTab: 'recent' | 'favorites'`。标签使用 `role="tablist"`、两个 `role="tab"` 和对应 `role="tabpanel"`，用固定 ID/`aria-controls`/`aria-labelledby` 关联；`ArrowLeft`、`ArrowRight`、`Home`、`End` 在两个标签间移动焦点并同步激活。卡片图片 `alt=""`，用 `item.imageObjectPosition` 保留原视觉焦点，标题和动作由可见文本与按钮名称表达。只有 `favoriteRef !== null` 的收藏项显示取消收藏按钮；按钮使用 Heart 图标、`aria-label` 与 `title`；主动作统一为“再体验{title}”。

- [ ] **Step 5: 实现马卡龙视觉和动效**

在 `energy.css` 增加 `.energy-shelf`、`.energy-shelf__tabs`、`.energy-shelf__grid`、`.energy-shelf__card`、图片、内容、动作和空状态。桌面网格使用：

```css
.energy-shelf__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 640px) {
  .energy-shelf__grid {
    grid-template-columns: 1fr;
  }
}
```

图片框使用固定 `aspect-ratio: 16 / 9`，不写死像素高度；图片使用 `object-fit: cover` 和模型传入的 object-position，窄屏不增加裁切。卡片进入动画命名 `energy-shelf-card-arrive`，只包含 opacity、transform 和 box-shadow；在现有 `prefers-reduced-motion: reduce` 块中对 `.energy-shelf__card` 设置 `animation: none !important` 与 `transition: none !important`。

- [ ] **Step 6: 运行组件与 CSS 测试并确认通过**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyShelf.test.tsx src/components/energy/energy-css.test.ts
```

Expected: PASS；最近与收藏标签、按钮、空状态和 reduced-motion 门禁全部通过。

- [ ] **Step 7: 提交组件与视觉**

```bash
git add apps/web-workbench/src/components/energy/EnergyShelf.tsx apps/web-workbench/src/components/energy/EnergyShelf.test.tsx apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/energy-css.test.ts
git commit -m "feat(energy): add personal energy shelf"
```

---

### Task 4: 接入完成、重新进入与取消收藏

**Files:**
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Test: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`

**Interfaces:**
- Consumes: Task 1 的进度写入/移除函数、Task 2 的 `buildEnergyShelfModel()`、Task 3 的 `EnergyShelf`。
- Produces: 页面完成 → 最近展示 → 重新进入，以及收藏展示 → 取消 → 再体验的完整用户闭环。

- [ ] **Step 1: 写完成到最近展示的失败测试**

在 `EnergyHome.test.tsx` 使用现有 mocked experience 流程，完成小游戏后断言页面底部出现最近卡片：

```tsx
it('adds a completed experience to the shelf and reopens it from the recent card', async () => {
  const user = userEvent.setup();
  render(<EnergyHome profileStorageScope="usr_energy" />);

  await user.click(screen.getByRole('button', { name: '玩接住能量' }));
  await user.click(screen.getByRole('button', { name: '开始体验' }));
  for (let round = 1; round <= 12; round += 1) {
    await user.click(screen.getByRole('button', { name: `接住第 ${round} 个能量光点` }));
  }
  expect(screen.getByRole('heading', { name: '能量收集完成' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '返回今日内容' }));

  expect(screen.getByRole('heading', { name: '我的能量架' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '再体验接住能量' }));
  expect(screen.getByRole('dialog', { name: '小游戏' })).toBeTruthy();
});
```

这 12 次交互与现有 `GameExperience.test.tsx` 的真实完成路径一致；不要直接调用内部回调绕过交互。

- [ ] **Step 2: 写收藏取消和零新增事件失败测试**

使用 `saveEnergyCardIds('usr_energy', ['work-01'])`、`saveLightTestAction('usr_energy', 'work-focus', 'steady')` 和 `toggleFavoriteEnergyContent('usr_energy', 'relax-breath-window')` 预置三类收藏。渲染后切换“我的收藏”，分别断言：取消“先推一厘米”只删除该 card ID；打开“先把节奏稳住”进入 `light-test` 对话框；取消“窗边八次慢呼吸”只删除对应内容收藏。最后断言没有 feedback 或 shelf 服务端事件：

```tsx
expect(
  trpcMocks.reportEvent.mock.calls.some(([event]) =>
    String(event.type).includes('feedback') || String(event.type).includes('shelf'),
  ),
).toBe(false);
```

- [ ] **Step 3: 运行 EnergyHome 测试并确认失败**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyHome.test.tsx
```

Expected: FAIL；页面尚未渲染 `EnergyShelf`，完成路径仍只写当日 lastTarget。

- [ ] **Step 4: 在 EnergyHome 中构建并渲染能量架**

在 `EnergyHome` 中基于当前 `progress` 和 `profile.zodiacSign` 构建：

```tsx
const shelfModel = React.useMemo(
  () => buildEnergyShelfModel(progress, profile.zodiacSign),
  [progress, profile.zodiacSign],
);
```

在 `EnergyExploreFeed` 容器之后渲染：

```tsx
<EnergyShelf
  model={shelfModel}
  onOpen={(item, trigger) => openShelfItem(item, trigger)}
  onRemoveFavorite={(item) => removeShelfFavorite(item)}
/>
```

`openShelfItem()`：recent 通过 `item.recent.experienceId` 找注册项后调用 `openExperience(experience, trigger, item.recent.launchTarget)`；favorite 使用 `item.target` 调用现有 `executeTarget()`。

`openShelfItem()` 必须先验证注册项仍为 active/actionable/loadable；找不到目标或 `executeTarget()` 返回 false 时保持页面原状。不要在能量架中复制动态 import 或 `ExperiencePlayer` 状态。

- [ ] **Step 5: 将完成写入改为原子记录**

将 `onExperienceComplete` 内的 `recordEnergyCompletion()` + `saveLastEnergyTarget()` 分支替换为：

```tsx
if (!selectedExperience || selectedExperience.id === 'poll') return;
setProgress(
  recordCompletedEnergyExperience(
    storageScope,
    {
      experienceId: selectedExperience.id,
      launchTarget: selectedLaunchTarget,
      kind,
    },
  ),
);
```

保留各体验内部已有的专项进度写入，如练习 ID、测试完成 ID和收藏 ID；原子记录只统一完成日期、lastTarget 和最近列表。

- [ ] **Step 6: 连接收藏移除**

按 `item.source` 分派：

- `favoriteRef.source === 'energy-card'` → `removeSavedEnergyCard(storageScope, favoriteRef.cardId)`；
- `favoriteRef.source === 'test-action'` → `removeSavedLightTestAction(storageScope, favoriteRef.testId, favoriteRef.outcomeId)`；
- `favoriteRef.source === 'magazine-content'` → `toggleFavoriteEnergyContent(storageScope, favoriteRef.contentId)`；
- 其他 source 不显示移除动作。

每次调用返回新的 `EnergyProgress`，直接 `setProgress(next)`，不重新读取服务端或发送事件。

- [ ] **Step 7: 运行 Today Energy 定向测试**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-progress.test.ts src/components/energy/energy-shelf.test.ts src/components/energy/EnergyShelf.test.tsx src/components/energy/EnergyHome.test.tsx src/components/energy/energy-css.test.ts
```

Expected: 全部 PASS；无未处理 promise、fake timer 或 act 警告。

- [ ] **Step 8: 提交页面集成**

```bash
git add apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/EnergyHome.test.tsx
git commit -m "feat(energy): connect shelf history and favorites"
```

---

### Task 5: 全量回归、范围审计与发布准备

**Files:**
- Verify: `apps/web-workbench/**`
- Verify: repository diff and branch history

**Interfaces:**
- Consumes: Task 1–4 的 v4 进度、展示模型、组件和页面闭环。
- Produces: 可 Push 并创建 PR 的干净分支与完整门禁证据；不授权合并或部署。

- [ ] **Step 1: 运行 Web 全量测试**

Run:

```bash
pnpm --filter @holaday/web-workbench test
```

Expected: 所有测试文件 PASS，0 failed。

- [ ] **Step 2: 运行静态门禁**

Run each command separately:

```bash
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
git diff --check origin/claude/musing-keller-ae1d05...HEAD
```

Expected: 四个命令退出码均为 0。

- [ ] **Step 3: 审计范围和敏感区零改动**

Run:

```bash
git diff --name-only origin/claude/musing-keller-ae1d05...HEAD
git status --short
```

Expected: 只出现设计/计划文档和 `apps/web-workbench/src/components/energy/**`；不得出现 Orchestrator、migration、`.env`、DivineAPI、Translator、OpenAI、支付或部署文件；工作树为空。

- [ ] **Step 4: 使用 completion verification 技能复核证据**

读取并执行 `superpowers:verification-before-completion`，重新确认测试数量、构建退出码、diff 范围和干净状态。不得用前一轮输出代替当前 HEAD 的新证据。

- [ ] **Step 5: Push 并创建 Draft PR**

```bash
git push -u origin codex/energy-shelf
```

创建 Draft PR，目标分支固定为 `claude/musing-keller-ae1d05`。PR 正文必须包含：交互结果、v3→v4 迁移、隐私边界、测试/构建证据、敏感配置零改动。Push 与创建 PR 不代表授权合并或部署。
