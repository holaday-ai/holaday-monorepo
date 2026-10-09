import type { UnifiedBrowserOutcome } from '../../src/agent/browser-tools/unified-browser-loop.js';
import { isNonDetailUrl, urlResourceIdentity } from '../../src/execution/url-identity.js';

/** Synthetic acceptance always keeps the declared denominator, including unavailable cases. */
export function scoreSyntheticSuite(
  cases:ReadonlyArray<{id:string;category:string}>,
  results:ReadonlyArray<{id:string;status:'passed'|'failed'|'unsupported'}>,
) {
  let passed=0,failed=0,unsupported=0;
  const failureComposition:Record<string,number>={};
  for(const test of cases){
    const result=results.find(r=>r.id===test.id);
    if(result?.status==='passed'){passed++;continue;}
    if(result?.status==='failed'){failed++;failureComposition[test.category]=(failureComposition[test.category]??0)+1;}
    else {unsupported++;failureComposition.unsupported=(failureComposition.unsupported??0)+1;}
  }
  return {denominator:cases.length,passed,failed,unsupported,successRate:cases.length?passed/cases.length:0,failureComposition};
}

export interface BrowserEvalTask {
  id: string;
  category: string;
  startUrl: string;
  instruction: string;
  publicSite: boolean;
  expectHandoff: boolean;
  success:
    | { type: 'answer_contains_all'; values: string[]; minItems?: number }
    | { type: 'answer_mentions'; values: string[] }
    | { type: 'answer_nonempty' }
    | { type: 'expect_handoff'; reason?: string }
    | { type: 'handoff_or_answer'; note?: string }
    | ListWithSourcesSpec;
}

/**
 * FIX-BATCH-A — list answers whose every item needs its own clickable detail
 * source (not the homepage / a search page) plus a key field (price, date…).
 * Scored on the delivered text of a pipeline run (see pipeline.ts).
 */
export interface ListWithSourcesSpec {
  type: 'list_with_sources';
  minItems: number;
  /** Registrable domains an item source may live on, e.g. ["jd.com"]. */
  domains: readonly string[];
  keyField: 'price' | 'date' | 'stars' | null;
}

/** Deterministic success judgement for one eval run (no model in the loop). */
export function scoreBrowserEval(task: BrowserEvalTask, outcome: UnifiedBrowserOutcome): boolean {
  const handedOff = outcome.status === 'awaiting_user';
  const answer = outcome.status === 'completed' ? `${outcome.summary}\n${outcome.evidence}` : '';
  switch (task.success.type) {
    case 'expect_handoff':
      return (
        handedOff &&
        (!task.success.reason ||
          outcome.status !== 'awaiting_user' ||
          outcome.reason === task.success.reason)
      );
    case 'handoff_or_answer':
      return handedOff || answer.trim().length > 0;
    case 'answer_nonempty':
      return answer.trim().length > 0;
    case 'answer_mentions':
      return (
        answer.trim().length > 0 && task.success.values.every((value) => answer.includes(value))
      );
    case 'list_with_sources':
      return answer.trim().length > 0 && scoreListWithSources(answer, task.success).ok;
    case 'answer_contains_all': {
      if (!task.success.values.every((value) => answer.includes(value))) return false;
      const lines = answer.split('\n').filter((line) => line.trim()).length;
      return lines >= (task.success.minItems ?? 1);
    }
  }
}

/**
 * Failure attribution for success-rate accounting:
 *  - model_layer: a model call failed (403/429/timeouts/provider errors) — excluded;
 *  - environment: the harness could not reach the start page — excluded;
 *  - browser: everything else (counted; includes successes).
 *
 * A model-call timeout that coincides with the task deadline is the task
 * running out of time (the loop caps each call at the remaining budget), not a
 * broken model call: it is a counted `browser` failure when `timing` shows the
 * run lasted at least the task timeout minus 15 s.
 */
export const DEADLINE_SLACK_MS = 15_000;

