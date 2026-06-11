# Phase 1 指令 #1 — 模板填充管线架构设计（v1.0 定稿）

> 作者：Fable 5（重架构设计），2026-06-11。**定稿后由 Sonnet 按本文实现，不再重开架构决策。**
> 前置事实：`HOLADAY_PHASE1_SPRINT_PLAN.md` 原文不在本 clone（BOSS 对话内贴出）；本设计基于 memory 记录的指令要点（「#1 模板填充，fork anthropics/skills」）+ 代码库现状。若原计划与本文冲突，以 BOSS 澄清为准，差异点见 §11 假设清单。

---

## 1. 一句话目标

用户上传**自己的 Office 模板**（docx / xlsx，pptx 二期）+ 提供数据（聊天文本或第二个数据文件 csv/xlsx/json），HOLA DAY **保格式填充**并返回真实可下载产物——周报、发票、合同、报价单、人事表格类场景。区别于现有 filegen（模型从零生成内容），模板填充的格式资产是用户的，**一个字都不能跑版**。

## 2. 核心架构裁决（五个一锤定音）

### 裁决一：确定性引擎填文件，模型只做语义映射
模型**永远不接触文件字节**（与既有铁律一致：模型无代码执行/无 Office 渲染，create_file 是唯一产物通道）。分工：

```
orchestrator(确定性 TS)：解 zip → 提取占位符 schema → 执行填充 → storeOutput → holaday-file fence
model(一次受约束调用)：  用户数据 ⨯ 占位符 schema → 严格 JSON 映射 {fields, loops, missing}
validator(确定性)：      JSON 校验（不准发明占位符/类型检查/必填覆盖）→ 不过即 partial，绝不假成功
```

这是携程酒店 model-primary + `validateHotelJson` 的同款已验证模式，照搬。

### 裁决二：独立 `template_fill` lane，与 #5 image lane 完全同构
不塞进 supercar（纯文件任务烧 Brave 槽位是浪费，且 #5 已确立 runner-per-modality 先例）。机制逐项对齐 #5 已落的接线（见其未提交 diff）：

| 机制 | #5 image（已落） | #1 template_fill（本设计） |
|---|---|---|
| ExecutionMode | `'image'` 字面量 | `'template_fill'` 字面量 |
| 分类信号 | IMAGE_PATTERNS 强信号 | TEMPLATE_FILL_PATTERNS 强信号（§5） |
| runner 目录 | `agent/image/` | `agent/template/` |
| dispatcher | `tasks.ts` 中 `executionMode === 'image' && appEnv.GEMINI_API_KEY` fork | `executionMode === 'template_fill' && appEnv.TEMPLATE_FILL_ENABLED` fork |
| 无 key/flag 回落 | 回落 generate | 回落 generate（模型会诚实说明无法填模板） |
| 止血 | 清 GEMINI_API_KEY | TEMPLATE_FILL_ENABLED=false |
| 并发记账 | concurrency-tracker 扩展 | 同款扩展（轻量任务，不占 Brave 槽） |

### 裁决三：fork anthropics/skills = 取其知识，不取其运行时
anthropics/skills 的 docx/xlsx/pptx 技能是 Python 脚本 + SKILL.md 工艺手册。我们的运行时是 Node、且已向模型硬声明「无 Python/代码执行」。所以 fork 的正确姿势：
- **vendor 工艺知识**：把其 docx/xlsx SKILL.md 中「OOXML 结构保全、样式继承、表格行复制、合并单元格陷阱」等手册内容改写为 ① 模板填充 runner 的系统提示层 ② `skills/template-fill/SKILL.md`（HOLA DAY skill-sdk 格式，经 `skills/registry.ts syncSkills` 入库，与 P0 expert skills 同一注册机制，等 SkillRouter 落地即免费获得路由）。
- **不引入 Python 沙箱**（新攻击面 + 违背既有提示硬化，一票否决）。
- 实现保留对 upstream 的 fork 关系（`gh repo fork anthropics/skills` 留 provenance），vendor 时核对其 LICENSE 并在文件头注明出处。

### 裁决四：填充引擎选型（新依赖，各司其职）
| 格式 | 引擎 | 理由 |
|---|---|---|
| docx | **docxtemplater + pizzip**（新增 dep） | 现有 `docx` lib 只能从零生成、不能改既有文件。docxtemplater 是事实标准：`{field}` 占位、`{#rows}{/rows}` 循环、XML 转义内建、MIT。 |
| xlsx | **exceljs**（新增 dep） | 现有 SheetJS CE 写回会丢样式；exceljs 读改写保留样式。SheetJS 仍留用于数据文件解析（parsers.ts 已用）。 |
| pptx | **二期（M3 stretch）** | Node 无成熟填充库；走 pizzip + XML text-run 替换风险高。v1 对 pptx 模板诚实降级（说明暂不支持 + 提供 docx/md 替代），复用 filegen P1 的 honest-degrade 文案模式。 |
| pdf | 不在范围（AcroForm 另立项） | — |

