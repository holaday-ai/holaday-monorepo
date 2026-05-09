/**
 * Phase 1 — Auto-fix layer for `failureLevel === 'fixable'`.
 *
 * Pure functions that take an answer string + verification result
 * + ledger and return a possibly-modified answer plus the list of
 * ops applied. The integration step calls this when the verifier
 * marks fixable, then re-runs the deterministic verifier on the
 * fix; if THAT still fails it escalates to needs_clarification.
 *
 * Conservative by design — never invents content. Only:
 *   1. swaps fabricated URLs for grounded ones with similar hosts,
 *   2. drops a fabricated URL when no remotely-similar grounded
 *      candidate exists (rather than fabricating further),
 *   3. appends a short "补充字段" note when the answer omits
 *      provided required inputs.
 *
 * If no fix can be applied the answer comes back unchanged and the
 * applied list is empty — caller can decide to escalate.
 */
import type { ExecutionContract } from './execution-contract.js';
import type { EvidenceLedger } from './evidence-ledger.js';
import type { VerificationResult } from './answer-verifier.js';

const URL_RE = /https?:\/\/[^\s,;'")\]>]+/g;

export type AutoFixKind = 'url_substitute' | 'url_drop' | 'missing_fields_note';

export interface AutoFixOp {
  kind: AutoFixKind;
  detail: string;
}

export interface AutoFixInputs {
  contract: ExecutionContract;
  ledger: EvidenceLedger;
  verification: VerificationResult;
  answerText: string;
}

export interface AutoFixOutput {
  fixed: string;
  applied: AutoFixOp[];
}

export function autoFix(inputs: AutoFixInputs): AutoFixOutput {
  if (
    inputs.verification.passed ||
    inputs.verification.failureLevel !== 'fixable'
  ) {
    return { fixed: inputs.answerText, applied: [] };
  }
  const ops: AutoFixOp[] = [];
  let text = inputs.answerText;

  // 1. URL fabrication — substitute or drop.
  const urlOp = inputs.verification.checks.find(
    (c) => c.criterionId === 'generic.url_grounding' && !c.passed,
  );
  if (urlOp) {
    const out = fixFabricatedUrls(text, inputs.ledger);
    text = out.text;
    ops.push(...out.ops);
  }

  // 2. Missing required fields — append a補 note.
  const missingFieldsOp = inputs.verification.checks.find(
    (c) =>
      !c.passed &&
      c.detail.startsWith('provided inputs missing from answer'),
  );
  if (missingFieldsOp) {
    const out = appendMissingFieldsNote(text, missingFieldsOp.detail);
    text = out.text;
    if (out.op) ops.push(out.op);
  }

  return { fixed: text, applied: ops };
}

// ---------------------------------------------------------------------------
// URL substitution
// ---------------------------------------------------------------------------

function fixFabricatedUrls(
  text: string,
  ledger: EvidenceLedger,
): { text: string; ops: AutoFixOp[] } {
  const ops: AutoFixOp[] = [];
  const grounded = ledger.getGroundedUrls();
  const groundedSet = new Set(grounded.map(stripTrailingPunct));

  return {
    text: text.replace(URL_RE, (raw) => {
      const url = stripTrailingPunct(raw);
      if (groundedSet.has(url)) return raw; // already grounded
      const replacement = pickSimilarUrl(url, grounded);
      if (replacement) {
        ops.push({
          kind: 'url_substitute',
          detail: `${url} → ${replacement}`,
        });
        // Preserve the trailing punctuation that was on `raw`.
        const tail = raw.slice(url.length);
        return `${replacement}${tail}`;
      }
      // Phase 1 follow-up — no similar grounded URL → DROP the
      // fabricated URL entirely (no placeholder text). The earlier
      // "[未验证来源已移除]" placeholder leaked into the rendered
      // SPA as user-visible noise; with the placeholder removed,
      // the answer reads as if the model never had the URL,
      // which matches what we want to communicate.
      ops.push({
        kind: 'url_drop',
        detail: `${url} (no grounded match)`,
      });
      // Preserve trailing punctuation that was on `raw` so the
      // surrounding sentence still reads cleanly.
      return raw.slice(url.length);
    }),
    ops,
  };
}

/**
 * Best-fit grounded URL by host + path-prefix similarity.
 * Returns undefined when nothing reasonable exists.
 *
 * Strategy:
 *   1. Same host (after stripping `www.` and case) → score = 100 + path overlap
 *   2. Suffix-host match (e.g. `m.example.com` vs `example.com`) → 50 + path
 *   3. Otherwise → no match.
 */
export function pickSimilarUrl(
  fabricated: string,
  grounded: string[],
): string | undefined {
  const fabHost = hostOf(fabricated);
  if (!fabHost || grounded.length === 0) return undefined;
  const fabPath = pathOf(fabricated);
  let best: { url: string; score: number } | undefined;
  for (const g of grounded) {
    const gHost = hostOf(g);
    if (!gHost) continue;
    let score = 0;
    if (gHost === fabHost) {
      score = 100;
    } else if (gHost.endsWith(`.${fabHost}`) || fabHost.endsWith(`.${gHost}`)) {
      score = 50;
    } else {
      continue;
    }
    score += pathOverlap(fabPath, pathOf(g));
    if (!best || score > best.score) best = { url: g, score };
  }
  return best?.url;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** 0–10 score based on how many leading path segments match. */
function pathOverlap(a: string, b: string): number {
  const aSegs = a.split('/').filter(Boolean);
  const bSegs = b.split('/').filter(Boolean);
  let matched = 0;
  const minLen = Math.min(aSegs.length, bSegs.length);
  for (let i = 0; i < minLen; i++) {
    if (aSegs[i] === bSegs[i]) matched++;
    else break;
  }
  return Math.min(matched, 10);
}

function stripTrailingPunct(url: string): string {
  return url.replace(/[)\].,;:]+$/, '');
}

// ---------------------------------------------------------------------------
// Missing-fields note
// ---------------------------------------------------------------------------

function appendMissingFieldsNote(
  text: string,
  detail: string,
): { text: string; op?: AutoFixOp } {
  // Pattern: 'provided inputs missing from answer: GMV, 客单价'
  const m = detail.match(/answer:\s*(.+)$/);
  if (!m) return { text };
  const list = m[1]!.trim();
  if (!list) return { text };
  const note = `\n\n---\n**补充字段：** 以下用户提供的字段未出现在主体回复中：${list}（请参考原始输入）。`;
  return {
    text: `${text}${note}`,
    op: {
      kind: 'missing_fields_note',
      detail: list,
    },
  };
}
