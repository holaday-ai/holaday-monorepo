import type { CDPSession, Page } from 'playwright';

/**
 * CAPTCHA-UX-1: one detector for the captcha box on the page — used to zoom the screen onto it
 * (第 2 条) and to tell whether the verification is still to be done (协调方追加: the wall is judged
 * by the box on the page, not by the address — the reCAPTCHA demo page's own address contains
 * /recaptcha, so after it was passed the assistant waited out its 10 minutes).
 *
 * Reads geometry and whether a provider's response field is filled — never the page's text, and
 * the token itself never leaves the page (only its length is compared there).
 */

/** Frames served by a captcha provider (the box or its challenge). */
const CAPTCHA_FRAME_URL =
  /^https:\/\/(?:[\w-]+\.)*(?:(?:google|recaptcha)\.(?:com|net)\/recaptcha\/|hcaptcha\.com\/|challenges\.cloudflare\.com\/|(?:static|api)\.geetest\.com\/|(?:client-api\.)?arkoselabs\.com\/)/i;
export const CAPTCHA_FRAME_URL_SOURCE = CAPTCHA_FRAME_URL.source;
export function isCaptchaFrameUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && CAPTCHA_FRAME_URL.test(url);
}

export interface CaptchaBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CaptchaWidgetState {
  /** The page uses a captcha component this detector knows (a provider frame or response field). */
  known: boolean;
  /** Still to be done: a challenge (image grid) is open, or a visible box has no response yet. */
  unpassed: boolean;
  /** Where to zoom (CSS px of the viewport): the open challenge, else the box; null when passed. */
  box: CaptchaBoxRect | null;
}

/** Evaluated in the page's main document (a string, so CDP and Playwright run the same code). */
export const CAPTCHA_WIDGET_EXPRESSION = `(() => {
  const re = new RegExp(${JSON.stringify(CAPTCHA_FRAME_URL_SOURCE)}, 'i');
  const vw = innerWidth, vh = innerHeight;
  const seen = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const frames = [...document.querySelectorAll('iframe')].filter((f) => re.test(f.src || ''));
  const shown = [];
  for (const f of frames) {
    const r = f.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh || !seen(f)) continue;
    shown.push({ f, r, challenge: /\\/bframe|[?&#]frame=challenge/i.test(f.src || '') });
  }
  const fields = [...document.querySelectorAll('textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"],input[name="cf-turnstile-response"]')];
  const answered = fields.some((e) => (e.value || '').length >= 20);
  const challenge = shown.filter((x) => x.challenge).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
  const boxes = shown.filter((x) => !x.challenge).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  const unpassed = !!challenge || (boxes.length > 0 && !answered);
  const pick = challenge || (unpassed ? boxes[0] : null);
  return {
    known: frames.length > 0 || fields.length > 0,
    unpassed,
    box: pick ? { x: Math.round(pick.r.left), y: Math.round(pick.r.top), width: Math.round(pick.r.width), height: Math.round(pick.r.height) } : null,
  };
})()`;

function parse(value: unknown): CaptchaWidgetState | null {
  const v = value as Partial<CaptchaWidgetState> | null | undefined;
  if (!v || typeof v.known !== 'boolean' || typeof v.unpassed !== 'boolean') return null;
  const b = v.box;
  const box =
    b &&
    [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    b.width > 0 &&
    b.height > 0
      ? { x: b.x, y: b.y, width: b.width, height: b.height }
      : null;
  return { known: v.known, unpassed: v.unpassed, box };
}

/** The captcha component's state on a Playwright page; null when it cannot be read. */
export async function captchaWidgetState(page: Page): Promise<CaptchaWidgetState | null> {
  try {
    return parse(await page.mainFrame().evaluate(CAPTCHA_WIDGET_EXPRESSION));
  } catch {
    return null;
  }
}

/** The same, over a CDP session (the screencast's); null when it cannot be read. */
export async function captchaWidgetStateCdp(
  session: CDPSession,
): Promise<CaptchaWidgetState | null> {
  try {
    const evaluated = (await session.send('Runtime.evaluate', {
      expression: CAPTCHA_WIDGET_EXPRESSION,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return parse(evaluated.result?.value);
  } catch {
    return null;
  }
}
