# 浏览器候选包：生产只读预检

## 结论与范围

本次完成运行进程、启动分流、模型开关和数据库结构的只读核对。没有部署、改配置、迁移数据库、重启生产服务、安装扩展或发起产品侧付费模型调用。候选代码仍为 `5aa02924203ce60e904ec310358a5194a2f45c28`，分支为 `codex/browser-release-candidate-20260925`；本记录与交接说明的修订仅为文档。

**候选尚不能直接部署；但本地 Chrome 执行与新 Linux 受控浏览器池不是同一项发布依赖。** 这纠正了此前把 Node loader 门槛概括为整个候选包前置条件的表述。没有因此缩减最终浏览器能力目标，亦未批准以关闭校验的方式上线。

## 线上事实快照

检查时间为 2026-09-25 13:24–13:26（Asia/Tokyo）。通过已有 SSH 入口读取限定元数据；未输出密钥、数据库连接串、完整环境变量或用户业务记录。

| 项目 | 实际读取结果 |
| --- | --- |
| 服务器 checkout | `107857fe70503e30691073f267d87275596edb20` |
| 跟踪文件状态 | 无未提交改动；不包含未跟踪文件盘点 |
| Node / 架构 | `v22.20.0` / `x86_64` |
| 应用 PID / UID | `733273` / 实际、有效、保存及文件系统 UID 均为 `998` |
| 进程目录 / 解释器 | `/opt/holaday-monorepo/apps/orchestrator` / `/opt/node22/bin/node` |
| 启动元数据 | 进程和已检查配置文件均没有 `HOLADAY_POOL_BOOT`、`HOLADAY_POOL_CANDIDATE` |
| 模型策略 | `MODEL_RUNTIME_POLICY=qwen_only` |
| 主流程放量 | `QWEN_CORE_ROLLOUT_MODE=off` |
| 启用通道 | `suggestions,plan,generate,scrape,video_edit_planner,verifier`；没有 `browser` |
| 其他已检查开关 | `NODE_ENV=production`、`MULTI_USER=true` |
| 原生池部署目录 | `/usr/local/lib/holaday-pool-broker/releases` 和 `/run/holaday-pool-broker` 均不存在 |

上表开关的进程值与磁盘配置一致。候选 `model-runtime-policy.ts` 对 `off` 或未启用的 lane 返回不可用：仅更换代码、保留这些开关，不会自动开放新的千问浏览器通道。没有读取或公开白名单成员，也没有修改灰度范围。

已核对入口文件与服务器 checkout 内容一致，并与本地相同 Git 对象的 SHA256 比较：

- `scripts/start-orchestrator-production.sh`：`9a180e7cca119dae84d59381a4d941a5ff9d599869f8b27d3382d5fe0e54388e`
- `apps/orchestrator/src/index.ts`：`2ba90ffb6bb0cb0d84a8746cef7eeccd02ae746292e8e3c42e9cb924781e8e64`

这些信息加强了对线上启动路径的判断，但没有证明所有已加载模块的内存内容等于 checkout，不能将它写成“完整运行 SHA 已认证”。首次 PM2 列表探针未返回，已终止该次本地 SSH 诊断客户端；未停止 PM2 或应用。后续采用 PID 文件和 `/proc` 限定字段完成核对，所有有界探针均已结束。

## 数据库结构差距

在已配置的应用数据库中开启只读事务，仅查询 `INFORMATION_SCHEMA`，最后回滚并关闭连接。已确认 `tasks`、`llm_calls` 两表存在。

| 迁移 | 候选要求 | 当前结构 |
| --- | --- | --- |
| 0059 | `tasks.execution_id`、`execution_revision`、`core_record_version` | 三个字段均不存在 |
| 0060 新字段 | `llm_calls.cost_status`、`usage_status`、`region`、`provider_request_id` | 四个字段均不存在 |
| 0060 现有字段 | 四个 token 计数与 `cost_usd` 可空，默认 NULL | 四个 int 均 NOT NULL DEFAULT 0；`cost_usd` 为 decimal(12,6) NOT NULL DEFAULT 0.000000 |

