# 首次切换：合成 MySQL 恢复与全迁移核验

测试：`apps/orchestrator/src/execution/ordinary-first-cutover.mysql.integration.test.ts`。

这是合成数据测试，不是生产备份、加密或停写证明。默认测试配置排除 integration 文件；必须显式使用 `vitest.integration.config.ts`，不能把 skip 当通过。

## 密文传输接入（2026-09-27）

安全样本现在将加密源文件与恢复端文件分置于两个私密目录，私钥只在恢复端；使用正式 `pullFirstCutoverAgeBackup` 和原样运行的真实Node读取子进程接收密文，核对摘要、字节数及进程退出状态，随后真实age认证解密、MySQL导入和全61SQL/全对象与历史业务列比较。SSH网络层替换为本地子进程，不替换文件/加解密/比较器/journal/迁移为固定成功。实际2/2通过，日志 `/tmp/holaday-backup-transfer-mysql.log`；这不是生产SSH运输、实际生产备份或完整首次切换验收。旧危险0042反例仍保留。

## 完整比较器接入（2026-09-27）

安全样本现在调用正式 `browser-first-cutover-mysql.mjs`，不是只在夹具里计算摘要。覆盖FUNCTION、PROCEDURE、EVENT、TRIGGER、VIEW和全部基础表；恢复前后完整比较，迁移后按原始列投影核对所有历史数据，源库再次完整读取确认不变。mysql2启用大整数、JSON及日期的无损字符串读取；QA原独立inventory与金额/状态断言仍保留作交叉检查。

19项单测先因缺模块失败再通过；另加行序/二进制与SQL字面量验证，总计21通过。真实MySQL首次发现身份查询将保留字database用作未引用别名而报1064；通过只记录SQL边界的临时诊断定位，引用别名后2/2通过（`/tmp/holaday-mysql-adapter-real2.log`），临时诊断已移除。测试fixture自己的条件表达式优先级错误也已修正，没有为测试放宽正式比较条件。整个61SQL、结算规则及生产数据未改。

## 最新组合验证：真实age文件链路（2026-09-27）

安全样本现使用`scripts/browser-backup-age.mjs`（由既有backup模块导出）的实际文件/子进程适配：真实mysqldump流 → age公钥加密 → 私密密文文件 → 摘要复核 → age解密至私密partial → 完整认证与复核后发布verified SQL → 启动隔离mysql导入 → 全对象/数据比较 → 全61SQL和业务字段核验 → 原文件journal回执。原合成AES-GCM夹具已替换，不是另加一套加密格式；本例密钥仍为临时QA密钥，不接触用户Mac私钥或生产数据。

新鲜MySQL2/2通过（`/tmp/holaday-age-mysql.log`），危险0042样本仍保持迁移入口拒绝、全快照不变和原SQL风险的验证。新适配16/16实际文件/age用例通过，包含导出末尾失败、错误hash/公钥/工具、权限及链接异常、禁止覆盖/重试、错误私钥及认证尾部损坏。大于单个age块的输入用于证明：即使前缀能解密，损坏尾部也不能发布可导入的verified文件。失败保留私密partial，不自动清理/恢复/重试。

Mac实际age1.3.1；无网络Linux Node22+age1.2.1容器中，age/backup/journal66/66通过（`/tmp/holaday-age-linux-final.log`）。这是本地组件与合成数据库验证，不是两台生产主机完整停写/运输/身份/业务比对证明。完整host、Mac隔离目标接线、离线密钥副本及真实生产停写备份仍待完成。

`CUTOVER_TEST_AGE_EXECUTABLE`必须显式指向已安装的age。缺少它时，Node文件用例的实际加密测试会标记skip，**不能计入验收**；显式MySQL集成会拒绝。生产代码不使用此测试环境变量，不自动生成密钥，也没有默认成功设施。

```bash
CUTOVER_TEST_AGE_EXECUTABLE=/opt/homebrew/bin/age node --test scripts/browser-first-cutover-age.test.mjs
docker build -f scripts/fixtures/backup-age-qa.Dockerfile -t holaday-first-cutover-age:qa scripts/fixtures
docker run --rm --network none \
  --mount type=bind,source=/绝对路径/holaday-monorepo/scripts,target=/source,readonly \
  -e CUTOVER_TEST_AGE_EXECUTABLE=/usr/bin/age holaday-first-cutover-age:qa \
  /opt/node22/bin/node --test /source/browser-first-cutover-age.test.mjs \
  /source/browser-first-cutover-backup.test.mjs /source/browser-maintenance-journal.test.mjs
```

