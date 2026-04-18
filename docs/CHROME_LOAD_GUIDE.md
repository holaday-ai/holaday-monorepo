# 真 Chrome 加载扩展指南（Phase 0 / Day 3）

这是 Phase 0 的临时人工验收路径。等 W2 接入 Playwright-CRX 之后会自动化。

> **目标**：扩展能在你本机的 Chrome 里加载，对着本机 orchestrator 完成 PoC A1（拿到 `server.welcome`）。

---

## 0. 准备

- Chrome ≥ 120（`chrome://version` 确认）
- 本机 Node 20+ / pnpm 10+
- `.env.local` 已写入（含 `ANTHROPIC_API_KEY` / `JWT_SECRET` / `DATABASE_URL` 等；见 `.env.example`）
- MySQL + Redis 起着：
  ```bash
  docker compose up -d mysql redis
  # 或本机：mariadbd / redis-server
  ```

---

## 1. 起后端 + 扩展构建

仓库根目录：

```bash
pnpm install
pnpm dev          # 同时跑 apps/orchestrator (HTTP 3001 / WS 3002) + apps/extension (vite watch -> dist/)
```

期望日志：

```
@holaday/orchestrator:dev:  HTTP server listening { port: 3001 }
@holaday/orchestrator:dev:  WS server listening { port: 3002 }
@holaday/extension:dev:    built in 9XXms
```

如果你只想跑后端（不带 extension watch）：

```bash
pnpm --filter @holaday/orchestrator dev
```

`apps/extension/dist/` 会持续刷新；改 popup 代码后 vite 会增量重写产物。

---

## 2. 注册账号（拿一个能登录的用户）

```bash
curl -sS -X POST http://127.0.0.1:3001/trpc/auth.register \
  -H 'content-type: application/json' \
  -d '{"email":"founder@example.com","password":"hunter22hunter22","displayName":"Founder"}' \
  | jq
```

记下 `result.data.user.email` 和你刚才填的密码（用于扩展 popup 登录）。

如果数据库还没建表：

```bash
pnpm --filter @holaday/orchestrator db:push
```

如果想注册 Phase 0 内置 Skill：

```bash
pnpm --filter @holaday/orchestrator sync-skills
# inserted=1 updated=0 total=1
#   taobao-qianniu-inbox@0.1.0  千牛客服汇总
```

---

## 3. 在 Chrome 里加载扩展

1. 打开 `chrome://extensions`
2. 右上角打开 **开发者模式 / Developer mode**
3. 左上角 **加载已解压的扩展程序 / Load unpacked**
4. 选目录：**`apps/extension/dist/`**（不是 `apps/extension/` 本身）

加载成功后扩展列表里出现 "HOLA DAY"，旁边有它的 ID（一长串字母数字，记住 → Phase 0 后续可用）。

> 如果 `dist/` 还不存在 / 是空的：`pnpm --filter @holaday/extension build` 单独跑一次。

---

## 4. 登录 + 验证 PoC A1

1. Chrome 工具栏点 HOLA DAY 图标，打开 popup
2. 输入第 2 步注册的 email + 密码 → Sign in
3. popup 切到登录后的卡片，"last welcome: HH:MM:SS" 字段开始更新

去看 service worker 控制台：

`chrome://extensions` → HOLA DAY → **Service Worker (inspect)** → Console。

期望日志：

```
[holaday] welcome { type: 'server.welcome', clientId: '...', heartbeatMs: 30000 }
```

后端 `pnpm dev` 终端期望同步看到：

```
{"level":30,"msg":"ws client closed"}    # 之前断的
ws server listening                       # 新连接到达
```

如果日志里出现 `auth timeout` 或 `bad token` → JWT 不对，多半是后端 `JWT_SECRET` 在签发后被改过。重启后端 + 重新登录即可。

---

## 5. 拆箱测试 commander（可选，需 ANTHROPIC_API_KEY）

```bash
TOKEN=$(curl -sS -X POST http://127.0.0.1:3001/trpc/auth.login \
  -H 'content-type: application/json' \
  -d '{"email":"founder@example.com","password":"hunter22hunter22"}' \
  | jq -r '.result.data.accessToken')

curl -sS -X POST http://127.0.0.1:3001/trpc/tasks.create \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"intent":"汇总过去 24 小时千牛里我没回复的买家消息"}' \
  | jq
```

期望返回：

```json
{
  "result": {
    "data": {
      "taskId": "tsk_…",
      "status": "executing",
      "steps": [ {"id":"stp_…","kind":"goto","risk":"low",…}, … ]
    }
  }
}
```

DB 校验：

```bash
mariadb -uholaday -pholaday-dev holaday -e "
  SELECT external_id, status, intent, created_at FROM tasks ORDER BY id DESC LIMIT 3;
  SELECT t.external_id, ts.seq, ts.kind, ts.status FROM task_steps ts
    JOIN tasks t ON t.id = ts.task_id WHERE t.external_id = 'tsk_…';
  SELECT type, created_at FROM task_events WHERE task_id = (SELECT id FROM tasks WHERE external_id='tsk_…');
"
```

如果没有 `ANTHROPIC_API_KEY`，orchestrator 会启用 `StubPlanner`，返回固定的两步计划——也能验证整条链路通。

---

## 6. 常见坑

| 现象 | 原因 / 处置 |
|---|---|
| `chrome://extensions` 加载报 `Manifest is not valid JSON` | `apps/extension/dist/manifest.json` 没生成 → `pnpm --filter @holaday/extension build` |
| popup 登录报 `fetch failed` | orchestrator 不在 3001 / CORS（Phase 0 同源没问题，跨机要起 nginx） |
| SW console 反复看到 `Auth timeout`，后端 4401 | JWT 不一致：换 secret 后没重登录 |
| WS 反复重连 | 后端只起了 HTTP，没起 WS：`pnpm --filter @holaday/orchestrator dev` |
| Chrome 加载扩展崩了 | 关闭其他正在调试的 MV3 扩展，或换一个新 Chrome 用户配置 |

---

## 7. 验收勾选

- [ ] Chrome 已加载 `apps/extension/dist/`，扩展显示 "HOLA DAY"
- [ ] popup 完成邮箱密码登录
- [ ] SW 控制台看到 `[holaday] welcome` 一次以上
- [ ] orchestrator 终端看到该客户端连接日志
- [ ] （可选）`tasks.create` 返回 `{taskId, steps}`
- [ ] （可选）`tasks` / `task_steps` / `task_events` 三表都各多了一条