### 裁决五：占位符规范 v1 = 显式占位符，杜绝"模型猜锚点"
v1 只支持模板里**显式**写占位符：`{field}`、`{#loop}…{/loop}`（docxtemplater 原生）；xlsx 用单元格内 `{field}` 同语法。**不做**"无占位符模板让模型猜哪里该改"（锚点替换 = 跑版+幻觉双风险，列为 v2 实验项、独立 flag）。模板不含任何占位符 → 诚实失败：「模板中未发现 {字段} 占位符，请在需填充处标注后重试」+ 列出语法示例。

## 3. 端到端数据流

```
① 用户上传模板.docx（→ task_files kind='input'，已有 Phase10 Tier3 通道）+ 输入指令（含内联数据或再传数据文件）
② intent-classifier → 'template_fill'（§5 信号）
③ tasks.ts dispatcher fork → runTemplateFillTask({taskId, intent, templateFile, dataFiles, deps})
④ runner：fetchInputFile(fileId) → 字节安全检查（§7）→ 引擎 extractPlaceholders() → PlaceholderSchema
⑤ runner：parseFileForPrompt() 喂数据文件文本 + intent 内联数据 + PlaceholderSchema → 一次模型调用 → 严格 JSON
⑥ validateFillJson()：占位符全集校验（不准多/类型匹配/required 缺失列入 missing）
⑦ 引擎 fill()：docxtemplater.render() / exceljs 写回 → Buffer
⑧ fileService.storeOutput()（24h TTL、R2，全复用）→ holaday-file fence 回给… ——注意：此 lane 无 agent loop，
   runner 直接把 fence 拼进 final text 模板（不依赖模型转述 fence，绕开 filegen 已知的"模型丢 fence 靠 L3 fold 兜底"单点）
⑨ final text 固定骨架：已填充字段表 + ⚠️missing 字段列表（如有→partial）+ fence + 「保留了模板原格式」
⑩ verifier（§6）→ 终态。SPA 零改动（FileDownloadCard 解析 fence 已有）。
```

关键改良（对比 filegen 现状）：**fence 由 runner 确定性拼接**，不再依赖模型把 tool_result 里的 fence 抄进答案——从源头消灭「folded un-fenced」单点依赖（夜间 QA 实证 5/5 全靠 fold 兜底的问题，本 lane 不复现）。

## 4. 模块清单（Sonnet 实现顺序即此序）

```
apps/orchestrator/src/agent/template/
  placeholder-schema.ts      纯函数：PlaceholderSchema 类型 + validateFillJson()（先写，纯函数好测）
  docx-template-engine.ts    extractPlaceholders(buf) / fill(buf, data) → Buffer（docxtemplater+pizzip）
  xlsx-template-engine.ts    同上（exceljs）
  template-safety.ts         §7 安全检查纯函数（zip 炸弹/宏/外部关系/大小/MIME 嗅探）
  template-fill-runner.ts    runTemplateFillTask()——镜像 image-runner.ts 的 opts/Result/SaveFn 形态
  *.test.ts                  每模块同名测试
skills/template-fill/SKILL.md   vendor 自 anthropics/skills 的工艺手册（注明出处+license）
```
接线改动（均为已有文件最小增量）：`intent-classifier.ts`（mode 字面量+patterns）、`config/env.ts`（TEMPLATE_FILL_ENABLED）、`trpc/routers/tasks.ts`（dispatcher fork，抄 image fork 的骨架）、`quota/concurrency-tracker.ts`（同 image 的轻量记账）、`files/writers.ts` 不动。

## 5. 路由信号（强信号，进 INTERACTION 同级）

```
正例（→ template_fill，要求"模板语境 + 填充动词"或上传了 docx/xlsx 附件 + 填充动词）：
  填充模板 / 套模板 / 按(这个|附件)模板(生成|填|做) / 把数据填进(模板|表格|文档) /
  用我的模板 / fill (in|out)? (the|this)? template / 模板里的字段
负保护：
  「做一个模板」「设计一份周报模板」（生成模板 ≠ 填充模板）→ 走 filegen/generate；
  「模板怎么写/模板范例」→ generate。
硬条件：attachments 含 docx/xlsx 时信号增强；无任何附件且无内联数据 → runner 直接 awaiting_user
  （clarification：「请上传模板文件」），不空转。
```

