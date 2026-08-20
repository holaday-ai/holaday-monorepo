#!/usr/bin/env tsx
/**
 * Phase 0 — Evaluation runner.
 *
 * Drives the orchestrator over its real tRPC HTTP surface (the same
 * path the SPA uses), executes a suite of {@link EvalCase}s, and
 * writes a JSON report to `apps/orchestrator/eval-results/`.
 *
 * Usage:
 *   pnpm --filter @holaday/orchestrator eval:smoke           # default p0-smoke
 *   pnpm --filter @holaday/orchestrator eval p1-regression
 *
 * Env knobs:
 *   EVAL_BASE_URL          — orchestrator HTTP base. Defaults to
 *                            http://127.0.0.1:${HTTP_PORT}.
 *   EVAL_USER_EXTERNAL_ID  — the user the runner authenticates as.
 *                            Defaults to the existing quota-bypass
 *                            test account so smoke isn't capped by
 *                            3/day. Auto-seeds locally if missing.
 *
 * Exit codes:
 *   0 — every case passed
 *   1 — at least one case failed
 *   2 — runner itself crashed (missing env, suite not found, etc.)
 */
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';

import { signAccessToken } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { isTaskTerminalStatus } from '../task-status.js';
import {
  type EvalTaskDetail,
  readResultField,
  validateEvalExpectations,
} from './eval-expectations.js';
import type {
  EvalCase,
  EvalCaseResult,
  EvalReport,
} from './eval-suite.js';
import { writeEvalSummary } from './eval-summary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE = `http://127.0.0.1:${env.HTTP_PORT}`;
const BASE_URL = (process.env.EVAL_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
const EVAL_USER_EXTERNAL_ID =
  process.env.EVAL_USER_EXTERNAL_ID ?? 'usr_EeYpvsvLtyDzN4VLQi7BT';
const POLL_INTERVAL_MS = 1_500;
const DEFAULT_MAX_DURATION_MS = 180_000;

interface CreateTaskOut {
  taskId: string;
  status: string;
  executionMode?: string;
  steps?: unknown[];
}

interface ListOut {
  tasks: Array<{ taskId: string; status: string; intent: string }>;
  nextCursor: number | null;
}

async function ensureUser(externalId: string): Promise<void> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, externalId))
    .limit(1);
  if (existing) return;
  await db.insert(users).values({
    externalId,
    email: `${externalId}@eval.local`,
    passwordHash: 'placeholder',
    plan: 'free',
  });
  console.log(`[eval] seeded user ${externalId}`);
}

async function callMutation<T>(
  procedure: string,
  input: unknown,
  token: string,
): Promise<T> {
  const res = await fetch(`${BASE_URL}/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errBody = (json as { error?: { message?: string } }).error;
    throw new Error(
      `tRPC ${procedure} ${res.status}: ${errBody?.message ?? JSON.stringify(json)}`,
    );
  }
  return (json as { result: { data: T } }).result.data;
}

async function callQuery<T>(
  procedure: string,
  input: unknown,
  token: string,
): Promise<T> {
  const url = `${BASE_URL}/trpc/${procedure}?input=${encodeURIComponent(
    JSON.stringify(input),
  )}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errBody = (json as { error?: { message?: string } }).error;
    throw new Error(
      `tRPC ${procedure} ${res.status}: ${errBody?.message ?? JSON.stringify(json)}`,
    );
  }
  return (json as { result: { data: T } }).result.data;
}

