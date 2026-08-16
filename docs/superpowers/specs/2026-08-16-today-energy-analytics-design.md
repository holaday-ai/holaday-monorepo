# HOLA DAY 今日能量隐私最小化观测设计

- 日期：2026-08-16
- 状态：已确认；实施计划见 `docs/superpowers/plans/2026-08-16-today-energy-analytics.md`
- 范围：今日能量 B 阶段 P2 数据闭环，不启动 C 阶段运营系统

## 1. 背景

今日能量已经上线抽卡、轻测试、练习、小游戏、星座周期、继续下一项和回访内容架构。现有客户端通过 `energy.reportEvent` 上报部分事件，服务端对字段使用严格 Zod 白名单，但事件仅写入应用日志，没有独立持久化、幂等计数、保留策略或聚合查询。

当前还存在以下口径缺口：

- 没有 `energy_home_viewed`，无法确定页面访问基数；
- 补给方向选择没有独立事件；
- 重玩被客户端再次记录为开始，无法区分首次开始和重玩；
- 事件重试没有服务端幂等收据，存在重复计数风险；
- 没有匿名每日访客记录，无法计算日活与次日回访；
- 没有管理员聚合查询，无法基于真实数据决定是否进入 C；
- 旧设计中的“有帮助”反馈没有实现，且本次产品决策明确取消，不再建设。

本设计采用“服务端先聚合、少留痕”方案。它不保存逐条用户行为轨迹，只保留无身份聚合指标、短期幂等收据和 30 天匿名每日访客键。

## 2. 目标

1. 可靠统计今日能量的访问、开始、重玩、完成、失败和回访趋势；
2. 在网络重试、响应丢失和重复请求下保持计数幂等；
3. 不收集生日、出生地、心情或测试答案正文、塔罗问题、自由文本、第三方星座正文或精确停留时长；
4. 观测失败不影响页面、玩法或 DivineAPI 内容；
5. 提供管理员聚合查询，为未来 C 阶段立项提供数据依据；
6. 使用纯新增 migration、功能开关和可停止写入的回滚路径。

## 3. 非目标

- 不增加“有帮助／没有帮助”交互；
- 不定义或发送 `energy_feedback_submitted`；
- 不建设运营看板、内容后台、分群推荐或 Staff 对比；
- 不保存原始事件流或可重放的行为时间线；
- 不保存真实用户 ID、邮箱、生日、出生地或个人档案字段；
- 不上传测试选项、结果正文、塔罗问题、星座正文或自由文本；
- 不使用 PostHog、Mixpanel 等第三方行为分析服务；
- 不以停留时长、连续使用或沉迷指标作为优化目标；
- 不修改 DivineAPI、Translator、OpenAI、支付或任务执行配置。

## 4. 关键决策

### 4.1 聚合优先

服务端收到合法事件后直接累加每日统计桶，不写逐条事件记录。聚合桶只包含固定枚举维度和计数，不能还原某个用户的使用顺序。

### 4.2 匿名访客只为 DAU 与 D1

服务端使用独立 `ENERGY_ANALYTICS_HMAC_SECRET` 对内部用户 ID 做 HMAC-SHA256，数据库只保存 64 位十六进制摘要、UTC 日期和过期时间。同一匿名用户同一天最多一行，30 天后自动删除。

匿名访客表不保存玩法、补给方向、完成状态或其他行为字段。它只能回答“某匿名键在哪些日期访问过今日能量”，不能回答该用户做了什么。

### 4.3 不做反馈指标

旧 B/P2 设计中的“有帮助”反馈被本次产品决定明确覆盖。结果页不增加评价控件，服务端不接收反馈事件，管理员查询不返回有帮助比例。

### 4.4 生产预览不发送

`/cosmic-preview`、未登录预览和没有稳定用户作用域的页面保持本地体验，不发送任何观测事件。

## 5. 事件契约

### 5.1 核心事件

- `energy_home_viewed`：登录用户每次挂载今日能量首页最多一次；
- `energy_need_selected`：用户真实切换 `focus | relax | confidence | uplift` 时记录；重复点击当前值不记录；
- `energy_experience_started`：一次体验的首次开始；
- `energy_experience_replayed`：结果页或体验容器中的再次开始；
- `energy_experience_completed`：体验进入成功结果态；
- `energy_experience_failed`：体验进入错误态。

