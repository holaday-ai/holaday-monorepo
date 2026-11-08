// Match bounded action/object phrases, not a development site's name or a
// development word elsewhere in an informational request.
//
// FIX-59 P0 / DEPLOY-59 第 0 步 1: a request is refused as code only when that is certain — anything
// in doubt goes through. A creation request is code only when both hold:
//   (a) the verb makes something: 写 / 编写 / 编 / 做 / 开发 / 实现 (write / build / code / make …);
//   (b) the head of what it makes — the last noun of the object, after its last 「的」 — is code:
//       程序 / 脚本 / 插件 / 扩展 / 小程序 / 组件 / 函数 / 爬虫 / SQL 查询 / 网站 / app …
// It goes through when the head is writing (计划 / 教程 / 说明 / 文案 / 描述 / 截图 …), when the
// request works on a website (在 X 上 / X 后台 / 打开 X), or when the head cannot be told.
// The word lists are not widened to catch more: what the structure misses goes through.
// Changing, debugging, deploying code and opening a PR keep their narrow, code-only objects.

const CREATE_VERB_RE = /(编写|开发|实现|写|做|编)(?!成|入|进|到|在|作|辑|号|排|织|制|码)/gu;
const QUANTIFIER_RE =
  /^\s*(一个|一段|一套|一款|一份|一篇|一首|一封|一则|一条|个|段|套|款|份|篇|首|封|一下|这(?:个|些|段)?|该)?\s*/u;
/** A quantity that only writing takes: 一篇 / 一首 / 一封 / 一份 / 一则. */
const WRITING_QUANTIFIER_RE = /^(?:一)?(?:篇|首|封|份|则)$/u;
const TECH_WORD =
  'react|typescript|javascript|python|java|golang|go|node(?:\\.js)?|vue|next\\.js|c\\+\\+|c#|php|ruby|rust|swift|kotlin|shell|bash|sql|html|css|js|ts';
/** The head nouns that are code whatever else is said. */
const CODE_HEAD_RE =
  /(?:代码片段|代码|源码|程序|脚本|插件|扩展|小程序|组件|函数|爬虫|正则(?:表达式)?|接口|\bsql(?:\s*(?:查询|语句))?|\bapi|\bapp|\bbot|应用程序|网站|系统)\s*$/iu;
/** 页面 / 网页 / 前端 / 后端 are code only with a code word in the object (「React 登录页面」). */
const PAGE_HEAD_RE = /(?:页面|网页|前端|后端)\s*$/u;
const PAGE_CODE_WORD_RE = new RegExp(
  `\\b(?:${TECH_WORD})\\b|登录|注册|落地页|响应式|管理后台|前端|后端`,
  'iu',
);
/** 系统 is software when it is developed or implemented, not when it is 「写」 or 「做」. */
const SYSTEM_HEAD_RE = /系统\s*$/u;
const TRAILING_RE = /(?:吧|呗|啊|呀|嘛|给我|出来|一下|好吗|可以吗)+\s*$/u;
/** Where what is made is used for something else (「写一个 Python 程序来生成周报」). */
const PURPOSE_CUT_RE =
  /用来|用于|以便|来(?=[一-鿿])|自动|批量|定时|每天|每隔|生成|输出|导出|爬取|抓取|统计|计算|下载|上传|发送|处理/u;
/** Writing nouns: a head among them, or the part before the purpose naming one, is writing. */
const WRITING_NOUN_RE =
  /小说|故事|剧本|文案|诗|散文|作文|文章|演讲稿|发言稿|讲稿|致辞|贺词|祝福语|周报|日报|月报|年报|总结|报告|简历|邮件|段子|歌词|台词|大纲|笔记|推文|帖子|软文|标题|口号|介绍|描述|截图|评价|教程|攻略|测评|说明|文档|方案|策划|计划|分析|评论|表格|草稿|清单|ppt/iu;
/** A 脚本 / 程序 for a video, a show or a stage is a piece of writing. */
const MEDIA_CONTEXT_RE =
  /视频|短视频|抖音|快手|b站|直播|口播|分镜|广告|宣传片|拍摄|剧情|vlog|带货|话剧|小品|电影|播客|节目|晚会|演出/iu;
const TECH_CONTEXT_RE = new RegExp(
  `\\b(?:${TECH_WORD}|cli|npm|pip|cron|regex)\\b|自动|爬|批处理|定时|命令`,
  'iu',
);

/** Words that contain a code noun or a making verb but are neither. */
const NOT_CODE_WORD =
  /改(?:用|为|成|走|去|到|换)|写(?:成|入|进|到|在)|叫做|当做|看做|(?:ppt|幻灯片|演示文稿|keynote|word|excel)\s*(?:页面|页)|程序(?:员|猿|媛|化|性)|(?:节目|晚会|婚礼|典礼|会议|议事|法律|法定|诉讼|司法|行政|审批|办事|报销|工作|操作|选举|仲裁)程序|应用(?:题|文)|系统(?:性|化)|脚本杀|网站编辑/giu;

