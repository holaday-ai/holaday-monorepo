# FIX-BATCH-DISABLED-ROW

## 结论

已修复侧栏批量管理中进行中任务行缺少禁用语义、点击无反馈的问题。基于 `claude/capability-recovery` 的 `0cf0c4d71f90f3a5035a5443180099e738570894`，分支 `codex/fix-batch-disabled-row`。仅修改前端任务行组件及相关回归测试。

- 行容器和标题按钮均声明 `aria-disabled=true`，只在批量模式且不可选时生效。
- 保留原有弱化、虚线选择框与运行中动效，增加禁用光标；悬停显示“进行中的任务不能批量操作”。
- 点击行或标题，以及键盘 Enter，均通过现有 Toast 显示原因，不勾选、不打开任务。
- 可选行仍可勾选和取消，标题点击只触发一次；退出批量模式后任务正常打开。

## 第 1 层验证

| 检查 | 结果 |
| --- | --- |
| 修复前真实组件测试 | 3 个失败（语义和点击反馈），3 个原有行为通过；[记录](red-test.log) |
| 最终相关测试 | 5 文件 / 31 项通过，含 6 项新增回归；[记录](final-tests.log) |
| web-workbench typecheck | exit 0；[记录](typecheck.log) |
| 改动文件 ESLint | exit 0；[记录](eslint.log) |
| 改动文件 Biome | exit 0，无新增告警；现有 `useKeyWithClickEvents` 告警 1 条，[基线](baseline-lint.log) / [最终](lint.log) |
| Vite 构建 | exit 0（ui:audit 内构建，10.34 秒） |
| 定向 ui:audit | 3/3 页面视口，470 控件，P1=0、P2=0；[结构化摘要](ui-summary.json) |
| 浏览器补充回归 | 4/4 尺寸：鼠标、Enter、禁用语义、禁用光标、原因提示、已选计数、可选行勾选及取消全部通过；[结果](after-browser.json) |

巡检场景为 `task:generate:executing`（`/?task=tsk_ui_generate_executing`，原报告发生问题的共享侧栏），视口为默认的 1440×960、1280×960、1024×960。每个视口均覆盖批量管理的打开和交互路径，禁选控件被记录为 `explained disabled control`。补充复现原始 1200×1000 尺寸。

巡检耗时约 12 分钟，完成全部 470 项控件遍历。脚本 exit 1 / 原始 status=failed **仅因为** `Case-filtered run: not full release acceptance`；没有发现项或其他覆盖缺口。按 TEST-POLICY 第 1 层执行，没有跑全量测试或全站巡检。这里是本地种子前端验证，不是线上或真实后端验收。

```bash
NODE_OPTIONS='--max-old-space-size=1536 --v8-pool-size=1' \
UV_THREADPOOL_SIZE=1 GOMAXPROCS=1 \
UI_AUDIT_CASES='["task:generate:executing"]' \
UI_AUDIT_OUTPUT=/private/tmp/fix-batch-disabled-row-ui pnpm ui:audit
```

Node v25.6.0，Chromium 147.0.7727.15。前端 source hash：`a2bbb81e395de77c0b5c4d3751c1fa9fdbd34396020c3177769828be10fbbbb6`。完整原始巡检、构建日志及可复跑浏览器脚本在本地任务交付目录 `/Users/yaleiqi/.holaday-recovery/tasks/fix-batch-disabled-row/`。

## 前后截图

| 尺寸 | 修复前 | 修复后（点击原因提示） |
| --- | --- | --- |
| 1440x960 | [截图](before-1440x960.png) | [截图](after-1440x960-feedback.png) |
| 1280x960 | [截图](before-1280x960.png) | [截图](after-1280x960-feedback.png) |
| 1024x960 | [截图](before-1024x960.png) | [截图](after-1024x960-feedback.png) |
| 1200x1000 | [截图](before-1200x1000.png) | [截图](after-1200x1000-feedback.png) |

截图使用本地种子数据。原问题摘录见 [reported-before-findings.json](reported-before-findings.json)，修复前浏览器实际状态见 [before-browser.json](before-browser.json)。修复后截图等待有限 CSS 动画结束，便于看清提示；产品动画没有修改。

## 范围与交付边界

未合并、未部署、未改后端或生产环境，未 SSH、未读写密钥、未 force push。原工作区及其未提交草稿保持不变。
