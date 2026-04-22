/**
 * Vision-loop task runner for the orchestrator — the glue between
 * tRPC `tasks.create` (which starts a task) and the WS-backed
 * VisionLoopRunner (which drives the per-tick observe → decide → act
 * cycle).
 *
 * Responsibilities:
 *   - Build a `VisionLoopRunner` wired to the WS request/response
 *     plumbing (screenshotFn / actionFn) and the user's commander.
 *   - Kick it off asynchronously; `startVisionLoopTask` returns the
 *     outcome promise so callers can persist the terminal state.
 *   - Emit per-tick side effects (llm_calls rows land in a separate
 *     commit). For Phase A Day 3 item 2 we just connect the pipes;
 *     DB persistence of the decision stream comes in item 3.
 *
 * Kept deliberately thin. Anything cross-cutting (rate limits, per-
 * user quotas, batch-confirm gates) lives either in the commander
 * or in higher-level orchestration that wraps this function.
 */

import {
  dispatchVisionActionToSW,
  hasConnectedSwClient,
  requestVisionObservationFromSW,
} from '../../ws/server.js';
import { logger } from '../../config/logger.js';
import {
  type AntiBotSignal,
  describeSignal,
  detectAntiBot,
  detectFromSnapshot,
} from './anti-bot-detector.js';
import type { VisionLoopCommander } from './commander.js';
import { DegradationChain, type DegradationResult } from './degradation-chain.js';
import type { PageLike, PlaywrightExecutor } from './playwright-executor.js';
import type {
  A11yActionFn,
  AccessibilityFn,
  ActionFn,
  RunOutcome,
  ScreenshotFn,
} from './runner.js';
import { VisionLoopRunner } from './runner.js';

interface Transport {
  screenshotFn: ScreenshotFn;
  actionFn: ActionFn;
  accessibilityFn?: AccessibilityFn;
  a11yActionFn?: A11yActionFn;
}

