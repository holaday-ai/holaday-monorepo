---
slug: template-fill
name: 模板填充（Office 保格式填充）
version: 0.1.0
description: 把用户数据填进用户上传的 docx/xlsx 模板，保留原格式，返回可下载成品。区别于从零生成文档——格式资产是用户的，一个字都不能跑版。
occupationTag: document-automation
riskFloor: low
hints:
  - 只填模板里显式标注的 {占位符} 和 {#循环}{/循环}；不猜锚点、不发明 schema 之外的字段。
  - 模型只产出字段映射 JSON（fields / loops / missing）；确定性引擎填字节，模型永不接触文件。
  - 数据里找不到的占位符放进 missing 并留空，诚实降级 partial_success，绝不编造或填占位文字。
  - 数值/日期/金额/单位一律按字面照抄用户数据，保持原样。
  - docx 用 docxtemplater + pizzip；xlsx 用 exceljs（读改写保样式）；pptx v1 暂不支持，诚实说明并建议 docx/md。
caveats:
  - 工艺知识对标 github.com/anthropics/skills 的 docx/xlsx 技能（OOXML 结构保全、样式继承、表格行复制、合并单元格陷阱）；本文为独立撰写、未逐字拷贝其文件，引擎为 Node 而非其 Python 运行时（裁决三）。引用前请核对该仓库 LICENSE。
  - 模板按不可信 zip 处理：拒收宏（.docm/.xlsm/vbaProject.bin）、含远程引用的外部关系、zip 炸弹；占位符 ≤500、循环行 ≤2000、模板 ≤20MB。
  - basic / free 账号无法生成 office 文件 → 返回字段映射预览（markdown 表）+ 升级提示，不产出文件、不假声称。
  - xlsx v1 仅支持单行循环（{#x}…{/x} 在同一行）；多行循环体诚实报错。
---

# Skill: 模板填充（template-fill）

## 典型用户意图

> "按这个模板填一份发票，客户张三，金额 1200。"（上传 invoice.docx）
> "把这份 csv 的明细套进我的周报模板。"（上传 weekly.docx + data.csv）
> "用我的报价单模板生成给李四的报价。"（上传 quote.xlsx）

区别于「做一个模板 / 设计一份周报模板」——那是从零生成（走 generate），不是填充。

## 分工铁律（裁决一）

```
确定性引擎（TS）：解 zip → 提取占位符 schema → 校验 JSON → 填字节 → storeOutput → 下载卡
模型（一次受约束调用）：用户数据 × 占位符 schema → 严格 JSON {fields, loops, missing}
校验器（确定性）：不准发明占位符 / 类型检查 / 必填覆盖 → 不过即 partial，绝不假成功
```

模型的产物只有那段 JSON。它不渲染、不写文件、不碰字节。

## 占位符语法（裁决五：只认显式占位符）

- 普通字段：`{client_name}`、`{date}`、`{total}` — 标量替换。
- 循环（重复行/项）：`{#items}` … `{desc}` `{qty}` `{price}` … `{/items}` — 每个数据行一个对象。
- docx：占位符写在正文/表格单元格里；docxtemplater 自动跨 run 拼接被 Word 拆散的标签。
- xlsx：占位符写在单元格内，同语法；exceljs 替换单元格值时保留该单元格的字体/底纹/边框/数字格式。
- 模板里**没有任何占位符** → 诚实失败：「模板中未发现 {字段} 占位符，请标注后重试」。不做"让模型猜哪里该改"（跑版 + 幻觉双风险）。

## OOXML 保格式工艺要点（vendored 知识）

- **样式继承**：填充值继承占位符所在 run / 单元格的样式。占位符要单独成 run/单元格时样式才稳；混排文本（"客户：{x}"）保留前缀样式。
- **表格行复制**：docx 的 `{#rows}…{/rows}` 在 `paragraphLoop` 下按段落/表格行展开；xlsx 用 `duplicateRow` 逐行复制保样式。
- **合并单元格陷阱**：被合并的从属单元格不要放占位符（值写不进）；占位符放主单元格。
- **数字/日期**：引擎按文本写入；要数值参与公式时由模板预设单元格格式，值仍按字面填。
- **原始 XML 注入面**：`{@raw}` 这类 raw-xml 标签会绕过转义 → 引擎登记为 unsupported、绝不填充。

## 缺字段与降级（诚实优先）

- validator 的 `missing` 非空 → 终态 `partial_success`，回答里列出留空字段，文件仍按已知字段交付（部分交付好过不交付）。
- 完全没有可填数据 → `partial_success` 但不产出空白文件，提示补数据或传 csv/xlsx。
- pptx 模板 → 诚实说明 v1 不支持，建议改用 docx/md（复用 filegen P1 降级文案）。
- basic/free → 字段映射预览（markdown 表）+ 「office 成品需升级 Pro」。

## 安全红线（模板 = 不可信输入，§7）

- 宏文件（.docm/.xlsm，或含 `vbaProject.bin`）→ 直接拒收，不做"剥宏后继续"。
- 含远程 `attachedTemplate`/`externalLink` 等外部关系 → 拒收（template-injection）。
- zip 炸弹（条目数/解压总字节/单文件/压缩比超限）→ 解包前按头部尺寸拒收，不解压。
- 填充值一律按字面文本写入（XML 转义内建；exceljs 绝不写成公式 → 杜绝 CSV/公式注入）。
