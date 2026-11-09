/**
 * FIX-60 P0-2: the language a request is written in — the answer follows the user's own words
 * this time, not the account's region (DEPLOY-59 单项 5: an English story request got a Chinese
 * story on production while the same request locally got English; nothing in the prompts said
 * which language to answer in).
 *
 * One function decides it for every lane, the prompts, the next-step suggestions and the failure
 * copy, front end and back end (复审 #1 #2):
 *  1. A language the user asks for in so many words wins: 「用英文回答」「answer in Chinese」.
 *  2. A translation is not answered 「all in one language」: the translation is in the target
 *     language, anything said around it in the language of the instruction (「翻译成英文：…」 is a
 *     Chinese instruction).
 *  3. Otherwise the request's main language, read from the user's own words: links, domains,
 *     code and quotes are content, not the request's language; so are product, brand and model
 *     names (「iPhone 16 Pro」「USB」「BestBuy」). A Chinese verb or particle (查、帮我、多少钱、
 *     是什么、吗、呢) makes it a Chinese sentence — 「帮我查 iPhone 16 Pro price」 is Chinese —
 *     unless English grammar plainly carries the sentence (「Write a story about a cat who asks
 *     为什么」); English grammar words (what, is, the, of) with no Chinese verb make it English
 *     (「What is 故宫's ticket price」). With neither, Han characters are weighed against English
 *     words.
 *  4. Only when nothing tells (numbers, a bare link) does the caller fall back to the region.
 */

export type ReplyLanguage = 'zh' | 'en';

export interface ReplyPlan {
  /** The language of the answer's own words (headings, notes, suggestions, failure copy). */
  language: ReplyLanguage;
  /** Why: the user asked for it, the request is written in it, or the account's region. */
  source: 'explicit' | 'request' | 'region';
  /** A translation request: the translation goes in `target` (null: the user did not say). */
  translation?: { target: string | null };
}

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

const ZH_NAMES = '英文|英语|英文版|English|中文|汉语|简体中文|繁体中文|普通话|Chinese';
const EN_NAMES = 'english|chinese|mandarin|simplified chinese|traditional chinese';
/** 「用英文回答」「请以中文写」「回答用英语」「全部用英文」「英文回答」 */
const EXPLICIT_ZH_RE = new RegExp(
  `(?:用|以|使用|改用|换成|全部用|全用|请用)\\s*(${ZH_NAMES})(?!\\s*(?:翻译|译))|(${ZH_NAMES})\\s*(?:回答|回复|作答|答复|输出)|(?:回答|回复|作答|答复|输出)\\s*(?:请|都|全部)?\\s*用\\s*(${ZH_NAMES})`,
  'i',
);
/** 「answer in English」「reply in Chinese please」「write it in English」「in English, please」 */
const EXPLICIT_EN_RE = new RegExp(
  `\\b(?:answer|reply|respond|write|explain|describe|summari[sz]e|tell me|say it)\\b[^.\\n]{0,30}?\\bin\\s+(${EN_NAMES})\\b|\\bin\\s+(${EN_NAMES})\\s*,?\\s*(?:please|pls)\\b|\\b(?:please\\s+)?use\\s+(${EN_NAMES})\\b`,
  'i',
);
/** 「翻译成英文」「译为中文」「translate this into English」「English translation」 */
const TRANSLATION_RE = /翻译|翻譯|译成|译为|譯成|\btranslat(?:e|es|ion|ing)\b/i;
const TRANSLATION_TARGET_RE =
  /(?:翻译|翻譯|译|譯)\s*(?:成|为|為|到)\s*([\p{Script=Han}A-Za-z]{1,6}?(?:文|语|語))|(?:用|成)\s*([\p{Script=Han}]{1,4}(?:文|语|語))\s*(?:翻译|翻譯)|\b(?:in)?to\s+(english|chinese|mandarin|japanese|korean|french|german|spanish|russian|italian|portuguese|arabic|thai|vietnamese|malay|indonesian)\b/iu;

