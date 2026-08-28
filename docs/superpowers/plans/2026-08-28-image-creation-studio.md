# HOLA DAY 图片创作工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目串行执行，不创建子智能体。

**Goal:** 将 `/image` 从“先选参数”的生成表单改为“先选创作目标”的图片工作台，并打通锁定主角、真实一致性结果、继续修改、复用设置和过期降级。

**Architecture:** 重写已存在但当前未路由使用的 `ImagePage.tsx`，用独立的图片域状态、metadata 解析器和专用 UI 组件接管 `/image`；仍调用现有 `tasks.create(imageOptions)`、上传、文件下载、置顶和图片 runner。新增的场景与用户可见提示词仅进入现有任务 JSON metadata，无数据库迁移；图片路由稳定后再从 `VideoPage.tsx` 删除死的图片分支，保持视频产品行为不变。

**Tech Stack:** React 18、TypeScript 5.7、React Router 7、Zustand、tRPC 11、Zod、Tailwind CSS、Lucide React、Vitest 2 + Testing Library + happy-dom。

**Spec:** `docs/superpowers/specs/2026-08-28-image-creation-studio-design.md`

## Global Constraints

- 仅使用真实接入的 Nano Banana 2 / Pro、16 种现有风格、5 种比例和 1–4 张生成；不伪造新模型或新能力。
- “商业成片”只是现有参数和提示词的场景化编排，不新增独立后端 lane。
- 不新增图片供应商、付费 API、数据库表或迁移；不改额度、计费、默认文件保存期和确认流程。只有用户显式点击“保存到文件库”才持久化该既有成片。
- 不重构普通视频、复刻视频、IP 视频、视频供应商或视频报价。
- 不实现图层、画笔、蒙版、局部重绘或裁切画布。
- 锁定主角必须 fail closed；未执行真实核对时不展示“已核对”。
- 主体图、参考图和成片都使用真实资产；图标只用 Lucide，不手写 SVG、CSS 图画或占位图。
- 配色固定为奶油白、天空蓝、蜜桃、薄荷、薰衣草和 HOLA DAY 珊瑚粉；珊瑚粉是唯一主操作色。
- 交互目标不小于 44×44px；图标按钮同时具有 `aria-label` 和原生 `title`；遵循 `prefers-reduced-motion`。
- 所有业务改动按 RED → GREEN → REFACTOR 执行，每个任务一个独立提交。
- 仅在 `/Users/yaleiqi/holaday-monorepo/.worktrees/image-creation-studio-design` 工作，不触碰主工作区未提交内容。
- 不触碰 DivineAPI Translator、OpenAI Key、账户注销、股票、今日能量、支付或生产环境配置。

---

## File Structure

### Create

- `apps/web-workbench/src/components/image/image-studio-options.ts` — 真实模型、风格、比例、场景预设和提示词构造。
- `apps/web-workbench/src/components/image/image-studio-options.test.ts` — 选项数量、默认值、提示词和主角文件顺序。
- `apps/web-workbench/src/components/image/image-studio-state.ts` — 草稿类型、场景切换、用户覆盖保护和续作草稿。
- `apps/web-workbench/src/components/image/image-studio-state.test.ts` — 三场景状态转换与续作恢复。
- `apps/web-workbench/src/components/image/image-task-meta.ts` — 安全解析 `imageOptions`、`subjectConsistency`、附件和过期操作能力。
- `apps/web-workbench/src/components/image/image-task-meta.test.ts` — 恶意 metadata、部分成功、过期和主体核对测试。
- `apps/web-workbench/src/components/image/ImageGoalPicker.tsx` — 三个创作目标卡。
- `apps/web-workbench/src/components/image/ImageBriefComposer.tsx` — 主角锚点、参考图、改变项和可见提示词。
- `apps/web-workbench/src/components/image/ImageGenerationSettings.tsx` — 轻亮设置对话框与 16 张真实风格预览。
- `apps/web-workbench/src/components/image/ImageStudioForm.test.tsx` — 目标、改变项、设置、键盘和焦点集成测试。
- `apps/web-workbench/src/components/image/ImageResultPanel.tsx` — 当前制作、真实核对状态和续作操作。
- `apps/web-workbench/src/components/image/ImageHistory.tsx` — 图片专属历史、置顶、分页和过期降级。
- `apps/web-workbench/src/components/image/ImageResults.test.tsx` — 结果、历史、续作与降级集成测试。
- `apps/web-workbench/src/pages/ImagePage.test.tsx` — 创建任务、上传、提交锁、路由和草稿保留集成。
- `apps/orchestrator/src/trpc/routers/tasks-image-options.test.ts` — studio metadata 输入白名单与长度限制。
- `apps/orchestrator/src/files/file-service-library.test.ts` — 验证 output 升级、input 幂等、过期/跨用户拒绝。

### Modify

