# HOLA DAY 机器可读数据治理注册表设计

日期：2026-08-25  
状态：设计已确认，待规格复核  
基线：`codex/privacy-truth` / `4271bff3`

## 1. 背景

HOLA DAY 已在隐私政策事实化 P0 中核对账号、任务、浏览器扩展、支付、媒体、今日能量、股票画像、反馈、通知和外部处理方等真实边界。现有实现仍按业务模块分别维护数据结构、删除动作、保留规则和第三方调用，缺少一套机器可读、可验证的统一分类。

直接建设账号自动关闭、个人数据导出或统一保留任务，会先遇到三个基础问题：

1. 不同模块对同一类数据使用不同名称，无法稳定编排；
2. “已实现”“人工处理”和“尚未实现”没有统一状态，容易把文案或局部处理误当成完整能力；
3. 隐私政策、外部处理方清单和实际代码可能再次漂移。

本设计先建立只读、强类型的数据治理事实层。它不处理真实用户数据，也不自动执行删除、导出或生产清理；后续治理服务只能通过稳定注册项 ID 接入。

## 2. 设计目标

首阶段必须做到：

1. 为当前公开披露的 13 个数据类别建立稳定、机器可读的工程定义；
2. 登记数据元素、来源、用途、存储位置、处理方、保留规则和用户权利能力；
3. 明确区分 `implemented`、`manual`、`not_implemented` 和 `not_applicable`；
4. 用源码路径或导出符号提供可核验的工程证据，不依赖易漂移的行号；
5. 提供只读 CLI，输出结构错误和治理缺口，不查询数据库、生产环境或用户数据；
6. 建立隐私政策与注册表的数据类别覆盖契约，但不自动生成法律文案；
7. 为后续账号关闭、数据导出、统一保留和政策版本记录提供稳定接口。

## 3. 非目标

首阶段不包含：

- 新数据库表、migration 或生产环境变量；
- 账号自动关闭、跨系统删除或用户数据导出；
- 新的保留定时任务、对象存储清理或失败重试执行器；
- 修改现有任务删除、Cookie、记忆、股票画像、支付或媒体业务行为；
- 自动判断法律依据、合同有效性、跨境合法性或法域；
- 根据注册表自动生成或发布隐私政策；
- 读取、打印或保存密钥值、用户标识、任务正文、Cookie 值或任何真实个人数据；
- 合并或部署 PR #140。

## 4. 架构原则

### 4.1 工程事实与法律结论分离

注册表只描述可由代码、配置键存在性或已验证人工入口证明的工程事实。法律依据、合同、地区评估和律师意见只能标记为 `pending_legal_review`、`verified_by_counsel` 或 `not_applicable`，不得由程序推断。

### 4.2 静态强类型优先

首阶段使用 TypeScript 常量和只读类型，不使用数据库动态配置。这样可以让编译、单元测试和代码审查共同约束变更，并避免运行时配置与真实代码漂移。

### 4.3 显式缺口优于空值

期限未知、处理器不存在或地区未核实时，必须使用明确枚举和原因说明。空字符串、缺省值或猜测值均视为结构错误。

### 4.4 无热路径依赖

业务路由、任务执行和生产启动不导入审计 CLI。注册表首阶段只被测试、审计命令和未来治理模块引用；登记不完整不会中断线上任务。

### 4.5 稳定 ID 驱动后续能力

数据类别、处理方、保留策略和权利处理器均使用稳定 ID。显示名称可调整，ID 一经发布不得静默复用或改变含义。

## 5. 模块边界

新模块位于：

```text
apps/orchestrator/src/data-governance/
  types.ts
  data-categories.ts
  processors.ts
  retention-policies.ts
  rights-capabilities.ts
  public-disclosure-map.ts
  audit.ts
  index.ts
```

只读 CLI 位于：

```text
apps/orchestrator/scripts/governance-audit.ts
```

根目录增加：

```json
{
  "scripts": {
    "governance:audit": "pnpm --filter @holaday/orchestrator exec tsx scripts/governance-audit.ts"
  }
}
```

测试与模块同目录，使用现有 Orchestrator Vitest 配置。首阶段不新增运行时 API 或前端页面。

## 6. 核心类型

以下是概念接口；实施计划可调整字段排列，但不能弱化语义。

