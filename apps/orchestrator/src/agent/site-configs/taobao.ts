import type { SiteConfig } from './types.js';

/**
 * 淘宝 / 天猫 (taobao.com / tmall.com) — Alibaba's consumer
 * marketplace. Browsing is partially open but cart / checkout /
 * search-with-personalisation requires login. The site uses the
 * "亲，请登录" prompt phrasing distinctively (Alibaba dialect).
 *
 * Note: taobao actively detects automation; many pages will show
 * "亲，访问异常" / sliding captcha. Captcha goes through the global
 * captcha detector; we list the phrasing here for body fallback
 * just in case the URL doesn't match.
 */
export const TAOBAO_SITE_CONFIG: SiteConfig = {
  siteId: 'taobao',
  domains: ['taobao.com', 'tmall.com', 'tmall.hk'],
  requiresAuth: false,
  authNote:
    '淘宝/天猫的下单 / 加购 / 个性化搜索需要登录。浏览公开列表通常不需要。',
  auth: {
    loginBodyPhrases: [
      '亲，请登录',
      '亲，请先登录',
      '请用淘宝账号登录',
      '使用淘宝账号登录',
      '免密登录',
      '同意协议并登录',
    ],
  },
  dismiss: {
    cookieBannerTexts: ['同意', '我同意', '接受', 'Accept', '继续'],
    popupDismissTexts: [
      '关闭',
      '取消',
      '稍后再说',
      '不再提示',
      '暂不下载',
      '继续访问',
    ],
  },
};
