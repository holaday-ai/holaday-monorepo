/**
 * Lightweight-task classifier.
 *
 * Plain Q&A — simple arithmetic, greetings, short knowledge questions —
 * already routes to the non-browser `generate` lane, but the checklist
 * verifier (word_count min 10 + empty-result floor of 20 meaningful
 * chars) over-rejects a legitimately short answer: "1 加 1 等于几？" → "2"
 * gets flagged 结果内容不足 / 需要复核 and dropped into a fix loop.
 *
 * This pure classifier lets two call sites relax the verifier for those
 * intents WITHOUT re-routing anything and WITHOUT a new model/provider:
 *   - execution-contract `pickChecklistMinWordCount` → min 1
 *   - answer-verifier `checkEmptyResult` → a 1+ char answer passes
 *
 * It is deliberately conservative: any execution signal (URL, site,
 * interaction verb, search / current-data cue, file production) returns
 * null, so it never relaxes verification for a real web / action / file
 * task. Those tasks route to browser / scrape anyway; this only affects
 * the generate lane's leniency.
 */

export type LightweightKind = 'arithmetic' | 'greeting' | 'lightweight_knowledge';

const URL_OR_DOMAIN_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9.-]*\.(?:com|cn|net|org|io|ai|co|app|dev|gov|edu|me)\b/i;

// Interaction verbs that imply a browser action — must execute.
const INTERACTION_RE =
  /登录|登入|打开|访问|跳转|点击|下单|预订|预定|订票|订房|购买|下载|上传|提交|填写|填表|发帖|评论|点赞|关注|转发|收藏|扫码|支付|付款|加购|结算|比价|操作|开通|注册|退订|取消订阅|sign\s?in|log\s?in|open\s+https?|click|submit|book|order|checkout|download|upload/i;

// Search / current-data cues — need Firecrawl / live web.
const WEB_CURRENT_RE =
  /搜索|查找|查询|检索|查一下|查查|最新|今天|今日|现在|当前|实时|此刻|股价|股票|汇率|天气|气温|比分|赔率|新闻|头条|热搜|榜单|行情|现价|报价|latest|current|today|now|news|stock\s*price|weather/i;

// File-production cues — needs the create_file path, answer not trivial.
const FILE_RE =
  /生成|创建|导出|保存为|另存为|可下载|下载文件|\b(?:pdf|docx|xlsx|csv|pptx|md|markdown)\b\s*文件|文件\s*(?:供|可)?下载|做一?个?\s*(?:表格|文档|文件|报表)/i;

// Site / platform names that imply browsing a specific site.
const SITE_RE =
  /小红书|淘宝|天猫|京东|拼多多|抖音|快手|微博|知乎|b站|哔哩|美团|大众点评|携程|飞猪|boss直聘|google\s*(?:flights|hotels|maps|travel)|booking|airbnb|amazon|ebay|linkedin|github|youtube|twitter|facebook|instagram|reddit|wikipedia|gmail|outlook|notion|slack/i;

const GREETING_RE =
  /^(?:你好|您好|哈喽|哈罗|嗨|hi|hello|hey|yo|在吗|在不在|早上?好|中午好|下午好|晚上好|晚安|谢谢|多谢|感谢|thanks?|thank\s+you|good\s+(?:morning|afternoon|evening))[\s!！。.,，~、…]*$/i;

const ARITH_OP_RE =
  /[+\-*/×÷=]|加上?|减去?|乘以?|除以?|等于|相加|相减|相乘|相除|计算|算一?[下下]?|换算|plus|minus|times|divided|equals?/;

const CONVERSION_UNIT_RE =
  /摄氏|华氏|开尔文|公里|千米|英里|海里|千克|公斤|克|磅|盎司|英尺|英寸|厘米|毫米|加仑|升|celsius|fahrenheit|km|miles?|kg|pounds?|inch/i;

const QUESTION_RE =
  /[？?]\s*$|是什么|什么是|怎么(?:样|办|写|做|算)?|如何|为什么|为啥|含义|意思是?|区别|定义|解释一?下|what\s+is|how\s+(?:to|do|does)|why|explain/i;

/**
 * Returns the lightweight category of an intent, or null when it has any
 * web / action / file signal (those keep their normal verification).
 */
export function classifyLightweightTask(
  intent: string | null | undefined,
): LightweightKind | null {
  const text = (intent ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 200) return null;

  // Negative guards — any execution signal disqualifies.
  if (
    URL_OR_DOMAIN_RE.test(text) ||
    INTERACTION_RE.test(text) ||
    WEB_CURRENT_RE.test(text) ||
    FILE_RE.test(text) ||
    SITE_RE.test(text)
  ) {
    return null;
  }

  if (GREETING_RE.test(text)) return 'greeting';

  const hasDigit = /\d|[零一二三四五六七八九十百千万]/.test(text);
  if (text.length < 60 && hasDigit && ARITH_OP_RE.test(text)) return 'arithmetic';
  if (text.length < 60 && hasDigit && CONVERSION_UNIT_RE.test(text)) return 'arithmetic';

  if (text.length < 80 && QUESTION_RE.test(text)) return 'lightweight_knowledge';

  return null;
}
