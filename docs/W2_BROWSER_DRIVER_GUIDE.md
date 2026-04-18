# W2 Browser-Driver 真机冒烟指南（founder 本地跑）

> **范围**：W2 Day 4 PlaywrightCrxAdapter 落地，需要在你本机 Chrome 上验证真执行。沙箱里跑不了 Chrome，所以这条路径只能由你现场走。
>
> **目标**：验证 `packages/browser-driver/` + extension SW dynamic import 在真 CRX 里能跑通一次 `goto + extract` 往 `eastmoney.com` 公开首页。**不需要**任何登录。登录态场景留 Day 5。

---

## 0. 准备

```bash
cd holaday-monorepo
git fetch && git checkout claude/chrome-extension-poc-biwr6 && git pull
pnpm install

# MySQL + Redis 起着
docker compose up -d mysql redis
pnpm --filter @holaday/orchestrator db:push
pnpm --filter @holaday/orchestrator sync-skills       # 5 skills active

# (可选) Anthropic key 冒烟
pnpm --filter @holaday/orchestrator smoke-anthropic   # Haiku OK

# 构建 extension（生成 dist/ + crx-adapter 动态 chunk）
pnpm --filter @holaday/extension build
# 期望产物：
#   dist/assets/index.ts-*.js        主 SW 入口（~66 KB / 17 KB gzip）
#   dist/assets/crx-adapter-*.js     Playwright-CRX 适配层（~3 MB / 841 KB gzip）
#   dist/manifest.json               manifest_version=3 + "debugger" permission
```

## 1. 起 orchestrator

```bash
pnpm --filter @holaday/orchestrator dev
# 期望日志：
#   HTTP server listening { port: 3001 }
#   WS server listening { port: 3002 }
#   restart recovery: rehydrated in-flight tasks { userCount, taskCount, reemitted: {...} }
```

## 2. 注册 demo 账号

```bash
EMAIL="demo-w2day4@holaday.local"
curl -sS -X POST http://127.0.0.1:3001/trpc/auth.register \
  -H 'content-type: application/json' \
  -d "$(printf '{"email":"%s","password":"hunter22hunter22","displayName":"Demo"}' "$EMAIL")" | jq '.result.data.user'
```

## 3. Chrome 加载扩展

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 **`apps/extension/dist/`**
2. 扩展列表出现 **HOLA DAY**，图标可见
3. 点开 **Service Worker (inspect)**。**首次**应该只看到：
   ```
   [holaday] welcome { type: 'server.welcome', clientId: '...', heartbeatMs: 30000 }
   ```
   还**不会**有 `PlaywrightCrxAdapter ready` —— 它是 lazy load，第一个 dispatch 到来时才 init。

4. 权限提示：第一次 `chrome.debugger.attach` 会弹系统提示"HOLA DAY 正在调试此浏览器"。这就是 W2 Day 4 最显眼的新视觉元素。**不要点"取消"**——取消会让 Playwright-CRX 启动失败回退到 MockDriver。

## 4. popup 登录

点扩展图标 → 输入第 2 步的 email/password → Sign in。

Popup 的"Run"框改一下 intent：

```
打开 eastmoney.com 首页，告诉我页面标题和 URL
```

点 **Run**。

## 5. 期望观测

### 5.1 Orchestrator 终端
- 一条 POST `/trpc/tasks.create` 10-15s（Opus 规划）
- `commander plan` 日志：model=claude-opus-4-7, planSize 3-8, usage 明细
- 若干 `server.task.dispatch` broadcast
- 每一步回一条 `client.step.result`

### 5.2 SW console
```
[holaday] PlaywrightCrxAdapter ready          ← 首次 dispatch 触发的 lazy load
[holaday] step done { taskId, stepId, kind:'goto', status:'ok', elapsed: … }
[holaday] step done { … kind:'extract', status:'ok', elapsed: … }
```

### 5.3 Chrome 顶部
- **"HOLA DAY 正在调试此浏览器"** 黄条横跨顶部。这是 CRX 正在工作。
- 新开一个 tab（或已有 tab 被 attach），标题变成 "东方财富网..."

### 5.4 Popup 卡片
- step 列表 `goto → wait → extract` 颜色依次从蓝变绿（executing→completed）
- 最终 status badge 变绿色 `completed`

