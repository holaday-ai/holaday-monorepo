import Anthropic from '@anthropic-ai/sdk';
import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { SkillCatalogueEntry } from '../../agent/planner.js';
import { injectResolvedUrl, resolveIntentUrl } from '../../agent/url-resolver.js';
import { env as appEnv } from '../../config/env.js';
import { buildBaiduSmokePlan } from '../../agent/smoke-plans.js';
import type { PlannedStep } from '../../agent/task-controller.js';
import { TaskController } from '../../agent/task-controller.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { describeSignal } from '../../agent/vision-loop/anti-bot-detector.js';
import { classify as classifyDomain } from '../../agent/vision-loop/domain/classifier.js';
import { visionLoopTaskQueue } from '../../agent/vision-loop/task-queue.js';
import { startVisionLoopTask } from '../../agent/vision-loop/task-runner.js';
import {
  classifyAsCrossPlatformAutomation,
  classifyAsSimpleSearch,
  runSupercarTask,
  supercarAbort,
  supercarReply,
  type SupercarOutcome,
} from '../../agent/supercar/index.js';
import { skills } from '../../db/schema/skills.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { tasks as tasksTable } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { broadcastToUser, updateTaskStateForUser } from '../../ws/server.js';
import { protectedProcedure, router } from '../trpc.js';

const taskController = new TaskController();

// Module-scope Anthropic client for url-resolver. Cheap to construct
// but no reason to pay per request — cache once at import time.
const anthropicForResolver: Anthropic | null = appEnv.ANTHROPIC_API_KEY
  ? new Anthropic()
  : null;

const taskIdInput = z.object({ taskId: z.string().min(1) });

const createInput = z.object({
  intent: z.string().min(1).max(4_000),
  occupation: z.string().optional(),
});