### 5.2 保留的内容枢纽事件

现有以下固定枚举事件继续通过同一管道聚合：

- `energy_section_viewed`；
- `energy_section_navigated`；
- `astrology_range_opened`；
- `tarot_mode_started`；
- `tarot_redrawn`；
- `light_test_started`；
- `light_test_completed`；
- `energy_feed_refreshed`；
- `energy_content_opened`；
- `energy_continuation_opened`；
- `energy_feed_exhausted`；
- `running_task_returned`。

### 5.3 通用字段

每次请求携带：

- `eventId`：客户端 UUID；新客户端必填，服务端在过渡期兼容旧客户端缺失；
- `type`：白名单事件类型；
- 事件类型允许的固定枚举维度；
- 客户端不提供时间戳，统计日期由服务端使用 UTC 生成。

允许的事件维度包括：

- `experienceId`；
- `modeId`；
- `energyNeed`；
- `durationBucket`；
- `outcome`；
- `section`；
- `targetType`；
- `fromKind`；
- `batchCount`；
- 现有内容 ID 与星座周期枚举。

所有输入对象继续 `.strict()`。未知字段、未知 ID、自由文本、答案正文和 provider 正文均返回 `BAD_REQUEST`。

## 6. 数据模型

### 6.1 `energy_daily_metrics`

用途：保存无身份的每日聚合统计。

主要字段：

- `id`：内部自增主键；
- `metric_date`：UTC `DATE`；
- `bucket_hash`：服务端按事件类型和规范化维度计算的 SHA-256；
- `event_type`：固定事件类型；
- `experience_id`、`mode_id`、`energy_need`、`duration_bucket`、`outcome`、`section_id`、`target_type`、`source_kind`、`content_id`、`range_key`、`task_status`：固定枚举维度；无值使用空字符串，不使用 `NULL` 参与唯一性；
- `batch_count`：有界整数维度；无值使用 0；
- `event_count`：无符号大整数；
- `expires_at`：`metric_date + 400 天`；
- `created_at`、`updated_at`。

约束：

- 唯一键：`(metric_date, bucket_hash)`；
- 清理索引：`expires_at`；
- 常用查询索引：`(metric_date, event_type)`；
- `bucket_hash` 由规范化稳定字段生成，不包含用户标识、事件 ID 或正文。

### 6.2 `energy_daily_visitors`

用途：计算 DAU 与次日回访率。

主要字段：

- `id`：内部自增主键；
- `activity_date`：UTC `DATE`；
- `visitor_hash`：HMAC-SHA256 十六进制摘要；
- `expires_at`：`activity_date + 30 天`；
- `created_at`。

约束：

- 唯一键：`(activity_date, visitor_hash)`；
- 清理索引：`expires_at`；
- 不存玩法、补给方向、结果、事件类型或真实用户 ID。

### 6.3 `energy_event_receipts`

用途：防止客户端重试重复计数。

主要字段：

- `event_id`：UUID 主键；
- `expires_at`：写入后 48 小时；
- `created_at`。

约束：

- 不关联用户、访客摘要、事件类型或指标桶；
- 清理索引：`expires_at`；
- 缺少 `eventId` 的旧客户端请求继续执行聚合，但不获得跨请求幂等保证；新 SPA 发布后所有请求均提供 `eventId`。

## 7. 服务边界

新增 `energy-analytics` 领域服务，路由不直接拼写数据库事务。

### 7.1 `recordEnergyEvent`

输入：经过 Zod 白名单验证的事件、内部 `userId`、当前时间和配置。

输出：`{ ok: true, duplicate: boolean, visitorRecorded: boolean }`。

流程：

1. `ENERGY_ANALYTICS_ENABLED=false` 时直接返回，不写库；
2. 校验并规范化聚合维度，计算 `bucket_hash`；
3. 新客户端请求先认领 `event_id`，重复收据直接返回 `duplicate=true`；
4. 原子 `INSERT ... ON DUPLICATE KEY UPDATE event_count = event_count + 1`；
5. `energy_home_viewed` 且 HMAC 密钥可用时，插入当日匿名访客，唯一键消除同日重复；
6. 提交事务后返回成功；
7. 不在日志中输出 HMAC、用户 ID、事件 ID 或完整事件负载。