export interface StartVisionLoopTaskOptions {
  /** External (user-facing) task id — used to correlate WS frames. */
  taskId: string;
  /** External user id (usr_…) — used to select a connected SW client. */
  userId: string;
  /** Free-form user intent. */
  intent: string;
  /** Commander implementation to drive decide-next-action. */
  commander: VisionLoopCommander;
  /** Per-task loop cap. Default 30 (matches DEFAULT_MAX_VISION_STEPS). */
  maxSteps?: number;
  /** Optional Skill body as a prompt hint. */
  skillHint?: string;
  /**
   * Phase D Step 3: when set, the runner observes + acts via
   * Playwright instead of the WS → SW → CDP round-trip. On any
   * Playwright-side failure we do NOT silently fall back to WS
   * mid-task — the loop exits as failed so the operator sees what
   * broke. Fallback-on-connect-failure happens at orchestrator
   * boot, not per-task.
   */
  playwrightExecutor?: PlaywrightExecutor | null;
  /**
   * Optional per-tick observer hook — called after the commander
   * returns a decision but before the action is dispatched. Used
   * by Phase A Day 3 item 3 to write an `llm_calls` row per tick.
   * Kept as a plain callback (not an event subscribe) so the caller
   * can `await` the hook before proceeding to dispatch (important
   * for correct audit ordering).
   */
  onDecision?: (info: {
    tickIndex: number;
    mode: import('./vision-mode.js').VisionMode;
    decision:
      | import('./commander.js').VisionDecision
      | import('./commander.js').AccessibilityDecision;
  }) => Promise<void> | void;
  /**
   * Fires when the runner has pulled a fresh observation for a tick
   * and is about to call the commander. G4 wires this to a
   * `server.vision.tick.start` broadcast so the web workbench can
   * append an in-progress step card.
   */
  onTickStart?: (info: {
    tickIndex: number;
    mode: import('./vision-mode.js').VisionMode;
  }) => void;
  /**
   * Fires once per tick after the turn has been recorded — covers
   * both "driver executed the action" and "commander returned a
   * terminal action" (done / give_up) paths. G4 wires this to
   * `server.vision.tick.end` so the step card can flip to its
   * final state.
   */
  onTickEnd?: (info: {
    tickIndex: number;
    mode: import('./vision-mode.js').VisionMode;
    actionKind: string;
    actionSummary: string;
    durationMs: number;
    ok: boolean;
    message?: string;
    /**
     * Layer 3: populated when the anti-bot detector matched a
     * captcha / verify / block / Cloudflare signal in either the
     * action's error message or the tick's accessibility snapshot.
     * Consumers forward it to `server.vision.tick.end.antiBot`.
     */
    antiBot?: AntiBotSignal;
  }) => void;
  /**
   * Fires right after a screenshot-mode observation lands, with the
   * raw JPEG bytes (base64, no data: prefix) + url + viewport. G5
   * wires this to a `server.vision.screencast` broadcast so the web
   * workbench can render a poor-man's screencast in the right-hand
   * panel. a11y-mode ticks have no image and skip this hook.
   */
  onScreencast?: (info: {
    tickIndex: number;
    imageBase64: string;
    url: string;
    viewportWidth: number;
    viewportHeight: number;
  }) => void;
  /**
   * Layer 4 — fires when the anti-bot detector returns a high-
   * confidence signal and the runner is about to enter the captcha-
   * wait state. Consumers broadcast `server.vision.captcha_detected`
   * so the UI can prompt the user to complete the challenge in
   * Chrome.
   */
  onCaptchaDetected?: (info: {
    antiBotType: AntiBotSignal['type'];
    message: string;
    waitTimeoutMs: number;
  }) => void;
  /**
   * Layer 4 — fires when the captcha-wait state exits, either
   * because the page's anti-bot markers disappeared (`reason='auto'`)
   * or the configured wait elapsed (`reason='timeout'`).
   */
  onCaptchaResolved?: (info: { reason: 'auto' | 'timeout' }) => void;
  /**
   * Layer 5 — fires when the strike counter crosses the fallback
   * threshold and the runner swaps transports (or tries to).
   * `available=false` means no extension client was connected, so
   * the swap didn't take effect — the UI prompts the user to
   * install / open the extension.
   */
  onExecutorFallback?: (info: { reason: 'anti-bot'; available: boolean }) => void;
  /**
   * Fires when the DegradationChain attempts a strategy after Layer 4
   * has timed out waiting for human verification. Each call represents
   * one tier: profile rotation → proxy → search-engine swap → search
   * API → extension handoff. The chain stops at the first ok:true
   * strategy; subsequent ticks continue normally.
   *
   * Routers forward this to `server.vision.degrade` so the step card
   * can display "正在尝试替代方案 (level N)".
   */
  onDegrade?: (info: DegradationResult) => void;
  /** Dependency-injection seam for tests to supply a hand-rolled chain. */
  degradationChain?: DegradationChain;
}

/**
 * Default max-wait for a user to complete a captcha challenge before
 * the runner gives up and fails the task. 120 s matches the
 * observed time-to-solve for a reCAPTCHA image grid. Overridable
 * via `CAPTCHA_WAIT_TIMEOUT_MS`.
 */
const DEFAULT_CAPTCHA_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_CAPTCHA_POLL_INTERVAL_MS = 3_000;
/**
 * Layer 5: how many high-confidence anti-bot detections to tolerate
 * before we give up on the current transport and try the extension.
 * 3 is the sweet spot — one strike might be a fluke, two could be
 * the user re-trying a page that autoloads a captcha once per visit,
 * three is a pattern.
 */
const DEFAULT_ANTI_BOT_STRIKES_BEFORE_FALLBACK = 3;

function readEnvPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Start a vision-loop task, wired to the real WS transport. Returns
 * the outcome promise — the caller persists it to tasks/task_steps.
 * Does NOT touch the DB itself (separation of concerns; the tRPC
 * handler owns user-facing persistence, this function owns the loop).
 */
