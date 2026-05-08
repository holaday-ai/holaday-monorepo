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
import type {
  EvalCase,
  EvalCaseResult,
  EvalReport,
} from './eval-suite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE = `http://127.0.0.1:${env.HTTP_PORT}`;
const BASE_URL = (process.env.EVAL_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
const EVAL_USER_EXTERNAL_ID =
  process.env.EVAL_USER_EXTERNAL_ID ?? 'usr_EeYpvsvLtyDzN4VLQi7BT';
const POLL_INTERVAL_MS = 1_500;
const DEFAULT_MAX_DURATION_MS = 180_000;
const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'awaiting_user',
]);

interface TaskDetail {
  taskId: string;
  intent: string;
  status: string;
  awaitingKind: string | null;
  awaitingQuestion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  result: unknown;
  planText: string | null;
  steps: Array<{ kind: string; seq: number; output: unknown }>;
}

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
): Promise<TaskDetail> {
  const deadline = Date.now() + maxMs;
  let last: TaskDetail | undefined;
  while (Date.now() < deadline) {
    last = await callQuery<TaskDetail>('tasks.detail', { taskId }, token);
    if (TERMINAL_STATUSES.has(last.status)) return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const lastStatus = last?.status ?? 'unknown';
  const err = new Error(
    `pollUntilTerminal: timed out after ${maxMs}ms (last status=${lastStatus})`,
  );
  // Attach last detail so the caller can still surface it in the report.
  (err as Error & { detail?: TaskDetail }).detail = last;
  throw err;
}

function readResultField<T = unknown>(result: unknown, key: string): T | null {
  if (result == null || typeof result !== 'object') return null;
  const v = (result as Record<string, unknown>)[key];
  return (v ?? null) as T | null;
}

function buildHaystack(detail: TaskDetail): string {
  const summary = readResultField<string>(detail.result, 'summary');
  const reason = readResultField<string>(detail.result, 'reason');
  return [summary, reason, detail.intent, detail.errorMessage]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join('\n');
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
  const detail = await callQuery<TaskDetail>(
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
  let detail: TaskDetail | undefined;
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
      detail = (err as Error & { detail?: TaskDetail }).detail;
      failures.push(
        `timeout: did not reach terminal in ${maxMs}ms (last status=${
          detail?.status ?? 'unknown'
        })`,
      );
    }

    // Run replySequence (if any) AFTER the parent reaches terminal /
    // awaiting_user. P0 doesn't use this; it's here so P1 multi-turn
    // cases drop in without runner changes.
    if (caseDef.replySequence && taskId && detail) {
      for (const turn of caseDef.replySequence) {
        await callMutation('tasks.reply', {
          taskId,
          message: turn.message,
          ...(turn.fileIds ? { fileIds: turn.fileIds } : {}),
        }, token);
        if (turn.pollAfter) {
          const maxMs = exp.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
          try {
            detail = await pollUntilTerminal(taskId, token, maxMs);
          } catch (err) {
            detail = (err as Error & { detail?: TaskDetail }).detail;
            failures.push(
              `replySequence: timed out after reply "${turn.message.slice(0, 40)}"`,
            );
          }
        }
      }
    }
  } catch (err) {
    failures.push(
      `exception during create/poll: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ---- Validation ----
  const finalUrl = readResultField<string>(detail?.result, 'finalUrl');
  const summary = readResultField<string>(detail?.result, 'summary');
  const resultExecMode = readResultField<string>(detail?.result, 'executionMode');
  if (resultExecMode) executionMode = resultExecMode;

  if (detail) {
    if (exp.terminalStatus && detail.status !== exp.terminalStatus) {
      failures.push(
        `terminalStatus: expected ${exp.terminalStatus}, got ${detail.status}`,
      );
    }
    if (
      exp.mustComplete &&
      !exp.terminalStatus &&
      detail.status !== 'completed'
    ) {
      failures.push(
        `mustComplete: status=${detail.status}${
          detail.errorMessage ? ` (errorMessage="${detail.errorMessage}")` : ''
        }`,
      );
    }
    if (exp.executionMode && executionMode !== exp.executionMode) {
      failures.push(
        `executionMode: expected ${exp.executionMode}, got ${executionMode ?? 'null'}`,
      );
    }
    if (exp.awaitingKind && detail.awaitingKind !== exp.awaitingKind) {
      failures.push(
        `awaitingKind: expected ${exp.awaitingKind}, got ${detail.awaitingKind ?? 'null'}`,
      );
    }
    const haystack = buildHaystack(detail);
    for (const needle of exp.mustContain ?? []) {
      if (!haystack.includes(needle)) {
        failures.push(`mustContain: missing "${needle}"`);
      }
    }
    if (exp.mustContainAny && exp.mustContainAny.length > 0) {
      const hit = exp.mustContainAny.some((n) => haystack.includes(n));
      if (!hit) {
        failures.push(
          `mustContainAny: none of [${exp.mustContainAny.join(', ')}] appeared`,
        );
      }
    }
    for (const needle of exp.mustNotContain ?? []) {
      if (haystack.includes(needle)) {
        failures.push(`mustNotContain: contains "${needle}"`);
      }
    }
    if (exp.urlMustMatch) {
      if (!finalUrl || !finalUrl.includes(exp.urlMustMatch)) {
        failures.push(
          `urlMustMatch: finalUrl=${finalUrl ?? 'null'} doesn't include "${exp.urlMustMatch}"`,
        );
      }
    }
  } else if (!timedOut) {
    failures.push('runner: no detail captured — task never created');
  }

  if (exp.customValidator && exp.customValidator !== 'detailRehydrate') {
    failures.push(`unknown customValidator "${exp.customValidator}"`);
  }

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

  console.log('');
  console.log(`[eval] ${passed}/${results.length} passed (${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`[eval] report: ${outPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[eval] runner crashed:', err);
  process.exit(2);
});
