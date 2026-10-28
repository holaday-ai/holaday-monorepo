import { declaredAbsentFields } from './browser-tools/completion-fields.js';

/**
 * Whether a scrape answer says it did not obtain what was asked (the browser then gets one
 * try). Kept apart from scrape-runner so it has no runtime dependencies beyond the fact
 * checks — the coordinator's fixtures run it on its own (FIX-37 复审 #1).
 */

// FIX-43 (local A/B reg-dy-2): 「页面没有加载出视频内容，显示的是"视频数据加载中"」 — the page itself
// never rendered; a side part not loaded (「评论区没有加载出来」「下方推荐内容没有加载出来」) is not
// this (DEPLOY-43 复审 #4): the page or the video has to open its clause.
// FIX-44 (local A/B dy-2 「页面显示"视频数据加载中"，没有加载出视频的实际内容」): the verb may open the
// clause too, when what it did not load is the page or the video itself, nothing after.
// FIX-35 复审 #1 (BENCH r06): 「抓取内容中…没有包含 RFC 9110 的标题和发布时间」 is 没拿到 too —
// only when the fetched content itself is what lacks it (复审 #2: 「根据抓取的 Node.js 发布页，
// …更新没有包含破坏性变更」 is an answer).
export const NOT_OBTAINED_RE =
  /(?:^|[。！？!?\n，,；;：:]|抓取(?:到)?的)\s*(?:整个)?(?:页面|网页|正文|视频(?:页面?|内容|数据|信息)?)[^。\n，,；;]{0,6}(?:没有|未能?)加载(?:出|完成)|(?:^|[。！？!?\n，,；;：:])\s*(?:没有|未能?)加载出(?:来)?(?:整个)?(?:页面|网页|正文|视频)的?(?:实际|任何|具体)?(?:内容|数据|信息)?(?=\s*(?:[。！？!?\n，,；;]|$))|无法读取任何|缺少浏览器(?:环境)?|需要(?:在)?(?:真实|云端)?浏览器(?:中|里)?(?:操作|打开|执行)|(?:无法|不能|没法)(?:在此|直接|在这里)?(?:填写|下载|操作|执行|交互|搜索)|没(?:能|有)?(?:拿到|获取到|读到|抓到)|没有(?:显示|展示|任何)(?:任何)?(?:商品|内容|信息|数据|结果)|未能(?:获取|读取|找到|抓取|拿到)|拿不到|无法获取|无法给出|(?:抓取|抓到)(?:的|到的)?(?:内容|结果|页面|数据)(?:里|中)[^。\n]{0,80}?(?:没有|并未|未)包含|(?:没有|并未|未)(?:包含|提供|列出|收录|涉及)[^，。；\n]{0,24}的(?:相关|具体|详细)?(?:条目)?(?:信息|内容|数据)(?!库)|(?:抓取|抓到)(?:到)?的?(?:内容|结果|页面|数据)(?:里|中)?(?:没有|不含|未包含|缺)|在抓取(?:到)?的?(?:内容|结果|数据)(?:里|中)缺失|(?:抓取|抓到)(?:到)?的?(?:页面)?(?:内容|结果|页面|数据)(?:里|中)[^。\n]{0,20}(?:缺失|空缺|丢失)|(?:不|无法|没有|未)执行浏览器操作|不是[^，。\n]{0,24}(?:搜索|检索)[^，。\n]{0,24}的?第[一1](?:条|个|名)|(?:抓取|抓到)(?:到)?的?(?:内容|结果|页面|数据)(?:里|中)[^。\n]{0,12}(?:没有|未)(?:显示|展示|出现)|(?:没法|无法|不能)(?:直接)?回答|\b(?:could not|couldn't|unable to)\s+(?:find|get|retrieve|access|read|fill|download)\b|\b(?:not|isn't|aren't) (?:included|shown|present|listed|available) in the (?:provided|fetched|scraped|crawled) (?:content|page|data|results?)\b|\bthe (?:fetched|provided|scraped|crawled) (?:content|page|data) (?:does not|doesn't) (?:include|contain|show)\b/i;
