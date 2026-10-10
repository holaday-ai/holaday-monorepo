# PR #242 后续小修复 — 2026-10-07

分支 `codex/ui-small-fixes` 从 `codex/ui-interaction-fixes@f82b0ef51846522018c77367ef277872ac44ac7d` 创建。仅前端、测试及核对文档；无后端、数据库、迁移或服务器操作。不合并、不部署。

## 修复

1. **加载更多上限**：单次最多连续拉5页。若仍无新增可见任务，前端记录停止状态并显示“没有更多可见任务”，后续点击不再请求；服务端cursor/hasMore保持真实。刷新列表重置停止状态，第5页有可见任务时不误停止。保留原有并发锁、session隔离和重复游标保护。
2. **通知测试存储**：在模块导入前以 `vi.hoisted` + `vi.stubGlobal` 自行提供localStorage；每例清空、测试文件结束还原。UserMenu引入的theme-store不再读取Node原生实验性localStorage。
3. **Vitest收集范围**：配置保留 `configDefaults.exclude` 并追加 `e2e/**`，test脚本恢复直接 `vitest run`。Vite6插件类型与Vitest2 test选项明确组合，不用any或关闭typecheck绕过。
4. **丢失文件**：既有认证预览/下载确认404或410后，共享可用性状态使文件库、预览、任务附件显示“文件已不可用”；不弹错误toast，不保留可用下载入口。文件库菜单及预览头部移除下载项，任务附件显示不可用且不能重复下载。401/403/网络/503仍按原错误处理。未硬编码旧文件ID、未恢复或删除服务端文件，也没有修改后端响应。

## 最终验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @holaday/web-workbench exec vitest run --maxWorkers=1 --minWorkers=1`（未传exclude） | 274文件、2605项全部通过，退出码0；未收集e2e Playwright脚本 |
| NotificationBell.interaction：Node20.20.2 | 4/4通过 |
| NotificationBell.interaction：Node24.13.0 | 4/4通过 |
| NotificationBell.interaction：Node25.6.0 | 4/4通过 |
| `pnpm --filter @holaday/web-workbench build` | 全量ESLint、两份tsconfig检查、Vite构建均通过，退出码0 |
| `git diff --check` | 通过 |

新增回归覆盖五页停止、阻止重复加载、刷新重置、第5页有结果、停止文案、文件库404/410不弹错误及无下载项、预览不可用无下载入口、任务附件404/410与503区分。测试使用模拟数据；没有触发生产文件操作或真实计费任务。

检查串行执行，Node内存上限2GB。仍有既有包体积（>700KB）、caniuse-lite及Tailwind任意值类名提示；Node25其他测试可能出现实验性localStorage警告，不影响最终退出码。完整日志保留本机，摘要及SHA-256如下。

## 本机日志摘要

- `/private/tmp/holaday-ui-small-fixes/tests-final.log`
  - SHA-256: `5f97c8ac81b4abe65699a6ae05f7986507caa14b70ecbdb724e17d1b51cf8336`
- `/private/tmp/holaday-ui-small-fixes/build-verified.log`
  - SHA-256: `dca400cd4cdd7bc6dbf3e58b7b238dd3e0fc0f4de9ccc8b91be5a88a05a5c7f5`
- `/private/tmp/holaday-ui-small-fixes/notification-node20.log`
  - SHA-256: `faab78f2eee6c6b9f28cd87ed23d70414df0dd6bf3ede4967e0526f6af7d7cd6`
- `/private/tmp/holaday-ui-small-fixes/notification-node24.log`
  - SHA-256: `80e0ce297f0334be89f80d5a65b82e258e4b8d01ebeb796aedbcaea134c62181`
- `/private/tmp/holaday-ui-small-fixes/notification-node25.log`
  - SHA-256: `f530ef0b46e5e3e914cdcac758208809190d668b62651295a2ba99fb57cad490`
