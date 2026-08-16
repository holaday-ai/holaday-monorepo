# 今日能量隐私最小化分析发布手册

本手册用于发布“今日能量”聚合分析。该能力不保存原始事件、内部用户 ID、测试答案、塔罗问题、星座 Provider 正文或其他自由文本，也不增加任何用户可见的反馈控件。

## 发布前边界

- 只允许在明确的 QA 数据库验证迁移，禁止把当前生产数据库 URL 代入本地命令。
- `ENERGY_ANALYTICS_HMAC_SECRET` 必须是该功能专用的高熵密钥，不得复用 JWT、OpenAI、DivineAPI、支付或其他业务密钥。
- 密钥值和管理员令牌不得粘贴到日志、工单、聊天、截图、PR 或仓库文件。
- 管理员查询必须使用已部署的 `https://` 来源；不得对明文 HTTP 站点发送令牌。
- 清理任务不受写入开关控制。关闭新写入后，过期数据仍按既定上限清理。

## 发布顺序

严格按以下顺序执行；任一步失败都停止继续发布。

1. 在专用 QA 数据库应用 `apps/orchestrator/drizzle/0046_energy_analytics.sql`，随后运行 `db:verify`。确认三张新增表、唯一键和到期索引全部存在，且没有破坏性 DDL/DML。
2. 保持 `ENERGY_ANALYTICS_ENABLED=false`，在部署平台生成并保存专用高熵 HMAC 密钥；仅确认密钥已设置且长度合规，不读取或输出其值。
3. 先部署 Orchestrator，确认健康检查、旧客户端无 `eventId` 兼容路径以及后台清理启动正常；再部署 SPA。
4. 在开关仍关闭时验证：公开预览不发送 `energy.reportEvent`；登录页正常加载；人为让分析请求返回 500 时，选择方向、开始、重玩和完成仍可正常使用；页面不存在“有帮助/没帮助”控件。
5. 完成前四步后，才把生产 `ENERGY_ANALYTICS_ENABLED` 切换为 `true` 并按平台要求重启或发布 Orchestrator。
6. 用测试账号完成一次登录首页访问、一次首次开始、一次重玩和一次完成。每个动作只执行一次，记录动作时间而不记录事件 ID 或请求正文。
7. 用活跃管理员账号查询 `energy.metrics({ window: 7 })`。只核对首页访问、玩法开始、重玩、完成及匿名 DAU 等预期聚合增量，不查询逐行收据或匿名访客摘要。
8. 通过错误率、表行数增长和清理计数观察运行状态；禁止读取或导出 `visitor_hash`，禁止按 Staff 或个人做比较。
9. 如需回滚，把 `ENERGY_ANALYTICS_ENABLED=false` 并重启或发布 Orchestrator。确认新事件不再增加聚合数；保留三张表和每日清理，不删除表、不清空历史数据。

## QA 迁移验证

下列地址只能指向显式创建的本机回环 QA 数据库：

```bash
DATABASE_URL='mysql://holaday:holaday-dev@127.0.0.1:3306/holaday_energy_qa' \
  pnpm --filter @holaday/orchestrator db:migrate:numbered
DATABASE_URL='mysql://holaday:holaday-dev@127.0.0.1:3306/holaday_energy_qa' \
  pnpm --filter @holaday/orchestrator db:verify
```

本机 QA 数据库不可用时，把迁移与 schema 验证标记为发布阻断项；未经额外授权不得改用任何远程数据库。

## 安全的管理员聚合查询

先确认输入的是已部署的 `https://` 来源。令牌在终端中静默读取，并在请求后立即清除：

```bash
read -r -p 'Holaday application origin (https://...): ' HOLADAY_APP_ORIGIN
case "$HOLADAY_APP_ORIGIN" in
  https://*) ;;
  *) echo 'Refusing non-HTTPS origin' >&2; unset HOLADAY_APP_ORIGIN; exit 1 ;;
esac
read -s HOLADAY_ADMIN_TOKEN
curl --fail-with-body \
  --header "Authorization: Bearer ${HOLADAY_ADMIN_TOKEN}" \
  "${HOLADAY_APP_ORIGIN%/}/api/trpc/energy.metrics?input=%7B%22window%22%3A7%7D"
unset HOLADAY_ADMIN_TOKEN HOLADAY_APP_ORIGIN
```

响应只能包含窗口、日期、每日聚合、固定玩法聚合和总体比率，不应出现 `visitorHash`、`eventId`、`userId`、原始事件正文或逐行详情。普通成员调用必须返回 `FORBIDDEN`，未登录调用必须返回 `UNAUTHORIZED`。

## 开启路径验收

在专用 QA 环境使用专用 QA HMAC 密钥，并把写入开关临时设为 `true`：

1. 发送一次首页、首次开始、重玩和完成事件，每个请求使用不同 UUID。
2. 用相同 UUID 分别重试，确认收据仍为一条且指标不重复增加。
3. 确认首页事件只为该 UTC 日期增加一条匿名访客记录；记录中没有内部用户 ID。
4. 确认三张表均不包含事件负载、自由文本或 Provider 正文。
5. 以管理员查询 7 天聚合，只出现对应首页、开始、重玩和完成增量。
6. 以普通成员查询并确认返回 `FORBIDDEN`。
7. 把开关恢复为 `false`，确认新事件不再增加指标，同时手动调用一次有界清理并确认仍可运行。

## 观察与回滚判据

出现以下任一情况立即关闭写入开关：

- 用户玩法因分析请求失败而无法继续；
- 日聚合、幂等收据或匿名访客出现明显重复增长；
- 管理员响应出现 ID、摘要或逐行明细；
- 清理单次越过每批 500、每表最多 5 轮的边界；
- HMAC 密钥缺失、长度不合规或疑似泄露。

回滚仅关闭写入开关，不回滚页面功能、不删除表。问题修复后重新执行 QA 迁移验证、关闭路径验收和开启路径验收，方可再次开启。
