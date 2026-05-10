import type { SiteConfig } from './types.js';

/**
 * 小红书 (xiaohongshu.com) — content + lifestyle community.
 * Most search/browse paths are gated; the homepage shell renders
 * for unauthenticated users but search results / user profiles
 * require login. The PC site shows a "扫码登录" popup almost
 * immediately after landing.
 */
export const XIAOHONGSHU_SITE_CONFIG: SiteConfig = {
  siteId: 'xiaohongshu',
  domains: ['xiaohongshu.com'],
  requiresAuth: true,
  authNote: '小红书的搜索和详情页需要登录后才能查看。',
  auth: {
    loginBodyPhrases: [
      // "扫码登录" already in the global strict list, but xiaohongshu
      // has variants:
      '扫码登录小红书',
      '登录解锁更多内容',
      '登录解锁',
      '登录后查看更多',
      '没有账号？',
    ],
  },
  dismiss: {
    cookieBannerTexts: ['同意', '全部接受', 'Accept all'],
    // Phase 3 R2 follow-up — DO NOT include "继续访问" / "继续浏览"
    // here. xiaohongshu's login overlay has a "继续浏览" button that
    // dismisses the login wall and serves a guest-mode shell with no
    // real content. Clicking it (P3_AUTH_006 regression) lets the
    // model write a summary as if the page rendered fine, defeating
    // the auth detector. Only keep buttons that are unambiguously
    // about download-app prompts or cookie banners.
    popupDismissTexts: ['关闭', '稍后再说', '暂不下载'],
  },
};