/** Chinese verbs and particles that make a sentence Chinese (复审 #1 #2). */
const ZH_SIGNAL_RE =
  /帮我|帮忙|请帮|麻烦|多少|是什么|什么|怎么|怎样|如何|哪个|哪些|哪里|哪儿|哪家|为什么|一下|给我|告诉我|看看|有没有|是否|能不能|可不可以|列出|查询|查找|查一|搜索|搜一|[吗呢吧嘛](?=\s*(?:$|[？?！!。…~～]))|(?<!\p{Script=Han})(?:查|搜|找|买|看|写|在|用|把|给|帮|要|问|比|算)(?!\p{Script=Han})/u;
/** English grammar words: the sentence is built in English around them. */
const EN_GRAMMAR_WORDS =
  'the|a|an|is|are|was|were|be|do|does|did|what|which|who|whom|whose|where|when|why|how|of|for|to|in|on|at|from|with|about|into|and|or|but|please|can|could|would|should|will|me|my|our|your|you|it|its|this|that|these|those|there|i|we|they|them|any|some';
const EN_GRAMMAR_RE = new RegExp(`\\b(?:${EN_GRAMMAR_WORDS})\\b`, 'gi');
const EN_GRAMMAR_WORD_RE = new RegExp(`^(?:${EN_GRAMMAR_WORDS})$`, 'i');
/** Enough English grammar that it, not the Chinese verb, carries the sentence. */
const EN_GRAMMAR_CARRIES = 3;