镜像构建时需要包仓库网络；实际Linux测试无网络、源码只读、无生产挂载。当前QA镜像基于已有`holaday-first-cutover-task3:qa`，不把该依赖当独立可从零构建的发布镜像。

## 上轮组合验证：备份编排与实际发布记录（2026-09-27）

安全样本现在直接调用`scripts/browser-first-cutover-backup.mjs`的`backupAndRestoreCheck`，并使用真实`acquireReleaseJournal`记录结果。链路为：检查本例无其他数据库会话 → 实际mysqldump → 合成AES-256-GCM加密文件（0600，一次性内存密钥）→ 校验密文摘要 → 实际解密/恢复 → 完整对象/数据比对 → 全61SQL → schema及关键业务字段复核 → 源库/密文再次核对 → 原子持久化回执。真实MySQL2/2通过，日志`/tmp/holaday-backup-coordinator-mysql.log`；风险样本仍独立验证入口拒绝及原0042时间漂移。

首次发布记录的`backup_verified`阶段是动作前意图，不是通过证明。现在只有`bindBackupReceipt`成功将本attempt/候选/配置/迁移/清单及备份、源库、恢复目标、加密设施、比对、schema/业务摘要绑定写盘后，才允许进入`migration_started`。写盘失败、旧/异源回执、额外成功布尔或重复绑定均拒绝；普通发布逻辑不变。测试临时记录并不用于生产。

**仍缺生产适配。** 该编排没有默认成功I/O、生产CLI或自动生成生产密钥。受信host必须提供真实停写/身份核验、已批准加密设施、私密备份路径、全对象/数据比较、仅向新建且独占的隔离目标恢复和实际schema校验。`encryptionProfileDigest`来自该设施的实采/批准绑定，单独手填摘要不证明加密或隔离。不得把QA临时密钥方案当生产备份保管策略。恢复端必须校验身份并且不导入source，不自动删库/覆盖旧备份。

本模块的命名I/O接口见源码；所有异步步骤之间复核窗口、锁、源/目标身份、设施和备份不变。比较器必须在任何缺表/视图/触发器/事件/过程、列或行内容差异时抛错，并返回实测摘要；迁移后再次比较关键业务字段，不能返回手填`restored:true`。失败保留阶段和产物，不重试、不自动回滚/清理。模拟I/O单测只验证这一调用契约；MySQL组合测试验证上述本例实际链路，不证明生产全主机停写或全部业务兼容。

## 上轮结果：迁移入口拒绝风险数据（2026-09-27）

编号迁移 runner 现在在第一条写入 SQL 前、以及执行0042前重新只读检查：已完成支付缺失完成时间时，以`MIGRATION_PAYMENT_TIME_UNPROVEN`拒绝；旧表没有completed_at且存在已完成支付、schema不明或查询失败也拒绝。新库、只有未付款记录的旧表和完成时间已完整的记录可继续。检查直接放在既有摘要绑定的runner里，普通/首次发布均使用它；不新增绕过开关。全部61个SQL未改，未更改订单/结算逻辑。

最新真实MySQL结果 **2通过、退出0**：安全样本恢复后跑完全部SQL；风险样本被入口拒绝且所有表/对象/业务值与恢复前快照一致，缺列旧表同样拒绝。随后仅在一次性恢复库直接执行未改的0042，仍观察到历史updated_at改变——这是保留的风险事实，**不是危险数据已能安全迁移**。旧的无条件迁移断言改为有依据的“拒绝且无写入”契约，没有使用expected-failure或跳过。

日志`/tmp/holaday-payment-migration-guard-{red,green,final}.log`。RED证明旧入口未拒绝；第一次GREEN尝试在旧表夹具中遗留复合索引而失败，修正仅针对合成表后最终通过。入口8项故障/分支测试也由7失败1通过变为8通过。新容器`holaday-first-cutover-qa-37a59c82de641bf0`及其专用网络、随机数据库均已清理，既有3306数据库与Redis未动。

