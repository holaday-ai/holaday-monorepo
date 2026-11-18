# PR #360 独立审查与修复记录

审查范围：`16c50c8c..48d43736`。用户授权安排审查后，由一个无实施上下文的独立 AI 审查席只读检查；主执行与审查串行。原始报告对该旧版本建议 **request changes**，见[独立审查报告](2026-11-18-pr360-independent-review.md)。没有冒充人工审阅或提交 GitHub Approve。

修复源码锚点：`ebded6e2b743b77e74783bbb4d196af9c7564f3d`。工作树仍为 `codex/browser-assistant-v1`，PR 仍为草稿；没有合并、部署或生产写入。

## 六项处理

| 编号 | 审查问题 | 修复与复核 |
| --- | --- | --- |
| R1 / P1 | 同 bearer 重连使旧操作恢复执行权 | transport 与实际 bridge 共用服务端确认的 user/client 加本地 socket generation；关闭/错误同步失效。自然断线、同令牌重连、welcome 未到时挂起的 bound action，旧版本实际副作用计数为 1，修复后为 0。 |
| R2 / P1 | 截图读取未授权子 frame | 与目标观察共用 exact-origin / 继承 origin 规则，全部 frame 在读取前检查；有未授权 frame 即拒绝整张截图。实际跨域 iframe 不被读取、不返回图片；合法同源/继承页面和遮罩仍通过。 |
| R3 / P1 | 取消期间仍发布截图/生成文件 | 新产物先暂存，再在 owner-first 和 task 行锁下核对 active owner、executing task 与宿主同步 canPublish；事务中再次核对。明确拒绝清理暂存，未知提交保留唯一副本并停止重试。覆盖已持久取消、本地已取消但 SQL 仍 executing、账号关闭/归属变化、未知回执。 |
| R4 / P2 | 原始下载冒充新生成文件 | 两端共用来源感知的完成门禁；原始 CSV 不能满足新生成 CSV 的要求。实际原生下载 raw-only 旧版本错误完成，修复后如实未完成，导出点击仍只有 1 次。 |
| R5 / P2 | 同格式多份输出被折叠 | 保留支持格式/文件类别前明确写出的中英文数量，按不同 fileId 核验，生成要求另限生成回执。中英文“两个/2/two CSV”一份拒绝、两份通过；保留具名输出和否定生成的行为。不是自由语言数量理解的全覆盖声明。 |
| R6 / P2 | 普通任务下载挤掉 Home 历史 | 在 SQL 中先筛 owner、output 和 personal_home 来源，再排序取 50 条。真实隔离 SQL 中 65 条后续任务下载不再挤掉 Home 文件；非 Home、临时文件和其他用户不会进入结果。 |

额外收紧同一 R3 路径：Chrome 的 create_file 回调返回存储错误时终止，不再给模型一次未知写入的重试机会。

## 本轮验证

- Node `22.23.3`；测试堆 1536 MB、类型/构建 2048 MB，fork 单进程和文件串行。
- 后端受影响 11 个测试文件 **243/243**；插件连接/bridge/session/transport **96/96**；驱动包 **85/85**。
- 原生下载完成门禁 5 项通过；实际跨域截图拒绝和合法原生插件截图通过。后者校验实际 JPEG、敏感镜像遮罩、文件归属及普通标签页焦点/输入。
- 真实 SQL、最终候选构建和离线门禁：3 项真实 SQL/原生截图通过（SQL 同时覆盖持久取消、本地先取消及 65 条历史）；正式模式插件与后端生产构建通过；路由 74/74、拦截 24/24，通过脚本无外部模型调用。。
- 受影响测试源码的限定 tsc、插件和驱动类型检查通过。Biome 改动范围无错误；原有 3 个 warning 为 agent-loop 的两处 any 和 tasks 的未使用 catch 参数，未在本轮引入。
- 全项目含全部测试的后端 tsc 达到 2 GB 堆限额，已停止且未扩大资源；限定测试 tsc 与生产构建配置分开验证，不把前者 OOM 记为通过。最初在沙箱内运行两个云端 suite 时 Chromium 启动受 macOS MachPort 权限拒绝；改为经批准的本机串行运行后通过。
- 旧代码的失败记录保留于 `R1-red.log`、`R2-red.log`、`R3-red.log`、`R3-local-cancel-red.log`、`R4-red.log`、`R5-and-R3retry-red.log`、`R6-red.log`；汇总和完整日志：`/Users/yaleiqi/.holaday-recovery/tasks/browser-assistant-next/pr360-review-ebded6e2` 和 [机器可读摘要](evidence/pr360-review-20261118.json)。
- 本轮没有外部模型 API 调用、真实账号登录、业务行测试或生产迁移；截图、下载与 SQL 都使用合成 fixture。独立审查是分组静态检查，未逐行覆盖 266 个文件，详见原报告限制。

## 发布边界

此前 `91825516` 的候选包保留为旧证据；本轮刷新候选为 `/Users/yaleiqi/.holaday-recovery/tasks/browser-assistant-next/pr360-review-ebded6e2/candidate.json`，插件 zip 的 SHA256 为 `b9dba8567127409065c00c39b0209a317d80a90fcd82f580e8d383a62f32482e`。后端产物是与匹配 monorepo 依赖/锁文件配套的内部构建，不是独立安装包。工作台源码与 91825516 相同，本轮没有重建工作台。

生产 `0071 task_files.browser_source`、真实登录状态加密的 KMS/KeyProvider、可信站点主体适配器与启动接线、真实账号/物理 OS/安装渠道验收及正式全量仍沿用既有待办。密钥指登录状态的加密保护，不是模型 API Key；用户目前无需在聊天里提供或申请密钥。现有 CloudKmsKeyProvider 仍为供应商无关接口，尚不能据此宣称生产服务已接好。

合并、正式全量检查和发布仍由用户另行决定；本报告没有替代这些决定。
