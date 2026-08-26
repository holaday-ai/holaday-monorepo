import type { DataCategoryId, ProcessorDefinition } from './types.js';

const CATEGORY_IDS: DataCategoryId[] = [
  'account_security',
  'task_execution',
  'cross_task_memory',
  'energy_astrology_profile',
  'stock_preference_profile',
  'feedback_support',
  'external_notifications',
  'extension_site_stats',
  'extension_login_cookies',
  'payments_entitlements',
  'partner_kyc_ledger',
  'media_assets',
  'analytics_logs',
];

export const processors: readonly ProcessorDefinition[] = [
  {
    id: 'holaday_internal',
    displayName: 'HOLA DAY',
    purposes: ['提供 HOLA DAY 平台服务'],
    categoryIds: CATEGORY_IDS,
    activation: {
      mode: 'always_internal',
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/index.ts',
          fact: '编排服务入口证明内部平台服务的运行边界。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    purposes: ['任务规划与跨任务记忆处理'],
    categoryIds: ['task_execution', 'cross_task_memory'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['ANTHROPIC_API_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/agent/planners/anthropic.ts',
          fact: 'Anthropic 任务规划器由配置密钥启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    purposes: ['任务执行响应生成'],
    categoryIds: ['task_execution'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['OPENAI_API_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/response-layer/openai-response-layer.ts',
          fact: 'OpenAI 响应层由配置密钥启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'google',
    displayName: 'Google',
    purposes: ['账号认证与任务、媒体生成'],
    categoryIds: ['account_security', 'task_execution', 'media_assets'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GEMINI_API_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/http.ts',
          fact: 'Google OAuth 配置支持账号认证流程。',
        },
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/agent/image/gemini-image-client.ts',
          fact: 'Gemini 图像客户端支持任务中的媒体生成。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'dashscope',
    displayName: 'DashScope',
    purposes: ['任务视频与媒体处理'],
    categoryIds: ['task_execution', 'media_assets'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['DASHSCOPE_API_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/agent/video/qwen-voice-clone-client.ts',
          fact: 'Qwen 声音克隆客户端由配置密钥启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'fal_ai',
    displayName: 'fal.ai',
    purposes: ['任务视频与媒体处理'],
    categoryIds: ['task_execution', 'media_assets'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['FAL_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/agent/video/fal-lipsync-client.ts',
          fact: 'fal.ai 口型同步客户端由配置密钥启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'divineapi',
    displayName: 'DivineAPI',
    purposes: ['星盘能量资料处理'],
    categoryIds: ['energy_astrology_profile'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['DIVINE_API_KEY', 'DIVINE_ACCESS_TOKEN'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/astrology/service.ts',
          fact: '占星服务由 DivineAPI 配置密钥或访问令牌启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'firecrawl',
    displayName: 'Firecrawl',
    purposes: ['任务执行中的网页抓取'],
    categoryIds: ['task_execution'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['FIRECRAWL_API_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/firecrawl/firecrawl-lane.ts',
          fact: 'Firecrawl 处理通道由配置密钥启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'apify',
    displayName: 'Apify',
    purposes: ['任务执行中的数据采集'],
    categoryIds: ['task_execution'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['APIFY_API_TOKEN'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/agent/supercar/adapters/apify.ts',
          fact: 'Apify 适配器由配置令牌启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'zapier',
    displayName: 'Zapier',
    purposes: ['任务执行中的自动化集成'],
    categoryIds: ['task_execution'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['ZAPIER_API_KEY', 'ZAPIER_WEBHOOK_PATH'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/agent/supercar/adapters/zapier.ts',
          fact: 'Zapier 适配器由密钥和 webhook 路径配置启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'resend',
    displayName: 'Resend',
    purposes: ['账号验证与反馈支持邮件'],
    categoryIds: ['account_security', 'feedback_support'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['RESEND_API_KEY'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/auth/email-code.ts',
          fact: '邮件验证码服务由配置密钥启用。',
        },
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/trpc/routers/feedback.ts',
          fact: '反馈路由只向邮件服务发送随机反馈编号，不发送正文、邮箱或账号标识。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'sms_gateway',
    displayName: 'Aliyun SMS Gateway',
    purposes: ['账号短信验证'],
    categoryIds: ['account_security'],
    activation: {
      mode: 'feature_conditional',
      configKeys: [
        'ALIYUN_SMS_URL',
        'ALIYUN_ACCESS_KEY_ID',
        'ALIYUN_ACCESS_KEY_SECRET',
        'ALIYUN_SMS_SIGN_NAME',
        'ALIYUN_SMS_TEMPLATE_CODE',
      ],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/trpc/routers/auth.ts',
          fact: '编排服务通过 ALIYUN_SMS_URL 调用短信网关。',
        },
        {
          kind: 'source_file',
          path: 'apps/cn-payment/src/sms.ts',
          fact: '短信适配器使用阿里云短信凭据发送和验证验证码。',
        },
        {
          kind: 'source_file',
          path: 'apps/cn-payment/src/config/env.ts',
          fact: '短信凭据名称在支付服务环境 schema 中定义。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'paypal',
    displayName: 'PayPal',
    purposes: ['支付与权益处理'],
    categoryIds: ['payments_entitlements'],
    activation: {
      mode: 'feature_conditional',
      configKeys: ['PAYPAL_ENABLED', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/payment/paypal.ts',
          fact: 'PayPal 支付处理由启用标记、客户端标识和客户端密钥共同配置。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'china_payment',
    displayName: 'China Payment Gateway',
    purposes: ['支付、权益与合作方账本处理'],
    categoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
    activation: {
      mode: 'feature_conditional',
      configKeys: [
        'WX_APPID',
        'WX_MCHID',
        'WX_API_V3_KEY',
        'WX_CERT_PATH',
        'WX_KEY_PATH',
        'ALIPAY_APPID',
        'ALIPAY_PRIVATE_KEY',
        'ALIPAY_PUBLIC_KEY',
        'ALIPAY_MODE',
      ],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/cn-payment/src/index.ts',
          fact: '中国支付服务入口承载支付网关集成。',
        },
        {
          kind: 'source_file',
          path: 'apps/cn-payment/src/wechat-pay.ts',
          fact: '微信支付适配器使用微信支付配置。',
        },
        {
          kind: 'source_file',
          path: 'apps/cn-payment/src/alipay.ts',
          fact: '支付宝适配器使用支付宝配置。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'wecom',
    displayName: 'WeCom',
    purposes: ['用户配置的外部通知'],
    categoryIds: ['external_notifications'],
    activation: {
      mode: 'user_configured',
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/notifications/webhook-sender.ts',
          fact: 'Webhook 发送器支持用户配置的企业微信通知。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'feishu',
    displayName: 'Feishu',
    purposes: ['用户配置的外部通知'],
    categoryIds: ['external_notifications'],
    activation: {
      mode: 'user_configured',
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/notifications/webhook-sender.ts',
          fact: 'Webhook 发送器支持用户配置的飞书通知。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'dingtalk',
    displayName: 'DingTalk',
    purposes: ['用户配置的外部通知'],
    categoryIds: ['external_notifications'],
    activation: {
      mode: 'user_configured',
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/notifications/webhook-sender.ts',
          fact: 'Webhook 发送器支持用户配置的钉钉通知。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'custom_webhook',
    displayName: 'Custom Webhook',
    purposes: ['用户配置的外部通知'],
    categoryIds: ['external_notifications'],
    activation: {
      mode: 'user_configured',
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/notifications/webhook-sender.ts',
          fact: 'Webhook 发送器支持用户配置的自定义通知。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'vultr',
    displayName: 'Vultr',
    purposes: ['平台托管与网络服务'],
    categoryIds: ['account_security', 'task_execution', 'analytics_logs'],
    activation: {
      mode: 'always_internal',
      evidence: [
        {
          kind: 'source_file',
          path: 'ops/vultr-nginx/holaday.conf',
          fact: 'Vultr Nginx 配置证明平台托管网络服务存在。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'cloudflare_r2',
    displayName: 'Cloudflare R2',
    purposes: ['任务与媒体文件存储'],
    categoryIds: ['task_execution', 'media_assets'],
    activation: {
      mode: 'feature_conditional',
      configKeys: [
        'STORAGE_PROVIDER',
        'R2_ENDPOINT',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
        'R2_REGION',
      ],
      evidence: [
        {
          kind: 'source_file',
          path: 'apps/orchestrator/src/files/storage-provider.ts',
          fact: 'R2 存储提供方由存储配置键选择并启用。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
  {
    id: 'aliyun',
    displayName: 'Aliyun',
    purposes: ['平台边缘网络服务'],
    categoryIds: ['account_security', 'analytics_logs'],
    activation: {
      mode: 'always_internal',
      evidence: [
        {
          kind: 'source_file',
          path: 'ops/aliyun-edge/nginx-hd-app.conf',
          fact: '阿里云边缘 Nginx 配置证明平台边缘网络服务存在。',
        },
      ],
    },
    regionStatus: 'unknown',
    legalReviewStatus: 'pending_legal_review',
  },
];
