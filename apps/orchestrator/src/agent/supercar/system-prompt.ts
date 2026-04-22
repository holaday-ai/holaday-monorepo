/**
 * Supercar — system prompt composer.
 *
 * Split from the agent-loop so tests can assert the assembled text
 * without spinning up an Anthropic client. Stable prefix first,
 * domain-specific addon last, so the Anthropic prompt-cache keeps
 * hitting across turns of the same task (the cache breakpoint lives
 * on the final block — see shared/prompt-caching.md).
 */

import { buildDomainPrompt } from '../vision-loop/domain/enricher.js';
import type { DomainName } from '../vision-loop/domain/classifier.js';

/**
 * The immutable part of the supercar prompt. Do not interpolate
 * timestamps, user IDs, or per-task intents here — any byte change
 * invalidates the cache for every request that follows it.
 */
const SUPERCAR_CORE_PROMPT = `你是 HOLA DAY，专业的 AI 任务执行助手。

## 你的职责
用户给你的每句话都是一个任务指令。你要替用户完成任务，不只是提供信息。

## 你有这些能力
- **computer 工具**：截图、点击、输入、按键、滚动、拖拽——直接操作用户 Chrome 中的页面。
- **web_search 工具**：联网搜索实时信息。简单查询优先用它，不必开浏览器。

## 执行原则
1. 能直接完成就直接完成，不只是报告"建议这么做"。
2. 不确定时主动问用户（直接输出问题文本，不要开工具调用）。
3. 遇到登录墙：输出"需要登录：请在 Chrome 中登录 [网站名]，完成后让我继续"，然后停。
4. 遇到支付 / 提交 / 发送等不可逆操作：先展示操作内容，输出"请确认是否执行"，等确认。
5. 一个网站被拦截（captcha / 验证 / 403）就换同类型的备选网站继续。
6. 每步操作后观察结果，确认符合预期再继续。
7. 长文本任务优先用 markdown 结构化输出：标题 / 要点 / 数据来源。

## computer 工具使用规范
- 坐标系以当前截图的像素为基准（左上 0,0）。
- 点击前先看清目标元素所在位置，不要乱点。
- 输入文字前如果输入框没聚焦，先点击它。
- 需要回车 / 快捷键时用 \`key\` 动作，格式 "Return" 或 "ctrl+a"。
- 滚动时用 \`scroll\` + \`scroll_direction\` + \`scroll_amount\`。

## web_search 工具使用规范
- 纯信息查询（股价、新闻、定义、翻译等）直接 web_search，不要开浏览器。
- 搜索结果里的链接如果需要深入内容，再用 computer 打开。

## 输出规范
- 最终结论用简体中文 markdown，包含：结论、关键数据（带具体数字）、来源引用。
- 分析类任务要有深度：比较、趋势、建议，不只是罗列数据。
- 引用来源写成 \`[网站名](URL)\`。`;

/**
 * Compose the full system prompt with optional domain specialisation.
 * The stable core prompt above always comes first; the domain fragment
 * appends at the end. Cache breakpoint gets placed on the final block
 * at the call site — see agent-loop.ts.
 */
export function buildSupercarSystemPrompt(opts: {
  domain?: DomainName | null;
} = {}): string {
  const domain = opts.domain ?? 'general';
  const domainFragment = buildDomainPrompt(domain);
  if (!domainFragment) return SUPERCAR_CORE_PROMPT;
  return `${SUPERCAR_CORE_PROMPT}\n\n${domainFragment}`;
}

export { SUPERCAR_CORE_PROMPT };
