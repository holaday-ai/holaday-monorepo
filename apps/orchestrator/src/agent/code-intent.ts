// Match bounded action/object phrases, not a development site's name or a
// development word elsewhere in an informational request.
const chineseAction =
  /(?:编写|修改|更改|修复|重构|调试|开发|实现|构建|搭建|创建|部署|上线|写|改|做|建|搭)(?:一个|一段|个|一下|这(?:个|些)?|该)?\s*(?:(?:简单|新的|完整|小型|基本|浏览器|后台|登录|前端|后端)(?:的)?\s*|(?:react|typescript|javascript|python|vue|next\.js)\s*){0,4}(?:代码|程序|函数|组件|脚本|网站|网页|页面|应用|小程序|系统|插件|扩展|接口|仓库文件|前端|后端|api\b|app\b|bug\b)|(?:修复|修改|改|修)(?:这(?:个|些)?|该)?(?:仓库的|代码中的|程序里的)?\s*bug\b|建站/gi;
const englishAction =
  /\b(?:write|edit|modify|fix|debug|refactor|develop|build|deploy|compile|make|implement)\s+(?:(?:me|a|an|the|this|simple|new|small|basic|complete|react|typescript|javascript|python|vue|login|browser|backend|frontend)\s+){0,7}(?:code|program|function|component|script|website|webapp|web app|app|page|system|plugin|extension|api|interface|repository files|repo files|bug)\b/gi;
const createPr =
  /(?:创建|提交|发起|新开|提|合并)\s*(?:一个|个|这个)?\s*(?:pull request|pr)\b|\b(?:submit|create|merge)\s+(?:(?:a|the|new)\s+)*(?:pr|pull request)\b|\bopen\s+(?:a\s+)?new\s+(?:pr|pull request)\b/gi;

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

export function looksLikeCodeIntent(intent: string): boolean {
  const clauses = intent
    .toLowerCase()
    // Quoted labels and URLs can contain development phrases; they are objects
    // being visited/read rather than imperative actions.
    .replace(/https?:\/\/[^\s，。；;!！]+|[“「][^”」]*[”」]|"[^"]*"/g, ' ')
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
        const suffix = affirmative.slice(match.index + match[0].length);
        if (!isInformationalReference(prefix, suffix)) return true;
      }
    }
    // "Open a PR" is creation only without an existing target or reading
    // context. Bare "open PR" is ambiguous navigation and stays allowed.
    if (
      /\bopen\s+(?:a|an)\s+(?:pr|pull request)\b/.test(affirmative) &&
      !/#\d+|\b\d+\b|https?:|read|review|discussion|existing|查看|讨论|阅读/.test(
        intent.toLowerCase(),
      )
    )
      return true;
    return false;
  });
}