当前数据库查询名称含 `migrat` 的表未返回结果。这仅说明该数据库的该命名范围未见迁移台账，不证明其他数据库或外部系统没有记录。代码中的 `apply-numbered-migrations.ts` 枚举全部编号 SQL 并执行，忽略限定的已应用错误，不维护独立迁移版本表；本次没有运行它。

两组目标 schema 均未就位，候选上线前必须单独验证迁移兼容性、备份及失败恢复。0060 保留历史数值并标注历史状态；新记录未知费用不得当作零。代码回退不等于 SQL 回退。当前快照没有覆盖其他历史迁移的完整 schema 验证。

## 两条启动路径的边界

| 路径 | 候选源码行为 | 本次可以得出的结论 |
| --- | --- | --- |
| 当前普通启动 | `application-entry.ts` 未见受控启动元数据时直接加载 application；不调用 `startApplicationBoot` | 不能把 native loader 的 Linux/Node 条件等同于所有本地 Chrome 执行的必需条件；这不是普通路径生产验证通过 |
| 新受控池启动 | 有任一受控元数据即进入 boot 验证；失败不回落普通启动 | 需要独立平台和准入验收，不能靠清除标记、降级或放宽守卫来宣称完成 |

受控路径中还有三个明确未闭合项：

1. `browser-pool/broker-native-loader.ts` 要求固定的 Linux 执行路径、运行身份和 Node 22.x 版本门槛；当前服务器版本不满足。
2. `scripts/pool-broker/native-build-manifest.json` 仍为 `unverified` 模板，缺少目标平台原生产物安装及实机证明。不得手工改成已验证。
3. `execution/application-boot.ts` 未向 `DrainController` 注入开放准入验证器，注释明确为单独发布门槛；`drain-controller.ts` 缺少该验证器时返回 `OPEN_DENIED`。因此仅升级 Node 和安装产物也不等于能够接单。

本次没有实现、删除或放松上述逻辑，也没有选择新的生产启动路线。

## 本轮验证及交接

本轮在候选工作树、Node 24.19 下重跑以下六个测试文件，**43 项通过，退出 0，2.82 秒**：

- `application-entry.test.ts`
- `application-main.wiring.test.ts`
- `execution/application-boot.test.ts`
- `llm/model-runtime-policy.test.ts`
- `trpc/routers/local-chrome-selection.test.ts`
- `trpc/routers/tasks.browser-qwen.test.ts`

日志：`/tmp/holaday-candidate-launch-gates-20260925.log`。这些是本地控制流与契约测试，不是线上 Linux、MySQL 集成或网页任务成功率验证。上一轮全量测试及构建见 [候选交接说明](./2026-09-25-browser-release-candidate.md)，本轮没有重跑全量，不能将历史记录改称本轮通过。

已浏览继承的 82 个提交标题及变更路径，涉及交付/执行记录、任务与浏览器操作生命周期、受控原生池，并非只含 Chrome 新增功能；没有据此宣称 411 个历史变更路径已逐项代码审计。43 个排除项也只是原工作树的未提交增量，不能误称候选完全不含既有池代码。

下一步唯一入口：继续在本候选分支审核相对线上 checkout 的继承差异及数据库兼容性，把必须随候选发布的依赖收敛成一份发布检查表；不要重新扩建原生池或覆盖原目录。此后仍需真实环境执行验收与明确维护、灰度、扩展分发范围，才进入部署审批。没有授权时不写生产库、不改开关、不重启、不推送、不安装扩展。

原工作树、QA 服务及无关草稿保持原状。产品侧测试调用本轮为 0；既有 1000 次授权账本仍为已用 53、剩余 947。完整浏览器能力（包括多页、上传、视觉兜底和同题成功率）尚未验收，本记录不构成上线批准。
