/**
 * FIX-61 P1-7 (DEPLOY-60 dy-1): some sites lay a first-visit guide over the page — Douyin's
 * 「滚动“鼠标”或点按“键盘上下键”查看更多推荐视频 … 我知道了」 — and the run gave up behind it.
 * After a navigation, the guide's own acknowledgement button is pressed. Only on the listed
 * sites, only that button, and never inside anything that is about logging in, scanning a QR
 * code or a verification: those stay for the user.
 */
import type { Page } from 'playwright';

const GUIDES: ReadonlyArray<{ host: RegExp; texts: readonly string[] }> = [
  { host: /(?:^|\.)douyin\.com$/i, texts: ['我知道了'] },
];
const WAIT_MS = 2_000;
const POLL_MS = 250;

export async function dismissSiteGuide(page: Page, url = page.url()): Promise<string | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const guide = GUIDES.find((g) => g.host.test(host));
  if (!guide) return null;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const clicked = await page
      .evaluate((texts: readonly string[]) => {
        const off = /登录|扫码|验证|密码|手机号|log ?in|sign ?in|verify|captcha/i;
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span'),
        );
        for (const el of nodes) {
          const text = (el.innerText ?? '').trim();
          if (!texts.includes(text) || el.children.length > 1) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          // The box the button belongs to: the nearest ancestor holding more than the button's
          // own words (the guide's text, or a login dialog's).
          let near: HTMLElement | null = el.parentElement;
          for (
            let i = 0;
            i < 6 && near && (near.innerText ?? '').trim().length <= text.length + 4;
            i += 1
          )
            near = near.parentElement;
          if (near && off.test(near.innerText ?? '')) continue;
          el.click();
          return text;
        }
        return null;
      }, guide.texts)
      .catch(() => null);
    if (clicked || Date.now() >= deadline) return clicked;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