/** The request's own words: links, domains, e-mail addresses, code and quotes taken out. */
function ownWords(text: string): string {
  return text
    .replace(CODE_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(DOMAIN_RE, ' ')
    .replace(QUOTED_RE, ' ');
}

/**
 * English words that are names, not the request's language: a model or size with a digit
 * (「256GB」「USB-C」 counts as the word it is with the digit stripped only when it has none), an
 * acronym (「USB」「TV」), a word with a capital inside (「iPhone」「BestBuy」「macOS」), and a
 * capitalised word that does not start a sentence (「Pro」「Max」「Hangzhou」).
 */
function languageWords(own: string): string[] {
  const words: string[] = [];
  for (const m of own.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)) {
    const token = m[0];
    if (/\d/.test(token)) continue;
    const word = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/.exec(token)?.[0];
    if (!word) continue;
    if (/^[A-Z]{2,}s?$/.test(word)) continue;
    if (/^[A-Za-z][a-z'’-]*[A-Z]/.test(word)) continue;
    if (/^[A-Z]/.test(word) && !EN_GRAMMAR_WORD_RE.test(word)) {
      const before = own.slice(0, m.index ?? 0);
      const startsSentence = !/\S/.test(before) || /[.!?。！？\n:：]\s*$/.test(before);
      if (!startsSentence) continue;
    }
    words.push(word);
  }
  return words;
}

/** The language the user asks the answer to be in, in so many words; null when they do not. */
export function explicitReplyLanguage(text: string): ReplyLanguage | null {
  const own = text.replace(CODE_RE, ' ').replace(URL_RE, ' ').replace(QUOTED_RE, ' ');
  if (TRANSLATION_RE.test(own)) return null;
  const zh = EXPLICIT_ZH_RE.exec(own);
  const en = EXPLICIT_EN_RE.exec(own);
  const named = (zh && (zh[1] ?? zh[2] ?? zh[3])) || (en && (en[1] ?? en[2] ?? en[3]));
  if (!named) return null;
  return /英|english/i.test(named) ? 'en' : 'zh';
}

/** A translation request and its target language (null: not said), or null when it is not one. */
export function translationRequest(text: string): { target: string | null } | null {
  const own = text.replace(CODE_RE, ' ').replace(URL_RE, ' ');
  if (!TRANSLATION_RE.test(own.replace(QUOTED_RE, ' '))) return null;
  const m = TRANSLATION_TARGET_RE.exec(own);
  const target = m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
  return { target: target ? target.trim() : null };
}

/** The instruction of a translation request: what comes before the text to translate. */
function translationInstruction(text: string): string {
  const colon = /[:：\n]/.exec(text);
  return colon && colon.index > 0 && colon.index <= 60 ? text.slice(0, colon.index) : text;
}

/** The language a request is written in, by its own words; null when its words do not tell. */
function writtenLanguage(text: string): ReplyLanguage | null {
  const own = ownWords(text);
  let han = (own.match(HAN_RE) ?? []).length;
  let words = languageWords(own).length;
  const zhSignal = ZH_SIGNAL_RE.test(own);
  const grammar = (own.match(EN_GRAMMAR_RE) ?? []).length;
  // Everything was quoted, linked or a name (「“Hello world” 翻译一下」 keeps 翻译一下; a request
  // that is only a quote or only a product name is read as it stands).
  if (!han && !words && !zhSignal && !grammar) {
    const bare = text.replace(URL_RE, ' ');
    han = (bare.match(HAN_RE) ?? []).length;
    words = (bare.match(WORD_RE) ?? []).length;
  }
  if (!han && !words && !grammar) return null;
  const byCount: ReplyLanguage = han >= Math.max(words, grammar) * HAN_PER_WORD ? 'zh' : 'en';
  if (zhSignal) return grammar >= EN_GRAMMAR_CARRIES && byCount === 'en' ? 'en' : 'zh';
  if (grammar && !han) return 'en';
  if (grammar) return byCount;
  if (!han) return 'en';
  if (!words) return 'zh';
  return byCount;
}

/** The language a request is written in (or asks for), or null when nothing tells. */
export function requestLanguage(text: string): ReplyLanguage | null {
  const explicit = explicitReplyLanguage(text);
  if (explicit) return explicit;
  return writtenLanguage(translationRequest(text) ? translationInstruction(text) : text);
}

/**
 * How to answer a request: its language (asked for, written in, or — only when nothing tells —
 * the account's region: a mainland account reads Chinese, any other English) and whether it is
 * a translation.
 */
export function replyPlan(text: string, region?: string | null): ReplyPlan {
  const translation = translationRequest(text);
  const explicit = explicitReplyLanguage(text);
  const written = explicit ?? writtenLanguage(translation ? translationInstruction(text) : text);
  const language = written ?? (region === 'cn' ? 'zh' : region ? 'en' : 'zh');
  return {
    language,
    source: explicit ? 'explicit' : written ? 'request' : 'region',
    ...(translation ? { translation } : {}),
  };
}

/** The language to answer in (see replyPlan). */
export function replyLanguage(text: string, region?: string | null): ReplyLanguage {
  return replyPlan(text, region).language;
}

/** Whether a request is written in English (the copy, the labels and the answer follow it). */
export function isEnglishRequestText(text: string): boolean {
  return requestLanguage(text) === 'en';
}

/**
 * The line every answering prompt ends with: which language this answer is in. Last in the
 * prompt so no earlier Chinese instruction or Chinese page text outweighs it. Takes the request
 * itself (and the region for when its words do not tell), or an already-decided language.
 */
export function replyLanguageRule(
  request: ReplyLanguage | ReplyPlan | string,
  region?: string | null,
): string {
  const plan: ReplyPlan =
    request === 'zh' || request === 'en'
      ? { language: request, source: 'request' }
      : typeof request === 'string'
        ? replyPlan(request, region)
        : request;
  if (plan.translation) {
    const target = plan.translation.target;
    return plan.language === 'en'
      ? `This is a translation request: write the translation itself in ${target ?? 'the language the user asked for'}; anything you say around the translation (a short note, if any) in English. Keep names and numbers as they are.`
      : `这是翻译任务：译文本身用${target ?? '用户要求的目标语言'}写；译文以外的说明（如果有）用中文。名称和数字照原样。`;
  }
  return plan.language === 'en'
    ? 'Answer language: English. The user wrote this request in English (or asked for English), so write the whole answer — headings, text, lists, notes, follow-up suggestions and failure explanations — in English, even though these instructions and the pages you read may be in Chinese. Keep names, titles, quotes and numbers exactly as the page shows them.'
    : '回答语言：中文。用户这次用中文提问（或要求用中文回答），整段回答（标题、正文、列表、说明、追问建议、失败说明）都用中文写；页面上的名称、标题、引文和数字照页面原样写，不翻译。';
}
