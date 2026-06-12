# Skill Router 通用模式（架构基线）

> BOSS 拍板（2026-06-12）：本模式为 12 个专家技能的统一范式，后续技能**照此办理**。
> 首个落地：A股即时问答 ④，详见 [PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md](PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md)。

---

## 核心原则：markdown = WHAT，TS = HOW

技能的**知识不进 TS**——12 个技能已是 markdown 作者件，TS 重抄会双写 + 漂移。

| 层 | 归属 | 内容 | 来源 |
|---|---|---|---|
| **WHAT（知识）** | `skills/<skill>/`（markdown） | 人设 + 合规红线 + 方法论 + 输出格式 + 命令 + 数据源声明 | 技能作者维护；`syncSkills()` 已入库；作为 **system-prompt 上下文注入** |
| **HOW（执行）** | orchestrator TS（薄适配层） | ① matcher ② 数据绑定清单 ③ 合规闸门 | 每技能少量 TS，复用执行器 |

→ 加一个新技能 = 写/复用 markdown（WHAT）+ 加 matcher + 数据绑定（HOW）+（若需新数据）扩数据源。**不重写执行器、不重写合规闸门。**

---

## 两种执行模式

| 模式 | 数据来源 | 执行 | 例 |
|---|---|---|---|
| **extract-then-validate** | 用户贴（正则抽取） | 抽取 → 算术校验 → 出报告 | douyin/content/ecom（现有 Phase 2） |
| **fetch-then-interpret** | 系统取（外部数据源） | 取数 → **接地事实卡** → LLM 解读 → **合规闸门** | A股问答 ④ + 后续多数专家技能 |

两模式统一在 `matchExpertWorkflow` 匹配点分流到不同执行器。**fetch-then-interpret 由 ④ 首次定义**。

---

## fetch-then-interpret 六个可复用件

1. **matcher 注册点** — 复用 `expert-workflow-registry.ts` 的匹配；加技能 matcher（意图关键词 / roleId / 实体抽取）。
2. **markdown-as-context 注入** — 技能 markdown（人设/合规/格式）作 system-prompt 上下文，不进 TS。
3. **数据绑定清单** — 技能意图 → 要取的数据工具 + 参数解析（TS 薄映射；逻辑数据源声明在技能 `.mcp.json`）。
4. **接地事实卡** — 并行取数 → 组装事实卡，**每条带 `source + fetched_at`**；缺数诚实标「数据暂不可用」，不臆造；原始异常进 logger 不泄漏。LLM **只见事实卡**（数据围栏）。
5. **合规闸门（生成后，verifier 内）** — 哨兵正则（荐股 `ADVICE_PATTERN` + 预测词）+ **来源接地校验**（每条判断须溯源回事实卡）。越线 → **降级**。
6. **降级模式 + 可观测** — 缺数→「数据暂不可用」；越线→「纯数据呈现」（删解读留事实）。**降级必打日志 + 计数**（`<skill>_degrade_total` 按 reason 分桶 / `<skill>_total`）——降级率 = LLM 解读可靠性指标 + **放不放开该技能解读的依据**。

---

## 合规闸门（LLM 解读类技能强制）

任何 LLM 解读外部数据的技能，**生成后**必过闸门：
- **哨兵正则**：荐股/目标价（`ADVICE_PATTERN`）+ 预测词（会涨跌/将/预计…）。技能可叠加自有红线。
- **来源接地**：解读/判断的每条事实须溯源回取到的 envelope；凭空判失败。
- **越线降级**：删解读、只留确定性事实卡，标 `partial`，**记日志 + 计数**。
- **固定免责 + 逐条溯源 + 时间戳**：复用数据层底座（如 a-share 的 `BRIEFING_DISCLAIMER` / `sourceTag`）。

> 原则：**宁可少说，不可错说**。新技能在降级率达标前，解读默认保守/灰度。

---

## 门控与灰度

- 全局 `EXPERT_WORKFLOW` flag + 每技能 `<SKILL>_ENABLED` flag，默认 off → 灰度。
- 新技能上线前：matcher 单测 + 接地事实卡单测（无 LLM 确定性部分）+ 合规闸门哨兵测试（复用技能 `acceptance/`）+ 降级率观测达标。

---

## 落地切片模板（每技能照走）

- **M1**：matcher + 数据绑定 + **接地事实卡（无 LLM，纯确定性，可单测）**。
- **M2**：LLM 解读层 + markdown 上下文注入 + 版式框定。
- **M3**：合规闸门（哨兵 + 接地校验）+ 降级 + 计数。
- **M4**：验收用例（复用技能 `acceptance/`）+ flag 灰度 + 真问句实测 + 降级率观测。
