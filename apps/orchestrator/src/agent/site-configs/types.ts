/**
 * Phase 3 R2 — Site Skills (SiteConfig).
 *
 * Per-site config templates that augment the agent loop's behaviour
 * AFTER each navigation. NOT auto-learned — these are hand-curated
 * patterns based on observed user-facing behaviours of major Chinese
 * + Western sites we touch frequently:
 *   - cookie banners / GDPR popups → auto-dismiss so the agent's
 *     screenshot reflects the actual page content, not the banner
 *   - "建议下载 App" / age gate / "保存为 PWA" overlays → dismiss
 *   - login-wall keywords specific to each site (xiaohongshu's
 *     "扫码登录" widget text, taobao's "亲，请登录" prompt, etc.)
 *
 * Keep this file types-only. Implementation lives in
 *   - registry.ts        (lookup + match-by-url)
 *   - apply.ts           (post-nav side effects)
 *   - <siteId>.ts        (one file per site)
 */

export interface SiteAuthAugmentation {
  /**
   * Additional URL paths to consider as login walls. Concatenated
   * onto the global LOGIN_URL_PATH_NEEDLES list when the request's
   * host matches `domains`.
   */
  loginUrlPaths?: readonly string[];
  /**
   * Additional body-text phrases that signal a login wall on THIS
   * site specifically. Phrase-level (not single tokens) — same
   * convention as the global LOGIN_BODY_NEEDLES.
   */
  loginBodyPhrases?: readonly string[];
}

export interface SiteDismissPatterns {
  /**
   * Button / link visible text that should be clicked to dismiss a
   * popup overlay. Matched as substring against `innerText.trim()`,
   * so keep this short and SPECIFIC ("同意" matches "我同意" too —
   * fine; but "OK" would match "BOOK" too, avoid 1-2 char generics).
   *
   * Examples:
   *   - cookie banner: "同意" / "全部接受" / "Accept all"
   *   - 建议下载 App overlay: "稍后再说" / "暂不下载"
   *   - age gate: "已满18岁" / "I am over 18"
   */
  cookieBannerTexts?: readonly string[];
  ageGateTexts?: readonly string[];
  popupDismissTexts?: readonly string[];
}

export interface SiteConfig {
  /** Stable id, used in logs + registry lookup. */
  siteId: string;
  /**
   * Hostnames this config applies to. Matched as case-insensitive
   * `lowerHost === domain || lowerHost.endsWith('.' + domain)` so
   * `xiaohongshu.com` matches `www.xiaohongshu.com` and
   * `m.xiaohongshu.com` but NOT `evil.xiaohongshu.com.attacker.com`.
   */
  domains: readonly string[];
  /**
   * The site definitively requires authentication for non-trivial
   * use (i.e. landing pages serve only login). When true, the agent
   * loop's auth detector treats a bare-homepage hit as a login wall
   * even when no URL/title/body needles match — useful for sites
   * that gate everything behind a wall but show a generic shell on
   * the homepage.
   */
  requiresAuth: boolean;
  /**
   * Optional one-line guidance shown in the synthesised park
   * question (e.g. "小红书搜索需要登录"). Helps the user understand
   * why the agent stopped on a page that doesn't look gated.
   */
  authNote?: string;
  /** Site-specific auth detection extensions. */
  auth?: SiteAuthAugmentation;
  /** Site-specific popup / banner dismiss patterns. */
  dismiss?: SiteDismissPatterns;
}
