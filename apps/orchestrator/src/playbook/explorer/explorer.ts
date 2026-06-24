import {
  type BudgetBreakers,
  checkBreaker,
  firecrawlScrapeCostUsd,
  firstTripped,
  perBatchBreakerUsd,
  readBudgetBreakersFromEnv,
} from './explorer-budget.js';

/**
 * Playbook ④ explorer — ORCHESTRATOR SHELL (control + safety) + doc-first impl.
 *
 * The shell enforces the three NEVER-runs locks and the budget gate around a
 * per-site loop; the actual per-site work is injected (`exploreSite`) so the
 * shell is unit-testable with fakes and the heavy real impl stays swappable.
 *
 *   LOCK 1  EXPLORER_ENABLED != 'true'  → returns immediately, dispatches nothing.
 *   LOCK 2  budget caps default 0       → checkBudget refuses on the first site.
 *   LOCK 3  CLI default --dry-run        → plan only, no dispatch, no spend.
 *   + no cron/timer anywhere (phase-1 = manual BOSS trigger only).
 *
 * NOT wired into any hot path; NOT auto-run. See PLAYBOOK_PHASE4_EXPLORER_DESIGN.md.
 */

export function isExplorerEnabled(): boolean {
  return process.env.EXPLORER_ENABLED === 'true';
}

export type ExploreSiteStatus = 'completed' | 'failed' | 'halted_sensitive';

export interface ExploreSiteOutcome {
  domain: string;
  status: ExploreSiteStatus;
  /**
   * REAL spend this site incurred (USD) — Firecrawl scrape + any llm_calls from a
   * browse-试用. The budget gate fences on this, so the impl MUST report it honestly
   * (the gate cannot otherwise see Firecrawl, which is not an llm_calls row).
   */
  costUsd: number;
  capabilityExternalId?: string;
  pathsCreated?: number;
  note: string;
  /** browse-试用 v2 — the model's final report (任务流程 / 能力清单 / 断点报告). Persisted into
   *  exploration_runs.metadata for the "免登录够不够" evidence review. */
  summary?: string;
}

export type PerSiteStatus =
  | 'dry_run'
  | 'completed'
  | 'failed'
  | 'halted_sensitive'
  | 'halted_budget' // per-site breaker tripped on THIS site (site stopped, batch continues)
  | 'skipped_budget'; // batch/day/month breaker already tripped before this site

export interface PerSiteResult {
  domain: string;
  status: PerSiteStatus;
  note: string;
  capabilityExternalId?: string;
}

export interface ExplorerBatchResult {
  enabled: boolean;
  dryRun: boolean;
  halted: boolean;
  haltReason: string | null;
  sitesPlanned: number;
  sitesExplored: number;
  totalSpentUsd: number;
  breakers: BudgetBreakers;
  /** Computed batch breaker = siteCount × perSiteSeed × factor. */
  batchBreakerUsd: number;
  perSite: PerSiteResult[];
}

export interface ExplorerShellDeps {
  /**
   * Per-site exploration work (doc-first impl, or a fake in tests). Each call
   * reports the REAL spend it incurred via `outcome.costUsd`; the shell accumulates
   * that — so the budget gate fences ALL spend, incl. Firecrawl (not just llm_calls).
   */
  exploreSite: (domain: string) => Promise<ExploreSiteOutcome>;
  /**
   * Prior cumulative explorer spend TODAY (USD) — base for the per-day breaker so it
   * survives across batches. Optional; defaults to 0 (within-batch day enforcement
   * still applies). Wire to sum `exploration_runs` cost for the current day.
   */
  readPriorDaySpendUsd?: () => Promise<number>;
  /**
   * Prior cumulative explorer spend THIS MONTH (USD) — base for the per-month breaker.
   * Optional; defaults to 0. Wire to sum `exploration_runs` cost this month.
   */
  readPriorMonthSpendUsd?: () => Promise<number>;
  logger?: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
}

export interface ExplorerBatchOptions {
  seedSites: string[];
  /** DEFAULT true — list the plan + per-site budget verdict, dispatch nothing, spend nothing. */
  dryRun: boolean;
}

