# ④ A股即时问答 — Skill Router 首个场景设计（一页方案 · 待 BOSS+Claude 过目）

> 状态：**方案待审**，未写码。④ 是 Skill Router 第一个真实场景，本方案锁定**模式**——后续 11 个专家技能都复用，第一个不能随手写。
> 关联：复用 #2 已上线的 a-share 数据层（`AkshareClient` / `briefing-*` / akshare-mcp）+ Phase 0 技能包 `skills/a-share-analyst/`。

---

## 0. 一句话定位
用户问「茅台今天为什么跌 / 我的自选股有什么动静 / 宁德时代龙虎榜谁在买」→ 路由到 a-share-analyst 技能 → **系统取真数据 → LLM 接地解读 → 合规闸门 → 带源回答**。v1 范围限定在**现有数据可支撑的盘面/异动问答**。

---

## 1. 关键认知：④ 是「取数-解读」模式，与现有 3 个工作流不同
| | 现有 douyin/content/ecom | ④ A股问答（及后续多数专家技能） |
|---|---|---|
| 数据来源 | **用户贴**（GMV/UV…正则抽取） | **系统取**（akshare 实时取数） |
| 执行 | 抽取 → 算术校验 → 出报告 | 取数 → 接地事实卡 → **LLM 解读** → 合规闸门 |
| 模式名 | extract-then-validate | **fetch-then-interpret** |

→ ④ 给 Skill Router 新增 **fetch-then-interpret 执行模式**；这是后 11 个技能的主模式，所以必须把它定对。
→ ⚠️ ④ 是 **a-share 数据第一次被 LLM 解读**（① 简报全确定性、无 LLM）。本方案 §3 的合规闸门即「单独合规评审」的落地，请 BOSS 先签 §3 再动手。

---

## 2. Registry 怎么接 skills/a-share-analyst/（核心模式：markdown=WHAT，TS=HOW）
现状：`skills/*.md` 由 `syncSkills()` 入库供「commander」用，但 `expert-workflow-registry.ts` 是**纯 TS 常量、与 skills/ 零连接**。④ 搭这座桥，但**不重抄 markdown**：

- **markdown（单一事实源，技能作者维护）** = 人设 + **7 条合规红线** + 方法论 + 输出格式 → 作为 **system-prompt 上下文注入**（复用 `syncSkills()` 已入库内容）。
- **TS（薄适配层，每技能少量）** = ① **matcher**（意图→技能）② **数据绑定清单**（技能→akshare 工具 + 参数解析）③ **合规闸门**。

**接法**：
1. 复用 `matchExpertWorkflow({intent, roleId})` 的匹配注册点（registry.ts），加 **a-share matcher**：个股名/代码命中（茅台/600519…）+ 问句意图（为什么/怎么样/有什么/龙虎榜/公告…），或用户显式选了 `a-share-analyst` 技能（roleId）。
2. 匹配后**分流到新执行器** `ashare-qa-runner`（与 `generate-runner` 并列，**不动现有 3 工作流**）。Registry 从「只有抽取校验工作流」演进为「匹配点 + 多执行模式分流」。
3. v1 **不做** 运行时 `SKILL.md → ExpertWorkflowContract` 全解析（重，且现有 Contract 是「数字抽取」形，不匹配取数技能）。走 **markdown 上下文 + TS 取数执行器** 混合。
4. 门控：`EXPERT_WORKFLOW` + 新 `ASHARE_QA_ENABLED` flag（默认 off，灰度）。

---

## 3. 异动归因合规怎么落（最高风险 —— 请重点审）
「为什么 X 跌」易滑向**预测 / 荐股 / 臆造因果**。四道闸：
1. **接地（数据围栏）**：LLM **只见已取数据**（kline 涨跌+量 / 公告 / 龙虎榜 / 北向 / 解禁），每条带 `source + fetched_at`。系统提示明令**禁用模型外部/记忆知识做因果臆测**，只能引用事实卡内的条目。
2. **系统提示**：注入技能 7 红线 + 「只陈述**已披露事实的同期关联**，不臆断因果、不预测涨跌、不荐股不给目标价、**事实与判断分栏**」。
3. **版式框定**（把因果关进笼子）：异动答案固定四段——
   `① 盘面事实`（涨跌/量，溯源）→ `② 同期已披露信息`（公告/龙虎榜/北向/解禁，溯源）→ `③ 可能相关因素`（**必标「分析师判断·非定论」**，且只能由①②的事实推得）→ `免责`。**因果只许出现在 ③ 且带判断标注**。
