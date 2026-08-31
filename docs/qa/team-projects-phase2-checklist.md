# 团队项目空间 Phase 2 发布与 Canary 清单

日期：2026-08-31

范围：团队工单生命周期迁移 `0056`、Orchestrator、SPA、四个合成账号与两个合成组织的有限 Canary。本文是发布运行手册，不是生产通过证据；任何通过结论都必须来自当次安全预检和真实 Canary。

## 1. 隐私与边界

- 运行输出只允许布尔值与计数，不记录账号、组织、成员、工单、邀请、证据、自由文本、token、密钥或原始日志。
- 仅可使用已由两位真人操作人分别确认的合成账号和合成组织。未得到当前只读聚合确认前，不得复用历史 Phase 1 Canary 身份。Codex、自动化或同一真人的两次操作都不能充当第二位确认人。
- `TEAM_TASK_LIFECYCLE_ALLOWLIST` 必须恰好包含四个合成账号；四个账号都必须在已确认合成组织中有 active 成员关系；可访问的已启用组织必须恰好是两个已确认合成组织，非合成组织计数必须为零。四个账号分别覆盖两个并发认领人、独立验收人与独立仲裁人的角色边界，不得用同一人兼任来缩减 Canary。
- 阶段一 smoke 与 13 项场景只接受当次真实 QA 执行生成的 receipt：`prepare` receipt 证明生命周期开关关闭时个人项目、团队项目和真实文件写入/列出/可读/删除路径均通过；`run` 必须先消费该 receipt，再证明开关开启后的同三条路径和固定 13 个具名场景。receipt 还绑定当前 40 位 revision、完整 4 × 2 boundary digest、7 天内完成时间和固定来源版本，且文件必须为普通文件、最多 32 KiB、仅 owner 可读写。任何旧 receipt 会在本轮运行前失效，直接设置通过数量或布尔环境变量不能使预检通过。
- 最终 manifest 禁止手写。候选边界、primary attestation、secondary attestation 必须是 UID 998 拥有的同一 `0700` 受限目录内三个独立的 owner-only 文件；根控制的 trusted signer registry 必须恰好登记两个不同真人主体的 Ed25519 公钥，私钥不得进入生产服务器、仓库或 Codex。每位真人核对完整的组织、项目、角色、账号、组织成员和项目成员映射后，分别离线签署由 `canary:team-task-lifecycle:attestation-payload` 生成的规范 payload；seal 会校验公钥、主体、槽位、时间顺序、签名和完整 SHA-256 boundary digest。由 UID 998 运行 `pnpm --dir apps/orchestrator canary:team-task-lifecycle:seal -- <trusted-signers> <candidate> <primary> <secondary> <manifest>` 生成不可覆盖的最终 manifest；同一真人或自动化不得充当第二位签署人。
- 不触碰奖励、支付、提现、Partner Ledger、cn-payment、通用积分、DivineAPI 或 OpenAI key。
- 迁移和审计记录只追加。失败时关闭功能开关并前向修复，不删除 `0056` 表或已产生审计事件。

## 2. 三段预检

在生产主机仓库根目录以 root 运行。私有 allowlist 只通过受控环境注入，不写入命令、文档或日志。`TEAM_TASK_LIFECYCLE_CANARY_MANIFEST_FILE`、`TEAM_TASK_LIFECYCLE_TRUSTED_SIGNERS_FILE` 和 `TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE` 只保存绝对路径；预检会要求 trusted signer registry 由 root 拥有，并验证 manifest 的双签名和 receipt，不接受 `*_CONFIRMED=true` 一类人工填写的确认布尔值。

