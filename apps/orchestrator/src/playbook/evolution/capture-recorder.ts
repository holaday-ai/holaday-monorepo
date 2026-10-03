import { REDACTED_INPUT_VALUE, redactTypedValue } from '../action-capture-redaction.js';
import type { BrowserSnapshot, SnapshotElement } from '../replay/browser-tools.js';
import type { CreateActionCaptureInput } from '../task-action-capture-repository.js';
import { locatorForElement } from './locator.js';
import type { WaitCondition } from './path-template.js';
import type { CaptureReplayDescriptor, TrajectoryOutcome } from './trajectory.js';

/**
 * Batch 06 — 捕获: turn the unified browser tool calls of the cloud (batch-04)
 * and extension executors into `task_action_captures` rows carrying the 0062
 * replay descriptor (role+name locator + wait condition) and, at the end of a
 * successful task, its result evidence.
 *
 * Integration (see batch-06 report): the executor builds ONE recorder per task
 * when ACTION_CAPTURE is on, calls `recordToolCall` after every successful
 * tool call (passing the snapshot the ref was taken from), and calls
 * `recordOutcome` once the task finishes `completed`. Writes are best-effort —
 * a capture failure never affects the task.
 */

export type ExecutorSource = 'cloud' | 'extension';

export interface CapturedToolCall {
  op: 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'back' | 'wait_for';
  /** Element ref the call acted on (click/type/select). */
  ref?: string;
  /** The snapshot `ref` came from — required to derive a stable locator. */
  snapshot?: BrowserSnapshot;
  /** navigate target. */
  url?: string;
  /** typed text (type). */
  text?: string;
  submit?: boolean;
  /** chosen value (select). */
  value?: string;
  /** Wait condition the executor observed/used after the call. */
  wait?: WaitCondition;
  /** Page URL at call time (site attribution for non-navigate steps). */
  pageUrl?: string;
}

export interface CaptureSink {
  create(input: CreateActionCaptureInput): Promise<unknown>;
  setOutcome(taskId: number, outcome: unknown): Promise<void>;
}

export function siteDomainOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Redaction for a typed value, fail-safe: the field's input type must be KNOWN
 * (from the snapshot) and not sensitive, otherwise the value is redacted.
 */
export function redactForElement(element: SnapshotElement | undefined, text: string): string {
  if (!element || !element.inputType) return REDACTED_INPUT_VALUE;
  return (
    redactTypedValue(
      {
        type: element.inputType,
        autocomplete: element.autocomplete ?? null,
        name: element.name,
        ariaLabel: element.name,
      },
      text,
    ) ?? REDACTED_INPUT_VALUE
  );
}

/** Pure: one tool call → capture row input (minus task id / index). */
export function describeToolCall(
  call: CapturedToolCall,
): Omit<CreateActionCaptureInput, 'taskId' | 'actionIndex'> {
  const element =
    call.ref && call.snapshot ? call.snapshot.elements.find((e) => e.ref === call.ref) : undefined;
  const locator = element && call.snapshot ? locatorForElement(call.snapshot, element) : undefined;
  const descriptor: CaptureReplayDescriptor = {
    op: call.op,
    ...(locator ? { locator } : {}),
    ...(call.wait ? { wait: call.wait } : {}),
    ...(call.submit ? { submit: true } : {}),
  };
  let inputValue: string | null = null;
  if (call.op === 'type') inputValue = redactForElement(element, call.text ?? '');
  if (call.op === 'select') inputValue = call.value ?? null;
  return {
    siteDomain: siteDomainOf(
      call.op === 'navigate' ? call.url : (call.pageUrl ?? call.snapshot?.url),
    ),
    stepType: call.op,
    visibleText: element?.name ?? null,
    entryUrl: call.op === 'navigate' ? (call.url ?? null) : null,
    inputValue,
    replayJson: descriptor,
  };
}

export class BrowserActionCaptureRecorder {
  private actionIndex = 0;

  constructor(
    private readonly sink: CaptureSink,
    private readonly opts: {
      taskId: number;
      executorSource: ExecutorSource;
      onError?: (err: unknown) => void;
    },
  ) {}

  async recordToolCall(call: CapturedToolCall): Promise<void> {
    const actionIndex = this.actionIndex++;
    try {
      await this.sink.create({
        ...describeToolCall(call),
        taskId: this.opts.taskId,
        actionIndex,
        executorSource: this.opts.executorSource,
      });
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  /** Call once, only when the task finished successfully. */
  async recordOutcome(outcome: TrajectoryOutcome): Promise<void> {
    try {
      await this.sink.setOutcome(this.opts.taskId, {
        ...(outcome.finalUrl ? { finalUrl: outcome.finalUrl } : {}),
        evidenceTexts: (outcome.evidenceTexts ?? []).slice(0, 5).map((t) => t.slice(0, 200)),
      });
    } catch (err) {
      this.opts.onError?.(err);
    }
  }
}
