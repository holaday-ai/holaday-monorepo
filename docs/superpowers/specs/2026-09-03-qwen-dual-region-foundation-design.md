# HOLA DAY 千问双区域基础层设计

日期：2026-09-03
状态：产品方向已确认，进入基础层实施
基线：`8f5235a9`

## 1. 背景

HOLA DAY 当前文字规划、通用生成、浏览器智能与部分质量核验主要依赖 Anthropic，图片和部分视频核验依赖 Google，另有少量 OpenAI 调用。由于这些供应商的账户和付款方式无法稳定支持中国大陆主体，模型能力需要迁移到阿里云百炼的千问与万相体系。

阿里云百炼的中国（北京）与新加坡区域使用不同的账号体系、API Key、访问域名、模型清单和数据处理范围。两区凭据不能互换。因此本次迁移不能只替换一个模型名称，而要先建立可验证的区域隔离基础层。

## 2. 已确认产品决策

1. 先确定账号或组织的数据区域，再在该区域内选择模型。
2. 中国大陆账号和组织使用中国（北京）百炼；国际账号和组织使用新加坡百炼。
3. 不使用请求 IP、临时所在地、浏览器语言或时区推断数据区域。
4. 不进行静默跨区域降级。目标区域没有凭据或模型不可用时，任务明确失败并给出可处理的配置原因。
5. 跨区域调用未来只能作为明确、可审计、无敏感数据且获得用户同意的例外，不属于本阶段。
6. 浏览器执行仍由 Playwright/CDP/a11y 与现有安全策略完成；股票时效、支付、账号关闭等确定性逻辑不交给大模型。

## 3. 本阶段目标

本阶段只建设无业务切流的基础层：

- 建立 `cn` / `intl` 强类型区域契约；
- 分离两区 API Key、Anthropic-compatible Base URL 与 workspace 配置；
- 建立文字任务用途到千问模型的默认映射；
- 验证 Base URL 与区域严格匹配；
- 保留现有 `DASHSCOPE_API_KEY` 作为新加坡凭据的兼容回退，避免破坏现有万相与语音链路；
- 提供不含 API Key 的安全路由元数据，供日志和评测使用；
- 为下一阶段的账号/组织区域持久化、灰度切流和同题评测提供稳定接口。

## 4. 非目标

本阶段不包含：

- 数据库 migration 或账号/组织数据区域字段；
- 根据 IP、语言、手机号或支付方式自动判断区域；
- 把任何现有生产调用切换到千问；
- 修改生产环境变量、密钥、部署或用户可见行为；
- 修改图片、视频、语音、股票、支付、积分、账号关闭或 DivineAPI；
- 对北京 Key 或国际 Key 发起真实模型调用；
- 移除 Anthropic、OpenAI 或 Google SDK/依赖。

## 5. 区域配置契约

### 5.1 国际区域

- 数据区域：`intl`
- 服务部署范围：`international`
- 默认 Anthropic-compatible Base URL：`https://dashscope-intl.aliyuncs.com/apps/anthropic`
- 可接受专属域名：`https://{workspace}.ap-southeast-1.maas.aliyuncs.com/apps/anthropic`
- 凭据优先级：`DASHSCOPE_INTL_API_KEY`，为空时兼容读取既有 `DASHSCOPE_API_KEY`
- workspace：`DASHSCOPE_INTL_WORKSPACE_ID`，为空时兼容读取既有 `DASHSCOPE_WORKSPACE_ID`

### 5.2 中国大陆区域

- 数据区域：`cn`
- 服务部署范围：`china_mainland`
- 默认 Anthropic-compatible Base URL：`https://dashscope.aliyuncs.com/apps/anthropic`
- 可接受专属域名：`https://{workspace}.cn-beijing.maas.aliyuncs.com/apps/anthropic`
- 凭据：仅 `DASHSCOPE_CN_API_KEY`
- workspace：仅 `DASHSCOPE_CN_WORKSPACE_ID`
- 严禁回退到国际或既有 `DASHSCOPE_API_KEY`

### 5.3 URL 安全约束

Base URL 必须：

- 使用 HTTPS；
- 不含用户名、密码、查询参数或 hash；
- path 精确为 `/apps/anthropic`（允许末尾 `/`，规范化时移除）；
- hostname 属于该区域的公共域名或专属域名后缀；
- 不接受 localhost、IP 地址、自定义代理或另一地区域名。

## 6. 文字模型用途矩阵

| 用途 | 默认模型 | 说明 |
|---|---|---|
| `reasoning` | `qwen3.8-max` | 复杂规划、深度研究、浏览器任务决策 |
| `standard` | `qwen3.7-plus` | 日常生成、总结、报告、文件任务 |
| `fast` | `qwen3.8-flash` | 分类、改写、轻量短任务 |
| `coding` | `qwen3-coder-plus` | 代码理解与生成 |
| `verify` | `qwen3.8-flash` | 非思考模式、严格 JSON 的第二模型核验 |

所有默认模型均可通过区域无关的服务端环境变量覆盖，但模型仍只能在选定区域内调用。正式切流前必须分别核对北京与新加坡模型清单，不能因为名称相同就推断两区能力完全一致。

## 7. 失败与隐私边界

- 未提供数据区域：返回 `REGION_REQUIRED`。
- 目标区域缺少凭据：返回 `MISSING_REGION_CREDENTIALS`，不得尝试另一地区域。
- Base URL 与区域不匹配：启动配置解析失败或返回 `INVALID_REGION_ENDPOINT`。
- 未知用途：类型层拒绝，运行时解析返回 `UNKNOWN_PURPOSE`。
- API Key 只进入服务端客户端参数；安全元数据、错误、日志、测试快照均不得包含 Key、workspace 原值或用户标识。
- 安全元数据只允许包含 provider、region、deployment scope、model 与 `public` / `workspace_dedicated` 端点类型。

## 8. 后续阶段门槛

### Phase 1：区域归属与影子评测

1. 为个人账号与组织建立显式、不可由临时 IP 覆盖的数据区域；
2. 现有账号迁移策略单独审查，不能默认把所有用户改成中国大陆；
3. 先接入不产生用户副作用的影子评测与同题对照；
4. 国际真实调用使用现有国际 Key，北京真实调用到门槛时再通知用户配置大陆 Key；
5. 质量、结构化输出、工具调用、延迟、成本和错误率全部达到门槛后才进入 canary。

### Phase 2：按用途灰度切流

按 `fast/verify`、`standard`、`reasoning/browser` 的风险从低到高分批切换。每批均需区域白名单、独立 kill switch、无跨区回退、旧模型可回滚和生产聚合观测。

## 9. 验收标准

1. 两区配置解析和端点校验有独立单元测试；
2. 中国大陆缺 Key 时，即使存在国际 Key 也明确失败；
3. 国际区域可以兼容当前 `DASHSCOPE_API_KEY`，但显式国际 Key 优先；
4. 五类用途映射到已确认模型，且可由环境变量覆盖；
5. 安全元数据序列化后不含 API Key 或 workspace 值；
6. 新模块未被生产调用路径导入，现有行为不变；
7. Orchestrator 定向测试、类型检查和完整测试通过；
8. 不修改任何密钥、数据库、生产配置或部署状态。