function countExplored(perSite: PerSiteResult[]): number {
  return perSite.filter((p) => p.status === 'completed').length;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run one exploration batch over the BOSS-supplied seed sites. Honours the locks +
 * the three-layer circuit breaker (charter §A): the per-SITE breaker stops THAT site
 * (batch continues); the per-BATCH / per-DAY / per-MONTH breakers stop the whole
 * batch. Breakers fence ABNORMAL spend — a normal site ($0.5-2) completes well under.
 *
 *   LOCK 1  EXPLORER_ENABLED != 'true'  → no real dispatch (dry-run still previews).
 *   LOCK 2  CLI default --dry-run        → preview only: no dispatch, no spend.
 * Spend is additionally bounded by the breakers (defaults $5 site / $50 day / $200
 * month) once running — see explorer-budget.ts.
 */
export async function runExplorerBatch(
  deps: ExplorerShellDeps,
  opts: ExplorerBatchOptions,
): Promise<ExplorerBatchResult> {
  const breakers = readBudgetBreakersFromEnv();
  const enabled = isExplorerEnabled();
  // Phase-1 seed batch uses the seed per-site breaker (phase-2 stranger sites use
  // perSiteStrangerUsd — wired when the heat-trigger queue lands).
  const perSiteBreaker = breakers.perSiteSeedUsd;
  const batchBreakerUsd = perBatchBreakerUsd(
    opts.seedSites.length,
    perSiteBreaker,
    breakers.perBatchFactor,
  );
  const base: Omit<
    ExplorerBatchResult,
    'halted' | 'haltReason' | 'sitesExplored' | 'totalSpentUsd' | 'perSite'
  > = {
    enabled,
    dryRun: opts.dryRun,
    sitesPlanned: opts.seedSites.length,
    breakers,
    batchBreakerUsd,
  };

  // LOCK 1 — a REAL run requires the master switch. A dry-run still previews the plan
  // (dispatches nothing, spends nothing) so BOSS can inspect it while disabled.
  if (!enabled && !opts.dryRun) {
    return {
      ...base,
      halted: true,
      haltReason: "EXPLORER_ENABLED != 'true' — explorer disabled (no real run)",
      sitesExplored: 0,
      totalSpentUsd: 0,
      perSite: [],
    };
  }

  const perSite: PerSiteResult[] = [];
  let totalSpent = 0;
  const dayBase = (await deps.readPriorDaySpendUsd?.()) ?? 0;
  const monthBase = (await deps.readPriorMonthSpendUsd?.()) ?? 0;

  // Global breakers (month/day/batch) — evaluated on the prior bases + this batch's
  // running spend. Tripping any stops the WHOLE batch.
  const globalTripped = () =>
    firstTripped([
      checkBreaker(monthBase + totalSpent, breakers.perMonthUsd, 'per-month'),
      checkBreaker(dayBase + totalSpent, breakers.perDayUsd, 'per-day'),
      checkBreaker(totalSpent, batchBreakerUsd, 'per-batch'),
    ]);

  for (const domain of opts.seedSites) {
    const pre = globalTripped();

    if (opts.dryRun) {
      // LOCK 2 — preview only.
      perSite.push({
        domain,
        status: 'dry_run',
        note: `would explore — ${pre ? pre.reason : 'global breakers ok'}`,
      });
      continue;
    }

    if (pre) {
      deps.logger?.warn({ domain, reason: pre.reason }, 'explorer: halt (pre-site global breaker)');
      perSite.push({ domain, status: 'skipped_budget', note: pre.reason });
      return {
        ...base,
        halted: true,
        haltReason: pre.reason,
        sitesExplored: countExplored(perSite),
        totalSpentUsd: totalSpent,
        perSite,
      };
    }

    // REAL per-site work — only reachable when enabled + !dry-run + no global trip.
    let outcome: ExploreSiteOutcome;
    try {
      outcome = await deps.exploreSite(domain);
    } catch (err) {
      // A single-site failure doesn't abort the batch.
      perSite.push({ domain, status: 'failed', note: `exploreSite threw: ${errMsg(err)}` });
      deps.logger?.warn({ domain, err: errMsg(err) }, 'explorer: site failed');
      continue;
    }
    // (a) FAIL-CLOSED on an INDETERMINATE cost. A non-finite / negative costUsd means we
    // CANNOT confirm this site's spend — treating it as $0 and continuing would fail-OPEN
    // (the breaker flies blind). Halt the whole batch (the spend meter is unreliable). A
    // finite 0 is LEGITIMATE (a browse that made no billable call) → NOT a trip, normal flow.
    if (
      typeof outcome.costUsd !== 'number' ||
      !Number.isFinite(outcome.costUsd) ||
      outcome.costUsd < 0
    ) {
      deps.logger?.warn(
        { domain, costUsd: outcome.costUsd },
        'explorer: INDETERMINATE site cost — fail-closed halt (cannot confirm spend)',
      );
      perSite.push({
        domain,
        status: 'halted_budget',
        note: `cost indeterminate (${String(outcome.costUsd)}) — fail-closed halt; spend unconfirmable`,
        ...(outcome.capabilityExternalId
          ? { capabilityExternalId: outcome.capabilityExternalId }
          : {}),
      });
      return {
        ...base,
        halted: true,
        haltReason: `indeterminate cost for ${domain} — fail-closed (spend meter unreliable)`,
        sitesExplored: countExplored(perSite),
        totalSpentUsd: totalSpent,
        perSite,
      };
    }
    const siteCost = outcome.costUsd; // finite, >= 0 — a finite 0 is legit, not a trip
    totalSpent += siteCost;

    // Per-SITE breaker: an abnormal single-site burn stops THIS site (flag it); the
    // batch continues. Normal completion is well under the $5 default, so a healthy
    // site never trips it.
    const siteTrip = checkBreaker(siteCost, perSiteBreaker, 'per-site');
    if (siteTrip.tripped) {
      deps.logger?.warn({ domain, reason: siteTrip.reason }, 'explorer: per-site breaker tripped');
    }
    perSite.push({
      domain,
      status: siteTrip.tripped ? 'halted_budget' : outcome.status,
      note: `${siteTrip.tripped ? `${siteTrip.reason} — ` : ''}${outcome.note} (cost $${siteCost.toFixed(4)})`,
      ...(outcome.capabilityExternalId
        ? { capabilityExternalId: outcome.capabilityExternalId }
        : {}),
    });

    // Post-site: a global (batch/day/month) breaker now tripped → stop the whole batch.
    const post = globalTripped();
    if (post) {
      deps.logger?.warn(
        { domain, reason: post.reason, totalSpent },
        'explorer: halt (post-site global breaker)',
      );
      return {
        ...base,
        halted: true,
        haltReason: post.reason,
        sitesExplored: countExplored(perSite),
        totalSpentUsd: totalSpent,
        perSite,
      };
    }
  }

  return {
    ...base,
    halted: false,
    haltReason: null,
    sitesExplored: countExplored(perSite),
    totalSpentUsd: totalSpent,
    perSite,
  };
}

// ---------------------------------------------------------------------------
// Capability-1 DOC-FIRST per-site impl (v1 skeleton)
// ---------------------------------------------------------------------------

/** Minimal structural views of the repos this impl needs (real repos satisfy them). */
export interface DocFirstSiteRepo {
  findGlobalByDomain(domain: string): Promise<{ id: number } | null>;
  create(input: {
    ownerUserId: null;
    canonicalDomain: string;
    displayName: string;
    homepageUrl: string;
  }): Promise<{ id: number }>;
}
export interface DocFirstCapabilityRepo {
  listCapabilitiesForSite(
    siteId: number,
  ): Promise<Array<{ id: number; capabilityKey: string; externalId: string }>>;
  createCapability(input: {
    siteId: number;
    capabilityKey: string;
    displayName: string;
    description: string;
    status: string;
  }): Promise<{ externalId: string }>;
}

export interface DocFirstDeps {
  /** Firecrawl scrape (cheap, no browser, zero live actions → inherently D-safe). */
  scrapeDoc: (url: string) => Promise<{ markdown: string; title: string } | null>;
  siteRepo: DocFirstSiteRepo;
  capabilityRepo: DocFirstCapabilityRepo;
}

export const DOC_FIRST_CAPABILITY_KEY = 'explored_doc';

/**
 * Build the doc-first `exploreSite`. v1 = scrape the site's doc page → upsert a
 * global site → write/reuse a DRAFT `explored_doc` capability seeded from the doc.
 * No live browser actions, so the Sensitive Site Protocol / D-boundary is trivially
 * satisfied. TODO(④ next): LLM-understand the doc into a structured input/output
 * schema; optional 免登录试用 → captures → crystallize a draft path.
 */
export function makeDocFirstExploreSite(
  deps: DocFirstDeps,
): (domain: string) => Promise<ExploreSiteOutcome> {
  return async (domain: string): Promise<ExploreSiteOutcome> => {
    const docUrl = `https://${domain}/`; // v1: homepage; TODO: discover /docs, /api, /developers
    // A scrape call is billable whether or not it returns content → report its cost
    // so the budget gate fences it (Firecrawl is not an llm_calls row).
    const costUsd = firecrawlScrapeCostUsd();
    const doc = await deps.scrapeDoc(docUrl);
    if (!doc) {
      return {
        domain,
        status: 'failed',
        costUsd,
        note: `doc-first: scrape returned nothing for ${docUrl}`,
      };
    }
    let site = await deps.siteRepo.findGlobalByDomain(domain);
    if (!site) {
      site = await deps.siteRepo.create({
        ownerUserId: null,
        canonicalDomain: domain,
        displayName: (doc.title || domain).slice(0, 255),
        homepageUrl: docUrl,
      });
    }
    const caps = await deps.capabilityRepo.listCapabilitiesForSite(site.id);
    const existing = caps.find((c) => c.capabilityKey === DOC_FIRST_CAPABILITY_KEY);
    const capabilityExternalId = existing
      ? existing.externalId
      : (
          await deps.capabilityRepo.createCapability({
            siteId: site.id,
            capabilityKey: DOC_FIRST_CAPABILITY_KEY,
            displayName: (doc.title || domain).slice(0, 255),
            description: doc.markdown.slice(0, 2000),
            status: 'draft',
          })
        ).externalId;
    return {
      domain,
      status: 'completed',
      costUsd,
      capabilityExternalId,
      note: `doc-first: scraped ${docUrl} → draft '${DOC_FIRST_CAPABILITY_KEY}' capability`,
    };
  };
}
