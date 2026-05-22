/**
 * Phase 27C — admin learning engine router.
 *
 * Two endpoints, both nested under admin.learning:
 *
 *   overview     — 3 top-level metrics + paginated/searchable
 *                  per-domain ranking. Scans tasks within a window,
 *                  extracts the domain in JS (no `domain` column on
 *                  tasks today), aggregates per (domain, status,
 *                  error-category).
 *
 *   domainDetail — single-domain summary: basic info + failure
 *                  category breakdown + recent 20 tasks + relevant
 *                  execution_memory rows (site_state category).
 *
 * Why scan-in-JS instead of GROUP BY in SQL: the domain comes from
 * the free-form `intent` text — we don't have a column for it.
 * Adding one would need a migration + backfill; Phase 27C explicitly
 * declined that. Caps the scan at SCAN_LIMIT rows / SCAN_WINDOW_DAYS
 * back to keep memory bounded.
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { executionMemory } from '../../db/schema/execution-memory.js';
import { tasks } from '../../db/schema/tasks.js';
import { adminProcedure, router } from '../trpc.js';
import {
  classifyTaskError,
  ERROR_LABELS,
  extractDomain,
  type ErrorCategory,
} from '../../admin/learning-helpers.js';

/** Maximum rows to scan per request. ~50k is fine in-memory. */
const SCAN_LIMIT = 50_000;
/** Window back from "now" for the overview scan. Bounded so the
 *  request stays under the 1-2s budget even on a busy day. */
const SCAN_WINDOW_DAYS = 90;
/** Per-domain minimum task count before it shows up on the ranking. */
const MIN_TASKS_FOR_RANKING = 3;
/** Pagination cap for the ranking list. */
const PAGE_SIZE_CAP = 100;

type TaskScanRow = {
  id: number;
  status: string;
  intent: string;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: Date;
};

function isLearningFailureStatus(status: string): boolean {
  return status === 'failed' || status === 'partial_success';
}

function classifyLearningFailure(row: {
  status: string;
  errorMessage: string | null;
  errorCode: string | null;
}): ErrorCategory {
  return classifyTaskError(
    row.errorMessage,
    row.errorCode ?? (row.status === 'partial_success' ? 'partial_success' : null),
  );
}

function extractPersistedFailedChecks(
  result: unknown,
): Array<{ type: string; detail: string }> {
  const parsed = typeof result === 'string' ? safeJsonParse(result) : result;
  if (!parsed || typeof parsed !== 'object') return [];
  const raw = (parsed as Record<string, unknown>).failedChecks;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const rec = item as Record<string, unknown>;
      if (typeof rec.type !== 'string' || typeof rec.detail !== 'string') return null;
      const type = rec.type.trim();
      const detail = rec.detail.trim();
      return type && detail ? { type, detail } : null;
    })
    .filter((item): item is { type: string; detail: string } => item !== null);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

interface DomainAggregate {
  domain: string;
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  lastFailedAt: Date | null;
  /** Most-frequent failure category among this domain's failed tasks. */
  topFailureCategory: ErrorCategory | null;
}

