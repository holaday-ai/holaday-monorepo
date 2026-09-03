# HOLA DAY 模型数据区域与千问影子评测设计

日期：2026-09-03
状态：已确认双区域策略，进入 Phase 1

## 目标

把“中国大陆走北京、国际走新加坡”从运行时猜测变成可审计的账户或组织数据归属，并增加一个默认关闭、只接受合成样本、不会改变用户答案的千问影子评测适配层。

## 产品与合规边界

- 区域只能来自持久化的账户或组织选择，不根据 IP、界面语言、时区、手机号、支付方式或当前网络位置推断。
- 个人任务使用账户区域；组织项目任务使用组织区域，组织区域优先于成员个人区域。
- 未分配区域时不调用千问，也不回退到另一地区，继续走现有主模型链路。
- 组织成员个人区域与组织区域不一致时，以组织区域处理组织项目；后续 UI 必须在加入组织前明确告知。
- Phase 1 不提供普通用户修改区域的入口；避免在没有迁移流程、影响说明和审计前开放高风险切换。
- 影子评测只接受代码库内的合成测试样本。不得传入生产用户 prompt、附件、文件内容、身份信息或自由文本。
- 影子输出只用于离线质量评测，不回写任务、不展示给用户、不参与主答案、不扣用户额度。
- `QWEN_SHADOW_EVAL_ENABLED` 默认 `false`。本阶段不在 Orchestrator 启动路径或任务路由中接线。

## 数据模型

在 `users` 与 `organizations` 增加可空字段：

```text
model_data_region: null | cn | intl
```

现有记录保持 `null`，不得批量猜测或回填。数据库 CHECK 与 Drizzle 类型共同限制值域。Phase 1 不增加普通写接口；首次赋值将在后续专门的选择/迁移流程中完成。

## 解析优先级

```text
组织任务 + organization.model_data_region -> organization
组织任务 + organization 未分配          -> 拒绝千问路由
个人任务 + user.model_data_region         -> user
个人任务 + user 未分配                    -> 拒绝千问路由
```

解析结果只包含 `region` 与 `source`，不包含身份或凭据。未知值一律失败关闭。

## 影子评测适配层

适配器接收：

- 明确区域 `cn | intl`
- 模型用途 `reasoning | standard | fast | coding | verify`
- `dataClass: synthetic`
- 合成消息与上限参数
- 注入的 Anthropic-compatible client

适配器先检查开关和数据类别，再通过 `resolveQwenRoute` 选择同区 Key、端点与模型。所有响应都标记为 `shadow_only`；错误转换为结构化评测结果，绝不抛回主用户链路。日志与结果只能使用脱敏路由元数据。

Phase 1 用 mock client 验证契约，不进行真实网络请求。国际额度确认后，下一阶段才使用固定合成样本做首次新加坡调用。

## 数据库迁移

- 新增 `0058_model_data_regions.sql`。
- 仅执行两次 `ALTER TABLE ... ADD COLUMN ... ADD CONSTRAINT`，不更新现有行，不删除或重命名任何对象。
- `verify-db-schema.ts` 必须要求两个字段存在。
- release DB contract 必须证明 migration 编号唯一、迁移是加法式、值域约束完整。

## 验收标准

- 用户和组织 schema 都暴露 nullable `modelDataRegion`。
- migration 只增加字段和 CHECK，不做任何数据回填。
- 组织作用域缺少区域时严格拒绝，不偷用个人区域。
- 个人作用域缺少区域时严格拒绝。
- 影子评测默认关闭；关闭时 client 零调用。
- 非合成数据即使开关开启也被拒绝，client 零调用。
- 开启且配置完整时只使用显式区域路由，输出不含 Key、Base URL 或 workspace。
- 没有生产 callsite 引用影子适配器；无部署、无真实调用。

## 下一阶段

额度确认后，先对国际区运行一组无个人数据的合成能力基准，比较任务规划、结构化输出、工具选择、长上下文、中文写作与事实核验。达到门槛后再设计小白名单 canary；北京区在首次真实调用门禁前再配置大陆 Key。
