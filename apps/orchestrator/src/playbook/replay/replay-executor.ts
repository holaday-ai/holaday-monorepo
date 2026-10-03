import { locatorForElement, normaliseText, resolveLocator } from '../evolution/locator.js';
import {
  type Locator,
  type ParamValues,
  type PathTemplate,
  type TemplateStep,
  type WaitCondition,
  fillPlaceholders,
  instantiateStep,
} from '../evolution/path-template.js';
import { classifyExplorerAction } from '../explorer/explorer-guards.js';
import type { BrowserSnapshot, PlaybookBrowserTools, SnapshotElement } from './browser-tools.js';

/**
 * Batch 06 — deterministic replay of a verified operation-path template, with
 * model-assisted LOCAL repair.
 *
 * Every step runs WITHOUT the model: role+name resolution against a fresh
 * snapshot, the browser-tool call, then the step's wait condition. Only when a
 * step fails is the current snapshot handed to a `StepRepairer` (Qwen in
 * production) which may point at ONE element; that choice is re-checked
 * deterministically (exists, not sensitive, same op) before it is executed.
 * A run that needed repairs and still met the template's success evidence
 * yields `repairedTemplate` — the caller persists it as a new path version.
 */

export const DEFAULT_LOCATOR_WAIT_MS = 5_000;
const LOCATOR_POLL_MS = 150;

export interface RepairRequest {
  stepIndex: number;
  /** The instantiated (param-bound) step that failed. */
  step: TemplateStep;
  error: string;
  snapshot: BrowserSnapshot;
  capabilityDescription: string;
}

/** The repairer names the element the failed step should act on, or gives up. */
export interface StepRepairer {
  repair(request: RepairRequest): Promise<{ ref: string } | null>;
}

export type ReplayOutcome = 'success' | 'repaired' | 'failed';

export interface ReplayResult {
  outcome: ReplayOutcome;
  stepsTotal: number;
  stepsDeterministic: number;
  stepsRepaired: number;
  /** Model calls made by THIS replay (repairs only). */
  modelCalls: number;
  failedStepIndex?: number;
  failureReason?: string;
  repairedTemplate?: PathTemplate;
  evidence: { finalUrl: string | null; matchedSuccessTexts: string[] };
  durationMs: number;
}

export interface ExecuteTemplateInput {
  tools: PlaybookBrowserTools;
  template: PathTemplate;
  params: ParamValues;
  repairer?: StepRepairer | null;
  /** Max model repairs per run (default 2). */
  maxRepairs?: number;
  locatorWaitMs?: number;
  now?: () => number;
}

class StepFailure extends Error {
  constructor(
    public readonly kind: 'locator_not_found' | 'action_failed' | 'wait_failed' | 'missing_param',
    message: string,
  ) {
    super(message);
    this.name = 'StepFailure';
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function resolveWithin(
  tools: PlaybookBrowserTools,
  locator: Locator,
  timeoutMs: number,
): Promise<{ element: SnapshotElement; snapshot: BrowserSnapshot }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await tools.snapshot();
    const res = resolveLocator(snapshot, locator);
    if (res.kind === 'found') return { element: res.element, snapshot };
    if (Date.now() >= deadline)
      throw new StepFailure('locator_not_found', `no ${locator.role} named "${locator.name}"`);
    await sleep(LOCATOR_POLL_MS);
  }
}

async function performWait(
  tools: PlaybookBrowserTools,
  wait: WaitCondition | undefined,
  timeoutMs: number,
): Promise<void> {
  if (!wait) return;
  try {
    if (wait.kind === 'text') await tools.wait_for({ text: wait.text, timeoutMs });
    else if (wait.kind === 'network_idle') await tools.wait_for({ network_idle: true, timeoutMs });
    else await resolveWithin(tools, wait.target, timeoutMs);
  } catch (err) {
    throw new StepFailure('wait_failed', `wait failed: ${errText(err)}`);
  }
}

async function actOnRef(
  tools: PlaybookBrowserTools,
  step: TemplateStep,
  ref: string,
): Promise<void> {
  try {
    if (step.op === 'click') await tools.click(ref);
    else if (step.op === 'type') await tools.type(ref, step.text, step.submit);
    else if (step.op === 'select') await tools.select(ref, step.value);
  } catch (err) {
    throw new StepFailure('action_failed', `${step.op} failed: ${errText(err)}`);
  }
}

async function runStep(
  tools: PlaybookBrowserTools,
  step: TemplateStep,
  waitMs: number,
): Promise<void> {
  switch (step.op) {
    case 'navigate':
      try {
        await tools.navigate(step.url);
      } catch (err) {
        throw new StepFailure('action_failed', `navigate failed: ${errText(err)}`);
      }
      break;
    case 'click':
    case 'type':
    case 'select': {
      const { element } = await resolveWithin(tools, step.target, waitMs);
      await actOnRef(tools, step, element.ref);
      break;
    }
    case 'scroll':
      await tools.scroll({
        direction: step.direction,
        ...(step.amount ? { amount: step.amount } : {}),
      });
      break;
    case 'back':
      await tools.back();
      break;
    case 'wait_for':
      break; // the wait itself runs below
    default:
      break;
  }
  await performWait(tools, step.wait, waitMs);
}

function isTargetStep(step: TemplateStep): step is Extract<TemplateStep, { target: Locator }> {
  return step.op === 'click' || step.op === 'type' || step.op === 'select';
}

/** Re-insert placeholders into a repaired element name so the new version stays generic. */
function retemplatiseName(name: string, original: Locator, params: ParamValues): string {
  let out = name;
  for (const [key, value] of Object.entries(params)) {
    if (!value || !original.name.includes(`{{${key}}}`)) continue;
    const re = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, `{{${key}}}`);
  }
  return out;
}

