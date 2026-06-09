import type { SiteConfig } from './types.js';

/**
 * 携程 (ctrip.com, incl. flights./hotels. subdomains) — China's
 * largest OTA. Flight / hotel search + list pages are browsable
 * WITHOUT login; only 预订 / 查看详细票价规则 / 我的订单 require it.
 * So requiresAuth is false (don't gate plain search), but we list the
 * login + 验证码 phrasing so an auth/captcha wall mid-task forces
 * awaiting_user instead of a hard failure — the user logs in once in
 * the panel and the task resumes.
 *
 * Booking actions (预订 / 去支付 / 提交订单) are NEVER taken by the
 * agent — that guard lives in the supercar system prompt; this config
 * only handles login-wall detection + popup dismissal.
 */
export const CTRIP_SITE_CONFIG: SiteConfig = {
  siteId: 'ctrip',
  domains: ['ctrip.com'],
  requiresAuth: false,
  authNote:
    '携程的预订 / 查看详细票价规则 / 我的订单需要登录；机票和酒店的搜索、列表、筛选通常无需登录。',
  auth: {
    loginUrlPaths: ['/login', '/passport', '/account/login', '/webapp/you/login'],
    loginBodyPhrases: [
      '请登录',
      '登录后继续',
      '立即登录',
      '扫码登录',
      '登录携程',
      '账号密码登录',
      '验证码登录',
      '手机号登录',
      '完成安全验证',
      '请完成验证',
      '拖动滑块',
    ],
  },
  dismiss: {
    cookieBannerTexts: ['同意', '全部接受', 'Accept all'],
    // Conservative: only true dismiss-noise buttons. No bare '关闭' /
    // '取消' (they collide with auth/captcha modals we want surfaced).
    popupDismissTexts: ['稍后再说', '不再提示', '暂不下载', '我知道了'],
  },
};
