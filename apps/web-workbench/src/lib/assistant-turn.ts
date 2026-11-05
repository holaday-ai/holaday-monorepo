/**
 * FIX-57 — the task page reads like a chat with your own assistant.
 *
 * Pure copy helpers for the conversational task turn:
 *   - one live status line generated from the step events (「正在打开东方财富…」),
 *   - the quiet 「参考了 N 个来源 · 查看过程」 footer,
 *   - a failed run told as an assistant message (what is missing, where it got stuck,
 *     what I can do next) with 1–3 options to pick,
 *   - next steps (assistant voice + the instruction each one sends).
 *
 * Honesty is not relaxed: the status and scoring stay what the server recorded; a
 * failed or partial run always says, in plain words, what it did not get.
 */
import type { UiStep, UiTask } from '@/types/task';
import { friendlyHost } from '@/utils/step-humanize';
import { classifyFriendlyFailure } from './failure-copy';

/** Internal references and provider names never reach the person. */
const INTERNAL_REF_RE =
  /\b(?:tab|frame)_[\w-]+|\[?\bref\s*=\s*[\w-]+\]?|\b(?:firecrawl|brave(?:\s+search)?|playwright|browserbase|dashscope|qwen[\w.-]*|anthropic|claude[\w.-]*|openai|gpt-[\w.-]+|tavily|serpapi)\b/gi;

export function stripInternalRefs(text: string): string {
  return text
    .replace(INTERNAL_REF_RE, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/** The site a step sequence is on: the latest `打开 <url>` navigate. */
export function currentSiteLabel(steps: readonly UiStep[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.actionKind !== 'navigate') continue;
    const url = step.actionSummary?.match(/https?:\/\/\S+/)?.[0];
    const host = hostOf(url);
    if (host) return friendlyHost(host);
  }
  return null;
}

const READ_KINDS = new Set([
  'snapshot',
  'read_page',
  'get_page_text',
  'get_text',
  'sections',
  'find',
  'links',
  'screenshot',
  'observe',
]);

/** A visible label from a step summary (「点击 搜索」), never a bare ref id. */
function stepTarget(summary: string | undefined, prefix: RegExp): string | null {
  const raw = summary?.replace(prefix, '').trim();
  if (!raw || /^(?:e|ref|s\d*e)\d+$/i.test(raw) || /ref=|tab_|frame_/.test(raw)) return null;
  const clean = stripInternalRefs(raw).replace(/^「|」$/g, '');
  return clean && clean.length <= 18 ? clean : null;
}

/**
 * The one live status line while the task runs, from the latest step (and the site
 * it is on). Plain words, no tool names, no internal references.
 */
export function liveStatusText(input: {
  steps: readonly UiStep[];
  progressMessage?: string | null;
  subStatus?: string | null;
}): string {
  const last = input.steps[input.steps.length - 1];
  const site = currentSiteLabel(input.steps);
  const on = site ? site : '页面';
  if (!last) {
    if (input.progressMessage) return stripInternalRefs(input.progressMessage);
    switch (input.subStatus) {
      case 'browsing':
        return '正在打开浏览器…';
      case 'extracting':
        return '在整理拿到的数据…';
      case 'verifying':
        return '在核对结果…';
      case 'generating':
        return '正在写回答…';
      case 'generating_image':
        return '正在生成图片…';
      default:
        return '正在理解你的需求…';
    }
  }
  const kind = last.actionKind ?? '';
  switch (kind) {
    case 'browser_rescue':
      return stripInternalRefs(last.actionSummary ?? '') || '这条路没走通，换个来源试试…';
    case 'browser_blocker':
    case 'browser_login_wall':
    case 'browser_local_wall':
      return `${on}要求登录或验证，看看能不能换条路…`;
    case 'navigate': {
      const url = last.actionSummary?.match(/https?:\/\/\S+/)?.[0];
      const host = hostOf(url);
      return `正在打开${host ? friendlyHost(host) : '页面'}…`;
    }
    case 'read_url':
      return `在读取${on}的内容…`;
    case 'web_search':
      return '正在搜索资料…';
    case 'click':
    case 'click_ref': {
      const target = stepTarget(last.actionSummary, /^点击\s*/);
      return target ? `正在点「${target}」…` : `在${on}上找需要的内容…`;
    }
    case 'type':
    case 'type_in_ref':
    case 'select':
      return '正在输入…';
    case 'press_key':
      return `在${on}上操作…`;
    case 'scroll':
      return `在${on}上往下翻看…`;
    case 'wait':
    case 'wait_for':
      return `等${on}加载…`;
    case 'switch_tab':
    case 'list_tabs':
      return '切到另一个标签页看看…';
    case 'finish':
      return '正在整理答案…';
    case 'request_human':
    case 'wait_for_human':
      return '需要你帮一下…';
    case 'text':
    case '':
      return '正在思考下一步…';
    default:
      if (READ_KINDS.has(kind)) return `在读${on}的内容…`;
      return '正在处理…';
  }
}

/** Seconds → 「45 秒」 / 「2 分 05 秒」. */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
}