async function checkSuccess(
  tools: PlaybookBrowserTools,
  template: PathTemplate,
  params: ParamValues,
  waitMs: number,
): Promise<{ ok: boolean; finalUrl: string | null; matched: string[]; reason?: string }> {
  const snapshot = await tools.snapshot();
  const matched: string[] = [];
  for (const raw of template.success?.textContains ?? []) {
    const text = fillPlaceholders(raw, params);
    try {
      await tools.wait_for({ text, timeoutMs: waitMs });
      matched.push(text);
    } catch {
      return {
        ok: false,
        finalUrl: snapshot.url,
        matched,
        reason: `success text "${text}" not found`,
      };
    }
  }
  if (template.success?.urlContains) {
    const expected = fillPlaceholders(template.success.urlContains, params);
    if (!decodeURIComponent(snapshot.url).includes(expected))
      return { ok: false, finalUrl: snapshot.url, matched, reason: `url lacks "${expected}"` };
  }
  return { ok: true, finalUrl: snapshot.url, matched };
}

export async function executePathTemplate(input: ExecuteTemplateInput): Promise<ReplayResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const { tools, template, params } = input;
  const waitMs = input.locatorWaitMs ?? DEFAULT_LOCATOR_WAIT_MS;
  const maxRepairs = input.maxRepairs ?? 2;
  let modelCalls = 0;
  let stepsDeterministic = 0;
  let stepsRepaired = 0;
  const patchedSteps: TemplateStep[] = [...template.steps];

  const fail = (
    stepIndex: number,
    reason: string,
    finalUrl: string | null = null,
  ): ReplayResult => ({
    outcome: 'failed',
    stepsTotal: template.steps.length,
    stepsDeterministic,
    stepsRepaired,
    modelCalls,
    failedStepIndex: stepIndex,
    failureReason: reason.slice(0, 255),
    evidence: { finalUrl, matchedSuccessTexts: [] },
    durationMs: now() - started,
  });

  for (let i = 0; i < template.steps.length; i += 1) {
    const raw = template.steps[i] as TemplateStep;
    let step: TemplateStep;
    try {
      step = instantiateStep(raw, params);
    } catch (err) {
      return fail(i, `missing_param: ${errText(err)}`);
    }
    try {
      await runStep(tools, step, waitMs);
      stepsDeterministic += 1;
    } catch (err) {
      const failure =
        err instanceof StepFailure ? err : new StepFailure('action_failed', errText(err));
      const repairable =
        isTargetStep(step) &&
        (failure.kind === 'locator_not_found' || failure.kind === 'action_failed');
      if (!repairable || !input.repairer || modelCalls >= maxRepairs)
        return fail(i, `${failure.kind}: ${failure.message}`);

      // ---- local model repair --------------------------------------------
      const snapshot = await tools.snapshot();
      modelCalls += 1;
      let proposal: { ref: string } | null = null;
      try {
        proposal = await input.repairer.repair({
          stepIndex: i,
          step,
          error: failure.message,
          snapshot,
          capabilityDescription: template.description,
        });
      } catch (repairErr) {
        return fail(i, `repair_error: ${errText(repairErr)}`, snapshot.url);
      }
      const element = proposal ? snapshot.elements.find((e) => e.ref === proposal?.ref) : undefined;
      if (!element) return fail(i, `repair_declined: ${failure.message}`, snapshot.url);
      const verdict = classifyExplorerAction({
        kind: step.op === 'click' ? 'click' : 'type',
        label: element.name,
      });
      if (!verdict.allowed)
        return fail(i, `repair_rejected_sensitive: ${verdict.reason}`, snapshot.url);
      try {
        await actOnRef(tools, step, element.ref);
        await performWait(tools, step.wait, waitMs);
      } catch (retryErr) {
        return fail(i, `repair_failed: ${errText(retryErr)}`, snapshot.url);
      }
      stepsRepaired += 1;
      const original = (raw as Extract<TemplateStep, { target: Locator }>).target;
      const fresh = locatorForElement(snapshot, element);
      patchedSteps[i] = {
        ...(raw as Extract<TemplateStep, { target: Locator }>),
        target: { ...fresh, name: retemplatiseName(fresh.name, original, params) },
      } as TemplateStep;
    }
  }

  const success = await checkSuccess(tools, template, params, waitMs);
  if (!success.ok)
    return fail(
      template.steps.length,
      `success_evidence_missing: ${success.reason}`,
      success.finalUrl,
    );

  const repaired = stepsRepaired > 0;
  return {
    outcome: repaired ? 'repaired' : 'success',
    stepsTotal: template.steps.length,
    stepsDeterministic,
    stepsRepaired,
    modelCalls,
    ...(repaired ? { repairedTemplate: { ...template, steps: patchedSteps } } : {}),
    evidence: { finalUrl: success.finalUrl, matchedSuccessTexts: success.matched },
    durationMs: now() - started,
  };
}

/**
 * Model calls an unassisted agent run would have spent on the same task: one
 * browser-agent turn per action plus a final answer turn. Used for the
 * "节省的模型调用次数" dashboard metric; it is an estimate, labelled as such.
 */
export function estimateModelCallsSaved(stepsTotal: number, modelCallsUsed: number): number {
  return Math.max(0, stepsTotal + 1 - modelCallsUsed);
}

/** Text helper shared with the repairer prompt. */
export function snapshotForPrompt(snapshot: BrowserSnapshot, max = 150): string {
  return snapshot.elements
    .slice(0, max)
    .map(
      (e) =>
        `${e.ref} ${e.role} "${e.name}"${e.text && normaliseText(e.text) !== normaliseText(e.name) ? ` text="${e.text.slice(0, 80)}"` : ''}`,
    )
    .join('\n');
}
