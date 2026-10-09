/** Detect affirmative development actions, never a development site's name alone. */
export function looksLikeCodeIntent(intent: string): boolean {
  return intent
    .toLowerCase()
    .split(/[，。；;!！\n]|\bbut\b|但是|然后/)
    .some((clause) => {
      const affirmative = clause
        .replace(/(?:不要|不得|不需要|无需|不做|不)(?:[^，。；;]*?)$/g, '')
        .replace(/\b(?:do not|don't|never|without)\b.*$/g, '');
      if (
        /^\s*(?:查看|只看|阅读|解释|分析|研究|了解|介绍|总结|view\b|read\b|explain\b|analy[sz]e\b|summari[sz]e\b)/i.test(
          affirmative,
        )
      )
        return false;
      return /(?:写|编写|修改|更改|修复|重构|调试|开发|实现|构建|搭建|创建|做|建|搭)(?:一个|一段|个|一下|这个|该)?\s*(?:react\s*)?(?:代码|程序|函数|组件|脚本|网站|网页|应用|小程序|前端|后端|仓库文件|接口|app\b)|(?:提交|创建|发起|提|合并)\s*(?:pull request|pr)\b|\b(?:write|edit|modify|fix|debug|refactor|develop|build|deploy|compile|make)\s+(?:(?:me|a|an|the|this)\s+)*(?:code|program|function|component|script|website|webapp|web app|app|repository files|repo files|bug)\b|\b(?:submit|create|open|merge)\s+(?:(?:a|the)\s+)?(?:pr|pull request)\b/i.test(
        affirmative,
      );
    });
}
