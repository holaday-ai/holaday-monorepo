/**
 * UI-facing task model. The real backend types (TaskStatus from the
 * orchestrator DB + ServerMessage from shared-types) are richer; this
 * is the shape the sidebar / task stream render from. G3 populates it
 * from `tasks.list` + WS events; G2 seeds mock rows of the same shape
 * so the components compile against the final contract from day one.
 */
export type UiTaskStatus = 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface UiTask {
  taskId: string;
  intent: string;
  /** User-renamed display title. Falls back to summariseIntent(intent) when null. */
  title: string | null;
  status: UiTaskStatus;
  /** Observed tick count — shown in the sidebar subtitle. */
  tickCount: number;
  /** Terminal summary (completed) or failure reason (failed/paused). */
  resultText?: string;
  createdAt: Date;
  /**
   * G6: position in the per-user FIFO queue as reported at enqueue
   * time. 1 = running now; 2+ = queued that many slots back. Cleared
   * once the first tick.start lands (task is actually executing).
   */
  queuePosition?: number;
  /**
   * Phase 13 Dim 1 — pre-execution plan body (markdown). Set on
   * `server.task.plan` arrival or hydrated from tasks.detail.
   * Absent for simple-search / trivial intents that skip plan.
   */
  planText?: string;
  /** Per-step status array, parallel to the bullet list count. */
  planStatus?: Array<{
    idx: number;
    status: 'pending' | 'running' | 'done' | 'failed';
    note?: string;
  }>;
}

/**
 * One row in the step stream for a task. `running` steps come from
 * `server.vision.tick.start` and flip to `done` or `failed` on
 * `server.vision.tick.end`. `startedAt` is a client-side timestamp
 * used to show an in-flight timer before the tick end lands.
 */
export interface UiStep {
  tickIndex: number;
  status: 'running' | 'done' | 'failed';
  actionKind?: string;
  actionSummary?: string;
  durationMs?: number;
  message?: string;
  startedAt: number;
  /**
   * Layer 3 anti-bot marker. Set when the orchestrator's detector
   * classified this tick's error or snapshot as a captcha / verify /
   * block / cloudflare signal. Drives the orange warning badge in
   * StepCard.
   */
  antiBot?: {
    type: 'captcha' | 'verify' | 'block' | 'cloudflare';
    confidence: 'high' | 'medium';
    message: string;
  };
}

/**
 * Latest screencast frame observed for a task — rendered into the
 * right-hand BrowserPanel. We keep only the newest frame per task;
 * older frames fall out of memory with the next tick.
 */
export interface UiScreencast {
  tickIndex: number;
  imageBase64: string;
  url: string;
  viewport: { width: number; height: number };
  timestamp: string;
}

/**
 * Layer 4: captcha-wait state for a task. Populated when the
 * orchestrator broadcasts `captcha_detected` and cleared by
 * `captcha_resolved`. The UI uses this to swap in a warning banner
 * and pulse the browser panel.
 */
export interface UiCaptchaWait {
  antiBotType: 'captcha' | 'verify' | 'block' | 'cloudflare';
  message: string;
  /** Absolute timestamp when the wait will give up. */
  deadlineMs: number;
  startedAt: number;
}

/**
 * Layer 5: fallback notice for a task. Set once the orchestrator
 * swaps transports (Playwright → extension WS/SW) due to repeated
 * anti-bot strikes. Sticky for the lifetime of the task — we don't
 * clear it if subsequent ticks succeed.
 */
export interface UiDegradeEvent {
  level: number;
  strategy: string;
  ok: boolean;
  message: string;
  handoffToExtension?: boolean;
  nextUrl?: string;
  at: number;
}

export interface UiExecutorFallback {
  /**
   * true  → swap actually took effect; runner is now using the
   *         extension transport.
   * false → no extension client connected; swap didn't happen and
   *         the UI should prompt the user to install / open it.
   */
  available: boolean;
  at: number;
}

/**
 * Supercar: agent asked the user a follow-up question and the loop is
 * parked until they reply. Cleared once tasks.reply lands a message.
 */
export interface UiAwaitingUser {
  question: string;
  at: number;
}

/**
 * Supercar: web_search events arrive independently of tick ticks (the
 * search is server-side; there's no DOM to screencast). We log the last
 * few so the UI can show "Claude 正在搜索 …" without cluttering steps.
 */
export interface UiWebSearchEvent {
  iteration: number;
  query: string;
  at: number;
}

/**
 * Supercar: summarised extended-thinking text for the most recent
 * iteration. Rendered in a collapsible card so operators can inspect
 * Claude's reasoning without it dominating the stream.
 */
export interface UiThinkingEvent {
  summary: string;
  at: number;
}

export function isActive(status: UiTaskStatus): boolean {
  return status === 'executing' || status === 'paused';
}