export function classifyFailure(
  success: boolean,
  outcome: UnifiedBrowserOutcome,
  trace: ReadonlyArray<Record<string, unknown>>,
  timing?: { durationMs: number; taskTimeoutMs: number },
): 'none' | 'model_layer' | 'environment' | 'browser' {
  if (success) return 'none';
  if (outcome.status === 'failed' && outcome.reason.startsWith('harness:')) return 'environment';
  const errors = trace.filter((entry) => entry.type === 'model_error');
  if (
    timing &&
    errors.length > 0 &&
    errors.every((entry) => entry.code === 'REQUEST_TIMEOUT' || entry.code === 'REQUEST_ABORTED') &&
    timing.durationMs >= timing.taskTimeoutMs - DEADLINE_SLACK_MS
  )
    return 'browser';
  const modelErrors = errors.length;
  const modelOk = trace.filter((entry) => entry.type === 'model').length;
  if (modelErrors > 0 && (modelOk === 0 || outcome.status !== 'completed')) return 'model_layer';
  return 'browser';
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()（）\[\]"'，。、]+/g;
const ITEM_START = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:\d{1,2}|[一二三四五六七八九十])\s*[.、)）:：]/;
const KEY_FIELD: Record<NonNullable<ListWithSourcesSpec['keyField']>, RegExp> = {
  price: /[¥￥]\s*\d|\d+(?:\.\d+)?\s*元/,
  date: /\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2})?|\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}|\d+\s*(?:分钟|小时|天)前|今天|昨天|\b\d+\s*(?:minutes?|hours?|days?)\s+ago\b/i,
  stars: /(?:stars?|星)\D{0,8}\d|\d[\d,.]*\s*[kK]?\s*(?:stars?|颗?星)/i,
};

/** Item blocks: table rows, or numbered items with their continuation lines. */
export function splitListItems(answer: string): string[] {
  const lines = answer.split(/\r?\n/);
  const tableRows = lines.filter(
    (line) => /^\s*\|.*\|\s*$/.test(line) && !/^\s*\|[\s|:-]+\|\s*$/.test(line),
  );
  if (tableRows.length >= 2) return tableRows.slice(1);
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (ITEM_START.test(line)) {
      if (current) items.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(current.join('\n'));
  return items;
}

function hostMatches(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The verifier's detail-page judgement, shared so eval and production agree. */
export { isNonDetailUrl } from '../../src/execution/url-identity.js';

export function scoreListWithSources(
  answer: string,
  spec: ListWithSourcesSpec,
): { ok: boolean; problems: string[]; urls: string[] } {
  const items = splitListItems(answer).slice(0, spec.minItems);
  const problems: string[] = [];
  if (items.length < spec.minItems)
    problems.push(`只有 ${items.length} 条，要求 ${spec.minItems} 条`);
  const urls: string[] = [];
  const identities = new Set<string>();
  items.forEach((item, index) => {
    const candidates = (item.match(URL_IN_TEXT) ?? []).map((url) => url.replace(/[.,;:!?]+$/, ''));
    const onSite = candidates.filter((url) => {
      try {
        return hostMatches(new URL(url).hostname.toLowerCase(), spec.domains);
      } catch {
        return false;
      }
    });
    const detail = onSite.find((url) => !isNonDetailUrl(url));
    if (!detail) {
      problems.push(
        onSite.length > 0
          ? `第 ${index + 1} 条只有首页/搜索页链接`
          : `第 ${index + 1} 条没有站内来源链接`,
      );
    } else if (identities.has(urlResourceIdentity(detail) ?? detail)) {
      problems.push(`第 ${index + 1} 条与前面条目复用同一链接`);
    } else {
      identities.add(urlResourceIdentity(detail) ?? detail);
      urls.push(detail);
    }
    if (spec.keyField && !KEY_FIELD[spec.keyField].test(item))
      problems.push(
        `第 ${index + 1} 条缺少${{ price: '价格', date: '日期', stars: 'star 数' }[spec.keyField]}`,
      );
  });
  return { ok: problems.length === 0, problems, urls };
}
