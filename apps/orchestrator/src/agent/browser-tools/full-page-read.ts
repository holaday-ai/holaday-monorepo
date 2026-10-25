/**
 * FIX-36 #9 (BOSS 2026-10-25: 「默认就给 AI 完整的读页面。先将能力全部打开，再决定是否收紧」).
 * Whole-page read is the default: a login or payment popup no longer masks the page, and a
 * login popup over readable content is something to close, not a wall to hand over.
 * `BROWSER_FULL_PAGE_READ=false` restores the masks — a config change, no code change.
 * Typing credentials, solving captchas and unpaused writes stay forbidden either way.
 */
export function fullPageRead(): boolean {
  return process.env.BROWSER_FULL_PAGE_READ !== 'false';
}

/** The notice a login popup over a readable page leaves on the answer. */
export const LOGIN_POPUP_NOTICE =
  '页面弹出了登录提示（未登录、未输入任何信息），以下为页面公开内容。';

/** The signals of `collectSensitiveFieldValues` (observation-redaction.ts), as CSS. */
const SENSITIVE_WORDS = [
  'password',
  'passwd',
  'passcode',
  'otp',
  'cvv',
  'cvc',
  'card',
  'ssn',
  '密码',
  '验证码',
  '口令',
  '动态码',
  '校验码',
  '安全码',
];
const SENSITIVE_FIELDS = [
  'input[type="password" i]',
  ...['password', 'one-time-code', 'cc-'].map((token) => `[autocomplete*="${token}" i]`),
  ...['name', 'id', 'aria-label', 'placeholder'].flatMap((attr) =>
    SENSITIVE_WORDS.map((word) => `input[${attr}*="${word}" i],textarea[${attr}*="${word}" i]`),
  ),
].join(',');

/**
 * FIX-36 #9 (Codex P1 on PR #299): a full-page screenshot still never shows what is typed in a
 * password, one-time-code or card field. Applied only while the screenshot is taken (it
 * reaches inner frames and shadow roots), so the page itself is not touched.
 */
export const SENSITIVE_SCREENSHOT_STYLE = `:is(${SENSITIVE_FIELDS}){color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;background:#9e9e9e!important}`;