const NOT_SHOWN_RE =
  /^\s*(?:\*\*)?(?:页面未显示|未显示|未找到|没有找到|未获取到?|无法获取|没拿到|不详|未知|暂无|n\/a|not (?:shown|found|available))(?:\*\*)?[。.]?\s*$/i;

/**
 * FIX-30: the scrape answer itself says the fetched page did not have what was
 * asked — in its opening, or in at least half of its labelled fields.
 */
/** FIX-31: a short question after one value (「QQ音乐热歌榜第一名是啥」「上证指数现在多少点」). */
const ONE_VALUE_QUESTION_RE =
  /第一|第1|头条|多少|几|是啥|是什么|是谁|哪(?:一|个|张|天|年)?|\bwhat(?:'s| is)\b|\bhow (?:many|much)\b|\bwho\b|\bwhen\b/i;
/**
 * The answer turns to say the asked value itself is missing: 「…，但歌曲名称页面未显示」.
 * A side field (「3658点，成交额页面未显示」) or 缺失 as a topic word (「维生素D缺失」) is not.
 * FIX-33 (new-qq): 「但抓取到的页面内容中，第1名的歌曲名称缺失了」.
 */
const VALUE_MISSING_RE =
  /(?:但|不过|可惜|然而|只是|\bbut\b|\bhowever\b)[^。\n]{0,30}(?:(?:页面)?(?:未|没有|没)(?:显示|展示|获取到?|拿到|抓到|找到)|无法(?:确认|获取|确定)|缺失|空缺|丢失|not (?:shown|found|available))/i;

/**
 * FIX-33 (new-qq rerun: 「歌曲名称：页面未显示 … 歌曲标题没有加载出来，所以无法确认具体是哪首歌」):
 * the answer says it does not know which thing the answer is.
 */
export const IDENTITY_UNKNOWN_RE =
  /无法(?:确认|确定|判断|得知)(?:具体)?(?:是)?哪(?:一)?(?:首|个|本|部|家|款|位|条|篇|只|支)|(?:标题|歌名|曲名|名称|名字)(?:没有|未能?|并未)(?:被)?(?:加载|显示|渲染|读取)出来|\b(?:can(?:no|')t|unable to) (?:tell|confirm|determine) which\b/i;

/**
 * FIX-42 (Deploy-42 b-v06): 「无法确认第一名的具体歌名」 — a name it cannot tell. Only the asked one
 * counts (PR #305 review: 「第一名是《晴天》…无法确认专辑的标题」 has its answer), so it goes
 * through the same checks as an inline 「X未显示」.
 */
const UNKNOWN_NAME_RE =
  /无法(?:确认|确定|得知|知道)([^。！？!?\n，,；;]{0,12}?(?:歌名|曲名|歌曲名称|书名|片名|标题))/g;
/** DEPLOY-43 复审 #3: the name first — 「具体歌名无法确认」「第一名的歌名不确定」「歌名未确认」. */
const UNKNOWN_NAME_AFTER_RE =
  /([^。！？!?\n，,；;]{0,8}?(?:歌名|曲名|歌曲名称|书名|片名|标题|名称|名字))\s*(?:不确定|未确认|未能确认|无法确认|无法确定|无法得知)/g;
/** The phrase points at the asked name itself (「第一名的具体歌名」), not another one (「第二名的」「英文标题」). */
const ASKED_NAME_POINTER_RE = /具体|第\s*[一1]\s*名|榜首|冠军/;
const OTHER_NAME_POINTER_RE = /第\s*[二三四五六七八九十2-9]|英文|中文|原名|别名|副标题|另一/;

/** The label of the field that names the thing asked for. */
const NAME_LABEL_RE = /名称|歌名|曲名|标题|名字|书名|片名|\bname\b|\btitle\b/i;
/**
 * FIX-36 (Deploy-36 b-v06): 「页面未显示具体歌曲名称。」 as a sentence of its own, with no
 * 但/不过 in front. Only the asked kind of value counts (a name, title, price, level) — a side
 * field (「成交额页面未显示」) is not the answer missing.
 */
const STANDALONE_MISSING_RE =
  /(?:^|[。！？!?\n])\s*(?:\*\*)?(?:页面(?:上|中)?)?(?:未|没有|没)(?:被|能)?(?:显示|获取到?|读到|找到|列出|给出|抓取到?|抓到|读取到?|拿到|提取到?|加载出来)([^。！？!?\n]{0,24})/g;
/**
 * FIX-36 (Deploy-36 fc-jd): 「京东需要登录才能查看该商品页面，请你自己登录后告诉我继续」 — the
 * fetched page was a login wall. A wall is the browser's to hand over, not a completed answer.
 */
export const WALL_ANSWER_RE =
  /需要(?:你|您)?(?:先)?登录(?:后)?(?:才能|方可)|请(?:你|您)?(?:自己|先)?登录后|(?:遇到|是|被)(?:了)?(?:登录墙|验证墙|人机验证)|需要(?:完成)?(?:人机)?验证(?:后)?才能|\b(?:log ?in|sign in) (?:is )?required\b|\bplease (?:log ?in|sign in)\b/i;
/** The name first: 「歌曲名称页面未显示。」 as the whole sentence (local reg-new-qq). */
const STANDALONE_MISSING_AFTER_RE =
  /(?:^|[。！？!?\n])\s*(?:\*\*)?([^。！？!?\n，,；;]{1,24}?)(?:页面(?:上|中)?)?(?:未|没有)(?:被|能)?(?:显示|获取到?|读到|找到|列出|给出|抓取到?|抓到|读取到?|拿到|提取到?|加载出来)(?=\s*(?:[。！？!?\n]|$))/g;
/**
 * FIX-36 复审 #1 #6: the kinds of value a short question asks for. A missing value only counts
 * when the question asks for its kind, and the missing thing is that value itself — not one
 * of its side fields (「茅台股价 1500 元。页面未显示价格变化。」 has its answer).
 */
const ASKED_KINDS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [
    /名称|歌名|曲名|标题|名字|书名|片名|\bname\b|\btitle\b/i,
    /名称|歌名|曲名|标题|名字|书名|片名|什么歌|哪首|哪本|哪部|是什么|是啥|是谁|第一|第1|榜首|头条|\bname\b|\btitle\b|\bwhat\b|\bwhich\b/i,
  ],
  [/价格|股价|\bprice\b/i, /价格|股价|价|多少钱|\bprice\b|\bcost\b/i],
  [/点位|指数/, /点位|多少点|指数/],
  [/评分/, /评分|几分|多少分|\brating\b|\bscore\b/i],
];
const SIDE_FIELD_RE =
  /变化|走势|涨跌|涨幅|跌幅|历史|趋势|对比|明细|区间|单位|来源|时间|日期|备注|说明/;

/**
 * FIX-37 (Deploy-37 b-v06, verbatim 「第一名的**歌曲名称页面未显示**，只显示歌手是**许嵩**」): the
 * asked kind named right before 「（页面）未显示」, anywhere in a sentence — not only at its
 * start or end. The few characters before it are kept so a side field (「历史价格页面未显示」)
 * is still told apart.
 * FIX-42 (Deploy-42 b-v06, 「第一名的**歌曲名称未被抓取到**」): 未被抓取到 / 未能读取 / 没拿到 say the same.
 */
const INLINE_MISSING_RE =
  /([^。！？!?\n，,；;]{0,6}?(?:名称|歌名|曲名|标题|名字|书名|片名|价格|股价|点位|指数|评分|\bname\b|\btitle\b|\bprice\b))\s*[「『“"]?\s*(?:页面(?:上|中)?)?(?:未|没有|没)(?:被|能)?(?:显示|获取到?|读到|找到|列出|给出|抓取到?|抓到|读取到?|拿到|提取到?|加载出来)/gi;

/** A name that belongs to something else than the thing asked for (「专辑名称」「作者名字」). */
const SECONDARY_NAME_RE =
  /专辑|作者|歌手|演唱者|作词|作曲|导演|主演|出版社|公司|品牌|店铺|商家|卖家|频道|up主|作品集|系列|album|artist|author|brand|store|channel/gi;
/**
 * FIX-37 复审 #1: the asked thing given in quotes as the answer — 「第一名是《X》」「歌名：《X》」 —
 * not any quote anywhere (「歌手为「许嵩」」, 「页面只写了“热歌榜”」).
 */
const ANSWERED_NAME_RE =
  /(?:第[一1]名|榜首|冠军|排名第一的?|名称|歌名|曲名|标题|名字|书名|片名|歌曲|答案)(?:的?(?:是|为)|[：:])\s*[《「“『]([^》」”』]{1,60})[》」”』]/g;
/** A missing marker is no name (「歌曲名称「页面未显示」」). */
const MISSING_MARK_RE = /未显示|未获取|未读到|未找到|没有显示|无法(?:获取|确认)|不详|未知/;
/** A hedged name is a guess, not an answer (「可能是《X》（从飙升榜推测）」). */
const HEDGE_RE = /可能|推测|疑似|或许|大概|应该是|猜/;
/** DEPLOY-43 复审 #3: 「《晴天》（来自飙升榜）」 — a name taken from another chart than the asked one is a guess. */
const OTHER_CHART_RE = /(?:来自|取自|出自|摘自)\s*[^，。；）)\n]{0,10}?([\p{L}\d]{1,8}榜)/gu;
function hedged(answer: string, intent: string): boolean {
  if (HEDGE_RE.test(answer)) return true;
  return [...answer.matchAll(OTHER_CHART_RE)].some((m) => !intent.includes(m[1]!.slice(-3)));
}

/**
 * FIX-37 (Codex on PR #300 + 复审 #1): an inline 「X名称页面未显示」 is the asked value missing unless
 *  - X is something else than what was asked (「专辑名称」 for 「第一名是啥」; but not when the
 *    question asks for the album, the author, the company…), or
 *  - for a name, the answer already gives the asked thing itself (「第一名是《晴天》」) — never a
 *    guess (可能 / 推测…), never a missing marker in quotes.
 */
function inlineAskedValueMissing(missing: string, answer: string, intent: string): boolean {
  if (!askedValueMissing(missing, intent)) return false;
  const secondary = missing.match(SECONDARY_NAME_RE) ?? [];
  if (secondary.length) {
    // The question asks for exactly this (「专辑名称是什么」 → 「专辑名称页面未显示」).
    if (secondary.some((word) => intent.toLowerCase().includes(word.toLowerCase()))) return true;
    return false;
  }
  const isName = /名称|歌名|曲名|标题|名字|书名|片名|\bname\b|\btitle\b/i.test(missing);
  if (!isName || hedged(answer, intent)) return true;
  // DEPLOY-43 复审 #3: the chart's own name (「歌曲：《热歌榜》」) is no answered name.
  const answered = [...answer.matchAll(ANSWERED_NAME_RE)].some(
    (m) => !MISSING_MARK_RE.test(m[1] ?? '') && !intent.includes(m[1] ?? ''),
  );
  return !answered;
}

/**
 * DEPLOY-43 复审 #3: an answer saying the asked name itself is unknown (「第一名的具体歌名无法确认」,
 * front or back) is not answered by a 《name》 elsewhere; another name it cannot tell (「第二名的歌名」
 * 「英文标题」「专辑的标题」) goes through the inline checks.
 */
function unknownAskedName(phrase: string, answer: string, intent: string): boolean {
  if (!askedValueMissing(phrase, intent)) return false;
  if (
    ASKED_NAME_POINTER_RE.test(phrase) &&
    !OTHER_NAME_POINTER_RE.test(phrase) &&
    !(phrase.match(SECONDARY_NAME_RE) ?? []).length
  )
    return true;
  return inlineAskedValueMissing(phrase, answer, intent);
}

function askedValueMissing(missing: string, intent: string): boolean {
  if (SIDE_FIELD_RE.test(missing)) return false;
  return ASKED_KINDS.some(([kind, asked]) => kind.test(missing) && asked.test(intent));
}

export function answerNotObtained(answer: string, intent = ''): boolean {
  // Markdown emphasis (「**歌曲名称页面未显示**」) does not split a sentence (FIX-37 b-v06).
  const summary = answer.replace(/\*\*|__/g, '');
  if (NOT_OBTAINED_RE.test(summary.slice(0, 240))) return true;
  if (IDENTITY_UNKNOWN_RE.test(summary.slice(0, 600))) return true;
  if (WALL_ANSWER_RE.test(summary.slice(0, 240))) return true;
  // DEPLOY-43 复审 #3: the question names a chart, the answer's name comes from another one
  // (「第一名是《晴天》（取自飙升榜）」 for 热歌榜) — a guess about the asked chart, not its answer.
  if (
    /榜/.test(intent) &&
    [...summary.slice(0, 600).matchAll(OTHER_CHART_RE)].some(
      (m) => !intent.includes(m[1]!.slice(-3)),
    )
  )
    return true;
  // The one value asked for is the one the answer says it could not see (v06:
  // 「第一名的歌手是 A2O…，但歌曲名称页面未显示」): that is not an answer.
  if (
    intent.length > 0 &&
    intent.length < 60 &&
    ONE_VALUE_QUESTION_RE.test(intent) &&
    (VALUE_MISSING_RE.test(summary.slice(0, 300)) ||
      [
        ...summary.slice(0, 400).matchAll(STANDALONE_MISSING_RE),
        ...summary.slice(0, 400).matchAll(STANDALONE_MISSING_AFTER_RE),
      ].some((m) => askedValueMissing(m[1] ?? '', intent)) ||
      [...summary.slice(0, 400).matchAll(INLINE_MISSING_RE)].some((m) =>
        inlineAskedValueMissing(m[1] ?? '', summary, intent),
      ) ||
      [
        ...summary.slice(0, 600).matchAll(UNKNOWN_NAME_RE),
        ...summary.slice(0, 600).matchAll(UNKNOWN_NAME_AFTER_RE),
      ].some((m) => unknownAskedName(m[1] ?? '', summary, intent)))
  )
    return true;
  // FIX-36 (b-v06, as the browser's 0b): a field the user named (作者、点赞数…) given as
  // 「页面未显示」 is not obtained — the browser gets one try at the live page.
  if (intent && declaredAbsentFields(intent, summary).length) return true;
  const fields = summary
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
    .filter((line) => /^[^：:]{1,24}[：:]/.test(line));
  const empty = fields.filter((line) => NOT_SHOWN_RE.test(line.replace(/^[^：:]{1,24}[：:]/, '')));
  // FIX-33 (new-qq: 「歌手：A2O … 歌曲名称：页面未显示」 for 「热歌榜第一名」): when one thing
  // is asked for, its name missing is the answer missing (a side field like 成交额 is not).
  if (
    intent.length > 0 &&
    intent.length < 60 &&
    ONE_VALUE_QUESTION_RE.test(intent) &&
    empty.some((line) => NAME_LABEL_RE.test(line.replace(/[：:][\s\S]*$/, '')))
  )
    return true;
  return fields.length >= 2 && empty.length * 2 >= fields.length;
}
