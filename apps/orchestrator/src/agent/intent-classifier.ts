/**
 * Phase 24 RC follow-up — three-route task execution classifier.
 *
 * Routes a user's task to one of three backends:
 *   - 'generate' — pure text generation, single Anthropic call. No
 *     web access. (Translation / SOPs / 方案 / pure analysis.)
 *   - 'scrape'   — needs page content but NOT live interaction.
 *     Firecrawl /scrape or /search returns markdown in 2-3s; the
 *     LLM then synthesises an answer from those bytes. (查询 /
 *     研究 / 对比 / "搜索 X 上的Y" / "分析 https://X".)
 *   - 'browser'  — needs to drive a live page (login, fill form,
 *     submit, click, multi-step flow). The expensive per-task
 *     BrowserPool path.
 *
 * Decision rules (priority order — first match wins):
 *
 *   1. Skill hint — unambiguous skill ids force a route.
 *   2. INTERACTION verb (登录/打开/下单/操作/提交/点击/填写/比价/...)
 *      → 'browser'. The agent is being asked to drive a live page.
 *   3. URL OR site name OR search/info verb → 'scrape'. The user
 *      wants info that lives on the web; Firecrawl is the cheap path.
 *   4. Otherwise → 'generate'.
 *
 * Keyword-only (no Anthropic call) — same cost-saving rationale as
 * the pre-Firecrawl two-route classifier.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

export type ExecutionMode = 'browser' | 'generate' | 'scrape';

interface CacheEntry {
  mode: ExecutionMode;
  source: string;
  at: number;
}

const CACHE = new Map<string, CacheEntry>();
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1_000;

function cacheKey(intent: string): string {
  return intent.trim().toLowerCase().slice(0, 280);
}

function cacheGet(key: string): CacheEntry | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  CACHE.delete(key);
  CACHE.set(key, entry);
  return entry;
}

function cacheSet(key: string, mode: ExecutionMode, source: string): void {
  CACHE.set(key, { mode, source, at: Date.now() });
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
    else break;
  }
}

export interface ClassifyOpts {
  intent: string;
  /**
   * Optional explicit skill id. Unambiguous skills short-circuit
   * the keyword pass. Ambiguous skills fall through.
   */
  skillId?: string;
  logger: Logger;
  /** Accepted for backwards-compat with the pre-RC Haiku-call signature. NOT invoked. */
  client?: Anthropic | null;
  model?: string;
  timeoutMs?: number;
}

/**
 * INTERACTION verbs — explicit asks to drive a live page. Substring
 * match (case-insensitive). Any one of these forces 'browser', even
 * when the intent ALSO matches a scrape signal (URL / site / search
 * verb). The user wants the agent to ACT on a page, not just read.
 */
const INTERACTION_VERBS: readonly string[] = [];

