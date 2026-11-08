/**
 * FIRECRAWL-1 — what a Firecrawl-fetched page says: its words without markdown
 * syntax, a compact copy for the model, page evidence for the completion-facts
 * check, and whether it is only a verification / login / block notice.
 * Shared by the scrape lane and the browser loop's read-only reader.
 */
import type { ObservedEvidence } from '../agent/browser-tools/completion-fields.js';

const MARKDOWN_LINK = /(?<!!)\[([^\]\n]{0,300})\]\((https?:\/\/[^)\s]+)[^)]*\)/g;
const MARKDOWN_IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;

/** The page's words without markdown syntax: links read as their text. */
export function plainText(markdown: string): string {
  return markdown
    .replace(MARKDOWN_IMAGE, '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[*+-]|>)\s+/gm, '')
    .replace(/\*\*|__|`/g, '');
}

/**
 * Markdown for the model: lines that are only navigation links (three or more
 * links and almost no other words) and images are dropped, so the page's own
 * text fits the per-source budget. Links inside sentences stay.
 */
export function compactMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => {
      const links = line.match(MARKDOWN_LINK)?.length ?? 0;
      const rest = line
        .replace(MARKDOWN_IMAGE, '')
        .replace(MARKDOWN_LINK, '')
        .replace(/[\s|·•,，、/]+/g, '');
      if (!rest && MARKDOWN_IMAGE.test(line)) return false;
      return !(links >= 3 && rest.length < 20);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Wording that only a verification, login or block notice uses. */
const WALL_RE =
  /验证码|安全验证|人机验证|请完成验证|验证一下|滑动验证|拖动滑块|登录后查看|请先登录|登录后继续|扫码登录|点击下方按钮登录|前往登录|登录查看更多|访问受限|访问被拒绝|请求可能存在威胁|已被拦截|访问过于频繁|当前环境异常|captcha|verify (?:that )?you are (?:a )?human|are you a robot|just a moment|access denied|enable javascript and cookies|sign in to continue|log in to continue|please (?:log|sign) in to (?:view|continue)|unusual traffic|request blocked/i;

/**
 * Challenge-page wording that no ordinary page carries (DEPLOY-29 review):
 * Cloudflare, PerimeterX, Imperva and Chinese risk-control notices. Near the
 * top of a page it is a wall whatever the page's length (long footers).
 */
const CHALLENGE_RE =
  /verifying you are human|review the security of your connection|checking your browser|attention required!?\s*\|?\s*cloudflare|you have been blocked|access to this page has been denied|pardon our interruption|完成验证后即可继续访问|当前环境异常|访问过于频繁，请稍后再试|please (?:log|sign) in to (?:view|see|continue)/i;

/**
 * A title that is only a verification / login / block notice ("京东验证",
 * "安全验证", "用户登录", "Security Check", "Sign in | Example", "Access Denied").
 * A title that merely mentions them ("登录页设计规范") is a page.
 */
const NOTICE_TITLE_HAN_RE = /^.{0,4}(?:验证|登录|登陆|拦截|访问受限)(?:中|一下|页)?$/u;
const NOTICE_TITLE_LATIN_RE =
  /^(?:[\w.]+\s+)?(?:security check|verification(?: required)?|verify|captcha|sign ?in|log ?in|access denied|blocked|just a moment)[.!…]*$/i;

/** The notice word of a title that is nothing but a notice (site name after |, -, _ dropped). */
function noticeTitle(title: string): RegExpExecArray | null {
  const head = title.split(/\s*[|_–—-]\s*/)[0]!.trim();
  return /\p{Script=Han}/u.test(head)
    ? NOTICE_TITLE_HAN_RE.exec(head)
    : NOTICE_TITLE_LATIN_RE.exec(head);
}

/**
 * FIRECRAWL-1 — a fetched "page" that is only a verification, login or block
 * notice: its title says so, challenge wording near its top, or a short page
 * with such wording. A long article that mentions 验证码 is not.
 */
export function scrapedWall(markdown: string, title?: string): string | null {
  const text = plainText(compactMarkdown(markdown)).replace(/\s+/g, ' ').trim();
  const challenge = CHALLENGE_RE.exec(text.slice(0, 1500));
  if (challenge) return challenge[0];
  const hit = WALL_RE.exec(text);
  const titleHit = title
    ? (CHALLENGE_RE.exec(title) ?? WALL_RE.exec(title) ?? noticeTitle(title))
    : null;
  // FIX-30 (DEPLOY-29 review #2): a title alone is a wall only on a page that
  // has little else — 「Captcha - Wikipedia」「两步验证」「Login - Wikipedia」 are articles.
  // Repeated boilerplate (a footer printed over and over) is not "else".
  const distinct = [...new Set(text.split(/(?<=[.!?。！？])\s*/))].join(' ');
  if (titleHit && (distinct.length < 600 || (hit && text.length < 600))) return titleHit[0];
  return hit && text.length < 600 ? hit[0] : null;
}

/**
 * FIX-60 P0-1: wording an error page shows in place of the page — a server error, 「请稍后重试」, a
 * missing page, a gateway or Cloudflare error. In a long article it is a topic (MDN's 404 page);
 * as most of a short page it is the page.
 */
const ERROR_PAGE_RE =
  /服务器(?:出现|出了|开)?(?:问题|错误|异常|小差)|服务(?:暂时)?不可用|系统(?:繁忙|异常|错误)|网络(?:不给力|异常|错误|开小差)|请稍后(?:重试|再试)|稍后再试|(?:页面|内容|视频|笔记|商品|文章)(?:不存在|找不到|走丢了?|已(?:被)?删除|已下架|加载失败|出错了?)|出错了|访问出错|\b(?:404|410)\b[^\n]{0,20}?(?:not found|page|页面|找不到)|page not found|this page (?:isn't|is not|could not be) (?:available|found)|\b50[0234]\b[^\n]{0,24}?(?:error|service|bad gateway|gateway|unavailable|internal)|internal server error|bad gateway|service (?:temporarily )?unavailable|gateway time-?out|\berror (?:code:? ?)?(?:5\d\d|10\d\d|52\d)\b|cloudflare ray id|\bray id\b|something went wrong|an error (?:has )?occurred|access denied/i;
/**
 * Wording only an error page carries (a Cloudflare error page, a web server's own 5xx page): near
 * the top of a page that is not long, it is the page whatever its explanation runs to.
 */
const STRONG_ERROR_RE =
  /\berror code:?\s*(?:5\d\d|10\d\d)\b|cloudflare ray id|\b(?:500 internal server error|502 bad gateway|503 service (?:temporarily )?unavailable|504 gateway time-?out)\b/i;
const STRONG_ERROR_HEAD = 600;
const STRONG_ERROR_MAX_TEXT = 2000;
/** An error status (any 4xx / 5xx that `wallStatus` does not already hand over as a wall). */
const ERROR_STATUS = (code: number | undefined) => code !== undefined && code >= 400;
/** A page that has little of its own to say: at most this much text outside links and images. */
const ERROR_PAGE_MAX_TEXT = 400;

/**
 * The page's own text: links (navigation, a recommended-video list beside a missing video) and
 * images taken out, repeated lines once.
 */
function ownText(markdown: string): string {
  const lines = markdown
    .replace(MARKDOWN_IMAGE, '')
    .replace(MARKDOWN_LINK, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*(?:[*+-]|>|\d+[.)])\s+/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
  return [...new Set(lines)].join('\n');
}

/**
 * FIX-60 P0-1 (DEPLOY-59 dy-1 / reg-dy-2: Douyin answered 「服务器出现问题 请稍后重试」 in place of the
 * video, beside a list of recommended videos): a fetched "page" that is an error page — an error
 * status, or a short page (its own text, links aside) whose title or text is an error message. The
 * scrape then has nothing to answer from: the cloud browser gets the page.
 * A long page that talks about errors (MDN's 404 article) is a page; so is a short page with no
 * error message.
 */
export function scrapedErrorPage(
  markdown: string,
  title?: string,
  statusCode?: number,
): string | null {
  if (ERROR_STATUS(statusCode) && !wallStatus(statusCode)) return `HTTP ${statusCode}`;
  const own = ownText(markdown);
  if (own.length <= STRONG_ERROR_MAX_TEXT) {
    const strong =
      STRONG_ERROR_RE.exec(own.slice(0, STRONG_ERROR_HEAD)) ??
      (title ? STRONG_ERROR_RE.exec(title) : null);
    if (strong) return strong[0];
  }
  if (own.length > ERROR_PAGE_MAX_TEXT) return null;
  const hit = ERROR_PAGE_RE.exec(own) ?? (title ? ERROR_PAGE_RE.exec(title) : null);
  return hit ? hit[0] : null;
}

/** Firecrawl's own reading of the target's answer: these statuses are walls, not pages. */
export function wallStatus(statusCode: number | undefined): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 429 || statusCode === 503;
}

/** Fetched markdown as the page evidence the completion-facts check reads. */
export function scrapedEvidence(source: {
  url: string;
  markdown: string;
  title?: string;
}): ObservedEvidence {
  const links = [...source.markdown.matchAll(MARKDOWN_LINK)].map((m) => ({
    text: m[1]!.trim(),
    url: m[2]!,
  }));
  return {
    text: `${source.title ? `${source.title}\n` : ''}${plainText(source.markdown)}`,
    sourceURL: source.url,
    ...(links.length ? { links } : {}),
  };
}