### 5.5 DB 核查
```bash
mariadb -uholaday -pholaday-dev holaday -e "
  SELECT external_id, status, created_at FROM tasks ORDER BY id DESC LIMIT 1 \G
  SELECT seq, kind, status, output FROM task_steps
    WHERE task_id = (SELECT MAX(id) FROM tasks) ORDER BY seq \G
  SELECT type, actor, created_at FROM task_events
    WHERE task_id = (SELECT MAX(id) FROM tasks) ORDER BY id;
"
```

`task_steps.output` 应含 `{"url":"...","title":"..."}`（真实页面数据），而非 `{stub:true}`。

## 6. 降级路径：驱动在真 SW 里没启动

如果你**没看到** `PlaywrightCrxAdapter ready`，看到的反而是：

```
[holaday] no CRX runtime, falling back to MockDriver (stub)
```

或：

```
[holaday] failed to load PlaywrightCrxAdapter, using MockDriver
```

说明 lazy import 失败或 chrome.debugger 不可用。排查：

| 现象 | 可能原因 | 处置 |
|---|---|---|
| `chrome.debugger is undefined` | manifest 漏了 `debugger` permission | `dist/manifest.json` 里应该有 `"debugger"`。没有 → 重新 `pnpm --filter @holaday/extension build` |
| `Failed to fetch dynamically imported module` | crx-adapter 文件没生成 / 路径错 | 检查 `dist/assets/crx-adapter-*.js` 存在且 ≥ 2.5 MB |
| `Debugger is already attached` | 另一个 Chrome DevTools 标签已 attach 同一 tab | 关掉其他 DevTools 窗口 |
| `Another debugger is already attached` 横条 | 上一次 PlaywrightCrxAdapter 没 `dispose()` 干净 | 重装扩展（`chrome://extensions` → 移除 → 重新加载 dist/），或关掉浏览器所有 tab |

## 7. Day 5 登录态场景准备

Day 5 要在你已登录的 **抖音商家号** 和 **雪球** 上跑真端到端。需要预先确认：
- [ ] Chrome 里还登录着这两个账号（`compass.jinritemai.com` / `xueqiu.com` 手动打开无重定向到登录页）
- [ ] 扩展的 `host_permissions: ['<all_urls>']` 没被你误缩
- [ ] 本指南第 5 步一切正常跑通——登录态场景只是 `allowedOrigins` 换成 skill 自带的那些 + 登录页检测触发 awaiting_user

Day 5 开始时我会补 `apps/orchestrator/.rehearsal/w2-smoke.mjs`（gitignored）做完整 eastmoney → douyin → xueqiu 的端到端记录。

---

## 验收勾选（对着跑完打勾）

- [ ] `dist/manifest.json` 含 `debugger` permission
- [ ] `dist/assets/crx-adapter-*.js` 存在（> 2.5 MB）
- [ ] 加载到 `chrome://extensions`，SW console 出 welcome 帧
- [ ] 注册 demo 账号 + popup 登录成功
- [ ] 首次 Run 触发 SW console 出 `PlaywrightCrxAdapter ready`
- [ ] Chrome 顶部出 "HOLA DAY 正在调试此浏览器" 黄条
- [ ] eastmoney.com 页面在某个 tab 里被打开
- [ ] popup 卡片 step 全绿 / 任务 completed
- [ ] DB `task_steps.output` 里能读到真 page title
- [ ] **没有** `no CRX runtime, falling back to MockDriver` 日志

---

## 沙箱注记

这一份指南所有步骤需要真 Chrome。W2 Day 4 的开发机（沙箱）没有 Chrome，所以这条路径只能由 founder 在自己机器上跑通才算端到端验收。Day 4 在沙箱能验证的是：

- 31 项 orchestrator 单测 + 6 skill-sdk + 16 browser-driver + 18 orch 集成 = **71 项全绿**
- `pnpm --filter @holaday/extension build` 成功产 dist
- `pnpm -r typecheck` 5 workspace 全部 clean
- `pnpm lint` clean

浏览器端真行为（chrome.debugger 权限 / Playwright-CRX 真 attach / eastmoney DOM 真 extract）**必须** founder 本地跑。