async function pollUntilTerminal(
  taskId: string,
  token: string,
  maxMs: number,
): Promise<EvalTaskDetail> {
  const deadline = Date.now() + maxMs;
  let last: EvalTaskDetail | undefined;
  while (Date.now() < deadline) {
    last = await callQuery<EvalTaskDetail>('tasks.detail', { taskId }, token);
    if (isTaskTerminalStatus(last.status) || last.status === 'awaiting_user') {
      return last;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const lastStatus = last?.status ?? 'unknown';
  const err = new Error(
    `pollUntilTerminal: timed out after ${maxMs}ms (last status=${lastStatus})`,
  );
  // Attach last detail so the caller can still surface it in the report.
  (err as Error & { detail?: EvalTaskDetail }).detail = last;
  throw err;
}

async function runDetailRehydrate(
  caseDef: EvalCase,
  token: string,
  startedAt: number,
): Promise<EvalCaseResult> {
  const failures: string[] = [];
  // Pull the most recent rows; pick the newest 'completed' one.
  const list = await callQuery<ListOut>(
    'tasks.list',
    { limit: 20 },
    token,
  );
  const completed = list.tasks.find((t) => t.status === 'completed');
  if (!completed) {
    failures.push(
      'detailRehydrate: no completed task found in tasks.list (run P0_001 first)',
    );
    return {
      id: caseDef.id,
      tier: caseDef.tier,
      category: caseDef.category,
      ok: false,
      failures,
      durationMs: Date.now() - startedAt,
    };
  }
  const detail = await callQuery<EvalTaskDetail>(
    'tasks.detail',
    { taskId: completed.taskId },
    token,
  );
  const hasResult = detail.result != null;
  const hasSteps = (detail.steps ?? []).length > 0;
  const hasPlanText =
    typeof detail.planText === 'string' && detail.planText.length > 0;
  if (!hasResult && !hasSteps && !hasPlanText) {
    failures.push(
      'detailRehydrate: detail is empty (no result, no steps, no planText) — SPA would white-screen',
    );
  }
  if (detail.status !== 'completed') {
    failures.push(
      `detailRehydrate: task ${completed.taskId} status=${detail.status}, expected completed`,
    );
  }
  return {
    id: caseDef.id,
    tier: caseDef.tier,
    category: caseDef.category,
    ok: failures.length === 0,
    failures,
    taskId: completed.taskId,
    durationMs: Date.now() - startedAt,
    terminalStatus: detail.status,
    summarySnippet:
      (readResultField<string>(detail.result, 'summary') ?? '').slice(0, 200) ||
      null,
  };
}

async function runStandardCase(
  caseDef: EvalCase,
  token: string,
  startedAt: number,
): Promise<EvalCaseResult> {
  const failures: string[] = [];
  const exp = caseDef.expectations;

  let taskId: string | undefined;
  let executionMode: string | null = null;
  let detail: EvalTaskDetail | undefined;
  let timedOut = false;

  try {
    const created = await callMutation<CreateTaskOut>(
      'tasks.create',
      { intent: caseDef.prompt },
      token,
    );
    taskId = created.taskId;
    executionMode = created.executionMode ?? null;

    const maxMs = exp.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    try {
      detail = await pollUntilTerminal(taskId, token, maxMs);
    } catch (err) {
      timedOut = true;
      detail = (err as Error & { detail?: EvalTaskDetail }).detail;
      failures.push(
        `timeout: did not reach terminal in ${maxMs}ms (last status=${
          detail?.status ?? 'unknown'
        })`,
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Phase 1 follow-up — expectsCreateRejection short-circuit.
    // tasks.create returning a 4xx is the success signal for this
    // mode (e.g. looksLikeCodeIntent guard). Validate the error
    // message against mustContainAny and return early — no task
    // exists to poll.
    if (exp.expectsCreateRejection) {
      const checkFailures: string[] = [];
      if (exp.mustContainAny && exp.mustContainAny.length > 0) {
        const hit = exp.mustContainAny.some((n) => errMsg.includes(n));
        if (!hit) {
          checkFailures.push(
            `expectsCreateRejection: error message "${errMsg.slice(0, 100)}" doesn't include any of [${exp.mustContainAny.join(', ')}]`,
          );
        }
      }
      return {
        id: caseDef.id,
        tier: caseDef.tier,
        category: caseDef.category,
        ok: checkFailures.length === 0,
        failures: checkFailures,
        durationMs: Date.now() - startedAt,
        terminalStatus: 'create_rejected',
        errorMessage: errMsg.slice(0, 500),
      };
    }
    failures.push(`exception during create/poll: ${errMsg}`);
  }

  // ---- Initial-state validation ----
  const initialResultMode = readResultField<string>(detail?.result, 'executionMode');
  if (initialResultMode) executionMode = initialResultMode;
  if (detail) {
    failures.push(
      ...validateEvalExpectations(detail, exp, '', executionMode),
    );
  } else if (!timedOut) {
    failures.push('runner: no detail captured — task never created');
  }
  if (exp.customValidator && exp.customValidator !== 'detailRehydrate') {
    failures.push(`unknown customValidator "${exp.customValidator}"`);
  }

  // ---- Reply turns (each with optional post-reply expectations) ----
  if (caseDef.replySequence && taskId && detail) {
    for (let i = 0; i < caseDef.replySequence.length; i++) {
      const turn = caseDef.replySequence[i];
      if (!turn) continue;
      const turnLabel = `replySequence[${i}] `;
      const turnKind = turn.kind ?? 'reply';
      try {
        if (turnKind === 'follow-up') {
          // tasks.create with replyToTaskId — mirrors the SPA's
          // followup-action chip click. Spawns a NEW task that
          // inherits the parent's context. Subsequent polls /
          // validation target the new taskId.
          const followUp: CreateTaskOut = await callMutation<CreateTaskOut>(
            'tasks.create',
            {
              intent: turn.message,
              replyToTaskId: taskId,
              ...(turn.fileIds ? { fileIds: turn.fileIds } : {}),
            },
            token,
          );
          taskId = followUp.taskId;
          executionMode = followUp.executionMode ?? executionMode;
        } else {
          await callMutation(
            'tasks.reply',
            {
              taskId,
              message: turn.message,
              ...(turn.fileIds ? { fileIds: turn.fileIds } : {}),
            },
            token,
          );
        }
      } catch (err) {
        failures.push(
          `${turnLabel}${turnKind === 'follow-up' ? 'tasks.create (follow-up)' : 'tasks.reply'} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        break;
      }
      // Default: poll until terminal again. Set pollAfter:false to
      // probe immediate-return paths (e.g. still_awaiting).
      const shouldPoll = turn.pollAfter !== false;
      if (shouldPoll) {
        const turnMaxMs =
          turn.expectations?.maxDurationMs ??
          exp.maxDurationMs ??
          DEFAULT_MAX_DURATION_MS;
        try {
          detail = await pollUntilTerminal(taskId, token, turnMaxMs);
        } catch (err) {
          detail = (err as Error & { detail?: EvalTaskDetail }).detail;
          failures.push(
            `${turnLabel}timeout: did not reach terminal in ${turnMaxMs}ms after reply "${turn.message.slice(0, 40)}"`,
          );
        }
      } else {
        try {
          detail = await callQuery<EvalTaskDetail>(
            'tasks.detail',
            { taskId },
            token,
          );
        } catch (err) {
          failures.push(
            `${turnLabel}refetch failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      const turnResultMode = readResultField<string>(detail?.result, 'executionMode');
      if (turnResultMode) executionMode = turnResultMode;
      if (turn.expectations) {
        failures.push(
          ...validateEvalExpectations(
            detail,
            turn.expectations,
            turnLabel,
            executionMode,
          ),
        );
      }
    }
  }

  const finalUrl = readResultField<string>(detail?.result, 'finalUrl');
  const summary = readResultField<string>(detail?.result, 'summary');

  return {
    id: caseDef.id,
    tier: caseDef.tier,
    category: caseDef.category,
    ok: failures.length === 0,
    failures,
    taskId,
    durationMs: Date.now() - startedAt,
    terminalStatus: detail?.status,
    awaitingKind: detail?.awaitingKind ?? null,
    executionMode,
    finalUrl: finalUrl ?? null,
    summarySnippet: summary ? String(summary).slice(0, 200) : null,
    errorMessage: detail?.errorMessage ?? null,
  };
}

async function runCase(
  caseDef: EvalCase,
  token: string,
): Promise<EvalCaseResult> {
  const startedAt = Date.now();
  if (caseDef.expectations.customValidator === 'detailRehydrate') {
    return runDetailRehydrate(caseDef, token, startedAt);
  }
  return runStandardCase(caseDef, token, startedAt);
}

function summarizeFailures(failures: string[]): string {
  if (failures.length === 0) return '';
  return ` — ${failures.join('; ')}`;
}

async function main(): Promise<void> {
  const suiteName = process.argv[2] ?? 'p0-smoke';
  const suitePath = resolve(__dirname, 'eval-cases', `${suiteName}.json`);

  let raw: string;
  try {
    raw = await fs.readFile(suitePath, 'utf8');
  } catch (err) {
    throw new Error(
      `suite "${suiteName}" not found at ${suitePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const cases: EvalCase[] = JSON.parse(raw);
  if (!Array.isArray(cases)) {
    throw new Error(`suite "${suiteName}" did not parse as an array`);
  }

  if (cases.length === 0) {
    console.log(`[eval] suite "${suiteName}" is empty — nothing to run.`);
    return;
  }

  await ensureUser(EVAL_USER_EXTERNAL_ID);
  const token = await signAccessToken({
    sub: EVAL_USER_EXTERNAL_ID,
    plan: 'free',
  });

  console.log(`[eval] suite=${suiteName} cases=${cases.length}`);
  console.log(`[eval] base=${BASE_URL} user=${EVAL_USER_EXTERNAL_ID}`);

  const startedAtIso = new Date().toISOString();
  const startedMs = Date.now();
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    const head = `▶ ${c.id} [${c.category}] ${c.prompt.slice(0, 60)}`;
    console.log(head);
    const r = await runCase(c, token);
    const mark = r.ok ? '✓' : '✗';
    console.log(
      `  ${mark} ${r.terminalStatus ?? '-'} ${r.durationMs}ms${summarizeFailures(r.failures)}`,
    );
    results.push(r);
  }

  const finishedAtIso = new Date().toISOString();
  const totalMs = Date.now() - startedMs;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const report: EvalReport = {
    suite: suiteName,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    totalMs,
    passed,
    failed,
    total: results.length,
    baseUrl: BASE_URL,
    evalUserExternalId: EVAL_USER_EXTERNAL_ID,
    cases: results,
  };

  const outDir = resolve(process.cwd(), 'eval-results');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = startedAtIso.replace(/[:.]/g, '-');
  const outPath = resolve(outDir, `${suiteName}-${stamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));

  // Phase 1 follow-up — EvalOps v1: also produce a markdown
  // summary alongside the JSON report. DB-driven; best-effort.
  // Failures here log a warning but don't change the runner's
  // exit code (the JSON report is the durable artifact).
  let summaryPath: string | undefined;
  try {
    summaryPath = await writeEvalSummary({
      report,
      reportPath: outPath,
      evalUserExternalId: EVAL_USER_EXTERNAL_ID,
    });
  } catch (err) {
    console.warn(
      `[eval] summary writer crashed (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log('');
  console.log(`[eval] ${passed}/${results.length} passed (${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`[eval] report: ${outPath}`);
  if (summaryPath) {
    console.log(`[eval] summary: ${summaryPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[eval] runner crashed:', err);
  process.exit(2);
});