/** Elapsed time shows once a task has run longer than this (FIX-57 #3: > 20 s). */
export const ELAPSED_AFTER_SECONDS = 20;

/** Distinct sites the answer links to. */
export function answerSourceCount(text: string): number {
  const hosts = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"'，。）]+/g)) {
    const host = hostOf(match[0]);
    if (host) hosts.add(host);
  }
  return hosts.size;
}

/** The quiet footer under an answer. */
export function processLinkLabel(sourceCount: number): string {
  return sourceCount > 0 ? `参考了 ${sourceCount} 个来源 · 查看过程` : '查看过程';
}

export interface TurnOption {
  label: string;
  /** retry: run the same task again; prompt: send `prompt` as the next instruction. */
  kind: 'retry' | 'prompt';
  prompt?: string;
}

export interface NextStepOption {
  label: string;
  prompt: string;
}

/** Server suggestions (strings from older servers, or {label,prompt}) → options. */
export function normalizeNextSteps(
  raw: ReadonlyArray<string | { label?: unknown; prompt?: unknown }> | undefined | null,
): NextStepOption[] {
  const out: NextStepOption[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const label = typeof item === 'string' ? item : item?.label;
    const prompt = typeof item === 'string' ? item : (item?.prompt ?? item?.label);
    if (typeof label !== 'string' || typeof prompt !== 'string') continue;
    const l = stripInternalRefs(label);
    const p = stripInternalRefs(prompt);
    if (l.length < 2 || p.length < 2 || seen.has(l)) continue;
    seen.add(l);
    out.push({ label: l, prompt: p });
    if (out.length >= 3) break;
  }
  return out;
}

/** The answer of a partial result opens with 「部分完成：」; it is said in words instead. */
export function partialLead(text: string): { lead: string | null; body: string } {
  const m = text.match(/^\s*(?:\*\*)?部分完成(?:\*\*)?\s*[:：]\s*/);
  if (!m) return { lead: null, body: text };
  return { lead: '这次只拿到了一部分，缺的我写在下面了。', body: text.slice(m[0].length) };
}

function siteName(finalUrl: string | null | undefined, intent: string): string | null {
  const host = hostOf(finalUrl) ?? hostOf(intent.match(/https?:\/\/\S+/)?.[0]);
  if (!host) return null;
  const name = friendlyHost(host);
  return /[一-龥]/.test(name) ? name : name.replace(/^(?:passport|login|sso)\./, '');
}

/** The agent's own first sentence of a failure reason, minus prefixes, URLs and advice. */
export function failureOwnWords(errorText: string): string | null {
  let text = errorText
    .replace(/^\s*任务执行失败[:：]\s*/, '')
    .replace(/建议[:：][\s\S]*$/, '')
    .replace(/[（(][^）)]*https?:\/\/[^）)]*[）)]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  text = stripInternalRefs(text);
  const first = text.split(/(?<=[。！？!?])/)[0]?.trim() ?? '';
  if (first.length < 6 || first.length > 90) return null;
  if (/[A-Z_]{6,}|error|exception|stack|\bat\s/i.test(first)) return null;
  return first.replace(/[。.]$/, '');
}

export interface FailureTurn {
  /** First sentence: what did not happen. Always present (honesty). */
  lead: string;
  /** Where it got stuck, in one plain sentence. */
  why: string;
  options: TurnOption[];
}

/**
 * A failed or cancelled run as an assistant message. The lead always states that the
 * result was not obtained; the options lead with the step that fills the gap.
 */