同一事务包含收据认领、指标累加和访客写入。任一步失败均回滚，客户端按现有策略最多重试一次。

### 7.2 `queryEnergyMetrics`

仅供 `adminProcedure` 调用，支持最近 7 天和 30 天窗口。返回：

- 每日首页访问次数；
- 每日匿名访客数（DAU）；
- D1 次日回访率；
- 各玩法首次开始、重玩、完成和失败次数；
- 完成率：`completed / (started + replayed)`；
- 重玩率：`replayed / (started + replayed)`；
- 失败率：`failed / (started + replayed)`；
- 每次首页访问的体验启动次数：`(started + replayed) / home_viewed`。

最后一个指标明确命名为“每次访问启动次数”，不冒充独立用户启动率。服务没有逐玩法匿名用户集合，因此不输出无法真实计算的独立用户玩法转化率。

D1 只计算已经拥有完整次日数据的日期：

`D1(date) = 当日访客中也出现在 date + 1 的匿名键数 / 当日匿名访客数`

查询结果不包含匿名访客键、内部 ID 或逐行明细。

### 7.3 `cleanupEnergyAnalytics`

每日运行一次有界清理：

- 删除 `expires_at <= now` 的幂等收据；
- 删除 `expires_at <= now` 的匿名访客；
- 删除 `expires_at <= now` 的每日指标；
- 每表每轮最多删除固定批量；
- 多轮有界执行，不使用无条件全表删除；
- 清理失败只记录一次结构化运维告警，不影响应用启动。

## 8. 客户端改动

### 8.1 单一上报入口

沿用并扩展 `createEnergyEventReporter()`：

- 每个事件在入队前生成 `eventId`；
- 最大并发仍为 8；
- 网络或 5xx 最多重试一次；
- 4xx 不重试；
- 同一页面会话只输出一次脱敏 warning；
- dispose 后不发送排队重试；
- 不打印事件负载。

### 8.2 首页与补给方向

- 登录态 `EnergyHome` 挂载后上报一次 `energy_home_viewed`；
- `storageScope` 缺失时不发送；
- 用户切换补给方向且值真实变化时上报 `energy_need_selected`；
- 初始化默认值不计为用户选择。

### 8.3 体验生命周期

- 首次开始上报 `energy_experience_started`；
- 重玩上报 `energy_experience_replayed`，不再伪装成 started；
- 成功结果上报 completed；
- 错误结果上报 failed；
- 关闭未完成体验不计 completed，也不增加额外反馈事件。

本设计不增加任何可见页面控件。

## 9. 隐私与安全

- 独立 HMAC 密钥不得复用 JWT、OpenAI、DivineAPI 或支付密钥；
- 数据库不保存 HMAC 原始输入；
- 管理员接口只返回聚合数字；
- 应用日志不输出匿名摘要、内部用户 ID、eventId 或事件负载；
- 生日、出生地、星座 provider 正文、测试答案、塔罗问题和自由文本均处于输入白名单之外；
- `energy_need_selected` 只进入无身份每日聚合，不写入匿名访客行；
- 不向第三方分析服务发送事件；
- 不允许用这些指标评估单个 Staff、比较员工或推断个人情绪状态。

## 10. 错误与降级

- 观测失败不得改变页面状态、玩法结果、推荐或 DivineAPI 内容；
- 客户端失败只按有限策略重试，不形成无限队列；
- HMAC 密钥缺失时：总体聚合继续，匿名访客与 D1 暂停，服务每个进程最多告警一次；
- 数据库写入失败时：事务回滚，路由返回错误供客户端有限重试；第二次仍失败时 UI 静默继续；
- 管理员查询失败不影响用户路由；
- 清理失败保留待下次重试的数据，不执行危险兜底删除；
- 功能开关关闭时保留现有页面功能，仅停止新统计写入。

## 11. 配置

新增：

- `ENERGY_ANALYTICS_ENABLED`：默认 `false`；
- `ENERGY_ANALYTICS_HMAC_SECRET`：独立高熵密钥；开关为 true 时用于匿名访客；
- `ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS`：默认并锁定为 30，可只允许更短值；
- `ENERGY_ANALYTICS_METRIC_RETENTION_DAYS`：默认 400；
- `ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS`：默认 48。

