/**
 * UI-facing task model. The real backend types (TaskStatus from the
 * orchestrator DB + ServerMessage from shared-types) are richer; this
 * is the shape the sidebar / task stream render from. G3 populates it
 * from `tasks.list` + WS events; G2 seeds mock rows of the same shape
 * so the components compile against the final contract from day one.
 */
// Phase 24 RC follow-up — `queued` is a new pre-executing state. The
// backend's TaskQueue holds tasks here when the per-task BrowserPool
// is at its 10-slot capacity; the row flips to 'executing' the moment
// a slot frees and the queue dispatches.
export type UiTaskStatus =
  | 'queued'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  /**
   * O3 — model used for this task. Inferred from `opusUsed` on the
   * server (true → 'opus', else 'sonnet'). Drives the small "Claude
   * Sonnet 4.6 · 深度思考" line under the terminal summary so users
   * can see what their task ran on.
   */
  modelLabel?: 'sonnet' | 'opus';
  /** Phase 16 — favourite ("收藏") flag. Drives the sidebar 收藏 group. */
  starred?: boolean;
  /** When the task was last starred. Cleared on unstar. */
  starredAt?: Date | null;
  /** Phase 16 — external project id (prj_…), or null if unfiled. */
  projectId?: string | null;
  /**
   * R7 — base64 JPEG of the per-task Brave's final visible state,
   * captured pre-pool-release on supercar terminal. Drives the
   * BrowserPanel's "post-completion evidence" view so a refresh
   * shows what the agent was looking at when it finished, not a
   * blank panel that re-tries the screencast WS in vain.
   */
  finalScreenshot?: string;
  /** R7 — URL the per-task Brave was on at terminal. */
  finalUrl?: string;
  /**
   * P2-A — what kind of input the agent is waiting on while
   * `status === 'awaiting_user'`. Drives the BrowserPanel's verify
   * banner / auto-expand: only non-`clarification` kinds need the
   * panel to take over the screen. Missing == 'clarification'
   * (chat composer is enough).
   */
  awaitingKind?: 'clarification' | 'login' | 'captcha' | 'permission' | 'browser_action';
  /**
   * Which dispatcher lane this task is running in. Source order:
   *   - `result.executionMode` (set on awaiting_user park from generate)
   *   - `result.metadata.executionMode` (set on terminal persist)
   *   - inferred from streaming/progress events (any incoming delta
   *     is a strong signal it's a non-browser runner)
   * Drives the BrowserPanel's gate: only `browser` connects the
   * screencast WS and renders the URL bar / stop / frame counter.
   * Undefined for tasks that just started and haven't streamed
   * yet — the panel falls through to the streamingByTask signal in
   * that window.
   */
  executionMode?: 'browser' | 'generate' | 'scrape';
  /**
   * Phase 4 R1 — terminal metadata.attachments[] hydrated from
   * `tasks.detail.result.metadata.attachments` (L1 auto-screenshot
   * + L2 save_page_as_pdf outputs). Empty / undefined means no
   * downloadable artifacts; the AttachmentBar in TerminalSummary
   * hides itself in that case.
   *
   * NOT populated by the live `server.task.terminal` WS frame —
   * the SPA waits for the lazy tasks.detail hydration that already
   * brings finalScreenshot / finalUrl in.
   */
  attachments?: ReadonlyArray<UiTerminalAttachment>;
  /**
   * Phase 4 R1 — expert workflow id stamped under metadata when the
   * supercar ran a typed workflow (douyin-review / content-topic /
   * ecom-daily). Drives the expert-report header above the markdown
   * body so users see "📈 电商日报" / "📝 选题分析" rather than a
   * raw block of prose. Undefined for normal browser / generate tasks.
   */
  expertWorkflowId?: string;
}

/**
 * Phase 4 R1 — one downloadable artifact attached to a terminal
 * task. Shape mirrors the orchestrator-side write in tasks.ts
 * (search for `metadata.attachments = [...]`). `expiresAt` is a
 * pre-serialised ISO string; the SPA never parses it but renders
 * it for the user in the AttachmentBar.
 */
export interface UiTerminalAttachment {
  fileId: string;
  downloadUrl: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  expiresAt: string;
  /**
   * 'screenshot' (L1 auto-save) or 'pdf' (L2 save_page_as_pdf).
   * Other strings tolerated — the renderer falls through to a
   * generic file icon.
   */
  kind: string;
}

/**
 * Phase 16 — user-owned project metadata fetched from
 * `projects.list`. Drives the sidebar 项目 list and the
 * ProjectView's header.
 */
export interface UiProject {
  projectId: string;
  name: string;
  description: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  taskCount: number;
}

/**
 * Phase 16 — one entry on the SkillsPage. `enabled` reflects the
 * server's view of users.selected_roles; `toggle()` mutates it.
 */
export interface UiSkill {
  id: string;
  name: string;
  /** lucide-react export name. Resolved client-side via a static lookup. */
  icon: string;
  category:
    | '运营'
    | '内容'
    | '商业分析'
    | '产品'
    | '法律'
    | '人力'
    | '行政'
    | '财务'
    | '翻译'
    | '其他';
  description: string;
  enabled: boolean;
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
  /**
   * P2-A — kind of input we're waiting on. The store mirrors this
   * onto the task's awaitingKind so refreshing tasks.detail
   * preserves the BrowserPanel's expand/banner decision.
   */
  awaitingKind?: 'clarification' | 'login' | 'captcha' | 'permission' | 'browser_action';
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
  /**
   * Search-engine sources Claude saw for this query. Backend extracts
   * these from `web_search_tool_result` content blocks and attaches
   * to the event. Optional because they only land after the API
   * returns the result block (which may arrive a beat after the
   * `web_search` server_tool_use event itself).
   */
  sources?: ReadonlyArray<{ title: string; url: string; snippet?: string }>;
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
  // 'awaiting_user' counts as active — task is paused on a user
  // question, not finished. Sidebar's StatusDot uses this to render
  // the row with a non-terminal style; the row's hover preview also
  // uses it for live-task affordances.
  return (
    status === 'queued' ||
    status === 'executing' ||
    status === 'awaiting_user' ||
    status === 'paused'
  );
}