export function failureTurn(input: {
  status: UiTask['status'];
  errorText: string;
  intent: string;
  finalUrl?: string | null;
  executionMode?: string;
  canRetry: boolean;
}): FailureTurn {
  const intent = input.intent.trim();
  if (input.status === 'cancelled') {
    return {
      lead: '这次任务停下了，没有做完。',
      why: '停之前拿到的内容我留在下面了。',
      options: input.canRetry ? [{ kind: 'retry', label: '从头再做一次' }] : [],
    };
  }
  const own = failureOwnWords(input.errorText);
  const friendly = classifyFriendlyFailure(input.errorText, {
    executionMode: input.executionMode,
  });
  const site = siteName(input.finalUrl, intent);
  const lead = own ? `这次没拿到你要的结果：${own}。` : '这次没拿到你要的结果。';
  const publicSource: TurnOption | null = intent
    ? {
        kind: 'prompt',
        label: '我去公开的搜索页或比价网站查同类信息',
        prompt: `不用登录，换一个不需要登录的公开来源（站内搜索页、比价网站或品牌官网）帮我查：${intent}。答案里注明信息来自哪个网站。`,
      }
    : null;
  const retry: TurnOption | null = input.canRetry ? { kind: 'retry', label: '再试一次' } : null;
  const title = friendly.title;
  if (/登录/.test(title)) {
    return {
      lead,
      why: /风控|拦截|拦下|403|异常提示/.test(input.errorText)
        ? `${site ?? '这个网站'}把页面拦下了，要登录或验证后才显示内容；我不能替你登录，也不会绕过它。`
        : `${site ?? '这个网站'}要登录才能看到这部分内容，我不能替你登录，也不会绕过它。`,
      options: [
        intent
          ? {
              kind: 'prompt',
              label: `你在浏览器里登录${site ?? ''}，我接着帮你看`,
              prompt: `我会在浏览器里自己登录${site ?? '这个网站'}。请重新打开刚才的页面，遇到登录页就暂停，等我登录好再继续：${intent}`,
            }
          : null,
        publicSource,
      ].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (/验证/.test(title)) {
    return {
      lead,
      why: `${site ?? '网站'}要求做人机验证，这一步只能由你本人完成，我不会代做。`,
      options: [
        intent
          ? {
              kind: 'prompt',
              label: '重新打开，遇到验证由你来完成',
              prompt: `重新执行：${intent}。遇到人机验证就暂停，等我自己完成验证后再继续。`,
            }
          : null,
        publicSource,
      ].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (/超时|响应|连接|打开这个网站|浏览器|页面正在切换|休眠|中断|长时间/.test(title)) {
    return {
      lead,
      why: `${site ?? '网站'}这次没有正常响应（${title}），不是你的问题。`,
      options: [retry, publicSource].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  return {
    lead,
    why: own ? friendly.subtitle.replace(/^请/, '可以') : `${title}。${friendly.subtitle}`,
    options: [retry].filter((o): o is TurnOption => Boolean(o)),
  };
}

/** Screenshots are evidence (they live in 「查看过程」); other files are the product. */
export function isEvidenceAttachment(a: { kind?: string; mimetype?: string }): boolean {
  return a.kind === 'screenshot';
}

/**
 * The step timeline behind the status line / 「查看过程」: one plain line per step,
 * repeats folded together, the latest last. Agent remarks (text steps) stay as said.
 */
export function stepTimeline(
  steps: readonly UiStep[],
  limit = 40,
): Array<{ key: string; text: string; status: UiStep['status'] }> {
  const out: Array<{ key: string; text: string; status: UiStep['status'] }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const said = step.actionKind === 'text' ? stripInternalRefs(step.actionSummary ?? '') : '';
    const text = (
      said && said !== 'text' ? said : liveStatusText({ steps: steps.slice(0, i + 1) })
    ).replace(/…$/, '');
    if (!text || text === '正在思考下一步' || text === '正在处理') continue;
    const prev = out[out.length - 1];
    if (prev && prev.text === text) {
      prev.status = step.status;
      prev.key = String(step.tickIndex);
      continue;
    }
    out.push({ key: String(step.tickIndex), text, status: step.status });
  }
  return out.slice(-limit);
}
