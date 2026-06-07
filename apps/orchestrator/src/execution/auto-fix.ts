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

/**
 * Markdown link `[text](https://...)`. Captured separately from the
 * bare URL pattern because dropping just the URL leaves
 * `[text]()` — and the SPA's markdown renderer turns an empty
 * `href=""` into a self-link to the current page (one of the
 * Phase-1 user-facing UX bugs). So when autoFix decides to drop
 * an ungrounded URL inside a markdown link, drop the whole link
 * shape and keep just the bare text.
 */
const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

export type AutoFixKind =
  | 'url_substitute'
  | 'url_drop'
  | 'missing_fields_note'
  | 'empty_url_fill'
  | 'ecommerce_row_prune'
  | 'duplicate_candidate_link_drop';

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

  // 1b. Ecommerce rows with empty JSON url fields — fill only from
  // grounded URLs the agent actually visited / fetched. This is a
  // conservative structural fix for model output like
  // `{ "name": "...", "price": 4599, "url": "" }` after
  // search_ecommerce supplied source candidates.
  const missingEcommerceUrlOp = inputs.verification.checks.find(
    (c) =>
      !c.passed &&
      (c.criterionType === 'ecommerce_rows' || c.criterionType === 'url_count') &&
      /缺少链接|URL|url|链接|唯一商品链接|复用同一个/i.test(c.detail),
  );
  if (missingEcommerceUrlOp) {
    const out = fillEmptyJsonUrls(text, inputs.ledger);
    text = out.text;
    ops.push(...out.ops);
    const pruned = pruneEcommerceRowsToProductLinks(text, inputs.ledger);
    text = pruned.text;
    ops.push(...pruned.ops);
  }

  const duplicateCandidateUrlOp = inputs.verification.checks.find(
    (c) => c.criterionId === 'generic.duplicate_candidate_urls' && !c.passed,
  );
  if (duplicateCandidateUrlOp) {
    const out = dropRepeatedCandidateLinks(text);
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

  // Pass 1 — markdown links `[text](url)`. Process FIRST so the
  // bare-URL pass below doesn't see the `(url)` half on its own
  // and create an empty `[text]()` artifact.
  let working = text.replace(MARKDOWN_LINK_RE, (_raw, label: string, url: string) => {
    const cleanUrl = stripTrailingPunct(url);
    if (groundedSet.has(cleanUrl)) {
      // URL is grounded — keep the link intact.
      return `[${label}](${cleanUrl})`;
    }
    const replacement = pickSimilarUrl(cleanUrl, grounded);
    if (replacement) {
      ops.push({
        kind: 'url_substitute',
        detail: `${cleanUrl} → ${replacement} (in markdown link)`,
      });
      return `[${label}](${replacement})`;
    }
    // No grounded match — collapse the markdown link to bare label
    // text. Avoids the SPA-renderer "empty href = self-link" bug.
    ops.push({
      kind: 'url_drop',
      detail: `${cleanUrl} (markdown link → plain text "${label}")`,
    });
    return label;
  });

  // Pass 2 — bare URLs left after markdown handling.
  working = working.replace(URL_RE, (raw) => {
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
    // the answer reads as if the model never had the URL.
    ops.push({
      kind: 'url_drop',
      detail: `${url} (no grounded match)`,
    });
    // Preserve trailing punctuation that was on `raw` so the
    // surrounding sentence still reads cleanly.
    return raw.slice(url.length);
  });

  return { text: working, ops };
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
    const gPath = pathOf(g);
    if (isStrictParentPath(gPath, fabPath)) {
      continue;
    }
    let score = 0;
    if (gHost === fabHost) {
      score = 100;
    } else if (gHost.endsWith(`.${fabHost}`) || fabHost.endsWith(`.${gHost}`)) {
      score = 50;
    } else {
      continue;
    }
    score += pathOverlap(fabPath, gPath);
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

function isStrictParentPath(candidate: string, target: string): boolean {
  const candidateSegs = candidate.split('/').filter(Boolean);
  const targetSegs = target.split('/').filter(Boolean);
  if (candidateSegs.length === 0) return false;
  if (candidateSegs.length >= targetSegs.length) return false;
  return candidateSegs.every((seg, idx) => seg === targetSegs[idx]);
}

function stripTrailingPunct(url: string): string {
  return url.replace(/[)\].,;:，。]+$/, '');
}