```bash
node scripts/team-task-lifecycle-production-preflight.mjs collect apps/orchestrator/.env > /tmp/team-task-lifecycle-safe-snapshot.json
node scripts/team-task-lifecycle-production-preflight.mjs dormant < /tmp/team-task-lifecycle-safe-snapshot.json
node scripts/team-task-lifecycle-production-preflight.mjs canary-ready < /tmp/team-task-lifecycle-safe-snapshot.json
node scripts/team-task-lifecycle-production-preflight.mjs canary-running < /tmp/team-task-lifecycle-safe-snapshot.json
node scripts/team-task-lifecycle-production-preflight.mjs observe < /tmp/team-task-lifecycle-safe-snapshot.json
```

每次只运行当前阶段对应的一条判定命令：

| 阶段 | 必须满足 |
| --- | --- |
| `dormant` | 两个健康接口正常；revision 匹配；Orchestrator 单进程且 UID 998；checkout 有 `0056` 且生产 14 张表和完整 `db:verify` 一起证明最终 schema contract；生命周期关闭；同 revision 的 `prepare` receipt 中阶段一个人/团队/文件 smoke 通过；相关错误为 0 |
| `canary-ready` | 包含 `dormant` 的公共基线；生命周期仍关闭；用户 allowlist、active 合成用户和有效合成成员账号均恰好 4；合成用户和组织均已双人确认；有效合成组织恰好 2；可达非合成组织为 0 |
| `canary-running` | 生命周期已开启但仍保持 4 × 2 边界；`run` receipt 同时保留关闭态和开启态的个人/团队/文件 smoke，下面 13 项场景全部通过 |
| `observe` | 当前 Orchestrator 进程连续运行至少 24 小时；stdout 与 stderr 日志覆盖整个窗口且延迟样本存在；仍保持相同 revision、健康、4 × 2 边界、场景 receipt 和零非预期错误；只报告冲突数与延迟 P95，不得自动扩大灰度 |

收尾时安全删除 `/tmp/team-task-lifecycle-safe-snapshot.json`。该文件本身不含身份或密钥，但仍按短期运行产物处理。

## 3. 部署顺序

