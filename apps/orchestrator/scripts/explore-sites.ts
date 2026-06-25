/**
 * Playbook ④ active exploration — offline batch CLI (BOSS-triggered).
 *
 * ⚠️ DISABLED BY DEFAULT. The RUN gate is the master switch + --run; SPEND is bounded
 * by the three-layer circuit breaker (charter §A — fences abnormal spend, not normal
 * completion):
 *   1. EXPLORER_ENABLED=true   (env master switch; default off = explorer never runs)
 *   2. --run                   (else DEFAULT --dry-run = plan + breaker verdicts, no spend)
 *   + breakers (env-overridable, DEFAULT to the §A values — NOT 0): per-site
 *     EXPLORER_BREAKER_PER_SITE_SEED_USD=$5 / PER_SITE_STRANGER_USD=$3 / PER_DAY_USD=$50 /
 *     PER_MONTH_USD=$200 / BATCH_FACTOR=1.2. A non-positive override fail-safe-trips.
 * No cron/timer anywhere — phase-1 is manual BOSS trigger, one batch at a time.
 *
 *   DRY-RUN (default — lists the plan + breaker verdicts, dispatches nothing, spends nothing):
 *     set -a && . .env && set +a && pnpm tsx scripts/explore-sites.ts --sites=anthropic.com,openai.com
 *   REAL RUN (master switch + --run; breakers default to the §A values):
 *     EXPLORER_ENABLED=true pnpm tsx scripts/explore-sites.ts --sites=anthropic.com --run --batch=seed-2026-06-23
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import type { SupercarActionCaptureEvent } from '../src/agent/supercar/agent-loop.js';
import type { ExploreSiteOutcome } from '../src/playbook/explorer/explorer.js';

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
function loadEnv(path: string): void {
  const r = loadDotenv({ path, override: false });
  if (!r.parsed) return;
  for (const [k, v] of Object.entries(r.parsed)) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
}
loadEnv(resolve(appRoot, '.env'));
loadEnv(resolve(repoRoot, '.env'));
loadEnv(resolve(repoRoot, '.env.local'));

const { db, pool } = await import('../src/db/client.js');
const { runExplorerBatch, makeDocFirstExploreSite } = await import(
  '../src/playbook/explorer/explorer.js'
);
const { SiteRepository } = await import('../src/playbook/site-repository.js');
const { PlaybookRepository } = await import('../src/playbook/playbook-repository.js');

const argv = process.argv.slice(2);
const run = argv.includes('--run');
const dryRun = !run; // DEFAULT dry-run; must pass --run AND open the other two locks
// ④ browse-试用 lane (live veto + clean-context). OPT-IN: without --browse the lane is
// byte-identical doc-first (Firecrawl scrape, no browser, no live actions, no veto path).
const browse = argv.includes('--browse');
const sitesArg = argv.find((a) => a.startsWith('--sites='));
const seedSites = sitesArg
  ? sitesArg
      .slice('--sites='.length)
      .split(',')
      .map((s) =>
        s
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, ''),
      )
      .filter(Boolean)
  : argv.filter((a) => !a.startsWith('--'));
const batchArg = argv.find((a) => a.startsWith('--batch='));
const batchId = batchArg ? batchArg.slice('--batch='.length) : 'adhoc';

// Firecrawl scrape (doc-first; no browser, no live actions). Returns null when the
// key is absent or the scrape failed → the site is recorded as failed, never crashes.
let scrapeDoc: (url: string) => Promise<{ markdown: string; title: string } | null> = async () =>
  null;
const fcKey = process.env.FIRECRAWL_API_KEY;
if (fcKey) {
  const { createFirecrawlLane } = await import('../src/firecrawl/firecrawl-lane.js');
  const lane = createFirecrawlLane({
    apiKey: fcKey,
    ...(process.env.FIRECRAWL_BASE_URL ? { baseUrl: process.env.FIRECRAWL_BASE_URL } : {}),
  });
  scrapeDoc = async (url: string) => {
    const r = await lane.scrape(url);
    return r.ok ? { markdown: r.markdown, title: r.title ?? '' } : null;
  };
}

const siteRepo = new SiteRepository(db);
const playbookRepo = new PlaybookRepository(db);

// Declared BEFORE the lane branch below — the --browse wiring references `logger` + the
// prior-spend bases at construction time; declaring them AFTER the block was a runtime TDZ
// (`Cannot access 'logger' before initialization`) that tsc + the suite missed (the CLI
// script is not unit-tested). The --browse dry-run smoke now exercises this wiring.
const logger = {
  info: (o: unknown, m: string) => console.log(`[explorer] ${m}`, o),
  warn: (o: unknown, m: string) => console.warn(`[explorer] ⚠️ ${m}`, o),
};
// Per-day / per-month breaker bases: prior cumulative explorer spend today / this month.
// v1 returns 0 — TODO: sum exploration_runs.metadata_json.costUsd for the day / month so
// the breakers survive across batches (within-batch already enforced).
const readPriorDaySpendUsd = async (): Promise<number> => 0;
const readPriorMonthSpendUsd = async (): Promise<number> => 0;

let exploreSite: (domain: string) => Promise<ExploreSiteOutcome>;
if (browse) {
  // ── ④ browse-试用 lane ──────────────────────────────────────────────────────────
  // Heavy runtime imported LAZILY (only on --browse) so the default doc-first path never
  // loads the browser/supercar stack — keeps doc-first byte-identical (audit point 1).
  // EXPLORER_ENABLED still gates the whole run inside runExplorerBatch (audit point 6):
  // OFF → no exploreSite call → no connect / no browse / no spend.
  const {
    makeRunBrowseTask,
    withExplorationRun,
    requireBrowseEnv,
    resolveMaxIterations,
    resolveBrowseHardMs,
    resolveConnectMs,
    withHardDeadline,
    buildBreakpointSummary,
  } = await import('../src/playbook/explorer/explorer-browse-runner.js');
  // FAIL-CLOSED env gate (cost-source-A hinge): abort BEFORE any connect/spend if the
  // recorder-gating user id (missing → breaker reads $0 = fail-OPEN) or the live CDP
  // endpoint (9223; 9222 is dead) is absent. Tested: requireBrowseEnv in
  // explorer-browse-runner.test.ts.
  let explorerUser: string;
  let cdpEndpoint: string;
  try {
    ({ userExternalId: explorerUser, cdpEndpoint } = requireBrowseEnv(process.env));
  } catch (e) {
    console.error(`[explorer] ${e instanceof Error ? e.message : String(e)} Aborting.`);
    await pool.end().catch(() => {});
    process.exit(1);
  }
  // A1 — 4th INDEPENDENT lock: login-self-learning mode. Orthogonal to EXPLORER_ENABLED (NEVER
  // auto-enabled by it); default OFF. When on, the browse runs in an AUTHENTICATED test-account
  // context (storageState) with a THICKER veto (EXTRA_RE — money / irreversible / publish).
  // FAIL-CLOSED: login mode REQUIRES a storageState file path (else a "login" browse would
  // silently run logged-out, defeating the point + the thicker veto's purpose).
  const loginMode = process.env.LOGIN_EXPLORER_ENABLED === 'true';
  const loginStorageState = (process.env.LOGIN_EXPLORER_STORAGE_STATE ?? '').trim();
  if (loginMode && !loginStorageState) {
    console.error(
      '[explorer] LOGIN_EXPLORER_ENABLED=true requires LOGIN_EXPLORER_STORAGE_STATE (a test-account ' +
        'session file path). Refusing a "login" browse without it. Aborting.',
    );
    await pool.end().catch(() => {});
    process.exit(1);
  }
  if (loginMode) {
    logger.warn(
      { storageState: loginStorageState },
      'explorer: LOGIN mode ON — authenticated test-account browse + thickened veto (EXTRA_RE)',
    );
  }
  const { PlaywrightExecutor } = await import('../src/agent/vision-loop/playwright-executor.js');
  const { runSupercarTask } = await import('../src/agent/supercar/agent-loop.js');
  const { DrizzleLlmCallRecorder } = await import('../src/agent/llm-call-recorder.js');
  const { makeBrowseExploreSite } = await import('../src/playbook/explorer/explorer-browse.js');
  const { CostAccumulatingRecorder } = await import(
    '../src/playbook/explorer/cost-accumulating-recorder.js'
  );
  const { newExternalId } = await import('@holaday/shared-types');
  // ④ capture lane (additive): explorer trajectories must reach crystallize → create a
  // tasks row (FK for task_action_captures) + write captures via onAction.
  const { eq } = await import('drizzle-orm');
  const { tasks } = await import('../src/db/schema/tasks.js');
  const { users } = await import('../src/db/schema/users.js');
  const { readInsertId } = await import('../src/db/mysql-result.js');
  const { TaskActionCaptureRepository } = await import(
    '../src/playbook/task-action-capture-repository.js'
  );

  // (c) per-browse iteration cap — env-overridable (tune batch-1 without a redeploy),
  // fail-safe parsed + clamped to a fat-finger ceiling.
  const maxIterations = resolveMaxIterations(process.env.EXPLORER_MAX_ITERATIONS);
  const rawMaxIter = process.env.EXPLORER_MAX_ITERATIONS?.trim();
  if (rawMaxIter && String(maxIterations) !== rawMaxIter) {
    logger.warn(
      { requested: rawMaxIter, effective: maxIterations },
      'EXPLORER_MAX_ITERATIONS adjusted (fail-safe default or ceiling clamp)',
    );
  }

  // 🛡️ Batch resilience (browse-only): a stray background-op rejection (e.g. a Playwright op
  // rejecting after its page/context was torn down) must NOT kill the whole CLI mid-batch — that
  // abandons the remaining sites + leaves a stuck 'running' row (figma, browse-task-20260625
  // crashed the batch via an unhandled rejection at exit 1). Log it (so the actual error is
  // captured next time) and keep the batch alive; the per-browse hard wall + per-site status-update
  // still bound each site. Registered ONLY on the browse path (doc-first default stays untouched).
  process.on('unhandledRejection', (reason) => {
    logger.warn(
      { reason: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason) },
      'explorer CLI: unhandledRejection swallowed — batch kept alive (does not abort remaining sites)',
    );
  });

  const runBrowseTask = makeRunBrowseTask({
    cdpEndpoint,
    // Fresh executor per browse → each site gets its own isolated clean context.
    makeExecutor: () => new PlaywrightExecutor(),
    runSupercar: async ({ taskId, intent, executor, onBeforeAction }) => {
      // cost-source A: in-memory accumulator IS the breaker input (fail-closed); it wraps
      // a best-effort llm_calls writer (finance détail only — its failure never moves the
      // breaker). The supercar loop fires record() fire-and-forget; the accumulator sums
      // synchronously so `total` is complete when runSupercarTask returns.
      const recorder = new CostAccumulatingRecorder(
        new DrizzleLlmCallRecorder(db, {
          onError: (e) =>
            logger.warn(
              { err: e instanceof Error ? e.message : String(e) },
              'llm_calls write failed (finance détail; breaker unaffected)',
            ),
        }),
      );
      // ── ④ capture lane (additive, best-effort) ──────────────────────────────────────
      // Create a tasks row (origin='explorer' → excluded from user history/quota/activeUsers,
      // which filter origin='user') so the browse trajectory is captured (task_action_captures
      // FK) and reaches crystallize. A failure here disables capture for THIS run but NEVER
      // blocks the browse — veto / cost-source-A / clean-context are untouched.
      let taskDbId: number | null = null;
      let captureRepo: InstanceType<typeof TaskActionCaptureRepository> | null = null;
      try {
        const [u] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.externalId, explorerUser))
          .limit(1);
        if (u) {
          const ins = await db
            .insert(tasks)
            .values({ externalId: taskId, userId: u.id, intent, origin: 'explorer', status: 'running' });
          taskDbId = readInsertId(ins);
          captureRepo = new TaskActionCaptureRepository(db);
        } else {
          logger.warn({}, 'explorer: explorer user row not found → capture disabled this run (browse continues)');
        }
      } catch (e) {
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          'explorer: capture tasks-row create failed (capture disabled this run; browse continues)',
        );
      }
      // ③ in-memory step trail (always, regardless of capture-write success) → the deterministic
      // breakpoint summary below. Every action lands here synchronously even if the DB capture
      // write lags/fails.
      const browseSteps: Array<{ stepType: string; visibleText: string | null }> = [];
      // onAction → task_action_captures (mirrors tasks.ts; fire-and-forget, best-effort).
      const tid = taskDbId;
      const repo = captureRepo;
      const onAction =
        tid !== null && repo
          ? (ev: SupercarActionCaptureEvent) => {
              browseSteps.push({ stepType: ev.stepType, visibleText: ev.visibleText });
              void (async () => {
                try {
                  await repo.create({
                    taskId: tid,
                    siteDomain: ev.siteDomain,
                    actionIndex: ev.actionIndex,
                    stepType: ev.stepType,
                    visibleText: ev.visibleText,
                    targetSelectorJson: ev.targetSelector ? { selector: ev.targetSelector } : null,
                    coordinateJson: ev.coordinate,
                    framePath: ev.framePath,
                    entryUrl: ev.entryUrl,
                    inputValue: ev.inputValue,
                  });
                } catch (e) {
                  logger.warn(
                    { err: e instanceof Error ? e.message : String(e) },
                    'explorer: capture write failed (best-effort)',
                  );
                }
              })();
            }
          : undefined;
      // ④ per-browse HARD wall (robustness): runSupercarTask's `timeoutMs` is SOFT (checked
      // between turns) → a single hung page/CDP op (hostile / anti-bot site, e.g. douyin) can
      // block past it, pinning the browse + leaving a stuck 'running' row. Race a wall-clock
      // deadline; on timeout FORCE-dispose the clean context (rejects the in-flight op → the
      // hung loop unwinds) and resolve to a determinate `failed` outcome so the status-update
      // below still runs. Hard wall > the 300s soft timeout (soft gets first, clean crack).
      const hardMs = resolveBrowseHardMs(process.env.EXPLORER_BROWSE_HARD_MS);
      let outcome: { status: string; reason?: string; summary?: string };
      try {
        outcome = await withHardDeadline(
          runSupercarTask({
            taskId,
            intent,
            // makeExecutor returns a real PlaywrightExecutor (satisfies the minimal view too).
            executor: executor as unknown as PlaywrightExecutor,
            ...(process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : {}),
            onBeforeAction, // ← live-veto (§9.6 + Sensitive Protocol) — half of the two-part guard
            ...(onAction ? { onAction } : {}), // ← B2 capture (additive) → crystallize-able trajectory
            recorder,
            userExternalId: explorerUser,
            maxIterations, // (c) env-configurable hard per-browse cap (default 25, ceiling 50)
            timeoutMs: 300_000, // SOFT wall clock (between-turns)
            domain: null,
          }),
          hardMs,
          () => {
            logger.warn({ hardMs }, 'explorer: per-browse HARD wall exceeded — force-aborting (dispose clean context)');
            void executor.disposeCleanContext().catch(() => {}); // unblock any in-flight hung op
          },
        );
      } catch (e) {
        // hard-wall timeout OR runSupercarTask threw → still a determinate outcome (no stuck row).
        outcome = { status: 'failed', reason: e instanceof Error ? e.message : String(e) };
      }
      // Map outcome → tasks.status so crystallize (status IN completed/partial_success) only
      // distils a browse that actually COMPLETED — a halted / failed / maxIter-exhausted browse
      // stays non-success → never crystallized. Best-effort.
      if (taskDbId !== null) {
        try {
          const mapped =
            outcome.status === 'completed'
              ? 'completed'
              : outcome.status === 'awaiting_user'
                ? 'awaiting_user'
                : 'failed';
          await db.update(tasks).set({ status: mapped }).where(eq(tasks.id, taskDbId));
        } catch (e) {
          logger.warn(
            { err: e instanceof Error ? e.message : String(e) },
            'explorer: task status update failed (best-effort)',
          );
        }
      }
      // ③ ALWAYS produce a breakpoint summary: a COMPLETED browse keeps the model's rich report
      // (任务流程 + 能力清单 + 断点报告); any other termination (maxIter / soft / HARD force-abort /
      // veto-halt / connect-fail) gets a DETERMINISTIC one (step trail + stop reason) so the
      // exploration_run is never left without "免登录够不够" evidence (the batch-2 force-abort 白烧).
      const summary =
        outcome.summary && outcome.summary.trim()
          ? outcome.summary
          : buildBreakpointSummary({
              status: outcome.status,
              reason: outcome.reason,
              steps: browseSteps,
            });
      return { status: outcome.status, reason: outcome.reason, costUsd: recorder.total, summary };
    },
    newTaskExternalId: () => newExternalId('task'),
    // ① per-site connect/assert hard timeout — a hung connectOverCDP can't pin the batch.
    connectTimeoutMs: resolveConnectMs(process.env.EXPLORER_CONNECT_TIMEOUT_MS),
    // A2 — login mode seeds the isolated context with the test-account session + skips the
    // clean-context assert. Undefined when off → 免登录 lane (empty jar + assert) unchanged.
    ...(loginMode ? { storageState: loginStorageState } : {}),
    logger,
  });

  // makeBrowseExploreSite connects { cleanContext: true } (§9.6 backstop) via the runner
  // AND wires the veto hook — both halves of the guard. withExplorationRun persists one
  // exploration_runs row per browse (site / status / accurate in-memory cost / halt).
  // A3 — login mode thickens the live-veto (EXTRA_RE). Off → 免登录 veto unchanged.
  const browseExplore = makeBrowseExploreSite({ runBrowseTask, ...(loginMode ? { loginMode: true } : {}) });
  exploreSite = withExplorationRun(browseExplore, {
    resolveSiteId: async (domain) => {
      let s = await siteRepo.findGlobalByDomain(domain);
      if (!s)
        s = await siteRepo.create({
          ownerUserId: null,
          canonicalDomain: domain,
          displayName: domain,
          homepageUrl: `https://${domain}/`,
        });
      return s.id;
    },
    createExplorationRun: (input) => playbookRepo.createExplorationRun(input),
    logger,
  });
} else {
  // DEFAULT lane — doc-first (Firecrawl scrape; no browser, no live actions). Unchanged.
  exploreSite = makeDocFirstExploreSite({ scrapeDoc, siteRepo, capabilityRepo: playbookRepo });
}

console.log(
  `[explorer] mode=${dryRun ? 'DRY-RUN (no dispatch/spend)' : '🔴 RUN'} lane=${browse ? 'browse(live-veto+clean-context)' : 'doc-first'} batch=${batchId} sites=[${seedSites.join(', ') || '(none)'}]`,
);

try {
  const result = await runExplorerBatch(
    { exploreSite, readPriorDaySpendUsd, readPriorMonthSpendUsd, logger },
    { seedSites, dryRun },
  );
  console.log(
    `\n[explorer] enabled=${result.enabled} halted=${result.halted}${result.haltReason ? ` reason="${result.haltReason}"` : ''}`,
  );
  console.log(
    `[explorer] breakers: perSite=$${result.breakers.perSiteSeedUsd} perBatch=$${result.batchBreakerUsd.toFixed(2)} perDay=$${result.breakers.perDayUsd} perMonth=$${result.breakers.perMonthUsd}`,
  );
  for (const p of result.perSite) {
    console.log(
      `  ─ ${p.domain}: ${p.status}${p.capabilityExternalId ? ` (${p.capabilityExternalId})` : ''} — ${p.note}`,
    );
  }
  console.log(
    `[explorer] sitesPlanned=${result.sitesPlanned} sitesExplored=${result.sitesExplored} totalSpent=$${result.totalSpentUsd.toFixed(4)}`,
  );
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('[explorer] FAILED:', err instanceof Error ? err.stack : String(err));
  await pool.end().catch(() => {});
  process.exit(1);
}
