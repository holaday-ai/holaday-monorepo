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
    // Codex P3 follow-up — drop generic '继续' from cookie banners.
    // Phishing warnings + auth gates share that label and clicking it
    // walks the user past the very wall we want them to see.
    cookieBannerTexts: ['我同意', '同意并继续', '接受', 'Accept'],
    // Codex P3 follow-up — drop generic '关闭' / '取消' / '继续访问'.
    // '关闭' matches every close-X in the modal forest including the
    // taobao app-download banner Chrome flashes briefly during nav,
    // which clicked away the captcha modal in P3_AUTH_003 reruns.
    // '取消' is a no-op on most modals but matches the "cancel order"
    // button on a checkout page if the model lands there. '继续访问'
    // is the chrome interstitial bypass for unsafe-site warnings — we
    // explicitly want those to surface, not auto-dismiss.
    popupDismissTexts: ['稍后再说', '不再提示', '暂不下载'],
  },
};
