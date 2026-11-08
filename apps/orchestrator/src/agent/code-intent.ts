// Match bounded action/object phrases, not a development site's name or a
// development word elsewhere in an informational request.
//
// FIX-59 P0: a request is code only when what it asks for is code or software.
// 「写一个程序员深夜加班的小说片段」 asks for a story, not a 程序: words that only contain a
// code noun (程序员 / 程序化 / 节目程序 / 应用题 …) are masked first, and a match whose
// produced thing is writing (小说 / 文案 / 方案 / story / video script …) is not code.
const CREATE_VERB = '编写|开发|实现|构建|搭建|创建|写|做|建|搭';
const FIX_VERB = '修改|更改|修复|重构|调试|改|修';
const DEPLOY_VERB = '部署|上线';
const TECH_WORD =
  'react|typescript|javascript|python|java|golang|go|node(?:\\.js)?|vue|next\\.js|c\\+\\+|c#|php|ruby|rust|swift|kotlin|shell|bash|sql|html|css';
const CODE_NOUN =
  '代码|程序|函数|组件|脚本|网站|网页|页面|应用|小程序|系统|插件|扩展|接口|仓库文件|前端|后端|爬虫|api\\b|app\\b|bug\\b';
const CHINESE_MODIFIER = `(?:(?:简单|新的|完整|小型|基本|浏览器|后台|登录页?|注册|前端|后端|自动化?|爬虫|聊天|管理|数据|命令行)(?:的)?\\s*|(?:${TECH_WORD})\\s*|[\\u4e00-\\u9fff]{1,12}的\\s*)`;
const chineseAction = new RegExp(
  `(${CREATE_VERB}|${FIX_VERB}|${DEPLOY_VERB})(?:一个|一段|个|一下|这(?:个|些)?|该)?\\s*${CHINESE_MODIFIER}{0,4}(?:${CODE_NOUN})|(?:修复|修改|改|修)(?:这(?:个|些)?|该)?(?:仓库的|代码中的|程序里的)?\\s*bug\\b|建站`,
  'gi',
);
const englishAction =
  /\b(?:write|edit|modify|fix|debug|refactor|develop|build|deploy|compile|make|implement)\s+(?:(?:me|a|an|the|this|simple|new|small|basic|complete|react|typescript|javascript|python|vue|login|browser|backend|frontend)\s+){0,7}(code|program|function|component|script|website|webapp|web app|app|page|system|plugin|extension|api|interface|repository files|repo files|bug)\b/gi;
const createPr =
  /(?:创建|提交|发起|新开|提|合并)\s*(?:一个|个|这个)?\s*(?:pull request|pr)\b|\b(?:submit|create|merge)\s+(?:(?:a|the|new)\s+)*(?:pr|pull request)\b|\bopen\s+(?:a\s+)?new\s+(?:pr|pull request)\b/gi;

/** Words that contain a code noun but name a person, a quality or a non-software thing. */
const NOT_CODE_WORD =
  /程序(?:员|猿|媛|化|性)|(?:节目|晚会|婚礼|典礼|会议|议事|法律|法定|诉讼|司法|行政|审批|办事|报销|工作|操作|选举|仲裁)程序|应用(?:题|文)|系统(?:性|化)|脚本杀|网站编辑/g;
/** What a writing request produces. 片段 alone is not here: 代码片段 is a code snippet. */
const WRITING_NOUN =
  /小说|故事|剧本|文案|诗|散文|作文|文章|演讲稿|发言稿|讲稿|致辞|贺词|祝福语|周报|日报|月报|年报|总结|报告|简历|求职信|邮件|信件|段子|歌词|台词|大纲|笔记|推文|帖子|公众号|软文|标题|口号|广告语|宣传语|介绍|简介|摘要|纪要|心得|感想|梗概|提纲|清单|汇总|合集|推荐|说明|文档|方案|策划|计划书|评论|影评|书评|读后感|对联|海报|story|stories|novel|poem|poetry|essay|article|blog|post|copy|caption|tagline|slogan|headline|speech|letter|email|report|summary|review|lyrics|newsletter|announcement/i;
/** After the code noun, these start what the code is for (「写一个 Python 程序来生成周报」), or the
 * next item of a list (「修 bug、整理文档」). */