/** Scan the recent task slice in one query; intent truncated to 1KB. */
async function scanRecentTasks(db: unknown): Promise<TaskScanRow[]> {
  const windowStart = new Date(Date.now() - SCAN_WINDOW_DAYS * 86_400_000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any)
    .select({
      id: tasks.id,
      status: tasks.status,
      // SUBSTRING keeps the wire payload small: URLs are <200 chars,
      // 1KB is plenty for the first match.
      intent: sql<string>`SUBSTRING(${tasks.intent}, 1, 1024)`,
      errorMessage: tasks.errorMessage,
      errorCode: tasks.errorCode,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(gte(tasks.createdAt, windowStart))
    .orderBy(desc(tasks.id))
    .limit(SCAN_LIMIT);
  return rows as TaskScanRow[];
}

/** Group a scan into per-domain aggregates. */
function aggregateByDomain(scanRows: TaskScanRow[]): Map<string, DomainAggregate> {
  const byDomain = new Map<string, DomainAggregate>();
  const failureCountByDomainCategory = new Map<string, Map<ErrorCategory, number>>();
  for (const row of scanRows) {
    const domain = extractDomain(row.intent);
    if (!domain) continue;
    const agg =
      byDomain.get(domain) ??
      ({
        domain,
        total: 0,
        success: 0,
        failed: 0,
        cancelled: 0,
        lastFailedAt: null,
        topFailureCategory: null,
      } satisfies DomainAggregate);
    agg.total += 1;
    if (row.status === 'completed') agg.success += 1;
    else if (row.status === 'cancelled') agg.cancelled += 1;
    else if (isLearningFailureStatus(row.status)) {
      agg.failed += 1;
      if (!agg.lastFailedAt || row.createdAt > agg.lastFailedAt) {
        agg.lastFailedAt = row.createdAt;
      }
      const cat = classifyLearningFailure(row);
      const perCat =
        failureCountByDomainCategory.get(domain) ?? new Map<ErrorCategory, number>();
      perCat.set(cat, (perCat.get(cat) ?? 0) + 1);
      failureCountByDomainCategory.set(domain, perCat);
    }
    byDomain.set(domain, agg);
  }
  // Pick top failure category per domain.
  for (const [domain, perCat] of failureCountByDomainCategory) {
    let best: { cat: ErrorCategory; count: number } | null = null;
    for (const [cat, count] of perCat) {
      if (!best || count > best.count) best = { cat, count };
    }
    const agg = byDomain.get(domain);
    if (agg && best) agg.topFailureCategory = best.cat;
  }
  return byDomain;
}

export const adminLearningRouter = router({
  // ────────────────────────────────────────────────────────── overview ──
  overview: adminProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(200).optional(),
          filter: z.enum(['all', 'highRisk', 'recentFail']).default('all'),
          sort: z.enum(['failureRate', 'totalTasks', 'lastFailedAt']).default('failureRate'),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(PAGE_SIZE_CAP).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const args = input ?? {
        filter: 'all' as const,
        sort: 'failureRate' as const,
        offset: 0,
        limit: 50,
      };
      const scanRows = await scanRecentTasks(ctx.db);
      const byDomain = aggregateByDomain(scanRows);

      // High-risk + AI-memory counts feed the three top-level cards.
      let highRiskCount = 0;
      for (const agg of byDomain.values()) {
        const terminal = agg.success + agg.failed;
        if (agg.total >= MIN_TASKS_FOR_RANKING && terminal > 0 && agg.failed / terminal > 0.5) {
          highRiskCount += 1;
        }
      }
      const analyzedDomainsCount = byDomain.size;
      const [memoryRow] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(executionMemory)
        .where(eq(executionMemory.category, 'site_state'));
      const aiMemoriesCount = Number(memoryRow?.count ?? 0);

      // Build the ranking list. Filter → sort → paginate.
      let rows = Array.from(byDomain.values()).filter(
        (d) => d.total >= MIN_TASKS_FOR_RANKING,
      );
      if (args.search) {
        const q = args.search.toLowerCase();
        rows = rows.filter((r) => r.domain.includes(q));
      }
      if (args.filter === 'highRisk') {
        rows = rows.filter((r) => {
          const terminal = r.success + r.failed;
          return terminal > 0 && r.failed / terminal > 0.5;
        });
      } else if (args.filter === 'recentFail') {
        const sevenDaysAgo = Date.now() - 7 * 86_400_000;
        rows = rows.filter(
          (r) => r.lastFailedAt && r.lastFailedAt.getTime() >= sevenDaysAgo,
        );
      }
      const sortKey =
        args.sort === 'totalTasks'
          ? (r: DomainAggregate) => r.total
          : args.sort === 'lastFailedAt'
            ? (r: DomainAggregate) => r.lastFailedAt?.getTime() ?? 0
            : (r: DomainAggregate) => r.failed / Math.max(1, r.total);
      const failureRateSortKey =
        args.sort === 'failureRate'
          ? (r: DomainAggregate) => r.failed / Math.max(1, r.success + r.failed)
          : sortKey;
      rows.sort((a, b) => failureRateSortKey(b) - failureRateSortKey(a));
      const total = rows.length;
      const page = rows.slice(args.offset, args.offset + args.limit);

      return {
        metrics: {
          analyzedDomainsCount,
          highRiskCount,
          aiMemoriesCount,
        },
        domains: page.map((d) => ({
          domain: d.domain,
          total: d.total,
          success: d.success,
          failed: d.failed,
          cancelled: d.cancelled,
          successRate:
            d.success + d.failed > 0
              ? Math.round((d.success / (d.success + d.failed)) * 1000) / 10
              : 0,
          failureRate:
            d.success + d.failed > 0
              ? Math.round((d.failed / (d.success + d.failed)) * 1000) / 10
              : 0,
          lastFailedAt: d.lastFailedAt,
          topFailureCategory: d.topFailureCategory,
          topFailureLabel: d.topFailureCategory ? ERROR_LABELS[d.topFailureCategory] : null,
        })),
        total,
      };
    }),

  // ──────────────────────────────────────────────────── domainDetail ──
  domainDetail: adminProcedure
    .input(z.object({ domain: z.string().min(1).max(253) }))
    .query(async ({ ctx, input }) => {
      const targetDomain = input.domain.toLowerCase();
      const scanRows = await scanRecentTasks(ctx.db);

      // Filter to tasks whose extracted domain matches the request.
      const matching: TaskScanRow[] = [];
      for (const row of scanRows) {
        if (extractDomain(row.intent) === targetDomain) matching.push(row);
      }
      if (matching.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `no tasks in the last ${SCAN_WINDOW_DAYS} days for ${targetDomain}`,
        });
      }

      let total = 0;
      let success = 0;
      let failed = 0;
      let cancelled = 0;
      let firstAt: Date | null = null;
      let lastAt: Date | null = null;
      const failureCountByCategory = new Map<ErrorCategory, number>();
      const failureLastAtByCategory = new Map<ErrorCategory, Date>();
      for (const r of matching) {
        total += 1;
        if (!firstAt || r.createdAt < firstAt) firstAt = r.createdAt;
        if (!lastAt || r.createdAt > lastAt) lastAt = r.createdAt;
        if (r.status === 'completed') success += 1;
        else if (r.status === 'cancelled') cancelled += 1;
        else if (isLearningFailureStatus(r.status)) {
          failed += 1;
          const cat = classifyLearningFailure(r);
          failureCountByCategory.set(cat, (failureCountByCategory.get(cat) ?? 0) + 1);
          const prev = failureLastAtByCategory.get(cat);
          if (!prev || r.createdAt > prev) failureLastAtByCategory.set(cat, r.createdAt);
        }
      }
      const categoryBreakdown = Array.from(failureCountByCategory.entries())
        .map(([cat, count]) => ({
          category: cat,
          label: ERROR_LABELS[cat],
          count,
          lastAt: failureLastAtByCategory.get(cat) ?? null,
          share: failed > 0 ? Math.round((count / failed) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      // Recent 20 tasks for this domain. We have to fetch the full
      // intent + error_message now (the scan truncated the intent
      // to 1KB), so do a second query keyed on the task ids of the
      // matching rows.
      const recentMatching = matching
        .slice(0, 20)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const ids = recentMatching.map((r) => r.id);
      let recentRows: Array<{
        id: number;
        taskId: string;
        intent: string;
        title: string | null;
        status: string;
        errorMessage: string | null;
        result: unknown;
        startedAt: Date | null;
        completedAt: Date | null;
        createdAt: Date;
      }> = [];
      if (ids.length > 0) {
        const list = await ctx.db
          .select({
            id: tasks.id,
            taskId: tasks.externalId,
            intent: tasks.intent,
            title: tasks.title,
            status: tasks.status,
            errorMessage: tasks.errorMessage,
            result: tasks.result,
            startedAt: tasks.startedAt,
            completedAt: tasks.completedAt,
            createdAt: tasks.createdAt,
          })
          .from(tasks)
          .where(inArray(tasks.id, ids));
        recentRows = list as typeof recentRows;
        recentRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      // AI memories — execution_memory.site_state rows whose key or
      // value mentions the domain. We pull a wider catch-all so the
      // admin sees what the agent has remembered about this site.
      const memRows = await ctx.db
        .select({
          externalId: executionMemory.externalId,
          category: executionMemory.category,
          keyName: executionMemory.keyName,
          value: executionMemory.value,
          createdAt: executionMemory.createdAt,
          updatedAt: executionMemory.updatedAt,
        })
        .from(executionMemory)
        .where(
          and(
            eq(executionMemory.category, 'site_state'),
            // Search both key and value for the domain. Domain has
            // no SQL wildcards so escaping isn't needed here.
            sql`(${executionMemory.keyName} LIKE ${`%${targetDomain}%`} OR ${executionMemory.value} LIKE ${`%${targetDomain}%`})`,
          ),
        )
        .orderBy(desc(executionMemory.updatedAt))
        .limit(50);

      return {
        domain: targetDomain,
        stats: {
          total,
          success,
          failed,
          cancelled,
          successRate:
            success + failed > 0
              ? Math.round((success / (success + failed)) * 1000) / 10
              : 0,
          failureRate:
            success + failed > 0
              ? Math.round((failed / (success + failed)) * 1000) / 10
              : 0,
          firstTaskAt: firstAt,
          lastTaskAt: lastAt,
        },
        failureBreakdown: categoryBreakdown,
        recentTasks: recentRows.map((r) => ({
          taskId: r.taskId,
          intent: r.intent,
          title: r.title,
          status: r.status,
          errorMessage: r.errorMessage,
          failedChecks: extractPersistedFailedChecks(r.result),
          createdAt: r.createdAt,
          durationMs:
            r.startedAt && r.completedAt
              ? r.completedAt.getTime() - r.startedAt.getTime()
              : null,
        })),
        memories: memRows.map((m) => ({
          externalId: m.externalId,
          category: m.category,
          keyName: m.keyName,
          value: m.value,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      };
    }),
});

// Helpers re-exported for tests.
export const __learningInternals = { aggregateByDomain, scanRecentTasks };