export const tasksRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const [userRow] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    // Supercar path — Anthropic's official computer_20251124 +
    // web_search_20260209 tools driving Playwright directly, with
    // adaptive thinking + prompt caching. This is the default starting
    // with the superstar rewrite; flip AGENT_MODE=legacy to fall back
    // to the hand-rolled vision-loop. Requires a connected Playwright
    // executor — we can't run computer use without a browser.
    if (appEnv.AGENT_MODE === 'supercar' && ctx.playwrightExecutor && appEnv.ANTHROPIC_API_KEY) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);
      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        { userId: userRow.id, intent: input.intent },
      );

      const classification = classifyDomain(input.intent);
      ctx.logger.info(
        { taskId, domain: classification.domain, confidence: classification.confidence },
        'supercar: task domain classified',
      );

      const userId = ctx.userId;
      const [taskDbRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, taskId))
        .limit(1);
      const taskDbId = taskDbRow?.id;

      // Phase 8.1: HEADED Brave is the primary browser. Phase 6-2
      // shipped with headless as primary + headed as a stuck/anti-bot
      // fallback, but that meant the user watched the Panel VNC stream
      // (wired to the headed Xvfb) while the agent was actually
      // driving the hidden headless instance — they never matched
      // up in the UI. Demoting headless to "last-resort fallback"
      // makes the UI stream and the agent's focus the same browser.
      //
      // Empty headed lane (dev boxes without Xvfb + Brave) falls back
      // to headless → plain injected executor → router-less deploy
      // ancestor. Each null just hops to the next layer.
      const headedExec = ctx.executionRouter?.getExecutor('headed') ?? null;
      const headlessExec =
        ctx.executionRouter?.getExecutor('headless') ?? ctx.playwrightExecutor ?? null;

      // Phase 8.2: when the caller is in MULTI_USER_USERS allow-list,
      // replace the shared headed singleton with their own pool slot.
      // The pool's executor is a freshly-connected PlaywrightExecutor
      // pointing at a dedicated Brave + Xvfb + VNC quartet — the rest
      // of the supercar loop sees a plain PlaywrightExecutor and
      // doesn't know the difference. If allocate throws (capacity
      // exceeded, spawn timeout) we surface a typed error so the UI
      // can show "browser-pool busy" rather than an opaque 500.
      let perUserExec = null;
      if (ctx.browserPool && shouldUseBrowserPool(ctx.userId)) {
        try {
          const instance = await ctx.browserPool.allocate(ctx.userId);
          perUserExec = instance.executor;
          ctx.logger.info(
            { taskId, userId: ctx.userId, cdpPort: instance.cdpPort, displayNum: instance.display },
            'pool: allocated browser for task',
          );
        } catch (err) {
          ctx.logger.error(
            { err: err instanceof Error ? err.message : String(err), userId: ctx.userId },
            'pool: allocate failed — falling back to shared headed singleton',
          );
          // Swallow + fall through: rather than hard-fail the task we
          // degrade to the shared Brave. User still gets a working
          // task; the alert-worthy event lands in logs.
        }
      }

      const primaryExecutor = perUserExec ?? headedExec ?? headlessExec;
      if (!primaryExecutor) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'no browser executor available',
        });
      }
      const runFn = () =>
        runSupercarTask({
          taskId,
          intent: input.intent,
          executor: primaryExecutor,
          domain: classification.domain,
          // Swap target: the NON-primary browser. When headed was
          // used as primary, a stuck/anti-bot signal falls back to
          // headless (in case Brave is what's being fingerprinted).
          // When headless is primary (Brave unavailable), swap
          // points at nothing — agent-loop no-ops the swap. Per-user
          // pool mode has no fallback — the user's own Brave is the
          // only tab they're watching, swapping to a shared headless
          // would stream frames of the wrong page.
          headedExecutor:
            perUserExec
              ? null
              : primaryExecutor === headedExec
                ? headlessExec ?? null
                : null,
          braveAdapter: ctx.executionRouter?.brave ?? null,
          zapierAdapter: ctx.executionRouter?.zapier ?? null,
          apifyAdapter: ctx.executionRouter?.apify ?? null,
          isSimpleSearch: classifyAsSimpleSearch(input.intent),
          isCrossPlatformAutomation: classifyAsCrossPlatformAutomation(input.intent),
          zapierWebhookPath: process.env.ZAPIER_WEBHOOK_PATH ?? null,
          onTick(ev) {
            // Synthesise a tick.start + tick.end pair per iteration so
            // the existing UI step cards light up without frontend
            // changes. actionKind is the first client-side tool the
            // model invoked this turn, or "text" when Claude just
            // spoke (e.g. mid-turn thinking → commentary).
            //
            // Also bump the per-user pool's lastActiveAt so an active
            // task never trips the 30-min idle GC — pool.touch is a
            // no-op when the user isn't on a pool slot.
            if (ctx.browserPool && perUserExec) {
              ctx.browserPool.touch(ctx.userId);
            }
            const actionKind = ev.toolsInTurn[0] ?? 'text';
            const actionSummary = ev.textPreamble
              ? truncateString(ev.textPreamble, 80)
              : ev.toolsInTurn.join(', ') || 'thinking';
            const now = Date.now();
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.start',
                taskId,
                tickIndex: ev.iteration,
                mode: 'screenshot',
              });
              broadcastToUser(userId, {
                type: 'server.vision.tick.end',
                taskId,
                tickIndex: ev.iteration,
                mode: 'screenshot',
                actionKind,
                actionSummary,
                durationMs: ev.apiLatencyMs,
                ok: true,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast tick failed');
            }
            // Persist the iteration to task_steps so history survives
            // reloads — same shape the legacy vision-loop uses.
            if (taskDbId) {
              void (async () => {
                try {
                  await ctx.db.insert(taskSteps).values({
                    externalId: newExternalId('taskStep'),
                    taskId: taskDbId,
                    seq: ev.iteration,
                    kind: actionKind,
                    status: 'done',
                    riskLevel: 'low',
                    input: { summary: actionSummary },
                    output: { apiLatencyMs: ev.apiLatencyMs, tools: ev.toolsInTurn },
                    startedAt: new Date(now - ev.apiLatencyMs),
                    completedAt: new Date(now),
                  });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId, iteration: ev.iteration },
                    'supercar: persist step failed',
                  );
                }
              })();
            }
          },
          onScreencast(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.screencast',
                taskId,
                tickIndex: ev.iteration,
                imageBase64: ev.imageBase64,
                url: ev.url,
                viewport: { width: ev.viewportWidth, height: ev.viewportHeight },
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast screencast failed');
            }
          },
          onWebSearch(ev) {
            // Broadcasts as a synthetic tick so the UI shows a step
            // card for the search. No screencast — web_search is
            // server-side and has no DOM to capture.
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.web_search',
                taskId,
                iteration: ev.iteration,
                query: ev.query,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast web_search failed');
            }
          },
          onAwaitingUser(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.awaiting_user',
                taskId,
                question: ev.question,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast awaiting_user failed');
            }
          },
          onThinking(summary) {
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.thinking',
                taskId,
                summary: truncateString(summary, 2_000),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast thinking failed');
            }
          },
          onAntiBotSignal(ev) {
            // Reuse the vision-loop captcha_detected frame shape so the
            // task-store's existing captcha-wait banner lights up
            // without any frontend changes. BrowserPanel auto-flips to
            // interactive mode (Phase 2) when this fires, so the user
            // can solve a slider captcha in-panel.
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_detected',
                taskId,
                antiBotType: ev.signal.type,
                message: describeSignal(ev.signal),
                waitTimeoutMs: ev.waitTimeoutMs,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast captcha_detected failed');
            }
          },
          onAntiBotResolved(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_resolved',
                taskId,
                reason: ev.reason,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast captcha_resolved failed');
            }
          },
        })
          .then(async (outcome) => {
            ctx.logger.info(
              { taskId, status: outcome.status, iterations: outcome.iterations, toolsUsed: outcome.toolsUsed },
              'supercar: task terminated',
            );
            await persistSupercarOutcome(repo, taskId, outcome);
            try {
              broadcastToUser(userId, buildTaskTerminalMessage(taskId, outcome));
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast terminal failed');
            }
          })
          .catch((err) => {
            ctx.logger.error({ err, taskId }, 'supercar: loop threw');
          });

      void visionLoopTaskQueue.enqueue(userId, runFn, (position) => {
        if (position > 1) {
          try {
            broadcastToUser(userId, {
              type: 'server.task.queued',
              taskId,
              position,
            });
          } catch (err) {
            ctx.logger.warn({ err, taskId }, 'supercar: broadcast queued failed');
          }
        }
      });

      return { taskId, status: 'executing' as const, steps: [] };
    }

    // Vision-loop path — the new control plane. Claude looks at each
    // tick's screenshot and picks one action at a time; there is no
    // pre-generated plan, no ResilientSelector, no Skill matching.
    // Activates when the env flag is off AND a vision commander is
    // wired at boot (needs ANTHROPIC_API_KEY). Falls through to the
    // legacy plan-once path otherwise.
    if (ctx.visionCommander) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);
      // Seed task row with status='executing' and empty plan — the
      // vision loop has no pre-planned steps; task_steps rows get
      // written as the loop progresses (Phase B: per-tick row; Phase
      // A: single synthetic row reflecting terminal outcome).
      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        { userId: userRow.id, intent: input.intent },
      );
      // Start the loop asynchronously. We return to the popup
      // immediately with the taskId; the loop proceeds in the
      // background, driven by WS round-trips to the connected SW.
      // Outcome persistence is best-effort: we log failures instead
      // of surfacing them to the caller (they already got the taskId
      // and can poll tasks.detail).
      // F3: serialise per-user through the vision-loop task queue.
      // Multiple Run clicks for the same user (popup glitch / user
      // queueing intentional follow-ups) FIFO onto a single
      // Playwright Page — no racing clicks. Different users don't
      // block each other.
      // Bug 1 — URL resolver. Turn colloquial references ("openclaw")
      // into authoritative URLs before the commander starts guessing.
      // One Claude call per task create; null on vague intents (safe
      // fall-through to the commander's search-first prompt).
      const resolved = await resolveIntentUrl(input.intent, {
        client: anthropicForResolver,
      });
      const enrichedIntent = resolved
        ? injectResolvedUrl(input.intent, resolved)
        : input.intent;
      if (resolved && resolved.source === 'model') {
        ctx.logger.info(
          { taskId, token: resolved.token, url: resolved.url },
          'urlResolve: injected resolved URL into intent',
        );
      }

      // Per-task domain specialisation. Classifier is keyword-only
      // (no LLM call), safe to run on every create. If the commander
      // supports per-task specialisation, clone it with the classified
      // domain; otherwise fall back to the generic singleton.
      const classification = classifyDomain(enrichedIntent);
      const commander = ctx.visionCommander.withDomain
        ? ctx.visionCommander.withDomain(classification.domain)
        : ctx.visionCommander;
      ctx.logger.info(
        {
          taskId,
          domain: classification.domain,
          confidence: classification.confidence,
          matched: classification.matched,
        },
        'vision-loop domain classification',
      );
      const userId = ctx.userId;
      // Resolve the tasks.id once — every onTickEnd needs it to insert
      // the task_steps row. Avoids a DB lookup on every tick.
      const [taskDbRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, taskId))
        .limit(1);
      const taskDbId = taskDbRow?.id;
      const runTaskFn = () =>
        startVisionLoopTask({
          userId: ctx.userId,
          taskId,
          // Pass the URL-enriched intent to the vision loop. The
          // *displayed* intent (saved to the tasks row above + shown
          // in the UI's user bubble) stays the user's original text.
          intent: enrichedIntent,
          commander,
          // Phase D Step 3: when PlaywrightExecutor is wired at boot,
          // the runner bypasses the WS/SW path and drives Chrome
          // directly via CDP. Falls through to the legacy WS transport
          // automatically when absent.
          ...(ctx.playwrightExecutor ? { playwrightExecutor: ctx.playwrightExecutor } : {}),
          // G4: stream per-tick progress to the web workbench. Best-
          // effort — a broadcast throw is swallowed so loop progress
          // is never gated on the UI being online.
          onTickStart(info) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.start',
                taskId,
                tickIndex: info.tickIndex,
                mode: info.mode,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId, tickIndex: info.tickIndex }, 'broadcast tick.start failed');
            }
          },
          onTickEnd(info) {
            // Bug 4 — persist every tick as a task_steps row so task
            // history survives page reloads + clicking back into old
            // tasks. Fire-and-forget: DB failure logs but must not
            // stall the loop.
            if (taskDbId) {
              void (async () => {
                try {
                  await ctx.db
                    .insert(taskSteps)
                    .values({
                      externalId: newExternalId('taskStep'),
                      taskId: taskDbId,
                      seq: info.tickIndex,
                      kind: info.actionKind,
                      status: info.ok ? 'done' : 'failed',
                      riskLevel: 'low',
                      input: { summary: info.actionSummary },
                      output: {
                        durationMs: info.durationMs,
                        mode: info.mode,
                        ...(info.message ? { message: info.message } : {}),
                        ...(info.antiBot ? { antiBot: info.antiBot } : {}),
                      },
                      ...(info.ok ? {} : { errorMessage: (info.message ?? '').slice(0, 2000) }),
                      startedAt: new Date(Date.now() - info.durationMs),
                      completedAt: new Date(),
                    });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId, tickIndex: info.tickIndex },
                    'persist step row failed',
                  );
                }
              })();
            }
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.end',
                taskId,
                tickIndex: info.tickIndex,
                mode: info.mode,
                actionKind: info.actionKind,
                actionSummary: info.actionSummary,
                durationMs: info.durationMs,
                ok: info.ok,
                ...(info.message ? { message: info.message } : {}),
                ...(info.antiBot
                  ? {
                      // Flatten the server-side signal into the
                      // WS-facing shape: the UI wants a human-readable
                      // Chinese tag + the raw match concatenated, and
                      // never sees rawMatch as a separate field.
                      antiBot: {
                        type: info.antiBot.type,
                        confidence: info.antiBot.confidence,
                        message: `${describeSignal(info.antiBot)}（匹配：${info.antiBot.rawMatch}）`,
                      },
                    }
                  : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId, tickIndex: info.tickIndex }, 'broadcast tick.end failed');
            }
          },
          onScreencast(info) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.screencast',
                taskId,
                tickIndex: info.tickIndex,
                imageBase64: info.imageBase64,
                url: info.url,
                viewport: { width: info.viewportWidth, height: info.viewportHeight },
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              ctx.logger.warn(
                { err, taskId, tickIndex: info.tickIndex },
                'broadcast screencast failed',
              );
            }
          },
          onCaptchaDetected(info) {
            ctx.logger.info(
              { taskId, antiBotType: info.antiBotType, waitTimeoutMs: info.waitTimeoutMs },
              'vision loop paused on captcha signal',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_detected',
                taskId,
                antiBotType: info.antiBotType,
                message: info.message,
                waitTimeoutMs: info.waitTimeoutMs,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast captcha_detected failed');
            }
          },
          onCaptchaResolved(info) {
            ctx.logger.info({ taskId, reason: info.reason }, 'vision loop captcha wait ended');
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_resolved',
                taskId,
                reason: info.reason,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast captcha_resolved failed');
            }
          },
          onDegrade(info) {
            ctx.logger.info(
              { taskId, level: info.level, strategy: info.strategy, ok: info.ok },
              'degradation tier attempted',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.degrade',
                taskId,
                level: info.level,
                strategy: info.strategy,
                ok: info.ok,
                message: info.message,
                ...(info.handoffToExtension ? { handoffToExtension: true } : {}),
                ...(info.nextUrl ? { nextUrl: info.nextUrl } : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast degrade failed');
            }
          },
          onExecutorFallback(info) {
            ctx.logger.info(
              { taskId, reason: info.reason, available: info.available },
              'vision loop executor fallback triggered',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.executor_fallback',
                taskId,
                reason: info.reason,
                available: info.available,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast executor_fallback failed');
            }
          },
        })
          .then(async (outcome) => {
            ctx.logger.info(
              {
                taskId,
                status: outcome.status,
                tickCount: outcome.history.length,
              },
              'vision loop terminated',
            );
            try {
              if (outcome.status === 'completed') {
                await repo.persistVisionOutcome(taskId, {
                  status: 'completed',
                  summary: outcome.summary,
                  tickCount: outcome.history.length,
                });
              } else if (outcome.status === 'failed') {
                await repo.persistVisionOutcome(taskId, {
                  status: 'failed',
                  reason: outcome.reason,
                  tickCount: outcome.history.length,
                });
              } else if (outcome.status === 'paused') {
                await repo.persistVisionOutcome(taskId, {
                  status: 'paused',
                  reason: outcome.reason,
                  tickCount: outcome.history.length,
                });
              } else {
                await repo.persistVisionOutcome(taskId, {
                  status: 'cancelled',
                  tickCount: outcome.history.length,
                });
              }
            } catch (err) {
              ctx.logger.error({ err, taskId }, 'persistVisionOutcome failed');
            }
            // Push the terminal state to any connected SW for the user
            // so the popup can update its card without polling. Fire-
            // and-forget — broadcastToUser skips cleanly if no client
            // is connected (task ended while popup/SW was offline;
            // the popup will pick up the DB row on its next mount).
            try {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: outcome.status,
                ...(outcome.status === 'completed' ? { summary: outcome.summary } : {}),
                ...(outcome.status === 'failed' || outcome.status === 'paused'
                  ? { reason: outcome.reason }
                  : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast task.terminal failed');
            }
          })
          .catch((err) => {
            ctx.logger.error({ err, taskId }, 'vision loop threw');
          });

      void visionLoopTaskQueue.enqueue(ctx.userId, runTaskFn, (position) => {
        if (position > 1) {
          ctx.logger.info(
            { taskId, userId: ctx.userId, queuePosition: position },
            'vision loop task queued behind earlier work',
          );
          // G6: surface the queue position to any connected web
          // workbench so the sidebar can show "排队中 · 第 N 位".
          // Best-effort — broadcastToUser is a noop if nobody's
          // listening, and a throw here must not block enqueue.
          try {
            broadcastToUser(ctx.userId, {
              type: 'server.task.queued',
              taskId,
              position,
            });
          } catch (err) {
            ctx.logger.warn({ err, taskId }, 'broadcast task.queued failed');
          }
        }
      });
      return {
        taskId,
        status: 'executing' as const,
        steps: [],
      };
    }

    const catalogue = await loadSkillCatalogue(ctx.db, input.occupation ?? null);

    let plan: Awaited<ReturnType<typeof ctx.planner.plan>>;
    try {
      plan = await ctx.planner.plan({
        intent: input.intent,
        userId: ctx.userId,
        occupation: input.occupation ?? null,
        skills: catalogue,
      });
    } catch (err) {
      // Upstream planner failures (Anthropic 4xx/5xx, network) are NOT our
      // internal bug — surface them as 502 BAD_GATEWAY with the original
      // message so the popup can show "Anthropic: 403 forbidden" instead
      // of an opaque 500. Full stack is logged for the operator.
      ctx.logger.error(
        { err, userId: ctx.userId, intent: input.intent.slice(0, 200) },
        'planner upstream error',
      );
      const message = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `planner upstream error: ${message}`,
        cause: err,
      });
    }
    if (plan.length === 0) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'planner returned empty plan',
      });
    }

    // Origin allowlist: identify which Skills in the catalogue the
    // generated plan actually reaches (i.e. any Skill whose
    // allowedOrigins covers ≥1 goto URL in the plan). Union the
    // allowedOrigins of just those. When the plan uses NO Skill (free-
    // form intent the commander answered without adopting a Skill — e.g.
    // "在 Bing 搜一下 XXX"), `usedSkills` is empty, `allowedOrigins`
    // comes back `[]`, and the driver treats that as unrestricted.
    //
    // Earlier bug: we used to union allowedOrigins across the ENTIRE
    // active catalogue. That meant a free-form plan emitted bing.com
    // but the union was { douyin.com, xueqiu.com, ... } and the driver
    // refused bing.com as ORIGIN_BLOCKED. The catalogue is a menu, not
    // a restraining order — only Skills the plan actually uses should
    // constrain what the driver is allowed to visit.
    const usedSkills = pickSkillsUsedByPlan(plan, catalogue);
    const allowedOrigins = unionAllowedOrigins(usedSkills);

    const taskId = newExternalId('task');
    const { state, effects } = taskController.start({
      state: {
        taskId,
        status: 'planning',
        plan,
        cursor: 0,
        pendingConfirm: null,
        ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
      },
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, { userId: userRow.id, intent: input.intent });

    // Drive the first dispatch out to any connected WS clients.
    // Without this the task sits in `executing` in the DB but the
    // extension never receives `server.task.dispatch` and the Agent
    // Loop never starts. Symmetric with pause/resume/confirm below.
    updateTaskStateForUser(ctx.userId, state);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  /**
   * Diagnostic end-to-end: run a hardcoded Baidu search plan against
   * the real browser driver. No Anthropic call, no Skill catalogue,
   * no user intent — the plan is static, the selectors are known
   * stable (#kw, #su). Use this to confirm the SW ↔ orchestrator ↔
   * adapter loop is healthy when planner-generated plans are
   * failing on selector mismatch.
   */
  smokeTest: protectedProcedure.mutation(async ({ ctx }) => {
    const [userRow] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    const plan = buildBaiduSmokePlan();
    const taskId = newExternalId('task');
    // Smoke drives Baidu only; pinning the allowlist here also serves
    // as a live test that the end-to-end wiring (dispatch → SW →
    // driver) actually enforces the list.
    const smokeAllowedOrigins = ['*.baidu.com'] as const;
    const { state, effects } = taskController.start({
      state: {
        taskId,
        status: 'planning',
        plan,
        cursor: 0,
        pendingConfirm: null,
        allowedOrigins: smokeAllowedOrigins,
      },
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, {
      userId: userRow.id,
      intent: '[smoke] Baidu search for "半导体" — diagnostic, not Opus-planned',
    });

    updateTaskStateForUser(ctx.userId, state);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  pause: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.pause(prev, 'user');
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot pause from status=${prev.status}`,
      });
    }

    await repo.applyControlTransition(prev, next);
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status, pauseReason: next.pauseReason ?? null };
  }),

  resume: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.resume(prev);
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot resume from status=${prev.status}`,
      });
    }

    await repo.applyControlTransition(prev, next);
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status };
  }),

  confirm: protectedProcedure
    .input(
      z
        .object({
          taskId: z.string().min(1),
          // New decision enum (approve / skip / reject) — maps to the
          // single-confirm and batch-confirm paths on the controller.
          decision: z.enum(['approve', 'skip', 'reject']).optional(),
          // Back-compat: popup v0 sent `approve: boolean`. Translate it
          // to the decision enum when present and no explicit decision.
          approve: z.boolean().optional(),
        })
        .refine((v) => v.decision !== undefined || v.approve !== undefined, {
          message: 'one of decision or approve must be provided',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const repo = new TaskRepository(ctx.db);
      const prev = await loadTaskState(repo, input.taskId, ctx.userId);
      if (prev.status !== 'awaiting_user') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `cannot confirm from status=${prev.status}`,
        });
      }

      const decision: 'approve' | 'skip' | 'reject' =
        input.decision ?? (input.approve ? 'approve' : 'reject');

      const { state: next, effects } = taskController.userConfirm(prev, decision);

      // Pick the repo method by the shape of the transition.
      //   reject                → control transition (cancelled)
      //   batch + approve       → batch-approve (cursor unchanged, clear
      //                           pending blob, NOT a step completion)
      //   otherwise (skip,
      //   single approve)       → step-result (cursor advances, step row
      //                           marked completed)
      const batchApprove = prev.pendingConfirm?.kind === 'batch' && decision === 'approve';
      if (next.status === 'cancelled') {
        await repo.applyControlTransition(prev, next);
      } else if (batchApprove) {
        await repo.applyBatchApprove(prev, next);
      } else {
        await repo.applyStepResult(prev, next, { confirmed: true, decision });
      }
      updateTaskStateForUser(ctx.userId, next);
      for (const eff of effects) {
        if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
      }
      return { taskId: next.taskId, status: next.status };
    }),

  /**
   * Task history, scoped to the caller. DESC-id cursor pagination so
   * the popup's "history" section can lazy-load more rows as the user
   * scrolls without re-fetching the head. Shape mirrors
   * `llmCalls.list` (commit 52ef5fa) so the popup can use one cursor
   * idiom across both lists.
   *
   * Intentionally omits the full step plan / output blobs — those
   * come from `tasks.detail(taskId)` when a row is expanded. Keeps
   * the list payload small even when a user has hundreds of tasks.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
        .default({ limit: 20 }),
    )
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const conds = [eq(tasksTable.userId, userRow.id)];
      if (input.cursor) conds.push(lt(tasksTable.id, input.cursor));
      const rows = await ctx.db
        .select({
          id: tasksTable.id,
          externalId: tasksTable.externalId,
          intent: tasksTable.intent,
          title: tasksTable.title,
          status: tasksTable.status,
          pauseReason: tasksTable.pauseReason,
          errorCode: tasksTable.errorCode,
          errorMessage: tasksTable.errorMessage,
          result: tasksTable.result,
          createdAt: tasksTable.createdAt,
          updatedAt: tasksTable.updatedAt,
          completedAt: tasksTable.completedAt,
        })
        .from(tasksTable)
        .where(and(...conds))
        .orderBy(desc(tasksTable.id))
        .limit(input.limit);

      return {
        tasks: rows.map((r) => ({
          taskId: r.externalId,
          intent: r.intent,
          title: r.title,
          status: r.status,
          pauseReason: r.pauseReason,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          result: normalizeOutput(r.result),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          completedAt: r.completedAt,
        })),
        nextCursor: rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      };
    }),

  /**
   * One task + all its steps. Steps include the `output` blob (extract
   * texts, screenshot metadata, SELECTOR_NOT_FOUND diagnostic payload,
   * etc.) so the popup can render the same ResultsSection it uses for
   * live tasks. Task ownership is verified — unknown or not-owned task
   * returns NOT_FOUND rather than leaking existence via UNAUTHORIZED.
   */
  detail: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)))
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const stepRows = await ctx.db
        .select({
          externalId: taskSteps.externalId,
          seq: taskSteps.seq,
          kind: taskSteps.kind,
          status: taskSteps.status,
          riskLevel: taskSteps.riskLevel,
          input: taskSteps.input,
          output: taskSteps.output,
          errorCode: taskSteps.errorCode,
          errorMessage: taskSteps.errorMessage,
          screenshotKey: taskSteps.screenshotKey,
          startedAt: taskSteps.startedAt,
          completedAt: taskSteps.completedAt,
        })
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskRow.id))
        .orderBy(asc(taskSteps.seq));

      return {
        taskId: taskRow.externalId,
        intent: taskRow.intent,
        title: taskRow.title,
        status: taskRow.status,
        pauseReason: taskRow.pauseReason,
        errorCode: taskRow.errorCode,
        errorMessage: taskRow.errorMessage,
        result: normalizeOutput(taskRow.result),
        createdAt: taskRow.createdAt,
        completedAt: taskRow.completedAt,
        steps: stepRows.map((s) => ({
          id: s.externalId,
          seq: s.seq,
          kind: s.kind,
          status: s.status,
          riskLevel: s.riskLevel,
          // MariaDB JSON columns arrive as strings on some driver
          // configs; the repo's normalizeJson handles that, inline
          // the parse here so callers get a real object.
          input: normalizeOutput(s.input),
          output: normalizeOutput(s.output),
          errorCode: s.errorCode,
          errorMessage: s.errorMessage,
          screenshotKey: s.screenshotKey,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
      };
    }),

  /**
   * Supercar-only: resume a task that parked on `server.supercar.awaiting_user`.
   * Returns `{ ok: false }` when the task isn't currently waiting (already
   * finished, unknown id, wrong user). Does NOT load the full task state —
   * the only valid state for reply is an in-memory handle registered by
   * the running loop, so we bail fast when it's missing.
   */
  reply: protectedProcedure
    .input(z.object({ taskId: z.string().min(1), message: z.string().min(1).max(4_000) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)))
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const delivered = supercarReply(input.taskId, input.message);
      return { ok: delivered };
    }),

  /**
   * Supercar-only: abort a running task. Sets the in-memory abort flag;
   * the next loop iteration exits with status=cancelled.
   */
  abort: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)))
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const aborted = supercarAbort(input.taskId);
      return { ok: aborted };
    }),

  /**
   * Navigate the headed Brave singleton to about:blank so the VNC
   * stream doesn't show a stale URL from a previous task while the
   * user types the next intent. Idempotent + fire-and-forget — we
   * don't surface errors because there's nothing the user can do
   * about a CDP hiccup except try again. Only runs if the primary
   * executor is the headed lane (guarded in the router).
   */
  resetBrowser: protectedProcedure.mutation(async ({ ctx }) => {
    // Pool users reset their own Brave; everyone else resets the
    // shared headed singleton. peek() never allocates — we don't
    // want a fresh quartet just for a new-task nudge, and if the
    // user doesn't yet have one there's nothing to reset.
    const poolInstance =
      ctx.browserPool && shouldUseBrowserPool(ctx.userId)
        ? ctx.browserPool.peek(ctx.userId)
        : null;
    const exec =
      poolInstance?.executor ??
      ctx.executionRouter?.getExecutor('headed') ??
      ctx.executionRouter?.getExecutor('headless') ??
      ctx.playwrightExecutor ??
      null;
    if (!exec) return { ok: false as const, reason: 'no_executor' };
    try {
      await exec.resetPageForTask();
      return { ok: true as const };
    } catch (err) {
      ctx.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'tasks.resetBrowser: reset failed (non-fatal)',
      );
      return { ok: false as const, reason: 'reset_failed' };
    }
  }),

  /**
   * User-initiated browser chrome navigation on the attached Brave
   * instance. Used by the Panel header's back / forward / reload
   * buttons — the agent loop owns URL changes but the user also needs
   * trivial browser-style navigation when they decide to poke around
   * the rendered site themselves.
   *
   * Fire-and-forget semantics; errors are swallowed and reported as
   * `{ok:false, reason}` so the UI can show a subtle toast rather
   * than a TRPC error banner for something as cheap as "no page yet".
   */
  browserNav: protectedProcedure
    .input(z.object({ direction: z.enum(['back', 'forward', 'reload']) }))
    .mutation(async ({ ctx, input }) => {
      const poolInstance =
        ctx.browserPool && shouldUseBrowserPool(ctx.userId)
          ? ctx.browserPool.peek(ctx.userId)
          : null;
      const exec =
        poolInstance?.executor ??
        ctx.executionRouter?.getExecutor('headed') ??
        ctx.executionRouter?.getExecutor('headless') ??
        ctx.playwrightExecutor ??
        null;
      if (!exec) return { ok: false as const, reason: 'no_executor' };
      try {
        const page = await exec.getPage();
        if (input.direction === 'back') await page.goBack({ timeout: 5_000 });
        else if (input.direction === 'forward') await page.goForward({ timeout: 5_000 });
        else await page.reload({ timeout: 10_000 });
        return { ok: true as const };
      } catch (err) {
        ctx.logger.warn(
          { err: err instanceof Error ? err.message : String(err), direction: input.direction },
          'tasks.browserNav: nav failed (non-fatal)',
        );
        return { ok: false as const, reason: 'nav_failed' };
      }
    }),

  /**
   * Remove one of the caller's tasks. Cascades to task_steps / task_events
   * via the schema's onDelete. Scoped hard — the WHERE clause requires
   * both the externalId AND caller's userId so a user cannot delete
   * another user's row by guessing its id.
   *
   * In-flight tasks are rejected with PRECONDITION_FAILED rather than
   * silently deleted: the vision loop would continue writing rows for
   * a task that no longer exists, producing an orphaned-step log spam.
   * The UI disables the delete action on non-terminal tasks too, but we
   * defend in depth.
   */
  delete: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id, status: tasksTable.status })
        .from(tasksTable)
        .where(
          and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      if (
        taskRow.status === 'executing' ||
        taskRow.status === 'planning' ||
        taskRow.status === 'awaiting_user' ||
        taskRow.status === 'pending'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `cannot delete task in status=${taskRow.status}; pause or cancel first`,
        });
      }
      // task_steps has onDelete:cascade via FK; task_events has no FK
      // (append-only audit log) so we clean it up manually in one tx
      // to keep the orphan event rows from piling up.
      await ctx.db.transaction(async (tx) => {
        await tx.delete(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
        await tx.delete(tasksTable).where(eq(tasksTable.id, taskRow.id));
      });
      return { ok: true as const, taskId: input.taskId };
    }),

  /**
   * Rename a task (sets the display `title` column). Pass an empty
   * string to clear the override — the UI will then fall back to the
   * auto-summary of `intent`. 255-char cap mirrors the column.
   */
  rename: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        title: z.string().max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      // Verify ownership before the UPDATE so we return a proper
      // NOT_FOUND (vs. silently succeeding on 0 affected rows) and
      // don't leak unrelated task existence via error messages.
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(eq(tasksTable.externalId, input.taskId), eq(tasksTable.userId, userRow.id)),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const trimmed = input.title.trim();
      const nextTitle = trimmed.length === 0 ? null : trimmed;
      await ctx.db
        .update(tasksTable)
        .set({ title: nextTitle })
        .where(eq(tasksTable.id, taskRow.id));
      return { ok: true as const, taskId: input.taskId, title: nextTitle };
    }),

  /**
   * P1.1 self-heal metrics — aggregate over the caller's task_steps
   * rows. `healStats` powers the W3 dogfood decision "is self-heal
   * worth keeping / tuning / expanding to 2 retries?" by measuring:
   *   - attempts: how often a step triggered a heal call
   *   - successes: of those, how many were followed by an ok retry
   *   - successRate: successes / attempts
   *   - avgElapsedMs: average wall-clock per heal call
   *   - totalInputTokens / totalOutputTokens: Anthropic token spend
   *
   * Scoped strictly to the caller so one account's rates don't
   * average-out into another's. Empty result (no heals ever) returns
   * zeros — not an error.
   */
  healStats: protectedProcedure
    .input(
      z
        .object({
          /** ISO timestamp; inclusive lower bound on step created_at. */
          since: z.string().datetime().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }

      const sinceCond = input.since
        ? sqlFilter`AND ts.created_at >= ${new Date(input.since)}`
        : sqlEmpty;

      // A single aggregation against task_steps JOIN tasks; cheaper
      // than pulling all rows and folding in JS, and the query is
      // simple enough to SQL-native.
      const result = (await ctx.db.execute(sqlFilter`
        SELECT
          COALESCE(SUM(CASE WHEN ts.heal_attempts > 0 THEN 1 ELSE 0 END), 0)  AS attempts,
          COALESCE(SUM(CASE WHEN ts.heal_succeeded > 0 THEN 1 ELSE 0 END), 0) AS successes,
          COALESCE(AVG(NULLIF(ts.heal_elapsed_ms, 0)), 0)                    AS avgElapsedMs,
          COALESCE(SUM(COALESCE(ts.heal_input_tokens, 0)), 0)                AS totalInputTokens,
          COALESCE(SUM(COALESCE(ts.heal_output_tokens, 0)), 0)               AS totalOutputTokens
        FROM task_steps ts
        JOIN tasks t ON ts.task_id = t.id
        WHERE t.user_id = ${userRow.id}
        ${sinceCond}
      `)) as unknown as [Array<Record<string, unknown>>] | Array<Record<string, unknown>>;

      // mysql2 returns `[rows, fields]`; drizzle's mysql2 wrapper
      // sometimes unwraps to `rows`. Handle both.
      const rows: Array<Record<string, unknown>> = Array.isArray(result[0])
        ? (result[0] as Array<Record<string, unknown>>)
        : (result as unknown as Array<Record<string, unknown>>);
      const row = rows[0] ?? {};
      const attempts = toNumber(row.attempts);
      const successes = toNumber(row.successes);
      const avgElapsedMs = toNumber(row.avgElapsedMs);
      const totalInputTokens = toNumber(row.totalInputTokens);
      const totalOutputTokens = toNumber(row.totalOutputTokens);
      return {
        attempts,
        successes,
        successRate: attempts > 0 ? successes / attempts : 0,
        avgElapsedMs,
        totalInputTokens,
        totalOutputTokens,
      };
    }),
});

