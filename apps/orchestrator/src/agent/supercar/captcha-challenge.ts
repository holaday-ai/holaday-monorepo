import type { Page } from 'playwright';

/**
 * CAPTCHA-REDUCE-1 — what kind of challenge the user is about to face, a one
 * line hint for it, and the challenge brought to the middle of the page. It
 * only reads the page and scrolls; it never clicks, answers or solves anything.
 */
export type ChallengeKind =
  | 'recaptcha_image'
  | 'recaptcha_checkbox'
  | 'cloudflare'
  | 'hcaptcha'
  | 'text_captcha'
  | 'other';

export const CHALLENGE_HINTS: Record<ChallengeKind, string> = {
  recaptcha_image:
    '把所有符合题目的格子点掉；点过的格子会换新图，新图里还有也要点，直到没有了再点「VERIFY / 验证」。看不清可以点耳机图标改成语音题。',
  recaptcha_checkbox:
    '勾选「I’m not a robot / 进行人机身份验证」。如果弹出图片题，按题目点完所有符合的格子再点「VERIFY」。',
  cloudflare: '勾选「确认您是真人 / Verify you are human」，等几秒页面会自动继续。',
  hcaptcha: '按题目点选图片后点「验证」；题目刷新是正常的，照新题继续选。',
  text_captcha: '照图片里的字符输入后点继续；看不清可以换一张。',
  other: '在下方浏览器里按网站提示完成验证，完成后会自动继续。',
};

export interface ChallengeInfo {
  kind: ChallengeKind;
  hint: string;
}

/** Reads (and centers) the visible challenge; never throws. */
export const CHALLENGE_EXPRESSION = `(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const frames = [...document.querySelectorAll('iframe')].filter(vis);
  const pick = (re) => frames.find((f) => re.test(f.src || ''));
  const text = (document.body?.innerText || '').slice(0, 3000);
  let kind = 'other';
  let target = null;
  if ((target = pick(/recaptcha\\/(api2|enterprise)\\/bframe/))) kind = 'recaptcha_image';
  else if ((target = pick(/recaptcha\\/(api2|enterprise)\\/anchor/))) kind = 'recaptcha_checkbox';
  else if ((target = pick(/challenges\\.cloudflare\\.com/)) || /Verify you are human|Just a moment/i.test(text)) kind = 'cloudflare';
  else if ((target = pick(/hcaptcha\\.com/))) kind = 'hcaptcha';
  else if (/Enter the characters you see|Type the characters you see|输入.{0,6}字符/i.test(text)) kind = 'text_captcha';
  if (target) target.scrollIntoView({ block: 'center', inline: 'center' });
  return kind;
})()`;

export async function inspectChallenge(page: Page): Promise<ChallengeInfo> {
  const raw = String(await page.evaluate(CHALLENGE_EXPRESSION).catch(() => 'other'));
  const kind = (raw in CHALLENGE_HINTS ? raw : 'other') as ChallengeKind;
  return { kind, hint: CHALLENGE_HINTS[kind] };
}