这个检查不建立写入隔离、不构成生产加密备份/恢复凭据，也不能免除正式停写后的新鲜核对。完整首次host/备份适配及整流程演练仍未完成；旧表命中风险时需要单独审查迁移策略，不自动修改历史数据。

## 历史结果：未加入口检查时（2026-09-27）

真实 MySQL 8.0，真实 `mysqldump/mysql`，复制的原始 migration runner，全部 61 个编号 SQL：

- 当前已观察支付数据形态：通过。完成订单的完成时间已存在，pending 的完成时间为 NULL。恢复前后表/列定义、全表数据、视图、触发器、事件、存储过程一致；迁移后任务状态、已知金额、未知费用 NULL、支付金额/状态/历史时间保持，维护 schema 校验通过，源库未被迁移改动。
- 反例：失败并保留 RED。已完成订单的 `completed_at=NULL` 时，0042 回填该列也触发 `updated_at` 的 `ON UPDATE CURRENT_TIMESTAMP(3)`，历史更新时间变成执行时刻。没有改断言、使用 `it.fails` 或修改 SQL 来隐藏这一事实。

最终显式测试为 **1通过、1失败，退出1**，日志 `/tmp/holaday-first-restore-final.log`。它不是全迁移无条件安全的证明。恢复对象比较只规范化了重复的 utf8mb4 字符集声明和触发器对象的重建时间；真实字符集/排序规则、定义、sql_mode 和业务时间仍核验。

线上只读事务在 `2026-09-27T02:27:51.322Z` 观察到 completed=2，缺失 completed_at=0；pending=13，缺失 completed_at=13。当前快照未命中反例，但不代表停写后仍为零，也不证明支付方状态。正式备份/迁移适配器仍须接入这一条件，遇到缺失值拒绝切换，或取得单独审查的迁移策略；本轮没有实现该适配器。

## 复现环境

只使用新建专用 MySQL 容器，不得把以下标签加到已有数据库。容器不得有生产挂载、配置或凭据。名字后缀是本例唯一随机 16 位 hex；下面的例子使用 `9fe641c18a7d3502`，原容器和网络已清理。

```bash
docker network create --label holaday.qa=first-cutover-mysql holaday-cutover-mysql-9fe641c18a7d3502
docker run --rm -d --name holaday-first-cutover-qa-9fe641c18a7d3502 \
  --label holaday.qa=first-cutover-mysql \
  --network holaday-cutover-mysql-9fe641c18a7d3502 \
  -p 127.0.0.1:13316:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes \
  mysql:8.0 --event-scheduler=OFF
docker exec holaday-first-cutover-qa-9fe641c18a7d3502 mysqladmin -uroot ping
```

确认 ping 成功后，在仓库根目录使用工作区 Node/pnpm：

```bash
CORE_MYSQL_INTEGRATION=1 \
CUTOVER_TEST_AGE_EXECUTABLE=/opt/homebrew/bin/age \
CORE_MYSQL_TEST_ADMIN_URL=mysql://root@127.0.0.1:13316/ \
CORE_MYSQL_TEST_CONTAINER=holaday-first-cutover-qa-9fe641c18a7d3502 \
pnpm --filter @holaday/orchestrator exec vitest run \
  --config vitest.integration.config.ts \
  src/execution/ordinary-first-cutover.mysql.integration.test.ts
```

测试先检查 loopback/13316/专用标签/无额外挂载，创建随机 source/restore 两库。runner 只在不含 `.env*` 的临时源码快照执行，子进程环境不继承生产配置。安全样本的备份以临时密文文件传递，风险样本仍在内存中传递；均为合成业务数据，没有生产加密备份声明。finally 复核 server_uuid，只清理本例成功创建的库及 mkdtemp源码/合成密文/测试记录。触发器/事件/存储过程只用于对象完整性检查，事件调度禁用。

无论成功失败，都应确认该测试进程退出，然后移除本例容器（自动删除其匿名卷）和网络；不要删除或停止既有 `holaday-mysql`。

```bash
docker stop holaday-first-cutover-qa-9fe641c18a7d3502
docker network rm holaday-cutover-mysql-9fe641c18a7d3502
```

本次先尝试 Docker `--internal` 网络，未实际发布端口，测试在连接前失败；改成只发布 loopback 的专用桥接网络后才取得业务断言证据。此环境问题不是产品 RED。完整生产加密备份/恢复、全主机停写证明、双主机部署仍未完成。