- `apps/web-workbench/src/types/image.ts` — 补全 studio 目标、改变项、用途和可见提示词契约。
- `apps/web-workbench/src/types/task.ts` — 暴露安全的图片 metadata 和主体核对汇总。
- `apps/web-workbench/src/stores/task-store.ts` — list/detail 两条水化路径使用同一解析器。
- `apps/web-workbench/src/stores/task-store.test.ts` — 验证图片 metadata 的通过、拒绝和终态刷新。
- `apps/web-workbench/src/lib/image-history-row.ts` — 从简化本地列表升级为真实 `tasks.list` 图片历史映射。
- `apps/web-workbench/src/lib/image-history-row.test.ts` — 补全多成片、metadata、可用性、置顶和分页。
- `apps/web-workbench/src/pages/ImagePage.tsx` — 重写为独立目标优先工作台编排器。
- `apps/web-workbench/src/App.tsx` — `/image` 改为惰加载 `ImagePage`，`/video` 保持 `VideoPage`。
- `apps/web-workbench/src/App.closure.test.tsx` — 确保账户状态门禁不因路由拆分回归。
- `apps/web-workbench/src/pages/VideoPage.tsx` — 在新图片路由通过后删除图片模式、图片选项和图片历史分支。
- `apps/web-workbench/src/pages/video-page-style-state.test.ts` — 移除已迁往图片域测试的断言，保留视频回归。
- `apps/web-workbench/src/lib/video-history-row.ts` — 仅保留视频历史契约，图片映射转移到 `image-history-row.ts`。
- `apps/web-workbench/src/lib/video-history-row.test.ts` — 移除已迁移图片用例，保留视频用例。
- `apps/orchestrator/src/trpc/routers/tasks.ts` — `imageOptions` 接受且原样持久化经验证的 studio metadata。
- `apps/orchestrator/src/trpc/routers/files.ts` — 增加当前用户文件可读性的最小只读查询。
- `apps/orchestrator/src/trpc/routers/files.test.ts` — 验证所有权、过期、丢失存储对象、批量上限和保存 mutation。
- `apps/orchestrator/src/files/file-service.ts` — 将用户显式选中的可读 output 幂等升级为文件库 input，不复制存储对象。

---

### Task 1: 锁定图片域契约、场景预设和纯状态

**Files:**
- Create: `apps/web-workbench/src/components/image/image-studio-options.ts`
- Create: `apps/web-workbench/src/components/image/image-studio-options.test.ts`
- Create: `apps/web-workbench/src/components/image/image-studio-state.ts`
- Create: `apps/web-workbench/src/components/image/image-studio-state.test.ts`
- Modify: `apps/web-workbench/src/types/image.ts`

**Interfaces:**
- Produces: `ImageStudioDraft`、`ImageCreationGoal`、`ImageChangeTarget`、`CommercialImageUse`、`ImageStyleKey`、`createImageStudioDraft()`、`switchImageCreationGoal()`、`buildImageIntentForSubmit()`、`buildImageCreationOptions()`、`buildImageFileOrder()`。
- Consumes: `DraftAttachment` from `@/components/AttachmentChip`、`ImageModel` and `VideoAspect` from existing types.

- [ ] **Step 1: Write failing domain tests**

```ts
expect(createImageStudioDraft('inspiration')).toMatchObject({
  goal: 'inspiration', model: 'nano_banana_2', style: 'random',
  aspectRatio: '1:1', imageCount: 1, changeTargets: [],
});
expect(createImageStudioDraft('lock_subject')).toMatchObject({
  goal: 'lock_subject', imageCount: 2, subjectAttachmentClientId: null,
});
expect(createImageStudioDraft('commercial', 'poster')).toMatchObject({
  commercialUse: 'poster', model: 'nano_banana_pro', aspectRatio: '3:4',
});
```

另加断言：目标切换保留 `prompt`；离开锁定模式不删附件；返回锁定模式恢复仍有效的主角；手动覆盖后同一草稿周期不再被预设覆盖。

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/image-studio-options.test.ts src/components/image/image-studio-state.test.ts`

Expected: FAIL because both modules and exported types do not exist.

- [ ] **Step 3: Implement the exact domain model and presets**

```ts
export type ImageCreationGoal = 'inspiration' | 'lock_subject' | 'commercial';
export type ImageChangeTarget = 'background' | 'style' | 'lighting' | 'action' | 'composition';
export type CommercialImageUse = 'product' | 'poster' | 'social_cover';

export interface ImageStudioDraft {
  goal: ImageCreationGoal;
  commercialUse?: CommercialImageUse;
  prompt: string;
  changeTargets: ImageChangeTarget[];
  model: ImageModel;
  style: ImageStyleKey;
  aspectRatio: VideoAspect;
  imageCount: 1 | 2 | 3 | 4;
  attachments: DraftAttachment[];
  subjectAttachmentClientId: string | null;
  userOverriddenSettings: ReadonlySet<'model' | 'style' | 'aspectRatio' | 'imageCount'>;
}
```

`IMAGE_GOAL_PRESETS` 固定为：灵感=`nano_banana_2/random/1:1/1`；锁定主角=`nano_banana_2/random/1:1/2`；商品图=`nano_banana_2/product/4:3/2`；海报=`nano_banana_pro/random/3:4/1`；社媒封面=`nano_banana_2/vibrant/1:1/2`。将现有 16 种风格、5 种比例、2 个模型和提示词构造从 `VideoPage.tsx` 原样迁入 options 模块。

- [ ] **Step 4: Implement provider-safe builders**

```ts
export function buildImageCreationOptions(
  draft: ImageStudioDraft,
  subjectFileId?: string,
): ImageCreationOptions {
  return {
    model: draft.model,
    style: draft.style,
    aspectRatio: draft.aspectRatio,
    imageCount: draft.imageCount,
    ...(draft.goal === 'lock_subject' ? { mode: 'lock_subject' as const } : {}),
    ...(subjectFileId ? { subjectFileId } : {}),
    goal: draft.goal,
    ...(draft.commercialUse ? { commercialUse: draft.commercialUse } : {}),
    changeTargets: draft.changeTargets,
    visiblePrompt: draft.prompt.trim(),
  };
}
```

`buildImageIntentForSubmit()` 只向 runner intent 追加明确选择的风格和现有锁定主角约束；`goal`、`commercialUse`、`changeTargets` 不自动变成模型指令。`buildImageFileOrder()` 保证主角文件第一、其他 ready 附件顺序不变。

- [ ] **Step 5: Run GREEN tests and typecheck**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/image-studio-options.test.ts src/components/image/image-studio-state.test.ts`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; exactly 16 style options and five aspect ratios are asserted.

