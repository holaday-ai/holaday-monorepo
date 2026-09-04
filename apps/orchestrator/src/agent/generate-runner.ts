/**
 * Generate-mode task runner backed exclusively by the neutral Responses
 * adapter. Provider selection, credentials and regional routing are resolved
 * before this runner is called; this module only handles task semantics.
 */

import type { Logger } from 'pino';
import { tryDeterministicLightweightAnswer } from '../execution/deterministic-answer.js';
import { buildPromptSchemaSuffix } from '../execution/execution-contract.js';
import type { ExpertWorkflowContract } from '../execution/expert-workflow-contract.js';
import { runIntake } from '../execution/expert-workflow-intake.js';
import {
  buildFollowUpFooter,
  buildReportSystemPrompt,
} from '../execution/expert-workflow-prompt.js';
import { matchExpertWorkflow } from '../execution/expert-workflow-registry.js';
import { getFeatureFlags } from '../execution/feature-flags.js';
import { classifyLightweightTask } from '../execution/lightweight-task.js';
import {
  type NeutralResponseInputContent,
  type NeutralResponseInputMessage,
  type NeutralResponseSource,
  type ResponsesAdapter,
  ResponsesAdapterError,
} from '../llm/responses-adapter.js';
import {
  type ExpertMode,
  buildLayeredSystemPrompt,
  classifyRole,
} from './supercar/prompt-layers.js';

type AttachmentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type?: string;
        media_type: string;
        data: string;
      };
    }
  | { type: string };

export interface GenerateOutcome {
  status: 'completed' | 'failed' | 'awaiting_user';
  summary: string;
  reason?: string;
  sourceUrls?: ReadonlyArray<string>;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface RunGenerateOpts {
  taskId: string;
  userId: string;
  intent: string;
  skillId?: string;
  expertMode?: ExpertMode;
  responsesAdapter: ResponsesAdapter;
  logger: Logger;
  maxTokens?: number;
  attachments?: ReadonlyArray<AttachmentBlock>;
  timeoutMs?: number;
  onStreamDelta?: (delta: string) => void;
  workflowOverride?: ExpertWorkflowContract | null;
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 300_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_TICK_MS = 5_000;
const MAX_ATTEMPTS = 2;
const MAX_CONTINUATIONS = 2;
const CONTINUE_PROMPT = '请继续上文，不要重复已有内容。';
const TRUNCATION_NOTICE = '\n\n---\n【提示】内容因长度限制被截断，如需完整版请追问。';
const PARTIAL_NOTICE = '\n\n---\n【提示】内容因网络或超时被截断，如需完整版请追问。';
const FRESH_SOURCE_ERROR = '未取得可核验的最新来源，请稍后重试。';

const DIRECT_ANSWER_SYSTEM =
  '你是 HOLA DAY 的智能助手。用中文（除非用户用其他语言）直接、准确、简洁地回答用户的问题。' +
  '这是一个简单的问答，不需要联网搜索、不需要生成文件、不需要操作浏览器——直接给出答案即可。' +
  '简单计算请直接给出最终结果（可附一行算式）；简短问候请友好回应；概念问题请用一两句话解释清楚。' +
  '不要回复“没有答案”或空内容——务必给出有用的回答。';

const FRESH_RESEARCH_RE =
  /最近|最新|今日|今天|昨日|昨天|本周|本月|近期|近况|新闻|头条|热搜|榜单|行情|股价|现价|报价|\b(?:recent|latest|today|yesterday|news|stock\s*price)\b/i;

const FRESH_RESEARCH_SYSTEM =
  '这是一个依赖近期真实信息的研究请求。必须先调用 web_search，再作答。' +
  '只陈述可由检索结果支持的事实，并在答案中给出可点击的来源链接和发布时间；' +
  '推断要明确标注为推断。若主体名称、基金/证券代码或时间范围有歧义，先检索可确认部分，' +
  '并清楚说明仍需用户补充的基金全称或代码。涉及基金、ETF 或证券时，必须先以基金全称 + 代码 / ISIN / ticker 或官方产品页确认目标实体；' +
  '无法确认时，只能把检索结果称为线索并请求补充信息，不得把泛市场新闻、相似名称或相关机构动态写成目标对象的近况。' +
  '不要用“数据暂不可用”代替检索、来源或澄清问题。';

const AWAITING_USER_MARKER_RE = /\[AWAITING[_ ]USER[_ ]INPUT\]/i;

function stripAwaitingUserMarker(text: string): string {
  return text.replace(/\s*\[AWAITING[_ ]USER[_ ]INPUT\]\s*/gi, ' ').trim();
}

function requiresFreshResearch(intent: string): boolean {
  return FRESH_RESEARCH_RE.test(intent);
}

function attachmentContent(
  attachments: ReadonlyArray<AttachmentBlock> | undefined,
  intent: string,
): NeutralResponseInputContent[] {
  const content: NeutralResponseInputContent[] = [];
  for (const block of attachments ?? []) {
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      content.push({ type: 'input_text', text: block.text });
      continue;
    }
    if (
      block.type === 'image' &&
      'source' in block &&
      block.source &&
      typeof block.source.data === 'string' &&
      isSupportedImageMediaType(block.source.media_type)
    ) {
      content.push({
        type: 'input_image',
        source: {
          mediaType: block.source.media_type,
          data: block.source.data,
        },
      });
    }
  }
  content.push({ type: 'input_text', text: intent });
  return content;
}

function isSupportedImageMediaType(
  value: string,
): value is 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(value);
}