export async function startVisionLoopTask(opts: StartVisionLoopTaskOptions): Promise<RunOutcome> {
  // Pick the observation + action transport. When Playwright is
  // wired at boot we go direct (no WS / SW); otherwise fall through
  // to the classic SW round-trip. The selection happens once per
  // task at start-up; we don't swap mid-loop.
  const transport: Transport = opts.playwrightExecutor
    ? buildPlaywrightTransport(opts.playwrightExecutor)
    : buildWsTransport(opts.userId, opts.taskId);

  // Park the tab on about:blank before we start so anti-bot modals
  // or half-loaded frames from the previous task can't poison this
  // one. `resetPageForTask` swallows its own failures; the typeof
  // guard keeps the older test-runner stubs happy (they pass a duck-
  // typed PlaywrightExecutor that doesn't implement the new method).
  if (opts.playwrightExecutor && typeof opts.playwrightExecutor.resetPageForTask === 'function') {
    await opts.playwrightExecutor.resetPageForTask();
  }

  // Layer 4: shared between onTickEnd (detection) and afterTickHook
  // (pause + poll). Populated by the detector when a high-confidence
  // anti-bot signal fires; consumed + cleared by the afterTickHook.
  // `null` means no pause pending.
  let pendingCaptchaSignal: AntiBotSignal | null = null;
  // Layer 5: cross-tick counter. Incremented on every high-confidence
  // detection; crossing the threshold triggers a transport swap.
  let antiBotStrikeCount = 0;
  let fallbackTriggered = false;
  // Bug 3 — DegradationChain per-task state. `lastDegradationLevel`
  // tracks which tier we've already attempted so the next invocation
  // (after the next Layer 4 timeout) escalates to the next tier
  // rather than retrying the cheapest one forever.
  const degradationChain = opts.degradationChain ?? new DegradationChain();
  let lastDegradationLevel = 0;
  const captchaWaitTimeoutMs = readEnvPositiveInt(
    'CAPTCHA_WAIT_TIMEOUT_MS',
    DEFAULT_CAPTCHA_WAIT_TIMEOUT_MS,
  );
  const captchaPollIntervalMs = readEnvPositiveInt(
    'CAPTCHA_POLL_INTERVAL_MS',
    DEFAULT_CAPTCHA_POLL_INTERVAL_MS,
  );
  const strikeThreshold = readEnvPositiveInt(
    'ANTI_BOT_STRIKES_BEFORE_FALLBACK',
    DEFAULT_ANTI_BOT_STRIKES_BEFORE_FALLBACK,
  );

  // Only Playwright transport provides the a11y pair — SW transport
  // can't serve ariaSnapshot. Runner auto-pins to screenshot mode
  // when these are undefined.
  const runner = new VisionLoopRunner({
    commander: opts.commander,
    userId: opts.userId,
    taskExternalId: opts.taskId,
    maxSteps: opts.maxSteps ?? 30,
    ...(opts.skillHint ? { skillHint: opts.skillHint } : {}),
    screenshotFn: transport.screenshotFn,
    actionFn: transport.actionFn,
    ...(transport.accessibilityFn ? { accessibilityFn: transport.accessibilityFn } : {}),
    ...(transport.a11yActionFn ? { a11yActionFn: transport.a11yActionFn } : {}),
    // Layer 4: between ticks, if the previous turn flagged a high-
    // confidence captcha signal, run the polling wait loop before
    // the next tick starts. Transport-agnostic via the accessibility
    // function — when Playwright isn't wired, the hook short-circuits
    // (no way to poll the page's snapshot).
    afterTickHook: async (_tickIndex) => {
      if (!pendingCaptchaSignal) return;
      const signal = pendingCaptchaSignal;
      pendingCaptchaSignal = null;
      opts.onCaptchaDetected?.({
        antiBotType: signal.type,
        message: `${describeSignal(signal)}（匹配：${signal.rawMatch}）`,
        waitTimeoutMs: captchaWaitTimeoutMs,
      });
      const started = Date.now();
      const deadline = started + captchaWaitTimeoutMs;
      let resolved: 'auto' | 'timeout' = 'timeout';
      // When `accessibilityFn` is absent (legacy WS transport with no
      // a11y pair), we can't poll for resolution — sleep the full
      // timeout and let the human decide. The flow still runs so the
      // UI sees captcha_detected → captcha_resolved(timeout), which
      // triggers the downstream degradation chain.
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, captchaPollIntervalMs));
        if (!transport.accessibilityFn) continue;
        try {
          const snap = await transport.accessibilityFn(-1);
          const stillThere = detectFromSnapshot(snap.snapshot);
          if (!stillThere || stillThere.confidence !== 'high') {
            resolved = 'auto';
            break;
          }
        } catch {
          // Snapshot failures are non-fatal — just try again next
          // iteration. If the whole page is unreachable we'll hit
          // the deadline and time out.
        }
      }
      opts.onCaptchaResolved?.({ reason: resolved });

      // Bug 3 integration — when the user couldn't solve it in the
      // Layer 4 window, walk the DegradationChain one tier. Per-task
      // state keeps `lastDegradationLevel` so successive timeouts
      // escalate instead of re-trying the cheapest tier forever.
      if (resolved === 'timeout') {
        const result = await degradationChain.tryNext(
          {
            taskId: opts.taskId,
            userId: opts.userId,
            intent: opts.intent,
            signal,
            executor: opts.playwrightExecutor ?? null,
            strikes: antiBotStrikeCount,
          },
          lastDegradationLevel,
        );
        if (result) {
          lastDegradationLevel = result.level;
          opts.onDegrade?.(result);
          logger.info(
            {
              taskId: opts.taskId,
              level: result.level,
              strategy: result.strategy,
              ok: result.ok,
              handoff: result.handoffToExtension ?? false,
              nextUrl: result.nextUrl ?? null,
            },
            'degradation tier attempted after Layer 4 timeout',
          );
          // If the strategy nominated a new URL, navigate there so the
          // next tick's screenshot reflects the escape. navigate() has
          // its own goto-no-op fallback.
          if (result.nextUrl && opts.playwrightExecutor) {
            try {
              const page = (await opts.playwrightExecutor.getPage()) as unknown as PageLike;
              await opts.playwrightExecutor.navigate(page, result.nextUrl);
            } catch (err) {
              logger.warn(
                { err: err instanceof Error ? err.message : String(err) },
                'degrade: post-strategy navigate failed',
              );
            }
          }
          // Extension handoff folds into existing Layer 5 plumbing.
          if (result.handoffToExtension && !fallbackTriggered && opts.playwrightExecutor) {
            fallbackTriggered = true;
            const available = hasConnectedSwClient(opts.userId);
            if (available) {
              const ws = buildWsTransport(opts.userId, opts.taskId);
              runner.setTransport({
                screenshotFn: ws.screenshotFn,
                actionFn: ws.actionFn,
              });
            }
            opts.onExecutorFallback?.({ reason: 'anti-bot', available });
          }
        }
      }
    },
  });

  if (opts.onDecision) {
    const hook = opts.onDecision;
    runner.on('decision', (ev) => {
      // Fire-and-forget — await is inside the hook implementation if
      // it needs ordering. Any thrown / rejected work is logged and
      // does NOT kill the loop.
      void Promise.resolve(hook(ev)).catch((err) => {
        // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
        console.warn('[vision-loop] onDecision hook threw', err);
      });
    });
  }

  // Per-tick streaming hooks. `tick` gives us the start timestamp;
  // `turn` (which fires for both acted + terminal paths) gives us
  // the closing action + duration. We keep the timestamps in a Map
  // keyed by tickIndex so out-of-order bookkeeping can't cross-pollute.
  if (opts.onTickStart || opts.onTickEnd) {
    const startedAt = new Map<number, number>();
    const lastMode = new Map<number, import('./vision-mode.js').VisionMode>();
    // Last accessibility snapshot per tick — fed to the anti-bot
    // detector on the matching `turn` event. Only populated in a11y
    // mode; screenshot-mode ticks don't have snapshot text.
    const lastSnapshot = new Map<number, string>();
    // Populate timing on every tick, even when onTickStart is unset —
    // onTickEnd needs it for durationMs.
    runner.on('tick', (ev) => {
      startedAt.set(ev.tickIndex, Date.now());
      lastMode.set(ev.tickIndex, ev.mode);
      if (ev.mode === 'accessibility' && ev.accessibility?.snapshot) {
        lastSnapshot.set(ev.tickIndex, ev.accessibility.snapshot);
      }
    });
    if (opts.onTickStart) {
      const hookStart = opts.onTickStart;
      runner.on('tick', (ev) => {
        try {
          hookStart({ tickIndex: ev.tickIndex, mode: ev.mode });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
          console.warn('[vision-loop] onTickStart hook threw', err);
        }
      });
    }
    if (opts.onTickEnd) {
      const hookEnd = opts.onTickEnd;
      // The runner's `turn` event carries the full AnyTurn — that
      // includes the action + executionResult for BOTH vision-mode
      // and a11y-mode turns, and fires after terminal done/give_up
      // paths too. Using it as the single "tick finished" signal
      // keeps the start/end pair well-defined even when the driver
      // is bypassed (done / give_up never hit `acted`).
      runner.on('turn', (ev) => {
        const started = startedAt.get(ev.tickIndex);
        const mode = lastMode.get(ev.tickIndex) ?? 'screenshot';
        const durationMs = started ? Date.now() - started : 0;
        const snapshot = lastSnapshot.get(ev.tickIndex) ?? null;
        startedAt.delete(ev.tickIndex);
        lastMode.delete(ev.tickIndex);
        lastSnapshot.delete(ev.tickIndex);
        const { action, executionResult } = ev.turn;
        // Layer 3 detection: scan the action's error message AND the
        // a11y snapshot (when available) for captcha / verify / block
        // / cloudflare markers. Errors win on confidence ties — a
        // "verify email" button in a snapshot is less reliable than
        // a Playwright error complaining about a security challenge.
        const antiBot = detectAntiBot({
          errorMessage: executionResult?.ok === false ? executionResult.message : null,
          snapshotText: snapshot,
        });
        try {
          hookEnd({
            tickIndex: ev.tickIndex,
            mode,
            actionKind: action.kind,
            actionSummary: describeAction(action),
            durationMs,
            ok: executionResult?.ok ?? false,
            ...(executionResult?.message ? { message: executionResult.message } : {}),
            ...(antiBot ? { antiBot } : {}),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
          console.warn('[vision-loop] onTickEnd hook threw', err);
        }
      });
    }
  }

  // Layers 4 + 5: independent turn subscription so captcha detection
  // + strike counting fire even when the caller wired only the Layer
  // 4 / 5 hooks (no onTickEnd). Reruns the same detector the
  // onTickEnd path uses above; cheap enough that double-running is
  // fine.
  if (opts.onCaptchaDetected || opts.onCaptchaResolved || opts.onExecutorFallback) {
    runner.on('turn', (ev) => {
      const exec = ev.turn.executionResult;
      const snap = 'snapshot' in ev.turn ? ev.turn.snapshot : null;
      const action = ev.turn.action;
      // wait_for_human is the commander's explicit "stop and ask the
      // user" signal. Synthesise a matching anti-bot signal so the
      // rest of the plumbing (afterTickHook's poll loop + downstream
      // hooks) works identically whether the commander or the
      // heuristic detector raised it.
      let antiBot: AntiBotSignal | null = null;
      if (action.kind === 'wait_for_human') {
        antiBot = {
          type: 'captcha',
          confidence: 'high',
          rawMatch: action.reason,
        };
      } else {
        antiBot = detectAntiBot({
          errorMessage: exec?.ok === false ? exec.message : null,
          snapshotText: snap,
        });
      }
      if (antiBot && antiBot.confidence === 'high') {
        pendingCaptchaSignal = antiBot;
        antiBotStrikeCount += 1;
        // Layer 5 trigger: crossed the strike threshold AND we
        // haven't already swapped. Only relevant when we're
        // currently on the Playwright path — if the task already
        // started on WS/SW, there's nothing to fall back TO.
        if (
          !fallbackTriggered &&
          antiBotStrikeCount >= strikeThreshold &&
          opts.playwrightExecutor
        ) {
          fallbackTriggered = true;
          const available = hasConnectedSwClient(opts.userId);
          if (available) {
            // Swap the runner's closures. The in-flight tick has
            // already fired its action; the next tick will fetch
            // observations + dispatch actions through the WS/SW
            // path, bypassing Playwright entirely.
            const ws = buildWsTransport(opts.userId, opts.taskId);
            runner.setTransport({
              screenshotFn: ws.screenshotFn,
              actionFn: ws.actionFn,
              // WS transport has no a11y pair — runner's mode
              // picker will pin to screenshot mode from here.
            });
          }
          opts.onExecutorFallback?.({ reason: 'anti-bot', available });
        }
      }
    });
  }

  // G5 screencast + G8 follow-up: every tick pushes a frame to the
  // workbench for traceability, regardless of whether the commander
  // consumed it.
  //   - screenshot mode: reuse the JPEG the commander already has
  //     (ev.observation.screenshotBase64). Zero extra cost.
  //   - accessibility mode: commander gets text only, so we fire a
  //     *display-only* screenshot via PlaywrightExecutor here. Runs
  //     concurrently with the commander call (the runner doesn't
  //     await listeners), so it doesn't stretch the tick budget.
  //
  // Best-effort: capture failures are logged and swallowed. A missing
  // screencast frame is visually noticeable (right panel shows "等待
  // 第一帧"), but MUST NOT stall the loop.
  if (opts.onScreencast) {
    const hookCast = opts.onScreencast;
    const executor = opts.playwrightExecutor ?? null;
    runner.on('tick', (ev) => {
      if (ev.mode === 'screenshot' && ev.observation) {
        try {
          hookCast({
            tickIndex: ev.tickIndex,
            imageBase64: ev.observation.screenshotBase64,
            url: ev.observation.url,
            viewportWidth: ev.observation.viewportWidth,
            viewportHeight: ev.observation.viewportHeight,
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
          console.warn('[vision-loop] onScreencast hook threw', err);
        }
        return;
      }
      if (ev.mode === 'accessibility' && executor) {
        void captureDisplayFrame(executor, ev.tickIndex, hookCast);
      }
    });
  }

  return runner.run(opts.intent);
}

/**
 * Display-only screenshot for accessibility-mode ticks. Completely
 * decoupled from the commander path — the JPEG we produce here is
 * NEVER fed back into Claude's prompt. Existence of this helper is
 * the whole point of G8: give the UI a frame even when the loop is
 * in a11y mode.
 */
async function captureDisplayFrame(
  executor: import('./playwright-executor.js').PlaywrightExecutor,
  tickIndex: number,
  hookCast: NonNullable<StartVisionLoopTaskOptions['onScreencast']>,
): Promise<void> {
  try {
    const page = (await executor.getPage()) as unknown as import('./playwright-executor.js').PageLike;
    const shot = await executor.screenshot(page);
    if (shot.error || !shot.base64) return;
    let url = '';
    try {
      url = page.url();
    } catch {
      // chrome:// and about: pages can throw; URL blank is fine.
    }
    hookCast({
      tickIndex,
      imageBase64: shot.base64,
      url,
      viewportWidth: shot.viewportWidth ?? 0,
      viewportHeight: shot.viewportHeight ?? 0,
    });
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: surfaced to orchestrator logs
    console.warn('[vision-loop] a11y-tick display screenshot failed', err);
  }
}

/**
 * Short Chinese label for an action — rendered verbatim in the
 * web workbench's step card. Covers the full VisionAction + A11yAction
 * discriminated union; unknown kinds fall through to the bare kind.
 */
function describeAction(
  action:
    | import('./actions.js').VisionAction
    | import('./actions-a11y.js').A11yAction,
): string {
  switch (action.kind) {
    case 'click':
      return `点击 (${action.x}, ${action.y})`;
    case 'type':
      return `输入：${truncate(action.text, 40)}`;
    case 'key':
      return `按键：${action.key}`;
    case 'scroll':
      return `滚动 ${action.dy}px`;
    case 'wait':
      return `等待 ${action.ms}ms`;
    case 'screenshot':
      return '截图';
    case 'done':
      return '任务完成';
    case 'give_up':
      return `放弃：${truncate(action.reason, 40)}`;
    case 'click_ref':
      return `点击元素 ${action.ref}`;
    case 'type_in_ref':
      return `在 ${action.ref} 中输入：${truncate(action.text, 40)}`;
    case 'press_key':
      return `按键：${action.key}`;
    case 'navigate':
      return `打开 ${action.url}`;
    default:
      return (action as { kind: string }).kind;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Legacy transport — keeps the classic WS/SW/CDP path working when
 * Playwright isn't available or EXECUTOR_MODE=legacy. Unchanged from
 * the pre–Step 3 implementation; factored out so the branch in
 * `startVisionLoopTask` stays clean.
 */
function buildWsTransport(
  userId: string,
  taskId: string,
): { screenshotFn: ScreenshotFn; actionFn: ActionFn } {
  const screenshotFn: ScreenshotFn = async (tickIndex) => {
    const obs = await requestVisionObservationFromSW(userId, taskId, tickIndex);
    if (obs.error) throw new Error(obs.error);
    if (!obs.screenshotBase64 || obs.viewportWidth === 0 || obs.viewportHeight === 0) {
      throw new Error(
        `malformed observation from SW at tick ${tickIndex}: empty screenshot or zero dims`,
      );
    }
    return {
      screenshotBase64: obs.screenshotBase64,
      viewportWidth: obs.viewportWidth,
      viewportHeight: obs.viewportHeight,
      url: obs.url,
      title: obs.title,
      tickIndex,
    };
  };
  const actionFn: ActionFn = async (tickIndex, action) => {
    const acted = await dispatchVisionActionToSW(userId, taskId, tickIndex, action);
    return {
      ok: acted.ok,
      ...(acted.message ? { message: acted.message } : {}),
    };
  };
  return { screenshotFn, actionFn };
}

/**
 * Playwright transport — observe + act against the user's Chrome
 * directly via CDP. No WS, no SW. Coordinate translation still
 * happens in the runner (modelCoordToReal on the click path); here
 * we just ferry the screenshot bytes / click events through
 * PlaywrightExecutor.
 *
 * The screenshot path re-uses the executor's screenshot() which
 * already produces a JPEG at quality 80; the runner's resize step
 * downstream is tolerant of that (resizeForVisionModel treats
 * small viewports as passthrough and only re-encodes when it needs
 * to shrink past MAX_LONG_EDGE).
 *
 * Action translation: VisionAction kinds map onto PlaywrightExecutor
 * methods 1:1 except `screenshot` (runner asks for fresh observation
 * on next tick — nothing for the executor to do) and terminal
 * actions (`done`/`give_up` — runner never dispatches these to
 * actionFn). `type` focuses nothing on its own, matching screenshot-
 * mode semantics: the commander is expected to click first.
 */
function buildPlaywrightTransport(executor: PlaywrightExecutor): {
  screenshotFn: ScreenshotFn;
  actionFn: ActionFn;
  accessibilityFn: import('./runner.js').AccessibilityFn;
  a11yActionFn: import('./runner.js').A11yActionFn;
} {
  const screenshotFn: ScreenshotFn = async (tickIndex) => {
    // Cast through unknown — Playwright's real Page has a richer
    // Accessibility type than PageLike's duck-typed subset.
    const page = (await executor.getPage()) as unknown as PageLike;
    const shot = await executor.screenshot(page);
    if (shot.error || !shot.base64) {
      throw new Error(`playwright screenshot failed at tick ${tickIndex}: ${shot.error ?? '?'}`);
    }
    let title = '';
    try {
      title = await page.title();
    } catch {
      // best-effort — chrome:// pages may throw
    }
    return {
      screenshotBase64: shot.base64,
      viewportWidth: shot.viewportWidth ?? 0,
      viewportHeight: shot.viewportHeight ?? 0,
      url: page.url(),
      title,
      tickIndex,
    };
  };
  const actionFn: ActionFn = async (_tickIndex, action) => {
    const page = (await executor.getPage()) as unknown as PageLike;
    switch (action.kind) {
      case 'click':
        return executor.click(page, action.x, action.y, action.button ?? 'left');
      case 'type':
        return executor.type(page, action.text);
      case 'key':
        return executor.pressKey(page, action.key);
      case 'scroll':
        return executor.scroll(page, action.dy);
      case 'navigate':
        return executor.navigate(page, action.url);
      case 'wait':
        return executor.wait(page, action.ms);
      case 'wait_for_human':
        // The driver has nothing to execute — the Layer 4 polling is
        // what actually resolves the challenge. We just ack; the
        // runner's turn subscription (below) synthesises a captcha
        // signal so the existing afterTickHook kicks in between
        // this tick and the next.
        return { ok: true, message: `wait_for_human: ${action.reason}` };
      case 'screenshot':
        return { ok: true, message: 'noop — runner re-observes on next tick' };
      case 'done':
      case 'give_up':
        return { ok: true, message: `${action.kind} terminal — no driver work` };
      default:
        return { ok: false, message: 'unknown VisionAction kind' };
    }
  };
  // ---- accessibility-mode transport ----
  // Cheap: the executor already owns accessibilitySnapshot and the
  // ref-based action dispatchers live behind `resolveRef + act`.
  const accessibilityFn: import('./runner.js').AccessibilityFn = async (tickIndex) => {
    const page = (await executor.getPage()) as unknown as PageLike;
    const snap = await executor.accessibilitySnapshot(page);
    if (snap.error) {
      throw new Error(`playwright a11y snapshot failed at tick ${tickIndex}: ${snap.error}`);
    }
    return {
      snapshot: snap.text,
      refs: snap.refs,
      url: snap.url,
      title: snap.title,
    };
  };
  const a11yActionFn: import('./runner.js').A11yActionFn = async (_tickIndex, action) => {
    const page = (await executor.getPage()) as unknown as PageLike;
    switch (action.kind) {
      case 'click_ref': {
        // Resolve the ref by role+name from the current snapshot, then
        // page.getByRole({name}) click. Same locator rules screen-
        // reader users see; no coord math.
        const snap = await executor.accessibilitySnapshot(page);
        const info = snap.refs.find((r) => r.ref === action.ref);
        if (!info) return { ok: false, message: `ref ${action.ref} not in current snapshot` };
        return executor.clickByRoleName(page, info.role, info.name);
      }
      case 'type_in_ref': {
        const snap = await executor.accessibilitySnapshot(page);
        const info = snap.refs.find((r) => r.ref === action.ref);
        if (!info) return { ok: false, message: `ref ${action.ref} not in current snapshot` };
        const clickRes = await executor.clickByRoleName(page, info.role, info.name);
        if (!clickRes.ok) return clickRes;
        return executor.type(page, action.text);
      }
      case 'press_key':
        return executor.pressKey(page, action.key);
      case 'scroll':
        return executor.scroll(page, action.dy);
      case 'wait':
        return executor.wait(page, action.ms);
      case 'screenshot':
        return { ok: true, message: 'noop — runner re-observes on next tick' };
      case 'navigate':
        try {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          return { ok: true, message: `navigated to ${action.url}` };
        } catch (err) {
          return {
            ok: false,
            message: `goto failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      case 'wait_for_human':
        return { ok: true, message: `wait_for_human: ${action.reason}` };
      case 'done':
      case 'give_up':
        return { ok: true, message: `${action.kind} terminal — no driver work` };
      default:
        return { ok: false, message: 'unknown A11yAction kind' };
    }
  };
  return { screenshotFn, actionFn, accessibilityFn, a11yActionFn };
}
