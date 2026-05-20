import type { SiteConfig } from './types.js';

/**
 * 抖音电商罗盘 (compass.jinritemai.com) — ByteDance's seller-side
 * dashboard for live commerce analytics. Login wall on every path;
 * the homepage immediately renders the QR-code login form.
 *
 * Also covers other jinritemai.com seller subdomains.
 */
export const DOUYIN_COMPASS_SITE_CONFIG: SiteConfig = {
  siteId: 'douyin-compass',
  domains: [
    'compass.jinritemai.com',
    'fxg.jinritemai.com',
    'buyin.jinritemai.com',
  ],
  requiresAuth: true,
  authNote: '抖音电商罗盘需要商家账号登录。',
  auth: {
    loginUrlPaths: ['/passport', '/account/login'],
    loginBodyPhrases: [
      '商家登录',
      '达人登录',
      '机构登录',
      '请选择您的身份',
      '请使用抖音 App 扫码',
      '请使用抖音扫一扫',
      '抖音电商·罗盘',
      '抖音电商数据',
      '抖店账号',
    ],
  },
  dismiss: {
    cookieBannerTexts: ['同意'],
    popupDismissTexts: ['关闭', '我知道了', '稍后再说'],
  },
};
