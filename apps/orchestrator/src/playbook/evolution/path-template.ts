import { z } from 'zod';

/**
 * Batch 06 — parameterised operation-path template.
 *
 * A template is what the self-evolution loop executes deterministically: a
 * list of browser-tool steps whose targets are located by ARIA role + name
 * (+ optional text features), never by brittle CSS or coordinates. String
 * fields may contain `{{param}}` placeholders bound per run.
 *
 * Templates are stored in `operation_paths.template_json` (0062). The schema
 * here is the single source of truth for both the model-produced proposal
 * (sediment) and the model-produced local repair (replay); anything that
 * fails it is rejected before it can touch a browser.
 */

export const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,39})\s*\}\}/g;
const PARAM_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

export const locatorSchema = z
  .object({
    role: z.string().min(1).max(40),
    /** Accessible name; may contain placeholders. Empty string = match by role/text only. */
    name: z.string().max(200),
    /** Extra text features the element's visible text must contain (all of them). */
    textContains: z.array(z.string().min(1).max(200)).max(5).optional(),
    /** 0-based index among equally-matching elements (default 0). */
    nth: z.number().int().min(0).max(50).optional(),
  })
  .strict();
export type Locator = z.infer<typeof locatorSchema>;

export const waitConditionSchema = z.union([
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('locator'), target: locatorSchema }).strict(),
  z.object({ kind: z.literal('network_idle') }).strict(),
]);
export type WaitCondition = z.infer<typeof waitConditionSchema>;

const waitField = { wait: waitConditionSchema.optional() };

export const templateStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('navigate'), url: z.string().min(1).max(2048), ...waitField }).strict(),
  z.object({ op: z.literal('click'), target: locatorSchema, ...waitField }).strict(),
  z
    .object({
      op: z.literal('type'),
      target: locatorSchema,
      text: z.string().max(2000),
      submit: z.boolean().optional(),
      ...waitField,
    })
    .strict(),
  z
    .object({
      op: z.literal('select'),
      target: locatorSchema,
      value: z.string().max(500),
      ...waitField,
    })
    .strict(),
  z
    .object({
      op: z.literal('scroll'),
      direction: z.enum(['up', 'down', 'left', 'right']),
      amount: z.number().int().min(1).max(10_000).optional(),
      ...waitField,
    })
    .strict(),
  z.object({ op: z.literal('back'), ...waitField }).strict(),
  z.object({ op: z.literal('wait_for'), wait: waitConditionSchema }).strict(),
]);
export type TemplateStep = z.infer<typeof templateStepSchema>;
export type TemplateOp = TemplateStep['op'];

export const paramSpecSchema = z
  .object({
    name: z.string().regex(PARAM_NAME_RE),
    description: z.string().max(200),
    /** Neutral sample value used by the canary; never a user's private value. */
    example: z.string().max(500),
  })
  .strict();
export type ParamSpec = z.infer<typeof paramSpecSchema>;

