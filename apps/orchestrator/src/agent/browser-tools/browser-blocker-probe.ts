/// <reference lib="dom" />
import type { Frame, Page } from 'playwright';
import { detectBrowserBlocker } from './browser-completion.js';
import { canReadOutsideWall } from './browser-public-targets.js';
import { LOGIN_POPUP_NOTICE, fullPageRead } from './full-page-read.js';

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
  const localRegions =
    '#movie_player,#player,ytd-player,#comments,ytd-comments,[aria-label="Comments" i],[role="region"]';
  const excluded = `header,nav,footer,aside,[role="navigation"],[role="dialog"],[aria-modal="true"],dialog,${localRegions}`;
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
  // A content page without semantic landmarks (table layouts such as Hacker
  // News) is readable too: plenty of visible text and links, no sign-in field.
  // Challenge and login walls are short and nearly link-free.
  const plainReadable =
    !!document.body &&
    !hasAuthInput(document.body) &&
    text(document.body, true).trim().length >= 500 &&
    Array.from(document.querySelectorAll('a[href]')).filter(visible).length >= 20;
  const readable =
    plainReadable ||
    Array.from(
      document.querySelectorAll(
        'article,main,[role="main"],ytd-search,ytd-item-section-renderer,ytd-watch-metadata',
      ),
    ).some(
      (el) =>
        visible(el) &&
        !hasAuthInput(el) &&
        text(el, true).trim().length >= 100 &&
        (el.matches('article,ytd-search,ytd-item-section-renderer,ytd-watch-metadata') ||
          el.querySelectorAll('a[href],p').length >= 2),
    );
  const regionElements = Array.from(
    document.querySelectorAll(`[role="dialog"],[aria-modal="true"],dialog[open],${localRegions}`),
  ).filter(visible);
  // FIX-38 (Deploy-38 b-m01): Gaode's login popup is a plain full-screen fixed layer (no
  // role=dialog) with a smaller box in the middle — a popup all the same. The topmost layer
  // at the viewport's centre: fixed, covering most of it, stacked high (z-index ≥ 100) or
  // dimming the page, and holding a smaller box.
  let overlay: Element | null = null;
  const centre = document.elementsFromPoint(innerWidth / 2, innerHeight / 2)[0] ?? null;
  let inner = false;
  for (let el: Element | null = centre; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const area = r.width * r.height;
    if (s.position === 'fixed' && area >= innerWidth * innerHeight * 0.6) {
      const alpha = Number(s.backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? '1');
      if (inner && (Number(s.zIndex) >= 100 || (alpha > 0 && alpha < 1))) overlay = el;
      break;
    }
    if (area > 0 && area <= innerWidth * innerHeight * 0.5) inner = true;
  }
  // 复审 #1: a page's whole fixed shell is no popup — a popup lies over other visible content,
  // or says little (a login box: ≤ 400 characters).
  if (overlay) {
    const layer = overlay;
    const beneath = document
      .elementsFromPoint(innerWidth / 2, innerHeight / 2)
      .some(
        (el) =>
          el !== document.body &&
          el !== document.documentElement &&
          !layer.contains(el) &&
          !el.contains(layer),
      );
    if (!beneath && text(layer).trim().length > 400) overlay = null;
  }
  if (
    overlay &&
    !regionElements.some(
      (el) => el.contains(overlay as Element) || (overlay as Element).contains(el),
    )
  )
    regionElements.push(overlay);
  const regions = regionElements.map((el) => {
    const r = el.getBoundingClientRect();
    const value = text(el);
    const auth = hasAuthInput(el);
    // A login popup's own 「我已阅读并同意《服务条款》《隐私政策》」 line is no cookie banner
    // (FIX-38, Gaode).
    const cookie =
      !auth &&
      (/cookie|consent/i.test(value) ||
        (/隐私|同意.*条款/.test(value) && !/登录|注册|验证码|滑块|log ?in|sign ?in/i.test(value)));
    const player = el.matches('#movie_player,#player,ytd-player');
    const playerSurface =
      player ||
      !!el.closest(
        'yt-playability-error-supported-renderers#error-screen,yt-player-interstitial-renderer',
      );
    const comments = el.matches('#comments,ytd-comments,[aria-label="Comments" i]');
    const component = el.matches('[role="region"]');
    const modal =
      el === overlay || el.getAttribute('aria-modal') === 'true' || el.matches('dialog[open]');
    const obstructs =
      playerSurface ||
      comments ||
      component ||
      modal ||
      !readable ||
      r.width * r.height >= innerWidth * innerHeight * 0.4;
    return {
      scope: player
        ? ('player' as const)
        : comments
          ? ('comments' as const)
          : component
            ? ('component' as const)
            : ('dialog' as const),
      playerSurface,
      local:
        (playerSurface || comments || component) &&
        r.width * r.height < innerWidth * innerHeight * 0.8 &&
        !modal &&
        !el.closest('[aria-modal="true"],dialog[open]'),
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
  const primary =
    document.querySelector('ytd-watch-metadata') ??
    document.querySelector('main,[role="main"],article') ??
    document.body;
  const outside = primary ? text(primary, true) : '';
  const outsideElements = (selector: string) =>
    primary
      ? [
          ...(primary.matches(selector) ? [primary] : []),
          ...Array.from(primary.querySelectorAll(selector)),
        ].filter((el) => visible(el) && !el.closest(excluded))
      : [];
  const publicTargets = {
    title: outsideElements('h1').some((el) => text(el).trim().length > 0),
    channel: outsideElements(
      'a[href*="/@"],a[href*="/channel/"],a[href="#channel"],a[rel="author"],#channel-name a,#owner a,[itemprop="author"]',
    ).some((el) => text(el).trim().length > 0),
    views:
      /(?:[\d.,]+\s*[KMB万亿]?\s*(?:views|次观看|次播放|观看次数|播放量)|(?:观看|播放)\s*[：:]?\s*[\d.,]+)/i.test(
        outside,
      ),
    date: /(?:(?:one|two|three|an?)\s+(?:years?|months?|weeks?|days?|hours?)\s+ago|\d+\s*(?:years?|months?|weeks?|days?|hours?|[ymwdh])\s*ago|\d+\s*(?:年|个月|月|周|天|小时)前|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i.test(
      outside,
    ),
    description: outsideElements('p,#description').some((el) => text(el, true).trim().length >= 80),
    article: outsideElements('article').some((el) => text(el, true).trim().length >= 100),
  };
  return {
    publicTargets,
    challenge: Array.from(
      document.querySelectorAll('#challenge-form,#challenge-running,#cf-challenge-running'),
    ).some(visible),
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
  let local = false;
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
            return { visible: false, ratio: 0, modal: false, local: false };
        }
        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        return {
          visible: w > 0 && h > 0,
          ratio: (w * h) / (innerWidth * innerHeight),
          local: !!el.closest(
            '#movie_player,#player,ytd-player,#comments,ytd-comments,[aria-label="Comments" i],[role="region"]',
          ),
          modal: !!el.closest('[aria-modal="true"],dialog[open],[role="dialog"]'),
        };
      });
      if (!state.visible) return { visible: false, ratio: 0, modal: false, local: false };
      ratio *= state.ratio;
      modal ||= state.modal;
      local ||= state.local;
    } finally {
      await el.dispose();
    }
  }
  return { visible: true, ratio, modal, local };
}

