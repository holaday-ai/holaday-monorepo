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