const INTERACTION_PATTERNS: readonly [RegExp, string][] = [
  [/(?:打开|访问|进入|前往|跳转到).{0,32}(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24}|网站|网页|页面|链接|后台|app|平台|京东|淘宝|天猫|拼多多|小红书|微博|知乎|抖音|b站|bilibili|github|linkedin|amazon|gmail)/i, '中文打开页面'],
  [/(?:点击|点开|按下|选择).{0,24}(?:按钮|链接|菜单|选项|标签|tab|继续|下一步|提交|登录|确认|购买|支付|下载|这个|这|该|它)/i, '中文点击控件'],
  [/(?:提交|填写|填表|填入|输入).{0,24}(?:表单|申请|订单|资料|信息|姓名|邮箱|地址|验证码|问卷|报名|简历|这个|这|该)/i, '中文表单操作'],
  [/(?:下载(?![量率])|保存).{0,24}(?:文件|图片|截图|报告|附件|pdf|csv|xlsx|表格|资料|这个|这|该)/i, '中文下载文件'],
  [/(?:操作).{0,24}(?:网页|页面|网站|后台|这个|这|该)/i, '中文页面操作'],
  [/(?:登录|登陆|登入)(?!页|率|流程|体验|文案|策略).{0,24}(?:账号|账户|后台|网站|平台|app|系统|淘宝|天猫|京东|拼多多|小红书|微博|知乎|抖音|b站|bilibili|github|linkedin|amazon|gmail|我的|这个|该)/i, '中文登录账号'],
  [/(?:帮我|给我|替我|为我)?下单(?!率).{0,24}(?:订单|商品|外卖|咖啡|奶茶|餐|票|这个|这|该|它|杯|份|个|件)/i, '中文下单'],
  [/(?:抓取(?!率).{0,24}(?:页面|网页|网站|数据|表格|列表|这个|这|该|链接|内容))/i, '中文抓取页面'],
  [/(?:(?:截图|截屏)(?!率).{0,24}(?:页面|网页|网站|屏幕|结果|证据|这个|这|该)|(?:给|帮我给|帮我|为).{0,16}(?:页面|网页|网站|这个|这|该).{0,12}(?:截图|截屏))/i, '中文截图页面'],
  [/(?:取消订阅(?!率).{0,24}(?:服务|邮件|会员|这个|这|该|它|账号|账户)|(?:点击|点).{0,12}取消订阅(?:按钮|链接)?)/i, '中文取消订阅'],
  [/(?:帮我|给我|替我|为我)?比价(?!率|策略|框架|方案|分析|报告|系统).{0,32}(?:商品|价格|平台|京东|淘宝|天猫|拼多多|amazon|航班|酒店|机票|bose|iphone|手机|耳机|电脑|相机|型号|这个|这|该|[a-z0-9][a-z0-9 -]{1,})/i, '中文比价执行'],
  [/\b(?:log\s+in|sign\s+in)(?!\s+(?:page|rate|flow|experience|copy|strategy))\s+(?:to|into|on)?\s*(?:my\s+|the\s+)?(?:account|dashboard|website|site|app|gmail|amazon|github|linkedin|reddit|youtube|instagram|tiktok|twitter|x\.com)\b/i, 'login to site'],
  [/\b(?:log|sign)\s+into\s+(?:my\s+|the\s+)?(?:account|dashboard|website|site|app|gmail|amazon|github|linkedin|reddit|youtube|instagram|tiktok|twitter|x\.com)\b/i, 'login to site'],
  [/\bsign\s+up\s+for\s+(?:this\s+)?(?:event|webinar|class|course|workshop|conference|account|trial|newsletter)\b/i, 'sign up for service'],
  [/\bsend\s+(?:an?\s+|this\s+)?(?:email|message|dm|direct message)(?!\s+(?:open rate|click rate|conversion|copy|strategy|analysis|report))\b/i, 'send message'],
  [/\b(?:open|visit|go to)\s+(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24}|(?:the\s+)?(?:website|webpage|page|link|dashboard|app|site)|(?:amazon|github|linkedin|gmail|reddit|youtube|instagram|tiktok|twitter|x\.com))\b/i, 'open page'],
  [/\b(?:open|visit|go to)\s+(?:the\s+)?(?:amazon|github|linkedin|gmail|reddit|youtube|instagram|tiktok|twitter|x\.com)(?:\s+(?:product|profile|page|site|listing|dashboard|app))*\b/i, 'open platform page'],
  [/\bnavigate\s+to\s+(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24}|(?:the\s+)?(?:website|webpage|page|link|dashboard|app|site)|(?:amazon|github|linkedin|gmail|reddit|youtube|instagram|tiktok|twitter|x\.com))\b/i, 'navigate to page'],
  [/\bclick\s+(?:the\s+|this\s+|that\s+)?(?:button|link|menu|tab|option|submit|continue|next|login|sign in|confirm|buy|pay|download)\b/i, 'click control'],
  [/\bsubmit\s+(?:the\s+|this\s+|that\s+)?(?:form|application|order|request|signup|registration|survey|resume|cv)\b/i, 'submit form'],
  [/\bfill\s+(?:in|out)\s+(?:the\s+|this\s+|that\s+)?(?:form|application|survey|signup|registration|questionnaire|field|input|profile|address|email|name|resume|cv)\b/i, 'fill form'],
  [/\b(?:use|open|visit|go\s+to)\s+(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24})\s+(?:to|and)\s+(?:calculate|compute|solve|evaluate)\b/i, 'use website calculator'],
  [/\b(?:use|open|visit|go\s+to)\s+(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24})\s+(?:to|and)\s+(?:create|edit|update|save|add|upload|generate|make|publish|schedule|fill\s+out)\b/i, 'use website app'],
  [/\b(?:in|on)\s+(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24})\s*,?\s+(?:create|edit|update|save|add|upload|generate|make|publish|schedule|fill\s+out)\b/i, 'domain-first app workflow'],
  [/\b(?:create|edit|update|save|add|upload|generate|make|publish|schedule|fill\s+out)\s+.{0,80}\b(?:draft|row|design|post|blog\s+post|image|page|profile|logo|poster|form|campaign|automation|document|record|task|issue|ticket|note|landing\s+page)\b.{0,40}\s+(?:in|on|to)\s+(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24})\b/i, 'action-first domain app workflow'],
  [/\bdownload\s+(?:the\s+|this\s+|that\s+)?(?:file|image|screenshot|report|attachment|pdf|csv|xlsx|spreadsheet|document)\b/i, 'download file'],
  [/(?!.*(?:订票(?:转化率|率|策略|框架|方案|分析|报告|系统)|订机票(?:转化率|率|策略|框架|方案|分析|报告|系统)|订酒店(?:转化率|率|策略|框架|方案|分析|报告|系统)|订餐(?:率|策略|框架|方案|分析|报告|系统)|预订(?:率|策略|框架|方案|分析|报告|系统)|预定(?:率|策略|框架|方案|分析|报告|系统)))(?<!制)(?:帮我|给我|替我|为我|在|到|去|用|通过)?(?:携程|去哪儿|飞猪|美团|大众点评|booking|airbnb)?(?:预订|预定|订票|订机票|订酒店|订餐|订|定)(?!率|策略|框架|方案|分析|报告|系统|页面).{0,24}(?:机票|航班|酒店|房间|民宿|餐厅|座位|车票|火车票|门票|票|会议室|今晚|明晚|今天|明天|后天|周[一二三四五六日天]|下周)/i, '中文预订服务'],
  [/(?<!制)(?:帮我|给我|替我|为我|在|到|去|用|通过)?(?:医院|平台|app|系统)?(?:预约|挂号)(?!率|流程|体验|文案|策略|分析|报告|系统).{0,24}(?:医生|牙医|门诊|科|服务|面试|会议|咨询|体检|维修|上门|时间|今天|明天|后天|周[一二三四五六日天]|下周)/i, '中文预约服务'],
  [/(?:帮我|给我|替我|为我)?报名.{0,24}(?:活动|课程|会议|讲座|班|workshop|webinar|conference)/i, '中文报名活动'],
  [/(?:帮我|给我|替我|为我)?投递.{0,24}(?:简历|岗位|职位|工作|job|role|position)/i, '中文投递职位'],
  [/(?:在|用|通过|打开|访问|进入|前往).{0,40}(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24}).{0,48}(?:计算|算一下|求值)(?!率|策略|分析|报告|模板)/i, '中文网站计算操作'],
  [/(?:在|用|通过|打开|访问|进入|前往).{0,40}(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,24}).{0,64}(?:创建|新建|编辑|更新|保存|添加|上传|生成|制作|发布|安排|预约|填写).{0,48}(?:草稿|海报|自动化|邮件|campaign|页面|landing page|表单|文档|项目|任务|帖子|图片|设计|邀请|日程|备注|工单|联系人|记录)/i, '中文域名应用操作'],
  [/(?:帮我|给我|替我|为我)?(?:发|发送|回复).{0,24}(?:邮件|消息|私信|短信|微信|email|gmail)(?!打开率|点击率|转化|文案|策略|分析|报告)/i, '中文发送消息'],
  [/(?:帮我|给我|替我|为我)?(?:把|将)?.{0,24}(?:加购|放进|加入|添加)(?!率|策略|分析|报告|方案).{0,24}(?:购物车|cart|这个|这|该|它|商品)/i, '中文加入购物车'],
  [/(?:帮我|给我|替我|为我)?(?:去)?(?:结账|结算)(?!页|率|流程|体验|策略|分析|报告|方案).{0,24}(?:订单|商品|购物车|这个|它)/i, '中文结算'],
  [/(?:帮我|给我|替我|为我|去)(?:付款|支付)|(?:付款|支付).{0,16}(?:订单|商品|费用|尾款|这个|它)/i, '中文支付'],
  [/(?:在|到|去)(?:小红书|微博|知乎|抖音|b站|bilibili|twitter|x\.com|linkedin|reddit|instagram|facebook|threads).{0,24}(?:发帖|评论|点赞|关注|发布)/i, '中文社交平台操作'],
  [/(?:发帖|评论|点赞|关注).{0,18}(?:这|该|那个|账号|帖子|笔记|视频|微博|动态|文章|post|tweet)/i, '中文社交对象操作'],
  [/(?:给|帮我给|替我给|为).{0,24}(?:评论|点赞|关注)/i, '中文社交互动'],
  [/(?:在|到|去|用|通过).{0,24}(?:携程|去哪儿|飞猪|google flights|airbnb|booking|linkedin).{0,72}(?:筛选|排序|选择|勾选|切换|设置|保存筛选|保存条件|收藏|付款前|支付前|确认前|提交前|停在)/i, '中文站内筛选保存'],
  [/(?:在|用|通过).{0,24}(?:gmail|slack|linkedin|notion|飞书|github|google docs|google forms|google sheets|google slides|google calendar|hubspot|salesforce|stripe(?:\s+dashboard)?|calendly|trello|asana|jira|shopify|zendesk|intercom|linear|monday(?:\.com)?).{0,64}(?:写|撰写|起草|创建|新建|编辑|更新|查找|搜索|下载|安排|预约|添加|保存|回复).{0,48}(?:草稿|邮件|消息|页面|文档|会议纪要|计划|报名表|表单|帖子|表格|演示文稿|幻灯片|会议|日程|邀请|联系人|客户|备注|付款|收据|链接|看板|任务|bug|issue|pull request|pr|折扣码|工单|回复|用户|项目|订单|商品|库存)/i, '中文应用草稿操作'],
  [/(?:打开|进入|访问|前往).{0,24}(?:hubspot|salesforce|stripe(?:\s+dashboard)?|calendly|trello|asana|jira|shopify|zendesk|intercom|linear|monday(?:\.com)?).{0,64}(?:写|撰写|起草|创建|新建|编辑|更新|查找|搜索|下载|安排|预约|添加|保存|回复).{0,48}(?:草稿|联系人|客户|备注|付款|收据|链接|看板|任务|bug|issue|折扣码|工单|回复|用户|项目|订单|商品|库存)/i, '中文打开应用后操作'],
  [/\bbook\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:flight|ticket|hotel|room|table|restaurant|appointment|ride|car|train|bus)\b/i, 'book service'],
  [/\breserve\s+(?:a\s+|an\s+|the\s+)?(?:table|room|seat|ticket|hotel|restaurant|car)\b/i, 'reserve service'],
  [/\bmake\s+a\s+reservation\s+(?:for|at|with)\s+(?:a\s+|an\s+|the\s+|this\s+)?(?:restaurant|table|hotel|room|flight|ticket|car|service|dinner|lunch|brunch)\b/i, 'make reservation'],
  [/\bschedule\s+(?:a\s+|an\s+|the\s+)?(?:appointment|meeting|call|visit|consultation|interview)\b/i, 'schedule appointment'],
  [/\bschedule\s+.{1,60}\s+(?:appointment|meeting|call|visit|consultation|interview)\b/i, 'schedule appointment'],
  [/\b(?:make|set\s+up)\s+(?:a\s+|an\s+)?(?:appointment|reservation|meeting|call)(?!\s+(?:strategy|analysis|report|framework|copy|conversion|rate))\b/i, 'make appointment'],
  [/\bregister\s+for\s+(?:this\s+)?(?:event|webinar|class|course|workshop|conference)\b/i, 'register for event'],
  [/\bapply\s+(?:for|to)\s+(?:this\s+)?(?:job|role|position|opening|listing)\b/i, 'apply for job'],
  [/\bapply\s+(?:on|in)\s+(?:linkedin|indeed|greenhouse|lever)\b/i, 'apply on job site'],
  [/\b(?:send|reply\s+to)\s+(?:a\s+|an\s+|this\s+)?(?:email|message|dm|direct message)(?!\s+(?:open rate|click rate|conversion|copy|strategy|analysis|report))\b/i, 'send message'],
  [/\bmessage\s+(?:on|in)\s+(?:linkedin|slack|gmail|whatsapp|telegram|discord|instagram|facebook)\b/i, 'message on platform'],
  [/\badd\s+.{1,80}\s+to\s+(?:the\s+)?cart\b/i, 'add item to cart'],
  [/\b(?:add|put)\s+.{1,80}\s+(?:in|into)\s+(?:the\s+)?cart\b/i, 'add item to cart'],
  [/\b(?:place|submit)\s+(?:an?\s+|the\s+)?order\b/i, 'place order'],
  [/\bbuy\s+(?:this|that|the|a|an)\s+.{1,80}\s+(?:on|from)\s+(?:amazon|jd|taobao|tmall|pinduoduo|shopify|etsy|ebay)\b/i, 'buy item on platform'],
  [/\bcheck\s*out\s+(?:this\s+)?(?:cart|order|item|product)\b/i, 'checkout item'],
  [/\bpost\s+(?:on|to)\s+(?:twitter|x\.com|linkedin|reddit|instagram|tiktok|facebook|threads)\b/i, 'post on site'],
  [/\b(?:publish|share)\s+(?:this\s+)?(?:post|update|article|comment)\s+(?:on|to)\b/i, 'publish to site'],
  [/\b(?:filter|sort|save|favorite|bookmark)\s+.{1,80}\s+(?:on|in)\s+(?:google flights|airbnb|booking|linkedin|indeed|gmail|slack|notion)\b/i, 'filter or save on site'],
  [/\b(?:draft|compose|create|edit|update|schedule|save|add|reply\s+to)\s+.{1,80}\s+(?:in|on)\s+(?:gmail|slack|notion|github|google docs|google forms|google sheets|google slides|google calendar|linkedin|hubspot|salesforce|stripe|calendly|trello|asana|jira|shopify|zendesk|intercom|linear|monday(?:\.com)?)\b/i, 'draft in app'],
  [/\b(?:find|search|download)\s+.{1,80}\s+(?:in|on)\s+(?:hubspot|salesforce|stripe(?:\s+dashboard)?|calendly|trello|asana|jira|shopify|zendesk|intercom|linear|monday(?:\.com)?)\b/i, 'find or download in SaaS app'],
  [/\b(?:in|on)\s+(?:hubspot|salesforce|stripe(?:\s+dashboard)?|calendly|trello|asana|jira|shopify|zendesk|intercom|linear|monday(?:\.com)?),?\s+(?:draft|compose|create|edit|update|schedule|save|add|reply\s+to|find|search|download)\b/i, 'app-first workflow'],
  [/\b(?:use|open|visit|go\s+to|launch)\s+(?:hubspot|salesforce|stripe(?:\s+dashboard)?|calendly|trello|asana|jira|shopify(?:\s+admin)?|zendesk|intercom|linear|monday(?:\.com)?)(?:\s+(?:admin|dashboard))?\s+(?:to|and)\s+(?:draft|compose|create|edit|update|schedule|save|add|reply\s+to|find|search|download)\b/i, 'open app then act'],
  [/发布(?:到|在)(?:小红书|微博|知乎|抖音|b站|bilibili|twitter|x\.com|linkedin|reddit)/i, '发布到平台'],
];