/** Work on a website — 「在 WordPress 后台」「在 Notion 上」「打开 X」 — is a browser task. */
const ON_A_SITE_RE =
  /(?:在|到|去|进|进入)\s*([^，。；]{1,24}?)\s*(?:的)?(?:后台|上|里|中|网站|平台|站点|控制台|管理后台|管理页|账号|店铺)|(?:打开|登录|登陆|进入)\s*([^，。；\s]{1,24})|在\s*([a-z][\w.]{1,24})\s|\b(?:in|on|at|into)\s+(?:the\s+|my\s+)?([\w.]+(?:\s+[\w.]+)?)\s+(?:admin|dashboard|backend|console|site|account|store)\b|\b(?:open|log\s?in(?:to)?|sign\s?in(?:to)?|go\s+to)\s+([\w.]+)/iu;
/** Local tools are not websites: 「在 VS Code 里写一个函数」 is code. */
const LOCAL_TOOL_RE = new RegExp(
  `\\b(?:${TECH_WORD}|ide|vs\\s?code|vscode|cursor|xcode|terminal|github|gitlab|repo)\\b|编辑器|终端|命令行|项目|仓库|代码|本地|电脑`,
  'iu',
);
function onASite(prefix: string): boolean {
  const m = ON_A_SITE_RE.exec(prefix);
  if (!m) return false;
  const where = m.slice(1).find((part) => part !== undefined) ?? '';
  return !LOCAL_TOOL_RE.test(where);
}

function isInformationalReference(prefix: string, suffix: string): boolean {
  return (
    /(?:about|guide|tutorial)\b/i.test(prefix) ||
    /(?:如何|怎样|怎么|how\s+to)\s*$/i.test(prefix) ||
    (/^(?:请|帮我)?(?:查看|看看|阅读|解释|分析|研究|了解|介绍|总结|read\b|view\b|explain\b|review\b|analy[sz]e\b)/i.test(
      prefix.trim(),
    ) &&
      /(?:教程|步骤|方法|流程|讨论|记录|discussion|tutorial|steps)/i.test(suffix))
  );
}

/** The head of what is made: after the last 「的」, trailing particles off. */
function headOf(phrase: string): string {
  return (phrase.split('的').pop() ?? '').replace(TRAILING_RE, '').trim();
}

function headIsCode(phrase: string, verb: string, intent: string): boolean {
  const head = headOf(phrase);
  if (!head || WRITING_NOUN_RE.test(head)) return false;
  if (PAGE_HEAD_RE.test(head)) return PAGE_CODE_WORD_RE.test(phrase);
  if (SYSTEM_HEAD_RE.test(head) && !/开发|实现/.test(verb)) return false;
  if (!CODE_HEAD_RE.test(head)) return false;
  // A 脚本 for a video or a show, with no tech word, is writing (「写个短视频口播脚本」).
  if (/脚本|程序/.test(head) && MEDIA_CONTEXT_RE.test(intent) && !TECH_CONTEXT_RE.test(intent))
    return false;
  return true;
}

/** A creation request whose made thing is code, certainly. */
function createsCode(clause: string, intent: string): boolean {
  for (const m of clause.matchAll(CREATE_VERB_RE)) {
    const verb = m[1]!;
    const prefix = clause.slice(0, m.index);
    const rest = clause.slice((m.index ?? 0) + m[0].length);
    if (onASite(prefix) || isInformationalReference(prefix, rest)) continue;
    const quantity = QUANTIFIER_RE.exec(rest);
    if (quantity?.[1] && WRITING_QUANTIFIER_RE.test(quantity[1])) continue;
    const phrase = rest.slice(quantity?.[0].length ?? 0);
    if (!phrase.trim()) continue;
    if (headIsCode(phrase, verb, intent)) return true;
    // 「写一个 Python 程序来生成周报」: the part before what it is for, when that part is short
    // and names no writing.
    const cut = PURPOSE_CUT_RE.exec(phrase);
    if (cut && cut.index > 0) {
      const before = phrase.slice(0, cut.index);
      if (before.length <= 16 && !WRITING_NOUN_RE.test(before) && headIsCode(before, verb, intent))
        return true;
    }
  }
  return false;
}