import { sql as sqlFilter } from 'drizzle-orm';
const sqlEmpty = sqlFilter``;

/**
 * Truncate helper shared between supercar broadcast hooks — keeps WS
 * frames and step summaries bounded so a rogue thinking block can't
 * wedge a socket write.
 */
function truncateString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Canary gate for the per-user BrowserPool. Returns true when the
 * caller should be routed to their own browser instance instead of
 * the shared headed singleton.
 *
 * Policy:
 *   - MULTI_USER_USERS empty → every authenticated user gets pool
 *     mode (only relevant once we're confident in the rollout).
 *   - MULTI_USER_USERS non-empty → comma-separated allow-list; only
 *     exact matches are opted in. Use this during canary.
 *
 * Callers gate on `ctx.browserPool != null` before invoking — this
 * helper doesn't know whether the pool was actually constructed.
 */
function shouldUseBrowserPool(userId: string): boolean {
  const raw = appEnv.MULTI_USER_USERS.trim();
  if (!raw) return true;
  const allowed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}

/**
 * Persist a supercar run's terminal state via the same
 * `persistVisionOutcome` the legacy vision-loop uses. Maps the
 * supercar-specific statuses back to the tasks.status enum.
 */
async function persistSupercarOutcome(
  repo: TaskRepository,
  taskId: string,
  outcome: SupercarOutcome,
): Promise<void> {
  try {
    if (outcome.status === 'completed') {
      await repo.persistVisionOutcome(taskId, {
        status: 'completed',
        summary: outcome.summary ?? '',
        tickCount: outcome.iterations,
      });
    } else if (outcome.status === 'awaiting_user') {
      // Shouldn't land here in the happy path — the loop returns a
      // terminal status after the reply, not awaiting_user. Persist as
      // paused so the UI still renders sensibly if it did.
      await repo.persistVisionOutcome(taskId, {
        status: 'paused',
        reason: outcome.question ?? 'awaiting user reply',
        tickCount: outcome.iterations,
      });
    } else if (outcome.status === 'cancelled') {
      await repo.persistVisionOutcome(taskId, {
        status: 'cancelled',
        tickCount: outcome.iterations,
      });
    } else if (outcome.status === 'timeout') {
      await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: outcome.reason ?? 'supercar: task timeout',
        tickCount: outcome.iterations,
      });
    } else {
      // 'failed'
      await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: outcome.reason ?? 'supercar: task failed',
        tickCount: outcome.iterations,
      });
    }
  } catch (err) {
    // Best-effort — persistence failure is logged by the caller's .then().
    // Rethrow so the caller's logger catches it.
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Translate a supercar outcome to the `server.task.terminal` frame the
 * web workbench + extension already understand. `timeout` collapses to
 * `failed` over the wire so the schema doesn't need to widen.
 */
function buildTaskTerminalMessage(
  taskId: string,
  outcome: SupercarOutcome,
): import('@holaday/shared-types').ServerMessage {
  if (outcome.status === 'completed') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'completed',
      ...(outcome.summary ? { summary: outcome.summary } : {}),
    };
  }
  if (outcome.status === 'cancelled') {
    return { type: 'server.task.terminal', taskId, status: 'cancelled' };
  }
  if (outcome.status === 'awaiting_user') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'paused',
      ...(outcome.question ? { reason: outcome.question } : {}),
    };
  }
  // failed / timeout
  return {
    type: 'server.task.terminal',
    taskId,
    status: 'failed',
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

function normalizeOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function loadTaskState(repo: TaskRepository, taskExternalId: string, userExternalId: string) {
  const all = await repo.rehydrateInFlight();
  const hit = all.find(
    (r) => r.state.taskId === taskExternalId && r.userExternalId === userExternalId,
  );
  if (!hit) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `task ${taskExternalId} not in-flight`,
    });
  }
  return hit.state;
}