1. 在合并后的发布分支记录生产 revision、两个 healthz、Orchestrator 进程/UID、最终 schema contract、同 revision 阶段一 smoke receipt，并运行 `dormant`。编号迁移器目前没有历史账本，因此发布证据只声明最终生产 schema contract，不伪称迁移历史记录。
2. 保持 `TEAM_TASK_LIFECYCLE_ENABLED=false`，通过现有应用部署入口部署 Orchestrator 与 SPA；部署脚本显式检查 `0056_team_work_item_lifecycle.sql`，执行编号迁移和 `db:verify`。
3. 再次运行 `dormant`；只有部署 revision 与期望完全一致且两个健康接口均为 `200/status ok` 才能继续。
4. 创建候选 4 × 2 边界后，由两位真人分别只读确认：四个账号均不可登录、无邮箱/手机号/Google/MFA，两个组织和两个项目均为本次合成对象，八组成员映射准确，且不存在范围外 active 成员关系。为每个主体生成规范 payload，分别用各自离线 Ed25519 私钥签名并写入两个 owner-only attestation，再用上述 seal 命令生成最终 manifest；禁止 Codex 自动生成 attestation 或接触私钥。确认 claimant A 在第一个合成项目中已有一次由 worker 完成、状态严格为 `completed`、带 `completed_at` 且至少存在一条成功 `llm_calls` 执行记录的 `origin=user` 支持任务（不得把成功结果直接写进数据库），随后写入两个完全一致的四用户 allowlist。
5. 保持 `TEAM_TASK_LIFECYCLE_ENABLED=false`，以 UID 998 运行 `pnpm --dir apps/orchestrator canary:team-task-lifecycle prepare` 生成并验证关闭态 receipt，再运行 `canary-ready`。
6. 保持 `TEAM_TASK_LIFECYCLE_ENABLED=false`，只能由 root 运行 `./scripts/run-team-task-lifecycle-canary.sh`。包装器先自行执行 `canary-ready`；root helper 用 `O_NOFOLLOW` 一次打开 UID 998 的 `0600` prepare receipt，对同一文件描述符执行 `fstat/read`，核对 regular、owner、大小与单链接，再校验路径仍指向同一 inode。helper 会先在持久的 `/var/lib/holaday/team-task-lifecycle-supervisor` root-only 目录中，按 `revision + 完整 boundary digest` 以 `O_EXCL` 写入并 fsync 不可重复的 consumed marker，再创建 claim；同一发布与边界只能尝试一次，即使运行账号在删除前保留或恢复原 inode 也不能重放。helper 在 claim 创建窗口崩溃会 fail-closed；极窄窗口可能留下不可执行、不可重放的 root-only `claimed.*` 残留，应由运维审计后清理，不得把它视为可恢复授权。随后 helper 删除原 receipt，把内容封装成 root-only、已 fsync claim。包装器原子开启开关、重启 Orchestrator，并由 root 通过不可回卷、无目录项的匿名管道把 claim 仅送入唯一 UID 998 子进程的 stdin；CLI 只接受 UID 0 创建、`nlink=0` 的 FIFO，读取后关闭，运行账号无法靠环境变量、路径或可回卷文件重放授权。Canary 由 `setsid --fork --wait` 放入独立 session/process group；身份 FIFO 只读取一次，随后在总时限内对保留 PID 重试 `/proc` 核验，缺失或非法报告由 root 根据 supervisor 的 `/proc/.../children` 关系发现或中止子进程。root 会在启动子进程前以 RDWR 预持有启动 FIFO，session child 也会先打开自己的 gate FD 再上报身份；身份完成后 root 只向已持有 FD 写入并关闭、删除路径，因此子进程即使在上报后立即退出也不会让 gate 写端永久阻塞。root-only 启动闸门只有在 PID、PGID、session 和 starttime 完整绑定后才放行 UID 998 进程；启动窗口收到的信号只记为 pending，不会先回滚后遗留子进程。`INT/TERM/HUP` 会先忽略后续重复信号，并用完整身份检查整个 session/process group；即使 leader 先退出，只要同一 PGID/session 仍有成员，也会强制清理并确认组为空，再等待 setsid supervisor 回收、关闭开关、重启、重建关闭态 receipt 并验证 `dormant`。starttime 会阻止 PID 复用误杀；无法证明组为空时只执行紧急关闭和重启，并明确报告回滚不完整。claim 只能由 root helper 删除，删除后会 fsync supervisor 目录。成功后执行 `canary-running` 后置门禁；普通失败与意外 `EXIT` 也使用最多两次、最终状态一致的回滚。若以已开启状态误启动，包装器会先回滚到关闭态并拒绝本次运行；`SIGKILL` 与主机断电仍由外部服务监督和默认关闭开关共同兜底。
7. 完成 13 项 Canary 后保持 allowlist 不变 24 小时；只读复盘运行 `observe`，不得自动扩大。

生成待离线签名的规范 payload（命令输出只含签名字段和 boundary digest，不含私钥；输出文件须保持 `0600`）：

```bash
pnpm --dir apps/orchestrator canary:team-task-lifecycle:attestation-payload -- <absolute-candidate> primary <registered-principal> <ISO-UTC-confirmed-at>
pnpm --dir apps/orchestrator canary:team-task-lifecycle:attestation-payload -- <absolute-candidate> secondary <registered-principal> <ISO-UTC-confirmed-at>
```

发布入口：

```bash
BRANCH=<已审核发布分支> ./scripts/deploy-current.sh application
```

该入口会先校验生产 HEAD 是目标分支祖先，再执行 Orchestrator 迁移/构建/健康检查和 SPA 双站发布/烟测。不得使用 `ALLOW_DIVERGENT_DEPLOY=1` 绕过非预期分叉。

## 4. 十三项 Canary 场景

