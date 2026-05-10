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