const NON_EXECUTION_PLATFORM_NAMES =
  '(?:gmail|linkedin|slack|notion|github|amazon|youtube|instagram|twitter|x\\.com|reddit|shopify|飞书|google forms|google docs|google sheets|google slides|google calendar|google flights|hubspot|salesforce|stripe|calendly|trello|asana|jira|zendesk|intercom|linear|monday(?:\\.com)?)';

const NON_EXECUTION_PLATFORM_TOPIC_PATTERNS: readonly RegExp[] = [
  new RegExp(`${NON_EXECUTION_PLATFORM_NAMES}.{0,40}(?:模板|文案|策略|规范|设计|优化|分析|报告|指南|教程|案例|框架|脚本|转化率|运营)`, 'i'),
  new RegExp(`(?:模板|文案|策略|规范|设计|优化|分析|报告|指南|教程|案例|框架|脚本|转化率|运营).{0,40}${NON_EXECUTION_PLATFORM_NAMES}`, 'i'),
];

/**
 * SEARCH verbs — the user wants to find information that lives on
 * the web. These route to 'scrape' (Firecrawl's /search), NOT to
 * 'browser' (which is for interaction). Cheap path: a few seconds
 * + a single LLM synthesis call.
 */
const SEARCH_VERBS: readonly string[] = [
  '搜索', '查找', '查询',
];

