/**
 * FIX-60 P0-2: the language a request is written in — the answer follows the user's own words
 * this time, not the account's region (DEPLOY-59 单项 5: an English story request got a Chinese
 * story on production while the same request locally got English; nothing in the prompts said
 * which language to answer in).
 *
 * The request's main language decides: Han characters against English words, after dropping
 * what is content rather than the user's own words — links, domains, code and anything quoted
 * (「Playwright tutorial」 in a Chinese request is a search term, not the request's language).
 * A product or site name in a Chinese sentence (「在 BestBuy 搜 usb c cable」) does not make it
 * English; an English sentence with a Chinese word in it (「Write a story about 程序员」) stays
 * English. Only when nothing tells (numbers, a bare link) does the caller fall back.
 */

export type ReplyLanguage = 'zh' | 'en';

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const DOMAIN_RE =
  /\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|ai|cn|sg|co|uk|jp|de|tech|dev|app|edu|gov)(?:\/\S*)?/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;
/** Quoted content: CJK quotes and book-title marks, and straight / curly double quotes. */
const QUOTED_RE = /「[^」\n]*」|『[^』\n]*』|《[^》\n]*》|“[^”\n]*”|"[^"\n]*"/g;
const HAN_RE = /\p{Script=Han}/gu;
/** An English word: two letters or more (「usb c cable」 counts usb and cable, not c). */
const WORD_RE = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/g;
/**
 * One English word carries about as much as one and a half Han characters: a request is Chinese
 * when its Han characters reach one and a half times its English words.
 */
const HAN_PER_WORD = 1.5;

/** The request's own words: links, domains, e-mail addresses, code and quotes taken out. */
function ownWords(text: string): string {
  return text
    .replace(CODE_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(DOMAIN_RE, ' ')
    .replace(QUOTED_RE, ' ');
}

/** The language a request is written in, or null when its words do not tell. */
export function requestLanguage(text: string): ReplyLanguage | null {
  const own = ownWords(text);
  let han = (own.match(HAN_RE) ?? []).length;
  let words = (own.match(WORD_RE) ?? []).length;
  // Everything was quoted or linked (「“Hello world” 翻译一下」 keeps 翻译一下; a request that is only a
  // quote is read as it stands).
  if (!han && !words) {
    han = (text.replace(URL_RE, ' ').match(HAN_RE) ?? []).length;
    words = (text.replace(URL_RE, ' ').match(WORD_RE) ?? []).length;
  }
  if (!han && !words) return null;
  if (!han) return 'en';
  if (!words) return 'zh';
  return han >= words * HAN_PER_WORD ? 'zh' : 'en';
}

/**
 * The language to answer in: the request's own, and only when it does not tell, the account's
 * region (a mainland account reads Chinese; any other English).
 */
export function replyLanguage(text: string, region?: string | null): ReplyLanguage {
  return requestLanguage(text) ?? (region === 'cn' ? 'zh' : region ? 'en' : 'zh');
}

/** Whether a request is written in English (the copy, the labels and the answer follow it). */
export function isEnglishRequestText(text: string): boolean {
  return requestLanguage(text) === 'en';
}

/**
 * The line every answering prompt ends with: which language this answer is in. Last in the
 * prompt so no earlier Chinese instruction or Chinese page text outweighs it.
 */
export function replyLanguageRule(language: ReplyLanguage): string {
  return language === 'en'
    ? 'Answer language: English. The user wrote this request in English, so write the whole answer — headings, text, lists, notes, follow-up suggestions and failure explanations — in English, even though these instructions and the pages you read may be in Chinese. Keep names, titles, quotes and numbers exactly as the page shows them.'
    : '回答语言：中文。用户这次用中文提问，整段回答（标题、正文、列表、说明、追问建议、失败说明）都用中文写；页面上的名称、标题、引文和数字照页面原样写，不翻译。';
}
