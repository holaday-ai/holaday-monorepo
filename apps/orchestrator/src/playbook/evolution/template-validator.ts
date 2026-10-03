import { classifyExplorerAction } from '../explorer/explorer-guards.js';
import { normaliseRole, normaliseText } from './locator.js';
import {
  type Locator,
  PLACEHOLDER_RE,
  type ParamValues,
  type PathTemplate,
  type TemplateStep,
  type WaitCondition,
  fillPlaceholders,
  pathTemplateSchema,
  placeholdersIn,
  templatePlaceholders,
} from './path-template.js';
import type { Trajectory, TrajectoryStep } from './trajectory.js';

/**
 * Batch 06 — DETERMINISTIC template verification.
 *
 * Whatever produced the template (Qwen or the diff fallback), it is accepted
 * only if, for EVERY source trajectory, there is one consistent binding of its
 * params that reproduces that trajectory exactly: same ops, same role+name
 * targets, same typed/selected values, same URLs. On top of that:
 *   - declared params == placeholders used (no orphans either way);
 *   - typed text is always a param (a user's typed value is never baked in);
 *   - no step may be sensitive (login / pay / order / submit …) per the
 *     explorer's Sensitive Site Protocol — such paths are never auto-replayed.
 */

export type ValidationResult =
  | { ok: true; template: PathTemplate; bindings: ParamValues[] }
  | { ok: false; errors: string[] };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match `template` against `concrete`, adding to `binding`; false on mismatch/inconsistency. */
export function bindString(
  template: string,
  concrete: string,
  binding: Record<string, string>,
  opts: { caseInsensitive?: boolean } = {},
): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const t = norm(template);
  const c = norm(concrete);
  const names: string[] = [];
  let pattern = '';
  let last = 0;
  for (const m of t.matchAll(PLACEHOLDER_RE)) {
    const name = m[1] as string;
    pattern += escapeRegex(t.slice(last, m.index));
    if (names.includes(name)) pattern += `\\k<${name}>`;
    else {
      pattern += `(?<${name}>.+?)`;
      names.push(name);
    }
    last = (m.index ?? 0) + m[0].length;
  }
  pattern += escapeRegex(t.slice(last));
  const re = new RegExp(`^${pattern}$`, opts.caseInsensitive ? 'is' : 's');
  const match = re.exec(c);
  if (!match) return false;
  for (const name of names) {
    const value = match.groups?.[name] ?? '';
    const prev = binding[name];
    if (prev !== undefined && normaliseText(prev) !== normaliseText(value)) return false;
    if (prev === undefined) binding[name] = value;
  }
  return true;
}

/** Decode a URL to a comparable string ("+" → space in the query, percent-decoded). */
export function decodeUrlForCompare(url: string): string {
  try {
    const u = new URL(url);
    const query = u.search.replace(/\+/g, ' ');
    return decodeURIComponent(`${u.origin}${u.pathname}${query}`);
  } catch {
    return url;
  }
}

function sameRole(a: string, b: string): boolean {
  return normaliseRole(a) === normaliseRole(b);
}

function bindLocator(
  tpl: Locator,
  concrete: Locator,
  binding: Record<string, string>,
  where: string,
  errors: string[],
): void {
  if (placeholdersIn(tpl.role).length > 0) errors.push(`${where}: role must not be parameterised`);
  if (!sameRole(tpl.role, concrete.role))
    errors.push(`${where}: role ${tpl.role} ≠ captured ${concrete.role}`);
  if (!bindString(tpl.name, concrete.name, binding, { caseInsensitive: true }))
    errors.push(`${where}: name "${tpl.name}" does not reproduce "${concrete.name}"`);
  const capturedText = normaliseText([concrete.name, ...(concrete.textContains ?? [])].join(' '));
  for (const feature of tpl.textContains ?? []) {
    if (placeholdersIn(feature).length > 0) continue; // bound + checked at replay time
    if (!capturedText.includes(normaliseText(feature)))
      errors.push(`${where}: text feature "${feature}" absent from captured target`);
  }
}

function bindWait(
  tpl: WaitCondition | undefined,
  concrete: WaitCondition | null,
  binding: Record<string, string>,
  where: string,
  errors: string[],
): void {
  if (!tpl || tpl.kind === 'network_idle') return;
  if (!concrete || concrete.kind !== tpl.kind) {
    errors.push(`${where}: wait condition not observed in the capture`);
    return;
  }
  if (tpl.kind === 'text' && concrete.kind === 'text') {
    if (!bindString(tpl.text, concrete.text, binding, { caseInsensitive: true }))
      errors.push(`${where}: wait text does not reproduce the capture`);
  }
  if (tpl.kind === 'locator' && concrete.kind === 'locator')
    bindLocator(tpl.target, concrete.target, binding, `${where}.wait`, errors);
}