```ts
type GovernanceCapabilityStatus =
  | 'implemented'
  | 'manual'
  | 'not_implemented'
  | 'not_applicable';

type VerificationStatus =
  | 'verified_in_code'
  | 'verified_operationally'
  | 'unknown'
  | 'pending_legal_review';

interface SourceEvidence {
  kind: 'source_file' | 'exported_symbol' | 'operational_entrypoint';
  path: string;
  symbol?: string;
  fact: string;
}

interface DataCategoryDefinition {
  id: DataCategoryId;
  displayName: string;
  description: string;
  dataElements: readonly string[];
  sources: readonly string[];
  purposes: readonly string[];
  sensitivity: 'standard' | 'sensitive' | 'highly_sensitive';
  storageLocations: readonly string[];
  processorIds: readonly ProcessorId[];
  retentionPolicyId: RetentionPolicyId;
  rightsCapabilityId: RightsCapabilityId;
  evidence: readonly SourceEvidence[];
}

interface ProcessorDefinition {
  id: ProcessorId;
  displayName: string;
  purposes: readonly string[];
  categoryIds: readonly DataCategoryId[];
  activation: {
    mode: 'always_internal' | 'feature_conditional' | 'user_configured';
    configKeys?: readonly string[];
    evidence: readonly SourceEvidence[];
  };
  regionStatus: VerificationStatus;
  legalReviewStatus: VerificationStatus;
}

interface RetentionPolicyDefinition {
  id: RetentionPolicyId;
  trigger: string;
  rule:
    | { kind: 'fixed_days'; days: number }
    | { kind: 'until_user_action'; action: string }
    | { kind: 'purpose_bound'; description: string }
    | { kind: 'mixed'; description: string }
    | { kind: 'unknown'; reason: string };
  automationStatus: GovernanceCapabilityStatus;
  retryStatus: GovernanceCapabilityStatus;
  evidence: readonly SourceEvidence[];
}

interface RightsCapability {
  id: RightsCapabilityId;
  export: CapabilityDefinition;
  delete: CapabilityDefinition;
  correct: CapabilityDefinition;
  pause: CapabilityDefinition;
  withdraw: CapabilityDefinition;
}

interface CapabilityDefinition {
  status: GovernanceCapabilityStatus;
  handlerRef?: string;
  manualEntrypoint?: string;
  scope: string;
  limitations: readonly string[];
  evidence: readonly SourceEvidence[];
}
```

`configKeys` 只允许保存配置键名称，用于说明触发条件；不得解析或输出对应值。

## 7. 首批 13 个数据类别

首阶段固定登记以下 ID，并与已核实的 SPA 和生产精确路由隐私页一一对应：

| ID | 显示名称 | 主要边界 |
|---|---|---|
| `account_security` | 账号与安全 | 账号资料、密码哈希、MFA、会话 |
| `task_execution` | 任务与执行 | 指令、计划、步骤、结果、截图、页面上下文、文件和错误 |
| `cross_task_memory` | 跨任务 AI 记忆 | 从已完成任务提取并复用于后续任务的记忆 |
| `energy_astrology_profile` | 今日能量星座资料 | 浏览器本地资料、HOLA DAY 请求和 DivineAPI 最小字段 |
| `stock_preference_profile` | 股票偏好画像 | 自动筛选依据、主动偏好、自选股依据和派生观察 |
| `feedback_support` | 反馈与支持 | 主动反馈文本及必要账号、设备和任务上下文 |
| `external_notifications` | 外部通知渠道 | webhook 配置、通知正文和有限任务意图 |
| `extension_site_stats` | 扩展常用网站 | 设备端汇总后的域名级统计 |
| `extension_login_cookies` | 扩展登录态 | 固定域名清单内的真实 Cookie 数据 |
| `payments_entitlements` | 支付与套餐 | 订单、金额、币种、渠道标识、权益和有限付款信息 |
| `partner_kyc_ledger` | 合伙人 KYC 与账本 | 银行指纹、KYC、奖励、提现、风险和账本记录 |
| `media_assets` | 媒体素材 | 图片、视频、语音、声音克隆标识和授权时间 |
| `analytics_logs` | 分析与日志 | 固定事件聚合、匿名摘要、IP、User-Agent、操作与错误日志 |

若后续发现第 14 类，不得把它强行归入已有类别。应新增稳定 ID、证据、处理方、保留和权利定义，并同步审查公开披露是否需要更新。

## 8. 处理方注册表

处理方注册表至少覆盖当前政策已披露且代码存在相关路径的服务：

- HOLA DAY 内部基础设施；
- Anthropic、OpenAI、Google、Alibaba Cloud DashScope、fal.ai；
- DivineAPI；
- Firecrawl、Apify；
- Zapier；
- Resend 与实际短信服务路径；
- PayPal 与中国支付服务；
- 企业微信、飞书、钉钉和用户配置的自定义 webhook；
- Vultr、Cloudflare R2、Aliyun。

每个外部处理方必须说明：

1. 哪些功能条件下才会参与；
2. 可能处理哪些注册数据类别；
3. 对应代码路径或适配器符号；
4. 地区是否经过工程核实；
5. 法务审阅状态。

首阶段不尝试自动发现所有网络客户端。新增受支持的外部适配器时，由契约测试要求同步登记；无法静态确认的调用必须进入显式缺口报告。

## 9. 保留策略注册表