/**
 * Active skills the user can route to.
 *
 * Phase 0 behaviour: we ALWAYS return every active Skill regardless of
 * the task's occupation. The reason: Skill selection happens inside
 * Opus (given the catalogue + the intent, the commander picks). The
 * orchestrator layer doesn't do keyword/intent matching here — and
 * pre-filtering by occupation was actively harmful (the popup's old
 * hardcoded `occupation: 'finance-research'` meant douyin Skills were
 * never in catalogue, so a "帮我看抖音后台" intent fell through to
 * xueqiu's allowedOrigins and the real douyin URL got ORIGIN_BLOCKED).
 *
 * Cost: catalogue is ~5-10 rows, few hundred tokens, Opus handles it.
 * Boundary is preserved because `unionAllowedOrigins` unions ALL
 * Skills' allowedOrigins — anything outside that union is still
 * blocked by the driver.
 *
 * `occupation` is kept on the signature for now as a Phase 1 knob
 * (we may want to *prefer* a Skill matching the user's occupation
 * tag when ranking / prompting Opus), but it no longer filters the
 * SQL query.
 */
async function loadSkillCatalogue(
  db: import('../../db/client.js').DB,
  _occupation: string | null,
): Promise<SkillCatalogueEntry[]> {
  const rows = await db
    .select({
      slug: skills.slug,
      description: skills.description,
      occupationTag: skills.occupationTag,
      manifest: skills.manifest,
    })
    .from(skills)
    .where(eq(skills.status, 'active'));

  return rows
    .filter((r): r is typeof r & { description: string } => Boolean(r.description))
    .map((r) => ({
      slug: r.slug,
      description: r.description,
      occupationTag: r.occupationTag,
      allowedOrigins: extractAllowedOrigins(r.manifest),
    }));
}

