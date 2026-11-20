import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { parseJsonObject } from '../evolution/generalize.js';
import { type ParamSpec, describeStep } from '../evolution/path-template.js';
import { type RepairRequest, type StepRepairer, snapshotForPrompt } from './replay-executor.js';

/**
 * Batch 06 — the only two places the reuse path talks to a model, both via an
 * injected `MessagesAdapter` (production: Qwen, resolved through
 * `ProductionModelRuntimeWiring.resolveCore(...).messages(...)`; the catalog
 * may route to Claude/GPT when an admin picks those brains):
 *
 *   1. `createModelStepRepairer` — one call per FAILED step, to point at the
 *      element in the current snapshot.
 *   2. `createModelPathMatcher` — at most one short call per task, to pick
 *      which verified path fits the intent and fill its params (only made
 *      when the task's site has ≥1 verified path).
 */

function textOf(response: Awaited<ReturnType<MessagesAdapter['create']>>): string {
  return response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

const REPAIR_SYSTEM = `你是网页操作修复器。某个预录的操作步骤找不到目标元素了。根据当前页面的元素列表，选出这一步应该操作的那个元素。
只输出 JSON：{"ref":"eN"}；如果页面上没有合适的元素，输出 {"ref":null}。不要选择登录、支付、下单、提交订单之类的敏感按钮。`;

export function createModelStepRepairer(
  adapter: MessagesAdapter,
  opts: { timeoutMs?: number } = {},
): StepRepairer {
  return {
    async repair(request: RepairRequest) {
      const user = [
        `能力：${request.capabilityDescription}`,
        `失败的步骤：${describeStep(request.step)}`,
        `失败原因：${request.error}`,
        `当前页面：${request.snapshot.title} ${request.snapshot.url}`,
        '元素列表（ref 角色 "名称"）：',
        snapshotForPrompt(request.snapshot),
      ].join('\n');
      const response = await adapter.create(
        {
          maxTokens: 100,
          thinking: { type: 'disabled' },
          temperature: 0,
          system: REPAIR_SYSTEM,
          messages: [{ role: 'user', content: user }],
        },
        { timeoutMs: opts.timeoutMs ?? 20_000, maxRetries: 1 },
      );
      const parsed = parseJsonObject(textOf(response)) as { ref?: unknown } | null;
      return parsed && typeof parsed.ref === 'string' && /^e\d+$/.test(parsed.ref)
        ? { ref: parsed.ref }
        : null;
    },
  };
}

export interface PathCandidate {
  pathId: number;
  description: string;
  params: readonly ParamSpec[];
}

export interface PathMatch {
  pathId: number;
  params: Record<string, string>;
}

export interface PathMatcher {
  match(
    intent: string,
    candidates: readonly PathCandidate[],
  ): Promise<{ match: PathMatch | null; modelCalls: number }>;
}

const MATCH_SYSTEM = `你是操作路径匹配器。给你用户的任务和若干已验证的网站操作路径，判断哪一条能完成这个任务，并从任务中提取该路径需要的参数值。
只输出 JSON：{"pathId":number|null,"params":{"参数名":"值"}}。没有合适的路径时 pathId 为 null。参数值必须来自用户任务原文，不要编造。`;

const MAX_PARAM_VALUE = 500;

/** Deterministic acceptance of a matcher answer. */
export function acceptPathMatch(
  raw: unknown,
  candidates: readonly PathCandidate[],
): { pathId: number; params: Record<string, string> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.pathId !== 'number') return null;
  const candidate = candidates.find((c) => c.pathId === o.pathId);
  if (!candidate) return null;
  const given = (o.params && typeof o.params === 'object' ? o.params : {}) as Record<
    string,
    unknown
  >;
  const params: Record<string, string> = {};
  for (const spec of candidate.params) {
    const v = given[spec.name];
    if (typeof v !== 'string' || !v.trim() || v.length > MAX_PARAM_VALUE) return null;
    params[spec.name] = v.trim();
  }
  return { pathId: candidate.pathId, params };
}

export function createModelPathMatcher(
  adapter: MessagesAdapter | null,
  opts: { timeoutMs?: number } = {},
): PathMatcher {
  return {
    async match(intent, candidates) {
      // Site match alone never implies capability match, so a verified path is
      // only reused after the (single, short) matcher call agrees.
      if (candidates.length === 0 || !adapter) return { match: null, modelCalls: 0 };
      const user = [
        `用户任务：${intent}`,
        '候选路径：',
        ...candidates.map((c) =>
          JSON.stringify({
            pathId: c.pathId,
            description: c.description,
            params: c.params.map((p) => ({ name: p.name, description: p.description })),
          }),
        ),
      ].join('\n');
      const response = await adapter.create(
        {
          maxTokens: 300,
          thinking: { type: 'disabled' },
          temperature: 0,
          system: MATCH_SYSTEM,
          messages: [{ role: 'user', content: user }],
        },
        { timeoutMs: opts.timeoutMs ?? 15_000, maxRetries: 1 },
      );
      return {
        match: acceptPathMatch(parseJsonObject(textOf(response)), candidates),
        modelCalls: 1,
      };
    },
  };
}