保留策略必须描述实际执行，而不是套餐营销期限。首批策略至少区分：

- 账号存续和安全目的所需；
- 套餐可见历史与服务器删除期限尚未统一；
- 记忆条目自身期限或长期状态；
- 浏览器 localStorage 由用户清除；
- 股票筛选依据的 90 天推断窗口与服务器删除期限分离；
- 域名快照由下次成功同步替换；
- Cookie 即时注入、暂存和旧字段迁移缺口；
- 支付、KYC、账本和争议记录按业务及法律需要受限保留；
- 证据制品已有 `task_30d`、`audit_180d`、`manual_hold` 等局部规则；
- 分析、反馈和日志按具体配置、故障、安全和争议目的处理，尚无统一全局期限。

`fixed_days` 仅用于代码中存在真实期限和执行路径的规则。观察窗口、页面可见范围或推断窗口不得登记成删除期限。

## 10. 权利能力注册表

每个数据类别必须引用一组权利能力。状态解释如下：

- `implemented`：存在可调用的真实处理器，并能说明精确范围；
- `manual`：存在已公开的人工入口，但不宣称自动完成；
- `not_implemented`：能力尚未建设，必须列出缺口；
- `not_applicable`：该能力对该类别不适用，并说明原因。

首阶段的真实边界包括但不限于：

- 账号关闭与综合个人数据申请：`manual`，入口为隐私邮箱；
- 跨任务记忆逐条删除/清空：按现有设置页能力登记；
- 今日能量本地星座资料清除：按现有浏览器控制登记；
- 股票画像暂停和清空：按现有行为登记，并保留“不删除自选股”的限制；
- 浏览器 Cookie 未来同步停止：按退出登录、停用或卸载扩展登记，服务器已接收数据删除仍为人工或未实现；
- 个人数据综合导出：`not_implemented`；
- 支付、KYC 和审计记录：删除能力必须体现受限保留，不能标成无条件硬删除。

“已实现”项必须带 `handlerRef` 和源码证据；“人工处理”项必须带 `manualEntrypoint`；其他状态不得伪造处理器。

## 11. 公开披露映射

`public-disclosure-map.ts` 只保存以下映射：

- 注册数据类别 ID；
- SPA 隐私页对应显示名称；
- 生产 landing 隐私页对应显示名称；
- 必须出现的少量稳定边界关键词。

它不保存整段法律文案，也不自动修改 HTML/React 页面。测试负责确认：

1. 13 个公开类别均有注册项；
2. 两个公开表面均覆盖相同类别；
3. 不会把 `not_implemented` 或 `manual` 能力写成自动完成；
4. 新增注册类别若影响公开披露，必须显式选择 `publicly_disclosed` 或记录不公开原因。

最终法律文本仍由业务方和律师审阅。

## 12. 审计命令

`pnpm governance:audit` 默认输出便于人工阅读的摘要，并支持：

```text
pnpm governance:audit --format=json
pnpm governance:audit --strict
```

摘要只包含：

- 数据类别、处理方、保留策略和权利能力数量；
- 未知地区或待法务核实的处理方数量；
- `manual`、`not_implemented` 和未知保留规则数量；
- 孤立引用、重复 ID、缺少证据和未登记公开类别；
- 各缺口对应的注册项 ID。

禁止输出配置值、用户数据、数据库内容、任务文本、Cookie、支付标识或内部账号 ID。

### 12.1 退出码

- `0`：结构有效；所有已知缺口均被显式登记；
- `1`：重复 ID、无效引用、缺少必填证据、已实现能力无处理器、公开类别未登记、疑似密钥值或其他结构错误；
- `2`：命令参数或报告格式无效。

`manual`、`not_implemented`、`unknown` 和 `pending_legal_review` 本身不是结构失败；它们会进入缺口报告。`--strict` 可在未来由发布流程针对选定类别提高门槛，但首阶段不接生产启动。

## 13. 校验规则

审计器至少执行：

1. 所有 ID 唯一且符合小写 snake_case；
2. 每个类别引用的处理方、保留策略和权利能力均存在；
3. 处理方反向引用的类别与类别侧引用一致；
4. `implemented` 必须有处理器引用和源码证据；
5. `manual` 必须有人工入口、范围和限制；
6. `not_implemented` 不得携带虚假处理器；
7. 固定期限必须为正整数，并有自动化执行证据；
8. `unknown` 必须有原因；
9. 源码证据必须指向仓库内存在的路径；若指定导出符号，测试必须能核实该符号存在；
10. 注册内容不得包含常见密钥前缀、私钥头、访问令牌、Cookie 值或疑似真实用户标识；
11. 两个公开隐私页面的数据类别映射完整且无重复；
12. 当前 13 类的稳定 ID 不得被删除或改义，除非提供显式迁移说明。

## 14. 错误处理