/**
 * Pull `allowedOrigins` out of a `skills.manifest` JSON column. The manifest
 * is the parsed SKILL.md front-matter; we only trust string entries. Returns
 * an empty array when the column is missing, malformed, or the key isn't
 * present — the caller unions across the whole catalogue so one misshaped
 * manifest doesn't widen the allowlist.
 */
function extractAllowedOrigins(manifest: unknown): readonly string[] {
  if (!manifest || typeof manifest !== 'object') return [];
  // MariaDB returns JSON columns as strings on some driver/config combos.
  const parsed =
    typeof manifest === 'string'
      ? (() => {
          try {
            return JSON.parse(manifest);
          } catch {
            return null;
          }
        })()
      : manifest;
  if (!parsed || typeof parsed !== 'object') return [];
  const entries = (parsed as { allowedOrigins?: unknown }).allowedOrigins;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e): e is string => typeof e === 'string' && e.length > 0);
}

/**
 * Pick catalogue entries whose `allowedOrigins` covers ≥ 1 goto URL in
 * the plan — i.e. the Skills the plan will actually visit. A Skill is
 * "used" if any of its allowedOrigins entries matches any goto URL by
 * the same rules the driver will apply at dispatch time.
 *
 * Why bother: the catalogue is the full menu of Skills (all active) so
 * Opus can route, but the origin allowlist the driver enforces should
 * correspond to what the plan is actually doing. A plan that doesn't
 * touch any catalogued Skill is a free-form browse — `allowedOrigins`
 * comes back `[]`, and the driver treats empty as unrestricted.
 *
 * Reuses the driver's own `isOriginAllowed` to avoid rule-matching
 * drift between orchestrator and driver.
 */
