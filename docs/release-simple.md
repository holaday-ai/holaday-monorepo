# 简化发布（capability-recovery）

脚本：`scripts/release-simple.sh`。默认只打印计划（dry-run），加 `--execute` 才会真正动服务器。**本分支只写了脚本，未执行。**

## 步骤
1. **前置检查**：服务器工作树必须没有未提交改动，并记下当前 HEAD 作为回滚点（`.release-previous-ref`）。
2. **数据库备份**：在服务器上用 `mysqldump --single-transaction` 导出到 `BACKUP_DIR/holaday-<时间>.sql.gz`。数据库凭据只从服务器自己的 `.env` 读取，不回显。
3. **部署代码**：`git fetch` 后检出 `RELEASE_REF`，再 `pnpm install --frozen-lockfile`，构建 orchestrator 和 web-workbench。
4. **迁移**：`pnpm db:migrate:numbered` 加 `pnpm db:verify`，**在重启前执行**（先改表结构再上代码）。本分支新增 0061（模型目录）、0062（自我进化，批次 06）、0063（平台失败退款），线上若缺 0059/0060 也会一起补上。全部是增量迁移。
5. **重启加冒烟**：`pm2 restart` 后检查 healthz，最多重试 6 次。
6. **失败回滚**：代码回到 `.release-previous-ref` 后重新构建、重启。表结构是增量的，保留不动。备份留着，只在确实需要时手动恢复。

## 使用
```bash
DEPLOY_HOST=root@<host> DEPLOY_DIR=/opt/holaday-monorepo RELEASE_REF=origin/claude/capability-recovery \
  bash scripts/release-simple.sh            # 先看计划
DEPLOY_HOST=... DEPLOY_DIR=... RELEASE_REF=... bash scripts/release-simple.sh --execute
```
SSH 使用操作人自己的密钥或 agent（`BatchMode=yes`），脚本不读取也不保存任何密码。

## 与现有 cutover 流程的差异
| | 现有 `deploy-browser-first-cutover.sh` 等 | release-simple |
|---|---|---|
| 范围 | 浏览器首发切换：栅栏、ingress、kernel census、证据采集等多阶段协调 | 单机：备份 → 构建 → 迁移 → 重启 → 冒烟 → 回滚 |
| 迁移 | 由各专项脚本按清单执行 | 统一用 `db:migrate:numbered` 加 `db:verify` |
| 回滚 | 各阶段有各自的恢复路径 | 只回滚代码；表结构增量保留，数据库备份手动恢复 |
| SPA | 双边（Aliyun 加 Vultr） | 只在服务器本机构建 SPA；**Aliyun 一侧仍需按 `docs/DEPLOY_RUNBOOK.md` 的 `deploy-current.sh spa` 双发** |
| 适用 | 浏览器首发切换这类高风险变更 | 常规能力迭代（本分支） |

上线后按 `scripts/smoke-real-tasks.md` 做真机验收；env 变更见 `docs/env-changes-capability-recovery.md`。
