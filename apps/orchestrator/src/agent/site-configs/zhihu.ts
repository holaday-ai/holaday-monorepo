import type { SiteConfig } from './types.js';

/**
 * 知乎 (zhihu.com) — Chinese Q&A community. Anonymous read for many
 * answers; full discussions / user profiles / following pages
 * require login. Has a "登录后查看更多" cut-off below long answers.
 *
 * Subdomain: passport.zhihu.com is the dedicated login page (already
 * caught by the global URL-host needle 'passport.').
 */
export const ZHIHU_SITE_CONFIG: SiteConfig = {
  siteId: 'zhihu',
  domains: ['zhihu.com'],
  requiresAuth: false,
  authNote:
    '知乎的部分回答 / 完整讨论 / 用户主页需要登录。浏览首页和单题部分内容通常不需要。',
  auth: {
    loginBodyPhrases: [
      '继续阅读',
      '登录后查看完整答案',
      '登录后查看更多',
      '请登录后查看',
      '阅读完整内容',
      '继续浏览',
      '免密登录',
      '使用知乎账号',
    ],
  },
  dismiss: {
    cookieBannerTexts: ['同意', 'Accept', '我同意'],
    popupDismissTexts: [
      '关闭',
      '稍后再说',
      '继续在网页中查看',
      '在网页打开',
      '暂不下载',
      '取消',
    ],
  },
};