function pickSkillsUsedByPlan(
  plan: PlannedStep[],
  catalogue: SkillCatalogueEntry[],
): SkillCatalogueEntry[] {
  const gotoUrls = plan
    .filter((s) => s.kind === 'goto')
    .map((s) => {
      const url = (s.payload as { url?: unknown } | undefined)?.url;
      return typeof url === 'string' ? url : null;
    })
    .filter((u): u is string => u !== null);
  if (gotoUrls.length === 0) return [];
  return catalogue.filter((entry) => {
    const origins = entry.allowedOrigins ?? [];
    if (origins.length === 0) return false;
    return gotoUrls.some((url) => urlMatchesAnyOrigin(url, origins));
  });
}

/**
 * Does `url` satisfy any of the `origins` rules? Mirrors the semantics
 * of `packages/browser-driver/src/origin-guard.ts::isOriginAllowed` —
 * the canonical enforcer lives in the driver; this is a read-only
 * pre-check on the orchestrator side for deciding which Skills to
 * union. Keep the rules identical so a URL that passes here passes
 * there too.
 */
function urlMatchesAnyOrigin(url: string, origins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.host.toLowerCase();
  const bareHost = parsed.hostname.toLowerCase();
  for (const rule of origins) {
    const r = rule.toLowerCase();
    if (r.startsWith('*.')) {
      const suffix = r.slice(2);
      if (bareHost === suffix) return true;
      if (bareHost.endsWith(`.${suffix}`)) return true;
    } else if (r === host || r === bareHost) {
      return true;
    }
  }
  return false;
}

/**
 * Union `allowedOrigins` across a list of Skills (typically the subset
 * the plan is using, picked by `pickSkillsUsedByPlan`). Empty result
 * means "no Skill used or none declared an origin allowlist" — the
 * driver treats empty as unrestricted. Deduped; order-preserving.
 */
function unionAllowedOrigins(catalogue: SkillCatalogueEntry[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of catalogue) {
    for (const origin of entry.allowedOrigins ?? []) {
      if (seen.has(origin)) continue;
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
}