const SEARCH_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:search|find|look\s+up)\b/i, 'English search verb'],
  [/(?:帮我|给我|替我|为我)?查(?:一下|找|询)?(?:今天|最新|当前|现在|实时|近期|本周|今年).{0,48}(?:股价|价格|天气|汇率|新闻|财报|来源|链接|市场|排名|航班|酒店|票价|openai|特斯拉|苹果|微软|aapl|tsla|nvda)/i, '中文查实时信息'],
  [/(?:研究|调研|对比).{0,64}(?:今天|最新|当前|现在|实时|近期|今年|新闻|股价|价格|汇率|天气|财报|官网|来源|链接|市场|格局|竞品|公司|平台|小红书|京东|淘宝|拼多多|amazon|openai|特斯拉|苹果|微软|aapl|tsla|iphone)/i, '中文联网研究'],
  [/\b(?:research|compare)\b.{0,72}\b(?:latest|current|today|recent|news|price|stock|weather|source|links?|market|competitors?|company|platform|openai|tesla|aapl|tsla|amazon|microsoft|apple|iphone)\b/i, 'English web research'],
];

/**
 * INFO-only verbs — same scrape route as SEARCH_VERBS but the user
 * has already pointed at a specific URL or site. "总结 https://X" /
 * "分析 jd.com 的促销" — Firecrawl /scrape on the URL/site is the
 * right tool, even though the verb is "总结" (which would be
 * generate-only without the URL).
 */