- [ ] **Step 6: Commit**

```bash
git add apps/web-workbench/src/types/image.ts apps/web-workbench/src/components/image/image-studio-options.ts apps/web-workbench/src/components/image/image-studio-options.test.ts apps/web-workbench/src/components/image/image-studio-state.ts apps/web-workbench/src/components/image/image-studio-state.test.ts
git commit -m "feat(image): add goal-first studio domain state"
```

### Task 2: 持久并安全水化 studio metadata

**Files:**
- Create: `apps/orchestrator/src/trpc/routers/tasks-image-options.test.ts`
- Create: `apps/web-workbench/src/components/image/image-task-meta.ts`
- Create: `apps/web-workbench/src/components/image/image-task-meta.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`
- Modify: `apps/web-workbench/src/types/image.ts`
- Modify: `apps/web-workbench/src/types/task.ts`
- Modify: `apps/web-workbench/src/stores/task-store.ts`
- Modify: `apps/web-workbench/src/stores/task-store.test.ts`

**Interfaces:**
- Consumes: Task 1 `ImageCreationGoal`、`CommercialImageUse`、`ImageChangeTarget`、`ImageCreationOptions`.
- Produces: exported `imageCreationOptionsInput`、`parseImageTaskMeta(value)`、`UiTask.imageOptions`、`UiTask.subjectConsistency`.

- [ ] **Step 1: Write failing schema and parser tests**

```ts
expect(imageCreationOptionsInput.parse({
  model: 'nano_banana_pro', aspectRatio: '3:4', imageCount: 1,
  goal: 'commercial', commercialUse: 'poster',
  changeTargets: ['background', 'lighting'], visiblePrompt: '做一张夏日新品海报',
})).toMatchObject({ goal: 'commercial', commercialUse: 'poster' });
expect(() => imageCreationOptionsInput.parse({
  aspectRatio: '1:1', imageCount: 1, goal: 'commercial', commercialUse: 'unknown',
})).toThrow();
```

Parser tests must also reject `checked=-1`, `passed>checked`, unknown modes, more than five change targets and over-4,000-character visible prompts.

- [ ] **Step 2: Run RED tests**

