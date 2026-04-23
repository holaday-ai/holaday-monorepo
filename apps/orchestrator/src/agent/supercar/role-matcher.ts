/**
 * Role matcher — pure keyword scoring to pick the best professional
 * role for a given user intent. Runs before the first messages.create
 * call; the result feeds into buildSupercarSystemPrompt() which
 * appends the role's systemAddon to the final prompt.
 *
 * Why not an LLM classifier: we already classify domain via the same
 * cheap keyword path (see vision-loop/domain/classifier.ts); adding a
 * second round-trip just to pick between "财务分析师" and "产品经理"
 * would double per-task cold latency for <5% of cases where the
 * heuristic mis-fires. Users can always re-phrase.
 *
 * Scoring: sum of (keyword length × role weight) for every matched
 * keyword. Longer matches beat shorter ones so "小红书" beats "红书"
 * when both appear, and the role's own weight breaks ties across
 * different specialisations.
 *
 * Returns null when no role scores above the MIN_SCORE threshold —
 * the generic core prompt alone is better than forcing a bad-fit role.
 */

import { logger } from '../../config/logger.js';
import { type AgentRole, ROLES } from './roles/index.js';

/** Below this total score we fall through to "no role" rather than
 *  force a weak match. Empirically 1.0 catches single-keyword hits on
 *  the most specific keywords ("小红书" = length 3 × weight 1.0 = 3.0,
 *  "产品经理" = length 4 × weight 0.8 = 3.2) while filtering out
 *  accidental substring matches in long intents. */
const MIN_SCORE = 1.5;

interface Match {
  readonly role: AgentRole;
  readonly score: number;
  readonly matched: readonly string[];
}

/**
 * Pick the best-fitting role for `intent`. Returns null when nothing
 * scores high enough — caller should fall back to the generic prompt.
 * Never throws; empty or whitespace-only intent yields null.
 */
export function matchRole(intent: string): AgentRole | null {
  const hit = matchRoleWithDebug(intent);
  return hit?.role ?? null;
}

/**
 * Same as matchRole but returns the score + matched keywords. Useful
 * for telemetry / debugging why a specific role won.
 */
export function matchRoleWithDebug(intent: string): Match | null {
  if (!intent || !intent.trim()) return null;
  const needle = intent.toLowerCase();

  const matches: Match[] = [];
  for (const role of ROLES) {
    const matched: string[] = [];
    let score = 0;
    for (const k of role.keywords) {
      if (needle.includes(k)) {
        matched.push(k);
        // Length-weighted: "小红书" (3) contributes more than "笔记" (2)
        // so the more specific keyword dominates when both are present.
        score += k.length * role.weight;
      }
    }
    if (matched.length > 0) {
      matches.push({ role, score, matched });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (!best || best.score < MIN_SCORE) return null;

  logger.debug(
    {
      role: best.role.name,
      score: best.score.toFixed(2),
      matched: best.matched,
      totalCandidates: matches.length,
    },
    'role-matcher: picked role',
  );

  return best;
}