const INFO_VERBS: readonly string[] = [
  '查看', '分析', '提取', '抓取', '总结', '看一下', '看看',
  // English
  'summarize ', 'summarise ', 'analyze ', 'analyse ', 'extract ',
];

/**
 * Named sites. Mentioning one of these by name is a strong signal
 * the user wants info from that platform — route to 'scrape'
 * unless an INTERACTION verb is also present.
 */
const SITE_NAMES: readonly string[] = [
  '小红书', '淘宝', '天猫', '京东', '拼多多', '抖音', 'bilibili', 'b站',
  '携程', '飞猪', '美团', '大众点评', '高德', '百度地图',
  '微博', '知乎', '豆瓣', '虎扑', 'boss直聘', '拉勾',
  'github', 'linkedin', 'amazon', 'shopify', 'twitter', 'reddit',
  'youtube', 'instagram', 'tiktok', 'gmail', 'producthunt',
];

const ECOMMERCE_SITE_HINTS: readonly string[] = [
  '电商站', '电商平台', '购物平台', '商品', '商品页', '商品链接',
  '京东', '淘宝', '天猫', '拼多多', '抖音商城', '小红书商城',
  'jd', 'taobao', 'tmall', 'pdd', 'amazon',
];

const ECOMMERCE_LIST_HINTS: readonly string[] = [
  '前', 'top', '结果', '列表', '名称', '价格', '链接', '按价格', '排序',
  '从低到高', '从高到低', 'price', 'link', 'url', 'sort',
];