function dedupeSources(sources: ReadonlyArray<NeutralResponseSource>): NeutralResponseSource[] {
  const byUrl = new Map<string, NeutralResponseSource>();
  for (const source of sources) {
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    const url = parsed.href;
    if (byUrl.has(url)) continue;
    const title = source.title
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\[\]]/g, '')
      .trim()
      .slice(0, 160);
    byUrl.set(url, {
      title: title || parsed.hostname,
      url,
      provenance: 'web_search',
    });
  }
  return [...byUrl.values()];
}

function appendSources(summary: string, sources: ReadonlyArray<NeutralResponseSource>): string {
  const unique = dedupeSources(sources).slice(0, 5);
  if (!summary || unique.length === 0) return summary;
  const links = unique.map((source) => `- [${source.title}](<${source.url}>)`).join('\n');
  return `${summary}\n\n### 核验来源\n${links}`;
}

function safeAdapterErrorCode(error: unknown): string {
  return error instanceof ResponsesAdapterError ? error.code : 'UNKNOWN';
}

function failedOutcome(input: {
  start: number;
  reason: string;
  inputTokens: number;
  outputTokens: number;
}): GenerateOutcome {
  return {
    status: 'failed',
    summary: '',
    reason: input.reason,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    durationMs: Date.now() - input.start,
  };
}

