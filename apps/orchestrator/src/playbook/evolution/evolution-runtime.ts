import type { DB } from '../../db/client.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import { makeDocFirstExploreSite, runExplorerBatch } from '../explorer/explorer.js';
import { PlaybookRepository } from '../playbook-repository.js';
import { SiteRepository } from '../site-repository.js';
import { DrizzleEvolutionStore } from './drizzle-evolution-store.js';
import type { EvolutionConfig } from './evolution-config.js';
import type { EvolutionJobHandlers } from './evolution-scheduler.js';
import { EXPLORER_SCHEDULED_SITES } from './explorer-sites.js';
import { type BrowserSession, runCanaryRound, runSedimentSweep } from './self-evolution.js';

/**
 * Batch 06 — production wiring of the background jobs.
 *
 * Model access goes through the model runtime (catalog default brain = 千问),
 * `generate` lane. Background jobs have no requesting user, so they run as a
 * configured system actor in a configured data region:
 *   PLAYBOOK_EVOLUTION_ACTOR_EXTERNAL_ID, PLAYBOOK_EVOLUTION_MODEL_REGION (cn|intl).
 * When either is missing the sediment job uses the deterministic generaliser
 * only (zero model calls) — fail-closed, never an unattributed model call.
 */

interface RuntimeLogger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}

export function resolveEvolutionGenerateAdapter(input: {
  wiring: ProductionModelRuntimeWiring | null;
  env?: NodeJS.ProcessEnv;
}): MessagesAdapter | null {
  const env = input.env ?? process.env;
  const actor = env.PLAYBOOK_EVOLUTION_ACTOR_EXTERNAL_ID?.trim();
  const region = env.PLAYBOOK_EVOLUTION_MODEL_REGION?.trim();
  if (!input.wiring || !actor || (region !== 'cn' && region !== 'intl')) return null;
  const runtime = input.wiring.resolveCore({
    actorExternalId: actor,
    lane: 'generate',
    ownership: { scope: 'personal', userRegion: region },
  });
  return runtime.kind === 'ready' ? runtime.messages('standard') : null;
}

/** Isolated canary browser: fresh headless Chromium context, no cookies/profile. */
export async function createIsolatedBrowserFactory(opts: { timeoutMs?: number } = {}) {
  const { chromium } = await import('playwright');
  const { PlaywrightBrowserTools } = await import('../replay/playwright-browser-tools.js');
  const browser = await chromium.launch({ headless: true, timeout: 30_000 });
  return {
    open: async (): Promise<BrowserSession> => {
      const context = await browser.newContext({ acceptDownloads: false });
      const page = await context.newPage();
      return {
        tools: new PlaywrightBrowserTools(page, { timeoutMs: opts.timeoutMs ?? 10_000 }),
        close: () => context.close(),
      };
    },
    close: () => browser.close(),
  };
}

export function createEvolutionJobHandlers(deps: {
  db: DB;
  config: EvolutionConfig;
  wiring: ProductionModelRuntimeWiring | null;
  scrapeDoc?: (url: string) => Promise<{ markdown: string; title: string } | null>;
  logger: RuntimeLogger;
}): EvolutionJobHandlers {
  const store = new DrizzleEvolutionStore(deps.db);
  return {
    sediment: async () => {
      const report = await runSedimentSweep({
        store,
        adapter: resolveEvolutionGenerateAdapter({ wiring: deps.wiring }),
        minSupport: deps.config.sedimentMinSupport,
        logger: deps.logger,
      });
      deps.logger.info(
        {
          groups: report.groups,
          created: report.created.length,
          rejected: report.rejected.length,
          modelCalls: report.modelCalls,
        },
        'playbook sediment sweep finished',
      );
      return report;
    },
    canary: async () => {
      const browser = await createIsolatedBrowserFactory();
      try {
        return await runCanaryRound({
          store,
          openBrowser: browser.open,
          passThreshold: deps.config.canaryPassThreshold,
          batchSize: deps.config.canaryBatchSize,
          logger: deps.logger,
        });
      } finally {
        await browser.close().catch(() => {});
      }
    },
    explore: async () => {
      if (EXPLORER_SCHEDULED_SITES.length === 0)
        return { skipped: 'no scheduled sites configured' };
      const scrapeDoc = deps.scrapeDoc ?? (async () => null);
      return runExplorerBatch(
        {
          exploreSite: makeDocFirstExploreSite({
            scrapeDoc,
            siteRepo: new SiteRepository(deps.db),
            capabilityRepo: new PlaybookRepository(deps.db),
          }),
          logger: deps.logger,
        },
        { seedSites: [...EXPLORER_SCHEDULED_SITES], dryRun: false },
      );
    },
  };
}