Run: `pnpm --filter @holaday/orchestrator test -- src/trpc/routers/tasks-image-options.test.ts`

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/image-task-meta.test.ts src/stores/task-store.test.ts`

Expected: FAIL because the schema export, parser and UI fields are missing.

- [ ] **Step 3: Add the bounded tRPC metadata contract**

```ts
export const imageCreationOptionsInput = z.object({
  model: z.enum(['nano_banana_2', 'nano_banana_pro']).optional(),
  style: z.enum(['random', 'cinematic', 'creative', 'dynamic', 'fashion', 'portrait', 'stock_photo', 'vibrant', 'anime', 'illustration', 'logo', 'watercolor', 'line_art', 'fantasy', 'product', 'three_d_render']).optional(),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']),
  imageCount: z.number().int().min(1).max(4),
  mode: z.enum(['free', 'lock_subject']).optional(),
  subjectFileId: z.string().min(1).max(64).optional(),
  goal: z.enum(['inspiration', 'lock_subject', 'commercial']).optional(),
  commercialUse: z.enum(['product', 'poster', 'social_cover']).optional(),
  changeTargets: z.array(z.enum(['background', 'style', 'lighting', 'action', 'composition'])).max(5).optional(),
  visiblePrompt: z.string().trim().min(1).max(4000).optional(),
});
```

`createInput.imageOptions` 直接复用此 schema。runner 仍只读模型、比例、数量、模式和主角文件；metadata 继续原样持久化整个 `imageOptions`。

- [ ] **Step 4: Implement one defensive frontend parser**

```ts
export interface ImageTaskMeta {
  imageOptions?: ImageCreationOptions;
  subjectConsistency?: { checked: number; passed: number; failed: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseImageTaskMeta(value: unknown): ImageTaskMeta {
  if (!isRecord(value)) return {};
  const rawOptions = isRecord(value.imageOptions) ? value.imageOptions : null;
  const model = rawOptions?.model;
  const aspectRatio = rawOptions?.aspectRatio;
  const imageCount = rawOptions?.imageCount;
  const rawMode = rawOptions?.mode;
  const mode = rawMode === undefined || rawMode === 'free'
    ? 'free'
    : rawMode === 'lock_subject' ? 'lock_subject' : null;
  const rawStyle = rawOptions?.style;
  const style = rawStyle === undefined
    ? 'random'
    : IMAGE_STYLE_KEYS.has(rawStyle as ImageStyleKey) ? rawStyle as ImageStyleKey : null;
  const goal = rawOptions?.goal === undefined
    ? (mode === 'lock_subject' ? 'lock_subject' : 'inspiration')
    : asImageGoal(rawOptions.goal);
  const commercialUse = rawOptions?.commercialUse === undefined
    ? undefined
    : asCommercialImageUse(rawOptions.commercialUse);
  const changeTargets = asImageChangeTargets(rawOptions?.changeTargets);
  const imageOptions =
    (model === 'nano_banana_2' || model === 'nano_banana_pro') &&
    mode !== null && style !== null && goal !== null &&
    commercialUse !== null && changeTargets !== null &&
    IMAGE_ASPECT_RATIOS.has(aspectRatio as VideoAspect) &&
    Number.isInteger(imageCount) && Number(imageCount) >= 1 && Number(imageCount) <= 4
      ? {
          model,
          style,
          aspectRatio: aspectRatio as VideoAspect,
          imageCount: imageCount as 1 | 2 | 3 | 4,
          ...(mode === 'lock_subject' ? { mode } : {}),
          ...(typeof rawOptions?.subjectFileId === 'string' && rawOptions.subjectFileId.length >= 1 && rawOptions.subjectFileId.length <= 64
            ? { subjectFileId: rawOptions.subjectFileId }
            : {}),
          goal,
          ...(commercialUse ? { commercialUse } : {}),
          changeTargets,
          ...(typeof rawOptions?.visiblePrompt === 'string' && rawOptions.visiblePrompt.length <= 4000
            ? { visiblePrompt: rawOptions.visiblePrompt }
            : {}),
        } satisfies ImageCreationOptions
      : undefined;

  const rawConsistency = isRecord(value.subjectConsistency) ? value.subjectConsistency : null;
  const counts = ['checked', 'passed', 'failed'].map((key) => rawConsistency?.[key]);
  const validCounts = counts.every(
    (count) => Number.isInteger(count) && Number(count) >= 0 && Number(count) <= 8,
  );
  const [checked, passed, failed] = counts.map(Number);
  const subjectConsistency =
    validCounts && passed + failed === checked
      ? { checked, passed, failed }
      : undefined;

  return {
    ...(imageOptions ? { imageOptions } : {}),
    ...(subjectConsistency ? { subjectConsistency } : {}),
  };
}
```

`IMAGE_STYLE_KEYS`、`IMAGE_ASPECT_RATIOS`、`asImageGoal()`、`asCommercialImageUse()` 和 `asImageChangeTargets()` 全部从 Task 1 的常量数组导出，不在解析器里维护第二份枚举。三个解析函数的精确约定为：`asImageGoal(unknown): ImageCreationGoal | null`；`asCommercialImageUse(undefined): undefined`、非法值返回 `null`；`asImageChangeTargets(undefined): []`、非数组/超过 5 项/含非法值返回 `null`。`subjectConsistency.reasons` 不进入 UI，避免把内部模型文本当成用户说明。对正确 metadata 汇总为“已核对 N 张 / 已筛除 M 张”。旧任务缺少 `style` 时只回退为 `random`，缺少 `visiblePrompt` 时保持空白，不解析标题或 intent 猜测。

- [ ] **Step 5: Hydrate both list and detail paths**

`toUiTask()` 和 `selectTask()` 详情水化都对 `result.metadata` 调用 `parseImageTaskMeta()`，并仅在字段存在时写入 `UiTask`。测试验证列表首渲染和详情刷新得到相同结果，恶意 metadata 被忽略且不影响附件。

- [ ] **Step 6: Run GREEN tests**

Run: `pnpm --filter @holaday/orchestrator test -- src/trpc/routers/tasks-image-options.test.ts`

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/image-task-meta.test.ts src/stores/task-store.test.ts`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; no database migration is generated.

- [ ] **Step 7: Commit**

```bash
git add apps/orchestrator/src/trpc/routers/tasks.ts apps/orchestrator/src/trpc/routers/tasks-image-options.test.ts apps/web-workbench/src/types/image.ts apps/web-workbench/src/types/task.ts apps/web-workbench/src/stores/task-store.ts apps/web-workbench/src/stores/task-store.test.ts apps/web-workbench/src/components/image/image-task-meta.ts apps/web-workbench/src/components/image/image-task-meta.test.ts
git commit -m "feat(image): persist safe studio metadata"
```

### Task 3: 实现目标优先表单和轻亮生成设置

**Files:**
- Create: `apps/web-workbench/src/components/image/ImageGoalPicker.tsx`
- Create: `apps/web-workbench/src/components/image/ImageBriefComposer.tsx`
- Create: `apps/web-workbench/src/components/image/ImageGenerationSettings.tsx`
- Create: `apps/web-workbench/src/components/image/ImageStudioForm.test.tsx`
- Modify: `apps/web-workbench/src/pages/ImagePage.tsx`

**Interfaces:**
- Consumes: Task 1 `ImageStudioDraft`、场景预设、真实模型/风格/比例选项。
- Produces: controlled `ImageGoalPicker`、`ImageBriefComposer`、`ImageGenerationSettings`；`ImagePage` 管理唯一草稿。

- [ ] **Step 1: Write failing interaction tests**

```tsx
render(<ImageGoalPicker value="inspiration" onChange={onChange} />);
expect(screen.getByRole('group', { name: '今天想做什么图' })).toBeTruthy();
expect(screen.getAllByRole('button')).toHaveLength(3);
expect(screen.getByRole('button', { name: /灵感创作/ })).toHaveAttribute('aria-pressed', 'true');
```

表单集成测试必须覆盖：切到锁定主角后出现“添加主角图”和 5 个改变项；改变项多选具有 `aria-pressed`；商业成片显示 3 个用途；打开设置后显示 2 个模型、16 个风格、5 个比例和 4 个数量选项；Esc 关闭并把焦点返回“生成设置”。

- [ ] **Step 2: Run RED component tests**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/ImageStudioForm.test.tsx`

Expected: FAIL because the three controlled components do not exist.

- [ ] **Step 3: Build the goal cards with real existing assets**

```ts
const IMAGE_GOALS = [
  { id: 'inspiration', title: '灵感创作', image: '/image-style-previews/illustration.png' },
  { id: 'lock_subject', title: '锁定主角', image: '/image-style-previews/portrait.png' },
  { id: 'commercial', title: '商业成片', image: '/image-style-previews/product.png' },
] as const;
```

三卡在桌面端同行，图片区域用 `object-cover` 但主体必须完整可识别；实现时以原图尺寸选择 `object-position`，不拉伸。每卡一句能力描述，不把模型名放进卡片。

- [ ] **Step 4: Build the brief composer**

`ImageBriefComposer` props 固定为：

```ts
interface ImageBriefComposerProps {
  draft: ImageStudioDraft;
  uploading: boolean;
  inlineError: string | null;
  onPromptChange(value: string): void;
  onToggleChangeTarget(value: ImageChangeTarget): void;
  onChooseImages(): void;
  onRemoveAttachment(clientId: string): void;
  onSetSubject(clientId: string): void;
}
```

锁定模式将主角与其他参考图分区；上传中、失败、ready 都保留明确文本状态。提示词标题固定为“描述你想要的最终画面”，错误使用 `role="alert"` 放在输入区内。

- [ ] **Step 5: Build the light settings dialog**

`ImageGenerationSettings` 使用现有 Dialog 基础组件或等价可访问实现，面板为奶油白、无黑色背景。16 个风格使用 `/image-style-previews/<key>.png`；每张图具有可读标签，选中态同时有边框、勾选图标和文字。关闭后显示“模型 · 比例 · N 张”摘要。

- [ ] **Step 6: Assemble the static page shell**

`ImagePage.tsx` 首先只编排标题、三场景、创作区、设置摘要和主操作。页面最大宽度 1180–1220px，底色为低对比奶油色，不用嵌套白卡填满留白。主按钮文案为“开始生成”，只此一个珊瑚粉强按钮。

- [ ] **Step 7: Run GREEN tests and accessibility static gates**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/ImageStudioForm.test.tsx src/lib/control-tooltip.test.ts`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; source contains no dark image-style dialog classes and no icon-only button without `aria-label` + `title`.

- [ ] **Step 8: Commit**

```bash
git add apps/web-workbench/src/pages/ImagePage.tsx apps/web-workbench/src/components/image/ImageGoalPicker.tsx apps/web-workbench/src/components/image/ImageBriefComposer.tsx apps/web-workbench/src/components/image/ImageGenerationSettings.tsx apps/web-workbench/src/components/image/ImageStudioForm.test.tsx
git commit -m "feat(image): build goal-first creation form"
```

### Task 4: 接入上传、真实创建、提交锁和图片路由

**Files:**
- Modify: `apps/web-workbench/src/pages/ImagePage.tsx`
- Create: `apps/web-workbench/src/pages/ImagePage.test.tsx`
- Modify: `apps/web-workbench/src/App.tsx`
- Modify: `apps/web-workbench/src/App.closure.test.tsx`

**Interfaces:**
- Consumes: `uploadFile()`、`uploadFailureMessage()`、`useTaskStore.createTask()`、`createMediaActionGuard()` and Task 1 builders.
- Produces: production `/image` route; `handleSubmit()` creates a real image task and navigates to `/image?task=<id>`.

- [ ] **Step 1: Write failing page integration tests with injected/mocked boundaries**

```tsx
await user.click(screen.getByRole('button', { name: /锁定主角/ }));
await user.type(screen.getByRole('textbox', { name: '描述你想要的最终画面' }), '把主角放到夏日海边');
expect(screen.getByRole('button', { name: '开始生成' })).toBeDisabled();
```

测试继续模拟主角上传成功，断言 `createTask` 收到：主角 fileId 排在第一、`mode='lock_subject'`、可见提示词与 studio metadata；双击只创建一次；成功后清提示词和附件但保留场景/设置；失败后保留草稿。

- [ ] **Step 2: Run RED page tests**

Run: `pnpm --filter @holaday/web-workbench test -- src/pages/ImagePage.test.tsx`

Expected: FAIL because the static shell is not wired to upload/create/navigation.

- [ ] **Step 3: Implement upload lifecycle without losing successful attachments**

每个文件按 `uploading → ready | error` 更新，失败项保留 `errorMessage` 和重试入口。主角默认为第一张 ready 图，用户可显式切换。移除、替换、提交成功和页面卸载时使用 `revokeCreativePreviewUrls()` 释放 blob URL。

- [ ] **Step 4: Implement inline validation and exact create call**

```ts
const result = await createTask(
  `生成图片：${buildImageIntentForSubmit(draft)}`,
  buildImageFileOrder(draft.attachments, draft.goal, draft.subjectAttachmentClientId),
  undefined, undefined, undefined, undefined, undefined, undefined,
  buildImageCreationOptions(draft, subjectFileId),
);
```

禁用条件：提示词少于 4 个字、存在上传中文件、锁定主角没有 ready 主角、已在提交。禁用原因在按钮附近使用可见文本说明，不只依赖 toast。

- [ ] **Step 5: Switch only the image route**

`App.tsx` 新增 `lazyRoute(() => import('@/pages/ImagePage'), 'ImagePage')`，`/image` 改为 `lazyElement(<ImagePage />)`；`/video` 继续使用原 `VideoGate`。账户关闭恢复边界和 AppShell 不变。

- [ ] **Step 6: Run GREEN route and integration tests**

Run: `pnpm --filter @holaday/web-workbench test -- src/pages/ImagePage.test.tsx src/App.closure.test.tsx src/components/image/image-studio-options.test.ts src/components/image/image-studio-state.test.ts`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; `/image` no longer renders `VideoPage mode="image"`; `/video` remains unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/web-workbench/src/pages/ImagePage.tsx apps/web-workbench/src/pages/ImagePage.test.tsx apps/web-workbench/src/App.tsx apps/web-workbench/src/App.closure.test.tsx
git commit -m "feat(image): route real tasks through image studio"
```

### Task 5: 实现真实结果、续作闭环和过期历史

**Files:**
- Create: `apps/web-workbench/src/components/image/ImageResultPanel.tsx`
- Create: `apps/web-workbench/src/components/image/ImageHistory.tsx`
- Create: `apps/web-workbench/src/components/image/ImageResults.test.tsx`
- Modify: `apps/web-workbench/src/components/image/image-studio-state.ts`
- Modify: `apps/web-workbench/src/components/image/image-studio-state.test.ts`
- Modify: `apps/web-workbench/src/components/image/image-task-meta.ts`
- Modify: `apps/web-workbench/src/components/image/image-task-meta.test.ts`
- Modify: `apps/web-workbench/src/lib/image-history-row.ts`
- Modify: `apps/web-workbench/src/lib/image-history-row.test.ts`
- Modify: `apps/web-workbench/src/pages/ImagePage.tsx`
- Modify: `apps/orchestrator/src/trpc/routers/files.ts`
- Modify: `apps/orchestrator/src/trpc/routers/files.test.ts`
- Modify: `apps/orchestrator/src/files/file-service.ts`
- Create: `apps/orchestrator/src/files/file-service-library.test.ts`

**Interfaces:**
- Consumes: hydrated `UiTask.imageOptions`、`UiTask.subjectConsistency`、`FileDownloadCard`、`LazyPosterImg`、`trpc.tasks.list`、`trpc.files.availability`、`trpc.files.saveOutput`、`togglePin()`.
- Produces: `continuationDraftFromImageTask(action, row, selectedFileId)` and image-only current/history UI.

- [ ] **Step 1: Write failing history mapping and continuation tests**

```ts
expect(toImageHistoryRow(rawTask)?.imageOptions).toMatchObject({
  goal: 'lock_subject', mode: 'lock_subject', visiblePrompt: '把背景换成海边',
});
expect(imageResultActions(expiredRow, now)).toEqual({
  continueEdit: false, keepSubject: true, reuseSettings: true, download: false,
});
```

测试必须覆盖：多附件顺序；`partial_success` 真实数量；未核对不显示通过；`checked=2/passed=1/failed=1` 显示“已筛除 1 张”；成片过期但主角未过期；成片和主角都过期；置顶乐观更新回滚；分页不重复任务。

- [ ] **Step 2: Run RED result tests**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/ImageResults.test.tsx src/lib/image-history-row.test.ts src/components/image/image-task-meta.test.ts src/components/image/image-studio-state.test.ts`

Expected: FAIL because result actions and the upgraded row contract do not exist.

- [ ] **Step 3: Upgrade image history mapping**

`ImageHistoryRow` 必须包含 `downloads[]`、真实 `imageOptions`、可选 `subjectConsistency`、置顶状态和任务日期。只接受 `executionMode|finalExecutionMode === 'image'`、终态 `completed|partial_success` 且至少一个合法图片附件的行。不使用标题推断模式、场景或设置。

- [ ] **Step 4: Add an ownership-scoped read-only file availability query**

```ts
availability: protectedProcedure
  .input(z.object({ fileIds: z.array(z.string().min(1).max(64)).min(1).max(5) }))
  .query(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    const fileService = new FileService(ctx.db, ctx.logger);
    return {
      items: await Promise.all(input.fileIds.map(async (fileId) => ({
        fileId,
        available: await fileService.isReadableForUser(fileId, userId),
      }))),
    };
  }),
```

实现时复用 `requireUserId()` 与 `FileService.isReadableForUser()`。返回值不包含存储路径、签名 URL、过期时间或其他用户数据。`files.test.ts` 模拟当前用户与可读性，验证过期、已删除和不属于当前用户的 fileId 都返回 `available:false`。

同一边界内新增 `FileService.saveOutputToLibraryForUser(fileId, userId): Promise<boolean>` 与 `files.saveOutput` mutation。方法必须先通过 `readableRowForUser()` 核对所有权、状态、过期时间和存储对象；`kind='output'` 时原子更新为 `kind='input', expiresAt=null`，`kind='input'` 时幂等返回 true，其他情况返回 false。mutation 失败返回 `NOT_FOUND`，不泄露文件是不存在还是属于别人。

- [ ] **Step 5: Implement the four exact result actions**

```ts
export type ImageContinuationAction = 'continue_edit' | 'keep_subject' | 'reuse_settings';

export function continuationDraftFromImageTask(
  row: ImageHistoryRow,
  action: ImageContinuationAction,
  selectedFileId?: string,
): ImageStudioDraft
```

- `continue_edit`: 带回选中成片、原主角、可见提示词和设置；成片过期时禁用。
- `keep_subject`: 先对 `subjectFileId` 调用 `files.availability`；仅当 `available:true` 才带回主角和设置并清空可见描述，否则聚焦上传区并显示“重新上传主角”。
- `reuse_settings`: 只带回目标、商业用途、模型、风格、比例和数量，不带文件。
- 下载：继续使用 `FileDownloadCard`。保存到文件库：显式调用 `files.saveOutput`，成功后显示“已保存到文件库”并禁用重复提交；不建新存储对象。

- [ ] **Step 6: Render truthful current-task states**

`ImageResultPanel` 显示排队/生成/核对/部分成功/失败/完成；仅当 metadata 内 `checked > 0 && passed > 0 && failed === 0` 显示“已核对主角一致性”，`failed > 0` 显示已筛除数量。不渲染 `reasons[]`。正在执行时每 4 秒刷新，终态停止轮询。

- [ ] **Step 7: Render image-only history with honest expiry**

历史保留“全部 / 最近 / 置顶”、最多 50 条/页和现有分页扫描限制。过期卡紧凑显示“成片已过期”和仍可用操作，不显示大面积空预览。历史请求失败时保留上次成功内容并提供重试。

- [ ] **Step 8: Run GREEN result tests**

Run: `pnpm --filter @holaday/orchestrator test -- src/trpc/routers/files.test.ts src/files/file-service-library.test.ts`

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image/ImageResults.test.tsx src/lib/image-history-row.test.ts src/components/image/image-task-meta.test.ts src/components/image/image-studio-state.test.ts`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; expired rows never expose a stale download or continue-edit action.

- [ ] **Step 9: Commit**

```bash
git add apps/orchestrator/src/trpc/routers/files.ts apps/orchestrator/src/trpc/routers/files.test.ts apps/orchestrator/src/files/file-service.ts apps/orchestrator/src/files/file-service-library.test.ts apps/web-workbench/src/pages/ImagePage.tsx apps/web-workbench/src/components/image/ImageResultPanel.tsx apps/web-workbench/src/components/image/ImageHistory.tsx apps/web-workbench/src/components/image/ImageResults.test.tsx apps/web-workbench/src/components/image/image-studio-state.ts apps/web-workbench/src/components/image/image-studio-state.test.ts apps/web-workbench/src/components/image/image-task-meta.ts apps/web-workbench/src/components/image/image-task-meta.test.ts apps/web-workbench/src/lib/image-history-row.ts apps/web-workbench/src/lib/image-history-row.test.ts
git commit -m "feat(image): close the result and continuation loop"
```

### Task 6: 移除 VideoPage 中的图片分支并保持视频回归为绿

**Files:**
- Modify: `apps/web-workbench/src/pages/VideoPage.tsx`
- Modify: `apps/web-workbench/src/pages/video-page-style-state.test.ts`
- Modify: `apps/web-workbench/src/lib/video-history-row.ts`
- Modify: `apps/web-workbench/src/lib/video-history-row.test.ts`
- Modify: `apps/web-workbench/src/lib/image-history-row.ts`
- Modify: `apps/web-workbench/src/lib/image-history-row.test.ts`

**Interfaces:**
- Consumes: Task 1 image builders and Task 5 image history mapper, now owned entirely by image modules.
- Produces: `VideoPage()` with no image-mode state/render branches; existing `confirm_image` quote choice still navigates to the dedicated `/image?task=...` route.

- [ ] **Step 1: Move image assertions before deleting implementations**

将 `video-page-style-state.test.ts` 中 `DEFAULT_IMAGE_COUNT`、`buildImageCreationOptions`、`buildImageFileOrder`、`buildImageIntentForSubmit`、图片风格和锁定主角用例移到 Task 1 的两个测试文件。将 `video-history-row.test.ts` 中 `toImageRow` 的全部用例移到 `image-history-row.test.ts`。先运行迁移后的测试，确保没有断言丢失。

Run: `pnpm --filter @holaday/web-workbench test -- src/pages/video-page-style-state.test.ts src/components/image/image-studio-options.test.ts src/lib/video-history-row.test.ts src/lib/image-history-row.test.ts`

Expected: PASS before source deletion.

- [ ] **Step 2: Delete only dead image branches from VideoPage**

删除：`mode='image'` prop、`isImage` 分支、图片模型/风格/数量状态、`ImageModeChooser`、`ImageStyleDialog`、图片上传提交分支和图片历史渲染。保留：普通/复刻/IP 视频、`confirm_image` 报价选项、`creativeTaskPath('image', taskId)` 以及它的 `/image?task=` 导航。

`CreativeHistory` 重命名为 `VideoHistory`并固定使用 `toVideoRow`；`video-history-row.ts` 删除 `toImageRow`、`imageMode` 和图片专属类型，但通用分页/过期帮助函数若仍被视频使用则保留。

- [ ] **Step 3: Add a source boundary regression**

```ts
const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');
expect(source).not.toContain('ImageModeChooser');
expect(source).not.toContain('ImageStyleDialog');
expect(source).not.toContain("mode === 'image'");
expect(source).toContain("confirmVideo('confirm_image')");
```

- [ ] **Step 4: Run video and image suites together**

Run: `pnpm --filter @holaday/web-workbench test -- src/pages/video-page-style-state.test.ts src/lib/video-history-row.test.ts src/pages/ImagePage.test.tsx src/components/image/ImageStudioForm.test.tsx src/components/image/ImageResults.test.tsx src/lib/image-history-row.test.ts`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; `/video` still exposes all three video tabs and quote confirmation behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/web-workbench/src/pages/VideoPage.tsx apps/web-workbench/src/pages/video-page-style-state.test.ts apps/web-workbench/src/lib/video-history-row.ts apps/web-workbench/src/lib/video-history-row.test.ts apps/web-workbench/src/lib/image-history-row.ts apps/web-workbench/src/lib/image-history-row.test.ts
git commit -m "refactor(image): separate image studio from video page"
```

### Task 7: 视觉、响应式、可访问性和发布验收

**Files:**
- Modify: `apps/web-workbench/src/pages/ImagePage.tsx`
- Modify: `apps/web-workbench/src/pages/ImagePage.test.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageGoalPicker.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageBriefComposer.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageGenerationSettings.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageResultPanel.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageHistory.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageStudioForm.test.tsx`
- Modify: `apps/web-workbench/src/components/image/ImageResults.test.tsx`

**Interfaces:**
- Consumes: selected reference `docs/superpowers/specs/assets/2026-08-28-image-creation-studio-goal-first.png` and all prior tasks.
- Produces: verified local `/image`, a single real lock-subject acceptance run, release evidence, and a mergeable branch.

- [ ] **Step 1: Add failing responsive and accessibility assertions**

测试断言：首标题为“图片创作”；创作目标是可读 group；所有切换使用 `aria-pressed`；上传/关闭/移除/置顶等图标按钮有 `aria-label` 与 `title`；生成设置 dialog 有标题且 Esc 返回焦点；终态进度使用受控 `aria-live`；源码的动效类同时有 `motion-reduce:transition-none` 和 `motion-reduce:transform-none`。

- [ ] **Step 2: Run RED accessibility tests**

Run: `pnpm --filter @holaday/web-workbench test -- src/pages/ImagePage.test.tsx src/components/image/ImageStudioForm.test.tsx src/components/image/ImageResults.test.tsx src/lib/control-tooltip.test.ts`

Expected: at least one new responsive/accessibility assertion fails before the polish pass.

- [ ] **Step 3: Apply the selected visual system without inventing a new one**

- Page: cream-tinted background, 1180–1220px content width, 24–32px section radii, low-opacity shadows.
- Goal cards: sky/lavender/peach accents; equal desktop height; imagery occupies less than half the card so capability copy remains primary.
- Composer: subject panel and prompt form form one continuous surface; no nested-card maze.
- Settings: light full-width dialog on desktop, full-width/bottom-sheet behavior below 768px; style images remain uncropped enough to recognize their subjects.
- CTA: coral pink, one primary action per viewport; settings and continuation actions remain outline/soft-fill.
- Results: mint is reserved for verified subject consistency; amber for partial success/expiry; no green badge without real metadata.
- Motion: 180–240ms opacity/translate only, max 3px hover lift, no endless decorative animation; reduced-motion removes transforms and transitions.

- [ ] **Step 4: Run the full focused automated gate**

Run: `pnpm --filter @holaday/orchestrator test -- src/trpc/routers/tasks-image-options.test.ts src/trpc/routers/files.test.ts src/files/file-service-library.test.ts src/agent/image/image-runner.test.ts src/agent/image/image-input-order.test.ts`

Run: `pnpm --filter @holaday/web-workbench test -- src/components/image src/pages/ImagePage.test.tsx src/lib/image-history-row.test.ts src/stores/task-store.test.ts src/pages/video-page-style-state.test.ts src/lib/video-history-row.test.ts src/App.closure.test.tsx src/lib/control-tooltip.test.ts`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Run: `pnpm --filter @holaday/web-workbench lint`

Run: `pnpm --filter @holaday/web-workbench build`

Run: `git diff --check`

Expected: all focused tests, both typechecks, app lint, app build, and diff check PASS. If repository-wide Biome still reports unrelated historical files, record its exact output separately and do not call it passed.

- [ ] **Step 5: Perform same-state visual comparison in the user's in-app browser**

1. Start the worktree web app with the repository's existing dev command and open local `/image` in the already chosen in-app browser.
2. Capture 1440px desktop states for inspiration, lock-subject, commercial poster, open settings, generated result and expired history; also capture 1280px and one narrow viewport.
3. Put the selected reference and each matching local screenshot side-by-side in one temporary comparison canvas under `/private/tmp`; inspect hierarchy, crop, spacing, typography, border, radius, color and control size together.
4. Fix visible mismatches, recapture and compare again. A screenshot alone is not a pass.
5. Confirm no horizontal overflow, clipped images, covered inputs or controls below 44px.

- [ ] **Step 6: Perform one real test-account acceptance run**

使用已授权的 HOLA DAY 测试账号，仅创建一次“锁定主角 → 生成 2 张 → 主体核对 → 选一张继续改”。记录任务状态、实际附件数、metadata 标签、续作草稿和控制台错误；不输出账号凭据、文件访问令牌或主体核对内部 reasons。

- [ ] **Step 7: Commit the polish and verification evidence**

```bash
git add apps/web-workbench/src/pages/ImagePage.tsx apps/web-workbench/src/pages/ImagePage.test.tsx apps/web-workbench/src/components/image
git commit -m "fix(image): polish accessible studio experience"
```

运行 `git status --short`，预期无未提交文件。如浏览器验收发现代码缺陷，使用上述同一提交前的 RED/GREEN 流程修复；不把 `/private/tmp` 对比文件提交进仓库。

- [ ] **Step 8: Review, PR, merge, deploy, and production verify**

1. Read `superpowers:requesting-code-review` and run a self-review against every spec section.
2. Push `codex/image-creation-studio-design`, create a PR with the exact test table and untouched-sensitive-area list.
3. Resolve all actionable review threads with tests; rerun the full focused gate.
4. After approved merge authorization, merge without rewriting unrelated history.
5. Deploy `orchestrator` first and verify health, then deploy `application`; rollback either service if its own health or smoke gate fails.
6. Verify production `/api/healthz`, `/image` three goals, one non-billable UI-only interaction pass, task/history metadata display and `/video` regression. Do not create a second paid image task in production.

Expected release conclusion: both production health endpoints are 200/status ok; `/image` is goal-first; real image creation still uses current runner; `/video` behavior is unchanged; no new database migration, provider, key or configuration exists.

---

## Final Spec Coverage Checklist

- [ ] Three goals and one-time presets: Tasks 1 and 3.
- [ ] Subject anchor, references, change targets and prompt: Tasks 3 and 4.
- [ ] Real model/style/ratio/count settings: Tasks 1 and 3.
- [ ] Structured metadata and truthful subject-consistency badge: Tasks 2 and 5.
- [ ] Continue edit, keep subject, reuse settings and download/save: Task 5.
- [ ] Expired artifact degradation and re-upload boundary: Task 5.
- [ ] Image/video component separation without video behavior change: Task 6.
- [ ] Upload, submission, partial success, failure, concurrency and object URL cleanup: Tasks 4 and 5.
- [ ] Accessibility, reduced motion and responsive layouts: Tasks 3 and 7.
- [ ] Visual comparison, real acceptance, review, PR, merge, deployment and production verification: Task 7.