/** Run one generate task without owning persistence or WebSocket state. */
export async function runGenerateTask(opts: RunGenerateOpts): Promise<GenerateOutcome> {
  const start = Date.now();
  const log = opts.logger.child({ taskId: opts.taskId, runner: 'generate' });
  const explicitRole = opts.skillId && opts.skillId !== 'none' ? opts.skillId : null;
  const roleId = explicitRole ?? classifyRole(opts.intent);

  let workflow: ExpertWorkflowContract | null = null;
  let workflowReportSystem: string | null = null;
  if (getFeatureFlags().EXPERT_WORKFLOW) {
    workflow =
      opts.workflowOverride !== undefined
        ? opts.workflowOverride
        : matchExpertWorkflow({ intent: opts.intent, roleId: opts.skillId ?? null });
    if (workflow) {
      const intake = runIntake(workflow, opts.intent);
      log.info(
        {
          workflowId: workflow.workflowId,
          intakeKind: intake.kind,
          missingRequired: intake.parseResult.missingRequired.map((item) => item.name),
          extractedFields: Object.keys(intake.parseResult.extracted),
        },
        'expert-workflow: intake decided',
      );
      if (intake.kind === 'missing' || intake.kind === 'contradiction') {
        return {
          status: 'awaiting_user',
          summary: intake.question,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - start,
        };
      }
      workflowReportSystem = buildReportSystemPrompt({
        workflow,
        extracted: intake.parseResult.extracted,
        validatorResults: intake.validatorResults,
      });
    }
  }

  const isLightweight = !workflowReportSystem && classifyLightweightTask(opts.intent) !== null;
  if (isLightweight) {
    const deterministic = tryDeterministicLightweightAnswer(opts.intent);
    if (deterministic) {
      try {
        opts.onStreamDelta?.(deterministic);
      } catch {
        log.warn({ code: 'STREAM_CALLBACK_ERROR' }, 'generate: stream callback failed');
      }
      return {
        status: 'completed',
        summary: deterministic,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  const schemaSuffix =
    workflowReportSystem || isLightweight ? '' : buildPromptSchemaSuffix(opts.intent);
  const baseSystem = workflowReportSystem
    ? workflowReportSystem
    : isLightweight
      ? DIRECT_ANSWER_SYSTEM
      : buildLayeredSystemPrompt(roleId, opts.expertMode) + schemaSuffix;
  const forceFreshResearch = !isLightweight && requiresFreshResearch(opts.intent);
  const instructions = forceFreshResearch
    ? `${baseSystem}\n\n${FRESH_RESEARCH_SYSTEM}`
    : baseSystem;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputTokens =
    opts.maxTokens ?? workflow?.generationBudget.maxTokens ?? DEFAULT_MAX_TOKENS;
  const tools = forceFreshResearch
    ? ([{ type: 'web_search' }, { type: 'web_extractor' }, { type: 'code_interpreter' }] as const)
    : [];
  const baseInput: NeutralResponseInputMessage[] = [
    {
      role: 'user',
      content: attachmentContent(opts.attachments, opts.intent),
    },
  ];

  log.info(
    {
      roleId,
      timeoutMs,
      forceFreshResearch,
      provider: opts.responsesAdapter.metadata.provider,
      model: opts.responsesAdapter.metadata.model,
      region: opts.responsesAdapter.metadata.region,
      deploymentScope: opts.responsesAdapter.metadata.deploymentScope,
    },
    'generate: starting',
  );

  const outerController = new AbortController();
  const outerTimer = setTimeout(() => outerController.abort(), timeoutMs);
  let accumulatedSummary = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let truncatedAtCap = false;
  const observedSources: NeutralResponseSource[] = [];

  try {
    for (let continuation = 0; continuation <= MAX_CONTINUATIONS; continuation++) {
      const input: NeutralResponseInputMessage[] =
        continuation === 0
          ? baseInput
          : [
              ...baseInput,
              { role: 'assistant', content: accumulatedSummary },
              { role: 'user', content: CONTINUE_PROMPT },
            ];

      let text = '';
      let status: 'completed' | 'incomplete' = 'completed';
      let incompleteReason: 'max_output_tokens' | undefined;
      let lastFailureWasHeartbeat = false;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const streamController = new AbortController();
        const abortFromOuter = () => streamController.abort();
        if (outerController.signal.aborted) streamController.abort();
        else outerController.signal.addEventListener('abort', abortFromOuter, { once: true });

        let lastProgressAt = Date.now();
        let heartbeatFired = false;
        const heartbeatTimer = setInterval(() => {
          if (Date.now() - lastProgressAt > HEARTBEAT_TIMEOUT_MS) {
            heartbeatFired = true;
            streamController.abort();
          }
        }, HEARTBEAT_TICK_MS);

        try {
          const result = await opts.responsesAdapter.stream(
            {
              instructions,
              input,
              tools,
              maxOutputTokens,
            },
            {
              signal: streamController.signal,
              timeoutMs,
              onTextDelta(delta) {
                if (!delta) return;
                lastProgressAt = Date.now();
                try {
                  opts.onStreamDelta?.(delta);
                } catch {
                  log.warn({ code: 'STREAM_CALLBACK_ERROR' }, 'generate: stream callback failed');
                }
              },
            },
          );
          text = result.text.trim();
          status = result.status;
          incompleteReason = result.incompleteReason;
          totalInputTokens += result.usage.inputTokens;
          totalOutputTokens += result.usage.outputTokens;
          observedSources.push(...result.sources);
          lastFailureWasHeartbeat = false;
          if (text) break;
          log.warn(
            { attempt, continuation, code: 'EMPTY_RESPONSE' },
            attempt < MAX_ATTEMPTS
              ? 'generate: empty response — retrying'
              : 'generate: empty response — exhausted retries',
          );
        } catch (error) {
          if (heartbeatFired && !outerController.signal.aborted) {
            lastFailureWasHeartbeat = true;
            log.warn(
              { attempt, continuation, code: 'HEARTBEAT_TIMEOUT' },
              'generate: heartbeat timeout',
            );
            if (attempt < MAX_ATTEMPTS) continue;
          } else {
            throw error;
          }
        } finally {
          clearInterval(heartbeatTimer);
          outerController.signal.removeEventListener('abort', abortFromOuter);
        }
      }

      if (!text) {
        const reason = lastFailureWasHeartbeat
          ? 'AI 长时间没有响应，请简化任务后重试。'
          : 'AI 连续两次返回空内容，请重试或简化任务。';
        return failedOutcome({
          start,
          reason,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        });
      }

      const combined = accumulatedSummary + text;
      if (AWAITING_USER_MARKER_RE.test(combined)) {
        return {
          status: 'awaiting_user',
          summary: stripAwaitingUserMarker(combined),
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs: Date.now() - start,
        };
      }
      accumulatedSummary = combined;

      if (status === 'completed') break;
      if (status !== 'incomplete' || incompleteReason !== 'max_output_tokens') {
        throw new ResponsesAdapterError('INVALID_RESPONSE');
      }
      if (continuation === MAX_CONTINUATIONS) {
        truncatedAtCap = true;
        break;
      }
    }

    const sources = dedupeSources(observedSources);
    if (forceFreshResearch && sources.length === 0) {
      return failedOutcome({
        start,
        reason: FRESH_SOURCE_ERROR,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      });
    }
    const visible = accumulatedSummary + (truncatedAtCap ? TRUNCATION_NOTICE : '');
    const withSources = appendSources(visible, sources);
    const summary = workflow ? withSources + buildFollowUpFooter(workflow) : withSources;
    return {
      status: 'completed',
      summary,
      ...(sources.length > 0 ? { sourceUrls: sources.map((source) => source.url) } : {}),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    const timeout =
      outerController.signal.aborted ||
      (error instanceof ResponsesAdapterError &&
        (error.code === 'REQUEST_TIMEOUT' || error.code === 'REQUEST_ABORTED'));
    const code = safeAdapterErrorCode(error);
    log.warn(
      { code, timeout, accumulatedLength: accumulatedSummary.length },
      timeout ? 'generate: timeout' : 'generate: provider request failed',
    );

    const sources = dedupeSources(observedSources);
    if (accumulatedSummary && (!forceFreshResearch || sources.length > 0)) {
      const partial = appendSources(accumulatedSummary + PARTIAL_NOTICE, sources);
      return {
        status: 'completed',
        summary: workflow ? partial + buildFollowUpFooter(workflow) : partial,
        ...(sources.length > 0 ? { sourceUrls: sources.map((source) => source.url) } : {}),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs: Date.now() - start,
      };
    }

    return failedOutcome({
      start,
      reason:
        forceFreshResearch && sources.length === 0
          ? FRESH_SOURCE_ERROR
          : timeout
            ? `生成超时（>${Math.round(timeoutMs / 1000)} 秒），请重试或简化任务。`
            : '生成服务暂时不可用，请稍后重试。',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });
  } finally {
    clearTimeout(outerTimer);
  }
}
