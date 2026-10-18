import type { BrowserContext, Page } from 'playwright';

/**
 * FIX-27 (Deploy-26 core-03): a task that says 不播放 opened a YouTube watch
 * page, the video autoplayed, and the answer said 未播放. With such a
 * constraint every audio/video element in the task's browser context is kept
 * paused from the first script on (no click, no login, no player setting
 * changed), and what actually played is recorded as a receipt.
 */
export const NO_PLAYBACK =
  /不(?:要|准|许|用|必)?\s*播放|别\s*播放|禁止\s*播放|无需\s*播放|勿\s*播放|without\s+playing|(?:don'?t|do\s+not|never)\s+play|no\s+playback/i;

export function forbidsPlayback(intent: string | undefined): boolean {
  return !!intent && NO_PLAYBACK.test(intent);
}

/** One media element at the time of the receipt. */
export interface MediaPlayback {
  kind: 'video' | 'audio';
  paused: boolean;
  currentTime: number;
  /** Seconds covered by the element's `played` ranges. */
  playedSeconds: number;
  /** A `playing` event fired (it was paused right after). */
  everPlayed: boolean;
}

/** The playback-control receipt: what the pages' media actually did. */
export interface PlaybackReceipt {
  guarded: boolean;
  media: MediaPlayback[];
  /** Longest played time of any element, in seconds. */
  playedSeconds: number;
  /** Something is playing right now. */
  playing: boolean;
}

/** Runs before page scripts in every document of the context. */
export const PLAYBACK_GUARD_SCRIPT = `(() => {
  if (window.__hdPlayback) return;
  const state = { everPlayed: new WeakSet() };
  window.__hdPlayback = state;
  const hold = (media) => {
    try {
      media.autoplay = false;
      media.removeAttribute('autoplay');
      if (!media.paused) media.pause();
    } catch (_) {}
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    hold(this);
    return Promise.resolve();
  };
  state.originalPlay = play;
  document.addEventListener(
    'playing',
    (event) => {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      state.everPlayed.add(media);
      hold(media);
    },
    true,
  );
  const sweep = () => document.querySelectorAll('video, audio').forEach(hold);
  new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', sweep);
})();`;

const RECEIPT_EXPRESSION = `(() => {
  const state = window.__hdPlayback;
  return Array.from(document.querySelectorAll('video, audio')).map((media) => {
    let played = 0;
    try {
      for (let i = 0; i < media.played.length; i += 1) played += media.played.end(i) - media.played.start(i);
    } catch (_) {}
    return {
      kind: media.tagName.toLowerCase() === 'audio' ? 'audio' : 'video',
      paused: media.paused,
      currentTime: Number(media.currentTime) || 0,
      playedSeconds: Math.round(played * 100) / 100,
      everPlayed: !!state && state.everPlayed.has(media),
    };
  });
})()`;

/** Keep every page of the context paused; returns false when it could not install. */
export async function installPlaybackGuard(context: BrowserContext): Promise<boolean> {
  try {
    await context.addInitScript(PLAYBACK_GUARD_SCRIPT);
    // Pages already open (the start page) get it now too.
    await Promise.all(
      context.pages().map((page) => page.evaluate(PLAYBACK_GUARD_SCRIPT).catch(() => undefined)),
    );
    return true;
  } catch {
    return false;
  }
}

/** Read every page and frame of the context; null when nothing could be read. */
export async function readPlayback(
  context: BrowserContext,
  guarded: boolean,
): Promise<PlaybackReceipt | null> {
  const media: MediaPlayback[] = [];
  let read = false;
  for (const page of context.pages() as Page[])
    for (const frame of page.frames()) {
      try {
        media.push(...((await frame.evaluate(RECEIPT_EXPRESSION)) as MediaPlayback[]));
        read = true;
      } catch {
        /* A detached or cross-process frame: the rest still count. */
      }
    }
  if (!read) return null;
  return {
    guarded,
    media,
    playedSeconds: Math.max(0, ...media.map((m) => m.playedSeconds)),
    playing: media.some((m) => !m.paused),
  };
}

/** YouTube's own playback pings (Deploy-26 core-03): playback happened. */
export const PLAYBACK_PING = /youtube\.com\/api\/stats\/(?:playback|watchtime)\b/;

/** "未播放 / 没有播放 / did not play": a claim that nothing played. */
export function claimsNoPlayback(answer: string): boolean {
  return /(?:未|没有|没|不曾|未曾|并未|从未)\s*(?:主动\s*)?播放|(?:did\s+not|didn'?t|never)\s+play|not\s+played|no\s+playback/i.test(
    answer,
  );
}

/** "页面曾自动播放 X 秒，已暂停": the answer admits what autoplayed. */
export function admitsAutoplay(answer: string): boolean {
  return /(?:曾|有过|发生了?)\s*自动播放|自动播放(?:了|过|约)|曾(?:经)?播放|autoplayed|played\s+for/i.test(
    answer,
  );
}
