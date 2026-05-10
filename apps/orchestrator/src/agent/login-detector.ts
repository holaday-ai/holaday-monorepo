/**
 * Phase 1 follow-up — deterministic login-page detector.
 *
 * The supercar agent loop currently relies on the LLM to recognise
 * a login wall and emit `[AWAITING_USER_INPUT]` so the dispatcher
 * parks the task. The model is right ~80-90% of the time — but the
 * remaining cases either:
 *   - silently treat the login page as the answer ("here's the URL
 *     of the page I reached"), or
 *   - try to bypass it and burn iterations.
 *
 * This module is a CHEAP keyword-only sanity check over the URL,
 * page title, and (optionally) prominent on-page text. When ANY
 * rule fires the agent loop forces an awaiting_user park with
 * `awaitingKind='login'`, regardless of what the LLM thought.
 *
 * Pure functions, no Playwright / Anthropic deps — easy to unit
 * test. Caller pulls page state and feeds it in.
 */

/**
 * URL substring patterns that strongly signal a login page. Path
 * substrings are checked case-insensitively. Domain check separately
 * — `passport.zhihu.com` is the login subdomain regardless of path.
 */
const LOGIN_URL_PATH_NEEDLES = [
  '/login',
  '/signin',
  '/sign-in',
  '/sign_in',
  '/log-in',
  '/log_in',
  '/auth',
  '/oauth',
  '/sso',
  '/passport',
  '/identity',
  '/account/login',
  '/user/login',
  '/users/sign_in',
  '/wp-login.php',
  '/admin/login',
];

const LOGIN_URL_HOST_NEEDLES = [
  'passport.',
  'login.',
  'signin.',
  'auth.',
  'sso.',
  'account.',
  'accounts.',
  'identity.',
];

/**
 * Page title keywords (any language). Title is the cheapest text
 * signal — Playwright's page.title() is sub-millisecond.
 */
const LOGIN_TITLE_NEEDLES = [
  // Chinese
  '登录',
  '登入',
  '注册',
  '验证码',
  '扫码',
  '二维码',
  '验证身份',
  '账号', // partial — matches "账号登录"
  // English
  'sign in',
  'log in',
  'login',
  'logon',
  'sign up',
  'authenticate',
  'verify',
];

/**
 * Body / button keywords. Stronger evidence: the page CORE has
 * login affordances. Used when caller provides DOM-extracted
 * prominent text. Same list as title keywords by design — if
 * the title says nothing useful but the page body has these,
 * it's still a login wall.
 */
const LOGIN_BODY_NEEDLES = LOGIN_TITLE_NEEDLES;

export interface LoginSignal {
  matched: boolean;
  source: 'url-path' | 'url-host' | 'title' | 'body' | 'none';
  match?: string;
}

/**
 * Inspect the URL alone. Cheapest check — host + path substring.
 * Pass the URL exactly as Playwright reports it (i.e. with scheme).
 */
export function detectLoginUrl(url: string | null | undefined): LoginSignal {
  if (!url) return { matched: false, source: 'none' };
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.host.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return { matched: false, source: 'none' };
  }
  for (const needle of LOGIN_URL_HOST_NEEDLES) {
    if (host.startsWith(needle) || host.includes(`.${needle}`) || host.startsWith(needle.slice(0, -1) + '.')) {
      return { matched: true, source: 'url-host', match: needle };
    }
  }
  for (const needle of LOGIN_URL_PATH_NEEDLES) {
    if (path.includes(needle)) {
      return { matched: true, source: 'url-path', match: needle };
    }
  }
  return { matched: false, source: 'none' };
}

/**
 * Inspect the page title. Cheap — Playwright's page.title()
 * resolves in <5ms on settled pages.
 */
export function detectLoginTitle(title: string | null | undefined): LoginSignal {
  if (!title) return { matched: false, source: 'none' };
  const lower = title.toLowerCase();
  for (const needle of LOGIN_TITLE_NEEDLES) {
    if (lower.includes(needle.toLowerCase())) {
      return { matched: true, source: 'title', match: needle };
    }
  }
  return { matched: false, source: 'none' };
}

/**
 * Inspect prominent on-page text (e.g. concatenated H1 + button
 * labels + tab titles). Caller decides what counts as "prominent"
 * — DON'T pass the full body, that's noisy and would false-match
 * an article that mentions "login" once.
 */
