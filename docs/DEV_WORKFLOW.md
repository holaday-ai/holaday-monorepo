# HOLA DAY Dev Workflow

> 创始人只说需求、只看最终效果。终端、脚本、bug 排查都由 Claude Code 自己闭环。
> 这份文档是强制 SOP，所有后续开发严格执行。

---

## 角色分工

**创始人 (Yale)**
- 说需求（用自然语言，哪个站、做什么）
- 看最终产品效果（popup 跑通 / 看结果）
- 提问、纠偏、定方向

**不做**：不碰终端、不跑命令、不排查 bug、不手动验证。

**Claude Code**
- 改代码
- 写测试
- 跑 `scripts/test-all.sh`
- 全绿才 push
- push 时在 commit message 带测试结果摘要

---

## 每次改代码的固定流程

> 这是 **强制** 的。没有任何一步可以跳过。

```
┌───────────────────────────────────────────────────────┐
│ 1. 读需求 → 定方案 → 改代码                              │
│                                                         │
│ 2. scripts/test-all.sh                                 │
│    ├─ 全绿 → 进 3                                       │
│    └─ 有红 → 回 1 继续改，直到全绿                       │
│                                                         │
│ 3. git add + commit                                    │
│    commit message 末尾必须包含：                         │
│                                                         │
│    Verified (scripts/test-all.sh):                     │
│    - typecheck × 4 workspaces: clean                   │
│    - unit: 83 pass (17 driver + 66 orch)               │
│    - integration: 21 pass                              │
│    - e2e-smoke: PASS                                   │
│    - extension build: clean                            │
│    - lint: clean                                       │
│                                                         │
│ 4. git push                                            │
└───────────────────────────────────────────────────────┘
```

如果 test-all.sh 里某条检查你**故意跳过**（比如改的是纯文档、lint/build 无关），commit message 要写明 why。默认期望是**全部跑**。

---

## 脚本清单

| 脚本 | 何时用 | 做什么 |
|---|---|---|
| `scripts/start.sh` | 本地起服务 / CI 准备环境 | git pull + install + build + 检查代理 + 起 MariaDB/Redis（Linux sandbox 自动起；Mac 依赖 brew）+ `sync-skills` + 起 orchestrator（后台，PID 文件在 `/tmp/holaday-orchestrator.pid`，日志 `/tmp/holaday-orchestrator.log`） |
| `scripts/test-all.sh` | **每次 push 前必跑** | 4 个 typecheck + 3 个 unit 套件 + integration + extension build + lint + e2e-smoke；打 PASS/FAIL 汇总；有红就 exit 1 |
| `scripts/e2e-smoke.sh` | test-all.sh 内部用；也可单跑 | 启动 orchestrator + curl 注册登录 + POST `tasks.smokeTest`（Baidu 硬编码 plan，不需要真 Chrome）+ 断言 task 形状 + DB 持久化正确 |
| `scripts/refresh.sh` | 只在创始人 Mac 上真机冒烟用 | pull + build + 杀老 orchestrator（手动起新的） |

---

## 测试分层

```
┌────────────────────────────────────────┐
│  可在 sandbox（无 Chrome）跑的          │
│  —— Claude Code 的自测循环             │
├────────────────────────────────────────┤
│  • typecheck × 4                       │
│  • unit × 3 workspaces                 │
│  • integration × 1 workspace           │
│    （真 MariaDB + Redis + tRPC + WS）  │
│  • extension build + lint              │
│  • e2e-smoke                           │
│    （curl → tRPC → DB，HTTP 侧端到端） │
└────────────────────────────────────────┘
          ↓ 这一层过了才 push
┌────────────────────────────────────────┐
│  需要真 Chrome 的 live E2E             │
│  —— 只在创始人 Mac 上手跑，频率低       │
├────────────────────────────────────────┤
│  • 抖音 creator.douyin.com 真业务       │
│    ./scripts/refresh.sh                │
│    → chrome://extensions reload         │
│    → popup 输入真实 intent              │
│  • 雪球持仓摘要（同上）                  │
└────────────────────────────────────────┘
```

CI 层（test-all.sh）覆盖 ~100 个检查点。live 层覆盖真 DOM 交互——后者**不是每次改代码都跑**，创始人周期性抽查即可。

---

## commit message 规范

固定三段式：

```
<type>(<scope>): <72 字内小结>

<正文：改了什么、为什么，以及对用户可见效果>

Verified (scripts/test-all.sh):
- typecheck × 4: clean
- unit: 83 pass
- integration: 21 pass
- e2e-smoke: PASS
- extension build: clean
- lint: clean
```

正文里可以带**决策记录**、**踩坑笔记**、**风险残留**。最后的 Verified 块是**机械粘贴** test-all.sh 尾部 summary。

---

## 失败处理

test-all.sh 有红时：
1. 看 summary 块里的 `✘ <label> (log: <path>)`
2. `cat <path>` 看具体错误
3. 修 → 重跑 → 直到全绿
4. 如果某个测试真的是 flaky（连跑两次一次过一次挂），不能直接 push；要么稳定住，要么 quarantine（加 `.skip` + 开 issue）
5. 绝对不能用 `git commit --no-verify` 绕过（项目没装 pre-commit hook，但原则适用）

---

## 环境前提（founder 的 Mac 一次性设置）

```
brew install mariadb redis pnpm jq
brew services start mariadb
brew services start redis
# 建 holaday 用户 / 库（orchestrator 启动会自动跑 migration）
mysql -u root -e "CREATE DATABASE holaday; CREATE USER 'holaday'@'127.0.0.1' IDENTIFIED BY 'holaday-dev'; GRANT ALL ON holaday.* TO 'holaday'@'127.0.0.1';"
```

此后所有命令 **都由 Claude Code 跑**，founder 不再碰终端。

---

## 反模式（别做）

- ❌ "我本地跑了，绿的" → 必须 `scripts/test-all.sh` 输出粘贴进 commit message
- ❌ "这个测试挂一直挂，先 skip 了" → quarantine 必须带 issue 跟进
- ❌ 让创始人"帮我跑一下看看" → 这违反分工。Claude Code 自己想办法（sandbox 能跑就 sandbox 跑，sandbox 不能跑就告知 founder 是什么类型的阻塞，然后继续下一任务）
- ❌ 在没跑完 test-all.sh 的情况下 push — 任何例外都得在 commit message 里明确说明

---

## 为什么这样约束

HOLA DAY 是 **meta-agent** 产品（见 `PRODUCT_PRINCIPLES.md`），自己就是个 AI 智能体。开发这个产品的团队如果连自测都要人工，那产品本身的 "agent 替用户做事" 叙事就站不住。**用 agent 造 agent，从开发流程开始践行**。
