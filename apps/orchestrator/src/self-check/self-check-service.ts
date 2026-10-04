import type { Logger } from 'pino';
import { type SelfCheckDeps, type SelfCheckReport, runSelfCheck } from './self-check.js';

/** Switches shown on the panel. Explicit allowlist: nothing outside it is ever read. */
export const SELF_CHECK_FLAG_NAMES = [
  'BROWSER_EXECUTOR',
  'QWEN_CORE_ROLLOUT_MODE',
  'QWEN_CORE_ENABLED_LANES',
  'QWEN_MESSAGES_ADAPTER_ENABLED',
  'QWEN_RESPONSES_ADAPTER_ENABLED',
  'QWEN_PLAN_CANARY_ENABLED',
  'QWEN_SUGGESTIONS_CANARY_ENABLED',
  'QWEN_SHADOW_EVAL_ENABLED',
  'EXECUTION_CONTRACT_ENABLED',
  'EXECUTION_VERIFIER_ENABLED',
  'EVIDENCE_LEDGER_ENABLED',
  'LEDGER_DB_WRITE_ENABLED',
  'EXPERT_WORKFLOW_ENABLED',
  'ACTION_CAPTURE_ENABLED',
  'PLAYBOOK_REUSE_ENABLED',
  'PLAYBOOK_SEDIMENT_ENABLED',
  'PLAYBOOK_CANARY_ENABLED',
  'MEMORY_EXTRACTION_ENABLED',
  'RETENTION_REAPER_ENABLED',
  'OTA_USER_BROWSER_ENABLED',
  'VIDEO_CREATION_ENABLED',
  'VIDEO_EDITING_ENABLED',
  'TEMPLATE_FILL_ENABLED',
  'ASHARE_QA_ENABLED',
  'ASHARE_INTENT_JUDGE_ENABLED',
  'ASHARE_SEETHROUGH_ENABLED',
  'ASHARE_RISK_RADAR_ENABLED',
  'ASHARE_PERF_TREND_ENABLED',
  'ACCOUNT_CLOSURE_ENABLED',
  'TEAM_PROJECTS_ENABLED',
  'ASTROLOGY_ENABLED',
  'STORAGE_PROVIDER',
] as const;

export function readSelfCheckFlags(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(SELF_CHECK_FLAG_NAMES.map((name) => [name, source[name]]));
}

export const SELF_CHECK_CACHE_MS = 5 * 60_000;

export interface SelfCheckResult {
  report: SelfCheckReport;
  cached: boolean;
  cachedAt: string;
}

/**
 * Process-wide cache (5 min) + audit line per run. A cached answer is served
 * unless `force`; concurrent clicks share one in-flight run, so a burst of
 * clicks costs at most one probe per model.
 */
export function createSelfCheckService(input: {
  logger: Pick<Logger, 'info'>;
  now?: () => number;
  run?: (deps: SelfCheckDeps) => Promise<SelfCheckReport>;
}) {
  const now = input.now ?? Date.now;
  const run = input.run ?? runSelfCheck;
  const cache = new Map<string, { report: SelfCheckReport; at: number }>();
  const inflight = new Map<string, Promise<SelfCheckReport>>();

  return {
    latest(region: string): SelfCheckResult | null {
      const hit = cache.get(region);
      if (!hit || now() - hit.at >= SELF_CHECK_CACHE_MS) return null;
      return { report: hit.report, cached: true, cachedAt: new Date(hit.at).toISOString() };
    },
    async check(request: {
      deps: SelfCheckDeps;
      actorExternalId: string;
      source: 'admin' | 'cli';
      force?: boolean;
    }): Promise<SelfCheckResult> {
      const region = request.deps.region;
      const hit = cache.get(region);
      if (!request.force && hit && now() - hit.at < SELF_CHECK_CACHE_MS) {
        input.logger.info(
          { event: 'admin.self_check', actor: request.actorExternalId, region, cached: true },
          'self-check served from cache',
        );
        return { report: hit.report, cached: true, cachedAt: new Date(hit.at).toISOString() };
      }
      let pending = inflight.get(region);
      if (!pending) {
        pending = run(request.deps).finally(() => inflight.delete(region));
        inflight.set(region, pending);
      }
      const report = await pending;
      const at = now();
      cache.set(region, { report, at });
      // Audit: who ran it and the outcome. Item ids + statuses only — no keys, no messages.
      input.logger.info(
        {
          event: 'admin.self_check',
          actor: request.actorExternalId,
          source: request.source,
          region,
          brainId: report.brainId,
          summary: report.summary,
          failed: report.items.filter((entry) => entry.status === 'fail').map((entry) => entry.id),
          warned: report.items.filter((entry) => entry.status === 'warn').map((entry) => entry.id),
        },
        'self-check completed',
      );
      return { report, cached: false, cachedAt: new Date(at).toISOString() };
    },
  };
}
