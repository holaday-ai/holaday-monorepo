/**
 * Phase 1 follow-up — EvalOps v1: markdown summary writer.
 *
 * Runs after the eval JSON report is written. Queries the DB for
 * each task's contract / evidence / verification snapshots and
 * builds a markdown report covering the same dimensions Codex's
 * PHASE1_DB_SUMMARY script produces:
 *
 *   - lane breakdown (completion %, verifier pass/fail, ledger
 *     entry stats, latency p50/p95)
 *   - failure-level distribution
 *   - autoFix triggered/succeeded counts
 *   - top failure reasons
 *   - false negative / positive candidates
 *   - per-case detail table
 *
 * Failure-mode contract: writing the summary is best-effort — a
 * DB hiccup logs a warning and skips the file. The JSON report is
 * always written first; the markdown is purely derivative.
 *
 * No new dependencies — reuses mysql2 (already in orchestrator
 * dependencies via the runtime DB client).
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import mysql from 'mysql2/promise';

import type { EvalCaseResult, EvalReport } from './eval-suite.js';

interface DbTaskRow {
  external_id: string;
  status: string;
  result: unknown;
  contract_json: unknown;
  evidence_json: unknown;
  verification_json: unknown;
  verification_passed: number | null;
  failure_level: string | null;
}

interface LaneStats {
  total: number;
  completed: number;
  verificationTrue: number;
  verificationFalse: number;
  verificationNull: number;
  failureLevel: Record<string, number>;
  autoFixTriggered: number;
  autoFixSucceeded: number;
  emptyLedger: number;
  ledgerEntryCounts: number[];
  sourceTypeCounts: Record<string, number>;
  latenciesMs: number[];
  contractTiers: Record<string, number>;
}

function newLaneStats(): LaneStats {
  return {
    total: 0,
    completed: 0,
    verificationTrue: 0,
    verificationFalse: 0,
    verificationNull: 0,
    failureLevel: {},
    autoFixTriggered: 0,
    autoFixSucceeded: 0,
    emptyLedger: 0,
    ledgerEntryCounts: [],
    sourceTypeCounts: {},
    latenciesMs: [],
    contractTiers: {},
  };
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Lane attribution:
 *   1. Prefer contract.executionMode (always written when the
 *      contract feature flag is on).
 *   2. Fall back to result.metadata.executionMode (legacy field
 *      from before the contract pipeline existed).
 *   3. Fall back to result.executionMode (supercar park path
 *      writes it here per the Phase 1 follow-up fix).
 *   4. 'unknown' if all three are missing.
 */
function laneFromRow(row: DbTaskRow, evalLane?: string | null): string {
  if (evalLane && evalLane !== 'unknown') return evalLane;
  const contract = parseJson(row.contract_json);
  if (contract?.tier === 'light') return 'browser';
  const result = parseJson(row.result);
  if (result) {
    const md = (result.metadata as Record<string, unknown> | undefined) ?? result;
    const mode =
      (md.executionMode as string | undefined) ??
      (md.finalExecutionMode as string | undefined);
    if (mode) return mode;
  }
  return 'unknown';
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx] ?? 0;
}

function parseDatabaseUrl(databaseUrl: string): mysql.ConnectionOptions {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Main entry — writes `<reportPath>.summary.md` next to the JSON
 * report. Logs (not throws) on any failure. Returns the markdown
 * path on success, undefined if skipped.
 */
export async function writeEvalSummary(opts: {
  report: EvalReport;
  reportPath: string;
  evalUserExternalId: string;
}): Promise<string | undefined> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn(
      '[eval-summary] DATABASE_URL not set — skipping markdown summary',
    );
    return undefined;
  }
  const taskIds = opts.report.cases
    .map((c) => c.taskId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (taskIds.length === 0) {
    console.warn('[eval-summary] no taskIds in report — skipping');
    return undefined;
  }

  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
    const placeholders = taskIds.map(() => '?').join(',');
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT external_id, status, result, contract_json, evidence_json,
              verification_json, verification_passed, failure_level
       FROM tasks
       WHERE external_id IN (${placeholders})`,
      taskIds,
    );
    const byId = new Map<string, DbTaskRow>();
    for (const r of rows as unknown as DbTaskRow[]) {
      byId.set(r.external_id, r);
    }

    const markdown = buildMarkdown(opts.report, byId);
    const summaryPath = opts.reportPath.replace(/\.json$/, '.summary.md');
    await fs.writeFile(summaryPath, markdown);
    return summaryPath;
  } catch (err) {
    console.warn(
      `[eval-summary] failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
}