/**
 * ACCEPT-283-R6: a navigation in progress (a redirect, a late location change)
 * destroys the context the probe runs in. That is not a page the user must
 * look at: read it again once it has loaded, and only then call it unreadable.
 */
export async function probeBrowserBlocker(page: Page, intent?: string) {
  const first = await probeOnce(page, intent);
  if (first?.reason !== 'page_unreadable') return first;
  await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {});
  return probeOnce(page, intent);
}

/**
 * FIX-36 #9: with whole-page read on, a login popup (dialog, a login frame outside any
 * component, or the page's own prompt) on a page that is not a login address (those hand over before this) is not a
 * wall — the AI closes it or reads behind it, and
 * asks for a takeover itself when the content truly needs one (a map canvas such as Gaode's
 * has little text, yet its routes are behind the popup). Captchas still hand over.
 */
function loginPopup(hit: NonNullable<ReturnType<typeof detectBrowserBlocker>>) {
  return fullPageRead() && hit.reason === 'login'
    ? { ...hit, disposition: 'continue' as const, message: LOGIN_POPUP_NOTICE }
    : null;
}

async function probeOnce(page: Page, intent?: string) {
  let readableContent = false;
  let targets: ReturnType<typeof collectSurface>['publicTargets'] | undefined;
  let localNotice:
    | (NonNullable<ReturnType<typeof detectBrowserBlocker>> & { disposition: 'continue' })
    | null = null;
  for (const frame of page.frames()) {
    try {
      const visibility = await frameVisibility(frame);
      if (!visibility.visible) continue;
      const surface = (await frame.evaluate(EXPRESSION)) as ReturnType<typeof collectSurface>;
      const main = frame === page.mainFrame();
      if (main) {
        readableContent = surface.readable;
        targets = surface.publicTargets;
        // Authoritative whole-page challenge/login endpoints never get a public-content exemption.
        const url = new URL(frame.url());
        const endpoint = detectBrowserBlocker({
          url: frame.url(),
          title: '',
          text: '',
          visible: true,
          scope: 'document',
        });
        if (
          endpoint &&
          (!readableContent ||
            endpoint.evidence.rule.includes(':url-host:') ||
            /^\/(?:login|signin|sign-in|sign_in|log-in|log_in|ServiceLogin|auth|oauth|sso|passport|captcha|recaptcha|hcaptcha|challenge|cf-challenge|verification|verify|account\/login|users?\/sign_in)(?:\/|\.|$)/i.test(
              url.pathname,
            ))
        )
          return endpoint;
        if (
          surface.challenge &&
          /cloudflare.*(?:security check|challenge)|^just a moment[.!…]*$/i.test(
            surface.title.trim(),
          )
        ) {
          const challenge = detectBrowserBlocker({
            url: frame.url(),
            title: surface.title,
            text: surface.text,
            visible: true,
            scope: 'document',
          });
          if (challenge) return challenge;
        }
        if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && /^\/sorry(?:\/|$)/.test(url.pathname))
          return detectBrowserBlocker({
            url: frame.url(),
            title: '',
            text: 'unusual traffic',
            visible: true,
            scope: 'document',
          });
      }
      // Small helper frames and offscreen widgets are not task-blocking surfaces.
      const blockingFrame =
        main ||
        visibility.modal ||
        (visibility.local && visibility.ratio >= 0.015) ||
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
        if (hit) {
          // A popup (dialog) only: a player / comments / component wall keeps its own rule —
          // continue when the target is readable outside it, hand over when it is the target.
          const popup = region.scope === 'dialog' ? loginPopup(hit) : null;
          if (popup) {
            localNotice = popup;
            continue;
          }
          if (
            region.local &&
            main &&
            readableContent &&
            targets &&
            canReadOutsideWall(intent, targets)
          ) {
            localNotice = {
              ...hit,
              disposition: 'continue',
              message: region.playerSurface
                ? // FIX-27: we never press play; whether the page autoplayed is the
                  // playback receipt's to say, not this notice's.
                  '播放器需登录验证，未主动播放，以下为页面公开信息。'
                : region.scope === 'comments'
                  ? '评论区需登录验证，未读取受限评论，以下为页面公开信息。'
                  : '局部组件需登录验证，未操作受限组件，以下为页面公开信息。',
            };
            continue;
          }
          return hit;
        }
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
      if (hit) {
        // The page itself, or a login frame over it (a modal, or any frame outside a player /
        // comments / region component — local f36v live-sh: eastmoney's login iframe).
        const popup = main || visibility.modal || !visibility.local ? loginPopup(hit) : null;
        if (popup) {
          localNotice = popup;
          continue;
        }
        if (
          !main &&
          visibility.local &&
          !visibility.modal &&
          visibility.ratio < 0.8 &&
          readableContent &&
          targets &&
          canReadOutsideWall(intent, targets)
        ) {
          localNotice = {
            ...hit,
            disposition: 'continue',
            message: '嵌入组件需登录验证，未操作受限组件，以下为页面公开信息。',
          };
          continue;
        }
        return hit;
      }
    } catch {
      if (frame === page.mainFrame())
        return { reason: 'page_unreadable', message: '无法确认当前页面状态，请重新读取后继续。' };
      // A detached/unreadable auxiliary frame supplies no evidence of a wall.
    }
  }
  return localNotice;
}