const PURPOSE_CUT =
  /[、/／]|另外|顺便|同时|然后|用来|用于|以便|来(?=[一-鿿])|(?:自动|批量)?(?:生成|输出|导出|爬取|抓取|统计|计算|下载|上传|发送|处理)|\b(?:that|which|to|using|in\s+(?:python|javascript|typescript|js|java|go|rust|bash|shell))\b/i;
/** A 脚本 / script / program for a video, a show or a stage is a piece of writing. */
const MEDIA_CONTEXT =
  /视频|短视频|抖音|快手|b站|直播|口播|分镜|广告|宣传片|拍摄|剧情|vlog|带货|话剧|小品|电影|播客|节目|晚会|演出|\b(?:video|youtube|tiktok|film|movie|play|ad|advert|commercial|podcast|skit|episode|scene|show|presentation|wedding|concert|recital|comic|story|novel)\b/i;
const TECH_CONTEXT = new RegExp(
  `\\b(?:${TECH_WORD}|js|cli|npm|pip|cron|api|regex)\\b|自动|爬|批处理|定时|命令|运行|代码`,
  'i',
);

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

/**
 * FIX-59 P0: is the thing this match asks for writing rather than code?
 * - a 脚本 / script / program in a video, show or stage context, with no tech word;
 * - the code noun runs on into a writing noun (「网站运营方案」「app 推广文案」「landing page copy」);
 * - for a create verb, the phrase goes on 「…的 X」 and X is not code (「网站的介绍」「开发网站的人的故事」).
 */
function producesWriting(match: RegExpMatchArray, clause: string, intent: string): boolean {
  // 「修 bug」「建站」 are code whatever follows.
  if (match[1] === undefined) return false;
  const matched = match[0];
  const suffix = clause.slice((match.index ?? 0) + matched.length);
  const object = /(脚本|程序|script|program|page)\s*$/i.exec(matched)?.[1];
  if (object && MEDIA_CONTEXT.test(intent) && !TECH_CONTEXT.test(intent.replace(/脚本|程序/g, '')))
    return true;
  const cut = PURPOSE_CUT.exec(suffix);
  const own = cut ? suffix.slice(0, cut.index) : suffix;
  // English nouns run on directly (「landing page copy」); 「a script for a story generator」 is code.
  const writing = /[\u4e00-\u9fff]/.test(matched)
    ? WRITING_NOUN.exec(own)
    : new RegExp(`^\\s*(?:${WRITING_NOUN.source})\\b`, 'i').exec(own);
  if (
    writing &&
    !/^\s*(?:生成器|工具|机器人|generator|tool|bot|app)\b/i.test(
      own.slice(writing.index + writing[0].length),
    )
  )
    return true;
  const verb = match[1];
  if (verb && new RegExp(`^(?:${CREATE_VERB})$`).test(verb)) {
    const head = /(?:[上里中内]?的)([^的]*)$/.exec(own)?.[1];
    if (head?.trim() && !new RegExp(CODE_NOUN, 'i').test(head)) {
      return !/^(?:(?:单元)?测试|样式|逻辑|功能|模块|后台|部分)/.test(head.trim());
    }
  }
  return false;
}

export function looksLikeCodeIntent(intent: string): boolean {
  const lowered = intent.toLowerCase();
  const clauses = lowered
    // Quoted labels and URLs can contain development phrases; they are objects
    // being visited/read rather than imperative actions.
    .replace(/https?:\/\/[^\s，。；;!！]+|[“「][^”」]*[”」]|"[^"]*"/g, ' ')
    .replace(NOT_CODE_WORD, '◇')
    .split(/[，。；;!！\n]|然后|之后|并且|并|但(?:是)?|\b(?:and|then|but)\b|后(?=提\s*pr)/i);
  return clauses.some((clause) => {
    const affirmative = clause
      .replace(
        /(?:不要|不得|不需要|无需|不做|不修改|不写|不提交|不创建|不改|不部署|不开发).*$/g,
        '',
      )
      .replace(/\b(?:do not|don't|never|without)\b.*$/g, '');
    for (const pattern of [chineseAction, englishAction, createPr]) {
      for (const match of affirmative.matchAll(pattern)) {
        const prefix = affirmative.slice(0, match.index);
        const suffix = affirmative.slice((match.index ?? 0) + match[0].length);
        if (isInformationalReference(prefix, suffix)) continue;
        if (pattern !== createPr && producesWriting(match, affirmative, lowered)) continue;
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
