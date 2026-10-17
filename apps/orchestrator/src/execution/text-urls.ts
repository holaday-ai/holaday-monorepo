/** URLs stop before CJK prose/typography, but may contain balanced path parentheses. */
export const TEXT_URL_RE =
  /https?:\/\/(?:[^\s,;'"<>\[\](){}`*\\\p{Script=Han}\u3000-\u303f\uff00-\uff65]|\([^\s,;'"<>\[\](){}`*\\\p{Script=Han}\u3000-\u303f\uff00-\uff65]*\))+/gu;

/** Keep a balanced parenthesis in a real path, dropping only prose punctuation. */
export function trimTextUrl(url: string): string {
  let value = url.replace(/[\].,;:，。]+$/, '');
  while (
    value.endsWith(')') &&
    (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
  ) {
    value = value.slice(0, -1);
  }
  return value;
}
