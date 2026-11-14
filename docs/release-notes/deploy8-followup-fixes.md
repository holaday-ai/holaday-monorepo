# Deploy-8 后续修复

本分支仅供草稿 PR 审查，不合并、不部署；生产仍运行 Deploy-8。

## 依赖闭包

Deploy-8 的真实启动失败来自 `docxtemplater/js/inspect-module.js` 内的 CommonJS
`require('lodash')`。该 upstream inspection 模块未把 lodash 带入所需依赖闭包，
orchestrator 又未显式声明，之前靠其他工作区包的提升依赖或旧发布目录链接才能加载。
在实际使用 inspection 模块的 `apps/orchestrator/package.json` 声明 lodash 4.18.1，
沿用已有锁定版本，不升级现有包。

用 TypeScript AST 扫描 7 个工作区包的 src/scripts，覆盖静态 import/export、字面量
require/dynamic import，排除 Node 内置、相对路径、前端 `@/` 别名与测试；区分 type-only。
发现另两处运行依赖放在 devDependencies，保持版本并归位：

- orchestrator 的 TypeScript 5.7.3：`src/data-governance/audit.ts` 在运行时调用编译器 API。
- browser-driver 的 playwright-crx 0.15.0：公开 `./crx` 入口在扩展 service worker 中 import。

修复后扫描未发现其他未声明的字面量包 import 或运行时 import 只在 devDependencies。
此扫描不覆盖变量构造的模块名或任意 upstream 内部隐式依赖；干净安装后的完整应用导入与
实际启动补充验证主要后端运行路径。

安装验证从无 node_modules、无 .env 的普通源码副本开始（没有新建 Git worktree），运行：

```sh
pnpm --filter @holaday/orchestrator... install --frozen-lockfile \
  --network-concurrency=1 --child-concurrency=1
pnpm --filter @holaday/orchestrator build
```

lockfile 安装前后摘要一致，node_modules 链接均在该副本内；docxtemplater 对 lodash 的解析
也位于该副本，未链接旧工作区或旧发布目录。隔离本地 MySQL/Redis 上的完整应用实际启动
20 秒，HTTP healthz=200、WS 端口就绪，随后正常退出、端口关闭。没有连接生产或调用模型。
当前生产临时链接必须等此 PR 审查并另行获准部署之后才能移除，本分支不删除它。

## files.list

之前 list 对所有记录调用 storage.stat，默认以 3 路遍历整页 R2 HEAD；接口返回前等待这些
检查。Deploy-8 两站各 20 次实测 P95 为 4370.399/2955.297ms。

列表现在以数据库元数据为主：

- 当前非绝对对象键不做 HEAD，字节状态返回 `unknown`，不把元数据存在说成字节存在。
- 仅绝对旧路径做兼容检查；每个共享 provider 同时最多 5 个检查，整次列表检查预算 500ms。
- 证据缓存 60 秒、最多 1000 项，以 provider + 数据库所有者 + 路径隔离；相同未完成检查合并。
- 超时或存储/权限错误为 `unknown`，不写成缺失证据；忽略取消的请求继续占用并发名额，
  后续列表不会继续扩张后台请求。并发满时不排无界队列。
- 已确认缺失的旧文件仍为 `unavailable`。分页保留原数据库游标，响应不暴露存储路径。

下载 `loadForUser` 继续真实 GET；预览 `getScopedPreviewForUser` 继续即时存在性、所有权、
状态与到期检查，不使用列表证据作为放行条件。缺失返回 404/不可预览时，现有前端 registry
继续显示“文件已不可用”、移除下载入口，相关前端展示代码没有改动。

冷缓存的旧路径如果在 500ms 内无法核验，会先返回 unknown；不能保证这时立即知道所有
缺失文件。已确认缺失标签与下载/预览后的不可用展示保留，未新增业务状态字段或改写历史记录。

## 验证边界

RED 测试复现：当前键逐个 HEAD、重复旧路径查询、存储永不返回时列表无法完成。
新增测试覆盖零 HEAD 的 50 条列表、缺失标签与分页、缓存到期与所有者隔离、权限错误、
跨列表并发上限，以及缓存曾可用但实际文件已删除时下载/预览仍拒绝。

本地 HTTP 耗时采样使用真实隔离 MySQL、50 条每页、各 20 次串行请求；R2 延迟由 200ms
可控 fixture 模拟，含冷缓存和缓存命中。目标是本地 P95 <1 秒；不是线上延迟结论。
结果：后端 Node 脚本 73/73；Vitest 558 文件、9107 通过、1 既有跳过；typecheck 通过。
browser-driver 55 项及 typecheck 通过，最终文件回归 28 项通过。触及文件 Biome 退出0，
有1条原有 fake logger 的 explicit-any 警告，git diff --check 通过。

| 本地 HTTP 场景 | 样本 | P50 ms | P95 ms | storage.stat 次数 |
|---|---:|---:|---:|---:|
| 当前对象键 | 20 | 6.326 | 9.349 | 0 |
| 旧路径（含冷缓存） | 20 | 9.373 | 509.700 | 70 |

峰值存储并发5；三条模拟缺失记录保持不可用。生产 P95 必须在另行批准发布后重新采样。
首次1536MB typecheck因堆上限OOM，2048MB重试通过。干净源码副本全量测试在216.2秒
静默等待时被中止，不算通过；完整全量回执来自已有 Git 工作树（778.7秒）。
最终格式化/不变量注释不改变生产 AST 或 import 绑定，最后的目标回归再次通过。

启动测试库由当前schema生成94表；测试DDL导出中的状态占位符按源码枚举填充，
超长外键名称缩至MySQL64字符限制。只处理本地QA夹具，没有更改仓库/生产schema。

10/9 北京时间 09:40 已安排一次只读股市复查，结果将追加本机 deploy-report.md，
不触发本分支合并或部署，也不恢复其他暂停自动化。未来结果尚未发生，不能记为已通过。

## PR #246 复审补充：迁移0066 / 视频重试与拒绝帧

部署前必须先在目标数据库运行 `0066_model_price_catalog.sql`，再启用新版费用记录；本 PR 未运行任何生产迁移或发布。迁移只有未来价格配置种子 INSERT，主键冲突时不覆盖已有设置，重复执行保持原配置，真实 MySQL 测试覆盖二次运行及操作员设置。历史调用/任务记录不回填。

回滚：先关闭新版消费者并回退应用；0066种子可留存，旧代码不依赖它。若需撤回种子，先在发布前记录该单一设置是否存在及其版本，再仅当本次新增且当前内容仍等于本次种子时删除该行；已有/后来修改的操作员配置不得删除或覆盖。无建表/删除表回滚，无历史费用重算。

`VIDEO_REJECT_RETRY_LIMIT` 是同用户、同制作请求的连续终态质量拒绝上限，BOSS已确认默认3；提交前明示“质量不合格会自动退款，最多可重试 3 次”，第三次拒绝即时提示修改素材或描述；确认事务达到上限即提示修改素材或描述，未消费报价、未扣费、未调用供应商。成功交付重置连续计数；普通非质量失败也结束该连续序列。按输入和制作选项的服务端指纹隔离，不依赖前端按钮或内存。只记录新生成任务的指纹，不改历史任务。

`VIDEO_REJECT_FRAME_RETENTION_DAYS` 默认7；每小时清理完整拒绝manifest指向的私有临时帧，未完成manifest、符号链接、未知文件/已交付产物目录均不删。工作目录的即时清理照旧，未来拒绝证据仅保存在专用私有审查根目录；数量压力不提前删除未到期审查证据。