const SKILL_HINTS: ReadonlyMap<string, ExecutionMode> = new Map([
  ['content-creator', 'generate'],
  ['brand-guardian', 'generate'],
  ['visual-storyteller', 'generate'],
  ['image-prompt-engineer', 'generate'],
  ['contract-reviewer', 'generate'],
  ['policy-writer', 'generate'],
  ['exec-summarizer', 'generate'],
  ['exec-briefing', 'generate'],
  ['customer-service', 'generate'],
  ['finance-tracker', 'generate'],
  ['tech-translator', 'generate'],
  ['email_writer', 'generate'],
  ['xiaohongshu', 'browser'],
  ['douyin', 'browser'],
  ['wechat_gongzhong', 'browser'],
  ['ecommerce_cn', 'browser'],
  ['cross-border-ecom', 'browser'],
  ['livestream-coach', 'browser'],
  ['social-media-strategist', 'browser'],
]);

const URL_REGEX = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN_REGEX = /\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}(?:\/[^\s，。；、,;]*)?/i;

function hasAny(haystack: string, needles: readonly string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n)) return n.trim();
  }
  return null;
}

function matchInteractionPattern(intent: string): string | null {
  for (const [pattern, label] of INTERACTION_PATTERNS) {
    if (pattern.test(intent)) return label;
  }
  return null;
}