function bindStep(
  tpl: TemplateStep,
  cap: TrajectoryStep,
  binding: Record<string, string>,
  where: string,
  errors: string[],
): void {
  if (tpl.op !== cap.op) {
    errors.push(`${where}: op ${tpl.op} ≠ captured ${cap.op}`);
    return;
  }
  switch (tpl.op) {
    case 'navigate':
      if (!cap.url || !bindString(decodeUrlForCompare(tpl.url), decodeUrlForCompare(cap.url), binding))
        errors.push(`${where}: url does not reproduce the captured url`);
      break;
    case 'click':
      if (cap.locator) bindLocator(tpl.target, cap.locator, binding, where, errors);
      break;
    case 'type':
      if (cap.locator) bindLocator(tpl.target, cap.locator, binding, where, errors);
      if ((cap.value ?? '') !== '' && placeholdersIn(tpl.text).length === 0)
        errors.push(`${where}: typed text must be a param (never a baked-in user value)`);
      if (!bindString(tpl.text, cap.value ?? '', binding))
        errors.push(`${where}: typed text does not reproduce the capture`);
      if ((tpl.submit === true) !== cap.submit) errors.push(`${where}: submit flag differs`);
      break;
    case 'select':
      if (cap.locator) bindLocator(tpl.target, cap.locator, binding, where, errors);
      if (!bindString(tpl.value, cap.value ?? '', binding))
        errors.push(`${where}: selected value does not reproduce the capture`);
      break;
    default:
      break;
  }
  bindWait(tpl.wait, cap.wait, binding, where, errors);
}

function stepIsSensitive(step: TrajectoryStep): string | null {
  if (step.op === 'navigate' && step.url) {
    const v = classifyExplorerAction({ kind: 'navigate', url: step.url });
    return v.allowed ? null : v.reason;
  }
  if ((step.op === 'click' || step.op === 'type' || step.op === 'select') && step.locator) {
    const kind = step.op === 'click' ? 'click' : 'type';
    const v = classifyExplorerAction({ kind, label: step.locator.name });
    return v.allowed ? null : v.reason;
  }
  return null;
}

export function validateTemplateAgainstTrajectories(
  candidate: unknown,
  trajectories: readonly Trajectory[],
): ValidationResult {
  const parsed = pathTemplateSchema.safeParse(candidate);
  if (!parsed.success)
    return { ok: false, errors: parsed.error.issues.map((i) => `schema: ${i.path.join('.')} ${i.message}`) };
  const template = parsed.data;
  const errors: string[] = [];

  if (trajectories.length === 0) errors.push('no source trajectories');
  const declared = template.params.map((p) => p.name);
  if (new Set(declared).size !== declared.length) errors.push('duplicate param names');
  const used = templatePlaceholders(template);
  for (const name of used) if (!declared.includes(name)) errors.push(`undeclared param {{${name}}}`);
  for (const name of declared) if (!used.has(name)) errors.push(`unused param ${name}`);

  const bindings: ParamValues[] = [];
  trajectories.forEach((t, ti) => {
    if (t.siteDomain !== template.siteDomain) errors.push(`trajectory ${ti}: site ${t.siteDomain} ≠ ${template.siteDomain}`);
    for (const step of t.steps) {
      const reason = stepIsSensitive(step);
      if (reason) errors.push(`trajectory ${ti}: sensitive step (${reason})`);
    }
    if (t.steps.length !== template.steps.length) {
      errors.push(`trajectory ${ti}: ${t.steps.length} steps ≠ template ${template.steps.length}`);
      return;
    }
    const binding: Record<string, string> = {};
    template.steps.forEach((step, si) => {
      bindStep(step, t.steps[si] as TrajectoryStep, binding, `trajectory ${ti} step ${si}`, errors);
    });
    for (const name of declared) if (binding[name] === undefined) errors.push(`trajectory ${ti}: param ${name} unbound`);
    const evidence = t.outcome?.evidenceTexts ?? [];
    for (const text of template.success?.textContains ?? []) {
      if (evidence.length === 0) continue; // no captured evidence to check against
      let expected: string;
      try {
        expected = normaliseText(fillPlaceholders(text, binding));
      } catch {
        continue; // unbound param already reported above
      }
      if (!evidence.some((e) => normaliseText(e).includes(expected)))
        errors.push(`trajectory ${ti}: success text "${text}" not in captured evidence`);
    }
    bindings.push(binding);
  });

  return errors.length > 0 ? { ok: false, errors: [...new Set(errors)] } : { ok: true, template, bindings };
}