注册表在模块加载时只进行类型约束，不产生网络或数据库副作用。审计器聚合全部错误后一次性输出，避免修复一个问题后才发现下一个。

错误消息格式固定为：

```text
[governance:<code>] <registry-id>: <human-readable message>
```

日志只包含错误代码、注册项 ID 和工程说明。路径可以输出，行号不作为持久证据。任何解析异常都不得回退为“通过”。

## 15. 测试策略

### 15.1 类型和结构测试

- 有效最小注册表通过；
- 重复 ID、空数组、无效状态和悬空引用失败；
- 未知状态必须有原因；
- 已实现能力缺少处理器失败。

### 15.2 真实性契约

- 当前 13 个类别全部存在；
- 现有局部处理器和人工入口引用有效；
- 90 天股票推断窗口不被标为删除期限；
- 套餐可见历史不被标为服务器删除期限；
- Cookie、支付、KYC 和审计记录的限制不被弱化。

### 15.3 处理方契约

- 已列入首批范围的外部适配器都有注册项；
- 处理方与类别双向引用一致；
- 配置键只记录名称，审计报告不读取值。

### 15.4 公开页面契约

- SPA 与 landing 隐私表的 13 个显示名称均能映射到稳定 ID；
- 新增类别不会只更新一个公开表面；
- 明确禁止自动删除、自动续费、固定日志期限等已知错误承诺重新出现。

### 15.5 CLI 契约

- 文本和 JSON 输出只包含聚合与 ID；
- 结构错误退出码为 1；
- 无效参数退出码为 2；
- 显式缺口在普通模式报告但退出 0；
- 输出通过敏感值负向测试。

## 16. 安全与隐私边界

- 审计不连接数据库、对象存储、支付、AI、浏览器或生产主机；
- 注册表不保存密钥值、账号 ID、邮箱、手机号、Cookie、任务正文或文件内容；
- 源码证据使用仓库相对路径和导出符号，不记录内部主机或生产 IP；
- JSON 报告只适合工程审计，不作为个人数据导出包；
- 处理方地区或法律状态未知时保持未知，不通过网络探测或代码猜测；
- 本项目不替代律师对隐私政策、跨境处理、未成年人、保留和合同的审阅。

## 17. 分支与交付策略

本项目使用独立工作树：

```text
/Users/yaleiqi/holaday-monorepo/.worktrees/data-governance-registry
```

分支：

```text
codex/data-governance-registry
```

它从 `codex/privacy-truth` / `4271bff3` 建立，原因是首批 13 类及两处公开政策真实性契约依赖 PR #140 已核实的事实。后续 PR 先以 `codex/privacy-truth` 为基线形成堆叠审查，不向 PR #140 写入 P1 代码。PR #140 满足法务条件并合并后，再将本项目重定向或重放到正式基线。

本阶段完成后允许推送并创建 PR，但不自动合并、不部署，也不修改生产配置。

## 18. 后续阶段顺序

注册表完成后，后续能力仍需分别设计、评审和实施：

1. 账号关闭编排与不含原始个人数据的处理回执；
2. 异步个人数据导出、短期签名下载和过期清理；
3. 统一保留任务、失败重试和可观测性；
4. `pending_cookies.cookies_json` 旧字段迁移移除及生产验证；
5. 政策版本、告知、同意和撤回记录；
6. 由法务维护的处理方合同和跨境评估台账。

任何后续阶段都不得仅凭注册表中的 `not_implemented` 状态直接执行破坏性操作。

## 19. 验收标准

首阶段完成必须同时满足：

1. 13 个公开数据类别均有稳定注册项；
2. 每项都有处理方、保留、权利状态和源码证据；
3. 已实现、人工处理、未实现和不适用可明确区分；
4. 审计命令不访问生产或用户数据；
5. 结构错误会失败，显式治理缺口会报告但不伪装成能力；
6. SPA 与 landing 的公开类别覆盖一致；
7. 类型、单元、契约、CLI、敏感值负向测试通过；
8. Orchestrator lint、typecheck、测试、根级相关门禁和 `git diff --check` 通过；
9. PR 说明列明未知保留、人工权利入口、未实现导出/账号编排和待法务核实项；
10. 没有 migration、生产配置、部署或真实用户数据操作。

## 20. 上线结论边界

该注册表完成后，只能声明“HOLA DAY 已建立机器可读的数据治理工程事实层”。不能据此声明：

- 已完成自动账号删除；
- 已支持完整个人数据导出；
- 所有数据都有统一自动保留期限；
- 所有处理方合同、地区和跨境依据已经法务确认；
- 隐私政策已经满足所有适用法律；
- PR #140 已具备生产发布条件。

法律运营主体、联系/注册地址、适用法域、隐私邮箱负责人和律师审阅仍是 PR #140 的独立生产阻断项。