生产预检要求：开关开启前必须确认 migration 已应用、HMAC 密钥存在且长度符合要求。不得把密钥值写进日志、文档、PR 或测试夹具。

## 12. 测试设计

### 12.1 数据层

- 三张表、索引、唯一键和默认值符合设计；
- migration 只包含新增表和索引，无破坏性 DDL/DML；
- 相同日期和桶哈希只累加一行；
- 相同匿名用户同日只写一行；
- 相同 eventId 重试不重复计数；
- 事务失败不留下收据或半写指标；
- 三种保留周期使用正确过期边界；
- 清理只删除到期数据且遵守批量上限。

### 12.2 服务与路由

- 开关关闭时无数据库写入；
- 旧客户端缺少 eventId 时仍兼容；
- 新客户端重复 eventId 返回 duplicate；
- HMAC 密钥缺失时总体指标继续、访客跳过；
- UTC 跨日和月末边界正确；
- D1 不计算尚未完成的次日；
- 完成率、重玩率、失败率和每次访问启动次数公式正确；
- 普通用户不能调用管理员聚合查询；
- 管理员响应不包含访客摘要或内部 ID；
- 自由文本、答案正文、provider 正文、未知字段和非法 ID 被拒绝。

### 12.3 客户端

- 登录首页每次挂载只发送一次 home viewed；
- 预览页和无 storageScope 页面不发送；
- 默认补给方向不发送选择事件；
- 真实切换发送一次，相同值重复点击不发送；
- 首次开始、重玩、完成和失败使用正确事件类型；
- 客户端生成 eventId，并在一次重试中复用同一 eventId；
- 4xx 不重试，网络与 5xx 只重试一次；
- 页面卸载后放弃排队重试；
- 观测失败时体验仍可完成；
- 页面不存在“有帮助”反馈控件。

### 12.4 发布门禁

- Orchestrator 相关测试；
- Web 能量组件和 reporter 测试；
- Orchestrator 与 Web typecheck；
- Web lint 与生产构建；
- migration 静态检查、编号迁移与 `db:verify`；
- `git diff --check`；
- 生产等价桌面和 390px 浏览器验收；
- 功能开关关闭与开启两条路径；
- 开启后一次真实开始与完成只改变对应聚合桶，且管理员查询不返回明细。

## 13. 发布顺序

1. 创建并审查纯新增 migration；
2. 在数据库应用 migration，并执行 schema verify；
3. 配置独立 HMAC 密钥，但保持 `ENERGY_ANALYTICS_ENABLED=false`；
4. 部署 Orchestrator，使新旧客户端事件都兼容；
5. 部署 SPA，使新客户端携带 eventId 和新事件口径；
6. 完成页面与事件失败降级验收；
7. 开启 `ENERGY_ANALYTICS_ENABLED`；
8. 用一次真实首页访问、开始、重玩或完成验证聚合变化；
9. 只通过管理员聚合查询读取结果；
10. 观察错误日志与表增长，不读取匿名访客明细。

## 14. 回滚

- 第一回滚动作：设置 `ENERGY_ANALYTICS_ENABLED=false`，立即停止新统计写入；
- 页面、玩法、星座 provider 和本地进度完全不依赖统计服务；
- 不删除已创建表，不执行逆向或破坏性 migration；
- 到期清理可以在开关关闭后继续运行；
- 若清理代码本身异常，可独立停止清理定时器，保留数据等待修复；
- 回滚不修改 DivineAPI、Translator、OpenAI、支付、任务执行或用户资料。

## 15. 上线标准

满足以下条件才可开启统计开关：

- 三张表和全部索引通过 schema verify；
- 新旧客户端兼容；
- 幂等、事务、UTC 日期、D1 和清理测试通过；
- 输入白名单证明无法写入私密正文；
- 管理员接口证明不返回匿名访客明细；
- 统计失败不会影响用户完成体验；
- 桌面和手机生产等价验收通过；
- 开关关闭路径验证无写入；
- HMAC 密钥已安全配置且未出现在日志、提交或 PR；
- 发布与回滚命令经过现有应用发布门禁。

达到这些标准后，今日能量可以开始积累 B 阶段真实使用数据。是否进入 C，仍需在积累足够周期的数据后另行评审。
