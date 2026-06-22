/**
 * ① 被动结晶 v1 — offline batch CLI.
 *
 * Crystallizes successful tasks' captured trajectories into draft
 * operation_paths (+ steps). OFFLINE ONLY — not wired into any hot path.
 *
 *   DRY-RUN (default, writes NOTHING):
 *     set -a && . .env && set +a && pnpm tsx scripts/crystallize-paths.ts
 *   COMMIT (writes Pack A tables — sites / site_capabilities /
 *           operation_paths / operation_path_steps):
 *     set -a && . .env && set +a && pnpm tsx scripts/crystallize-paths.ts --commit
 *   Options: --limit=N   cap candidate tasks scanned.
 *
 * Idempotent: a task already crystallized (operation_paths.source_task_id)
 * is skipped, so re-runs don't duplicate.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Load env BEFORE importing the db client — its pool reads DATABASE_URL at
// import time, so this must run first (hence the dynamic imports below).
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
const { crystallizeTasks } = await import('../src/playbook/crystallizer.js');
type CrystallizeResult = Awaited<ReturnType<typeof crystallizeTasks>>;

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const dryRun = !commit; // DEFAULT dry-run; must pass --commit to write
const limitArg = argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  const cp = Array.from(t);
  return cp.length <= max ? t : `${cp.slice(0, max).join('')}…`;
}

function printResult(result: CrystallizeResult): void {
  for (const p of result.planned) {
    const tag = result.committed ? `created ${p.committedPathExternalId ?? '?'}` : 'would create';
    console.log(`\n─ PATH (${tag}) ← task ${p.sourceTaskExternalId}  [draft v${p.version}]`);
    console.log(
      `    site: ${p.siteAction} ${p.siteDomain}   capability: ${p.capabilityAction} ${p.capabilityKey}   crossDomain: ${p.crossDomain}`,
    );
    console.log(`    metadata.sourceTaskIntent: "${clip(p.metadata.sourceTaskIntent, 80)}"`);
    console.log(`    steps (${p.steps.length}):`);
    for (const s of p.steps) {
      const text = s.targetTextJson ? `[${clip(s.targetTextJson.candidates[0], 32)}]` : '-';
      const anchor = s.screenshotAnchorId ?? '-';
      const frame = s.framePath ? clip(s.framePath, 40) : '-';
      const sel = s.targetSelectorJson ? 'Y' : '-';
      const coord = s.coordinateFallbackJson ? 'Y' : '-';
      console.log(
        `      [${s.stepIndex}] ${s.stepType.padEnd(9)} intent="${clip(s.intent, 44)}"  text=${text} sel=${sel} coord=${coord} anchor=${anchor} frame=${frame}`,
      );
    }
  }

  const reasons = { already_crystallized: 0, no_site_domain: 0, no_captures: 0 } as Record<
    string,
    number
  >;
  for (const s of result.skipped) {
    reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    console.log(`─ SKIP task ${s.sourceTaskExternalId}: ${s.reason}`);
  }

  const totalSteps = result.planned.reduce((n, p) => n + p.steps.length, 0);
  console.log(
    `\n[crystallize] mode=${result.committed ? '🔴 COMMIT (wrote Pack A tables)' : 'DRY-RUN (no writes)'}  scanned=${result.scannedTasks}  planned=${result.planned.length} paths (${totalSteps} steps)  skipped=${result.skipped.length} (already=${reasons.already_crystallized} no_domain=${reasons.no_site_domain} no_caps=${reasons.no_captures})`,
  );
}

console.log(
  `[crystallize] mode=${dryRun ? 'DRY-RUN (no writes)' : '🔴 COMMIT (writing Pack A tables)'}${limit !== undefined ? ` limit=${limit}` : ''}`,
);

try {
  const result = await crystallizeTasks({ db }, { dryRun, limit });
  printResult(result);
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('[crystallize] FAILED:', err instanceof Error ? err.stack : String(err));
  await pool.end().catch(() => {});
  process.exit(1);
}