## 6. 验收与 verifier 扩展（确定性，零模型）

新增 `template_fill_consistency` check（answer-verifier 第 7 检查，仿 file_artifact/source_domain 模式）：
1. final text 声称「已填充」⇒ 必须存在 fence + output 文件（file_artifact 已覆盖，复用）。
2. validator 的 `missing` 非空 ⇒ final text 必须列出 missing 字段且终态 partial_success（runner 直接定级，verifier 兜底防 runner 漏）。中文 detail：「模板中 N 个字段未能从你提供的数据中找到，已留空：…」。
3. 输出格式族 == 模板格式族（docx 进 docx 出）；不一致只可能是显式降级（pptx→docx/md），final text 必须含降级说明（套用 filegen P1 的「需升级/暂不支持，已改用 X 交付」句式）。

## 7. 安全（模板 = 用户提供的 zip，按不可信输入处理）

- **zip 炸弹**：pizzip 解包前后双限——条目数 ≤2000、解压后总字节 ≤100MB、单文件 ≤30MB、压缩比 >200 拒绝。
- **宏**：`.docm/.xlsm/.pptm` 直接拒绝（诚实说明），`vbaProject.bin` 存在即拒绝——不做"剥宏后继续"（剥了用户还以为有）。
- **外部关系**：剥离/拒绝含远程 template-injection 的 `externalLinks`/远程 `attachedTemplate` 关系。
- **注入**：填充值一律按字面文本写入（docxtemplater 默认 XML 转义；exceljs 显式 `cell.value = {richText|string}`，**绝不**把用户数据写成公式——杜绝 CSV/公式注入）。
- 上限：模板 ≤20MB；占位符 ≤500 个；loop 行 ≤2000。
- plan 门控：输出走 `allowedFormatsForPlan` 同款判定——basic 用户填 docx/xlsx 模板时：v1 决定 = **模板填充按输出格式要求 pro**；basic 给「字段映射预览（markdown 表）+ 升级提示」诚实降级（与 filegen P1 行为一致，文案复用）。

## 8. Flag 与回滚

`TEMPLATE_FILL_ENABLED`（默认 false）→ 关即全量回落 generate（模型诚实说不支持）。无 DB migration（task_files/skills 表全复用）。无 SPA 改动。部署遵循 `docs/DEPLOY_RUNBOOK.md`。

## 9. 里程碑（1 周，Sonnet 执行）

| 日 | 交付 | gate |
|---|---|---|
| M1（D1-2） | placeholder-schema + docx 引擎 + safety 纯函数 + 单测 | 纯函数测试全绿（先不接线） |
| M2（D3-4） | runner + 路由 + dispatcher fork + env flag + verifier check + 单测 | 全量 vitest/tsc/build/diff-check 绿；push 汇报 |
| M3（D5） | xlsx 引擎 + 数据文件（csv/xlsx）摄取 + basic 降级 + e2e QA 六件套（§10） | QA 全过 → BOSS 审查 → 部署 |
| stretch | pptx via OOXML 替换（独立 flag TEMPLATE_FILL_PPTX） | 不阻塞 M3 验收 |

## 10. e2e QA 六件套（验收标准，照夜间 QA 风格留证）

1. docx 发票模板 + 内联数据 → 真 docx 卡、字段全填、格式不跑版（人工开文件抽查）。
2. docx 周报模板含 `{#rows}` 循环 + csv 数据文件 → 行循环正确展开。
3. xlsx 报价单模板 + 内联数据 → 样式保留（exceljs 验证点）。
4. 数据缺 2 个字段 → partial_success + missing 列表 + 已填字段仍交付（诚实部分交付）。
5. basic 账号 → 字段映射预览 + 升级提示，无假声称（guard 不误报）。
6. 恶意样本（zip 炸弹 ×1、.docm ×1）→ 拒绝 + 友好说明，无崩溃无超时。

## 11. 假设清单（与 sprint plan 原文可能的差异点，开工前 BOSS 扫一眼）

A1 「模板填充」指**填用户上传的 Office 模板**（非"内置模板库"）。若原计划是内置模板库，§2 裁决一/三/四不变，增加模板资产目录 + 选择 UI，路由信号改为模板名匹配。
A2 v1 格式范围 docx+xlsx、pptx 二期。
A3 basic 降级策略（预览+升级提示）沿用 filegen P1 先例。
A4 fork anthropics/skills 取知识不取 Python 运行时（裁决三）。