| # | 场景 | 必须观察到的唯一结果 |
| --- | --- | --- |
| 1 | 直接指派闭环 | 创建、发布、接受指派、开始、阻塞、解除阻塞、提交、人工通过、关闭均成功且状态唯一 |
| 2 | 公开认领竞争 | 两个并发认领只有一个成功负责人；另一个获得标准冲突，不产生孤儿 assignment |
| 3 | 有效返工 | 失败 criterion、证据或缺失证据、修改指令、新期限齐全时可进入返工并重新提交 |
| 4 | 模糊驳回 | “质量不行”等无限或缺字段返工在服务端被拒绝，不写 review/event |
| 5 | 两轮上限 | 第二轮后不再允许第三次普通返工，只保留通过或正式申诉路径 |
| 6 | 正式申诉 | 合法执行人可对对应评审发起一次申诉；重复请求幂等 |
| 7 | 独立仲裁 | 仲裁人不同于负责人和验收人；同键重放返回原 receipt，新键重复决策被拒绝，一个申诉只产生一个最终决定 |
| 8 | 跨租户替换 | 所有公开资源 ID 替换均返回统一隐藏结果，不泄露资源是否存在 |
| 9 | inactive 成员 | 读取时和事务提交时失活都拒绝写入；先仅锁定精确项目成员行，并证明 mutation 会等待到数据库锁超时且返回冲突，再以独立提交竞争证明 mutation 在同一精确行锁持有期间保持未完成、提交失活状态后才返回隐藏拒绝；两段前后都要比较目标工单、生命周期事件和规划幂等事件计数，证明零新增、无孤儿业务记录 |
| 10 | 重复 mutation | 相同幂等键返回第一次 receipt；不同键配陈旧版本返回明确冲突 |
| 11 | AI 边界 | 只接受真实 `completed` 且有成功 LLM worker 执行记录的支持任务；AI 贡献保持 advisory，不能改变版本或验收，后续提交、返工、申诉和独立仲裁仍只能由真人角色完成 |
| 12 | 时效与验收独立 | `submitted_on_time` 只来自真实时间流逝后的提交时间，不通过 SQL 回填期限；人工验收事实单独显示，未知不误报为否 |
| 13 | 阶段一回归 | 个人项目 list/create/rename/delete、任务移动，以及真实文件 store/list/availability/delete 路径在开关关闭/开启时均保持原行为 |

真实 API/浏览器 QA 执行器完成后写入同 revision 的 owner-only receipt；预检从固定 13 个具名检查计算通过数。禁止手工创建 receipt、修改场景布尔值或直接填写 `13`。

## 5. 失败回滚

任一健康、边界、权限、状态、幂等、迁移、注销治理或阶段一回归检查失败时：

1. 立即设置 `TEAM_TASK_LIFECYCLE_ENABLED=false`，保留用户 allowlist 以便审计但不继续操作。
2. 重启 Orchestrator，验证单进程 UID 998、两个 healthz 和阶段一个人/团队 smoke。
3. 不删除 `0056` 表、工单、提交、评审、申诉、仲裁或事件；用新的前向修复 PR 处理。
4. 不改变账户注销 API/worker、支付或其他无关功能的既有生产状态。现有全局部署脚本的自动回滚安全行为另行保留，不把它当作团队任务回滚步骤。

## 6. 24 小时只读复盘

只报告：健康布尔值、revision 是否匹配、进程数/UID、当前进程连续运行秒数、功能开关布尔值、allowlist 数量、active 合成账号数、有效合成成员账号数、有效合成组织数、非合成组织数、生命周期总行数、13 项 receipt 通过数、stdout+stderr 日志覆盖布尔值、权限/状态/幂等/迁移/注销治理相关非预期错误总数、冲突计数、延迟样本数、延迟 P95 和观察时间范围。

不报告：账号或组织标识、成员、工单标题、验收标准、证据、申诉理由、仲裁内容、token、密钥、原始日志。即使 24 小时稳定，也只可结论为“有限 Canary 稳定，可讨论下一步”，不得自动扩大白名单。
