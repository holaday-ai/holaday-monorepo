import { createHash } from 'node:crypto';
import { REDACTED_INPUT_VALUE } from '../action-capture-redaction.js';
import { normaliseRole, normaliseText } from './locator.js';
import {
  type Locator,
  type TemplateOp,
  type WaitCondition,
  locatorSchema,
  waitConditionSchema,
} from './path-template.js';

/**
 * Batch 06 — a successful task's captured browser trajectory in the shape the
 * sediment step consumes: intent → site → steps (role+name locator + wait
 * condition) → result evidence. Built from `task_action_captures` rows whose
 * 0062 `replay_json` column was written by `BrowserActionCaptureRecorder`.
 */

export interface TrajectoryStep {
  op: TemplateOp;
  locator: Locator | null;
  /** navigate target URL. */
  url: string | null;
  /** typed text (type) or chosen value (select); already redacted at capture. */
  value: string | null;
  submit: boolean;
  wait: WaitCondition | null;
}

export interface TrajectoryOutcome {
  finalUrl?: string;
  /** Short visible texts that prove the task's result (e.g. a results heading). */
  evidenceTexts?: string[];
}

export interface Trajectory {
  taskId: number;
  siteDomain: string;
  intent: string;
  steps: TrajectoryStep[];
  outcome: TrajectoryOutcome | null;
}

/** Shape persisted in `task_action_captures.replay_json` (0062). */
export interface CaptureReplayDescriptor {
  op: TemplateOp;
  locator?: Locator;
  wait?: WaitCondition;
  submit?: boolean;
}

export interface CaptureRowForTrajectory {
  taskId: number;
  actionIndex: number;
  stepType: string;
  siteDomain: string | null;
  entryUrl: string | null;
  inputValue: string | null;
  replayJson: unknown;
  outcomeJson: unknown;
}

export type TrajectoryRejectReason =
  | 'no_steps'
  | 'legacy_capture_without_locator'
  | 'redacted_input'
  | 'no_site_domain';

const REPLAYABLE_OPS: ReadonlySet<string> = new Set([
  'navigate',
  'click',
  'type',
  'select',
  'scroll',
  'back',
  'wait_for',
]);

function parseDescriptor(raw: unknown): CaptureReplayDescriptor | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.op !== 'string' || !REPLAYABLE_OPS.has(o.op)) return null;
  const locator = o.locator === undefined ? undefined : locatorSchema.safeParse(o.locator);
  const wait = o.wait === undefined ? undefined : waitConditionSchema.safeParse(o.wait);
  if (locator && !locator.success) return null;
  if (wait && !wait.success) return null;
  return {
    op: o.op as TemplateOp,
    ...(locator?.success ? { locator: locator.data } : {}),
    ...(wait?.success ? { wait: wait.data } : {}),
    ...(o.submit === true ? { submit: true } : {}),
  };
}

function parseOutcome(raw: unknown): TrajectoryOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: TrajectoryOutcome = {};
  if (typeof o.finalUrl === 'string') out.finalUrl = o.finalUrl;
  if (Array.isArray(o.evidenceTexts))
    out.evidenceTexts = o.evidenceTexts
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 5);
  return out;
}

/** Rows of ONE task → trajectory, or the reason it cannot be templated. */
export function buildTrajectory(
  task: { id: number; intent: string },
  rows: readonly CaptureRowForTrajectory[],
): { ok: true; trajectory: Trajectory } | { ok: false; reason: TrajectoryRejectReason } {
  const ordered = [...rows].sort((a, b) => a.actionIndex - b.actionIndex);
  if (ordered.length === 0) return { ok: false, reason: 'no_steps' };
  const steps: TrajectoryStep[] = [];
  let outcome: TrajectoryOutcome | null = null;
  for (const row of ordered) {
    const parsedOutcome = parseOutcome(row.outcomeJson);
    if (parsedOutcome) outcome = parsedOutcome;
    const d = parseDescriptor(row.replayJson);
    if (!d) return { ok: false, reason: 'legacy_capture_without_locator' };
    if ((d.op === 'click' || d.op === 'type' || d.op === 'select') && !d.locator)
      return { ok: false, reason: 'legacy_capture_without_locator' };
    if ((d.op === 'type' || d.op === 'select') && row.inputValue === REDACTED_INPUT_VALUE)
      return { ok: false, reason: 'redacted_input' };
    steps.push({
      op: d.op,
      locator: d.locator ?? null,
      url: d.op === 'navigate' ? row.entryUrl : null,
      value: d.op === 'type' || d.op === 'select' ? (row.inputValue ?? '') : null,
      submit: d.submit === true,
      wait: d.wait ?? null,
    });
  }
  const siteDomain = ordered.find((r) => r.siteDomain?.trim())?.siteDomain?.trim();
  if (!siteDomain) return { ok: false, reason: 'no_site_domain' };
  return {
    ok: true,
    trajectory: { taskId: task.id, siteDomain, intent: task.intent, steps, outcome },
  };
}

const TYPED_TOKEN = '‹v›';

function typedValues(t: Trajectory): string[] {
  return t.steps
    .filter((s) => s.op === 'type' && s.value && s.value.trim().length >= 2)
    .map((s) => normaliseText(s.value));
}

function maskTyped(text: string, typed: readonly string[]): string {
  let out = normaliseText(text);
  for (const v of typed) if (v) out = out.split(v).join(TYPED_TOKEN);
  return out;
}

function urlShape(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\d+/g, '#')}`;
  } catch {
    return '';
  }
}

/**
 * Structural signature of a trajectory: op sequence + target role/name, with
 * the task's own typed values masked out so "search X → click result X" and
 * "search Y → click result Y" share a skeleton. Same site + same skeleton =
 * same capability.
 */
export function trajectorySkeleton(t: Trajectory): string {
  const typed = typedValues(t);
  const parts = t.steps.map((s) => {
    if (s.op === 'navigate') return `navigate:${urlShape(s.url)}`;
    if (!s.locator) return s.op;
    return `${s.op}:${normaliseRole(s.locator.role)}:${maskTyped(s.locator.name, typed)}`;
  });
  return `${t.siteDomain}|${parts.join('>')}`;
}

export function capabilityKeyForSkeleton(skeleton: string): string {
  return `auto_${createHash('sha256').update(skeleton).digest('hex').slice(0, 16)}`;
}

export interface TrajectoryGroup {
  siteDomain: string;
  capabilityKey: string;
  skeleton: string;
  trajectories: Trajectory[];
}

/** Group by (site, skeleton); only groups with ≥ minSupport distinct tasks qualify. */
export function groupTrajectories(
  trajectories: readonly Trajectory[],
  minSupport = 2,
): TrajectoryGroup[] {
  const groups = new Map<string, TrajectoryGroup>();
  for (const t of trajectories) {
    const skeleton = trajectorySkeleton(t);
    const g = groups.get(skeleton) ?? {
      siteDomain: t.siteDomain,
      capabilityKey: capabilityKeyForSkeleton(skeleton),
      skeleton,
      trajectories: [],
    };
    if (!g.trajectories.some((x) => x.taskId === t.taskId)) g.trajectories.push(t);
    groups.set(skeleton, g);
  }
  return [...groups.values()]
    .filter((g) => g.trajectories.length >= minSupport)
    .sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey));
}
