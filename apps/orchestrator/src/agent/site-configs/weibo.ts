import type { SiteConfig } from './types.js';

/**
 * 微博 (weibo.com / weibo.cn / m.weibo.cn) — Sina Weibo, public
 * timeline microblogging. Most timelines / hashtag pages render
 * for unauthenticated users but show a "登录查看更多" banner that
 * limits scrolling. User profile interactions (follow / message)
 * require login.
 */
export const WEIBO_SITE_CONFIG: SiteConfig = {
  siteId: 'weibo',
  domains: ['weibo.com', 'weibo.cn'],
  requiresAuth: false,
  authNote:
    '微博的关注 / 私信 / 完整时间线需要登录；公开热搜和单条微博通常不需要。',
  auth: {
    loginUrlPaths: ['/visitor', '/login'],
    loginBodyPhrases: [
      '登录后查看更多',
      '登录后查看完整',
      '继续浏览',
      '使用微博账号',
      '微博账号登录',
      '请先登录',
    ],
  },
  dismiss: {
    cookieBannerTexts: ['同意', '接受所有', 'Accept'],
    // Codex P3 follow-up — drop generic '关闭' / '取消' and the
    // '继续访问' / '继续浏览' login-wall bypasses (same rationale as
    // xiaohongshu in f75a659 / taobao above: these match buttons the
    // model needs to SEE, not click past).
    popupDismissTexts: ['稍后再说', '不再提示', '暂不下载'],
  },
};