function fillEmptyJsonUrls(
  text: string,
  ledger: EvidenceLedger,
): { text: string; ops: AutoFixOp[] } {
  const grounded = uniqueUrls(ledger.getGroundedUrls());
  if (grounded.length === 0 || !/"url"\s*:\s*""/.test(text)) {
    return { text, ops: [] };
  }
  const used = new Set(uniqueUrls(text.match(URL_RE) ?? []));
  const candidates = grounded.filter((url) => !used.has(stripTrailingPunct(url)));
  if (candidates.length === 0) return { text, ops: [] };
  const ops: AutoFixOp[] = [];
  let i = 0;
  const fixed = text.replace(/"url"\s*:\s*""/g, (raw) => {
    const url = candidates[i++];
    if (!url) return raw;
    ops.push({
      kind: 'empty_url_fill',
      detail: `filled empty ecommerce url with ${url}`,
    });
    return `"url": "${url}"`;
  });
  return { text: fixed, ops };
}

function pruneEcommerceRowsToProductLinks(
  text: string,
  ledger: EvidenceLedger,
): { text: string; ops: AutoFixOp[] } {
  const productUrls = productLinkUrls(ledger);
  if (!text.includes('|')) return { text, ops: [] };

  const lines = text.split('\n');
  const keptProductUrls = new Set<string>();
  let removed = 0;
  let kept = 0;
  const nextLines = lines.filter((line) => {
    if (!looksLikeMarkdownTableRow(line)) return true;
    const urls = uniqueUrls(line.match(URL_RE) ?? []);
    if (urls.length === 0) return true;
    const url = urls[0]!;
    const isProductLink = productUrls.has(url) || isLikelyEcommerceProductUrl(url);
    if (isProductLink && !keptProductUrls.has(url)) {
      keptProductUrls.add(url);
      kept += 1;
      return true;
    }
    removed += 1;
    return false;
  });

  if (removed === 0) return { text, ops: [] };
  const note =
    `\n\n> 仅保留了 ${kept} 条有独立商品详情链接的结果；` +
    `其余 ${removed} 行复用了平台品类页/聚合页或重复链接，已移除，避免把不可验证链接当作商品链接。`;
  return {
    text: `${nextLines.join('\n')}${note}`,
    ops: [
      {
        kind: 'ecommerce_row_prune',
        detail: `removed ${removed} ecommerce rows without distinct product links`,
      },
    ],
  };
}

function dropRepeatedCandidateLinks(text: string): { text: string; ops: AutoFixOp[] } {
  const seen = new Set<string>();
  let changed = 0;
  const lines = text.split('\n');
  const nextLines = lines.map((line) => {
    if (!looksLikeCandidateResultLine(line)) return line;
    const urls = uniqueUrls(line.match(URL_RE) ?? []);
    if (urls.length === 0) return line;
    const duplicated = urls.filter((url) => seen.has(url));
    for (const url of urls) seen.add(url);
    if (duplicated.length === 0) return line;

    let next = line;
    for (const url of duplicated) {
      const escaped = escapeRegExp(url);
      next = next.replace(
        new RegExp(`\\[([^\\]\\n]+)\\]\\(${escaped}\\)`, 'g'),
        '$1（同一来源页）',
      );
      next = next.replace(new RegExp(escaped, 'g'), '同一来源页');
    }
    if (next !== line) changed += 1;
    return next;
  });

  if (changed === 0) return { text, ops: [] };
  const note =
    '\n\n> 多个候选复用了同一个来源链接；已把重复链接改为“同一来源页”，避免误导为每项都有独立页面。';
  return {
    text: `${nextLines.join('\n')}${note}`,
    ops: [
      {
        kind: 'duplicate_candidate_link_drop',
        detail: `removed repeated candidate links from ${changed} row(s)`,
      },
    ],
  };
}

function looksLikeCandidateResultLine(line: string): boolean {
  return (
    looksLikeMarkdownTableRow(line) ||
    /^\s*(?:\d+[.、)]|[-*+])\s+/.test(line)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function productLinkUrls(ledger: EvidenceLedger): Set<string> {
  const urls = new Set<string>();
  for (const entry of ledger.entries) {
    if (entry.sourceDetail !== 'search_ecommerce.firecrawl.product_link') continue;
    for (const raw of entry.fact.match(URL_RE) ?? []) {
      urls.add(stripTrailingPunct(raw));
    }
  }
  return urls;
}

function looksLikeMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return false;
  return trimmed.includes('|');
}

function isLikelyEcommerceProductUrl(url: string): boolean {
  try {
    const u = new URL(stripTrailingPunct(url));
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host === 'item.jd.com' && /\/\d+\.html$/.test(path)) return true;
    if (host === 'item.taobao.com' || host === 'detail.tmall.com') return true;
    if (host === 'pcdetail.taobao.com' && path.length > 1) return true;
    if (host === 'www.taobao.com' && /\/list\/item\//.test(path)) return true;
    if (/(^|\.)amazon\./.test(host) && /\/(?:dp|gp\/product)\//.test(path)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function uniqueUrls(urls: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const clean = stripTrailingPunct(raw);
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
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