function buildMarkdown(
  report: EvalReport,
  byId: Map<string, DbTaskRow>,
): string {
  const lanes = new Map<string, LaneStats>();
  const failureReasons: Record<string, number> = {};
  const falseNegatives: string[] = [];
  const falsePositives: string[] = [];

  for (const c of report.cases) {
    const row = c.taskId ? byId.get(c.taskId) : undefined;
    const lane = row ? laneFromRow(row, c.executionMode) : c.executionMode ?? 'unknown';
    let stats = lanes.get(lane);
    if (!stats) {
      stats = newLaneStats();
      lanes.set(lane, stats);
    }
    stats.total++;
    const status = row?.status ?? c.terminalStatus ?? 'unknown';
    if (status === 'completed') stats.completed++;

    const verification = row ? parseJson(row.verification_json) : null;
    const vp = row?.verification_passed;
    if (vp === 1) stats.verificationTrue++;
    else if (vp === 0) stats.verificationFalse++;
    else stats.verificationNull++;

    const fl = row?.failure_level ?? 'null';
    stats.failureLevel[fl] = (stats.failureLevel[fl] ?? 0) + 1;

    if (verification && Array.isArray(verification.checks)) {
      const autoFixCount = (verification.checks as Array<{ criterionId?: string }>)
        .filter((ck) =>
          typeof ck.criterionId === 'string' && ck.criterionId.startsWith('autoFix.'),
        ).length;
      if (autoFixCount > 0) {
        stats.autoFixTriggered++;
        if (vp === 1) stats.autoFixSucceeded++;
      }
    }

    const evidence = row ? parseJson(row.evidence_json) : null;
    const entries = Array.isArray(evidence?.entries)
      ? (evidence!.entries as Array<{ sourceType?: string }>)
      : [];
    if (entries.length === 0) stats.emptyLedger++;
    stats.ledgerEntryCounts.push(entries.length);
    for (const e of entries) {
      const t = e.sourceType ?? 'unknown';
      stats.sourceTypeCounts[t] = (stats.sourceTypeCounts[t] ?? 0) + 1;
    }

    const contract = row ? parseJson(row.contract_json) : null;
    if (contract?.tier && typeof contract.tier === 'string') {
      stats.contractTiers[contract.tier] =
        (stats.contractTiers[contract.tier] ?? 0) + 1;
    }

    stats.latenciesMs.push(c.durationMs);

    // False positive / negative classification.
    if (status === 'completed' && vp === 0) {
      falseNegatives.push(c.taskId ?? c.id);
    }
    if (status !== 'completed' && vp === 1) {
      falsePositives.push(c.taskId ?? c.id);
    }

    if (status !== 'completed') {
      const reason =
        row?.failure_level ??
        (parseJson(row?.result)?.reason as string | undefined) ??
        c.errorMessage ??
        status;
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    }
  }

  const lines: string[] = [];
  lines.push(`# Eval Summary — ${report.suite} — ${report.startedAt}`);
  lines.push('');
  lines.push(`**Suite:** \`${report.suite}\``);
  lines.push(`**Started:** ${report.startedAt}`);
  lines.push(`**Finished:** ${report.finishedAt}`);
  lines.push(
    `**Total:** ${report.total} | **Passed:** ${report.passed} | **Failed:** ${report.failed} | **Duration:** ${(report.totalMs / 1000).toFixed(1)}s`,
  );
  lines.push(`**Base URL:** ${report.baseUrl}`);
  lines.push(`**Eval User:** ${report.evalUserExternalId}`);
  lines.push('');

  lines.push('## By Lane');
  lines.push('');
  lines.push(
    '| Lane | Total | Completed | VerifTrue | VerifFalse | VerifNull | Empty Ledger | Avg Entries | Avg Latency |',
  );
  lines.push(
    '|------|------:|----------:|----------:|-----------:|----------:|-------------:|------------:|------------:|',
  );
  for (const [name, s] of [...lanes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const avgEntries =
      s.ledgerEntryCounts.length > 0
        ? Math.round(
            (s.ledgerEntryCounts.reduce((a, c) => a + c, 0) /
              s.ledgerEntryCounts.length) *
              10,
          ) / 10
        : 0;
    const avgLatency =
      s.latenciesMs.length > 0
        ? Math.round(
            s.latenciesMs.reduce((a, c) => a + c, 0) / s.latenciesMs.length,
          )
        : 0;
    lines.push(
      `| ${name} | ${s.total} | ${s.completed} (${formatPct(s.completed, s.total)}) | ${s.verificationTrue} | ${s.verificationFalse} | ${s.verificationNull} | ${s.emptyLedger} (${formatPct(s.emptyLedger, s.total)}) | ${avgEntries} | ${avgLatency}ms |`,
    );
  }
  lines.push('');

  lines.push('## Failure Levels (DB)');
  lines.push('');
  lines.push('| Lane | null | fixable | needs_clarification | hard_fail |');
  lines.push('|------|-----:|--------:|--------------------:|----------:|');
  for (const [name, s] of [...lanes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(
      `| ${name} | ${s.failureLevel.null ?? 0} | ${s.failureLevel.fixable ?? 0} | ${s.failureLevel.needs_clarification ?? 0} | ${s.failureLevel.hard_fail ?? 0} |`,
    );
  }
  lines.push('');

  lines.push('## AutoFix');
  lines.push('');
  lines.push('| Lane | Triggered | Succeeded | Success Rate |');
  lines.push('|------|----------:|----------:|-------------:|');
  for (const [name, s] of [...lanes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(
      `| ${name} | ${s.autoFixTriggered} | ${s.autoFixSucceeded} | ${formatPct(s.autoFixSucceeded, s.autoFixTriggered)} |`,
    );
  }
  lines.push('');

  lines.push('## Latency Distribution');
  lines.push('');
  lines.push('| Lane | p50 | p95 | min | max |');
  lines.push('|------|----:|----:|----:|----:|');
  for (const [name, s] of [...lanes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (s.latenciesMs.length === 0) {
      lines.push(`| ${name} | — | — | — | — |`);
      continue;
    }
    const p50 = percentile(s.latenciesMs, 50);
    const p95 = percentile(s.latenciesMs, 95);
    const min = Math.min(...s.latenciesMs);
    const max = Math.max(...s.latenciesMs);
    lines.push(`| ${name} | ${p50}ms | ${p95}ms | ${min}ms | ${max}ms |`);
  }
  lines.push('');

  lines.push('## Contract Tier Distribution');
  lines.push('');
  lines.push('| Lane | full | light | checklist | (unset) |');
  lines.push('|------|-----:|------:|----------:|--------:|');
  for (const [name, s] of [...lanes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total =
      (s.contractTiers.full ?? 0) +
      (s.contractTiers.light ?? 0) +
      (s.contractTiers.checklist ?? 0);
    lines.push(
      `| ${name} | ${s.contractTiers.full ?? 0} | ${s.contractTiers.light ?? 0} | ${s.contractTiers.checklist ?? 0} | ${s.total - total} |`,
    );
  }
  lines.push('');

  lines.push('## Source-Type Distribution');
  lines.push('');
  const allTypes = new Set<string>();
  for (const s of lanes.values()) {
    for (const t of Object.keys(s.sourceTypeCounts)) allTypes.add(t);
  }
  if (allTypes.size === 0) {
    lines.push('_No ledger entries (Evidence Ledger flag may be off)._');
  } else {
    const typeList = [...allTypes].sort();
    lines.push(`| Lane | ${typeList.join(' | ')} |`);
    lines.push(`|------|${typeList.map(() => '----:').join('|')}|`);
    for (const [name, s] of [...lanes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const cells = typeList.map((t) => s.sourceTypeCounts[t] ?? 0).join(' | ');
      lines.push(`| ${name} | ${cells} |`);
    }
  }
  lines.push('');

  lines.push('## Top Failure Reasons');
  lines.push('');
  const sortedReasons = Object.entries(failureReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (sortedReasons.length === 0) {
    lines.push('_All cases reached terminal state without failures._');
  } else {
    lines.push('| Reason | Count |');
    lines.push('|--------|------:|');
    for (const [reason, count] of sortedReasons) {
      lines.push(`| \`${reason}\` | ${count} |`);
    }
  }
  lines.push('');

  lines.push('## False Positive / Negative Candidates');
  lines.push('');
  lines.push(
    '_False negative_ = task completed but verifier said it failed (could be over-strict criteria).',
  );
  lines.push(
    '_False positive_ = task did NOT complete but verifier passed (logic bug in pipeline).',
  );
  lines.push('');
  if (falseNegatives.length === 0) {
    lines.push('**False Negatives:** _none_');
  } else {
    lines.push('**False Negatives:**');
    for (const id of falseNegatives) lines.push(`- \`${id}\``);
  }
  lines.push('');
  if (falsePositives.length === 0) {
    lines.push('**False Positives:** _none_');
  } else {
    lines.push('**False Positives:**');
    for (const id of falsePositives) lines.push(`- \`${id}\``);
  }
  lines.push('');

  lines.push('## Per-Case Results');
  lines.push('');
  lines.push(
    '| ID | Lane | Status | Verifier | Failure Level | Duration | TaskId |',
  );
  lines.push(
    '|----|------|--------|---------:|--------------:|---------:|--------|',
  );
  for (const c of report.cases) {
    const row = c.taskId ? byId.get(c.taskId) : undefined;
    const lane = row ? laneFromRow(row, c.executionMode) : c.executionMode ?? '—';
    const verifier =
      row?.verification_passed === 1
        ? '✓'
        : row?.verification_passed === 0
          ? '✗'
          : '—';
    const failureLevel = row?.failure_level ?? '—';
    const status = row?.status ?? c.terminalStatus ?? '—';
    const taskId = c.taskId ? `\`${c.taskId}\`` : '—';
    lines.push(
      `| ${c.id} | ${lane} | ${status} | ${verifier} | ${failureLevel} | ${c.durationMs}ms | ${taskId} |`,
    );
  }
  lines.push('');

  lines.push('## Eval-Runner Failures');
  lines.push('');
  const runnerFailures = report.cases.filter((c) => !c.ok);
  if (runnerFailures.length === 0) {
    lines.push('_All runner-side expectations passed._');
  } else {
    for (const c of runnerFailures) {
      lines.push(`### ${c.id}`);
      for (const f of c.failures) lines.push(`- ${f}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Internal — exported only for unit tests.
export const _internal = {
  parseJson,
  laneFromRow,
  buildMarkdown,
  percentile,
  formatPct,
};

export type { EvalCaseResult };
