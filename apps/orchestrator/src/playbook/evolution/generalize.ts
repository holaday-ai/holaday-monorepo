import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { normaliseText } from './locator.js';
import {
  type Locator,
  type ParamSpec,
  type PathTemplate,
  type TemplateStep,
  type WaitCondition,
  describeStep,
} from './path-template.js';
import { decodeUrlForCompare, validateTemplateAgainstTrajectories } from './template-validator.js';
import type { Trajectory, TrajectoryGroup } from './trajectory.js';

/**
 * Batch 06 — 沉淀: generalise ≥2 same-site same-capability trajectories into a
 * parameterised template.
 *
 * Primary: Qwen (the `generate` lane's MessagesAdapter) proposes the template.
 * Fallback: a pure diff-based generaliser. EITHER output is accepted only after
 * `validateTemplateAgainstTrajectories` proves it reproduces every source
 * trajectory — the model is never trusted on its own.
 */

export type Generalizer = 'qwen' | 'deterministic';

export interface GeneralizeOutcome {
  ok: boolean;
  template?: PathTemplate;
  generalizer?: Generalizer;
  /** Model calls actually made (0 or 1). */
  modelCalls: number;
  /** Why the model proposal was rejected, when it was. */
  modelErrors?: string[];
  errors?: string[];
}

// ---------------------------------------------------------------------------
// deterministic diff-based generaliser
// ---------------------------------------------------------------------------

function replaceCaseInsensitive(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return haystack.replace(re, replacement);
}

interface TypedParam {
  name: string;
  stepIndex: number;
  /** value per trajectory (same order as the group). */
  values: string[];
}

function templatise(
  values: readonly string[],
  typed: readonly TypedParam[],
): string | null {
  const first = values[0] ?? '';
  if (values.every((v) => normaliseText(v) === normaliseText(first))) return first;
  // Differs across trajectories: must be explained by typed params.
  let candidate = first;
  for (const p of typed) {
    const v = p.values[0];
    if (v && v.trim().length >= 1) candidate = replaceCaseInsensitive(candidate, v, `{{${p.name}}}`);
  }
  return candidate === first ? null : candidate;
}

function templatiseLocator(
  locators: readonly Locator[],
  typed: readonly TypedParam[],
): Locator | null {
  const first = locators[0];
  if (!first) return null;
  const name = templatise(
    locators.map((l) => l.name),
    typed,
  );
  if (name === null) return null;
  return {
    role: first.role,
    name,
    ...(first.nth ? { nth: first.nth } : {}),
  };
}

function templatiseWait(
  waits: ReadonlyArray<WaitCondition | null>,
  typed: readonly TypedParam[],
): WaitCondition | undefined {
  const first = waits[0];
  if (!first || waits.some((w) => !w || w.kind !== first.kind)) return undefined;
  if (first.kind === 'network_idle') return first;
  if (first.kind === 'text') {
    const text = templatise(
      waits.map((w) => (w as { text: string }).text),
      typed,
    );
    return text === null ? undefined : { kind: 'text', text };
  }
  const target = templatiseLocator(
    waits.map((w) => (w as { target: Locator }).target),
    typed,
  );
  return target ? { kind: 'locator', target } : undefined;
}