function matchSearchPattern(intent: string): string | null {
  for (const [pattern, label] of SEARCH_PATTERNS) {
    if (pattern.test(intent)) return label;
  }
  return null;
}

function matchSearchVerb(intent: string): string | null {
  for (const verb of SEARCH_VERBS) {
    const pattern = new RegExp(`(?:^|[\\s，。；、,;:：]|帮我|给我|替我|为我)${verb}(?:一下|一下子|下)?`, 'i');
    if (pattern.test(intent)) return verb;
  }
  return null;
}

function isNonExecutionPlatformTopic(intent: string): boolean {
  return NON_EXECUTION_PLATFORM_TOPIC_PATTERNS.some((pattern) => pattern.test(intent));
}

function matchDomainInfoIntent(intent: string): string | null {
  const domainMatch = DOMAIN_REGEX.exec(intent);
  if (!domainMatch) return null;
  const domain = domainMatch[0].slice(0, 64);
  if (/\b(?:report|strategy|framework|template|playbook|guide)\b.{0,80}\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/i.test(intent)) {
    return null;
  }
  if (/(?:报告|策略|框架|模板|指南|方案).{0,80}\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/i.test(intent)) {
    return null;
  }
  if (/(?:查看|分析|提取|抓取|总结|看一下|看看).{0,80}\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/i.test(intent)) {
    return domain;
  }
  if (/\b(?:summari[sz]e|analy[sz]e|extract|review)\b.{0,80}\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/i.test(intent)) {
    return domain;
  }
  if (/\b(?:pricing|price|homepage|home\s+page|landing\s+page|docs?|documentation)\b.{0,40}\b(?:from|on|of|for)\s+[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/i.test(intent)) {
    return domain;
  }
  if (/\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}(?:\/[^\s，。；、,;]*)?.{0,40}(?:定价|价格|首页|主页|页面|文档|内容|\bpricing\b|\bprice\b|\bhomepage\b|\bdocs?\b|\bdocumentation\b)/i.test(intent)) {
    return domain;
  }
  return null;
}

function isEcommerceListingIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  const hasEcommerce = ECOMMERCE_SITE_HINTS.some((hint) => lower.includes(hint));
  if (!hasEcommerce) return false;
  const hasPrice = /价格|多少钱|最低价|最便宜|price/.test(lower);
  const asksForLinks = /链接|url|link/.test(lower);
  const asksForRows =
    /前\s*\d+|top\s*\d+|\d+\s*(?:个|条|款)?(?:结果|商品|products?)/i.test(intent) ||
    ECOMMERCE_LIST_HINTS.filter((hint) => lower.includes(hint)).length >= 3;
  return hasPrice && asksForLinks && asksForRows;
}

interface RouteDecision {
  mode: ExecutionMode;
  source: string;
  match?: string;
}

