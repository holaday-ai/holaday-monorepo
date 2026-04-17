# HOLA DAY Orchestrator 服务骨架技术设计

> **版本**：v1.0 · 2026-04-17
> **作用域**：Phase 0 MVP（2026 Q2，6-8 周）
>
> **注**：本文件是创始人在 2026-04-17 通过对话粘贴交付的设计文档。此处保留决策锚点与 DDL 草案，完整正文以对话交付版为准，建议后续由创始人 `git push` 覆盖此文件以建立 repo 内的 source of truth。

---

## 决策记录

| 项 | 决定 |
|---|---|
| 浏览器控制方案 | 路径 A：Playwright-CRX |
| 代码仓库 | Monorepo `holaday-monorepo`，pnpm workspace |
| 语言 | TypeScript 全栈 |
| 数据库 | MySQL 8，schema 与 OrangeBench 字段命名兼容 |
| 对象存储 | MinIO / 腾讯云 COS |
| 缓存 | Redis |
| Anthropic API Key | 新开独立账号 |
| 部署 | Phase 0 Manus + 脚本，Phase 1 GitOps |

---

## Phase 0 数据表清单

1. `users`（账号）
2. `user_profiles`（职业指纹）
3. `tasks`（主任务）
4. `task_steps`（子步骤，Agent Loop 核心）
5. `task_events`（事件日志 / 审计基础）
6. `skills`（Skill 索引，内容在 Git）
7. `sessions`（扩展会话）
8. `llm_calls`（计费基础）

详细 DDL 见对话原文 §3.2。关键 schema 原则：
- 对外 ID 用 `external_id`（`usr_xxx` / `tsk_xxx` / `sess_xxx`）
- 所有时间戳 UTC
- JSON 字段用于松结构数据，重要事实用列
- Phase 0 不做 soft delete

---

## Agent Loop 状态机

```
pending → planning → executing ↔ awaiting_user
                        ↕           ↓
                      paused    cancelled
                        ↓
                    completed / failed
```

核心特性：
- 每步完成后立即持久化，Orchestrator 重启可从 MySQL 恢复
- 高危动作（支付/删除/发送/改密码）强制 `awaiting_user`
- 单次 LLM token 超限 → 新建 step 接续（绕开 Claude continue 限制）

---

## 技术栈

**apps/orchestrator**
- Node.js 20+、TypeScript 5+
- Express、tRPC、ws、mysql2、ioredis、zod、pino、@anthropic-ai/sdk
- ORM 倾向 **Drizzle**（可 Prisma，决策点 10.2）

**apps/extension**
- Chrome 120+、MV3
- @crxjs/vite-plugin、React 18、playwright-crx、zustand

**apps/web**
- Next.js 14 或 Vite + React
- tRPC client、tailwindcss

---

## Monorepo 骨架

```
holaday-monorepo/
├── apps/
│   ├── extension/
│   ├── orchestrator/
│   └── web/
├── packages/
│   ├── shared-types/
│   ├── browser-driver/   # HolaDayBrowserDriver 接口 + Playwright-CRX Adapter
│   └── skill-sdk/
├── skills/               # Phase 0 内置，Phase 1+ 迁 holaday-skills 独立 repo
├── docs/
└── scripts/
```

---

## Milestone 1 验收（Phase 0 End）

### 功能
- 手机号注册登录 + 5 分钟引导生成职业指纹
- 扩展装机 + WebSocket 连通
- 自然语言任务 → 司令层拆解 → 选中 Skill → 执行 → 实时可视化
- 高危动作弹窗确认
- 任务完成展示结果 + Web 历史查询
- 3 个预装 Skill：千牛客服汇总、生意参谋导出、差评回复
- Agent Loop 崩溃恢复
- 任务完成率 > 60%（10 家种子企业真实场景）

### 非功能
- WebSocket 断线 5s 内重连
- 单动作延迟 p95 < 3s
- Orchestrator 7x24 不崩
- 核心模块测试覆盖率 > 70%

### Phase 0 明确不做
- 付费 / 订阅 / 账单 / 发票
- SSO / SAML / 企业权限
- 云浏览器池 / 定时任务
- 平板 APP / 微信小程序 / 桌面客户端
- Skill Marketplace / 第三方开发者
- 等保三级 / 算法备案
- 股市合规模块

---

## 关键决策点（需向创始人确认）

- ⚠️ 数据库 DDL 定稿前
- ⚠️ WebSocket 协议定稿前
- ⚠️ 任何 > 1 人天的额外设计

---

## 开工路线图（建议顺序）

| 周 | 日期 | 主题 |
|---|---|---|
| W1 | 04-21 ~ 04-25 | Monorepo 骨架 + DDL + API 骨架 + Agent Loop + WS 协议 |
| W2 | 04-28 ~ 05-02 | SkillLoader + CommanderLayer + LLM Router + 第一个 Skill 端到端 |
| W3 | 05-05 ~ 05-09 | SafetyFilter + 高危确认流程 + 可视化 UI + 审计日志 |
| W4 | 05-12 ~ 05-16 | 第二、第三 Skill + bug fix |
| W5 | 05-19 ~ 05-23 | Web 管理面板 + 首次引导 |
| W6-8 | 05-26 ~ 06-13 | 10 家种子 dogfood + 迭代 + Phase 1 启动材料 |
