# 首次切换：合成 MySQL 恢复与全迁移核验

测试：`apps/orchestrator/src/execution/ordinary-first-cutover.mysql.integration.test.ts`。

这是合成数据测试，不是生产备份、加密或停写证明。默认测试配置排除 integration 文件；必须显式使用 `vitest.integration.config.ts`，不能把 skip 当通过。

## 已观察结果（2026-09-27）

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
CORE_MYSQL_TEST_ADMIN_URL=mysql://root@127.0.0.1:13316/ \
CORE_MYSQL_TEST_CONTAINER=holaday-first-cutover-qa-9fe641c18a7d3502 \
pnpm --filter @holaday/orchestrator exec vitest run \
  --config vitest.integration.config.ts \
  src/execution/ordinary-first-cutover.mysql.integration.test.ts
```

测试先检查 loopback/13316/专用标签/无额外挂载，创建随机 source/restore 两库。runner 只在不含 `.env*` 的临时源码快照执行，子进程环境不继承生产配置。备份仅在内存中传送；所有业务数据均合成，无加密备份声明。finally 复核 server_uuid，只清理本例成功创建的库及 mkdtemp 源码快照。触发器/事件/存储过程只用于对象完整性检查，事件调度禁用。

无论成功失败，都应确认该测试进程退出，然后移除本例容器（自动删除其匿名卷）和网络；不要删除或停止既有 `holaday-mysql`。

```bash
docker stop holaday-first-cutover-qa-9fe641c18a7d3502
docker network rm holaday-cutover-mysql-9fe641c18a7d3502
```

本次先尝试 Docker `--internal` 网络，未实际发布端口，测试在连接前失败；改成只发布 loopback 的专用桥接网络后才取得业务断言证据。此环境问题不是产品 RED。完整生产加密备份/恢复、全主机停写证明、双主机部署仍未完成。