function templatiseUrl(
  urls: readonly string[],
  typed: readonly TypedParam[],
  params: ParamSpec[],
): string | null {
  const first = urls[0];
  if (!first) return null;
  if (urls.every((u) => decodeUrlForCompare(u) === decodeUrlForCompare(first))) return first;
  let parsed: URL[];
  try {
    parsed = urls.map((u) => new URL(u));
  } catch {
    return null;
  }
  const base = parsed[0] as URL;
  if (parsed.some((u) => u.origin !== base.origin || u.pathname !== base.pathname)) return null;
  const keys = [...new Set(parsed.flatMap((u) => [...u.searchParams.keys()]))];
  const parts: string[] = [];
  for (const key of keys) {
    const vals = parsed.map((u) => u.searchParams.get(key) ?? '');
    const firstVal = vals[0] ?? '';
    if (vals.every((v) => v === firstVal)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(firstVal)}`);
      continue;
    }
    const typedHit = typed.find((p) => p.values.every((v, i) => normaliseText(v) === normaliseText(vals[i] ?? '')));
    if (typedHit) {
      parts.push(`${encodeURIComponent(key)}={{${typedHit.name}}}`);
      continue;
    }
    const name = `q_${key.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 40);
    if (!params.some((p) => p.name === name))
      params.push({ name, description: `URL 参数 ${key}`, example: firstVal });
    parts.push(`${encodeURIComponent(key)}={{${name}}}`);
  }
  return `${base.origin}${base.pathname}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/** Pure diff-based generalisation; returns null when the group cannot be explained. */
export function generalizeDeterministically(group: TrajectoryGroup): PathTemplate | null {
  const ts = group.trajectories;
  const first = ts[0];
  if (!first || ts.some((t) => t.steps.length !== first.steps.length)) return null;

  const params: ParamSpec[] = [];
  const typed: TypedParam[] = [];
  const typeStepCount = first.steps.filter((s) => s.op === 'type').length;
  first.steps.forEach((s, i) => {
    if (s.op !== 'type') return;
    const name = typeStepCount === 1 ? 'query' : `text${typed.length + 1}`;
    const values = ts.map((t) => t.steps[i]?.value ?? '');
    typed.push({ name, stepIndex: i, values });
    params.push({
      name,
      description: `在「${s.locator?.name ?? '输入框'}」中输入的内容`,
      example: values[0] ?? '',
    });
  });

  const steps: TemplateStep[] = [];
  for (let i = 0; i < first.steps.length; i += 1) {
    const col = ts.map((t) => t.steps[i]);
    const s = first.steps[i];
    if (!s || col.some((c) => !c || c.op !== s.op)) return null;
    const wait = templatiseWait(
      col.map((c) => c?.wait ?? null),
      typed,
    );
    const withWait = <T extends object>(step: T): T => (wait ? { ...step, wait } : step);
    switch (s.op) {
      case 'navigate': {
        const url = templatiseUrl(
          col.map((c) => c?.url ?? ''),
          typed,
          params,
        );
        if (!url) return null;
        steps.push(withWait({ op: 'navigate', url }));
        break;
      }
      case 'click': {
        const target = templatiseLocator(
          col.map((c) => c?.locator as Locator),
          typed,
        );
        if (!target) return null;
        steps.push(withWait({ op: 'click', target }));
        break;
      }
      case 'type': {
        const target = templatiseLocator(
          col.map((c) => c?.locator as Locator),
          typed,
        );
        const p = typed.find((tp) => tp.stepIndex === i);
        if (!target || !p) return null;
        steps.push(withWait({ op: 'type', target, text: `{{${p.name}}}`, ...(s.submit ? { submit: true } : {}) }));
        break;
      }
      case 'select': {
        const target = templatiseLocator(
          col.map((c) => c?.locator as Locator),
          typed,
        );
        if (!target) return null;
        const values = col.map((c) => c?.value ?? '');
        let value = values[0] ?? '';
        if (!values.every((v) => v === value)) {
          const name = `option${params.filter((p) => p.name.startsWith('option')).length + 1}`;
          params.push({ name, description: `在「${target.name}」中选择的值`, example: value });
          value = `{{${name}}}`;
        }
        steps.push(withWait({ op: 'select', target, value }));
        break;
      }
      case 'scroll':
        steps.push(withWait({ op: 'scroll', direction: 'down' }));
        break;
      case 'back':
        steps.push(withWait({ op: 'back' }));
        break;
      case 'wait_for':
        if (!wait) return null;
        steps.push({ op: 'wait_for', wait });
        break;
      default:
        return null;
    }
  }

  // Success evidence: captured texts that every trajectory shows (after typed masking).
  const successTexts: string[] = [];
  for (const text of first.outcome?.evidenceTexts ?? []) {
    let candidate = text;
    for (const p of typed) if (p.values[0]) candidate = replaceCaseInsensitive(candidate, p.values[0], `{{${p.name}}}`);
    successTexts.push(candidate);
    if (successTexts.length >= 2) break;
  }

  const template: PathTemplate = {
    schemaVersion: 1,
    siteDomain: group.siteDomain,
    description: `${group.siteDomain}：${steps.map(describeStep).join(' → ')}`.slice(0, 500),
    params,
    steps,
    ...(successTexts.length ? { success: { textContains: successTexts } } : {}),
  };
  const checked = validateTemplateAgainstTrajectories(template, ts);
  if (checked.ok) return checked.template;
  // Evidence texts are the least stable part; retry once without them.
  if (template.success) {
    const { success: _drop, ...rest } = template;
    const retry = validateTemplateAgainstTrajectories(rest, ts);
    if (retry.ok) return retry.template;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Qwen-backed generaliser
// ---------------------------------------------------------------------------

const GENERALIZE_SYSTEM = `你是 HOLA DAY 的操作路径泛化器。给你同一网站、同一能力的多条成功浏览器操作轨迹，请把它们泛化成一个带参数的模板。

规则：
- 只输出一个 JSON 对象，不要任何解释或代码块标记。
- 结构：{"schemaVersion":1,"siteDomain":string,"description":string,"params":[{"name":string,"description":string,"example":string}],"steps":[...],"success":{"textContains":[string]}}
- step 只能是：{"op":"navigate","url"}、{"op":"click","target"}、{"op":"type","target","text","submit"?}、{"op":"select","target","value"}、{"op":"scroll","direction"}、{"op":"back"}、{"op":"wait_for","wait"}；任何 step 可带 "wait"。
- target = {"role":string,"name":string}，role/name 来自轨迹，保持原样；name 中随用户输入变化的部分用 {{参数名}} 代替。
- wait = {"kind":"text","text"} 或 {"kind":"network_idle"} 或 {"kind":"locator","target"}。
- 用户输入的文字必须是参数（{{参数名}}），参数名用英文小写加下划线。example 写一个中性的示例值，不要写用户的个人信息。
- 步骤数量和顺序必须与轨迹完全一致。`;

function trajectoryForPrompt(t: Trajectory, index: number): string {
  return JSON.stringify({
    trajectory: index + 1,
    steps: t.steps.map((s) => ({
      op: s.op,
      ...(s.url ? { url: s.url } : {}),
      ...(s.locator ? { target: { role: s.locator.role, name: s.locator.name } } : {}),
      ...(s.value !== null ? { value: s.value } : {}),
      ...(s.submit ? { submit: true } : {}),
      ...(s.wait ? { wait: s.wait } : {}),
    })),
    evidence: t.outcome?.evidenceTexts ?? [],
  });
}

export function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function proposeTemplateWithModel(
  adapter: MessagesAdapter,
  group: TrajectoryGroup,
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const user = [
    `网站：${group.siteDomain}`,
    ...group.trajectories.slice(0, 5).map(trajectoryForPrompt),
  ].join('\n');
  const response = await adapter.create(
    {
      maxTokens: 1_500,
      thinking: { type: 'disabled' },
      temperature: 0,
      system: GENERALIZE_SYSTEM,
      messages: [{ role: 'user', content: user }],
    },
    { timeoutMs: opts.timeoutMs ?? 30_000, maxRetries: 1 },
  );
  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return parseJsonObject(text);
}

/** Model first (when available), deterministic fallback; both verified. */
export async function generalizeGroup(
  group: TrajectoryGroup,
  deps: { adapter?: MessagesAdapter | null } = {},
): Promise<GeneralizeOutcome> {
  let modelCalls = 0;
  let modelErrors: string[] | undefined;
  if (deps.adapter) {
    try {
      modelCalls += 1;
      const proposal = await proposeTemplateWithModel(deps.adapter, group);
      const checked = validateTemplateAgainstTrajectories(proposal, group.trajectories);
      if (checked.ok) return { ok: true, template: checked.template, generalizer: 'qwen', modelCalls };
      modelErrors = checked.errors.slice(0, 10);
    } catch (err) {
      modelErrors = [err instanceof Error ? err.message : String(err)];
    }
  }
  const fallback = generalizeDeterministically(group);
  if (fallback) return { ok: true, template: fallback, generalizer: 'deterministic', modelCalls, ...(modelErrors ? { modelErrors } : {}) };
  return {
    ok: false,
    modelCalls,
    ...(modelErrors ? { modelErrors } : {}),
    errors: ['no generaliser produced a template that reproduces every trajectory'],
  };
}
