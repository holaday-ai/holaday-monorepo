import type { RetentionPolicyDefinition, SourceEvidence } from './types.js';

function source(path: string, fact: string): SourceEvidence {
  return { kind: 'source_file', path, fact };
}

export const retentionPolicies: readonly RetentionPolicyDefinition[] = [
  {
    id: 'account_purpose_bound',
    trigger: '账号创建与持续使用',
    rule: { kind: 'purpose_bound', description: '账号存续及安全所需' },
    automationStatus: 'manual',
    retryStatus: 'not_implemented',
    evidence: [
      source('apps/orchestrator/src/db/schema/users.ts', '用户账号资料存储在 users 表中。'),
      source('apps/web-workbench/src/pages/SettingsPage.tsx', '设置页提供账号相关设置入口。'),
    ],
  },
  {
    id: 'task_visibility_unified_unknown',
    trigger: '任务创建、执行与展示',
    rule: {
      kind: 'unknown',
      reason: '套餐可见范围不是服务器删除期限，尚无统一期限。',
    },
    automationStatus: 'not_implemented',
    retryStatus: 'not_implemented',
    evidence: [
      source('apps/orchestrator/src/db/schema/tasks.ts', '任务记录存储在 tasks 表中。'),
      source(
        'apps/web-workbench/src/utils/time-buckets.ts',
        '任务时间分组和可见性工具不定义服务器删除期限。',
      ),
    ],
    localRegimes: [
      {
        id: 'task_30d',
        boundary:
          'task_30d 是写入标签；仅 LEDGER_DB_WRITE_ENABLED 开启时写入，expires_at 由 LEDGER_RETENTION_DAYS 决定且默认 60 天；仅默认关闭的 RETENTION_REAPER_ENABLED 开启后，reaper 才处理已到期且非 manual_hold 的行。',
        automationStatus: 'implemented',
        activation: {
          mode: 'feature_conditional',
          enabledByDefault: false,
          configKeys: [
            'LEDGER_DB_WRITE_ENABLED',
            'LEDGER_RETENTION_DAYS',
            'RETENTION_REAPER_ENABLED',
          ],
        },
        evidence: [
          source(
            'apps/orchestrator/src/execution/feature-flags.ts',
            'Evidence Ledger 数据库写入仅在 LEDGER_DB_WRITE_ENABLED 严格等于 true 时开启，默认关闭。',
          ),
          source(
            'apps/orchestrator/src/evidence/ledger-write-service.ts',
            '写入器保存 task_30d 标签，并按 LEDGER_RETENTION_DAYS 为新行写入 expires_at，缺省为 60 天。',
          ),
          source(
            'apps/orchestrator/src/index.ts',
            '定时 reaper 仅在 RETENTION_REAPER_ENABLED 严格等于 true 时注册，默认关闭。',
          ),
          source(
            'apps/orchestrator/src/evidence/retention-reaper.ts',
            'reaper 只处理仓储返回的已到期非 manual_hold 行。',
          ),
        ],
      },
      {
        id: 'audit_180d',
        boundary:
          '删除路由识别 audit_180d 并在任务删除时去标识后保留；当前没有已核实的 180 天写入器或统一 expires_at 赋值路径，因此不能声明 180 天自动删除。',
        automationStatus: 'not_implemented',
        activation: {
          mode: 'feature_conditional',
          enabledByDefault: false,
          configKeys: ['RETENTION_REAPER_ENABLED'],
        },
        evidence: [
          source(
            'apps/orchestrator/src/evidence/evidence-deletion-service.ts',
            '任务删除路由将 audit_180d 视为需去标识并保留的本地证据标签。',
          ),
          source(
            'apps/orchestrator/src/evidence/evidence-artifact-repository.ts',
            '仓储只按每行 expires_at 选择到期制品，没有 audit_180d 的固定天数推断。',
          ),
          source(
            'apps/orchestrator/src/index.ts',
            '通用 retention reaper 的定时注册由默认关闭的 RETENTION_REAPER_ENABLED 控制。',
          ),
        ],
      },
      {
        id: 'manual_hold',
        boundary:
          'manual_hold 仅在 ACTION_CAPTURE_ENABLED 与 B4_SCREENSHOT_ANCHOR_ENABLED 同时开启时用于截图锚点，两个开关默认关闭；仓储查询和 reaper 明确排除 manual_hold，不存在自动删除期限。',
        automationStatus: 'not_applicable',
        activation: {
          mode: 'feature_conditional',
          enabledByDefault: false,
          configKeys: [
            'ACTION_CAPTURE_ENABLED',
            'B4_SCREENSHOT_ANCHOR_ENABLED',
            'RETENTION_REAPER_ENABLED',
          ],
        },
        evidence: [
          source(
            'apps/orchestrator/src/execution/feature-flags.ts',
            'ACTION_CAPTURE_ENABLED 与 B4_SCREENSHOT_ANCHOR_ENABLED 均需显式 true，默认关闭。',
          ),
          source(
            'apps/orchestrator/src/trpc/routers/tasks.ts',
            '截图锚点只在两个捕获开关同时开启时写入 manual_hold 标签。',
          ),
          source(
            'apps/orchestrator/src/evidence/evidence-artifact-repository.ts',
            '到期查询明确排除 retention_policy 为 manual_hold 的行。',
          ),
        ],
      },
      {
        id: 'team_business_fact_permanent',
        boundary:
          '团队任务的提交、评审、申诉、仲裁决定、事件、证据绑定与 AI 贡献作为业务审计事实永久保留；账号关闭后仅保留账号墓碑关联，私人任务原文、对象与存储路径必须最小化。',
        automationStatus: 'implemented',
        activation: {
          mode: 'feature_conditional',
          enabledByDefault: false,
          configKeys: ['TEAM_PROJECTS_ENABLED'],
        },
        evidence: [
          source(
            'apps/orchestrator/src/account-closure/handlers/team-work-items.ts',
            '团队任务关闭处理器保留业务事实并最小化被引用的任务、文件与证据源。',
          ),
          source(
            'apps/orchestrator/src/account-closure/tombstone-service.ts',
            '最终关闭保留去标识账号墓碑供不可变业务事实引用。',
          ),
        ],
      },
    ],
  },
  {
    id: 'memory_entry_lifecycle',
    trigger: '记忆条目创建、更新或到期',
    rule: {
      kind: 'mixed',
      description:
        '偏好可长期，其他条目按自身期限/长期状态；读取时过滤不等于存储删除，尚无到期行删除自动化。',
    },
    automationStatus: 'not_implemented',
    retryStatus: 'not_implemented',
    evidence: [
      source('apps/orchestrator/src/db/schema/execution-memory.ts', '记忆条目包含可选到期时间。'),
      source(
        'apps/orchestrator/src/trpc/routers/memory.ts',
        '记忆路由在读取时过滤过期条目并提供用户删除操作，但读取过滤不删除存储行。',
      ),
    ],
  },
  {
    id: 'browser_local_until_clear',
    trigger: '本地星座资料写入',
    rule: { kind: 'until_user_action', action: '本地清除资料或浏览器数据' },
    automationStatus: 'implemented',
    retryStatus: 'not_applicable',
    evidence: [
      source(
        'apps/web-workbench/src/lib/astrology.ts',
        '星座资料保存在浏览器 localStorage 并可由清除函数移除。',
      ),
    ],
  },
  {
    id: 'stock_profile_mixed',
    trigger: '股票筛选、偏好更新或清空',
    rule: {
      kind: 'mixed',
      description: '自动筛选依据 90 天仅是推断窗口，清空控制服务器依据。',
    },
    automationStatus: 'implemented',
    retryStatus: 'not_implemented',
    evidence: [
      source(
        'apps/orchestrator/src/stocks/stock-preference-profile.ts',
        '股票偏好推断使用 90 天观察窗口。',
      ),
      source(
        'apps/orchestrator/src/stocks/stock-preference-repository.ts',
        '清空偏好会删除服务器信号并记录清空时间。',
      ),
    ],
  },
  {
    id: 'feedback_purpose_bound',
    trigger: '用户提交反馈或支持请求',
    rule: { kind: 'purpose_bound', description: '反馈、故障、安全、争议所需。' },
    automationStatus: 'manual',
    retryStatus: 'not_implemented',
    evidence: [
      source('apps/orchestrator/src/trpc/routers/feedback.ts', '反馈路由接收并处理用户反馈记录。'),
    ],
  },
  {
    id: 'notification_config_until_change',
    trigger: '通知渠道创建或更新',
    rule: { kind: 'until_user_action', action: '修改或删除渠道配置' },
    automationStatus: 'implemented',
    retryStatus: 'not_implemented',
    evidence: [
      source(
        'apps/orchestrator/src/trpc/routers/notifications.ts',
        '通知渠道路由支持更新和删除用户自己的渠道配置。',
      ),
    ],
  },
  {
    id: 'domain_snapshot_replace',
    trigger: '浏览历史同步成功',
    rule: { kind: 'until_user_action', action: '下次成功同步替换旧快照' },
    automationStatus: 'implemented',
    retryStatus: 'not_implemented',
    evidence: [
      source(
        'apps/orchestrator/src/browsing-history/service.ts',
        '浏览历史服务在事务中用新快照替换旧站点统计。',
      ),
    ],
  },
  {
    id: 'cookie_injection_mixed',
    trigger: '登录 cookie 同步或待注入记录创建',
    rule: { kind: 'mixed', description: '即时注入或暂存；旧明文字段迁移未完成。' },
    automationStatus: 'not_implemented',
    retryStatus: 'not_implemented',
    evidence: [
      source(
        'apps/orchestrator/src/cookies/sync-service.ts',
        '同步服务将待注入 cookie 注入浏览器上下文后清理记录。',
      ),
      source(
        'apps/orchestrator/src/db/schema/pending-cookies.ts',
        '待注入 cookie 表仍包含迁移中的旧字段。',
      ),
    ],
  },
  {
    id: 'transaction_restricted',
    trigger: '支付交易、退款或争议处理',
    rule: { kind: 'purpose_bound', description: '交易、税务、争议及法律所需。' },
    automationStatus: 'manual',
    retryStatus: 'not_implemented',
    evidence: [
      source('apps/orchestrator/src/db/schema/payments.ts', '支付表保存交易和支付状态记录。'),
    ],
  },
  {
    id: 'partner_financial_restricted',
    trigger: '合作伙伴实名、账务或风控处理',
    rule: { kind: 'purpose_bound', description: '实名、账务、反欺诈、税务和争议。' },
    automationStatus: 'manual',
    retryStatus: 'not_implemented',
    evidence: [
      source(
        'apps/orchestrator/src/db/schema/partner.ts',
        '合作伙伴表包含实名、账务、风控和结算记录。',
      ),
    ],
  },
  {
    id: 'media_mixed',
    trigger: '文件上传、媒体处理或账号素材设置',
    rule: { kind: 'mixed', description: '文件可用期、账号处理与安全/授权证据。' },
    automationStatus: 'manual',
    retryStatus: 'not_implemented',
    evidence: [
      source(
        'apps/orchestrator/src/db/schema/task-files.ts',
        '任务文件表记录用户文件及其生命周期元数据。',
      ),
      source(
        'apps/orchestrator/src/trpc/routers/video-onboarding.ts',
        '视频引导路由在特定媒体流程中清理可替换的素材。',
      ),
    ],
  },
  {
    id: 'analytics_configured_mixed',
    trigger: '能量分析日志写入或清理任务运行',
    rule: { kind: 'mixed', description: '已有能量分析分级期限，其他日志无统一期限。' },
    automationStatus: 'implemented',
    retryStatus: 'implemented',
    evidence: [
      source(
        'apps/orchestrator/src/config/env.energy-analytics.test.ts',
        '能量分析配置测试覆盖分级保留期限。',
      ),
      source(
        'apps/orchestrator/src/energy/analytics-cleanup.ts',
        '清理任务批量删除已过期的能量分析记录并支持后续补跑。',
      ),
    ],
  },
];