/** Changing, debugging or deploying code: only an object that is code itself. */
const CHANGE_CODE_RE =
  /(?:修改|更改|修复|重构|调试|改|修)(?:一下|这(?:个|些)?|该)?\s*(?:仓库的|代码中的|程序里的)?\s*(?:[a-z][\w.+#-]{0,19}\b\s*)?(?:代码|源码|函数|程序|脚本|仓库文件|组件|接口|\bbug\b)|(?:部署|上线)(?:一下|这(?:个|些)?|该)?\s*(?:[a-z][\w.+#-]{0,19}\b\s*)?(?:应用|网站|程序|代码|服务|\bapp\b)|建站/giu;

const englishCreate =
  /\b(?:write|build|code|make|develop|implement)\s+(?:(?:me|a|an|the|this|simple|new|small|basic|complete|react|typescript|javascript|python|vue|login|browser|backend|frontend)\s+){0,7}(code|program|function|component|script|website|webapp|web app|app|page|system|plugin|extension|api|interface)\b/giu;
const englishChange =
  /\b(?:edit|modify|fix|debug|refactor|deploy|compile)\s+(?:(?:me|a|an|the|this|my|our)\s+){0,3}(?:code|program|function|component|script|app|repository files|repo files|bug)\b/giu;
/** English writing that runs on from the object (「landing page copy」「app description」). */
const ENGLISH_WRITING_RE =
  /^\s*(?:copy|text|content|description|story|stories|poem|essay|article|blog|post|review|tagline|slogan|headline|announcement|newsletter|guide|tutorial|plan|summary|report)\b/iu;
const ENGLISH_MEDIA_RE =
  /\b(?:video|youtube|tiktok|film|movie|play|ad|advert|commercial|podcast|skit|episode|scene|show|presentation|wedding|concert|recital|comic|story|novel)\b/iu;
const ENGLISH_TECH_RE =
  /\b(?:react|typescript|javascript|python|java|node|vue|bash|shell|sql|cli|npm|pip|cron|regex|scrape|scraper|automate|automation)\b/iu;

function englishCreatesCode(clause: string): boolean {
  for (const m of clause.matchAll(englishCreate)) {
    const prefix = clause.slice(0, m.index);
    if (onASite(prefix) || isInformationalReference(prefix, '')) continue;
    const suffix = clause.slice((m.index ?? 0) + m[0].length);
    if (ENGLISH_WRITING_RE.test(suffix)) continue;
    const object = m[1]!.toLowerCase();
    if (
      (object === 'script' || object === 'program') &&
      ENGLISH_MEDIA_RE.test(clause) &&
      !ENGLISH_TECH_RE.test(clause)
    )
      continue;
    // A page is code only with a code word (「a React login page」).
    if (object === 'page' && !ENGLISH_TECH_RE.test(m[0]) && !/login|signup|landing/i.test(m[0]))
      continue;
    return true;
  }
  return false;
}

const createPr =
  /(?:创建|提交|发起|新开|提|合并)\s*(?:一个|个|这个)?\s*(?:pull request|pr)\b|\b(?:submit|create|merge)\s+(?:(?:a|the|new)\s+)*(?:pr|pull request)\b|\bopen\s+(?:a\s+)?new\s+(?:pr|pull request)\b/giu;

export function looksLikeCodeIntent(intent: string): boolean {
  const lowered = intent.toLowerCase();
  const clauses = lowered
    // Quoted labels and URLs can contain development phrases; they are objects
    // being visited/read rather than imperative actions.
    .replace(/https?:\/\/[^\s，。；;!！]+|[“「][^”」]*[”」]|"[^"]*"/g, ' ')
    .replace(NOT_CODE_WORD, '◇')
    .split(/[，。；;!！\n、]|然后|之后|并且|并|但(?:是)?|\b(?:and|then|but)\b|后(?=提\s*pr)/i);
  return clauses.some((clause) => {
    const affirmative = clause
      .replace(
        /(?:不要|不得|不需要|无需|不做|不修改|不写|不提交|不创建|不改|不部署|不开发).*$/g,
        '',
      )
      .replace(/\b(?:do not|don't|never|without)\b.*$/g, '');
    if (createsCode(affirmative, lowered) || englishCreatesCode(affirmative)) return true;
    for (const pattern of [CHANGE_CODE_RE, englishChange, createPr]) {
      for (const match of affirmative.matchAll(pattern)) {
        const prefix = affirmative.slice(0, match.index);
        const suffix = affirmative.slice((match.index ?? 0) + match[0].length);
        if (isInformationalReference(prefix, suffix)) continue;
        if (pattern !== createPr && onASite(prefix)) continue;
        return true;
      }
    }
    // "Open a PR" is creation only without an existing target or reading
    // context. Bare "open PR" is ambiguous navigation and stays allowed.
    if (
      /\bopen\s+(?:a|an)\s+(?:pr|pull request)\b/.test(affirmative) &&
      !/#\d+|\b\d+\b|https?:|read|review|discussion|existing|查看|讨论|阅读/.test(lowered)
    )
      return true;
    return false;
  });
}

/**
 * FIX-59 P0: the refusal says it plainly and offers a way forward, in the task's language.
 * The web toast keys on 「Claude Code」 being in the message.
 */
export function codeIntentRefusal(intent: string): string {
  const text = intent.replace(/https?:\/\/\S+/g, ' ');
  const english = /[a-z]{3,}/i.test(text) && !/[㐀-鿿]/.test(text);
  return english
    ? "Writing code isn't what I do best — Claude Code or Cursor will serve you better. If you'd like me to search for information, put together a document or work through a website, I'm glad to help."
    : '写代码不是我最擅长的，你可以用 Claude Code 或 Cursor。如果你是想让我搜索资料、整理文档或者操作网页，我很乐意帮你。';
}