export function detectLoginBody(text: string | null | undefined): LoginSignal {
  if (!text || text.length < 2) return { matched: false, source: 'none' };
  const lower = text.toLowerCase();
  for (const needle of LOGIN_BODY_NEEDLES) {
    if (lower.includes(needle.toLowerCase())) {
      return { matched: true, source: 'body', match: needle };
    }
  }
  return { matched: false, source: 'none' };
}

export interface LoginCheckInputs {
  url?: string | null;
  title?: string | null;
  prominentText?: string | null;
}

/**
 * One-call front: checks URL, then title, then body. Returns the
 * first hit (URL > title > body order).
 */
export function detectLoginPage(inputs: LoginCheckInputs): LoginSignal {
  const urlHit = detectLoginUrl(inputs.url);
  if (urlHit.matched) return urlHit;
  const titleHit = detectLoginTitle(inputs.title);
  if (titleHit.matched) return titleHit;
  const bodyHit = detectLoginBody(inputs.prominentText);
  if (bodyHit.matched) return bodyHit;
  return { matched: false, source: 'none' };
}

/**
 * Friendly host label for the synthesised park question. Strips
 * `www.` and trims to the eTLD+1 when possible. Falls back to the
 * raw host on parse failure.
 */
export function friendlyHost(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Build the synthetic park question text shown to the user when
 * the deterministic detector forced a park.
 */
export function buildLoginParkQuestion(url: string | null | undefined): string {
  const host = friendlyHost(url);
  if (host) {
    return `当前页面（${host}）需要登录才能继续。完成登录后回复「已登录」我接着干。`;
  }
  return '当前页面需要登录才能继续。完成登录后回复「已登录」我接着干。';
}

// ---------------------------------------------------------------------------
// Phase 3 R1 — captcha + permission detection
// ---------------------------------------------------------------------------

/**
 * URL substrings that strongly signal a captcha / verification
 * challenge page. Distinct from login: the user is already
 * authenticated (or doesn't need to be), but the site is asking
 * them to prove they're human.
 */
const CAPTCHA_URL_PATH_NEEDLES = [
  '/captcha',
  '/verify',
  '/verification',
  '/challenge',
  '/recaptcha',
  '/hcaptcha',
  '/cf-challenge', // Cloudflare
  '/_validate',
  '/anti-bot',
];

const CAPTCHA_TITLE_NEEDLES = [
  '验证码',
  '滑动验证',
  '滑块',
  '拼图',
  '人机验证',
  'CAPTCHA',
  'captcha',
  "i'm not a robot",
  "i am not a robot",
  'verify you are human',
  'cloudflare',
  'security check',
  '安全检查',
  '安全验证',
];

const CAPTCHA_BODY_NEEDLES = CAPTCHA_TITLE_NEEDLES;

/**
 * URL / page signals for "you don't have permission" walls — distinct
 * from a login wall (login-only) and a captcha (prove-you're-human).
 * Permission walls fire on:
 *   - HTTP 403 status (caller passes it in via `httpStatus`).
 *   - URL paths like /403, /forbidden, /access-denied.
 *   - Page text mentioning "需要授权 / access denied / 付费会员 / VIP".
 */
const PERMISSION_URL_PATH_NEEDLES = [
  '/403',
  '/forbidden',
  '/access-denied',
  '/access_denied',
  '/permission-denied',
  '/no-access',
  '/restricted',
  '/paywall',
  '/membership',
  '/subscribe',
];

const PERMISSION_TITLE_NEEDLES = [
  // Chinese
  '需要授权',
  '没有权限',
  '没有访问权限',
  '权限不足',
  '付费会员',
  '会员专享',
  'VIP',
  '订阅会员',
  '需要订阅',
  '请先订阅',
  // English
  'access denied',
  'permission denied',
  'forbidden',
  '403',
  'subscription required',
  'subscribe to read',
  'paywall',
  'members only',
  'premium content',
];

const PERMISSION_BODY_NEEDLES = PERMISSION_TITLE_NEEDLES;

/**
 * Captcha detector. Same shape as the login detector — URL probe is
 * cheapest, title next, body last.
 */
export function detectCaptchaPage(inputs: LoginCheckInputs): LoginSignal {
  if (inputs.url) {
    let path: string | null = null;
    try {
      path = new URL(inputs.url).pathname.toLowerCase();
    } catch {
      /* swallow */
    }
    if (path) {
      for (const needle of CAPTCHA_URL_PATH_NEEDLES) {
        if (path.includes(needle)) {
          return { matched: true, source: 'url-path', match: needle };
        }
      }
    }
  }
  if (inputs.title) {
    const lower = inputs.title.toLowerCase();
    for (const needle of CAPTCHA_TITLE_NEEDLES) {
      if (lower.includes(needle.toLowerCase())) {
        return { matched: true, source: 'title', match: needle };
      }
    }
  }
  if (inputs.prominentText && inputs.prominentText.length >= 2) {
    const lower = inputs.prominentText.toLowerCase();
    for (const needle of CAPTCHA_BODY_NEEDLES) {
      if (lower.includes(needle.toLowerCase())) {
        return { matched: true, source: 'body', match: needle };
      }
    }
  }
  return { matched: false, source: 'none' };
}

export interface PermissionCheckInputs extends LoginCheckInputs {
  /**
   * HTTP status from the most recent navigation. 403 is the
   * authoritative signal for a permission wall; pass it in when
   * available so we don't have to read it off page text.
   */
  httpStatus?: number | null;
}

/**
 * Permission-wall detector. 403 status is the strongest signal
 * (always fires); URL / title / body match for sites that return
 * 200 with a "subscribe to read" page.
 */
export function detectPermissionWall(
  inputs: PermissionCheckInputs,
): LoginSignal {
  if (inputs.httpStatus === 403) {
    return { matched: true, source: 'url-host', match: 'http-403' };
  }
  if (inputs.url) {
    let path: string | null = null;
    try {
      path = new URL(inputs.url).pathname.toLowerCase();
    } catch {
      /* swallow */
    }
    if (path) {
      for (const needle of PERMISSION_URL_PATH_NEEDLES) {
        if (path.includes(needle)) {
          return { matched: true, source: 'url-path', match: needle };
        }
      }
    }
  }
  if (inputs.title) {
    const lower = inputs.title.toLowerCase();
    for (const needle of PERMISSION_TITLE_NEEDLES) {
      if (lower.includes(needle.toLowerCase())) {
        return { matched: true, source: 'title', match: needle };
      }
    }
  }
  if (inputs.prominentText && inputs.prominentText.length >= 2) {
    const lower = inputs.prominentText.toLowerCase();
    for (const needle of PERMISSION_BODY_NEEDLES) {
      if (lower.includes(needle.toLowerCase())) {
        return { matched: true, source: 'body', match: needle };
      }
    }
  }
  return { matched: false, source: 'none' };
}

/**
 * Build the synthetic park question for a captcha page. Different
 * copy from login because the action the user takes is different —
 * they need to solve the puzzle, not enter credentials.
 */
export function buildCaptchaParkQuestion(url: string | null | undefined): string {
  const host = friendlyHost(url);
  if (host) {
    return `当前页面（${host}）出现了人机验证（验证码 / 滑块 / 拼图）。请在浏览器中完成验证，回复「已验证」我接着干。`;
  }
  return '当前页面出现了人机验证（验证码 / 滑块 / 拼图）。请在浏览器中完成验证，回复「已验证」我接着干。';
}

/**
 * Build the synthetic park question for a permission wall. Login
 * alone won't help — the user needs an authorised account / VIP /
 * paid subscription. Different action: they need to switch context
 * or upgrade, not "log in".
 */
export function buildPermissionParkQuestion(
  url: string | null | undefined,
): string {
  const host = friendlyHost(url);
  if (host) {
    return `当前页面（${host}）需要账号权限或会员权限才能访问。请用有权限的账号在浏览器中打开后，回复「继续」我接着干。`;
  }
  return '当前页面需要账号权限或会员权限才能访问。请用有权限的账号在浏览器中打开后，回复「继续」我接着干。';
}

/**
 * Pick the appropriate park-question for a given awaitingKind.
 * Centralised so the agent-loop can call ONE function regardless of
 * whether the URL probe matched login / captcha / permission.
 */
export function buildAuthParkQuestion(
  kind: 'login' | 'captcha' | 'permission',
  url: string | null | undefined,
): string {
  switch (kind) {
    case 'login':
      return buildLoginParkQuestion(url);
    case 'captcha':
      return buildCaptchaParkQuestion(url);
    case 'permission':
      return buildPermissionParkQuestion(url);
  }
}