4. **合规闸门（生成后，复用 verifier 框架）**：
   - `ADVICE_PATTERN` 哨兵（复用 ①：建议买卖/目标价/抄底/满仓…）
   - **新增预测词正则**（会涨/会跌/将/预计/看到 X 元/继续…）
   - **来源接地校验**：③ 的每条因果须能溯源回①②取到的 envelope；凭空因果判失败。
   - 命中任一 → **降级为「纯数据呈现」**（删 ③ 解读，只留①②事实卡）+ 记 logger + 标 `partial`。宁可少说，不可错说。

---

## 4. 行情+公告+龙虎榜怎么交叉
对「个股 S × 日期 D」：
```
解析 S(名→代码) + D(默认今日/交易日)
   → 并行取(复用 perSymbol + AkshareClient):
        kline(S)[今日涨跌+量]  announcements(S,近窗口)  dragonTiger(D)→筛S
        northboundFlow()[市场面]  unlock(S)[解禁压力]
   → 组装【接地事实卡】(每条 source+fetched_at；复用 sourceTag/fmtNum/fmtPct/fmtYiYuan/unavailableLine/safeLinkUrl)
   → 事实卡 = LLM 唯一上下文 → 接地解读(§3 版式) → 合规闸门 → 回答
```
- 数据缺口**诚实标「数据暂不可用」**（复用 unavailableLine），不臆造。原始异常进 logger（复用 #2 非泄漏改造）。
- 多股/大盘问句 → 复用 watchlist + 指数；个股问句 → 单 S。

---

## 5. v1 范围 + 已知缺口（诚实划线）
- **v1 覆盖**（现有数据足够）：盘面/异动问答（为什么涨跌、今日表现、自选股动静）、个股资讯（公告/龙虎榜/解禁/北向）。≈ 技能里 `thesis 追踪` 的轻量化 + 一个新「盘面速答」意图。
- **暂缓**（akshare-mcp **无** PE/PB/ROE/财报接口）：`dcf` 估值 / `comps` 可比 / `earnings` 财报深读 / `screen` 选股 → 待补**财务数据源**再接（同一模式，只加数据绑定）。本方案先把模式打通，重技能后续平移。
- 复用 ① 合规底座（`BRIEFING_DISCLAIMER` + 溯源 + 时间戳）；`ADVICE_PATTERN` 升级为 ④ 合规哨兵测试。

---

## 6. 落地切片（方案通过后，分 M 提交，每 M 可测可回退）
- **M1**：a-share matcher + 数据绑定 + **接地事实卡组装（无 LLM，纯确定性，先可单测）**。
- **M2**：LLM 解读层 + 系统提示注入（技能 markdown 上下文 + §3 版式）。
- **M3**：合规闸门（哨兵 + 预测词 + 接地校验）+ 降级路径。
- **M4**：验收用例（复用 `skills/a-share-analyst/acceptance` + 合规红线断言）+ flag 灰度上线 + 真问句实测。

---

## 7. 给后 11 个技能的可复用件（这就是「第一个不能随手写」的理由）
① matcher 注册点　② **markdown-as-context 注入**（技能知识/合规/格式不进 TS）　③ 数据绑定清单（技能→数据工具）　④ **接地事实卡**组装　⑤ **合规闸门**（哨兵+预测+接地校验，verifier 内）　⑥ 降级模式（缺数→暂不可用，越线→纯数据呈现）。
→ 后续技能只需：加 matcher + 数据绑定 +（若需新数据）扩 akshare-mcp/接新源；执行器 + 合规闸门复用。

---

### 待 BOSS 拍板的点
1. **§3 合规闸门四道闸**是否认可（这是 a-share LLM 解读的「单独合规评审」）。
2. **§2 markdown=WHAT / TS=HOW 的职责划分**是否定为 Skill Router 通用模式。
3. **§5 v1 范围**（先盘面/异动问答，DCF/comps/财报暂缓待财务源）是否同意。
4. 异动答案 **§3 版式四段**是否合规可接受（因果仅在③+判断标注）。
