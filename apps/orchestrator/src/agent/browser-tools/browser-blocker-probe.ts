/// <reference lib="dom" />
import type { Frame, Page } from 'playwright';
import { detectBrowserBlocker } from './browser-completion.js';

/** Only visible task surfaces can block. Raw text stays local to this probe. */
function collectSurface() {
  const visible = (el: Element) => {
    for (let item: Element | null = el; item; item = item.parentElement) {
      const s = getComputedStyle(item);
      if (
        s.display === 'none' ||
        s.visibility === 'hidden' ||
        s.visibility === 'collapse' ||
        Number(s.opacity) === 0
      )
        return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const excluded =
    'header,nav,footer,aside,[role="navigation"],[role="dialog"],[aria-modal="true"],dialog,#movie_player,#player,ytd-player';
  const text = (root: Element, exclude = false) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let length = 0;
    while (true) {
      const node = walker.nextNode();
      if (!node) break;
      const el = node.parentElement;
      if (
        !el ||
        !visible(el) ||
        el.closest('script,style,noscript') ||
        (exclude && el.closest(excluded))
      )
        continue;
      parts.push(node.textContent ?? '');
      length += (node.textContent ?? '').length;
      if (length > 50000) break;
    }
    return parts.join(' ').slice(0, 50000);
  };
  const hasAuthInput = (root: Element) =>
    Array.from(root.querySelectorAll('input')).some(
      (el) =>
        visible(el) &&
        (el.type === 'password' ||
          /one-time-code|current-password|new-password/.test(el.autocomplete)),
    );
  const readable = Array.from(
    document.querySelectorAll('article,main,[role="main"],ytd-search,ytd-item-section-renderer'),
  ).some(
    (el) =>
      visible(el) &&
      !hasAuthInput(el) &&
      text(el, true).trim().length >= 100 &&
      (el.matches('article,ytd-search,ytd-item-section-renderer') ||
        el.querySelectorAll('a[href],p').length >= 2),
  );
  const regions = Array.from(
    document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"],dialog[open],#movie_player,#player,ytd-player',
    ),
  )
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const value = text(el);
      const auth = hasAuthInput(el);
      const cookie = /cookie|consent|隐私|同意.*条款/i.test(value) && !auth;
      const player = el.matches('#movie_player,#player,ytd-player');
      const modal = el.getAttribute('aria-modal') === 'true' || el.matches('dialog[open]');
      const obstructs =
        player || modal || !readable || r.width * r.height >= innerWidth * innerHeight * 0.4;
      return {
        scope: player ? ('player' as const) : ('dialog' as const),
        text: value,
        blocking:
          !cookie &&
          obstructs &&
          r.width * r.height >= innerWidth * innerHeight * 0.015 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < innerHeight &&
          r.left < innerWidth,
      };
    });
  return {
    title: document.title,
    text: document.body ? text(document.body, true) : '',
    readable,
    regions,
  };
}
const EXPRESSION = `(() => { const __name = target => target; return (${collectSurface.toString()})(); })()`;

async function frameVisibility(frame: Frame) {
  let ratio = 1;
  let modal = false;
  for (let child: Frame | null = frame; child?.parentFrame(); child = child.parentFrame()) {
    const el = await child.frameElement();
    try {
      const state = await el.evaluate((node) => {
        const el = node as Element;
        for (let p: Element | null = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (
            s.display === 'none' ||
            s.visibility === 'hidden' ||
            s.visibility === 'collapse' ||
            Number(s.opacity) === 0
          )
            return { visible: false, ratio: 0, modal: false };
        }
        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        return {
          visible: w > 0 && h > 0,
          ratio: (w * h) / (innerWidth * innerHeight),
          modal: !!el.closest('[aria-modal="true"],dialog[open],[role="dialog"]'),
        };
      });
      if (!state.visible) return { visible: false, ratio: 0, modal: false };
      ratio *= state.ratio;
      modal ||= state.modal;
    } finally {
      await el.dispose();
    }
  }
  return { visible: true, ratio, modal };
}

export async function probeBrowserBlocker(page: Page) {
  let readableContent = false;
  for (const frame of page.frames()) {
    try {
      const visibility = await frameVisibility(frame);
      if (!visibility.visible) continue;
      const surface = (await frame.evaluate(EXPRESSION)) as ReturnType<typeof collectSurface>;
      const main = frame === page.mainFrame();
      if (main) readableContent = surface.readable;
      // Small helper frames and offscreen widgets are not task-blocking surfaces.
      const blockingFrame =
        main ||
        visibility.modal ||
        visibility.ratio >= 0.2 ||
        (!readableContent && visibility.ratio >= 0.015);
      if (!blockingFrame) continue;
      for (const region of surface.regions) {
        const hit = detectBrowserBlocker({
          url: frame.url(),
          title: '',
          text: region.text,
          visible: true,
          blocking: region.blocking,
          scope: region.scope,
        });
        if (hit) return hit;
      }
      const hit = detectBrowserBlocker({
        url: frame.url(),
        title: surface.title,
        text: surface.text,
        visible: true,
        blocking: true,
        readableContent: main && readableContent,
        scope: main ? 'document' : 'frame',
      });
      if (hit) return hit;
    } catch {
      if (frame === page.mainFrame())
        return { reason: 'page_unreadable', message: '无法确认当前页面状态，请重新读取后继续。' };
      // A detached/unreadable auxiliary frame supplies no evidence of a wall.
    }
  }
  return null;
}