function decide(intent: string): RouteDecision {
  // 0. Product-listing / comparison shopping tasks need the supercar
  // loop so it can use search_ecommerce and preserve source URLs.
  // Firecrawl/generate lanes repeatedly produced price rows with
  // empty URLs for "前5结果（名称/价格/链接）" style prompts.
  if (isEcommerceListingIntent(intent)) {
    return { mode: 'browser', source: 'kw:ecommerce-listing' };
  }

  // 1. Interaction verb wins outright — agent must drive a live page.
  const interaction = hasAny(intent, INTERACTION_VERBS);
  if (interaction) {
    return { mode: 'browser', source: 'kw:interaction', match: interaction };
  }
  const interactionPattern = matchInteractionPattern(intent);
  if (interactionPattern) {
    return { mode: 'browser', source: 'kw:interaction', match: interactionPattern };
  }

  // 2. URL / site / search-verb / info-verb → scrape.
  const urlMatch = URL_REGEX.exec(intent);
  if (urlMatch) {
    return { mode: 'scrape', source: 'kw:url', match: urlMatch[0].slice(0, 64) };
  }
  const domainInfoMatch = matchDomainInfoIntent(intent);
  if (domainInfoMatch) {
    return { mode: 'scrape', source: 'kw:domain-info', match: domainInfoMatch };
  }
  const searchPattern = matchSearchPattern(intent);
  if (searchPattern) {
    return { mode: 'scrape', source: 'kw:search-pattern', match: searchPattern };
  }
  if (isNonExecutionPlatformTopic(intent)) {
    return { mode: 'generate', source: 'default' };
  }
  const search = matchSearchVerb(intent);
  if (search) {
    return { mode: 'scrape', source: 'kw:search-verb', match: search };
  }
  const site = hasAny(intent, SITE_NAMES);
  if (site) {
    return { mode: 'scrape', source: 'kw:site', match: site };
  }
  const info = hasAny(intent, INFO_VERBS);
  if (info) {
    // Info verbs without a URL/site are usually pure text-on-already-
    // provided-content (e.g. "分析这段商业模式"). Only route to scrape
    // when the user gave us SOMETHING to scrape (URL/site checked
    // above). Falling through to generate matches that intent.
    return { mode: 'generate', source: 'default' };
  }

  // 3. Default — pure text generation.
  return { mode: 'generate', source: 'default' };
}

export async function classifyExecutionMode(opts: ClassifyOpts): Promise<ExecutionMode> {
  const intent = opts.intent.trim();
  if (!intent) {
    opts.logger.info(
      { mode: 'generate', source: 'empty-intent' },
      'intent-classifier: decided',
    );
    return 'generate';
  }

  const key = cacheKey(intent);
  const cached = cacheGet(key);
  if (cached) {
    opts.logger.info(
      { mode: cached.mode, source: cached.source, cache: 'hit' },
      'intent-classifier: decided',
    );
    return cached.mode;
  }

  // Phase 1 follow-up — strong keyword signals override skill-hint
  // defaults. Without this swap, a user with the xiaohongshu skill
  // enabled who typed "搜索小红书上露营笔记" routed to browser (skill
  // hint won) instead of scrape (search-verb keyword), hit a login
  // wall, and burned a Brave slot. Three signals are STRONG enough
  // to override an installed skill hint:
  //
  //   kw:interaction — verb explicitly says "drive a live page"
  //                    (login / click / fill / 登录 / 点击 / ...)
  //   kw:url         — user pasted a specific URL → scrape that URL
  //   kw:search-verb — verb explicitly says "search the web"
  //                    (搜索 / 查找 / 查询 / search / find / ...)
  //
  // Weaker signals (kw:site alone, or no decide() match → default
  // generate) still defer to the skill hint when one is installed.
  // This preserves the user's explicit "use this skill" intent for
  // ambiguous prompts while preventing the search-verb foot-gun.
  const d = decide(intent);
  const STRONG_SIGNAL_SOURCES = new Set([
    'kw:interaction',
    'kw:url',
    'kw:search-pattern',
    'kw:search-verb',
    'kw:ecommerce-listing',
  ]);
  if (STRONG_SIGNAL_SOURCES.has(d.source)) {
    cacheSet(key, d.mode, d.source);
    opts.logger.info(
      {
        mode: d.mode,
        source: d.source,
        ...(d.match ? { match: d.match } : {}),
        ...(opts.skillId ? { skillIdIgnored: opts.skillId } : {}),
      },
      'intent-classifier: decided',
    );
    return d.mode;
  }

  if (opts.skillId) {
    const hinted = SKILL_HINTS.get(opts.skillId);
    if (hinted) {
      cacheSet(key, hinted, `skill:${opts.skillId}`);
      opts.logger.info(
        { mode: hinted, source: 'skill-hint', skillId: opts.skillId },
        'intent-classifier: decided',
      );
      return hinted;
    }
  }

  cacheSet(key, d.mode, d.source);
  opts.logger.info(
    {
      mode: d.mode,
      source: d.source,
      ...(d.match ? { match: d.match } : {}),
    },
    'intent-classifier: decided',
  );
  return d.mode;
}
