/**
 * Phase 13 Dim 6 — execution stats.
 *
 * Logs each tool call's outcome (lane, latency, success, error
 * type) so the ExecutionRouter can score future routes by recent
 * empirical performance per (user, target_site). Score formula:
 *
 *   score = successRate × 0.7 + (1 - latencyNormalised) × 0.3
 *
 * Window: last 30 days. Min sample size: 3 events per lane (below
 * that we fall back to the default route to avoid premature
 * convergence on a single bad outcome).
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../../db/client.js';
import { executionStats } from '../../db/schema/execution-stats.js';

export interface StatRecordInput {
  userIdInternal: number;
  taskExternalId: string;
  taskType: string | null;
  targetSite: string | null;
  laneUsed: string;
  success: boolean;
  latencyMs: number | null;
  errorType: string | null;
}

export interface LaneScore {
  lane: string;
  count: number;
  successRate: number;
  avgLatencyMs: number;
  score: number;
}

export class StatsService {
  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
  ) {}

  /**
   * Insert a stat row. Best-effort — never throws; a stat-write
   * failure shouldn't kill the agent loop.
   */
  async record(input: StatRecordInput): Promise<void> {
    try {
      await this.db.insert(executionStats).values({
        userId: input.userIdInternal,
        taskExternalId: input.taskExternalId,
        taskType: input.taskType,
        targetSite: input.targetSite,
        laneUsed: input.laneUsed,
        success: input.success,
        latencyMs: input.latencyMs,
        errorType: input.errorType,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), input },
        'stats: insert failed',
      );
    }
  }

  /**
   * Convenience wrapper around `scoreLanes` for the common "give me
   * the best lane name" case. Returns null when no usable history —
   * caller falls back to the default route. The minimum sample
   * size + the score formula are inherited from scoreLanes.
   */
  async getOptimalLane(opts: {
    userIdInternal: number;
    targetSite: string;
    minSamples?: number;
  }): Promise<string | null> {
    const ranked = await this.scoreLanes(opts);
    return ranked[0]?.lane ?? null;
  }

  /**
   * Score the available lanes for a (user, targetSite) tuple over
   * the last 30 days. Returns highest-score-first; empty array
   * means no usable history → caller should fall back to the
   * default route.
   *
   * Latency normalisation uses the max avg latency across the
   * candidate lanes — robust to outliers since we're only
   * comparing within the same group.
   */
  async scoreLanes(opts: {
    userIdInternal: number;
    targetSite: string;
    minSamples?: number;
  }): Promise<LaneScore[]> {
    const minSamples = opts.minSamples ?? 3;
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    try {
      const rows = await this.db
        .select({
          lane: executionStats.laneUsed,
          count: sql<number>`COUNT(*)`,
          // CASE-based AVG returns 0..1; coerce to number defensively.
          successRate: sql<number>`AVG(CASE WHEN ${executionStats.success} THEN 1.0 ELSE 0.0 END)`,
          avgLatencyMs: sql<number>`COALESCE(AVG(${executionStats.latencyMs}), 0)`,
        })
        .from(executionStats)
        .where(
          and(
            eq(executionStats.userId, opts.userIdInternal),
            eq(executionStats.targetSite, opts.targetSite),
            gt(executionStats.createdAt, cutoff),
          ),
        )
        .groupBy(executionStats.laneUsed)
        .having(sql`COUNT(*) >= ${minSamples}`)
        .orderBy(desc(sql`AVG(CASE WHEN ${executionStats.success} THEN 1.0 ELSE 0.0 END)`));
      if (rows.length === 0) return [];
      const maxLatency = Math.max(...rows.map((r) => Number(r.avgLatencyMs) || 0)) || 1;
      const scored: LaneScore[] = rows.map((r) => {
        const successRate = Number(r.successRate) || 0;
        const avgLatency = Number(r.avgLatencyMs) || 0;
        const score = successRate * 0.7 + (1 - avgLatency / maxLatency) * 0.3;
        return {
          lane: r.lane,
          count: Number(r.count),
          successRate,
          avgLatencyMs: avgLatency,
          score,
        };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'stats: scoreLanes failed',
      );
      return [];
    }
  }
}

/**
 * Strip a URL down to the bare host. Drops www. + m. prefixes so
 * "www.jd.com", "m.jd.com", and "jd.com" aggregate into one
 * target_site bucket.
 */
export function extractDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  try {
    let host: string;
    if (/^https?:\/\//i.test(urlOrHost)) {
      host = new URL(urlOrHost).hostname;
    } else {
      host = urlOrHost.split('/')[0] ?? urlOrHost;
    }
    return host.toLowerCase().replace(/^(?:www|m|wap|mobile)\./, '');
  } catch {
    return null;
  }
}

/**
 * Coarse error-type classifier from a tool_result string. Best-
 * effort matchers — feeds the stats table's `error_type` column
 * for trend analysis later.
 */
export function classifyError(message: string | null | undefined): string {
  if (!message) return 'unknown';
  const m = message.toLowerCase();
  if (/timeout|timed out/.test(m)) return 'timeout';
  if (/captcha|robot|verify|cloudflare/.test(m)) return 'anti_bot';
  if (/(http|status)\s*4\d\d|401|403|404|429/.test(m)) return 'http_4xx';
  if (/(http|status)\s*5\d\d|500|502|503|504/.test(m)) return 'http_5xx';
  if (/network|econn|enotfound|eai_/.test(m)) return 'network';
  if (/element|selector|not found/.test(m)) return 'element_missing';
  return 'unknown';
}

/**
 * Coarse task-type classifier from the user intent. Powers the
 * (task_type, target_site) index for cross-user aggregations.
 * Single-pass keyword match; returns 'general' for anything that
 * doesn't fit the buckets.
 */
export function classifyTaskType(intent: string): string {
  const lower = intent.toLowerCase();
  if (/(对比|比价|比较|哪个便宜|价格)/i.test(lower) || /\bcompare\b/i.test(lower)) return 'compare';
  if (
    /(下单|预订|预定|购买|提交|付款|登录|注册|发送|发布|评论|上传|下载|导出|分享|复制链接|移动|重命名|改权限|授权)/i.test(lower) ||
    /\b(book|buy|order|submit|pay|login|sign in|register|send|post|comment|upload|download|export|share|copy link|move|rename|attach|import)\b/i.test(lower)
  ) {
    return 'fill_form';
  }
  if (/(天气|气温|温度|下雨|股价|汇率|新闻|头条|航班号)/i.test(lower)) return 'search';
  if (/(搜索|查|找|看一下|多少钱|哪里)/i.test(lower) || /\bsearch\b/i.test(lower)) return 'search';
  if (/(打开|访问|跳转)/i.test(lower) || /\bnavigate\b/i.test(lower)) return 'navigate';
  if (/(写|生成|总结|草拟|起草)/i.test(lower) || /\b(generate|write)\b/i.test(lower)) return 'generate';
  return 'general';
}
