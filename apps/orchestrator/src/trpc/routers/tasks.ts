import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { SkillCatalogueEntry } from '../../agent/planner.js';
import { buildBaiduSmokePlan } from '../../agent/smoke-plans.js';
import { TaskController } from '../../agent/task-controller.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { skills } from '../../db/schema/skills.js';
import { users } from '../../db/schema/users.js';
import { broadcastToUser, updateTaskStateForUser } from '../../ws/server.js';
import { protectedProcedure, router } from '../trpc.js';

const taskController = new TaskController();

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

    // Origin allowlist: union across every Skill in the catalogue matched
    // by this task's occupation. Empty = no Skill match OR no Skill
    // declared allowedOrigins → driver treats as unrestricted. A Skill's
    // allowedOrigins is the hard boundary the commander promised to
    // honour; we enforce it at the driver layer so a mis-planned goto
    // can't walk the agent onto an unrelated site.
    const allowedOrigins = unionAllowedOrigins(catalogue);

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
});

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
 * Active skills the user can route to: either untagged (applies to everyone)
 * or tagged with the user's occupation. We return slug + one-line description
 * only — v0.2 §5.5 lazy-load: full SKILL.md is fetched on demand when the
 * commander actually picks a skill.
 */
async function loadSkillCatalogue(
  db: import('../../db/client.js').DB,
  occupation: string | null,
): Promise<SkillCatalogueEntry[]> {
  const occupationMatch = occupation
    ? or(isNull(skills.occupationTag), eq(skills.occupationTag, occupation))
    : isNull(skills.occupationTag);

  const rows = await db
    .select({
      slug: skills.slug,
      description: skills.description,
      occupationTag: skills.occupationTag,
      manifest: skills.manifest,
    })
    .from(skills)
    .where(and(eq(skills.status, 'active'), occupationMatch));

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
 * Union `allowedOrigins` across all candidate Skills for the task. Empty
 * result means "no Skill matched the task's occupation, or none of them
 * declared an origin allowlist" — the driver treats empty as unrestricted.
 * Deduped; order-preserving.
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