export const pathTemplateSchema = z
  .object({
    schemaVersion: z.literal(1),
    siteDomain: z.string().min(1).max(255),
    /** Human description of the capability, used to match future intents. */
    description: z.string().min(1).max(500),
    params: z.array(paramSpecSchema).max(10),
    steps: z.array(templateStepSchema).min(1).max(40),
    /** Post-run evidence that the capability actually succeeded. */
    success: z
      .object({
        textContains: z.array(z.string().min(1).max(200)).max(5).optional(),
        urlContains: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PathTemplate = z.infer<typeof pathTemplateSchema>;

export type ParamValues = Readonly<Record<string, string>>;

export function placeholdersIn(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(PLACEHOLDER_RE)) if (m[1]) out.push(m[1]);
  return out;
}

/** Every string field of a step that may carry placeholders. */
export function stepStrings(step: TemplateStep): string[] {
  const out: string[] = [];
  const pushLocator = (l: Locator) => {
    out.push(l.name);
    for (const t of l.textContains ?? []) out.push(t);
  };
  const pushWait = (w: WaitCondition | undefined) => {
    if (!w) return;
    if (w.kind === 'text') out.push(w.text);
    if (w.kind === 'locator') pushLocator(w.target);
  };
  switch (step.op) {
    case 'navigate':
      out.push(step.url);
      break;
    case 'click':
      pushLocator(step.target);
      break;
    case 'type':
      pushLocator(step.target);
      out.push(step.text);
      break;
    case 'select':
      pushLocator(step.target);
      out.push(step.value);
      break;
    default:
      break;
  }
  pushWait(step.wait);
  return out;
}

export function templatePlaceholders(template: PathTemplate): Set<string> {
  const used = new Set<string>();
  for (const step of template.steps)
    for (const s of stepStrings(step)) for (const p of placeholdersIn(s)) used.add(p);
  for (const t of template.success?.textContains ?? [])
    for (const p of placeholdersIn(t)) used.add(p);
  if (template.success?.urlContains)
    for (const p of placeholdersIn(template.success.urlContains)) used.add(p);
  return used;
}

export class MissingParamError extends Error {
  constructor(public readonly param: string) {
    super(`missing value for template param "${param}"`);
    this.name = 'MissingParamError';
  }
}

/**
 * Substitute placeholders. `urlEncode` is used for navigate URLs so a value
 * like "降噪 耳机" lands as a valid query component.
 */
export function fillPlaceholders(value: string, params: ParamValues, urlEncode = false): string {
  return value.replace(PLACEHOLDER_RE, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new MissingParamError(name);
    return urlEncode ? encodeURIComponent(v) : v;
  });
}

function fillLocator(l: Locator, params: ParamValues): Locator {
  return {
    ...l,
    name: fillPlaceholders(l.name, params),
    ...(l.textContains
      ? { textContains: l.textContains.map((t) => fillPlaceholders(t, params)) }
      : {}),
  };
}

function fillWait(w: WaitCondition | undefined, params: ParamValues): WaitCondition | undefined {
  if (!w) return undefined;
  if (w.kind === 'text') return { kind: 'text', text: fillPlaceholders(w.text, params) };
  if (w.kind === 'locator') return { kind: 'locator', target: fillLocator(w.target, params) };
  return w;
}

/** Bind a template step to concrete values (pure). */
export function instantiateStep(step: TemplateStep, params: ParamValues): TemplateStep {
  const wait = fillWait(step.wait, params);
  const withWait = <T extends object>(s: T): T => (wait ? { ...s, wait } : s);
  switch (step.op) {
    case 'navigate':
      return withWait({ op: 'navigate', url: fillPlaceholders(step.url, params, true) });
    case 'click':
      return withWait({ op: 'click', target: fillLocator(step.target, params) });
    case 'type':
      return withWait({
        op: 'type',
        target: fillLocator(step.target, params),
        text: fillPlaceholders(step.text, params),
        ...(step.submit !== undefined ? { submit: step.submit } : {}),
      });
    case 'select':
      return withWait({
        op: 'select',
        target: fillLocator(step.target, params),
        value: fillPlaceholders(step.value, params),
      });
    case 'wait_for':
      return { op: 'wait_for', wait: fillWait(step.wait, params) as WaitCondition };
    default:
      return step;
  }
}

/** Placeholder-free, stable text form of a template step for prompts and diffs. */
export function describeStep(step: TemplateStep): string {
  switch (step.op) {
    case 'navigate':
      return `打开 ${step.url}`;
    case 'click':
      return `点击 ${step.target.role}「${step.target.name}」`;
    case 'type':
      return `在 ${step.target.role}「${step.target.name}」输入 ${step.text}${step.submit ? ' 并回车' : ''}`;
    case 'select':
      return `在 ${step.target.role}「${step.target.name}」选择 ${step.value}`;
    case 'scroll':
      return `向${step.direction}滚动`;
    case 'back':
      return '后退';
    case 'wait_for':
      return '等待';
    default:
      return 'step';
  }
}
