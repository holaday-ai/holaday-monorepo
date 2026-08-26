import type { CapabilityDefinition, RightsCapability, SourceEvidence } from './types.js';

const PRIVACY_EMAIL = 'privacy@holaday.ai';

function source(path: string, fact: string): SourceEvidence {
  return { kind: 'source_file', path, fact };
}

function capability(
  scope: string,
  limitations: readonly string[],
  evidence: readonly SourceEvidence[],
): Pick<CapabilityDefinition, 'scope' | 'limitations' | 'evidence'> {
  return { scope, limitations, evidence };
}

export const rightsCapabilities: readonly RightsCapability[] = [
  {
    id: 'account_manual_request',
    export: {
      status: 'not_implemented',
      ...capability(
        '无自动导出',
        ['尚未提供全面数据导出。'],
        [source('apps/orchestrator/src/db/schema/users.ts', '用户资料保存在账号表中。')],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/account-closure.ts#accountClosureRouter',
      ...capability(
        '强身份核验后进入 7 天冷静期的自助账号关闭',
        [
          '不提供完整个人数据导出。',
          '必要的支付、争议、安全、KYC 和账本记录可能经最小化后受限保留。',
          '无法远程清除其他设备、浏览器扩展或用户已下载的文件副本。',
        ],
        [
          source(
            'apps/orchestrator/src/trpc/routers/account-closure.ts',
            '账号关闭路由提供预览、强验证、申请、状态、撤销和回执接口。',
          ),
        ],
      ),
    },
    correct: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '身份核验后的账号资料更正',
        ['不能更正依法必须保留的历史记录。'],
        [source('apps/web-workbench/src/pages/SettingsPage.tsx', '设置页承载账号资料设置入口。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '账号安全处理不可暂停',
        [],
        [source('apps/orchestrator/src/db/schema/users.ts', '账号表支持持续账号和安全处理。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '适用时处理撤回申请',
        ['不影响撤回前已进行的处理。'],
        [
          source(
            'apps/orchestrator/src/db/schema/users.ts',
            '账号表是撤回申请涉及资料的存储证据。',
          ),
        ],
      ),
    },
  },
  {
    id: 'task_manual_request',
    export: {
      status: 'not_implemented',
      ...capability(
        '无全面任务数据导出',
        ['尚未提供包含全部任务关联数据的导出。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/tasks.ts',
            '任务路由提供任务查询和控制，而非全面导出。',
          ),
        ],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/tasks.ts#tasksRouter',
      ...capability(
        '删除本人已结束的单个任务',
        ['执行中、规划中或等待用户的任务不能直接删除。', '审计或人工保留证据可能被保留。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/tasks.ts',
            '任务路由按用户范围删除符合条件的单个任务。',
          ),
        ],
      ),
    },
    correct: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/tasks.ts#tasksRouter',
      ...capability(
        '更正本人任务的显示标题',
        ['不会改写已产生的任务执行和审计记录。'],
        [source('apps/orchestrator/src/trpc/routers/tasks.ts', '任务路由提供任务标题更新。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '任务执行控制不等同于数据处理暂停',
        [],
        [source('apps/orchestrator/src/trpc/routers/tasks.ts', '任务路由区分任务执行控制和删除。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对任务相关处理提出撤回申请',
        ['不会自动删除审计或人工保留记录。'],
        [source('apps/orchestrator/src/trpc/routers/tasks.ts', '任务删除流程会保留受限证据。')],
      ),
    },
  },
  {
    id: 'memory_self_service',
    export: {
      status: 'not_implemented',
      ...capability(
        '无自动记忆导出',
        ['尚未提供全面记忆导出。'],
        [source('apps/orchestrator/src/trpc/routers/memory.ts', '记忆路由仅提供列表和管理操作。')],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/memory.ts#memoryRouter',
      ...capability(
        '删除单条或清空本人记忆',
        [],
        [
          source(
            'apps/orchestrator/src/trpc/routers/memory.ts',
            '记忆路由提供单条删除和全部清空。',
          ),
        ],
      ),
    },
    correct: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/memory.ts#memoryRouter',
      ...capability(
        '删除不准确记忆后由后续交互建立更正内容',
        ['没有单独的原位编辑接口。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/memory.ts',
            '记忆路由通过用户范围删除移除不准确条目。',
          ),
        ],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '记忆条目没有独立暂停开关',
        [],
        [source('apps/orchestrator/src/trpc/routers/memory.ts', '记忆路由提供删除和清空控制。')],
      ),
    },
    withdraw: {
      status: 'not_applicable',
      ...capability(
        '删除记忆条目即为可用的控制方式',
        [],
        [source('apps/orchestrator/src/trpc/routers/memory.ts', '记忆路由提供用户自助清空。')],
      ),
    },
  },
  {
    id: 'astrology_local_self_service',
    export: {
      status: 'not_implemented',
      ...capability(
        '无服务器范围导出',
        ['星座资料在浏览器本地保存。'],
        [source('apps/web-workbench/src/lib/astrology.ts', '星座资料读取自浏览器 localStorage。')],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef: 'apps/web-workbench/src/lib/astrology.ts#clearAstroProfile',
      ...capability(
        '清除本地星座资料',
        ['仅清除当前浏览器资料，不清除浏览器外的其他本地副本。'],
        [
          source(
            'apps/web-workbench/src/lib/astrology.ts',
            'clearAstroProfile 删除本地存储的星座资料。',
          ),
        ],
      ),
    },
    correct: {
      status: 'implemented',
      handlerRef: 'apps/web-workbench/src/lib/astrology.ts#saveAstroProfile',
      ...capability(
        '更新本地星座资料',
        ['仅更新当前浏览器资料。'],
        [source('apps/web-workbench/src/lib/astrology.ts', 'saveAstroProfile 写入本地星座资料。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '本地资料没有独立处理暂停功能',
        [],
        [source('apps/web-workbench/src/lib/astrology.ts', '星座资料为浏览器本地存储。')],
      ),
    },
    withdraw: {
      status: 'not_applicable',
      ...capability(
        '清除本地资料可停止其后续使用',
        [],
        [source('apps/web-workbench/src/lib/astrology.ts', '本地资料可由用户清除。')],
      ),
    },
  },
  {
    id: 'stock_profile_self_service',
    export: {
      status: 'not_implemented',
      ...capability(
        '无全面股票偏好导出',
        ['尚未提供包含所有推断依据的导出。'],
        [
          source(
            'apps/orchestrator/src/stocks/stock-preference-repository.ts',
            '偏好仓储只提供加载和控制接口。',
          ),
        ],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef:
        'apps/orchestrator/src/stocks/stock-preference-repository.ts#clearStockPreferenceProfile',
      ...capability(
        '清空服务器股票偏好依据',
        ['不会删除自选股本身'],
        [
          source(
            'apps/orchestrator/src/stocks/stock-preference-repository.ts',
            '清空偏好会删除推断信号并重置手动偏好。',
          ),
        ],
      ),
    },
    correct: {
      status: 'implemented',
      handlerRef:
        'apps/orchestrator/src/stocks/stock-preference-repository.ts#updateStockPreferenceControls',
      ...capability(
        '更新手动股票偏好控制',
        ['不会改写既有自选股。'],
        [
          source(
            'apps/orchestrator/src/stocks/stock-preference-repository.ts',
            '偏好控制更新手动设置和启用状态。',
          ),
        ],
      ),
    },
    pause: {
      status: 'not_implemented',
      ...capability(
        '尚未提供停止股票偏好依据记录的处理暂停能力',
        [
          '现有开关只停止画像展示，不停止新筛选依据记录。',
          '清空画像可删除已记录的筛选依据，但不会删除自选股本身。',
        ],
        [
          source(
            'apps/orchestrator/src/stocks/stock-preference-repository.ts',
            '筛选信号写入不读取画像 enabled 开关；该开关只影响画像构建结果。',
          ),
          source(
            'apps/web-workbench/src/pages/PrivacyPage.tsx',
            '公开隐私说明明确暂停画像不会停止新筛选依据的记录。',
          ),
        ],
      ),
    },
    withdraw: {
      status: 'not_applicable',
      ...capability(
        '关闭推断或清空依据是可用控制方式',
        [],
        [
          source(
            'apps/orchestrator/src/stocks/stock-preference-repository.ts',
            '偏好控制支持关闭和清空。',
          ),
        ],
      ),
    },
  },
  {
    id: 'feedback_manual_request',
    export: {
      status: 'not_implemented',
      ...capability(
        '无自动反馈导出',
        ['尚未提供全面反馈导出。'],
        [source('apps/orchestrator/src/trpc/routers/feedback.ts', '反馈路由处理用户反馈提交。')],
      ),
    },
    delete: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可处理反馈提出删除申请',
        ['故障、安全或争议记录可能需要保留。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/feedback.ts',
            '反馈路由是反馈记录的处理证据。',
          ),
        ],
      ),
    },
    correct: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可处理反馈提出更正申请',
        ['历史故障和争议证据可能不能改写。'],
        [source('apps/orchestrator/src/trpc/routers/feedback.ts', '反馈路由记录用户提交内容。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '已提交反馈没有独立暂停功能',
        [],
        [source('apps/orchestrator/src/trpc/routers/feedback.ts', '反馈路由处理已提交反馈。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对反馈处理提出撤回申请',
        ['不影响撤回前处理或必要保留。'],
        [source('apps/orchestrator/src/trpc/routers/feedback.ts', '反馈路由是反馈处理的证据。')],
      ),
    },
  },
  {
    id: 'notification_self_service',
    export: {
      status: 'not_implemented',
      ...capability(
        '无全面通知配置导出',
        ['尚未提供自动导出。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/notifications.ts',
            '通知路由提供渠道管理而非导出。',
          ),
        ],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/notifications.ts#notificationChannelsRouter',
      ...capability(
        '删除本人通知渠道配置',
        ['已送达给收件人的副本不受 HOLA DAY 控制。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/notifications.ts',
            '通知渠道路由按用户范围删除渠道。',
          ),
        ],
      ),
    },
    correct: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/notifications.ts#notificationChannelsRouter',
      ...capability(
        '更新本人通知渠道配置',
        ['已送达给收件人的副本不受 HOLA DAY 控制。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/notifications.ts',
            '通知渠道路由支持更新渠道配置。',
          ),
        ],
      ),
    },
    pause: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/notifications.ts#notificationChannelsRouter',
      ...capability(
        '关闭本人通知渠道',
        ['关闭不撤回已发送通知。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/notifications.ts',
            '通知渠道更新支持 enabled 开关。',
          ),
        ],
      ),
    },
    withdraw: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/notifications.ts#notificationChannelsRouter',
      ...capability(
        '撤回渠道配置并停止后续发送',
        ['已送达给收件人的副本不受 HOLA DAY 控制。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/notifications.ts',
            '通知渠道可以由用户删除或关闭。',
          ),
        ],
      ),
    },
  },
  {
    id: 'extension_stats_manual_request',
    export: {
      status: 'not_implemented',
      ...capability(
        '无全面扩展统计导出',
        ['尚未提供自动导出。'],
        [
          source(
            'apps/orchestrator/src/browsing-history/service.ts',
            '服务处理扩展上传的站点统计快照。',
          ),
        ],
      ),
    },
    delete: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对服务器站点统计提出删除申请',
        ['没有自助服务器删除入口。'],
        [
          source(
            'apps/orchestrator/src/browsing-history/service.ts',
            '站点统计由服务器同步服务保存。',
          ),
        ],
      ),
    },
    correct: {
      status: 'not_applicable',
      ...capability(
        '站点统计快照不提供逐项更正',
        ['下次同步会以新的完整快照替换旧快照。'],
        [
          source(
            'apps/orchestrator/src/browsing-history/service.ts',
            '服务以完整同步快照替换旧记录。',
          ),
        ],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '停止未来同步通过撤回控制处理',
        [],
        [source('apps/extension/src/background/history-sync.ts', '扩展背景同步负责上传站点统计。')],
      ),
    },
    withdraw: {
      status: 'implemented',
      handlerRef: 'apps/extension/src/shared/storage.ts#clearAccessToken',
      ...capability(
        '停止未来扩展同步',
        ['不会自动删除此前已收到的服务器站点统计。'],
        [source('apps/extension/src/shared/storage.ts', '清除扩展登录令牌会阻止后续同步认证。')],
      ),
    },
  },
  {
    id: 'extension_cookie_mixed',
    export: {
      status: 'not_implemented',
      ...capability(
        '无 cookie 数据导出',
        ['尚未提供自动导出。'],
        [
          source(
            'apps/orchestrator/src/cookies/sync-service.ts',
            'cookie 同步服务处理待注入记录。',
          ),
        ],
      ),
    },
    delete: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对服务器已接收 cookie 数据提出删除申请',
        ['此前已收到的数据不会自动移除。'],
        [
          source(
            'apps/orchestrator/src/cookies/sync-service.ts',
            '同步服务处理服务器待注入 cookie。',
          ),
        ],
      ),
    },
    correct: {
      status: 'not_applicable',
      ...capability(
        'cookie 会话资料不提供逐项更正',
        ['应通过重新登录建立新的会话资料。'],
        [
          source(
            'apps/orchestrator/src/cookies/sync-service.ts',
            'cookie 同步服务处理浏览器会话资料。',
          ),
        ],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '停止后续发送通过撤回控制处理',
        [],
        [source('apps/extension/src/shared/storage.ts', '扩展可清除本地登录令牌。')],
      ),
    },
    withdraw: {
      status: 'implemented',
      handlerRef: 'apps/extension/src/shared/storage.ts#clearAccessToken',
      ...capability(
        '通过退出登录、停用或卸载扩展停止后续发送',
        ['此前已收到的数据不会自动移除。'],
        [source('apps/extension/src/shared/storage.ts', 'clearAccessToken 移除扩展本地登录令牌。')],
      ),
    },
  },
  {
    id: 'payment_restricted_request',
    export: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可提供支付资料提出导出申请',
        ['交易、税务、争议或法律限制可能缩小范围。'],
        [source('apps/orchestrator/src/db/schema/payments.ts', '支付表包含交易记录。')],
      ),
    },
    delete: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可处理支付资料提出删除申请',
        ['删除受交易、审计、税务和法律保留限制。'],
        [source('apps/orchestrator/src/db/schema/payments.ts', '支付表包含受限交易记录。')],
      ),
    },
    correct: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可处理支付资料提出更正申请',
        ['已结算交易和审计记录可能不能改写。'],
        [source('apps/orchestrator/src/db/schema/payments.ts', '支付表保存交易状态。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '已发生交易记录不能暂停处理',
        [],
        [source('apps/orchestrator/src/db/schema/payments.ts', '支付表记录已发生交易。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对后续非必要处理提出撤回申请',
        ['不影响已完成交易或法定保留。'],
        [source('apps/orchestrator/src/db/schema/payments.ts', '支付表包含已发生交易记录。')],
      ),
    },
  },
  {
    id: 'partner_restricted_request',
    export: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可提供合作伙伴资料提出导出申请',
        ['实名、账务、反欺诈、税务或争议限制可能缩小范围。'],
        [source('apps/orchestrator/src/db/schema/partner.ts', '合作伙伴表包含实名和账务记录。')],
      ),
    },
    delete: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可处理合作伙伴资料提出删除申请',
        ['删除受实名、账务、反欺诈、税务和争议保留限制。'],
        [source('apps/orchestrator/src/db/schema/partner.ts', '合作伙伴表保存受限记录。')],
      ),
    },
    correct: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可处理合作伙伴资料提出更正申请',
        ['已记账和风控记录可能不能改写。'],
        [source('apps/orchestrator/src/db/schema/partner.ts', '合作伙伴表包含账务和风控记录。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '已发生账务和风控处理不能暂停',
        [],
        [source('apps/orchestrator/src/db/schema/partner.ts', '合作伙伴表记录已发生处理。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对后续非必要处理提出撤回申请',
        ['不影响法定或争议处理所需记录。'],
        [
          source(
            'apps/orchestrator/src/db/schema/partner.ts',
            '合作伙伴表包含法定和争议相关记录。',
          ),
        ],
      ),
    },
  },
  {
    id: 'media_mixed_control',
    export: {
      status: 'not_implemented',
      ...capability(
        '无全面媒体资产导出',
        ['尚未提供跨功能的全面导出。'],
        [source('apps/orchestrator/src/db/schema/task-files.ts', '任务文件表承载媒体资产元数据。')],
      ),
    },
    delete: {
      status: 'implemented',
      handlerRef: 'apps/orchestrator/src/trpc/routers/video-onboarding.ts#videoOnboardingRouter',
      ...capability(
        '删除已有处理器覆盖的视频引导资产',
        ['仅限已有处理器证据的功能；其他媒体需人工申请。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/video-onboarding.ts',
            '视频引导路由提供特定资产的清理处理。',
          ),
        ],
      ),
    },
    correct: {
      status: 'not_applicable',
      ...capability(
        '媒体文件不提供通用原位更正',
        ['需按具体功能替换或重新上传。'],
        [source('apps/orchestrator/src/db/schema/task-files.ts', '任务文件表记录单独文件资产。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '媒体处理没有统一暂停控制',
        [],
        [source('apps/orchestrator/src/db/schema/task-files.ts', '媒体资产按功能分别处理。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对未覆盖媒体处理提出撤回申请',
        ['安全、授权或争议证据可能需要保留。'],
        [
          source(
            'apps/orchestrator/src/trpc/routers/video-onboarding.ts',
            '视频引导路由展示按功能处理资产。',
          ),
        ],
      ),
    },
  },
  {
    id: 'analytics_manual_request',
    export: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可归属分析资料提出导出申请',
        ['聚合记录或无法归属的记录可能无法导出。'],
        [
          source(
            'apps/orchestrator/src/energy/analytics-cleanup.ts',
            '能量分析清理处理分析记录生命周期。',
          ),
        ],
      ),
    },
    delete: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可归属分析资料提出删除申请',
        ['聚合或依法保留的记录可能不可归属或不可删除。'],
        [
          source(
            'apps/orchestrator/src/energy/analytics-cleanup.ts',
            '能量分析清理仅删除符合配置期限的记录。',
          ),
        ],
      ),
    },
    correct: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对可归属分析资料提出更正申请',
        ['聚合记录可能不能按个人更正。'],
        [source('apps/orchestrator/src/energy/analytics-cleanup.ts', '分析记录按清理流程管理。')],
      ),
    },
    pause: {
      status: 'not_applicable',
      ...capability(
        '聚合分析没有统一个人暂停控制',
        [],
        [source('apps/orchestrator/src/energy/analytics-cleanup.ts', '分析清理按记录期限执行。')],
      ),
    },
    withdraw: {
      status: 'manual',
      manualEntrypoint: PRIVACY_EMAIL,
      ...capability(
        '对后续可归属分析提出撤回申请',
        ['聚合或依法保留记录可能不能停止或删除。'],
        [
          source(
            'apps/orchestrator/src/energy/analytics-cleanup.ts',
            '分析记录由清理任务按类别管理。',
          ),
        ],
      ),
    },
  },
];
