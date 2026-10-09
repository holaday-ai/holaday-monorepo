# FIX-D10 修复报告

- 基线：`origin/claude/capability-recovery@ac59a3310`。
- 分支：`codex/fix-d10`；独立 worktree：`/Users/yaleiqi/.codex/worktrees/fix-d10`。
- 实现提交：`dee7214203068e09c95a9b5cce5b5e8f0d2b7bf4`。
- 草稿 PR：待创建（目标 `claude/capability-recovery`）。
- 边界：未合并、未部署、未 SSH、未执行迁移或修改生产；未改动其他会话分支。

## D10-1：附件失败恢复与重试

任务创建时将经过所有者校验的附件 ID、文件名和 MIME 写入核心执行输入。失败恢复按同一份规范输入读取附件，兼容旧任务的历史关联；已删除、过期或无法读取的附件显示“附件已失效，请重新上传”。

失败/取消的核心生成任务通过 `retryOfTaskId` 在服务端重新校验任务所有者和来源，恢复原输入和附件，保持 generate 通道，跳过重新分类。页面和侧栏重试入口均读取恢复上下文；读取失败时停止，避免无附件重试。已完成任务的“重新执行”保留原创建流程并携带恢复附件。

## D10-3：只读浏览与代码开发区分

独立代码意图判断要求明确的开发动作与对象；GitHub 域名、只读页面、登录检查、阅读 README/PR 本身不构成代码开发。增加 10 条只读与 10 条开发请求分类用例。

## D10-4：当前设备会话撤销

新登录令牌包含 `sid`，签发前先持久化会话；写入失败不会签发令牌。HTTP、stream token 与持续连接复核保留并校验 sid。`auth.logout` 只撤销当前 sid，同进程立即清缓存，其他进程的正向缓存 TTL 为 **30 秒**，数据库查询耗时达到 TTL 时拒绝沿用结果；其他设备会话不受影响。既有 WebSocket 复核周期为 30 秒，正常调度下叠加缓存上限不超过 60 秒。

旧版无 sid JWT 继续按现有用户状态、authVersion 与 JWT 到期时间校验，不强制全员下线。“退出所有设备”调用 `auth.logoutAll` 原子递增 authVersion，同时撤销新旧令牌。前端在服务端撤销成功后才清除本地凭据，失败允许重试。

新表同步注册账号注销的数据治理归属与清理处理器，沿用户关系执行有界删除。

## 迁移与后续部署顺序

- 新迁移：`apps/orchestrator/drizzle/0067_auth_sessions.sql`。
- 使用幂等 `CREATE TABLE IF NOT EXISTS`；包含自增主键、唯一 sid、用户/有效期索引及用户外键。
- **本轮未对任何数据库执行该迁移。** 后续获批部署顺序：先应用 0067 → 发布后端 → 发布前端。新后端签发 sid 令牌依赖该表，前端退出调用依赖新接口。

## 验证

冻结修改源码后使用 Node 22、单 worker 串行验证；结束后哈希核对确认源码未变。

| 检查 | 结果 |
| --- | --- |
| 后端专项回归 | 10 文件，178 项通过 |
| 后端完整 Vitest | 580 文件，9489 项通过、1 项跳过 |
| 后端原生脚本测试 | 73 项通过 |
| 前端完整 Vitest | 278 文件，2641 项通过 |
| 后端 typecheck / build | 通过 |
| 前端 ESLint / 双 tsconfig typecheck / Vite build | 通过 |
| 修改文件 Biome 基线比较 | 基线 53 项，当前 50 项，新增 0 项 |
| git diff --check | 通过 |

以上是默认全量套件；独立的真实数据库 integration 配置未执行。前端构建保留既有 Tailwind class / chunk 体积提示，不影响构建退出码。

### Eval self-check（尚未完成）

已通过 Node `--env-file` 加载现有本地 eval 配置尝试执行。环境校验失败，自检主体未启动；只保留检查名称与状态，不输出配置值或原始错误内容。

| 名称 | 状态 |
| --- | --- |
| eval.environment.DATABASE_URL | invalid_type |
| eval.environment.REDIS_URL | invalid_type |
| eval.environment.JWT_SECRET | invalid_type |
| self-check | blocked_missing_eval_configuration |

需提供完整的专用 eval env 文件路径后补跑。未使用部署配置替代，也没有修改配置文件。

## 证据边界与上线后验收

本轮回归包含本机 HTTP `auth.me` 登出前后验证，但数据库使用测试替身；它不等同于生产数据库迁移或线上真实会话验收。真实生成任务失败后的附件重试、生产多实例撤销传播、实际数据库重复执行迁移及前后端部署衔接，需在后续获批发布环境验收。
