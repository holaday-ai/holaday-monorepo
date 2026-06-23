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
const exploreSite = makeDocFirstExploreSite({ scrapeDoc, siteRepo, capabilityRepo: playbookRepo });

// Per-day / per-month breaker bases: prior cumulative explorer spend today / this
// month. v1 returns 0 — TODO: sum exploration_runs.metadata_json.costUsd for the
// day / month so the breakers survive across batches (within-batch already enforced).
const readPriorDaySpendUsd = async (): Promise<number> => 0;
const readPriorMonthSpendUsd = async (): Promise<number> => 0;

const logger = {
  info: (o: unknown, m: string) => console.log(`[explorer] ${m}`, o),
  warn: (o: unknown, m: string) => console.warn(`[explorer] ⚠️ ${m}`, o),
};

console.log(
  `[explorer] mode=${dryRun ? 'DRY-RUN (no dispatch/spend)' : '🔴 RUN'} batch=${batchId} sites=[${seedSites.join(', ') || '(none)'}]`,
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
