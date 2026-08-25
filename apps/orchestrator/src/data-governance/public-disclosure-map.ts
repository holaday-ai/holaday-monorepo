import type { DataCategoryId, PublicDisclosureDefinition } from './types.js';

const LABELS = [
  ['account_security', '账号与安全'],
  ['task_execution', '任务与执行'],
  ['cross_task_memory', '跨任务 AI 记忆'],
  ['energy_astrology_profile', '今日能量星座资料'],
  ['stock_preference_profile', '股票偏好画像'],
  ['feedback_support', '反馈与支持'],
  ['external_notifications', '外部通知渠道'],
  ['extension_site_stats', '扩展常用网站'],
  ['extension_login_cookies', '扩展登录态'],
  ['payments_entitlements', '支付与套餐'],
  ['partner_kyc_ledger', '合伙人 KYC 与账本'],
  ['media_assets', '媒体素材'],
  ['analytics_logs', '分析与日志'],
] as const satisfies readonly (readonly [DataCategoryId, string])[];

const REQUIRED_BOUNDARIES: Record<DataCategoryId, string> = {
  account_security: '密码哈希',
  task_execution: '套餐天数只控制可见历史',
  cross_task_memory: '偏好可能长期保留',
  energy_astrology_profile: 'DivineAPI',
  stock_preference_profile: '90 天是推断窗口',
  feedback_support: 'Resend',
  external_notifications: 'webhook',
  extension_site_stats: '域名',
  extension_login_cookies: 'Cookie 名称、值',
  payments_entitlements: '按交易、税务、争议和适用法律所需保存',
  partner_kyc_ledger: '风险评分',
  media_assets: '声音克隆',
  analytics_logs: '匿名摘要',
};

export const publicDisclosures: readonly PublicDisclosureDefinition[] = LABELS.map(
  ([categoryId, spaLabel]) => ({
    categoryId,
    spaLabel,
    landingLabel: spaLabel,
    requiredBoundaries: [REQUIRED_BOUNDARIES[categoryId]],
    publiclyDisclosed: true,
  }),
);
