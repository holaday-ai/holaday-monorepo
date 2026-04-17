# HOLA DAY Chrome 扩展技术预研评估矩阵

> **版本**：v1.0 · 2026-04-17
> **用途**：Phase 0 核心技术选型决策依据
> **时间预算**：5 个工作日
>
> **注**：本文件是创始人在 2026-04-17 通过对话粘贴交付的设计文档。此处保留决策锚点，完整正文以对话交付版为准，建议后续由创始人 `git push` 覆盖此文件以建立 repo 内的 source of truth。

---

## 决策锚点（从原文提取）

### 三条候选路径
- **A**：Playwright-CRX 一体化（扩展内全 TS）——**推荐**
- **B**：Browser Use 后端桥接（Python + Node 分裂）——探路
- **C**：自建 CDP 层——储备给 Phase 2+

### 加权总分（权重：极高=3 / 高=2 / 中=1）
| 路径 | 分 |
|---|---|
| A Playwright-CRX | **126** |
| B Browser Use | 106 |
| C 自建 CDP | 101 |

### v0.2 纠错
战略 v0.2 §5.3 说"browser-use.js 或 Playwright-CRX 二选一"不准确：Browser Use 是 Python 框架，没有扩展 SW 里能跑的 JS 版本。真实是三选一。

### 路径 A 的对冲（应对单人维护风险）
1. Phase 0 fork `ruifigueira/playwright-crx` 到我们的 GitHub 组织
2. 封装 `HolaDayBrowserDriver` Adapter 层
3. Phase 2 评估切换到路径 C

### PoC 时间预算（5 个工作日）
| 任务 | 人天 |
|---|---|
| 6.1 路径 A PoC（A1 骨架 / A2 登录态 / A3 DOM+动作 / A4 SW 挂起 / A5 WS 通信） | 2.0 |
| 6.2 路径 B 探路（B1 跑通 / B2 relay 可行性 / B3 复杂度） | 1.0 |
| 6.3 路径 C 调研（C1 CDP 文献 / C2 最小化 PoC） | 1.0 |
| 6.4 汇总 `PoC_REPORT.md` | 1.0 |

### 验收里程碑
- Day 2 末：A1-A2（登录态继承）可行 → 创始人确认
- Day 4 末：PoC_REPORT 初稿 → 创始人 review
- Day 5：最终决策会（创始人 + Claude 对话层 + Claude Code）
- **交付日期：2026-04-24（周五）**

### Fallback 预案（§八）
- 场景 1：A 在 MV3 上有无法绕过 blocker → 回退 C，Phase 0 延长 10-12 周
- 场景 2：SW 挂起无法稳定 → 引入 Native Messaging Host（桌面程序保持长连接）
- 场景 3：Browser Use agent loop 和司令层冲突严重 → 坚持 A，不引入 Browser Use
- 场景 4：三条都跑不通 → 紧急评估 BrowserOS / 其他 Agentic Browser fork
