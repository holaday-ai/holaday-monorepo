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

const WALL_RE =
  /验证码|安全验证|人机验证|请完成验证|滑动验证|拖动滑块|登录后查看|请先登录|登录后继续|扫码登录|访问受限|访问被拒绝|请求可能存在威胁|已被拦截|captcha|verify (?:that )?you are (?:a )?human|are you a robot|just a moment|access denied|enable javascript and cookies|sign in to continue|log in to continue|unusual traffic|request blocked/i;

/**
 * FIRECRAWL-1 — a fetched "page" that is only a verification, login or block
 * notice (short, with such wording). A long article that mentions 验证码 is not.
 */
export function scrapedWall(markdown: string): string | null {
  const text = plainText(compactMarkdown(markdown)).replace(/\s+/g, ' ').trim();
  const hit = WALL_RE.exec(text);
  return hit && text.length < 600 ? hit[0] : null;
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
