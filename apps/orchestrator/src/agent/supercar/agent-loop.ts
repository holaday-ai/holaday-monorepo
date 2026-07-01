/**
 * Supercar agent loop.
 *
 * Drives Anthropic's official `computer_20251124` + `web_search_20260209`
 * tools on Claude Sonnet 4.6 (default — overridable via SUPERCAR_MODEL)
 * through the same PlaywrightExecutor the legacy vision-loop already
 * uses. No hand-rolled tool schema, no custom agent scaffold: the
 * model decides when to take a screenshot, when to click, when to run
 * a web_search, and when to stop.
 *
 * Why a fresh module instead of patching vision-loop: the two stacks
 * have different tool shapes (coordinate vs. a11y refs), different
 * commander contracts, and different prompt-cache invariants. Living
 * side-by-side lets `AGENT_MODE=legacy` stay the escape hatch while
 * we dogfood supercar.
 *
 * Surface: `runSupercarTask(options)` returns a RunOutcome that mirrors
 * the legacy `VisionLoopRunner.run()` shape so `tasks.ts` can persist
 * the result via the same `TaskRepository.persistVisionOutcome`
 * without a second persistence path. Per-iteration side effects
 * (broadcasts, task_steps rows) flow through the callback bundle —
 * same pattern as `startVisionLoopTask`.
 *
 * User-reply flow: when Claude emits a text-only response that looks
 * like a question (endswith '？' / '?', no tool_use), the loop parks
 * on a `pendingReply` promise and fires `onAwaitingUser`. The caller
 * drives `supercarReply(taskId, text)` from a tRPC mutation; that
 * resolves the promise and the loop resumes by appending a `user`
 * turn with the reply text. No browser state is touched across that
 * pause — the PlaywrightExecutor's pinned page stays where it was.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import {
  type AntiBotSignal,
  describeSignal,
  detectAntiBot,
} from '../vision-loop/anti-bot-detector.js';
import { redactTypedValue } from '../../playbook/action-capture-redaction.js';
import type {
  PageLike,
  PlaywrightExecutor,
  TargetDescriptor,
} from '../vision-loop/playwright-executor.js';
import { logger } from '../../config/logger.js';
import {
  buildCreateFileToolDescription,
  buildFileFormatGuidance,
  buildUnavailableFormatDirective,
} from '../../files/writers.js';
import type { DomainName } from '../vision-loop/domain/classifier.js';
import type { LlmCallRecorder } from '../llm-call-recorder.js';
import type { ApifyAdapter } from './adapters/apify.js';
import type { ZapierAdapter } from './adapters/zapier.js';
import { translateError } from '../error-translator.js';
import {
  buildAuthParkQuestion,
  detectCaptchaPage,
  detectLoginPage,
  detectLoginUrl,
  detectPermissionWall,
} from '../login-detector.js';
import {
  applySiteConfigPostNavigation,
  matchSiteConfig,
} from '../site-configs/index.js';
import { detectBlankPage } from '../blank-page-detector.js';
import { translateNavError } from '../nav-error-translator.js';
import { classifyTaskType, filterTools } from '../tool-registry.js';
// Layer C — pure matcher for the gated transaction-FORM-FIELD signal (explorer login-mode only).
import { extractTxFieldSignal } from '../../playbook/explorer/explorer-guards.js';
import {
  classifyRole,
  getTaskBudget,
  selectModelAndEffort,
  type Effort,
} from './prompt-layers.js';
import { buildSupercarSystemPrompt } from './system-prompt.js';
import { classifyError as classifyToolError, extractDomain as extractDomainStat } from './stats-service.js';
import { env as appEnv } from '../../config/env.js';
import { buildCtripFlightHint, isCtripFlightResultsUrl } from './ctrip-flight-extractor.js';

/**
 * Anti-crawl stuck detection thresholds.
 *
 * When the same page screenshot repeats across N consecutive computer
 * actions, the site is probably blocking us. But "probably" is doing
 * a lot of work here — the model genuinely needs a few turns to load
 * a site, scroll, observe, then act. If we bail too early we get the
 * anti-pattern the Phase 5 benchmark caught: every stuck hit degrades
 * to web_search and the agent never actually drives the browser.
 *
 * Raised from (3 / 5) to (6 / 12) so the model gets:
 *   - 6 quiet turns before it's warned with mobile-site + retry hints
 *   - another 6 turns after the warning to try alternate tactics
 *   - only then does the hard "stop browsing, wrap up" nudge land
 *
 * Goal: the browser path gets a real chance to succeed before we
 * concede to search. The matching prompt push on the model side
 * ("try m.xxx.com, reset with about:blank, swap alternate hostname
 * before giving up") lives in system-prompt.ts.
 *
 * Exact MD5 hash comparison — JPEG compression is deterministic for
 * identical input, and cursor-move-only diffs produce different bytes
 * (which we want: cursor motion IS progress).
 */
export const STUCK_WARN_THRESHOLD = 6;
export const STUCK_EXIT_THRESHOLD = 12;
const AWAITING_USER_TIMEOUT_CLARIFICATION_MS = 5 * 60 * 1000;
const AWAITING_USER_TIMEOUT_TAKEOVER_MS = 30 * 60 * 1000;

/**
 * Phase 23 Step 3 — Apify actor IDs for the agent-callable scrape /
 * ecommerce tools. Public Apify marketplace defaults; can be swapped
 * without env config (just edit the const). If the actor id is wrong,
 * the run-sync API surfaces a clear 404 in the tool_result, which the
 * model can recover from by trying the browser path again.
 *
 * `apify/website-content-crawler` — generic content scraper, returns
 * { url, title, text, html, ... } per page. We constrain to a single
 * page so the dataset is small.
 *
 * Ecommerce actors return platform-specific shapes; the formatter
 * normalises them to { name, price, rating, url } before handing back
 * to the model.
 */
export const APIFY_SCRAPE_WEBSITE_ACTOR = 'apify/website-content-crawler';
export const APIFY_ECOMMERCE_ACTORS: Readonly<
  Record<'amazon' | 'jd' | 'taobao', string>
> = {
  amazon: 'epctex/amazon-search-scraper',
  jd: 'apify/jd-product-scraper',
  taobao: 'dtrungtin/taobao-products-scraper',
};

/** Trim a long string at a UTF-8 grapheme-safe-ish boundary. */
function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated, ${s.length - max} more chars]`;
}

/**
 * Format `apify/website-content-crawler` items into a text summary the
 * model can consume. The actor returns dataset items shaped like
 * { url, title, text, markdown, ... }; we prefer markdown when present.
 * Output capped to ~30KB so a verbose page doesn't blow out the context
 * window or run into cache fragmentation.
 *
 * Exported for unit tests (see agent-loop.apify-tools.test.ts).
 */
export function formatScrapeWebsiteResult(items: readonly unknown[], requestedUrl: string): string {
  if (items.length === 0) {
    return `scrape_website: 没有抓取到内容 (url=${requestedUrl})。试试浏览器或换个 URL。`;
  }
  const first = items[0] as {
    url?: string;
    title?: string;
    text?: string;
    markdown?: string;
  };
  const finalUrl = first.url ?? requestedUrl;
  const title = first.title ?? '(untitled)';
  const body = absolutizeMarkdownLinks(first.markdown ?? first.text ?? '', finalUrl);
  const head = `# scrape_website 结果\n来源: ${finalUrl}\n标题: ${title}\n\n---\n\n`;
  return head + truncateText(body, 30_000) + '\n\n---\n**记得回到浏览器继续完成任务**';
}

export function absolutizeMarkdownLinks(markdown: string, baseUrl: string): string {
  if (!markdown || !baseUrl) return markdown;
  return markdown.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (raw, label: string, href: string) => {
      if (/^(?:https?:|mailto:|tel:|#)/i.test(href)) return raw;
      try {
        const absolute = new URL(href, baseUrl).toString();
        if (!/^https?:/i.test(absolute)) return raw;
        return `[${label}](${absolute})`;
      } catch {
        return raw;
      }
    },
  );
}

/**
 * Normalise platform-specific scraper output to { name, price, rating, url }
 * and serialise as JSON. Different actors emit different field names; we
 * probe a handful of common shapes (title/name, price/priceText, rating/
 * stars, url/productUrl) and fall through to passing the raw object so
 * the model can still reason about it.
 */
export function formatSearchEcommerceResult(
  items: readonly unknown[],
  platform: string,
  query: string,
): string {
  if (items.length === 0) {
    return `search_ecommerce(${platform}): "${query}" 没有结果。试试更通用的关键词或换平台。`;
  }
  const normalised = items.slice(0, 30).map((raw) => {
    const r = raw as Record<string, unknown>;
    const name = (r.title ?? r.name ?? r.productName ?? r.itemName ?? '') as string;
    const price = (r.price ?? r.priceText ?? r.salePrice ?? r.currentPrice ?? '') as
      | string
      | number;
    const rating = (r.rating ?? r.stars ?? r.averageRating ?? r.score ?? '') as
      | string
      | number;
    const url = (r.url ?? r.productUrl ?? r.link ?? r.itemUrl ?? '') as string;
    return { name, price, rating, url };
  });
  const head = `# search_ecommerce 结果 (${platform}, query="${query}", ${items.length} items)\n\n`;
  const json = JSON.stringify(normalised, null, 2);
  return (
    head +
    truncateText(json, 28_000) +
    '\n\n---\n**记得回到浏览器中打开商品页或做对比表，让用户看到执行过程**'
  );
}

export function formatFirecrawlSearchEcommerceResult(
  results: readonly { title?: string; url: string; markdown: string }[],
  platform: string,
  query: string,
  maxResults: number,
): string {
  const limited = results.slice(0, Math.max(1, maxResults));
  const head = `# search_ecommerce 结果 (${platform}, query="${query}", ${results.length} pages)\n\n`;
  const productLinkCandidates = extractEcommerceProductLinks(limited, platform).slice(
    0,
    Math.max(1, maxResults * 3),
  );
  const sourceCandidates = limited.map((res, i) => ({
    rank: i + 1,
    title: res.title ?? res.url,
    url: res.url,
    product_links: extractEcommerceProductLinks([res], platform).slice(0, 8),
    snippet: res.markdown.replace(/\s+/g, ' ').slice(0, 500),
  }));
  const sourceBlock =
    '## 可引用来源清单（最终答案必须优先引用这里的 URL；不要输出空 url；每行商品尽量使用不同的商品详情链接）\n\n' +
    '```json\n' +
    JSON.stringify({ product_link_candidates: productLinkCandidates, source_candidates: sourceCandidates }, null, 2) +
    '\n```\n\n';
  const blocks = limited
    .map((res) => {
      const md = res.markdown.length > 6_000
        ? `${res.markdown.slice(0, 5_988)}\n\n…(truncated)`
        : res.markdown;
      return `## ${res.title ?? res.url}\n来源: ${res.url}\n\n${md}`;
    })
    .join('\n\n---\n\n');
  const tail =
    '\n\n---\n**记得回到浏览器中整理 / 呈现这些信息（产品名/价格/链接）。最终答案每行商品必须带一个可点击来源链接；优先使用 product_link_candidates 里的不同商品链接。若无法找到足够多的独立商品链接，不要把同一个列表页复用于多行，改为只列可验证行并说明限制。**';
  return head + sourceBlock + blocks + tail;
}

export function extractEcommerceProductLinks(
  results: readonly { url: string; markdown: string; title?: string }[],
  platform: string,
): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  for (const res of results) {
    for (const candidate of extractLinksFromMarkdown(res.markdown)) {
      if (!isLikelyEcommerceProductUrl(candidate.url, platform)) continue;
      const clean = stripLinkTrailingPunct(candidate.url);
      if (seen.has(clean)) continue;
      seen.add(clean);
      out.push({
        title: candidate.title || res.title || clean,
        url: clean,
      });
    }
    if (isLikelyEcommerceProductUrl(res.url, platform)) {
      const clean = stripLinkTrailingPunct(res.url);
      if (!seen.has(clean)) {
        seen.add(clean);
        out.push({ title: res.title ?? clean, url: clean });
      }
    }
  }
  return out;
}

function extractLinksFromMarkdown(markdown: string): Array<{ title: string; url: string }> {
  const links: Array<{ title: string; url: string }> = [];
  for (const m of markdown.matchAll(/\[([^\]\n]{1,160})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const title = (m[1] ?? '').trim();
    const url = stripLinkTrailingPunct(m[2] ?? '');
    if (url) links.push({ title, url });
  }
  for (const m of markdown.matchAll(/https?:\/\/[^\s)\]"'<>，。]+/g)) {
    const url = stripLinkTrailingPunct(m[0]);
    if (url) links.push({ title: '', url });
  }
  return links;
}

function isLikelyEcommerceProductUrl(url: string, platform: string): boolean {
  try {
    const u = new URL(stripLinkTrailingPunct(url));
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (platform === 'jd') {
      return host === 'item.jd.com' && /\/\d+\.html$/.test(path);
    }
    if (platform === 'taobao') {
      if (host === 'item.taobao.com' || host === 'detail.tmall.com') return true;
      if (host === 'pcdetail.taobao.com') return path.length > 1;
      if (host === 'www.taobao.com' && /\/list\/item\//.test(path)) return true;
      return false;
    }
    if (platform === 'amazon') {
      return /(^|\.)amazon\./.test(host) && /\/(?:dp|gp\/product)\//.test(path);
    }
  } catch {
    return false;
  }
  return false;
}

function stripLinkTrailingPunct(url: string): string {
  return url.replace(/[)\].,;:，。]+$/g, '');
}

/**
 * Phase 24 fix #1 — stuck-tier nudge text builder.
 *
 * The supercar loop tracks `stuckCount` (consecutive turns where the
 * page-screenshot hash didn't change). When the count crosses one of
 * two thresholds, we inject a text block alongside the tool_results so
 * the model gets a hint without losing its in-flight tool_use cycle.
 *
 *   - WARN tier (every turn while stuck >= STUCK_WARN_THRESHOLD):
 *     browser-first guidance — wait, mobile sites, alternate hostnames,
 *     reset. Phase 5 benchmark confirmed: mentioning search OR Apify
 *     here pushes the model into abandoning the browser path on its
 *     first stuck signal, before genuine retries have run their course.
 *
 *   - EXIT tier (one-shot when stuck >= STUCK_EXIT_THRESHOLD):
 *     reality has not changed in 12+ turns. The browser path is dead
 *     for this target. Pre-Phase-24 wording told the model to STOP
 *     using computer tools and use web_search — but `scrape_website` /
 *     `search_ecommerce` (Phase 23 step 3) are far better fits when
 *     the orchestrator boots with an Apify adapter, because they
 *     return structured page content the model can keep working with.
 *     The new wording leads with Apify and keeps web_search as a
 *     final fallback.
 *
 * Pure function: takes counts + flags, returns text + tier discriminator
 * so the caller can log appropriately. No reads of process.env, no
 * I/O, no clock — fully testable.
 */
export interface StuckNudgeInput {
  stuckCount: number;
  /** True when `opts.apifyAdapter` is configured (scrape_website / search_ecommerce tools registered). */
  hasApifyTools: boolean;
  /** Whether the EXIT-tier nudge has already fired this run. */
  alreadyForcedExit: boolean;
}

export interface StuckNudgeResult {
  /** 'exit-first' = first time crossing exit threshold this run. 'warn' = warn tier (every turn). */
  tier: 'exit-first' | 'warn';
  text: string;
}

function isEcommerceListingIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  const hasEcommerceHint = [
    '电商站',
    '电商平台',
    '购物平台',
    '商品',
    '商品页',
    '商品链接',
    '京东',
    '淘宝',
    '天猫',
    '拼多多',
    '抖音商城',
    '小红书商城',
    'jd',
    'taobao',
    'tmall',
    'pdd',
    'amazon',
  ].some((hint) => lower.includes(hint));
  if (!hasEcommerceHint) return false;

  const hasPrice = /价格|多少钱|最低价|最便宜|price/.test(lower);
  const asksForLinks = /链接|url|link/.test(lower);
  const asksForRows =
    /前\s*\d+|top\s*\d+|\d+\s*(?:个|条|款)?(?:结果|商品|products?)/i.test(intent) ||
    ['结果', '列表', '名称', '价格', '链接', '按价格', '排序'].filter((hint) =>
      lower.includes(hint),
    ).length >= 3;
  return hasPrice && asksForLinks && asksForRows;
}

export function shouldUseScraperAfterAuthWall(input: {
  intent: string;
  kind: 'login' | 'captcha' | 'permission';
  hasScraperTools: boolean;
}): boolean {
  if (!input.hasScraperTools) return false;
  if (input.kind === 'captcha') return false;
  return isEcommerceListingIntent(input.intent);
}

export function buildAuthWallScraperRescueText(input: {
  intent: string;
  kind?: 'login' | 'captcha' | 'permission';
  url: string | null;
}): string {
  const wallLabel = input.kind === 'permission' ? '权限页' : '登录页';
  const urlLine = input.url ? `当前浏览器停在${wallLabel}：${input.url}\n` : '';
  return (
    `${urlLine}这是一个公开商品列表/比价查询，不要要求用户登录，也不要停在 awaiting_user。\n\n` +
    `请立刻改用 \`search_ecommerce\` 获取数据，不要继续用 \`web_search\` 拼结果：\n` +
    `- 如果用户提到京东或通用中文电商，优先 platform="jd"\n` +
    `- 如果京东无结果，再试 platform="taobao"\n` +
    `- query 保留核心商品词，例如 "iPhone 16 128GB"\n` +
    `- 最终答案必须给出前 5 个结果的名称、价格、可点击链接，并按价格从低到高排序\n` +
    `- 如果某个平台只返回搜索页，也要引用对应搜索结果页 URL，不要输出空链接\n\n` +
    `用户原始需求：${input.intent}`
  );
}

export function buildEcommerceAuthWallFallbackSummary(input: {
  intent: string;
  authWallUrl: string | null;
  searchResultText: string;
}): string {
  const urlLine = input.authWallUrl
    ? `浏览器商品页被登录/权限页拦截：${input.authWallUrl}\n\n`
    : '';
  return (
    `我没有继续要求登录，也没有在登录墙里反复重试。\n\n` +
    urlLine +
    `下面是后台商品抓取返回的候选结果。只保留能关联到商品详情页或明确来源页的内容；如果可验证商品详情链接不足 5 个，应明确说明不足，不要用搜索页/品类页硬凑。\n\n` +
    `用户原始需求：${input.intent}\n\n` +
    `---\n\n` +
    truncateText(input.searchResultText, 18_000)
  );
}

export function buildStuckNudge(input: StuckNudgeInput): StuckNudgeResult | null {
  if (input.stuckCount >= STUCK_EXIT_THRESHOLD && !input.alreadyForcedExit) {
    return {
      tier: 'exit-first',
      text: buildExitNudgeText(input.stuckCount, input.hasApifyTools),
    };
  }
  if (input.stuckCount >= STUCK_WARN_THRESHOLD) {
    return { tier: 'warn', text: buildWarnNudgeText(input.stuckCount) };
  }
  return null;
}

function buildWarnNudgeText(stuckCount: number): string {
  return (
    `提示：页面截图已连续 ${stuckCount} 次未变化，当前操作可能未生效。\n\n` +
    `先尝试以下浏览器内的方案，不要直接放弃 computer 工具：\n` +
    `1. **等一下**：wait 3-5 秒后再点击，某些站点首次加载慢\n` +
    `2. **让用户帮忙**：如果看起来像验证码/滑块，输出"检测到验证码，请在右侧 panel 手动完成"并停住\n` +
    `3. **换路径**：同站点的 /explore /hot /discover 分类页通常不需要登录\n` +
    `4. **换备选站点**：携程→飞猪/去哪儿、京东→拼多多、Boss直聘→拉勾\n` +
    `5. **重置页面**：先 navigate 到 about:blank，再重新访问目标\n` +
    `6. **最后选项**：切移动版 m.xxx.com（m.jd.com / m.ctrip.com / m.zhipin.com）`
  );
}

function buildExitNudgeText(stuckCount: number, hasApifyTools: boolean): string {
  const head =
    `系统检测：页面已连续 ${stuckCount} 次无响应（hash 未变），浏览器路径暂时走不通。\n\n`;
  if (hasApifyTools) {
    // Apify-first rescue. The agent already has scrape_website /
    // search_ecommerce in its tool list — most failures here are
    // because the model didn't connect "browser is stuck" to "I have
    // a backend scraper for this." Spell it out explicitly, including
    // the URL the page is currently parked on.
    return (
      head +
      `请按以下顺序处理（不要直接 task_done / 总结放弃）：\n` +
      `1. **优先调用 \`scrape_website\`**：参数 url 用你刚才尝试访问的目标 URL（即页面停留的当前网址）。后台抓取通常能拿到内容。\n` +
      `2. **电商类查询**：如果用户问的是商品/比价（amazon / 京东 / 淘宝），改用 \`search_ecommerce\`，platform + query 直接传。\n` +
      `3. **拿到数据后必须回到浏览器**：打开能展示数据的页面（Google Sheets / 文档），或对照原站做整理。不要把抓到的纯文字当最终回复。\n` +
      `4. **Apify 也失败时再用 \`web_search\`**：搜索引擎兜底信息，并在最终输出中说明"目标站点暂时无法访问，已通过其他途径获取"。\n\n` +
      `当前状态：你仍然有 computer + scrape_website + search_ecommerce 三套工具。换一套继续推进，不要放弃任务。`
    );
  }
  // Apify not configured — degrade to the legacy web_search guidance.
  return (
    head +
    `请按以下顺序处理：\n` +
    `1. 如果你已经获取到足够信息，直接汇总输出（markdown 格式）\n` +
    `2. 如果信息不足，改用 \`web_search\` 工具搜索同一问题\n` +
    `3. 在最终输出中明确告知用户：目标网站暂时无法访问，已通过其他途径获取信息`
  );
}

/**
 * Phase 24 fix #3 — patch orphaned `server_tool_use` blocks.
 *
 * Sonnet 4.6 + computer-use-2025-11-24 implicitly enables the server-
 * side `code_execution` tool. Anthropic NORMALLY emits the
 * `server_tool_use(code_execution)` block paired with a matching
 * `code_execution_tool_result` block in the same `response.content`.
 * The API occasionally drops the result (sandbox cold-start race?) —
 * when we then echo the assistant content back, the next
 * `messages.create` rejects with:
 *
 *   "messages.1: code_execution tool use with id `srvtoolu_…` was found
 *    without a corresponding code_execution_tool_result block"
 *
 * That kills the task at iteration 2 with no chance for the agent to
 * recover (e.g. via `scrape_website`). We can't *drop* the orphan: the
 * response carries thinking blocks whose signatures span the entire
 * assistant content. So this helper INSERTS a synthetic `*_tool_result`
 * block right after each orphaned `server_tool_use`, using the exact
 * `*_tool_result_error` shape Anthropic emits when the tool itself
 * fails. Insertion preserves block ordering, so thinking signatures
 * stay valid; the model receives a clear "execution unavailable"
 * signal and continues.
 *
 * Pure function. Returns a NEW array; original is not mutated. Empty
 * `orphansFixed` means the content was clean — caller can fast-path.
 */
export interface PatchOrphansResult {
  patched: Anthropic.Beta.BetaContentBlock[];
  orphansFixed: Array<{ name: string; id: string }>;
}

export function patchOrphanServerToolUses(
  content: ReadonlyArray<Anthropic.Beta.BetaContentBlock>,
): PatchOrphansResult {
  const seenResultIds = new Set<string>();
  for (const block of content) {
    const t = (block as { type?: string }).type;
    if (
      t === 'web_search_tool_result' ||
      t === 'code_execution_tool_result' ||
      t === 'bash_code_execution_tool_result' ||
      t === 'text_editor_code_execution_tool_result'
    ) {
      const id = (block as { tool_use_id?: string }).tool_use_id;
      if (id) seenResultIds.add(id);
    }
  }
  const patched: Anthropic.Beta.BetaContentBlock[] = [];
  const orphansFixed: Array<{ name: string; id: string }> = [];
  for (const block of content) {
    patched.push(block);
    if ((block as { type?: string }).type !== 'server_tool_use') continue;
    const su = block as { id?: string; name?: string };
    if (!su.id || !su.name) continue;
    if (seenResultIds.has(su.id)) continue;
    if (su.name === 'code_execution') {
      patched.push({
        type: 'code_execution_tool_result',
        tool_use_id: su.id,
        content: {
          type: 'code_execution_tool_result_error',
          error_code: 'unavailable',
        },
      } as unknown as Anthropic.Beta.BetaContentBlock);
      orphansFixed.push({ name: 'code_execution', id: su.id });
    } else if (su.name === 'web_search') {
      patched.push({
        type: 'web_search_tool_result',
        tool_use_id: su.id,
        content: {
          type: 'web_search_tool_result_error',
          error_code: 'unavailable',
        },
      } as unknown as Anthropic.Beta.BetaContentBlock);
      orphansFixed.push({ name: 'web_search', id: su.id });
    }
  }
  return { patched, orphansFixed };
}

export type SupercarStatus =
  | 'completed'
  | 'failed'
  | 'awaiting_user'
  | 'timeout'
  | 'cancelled'
  // F1 — user replied to the awaiting_user prompt with manual data
  // (e.g. pasted GMV / ROI numbers). Loop exits without continuing
  // to drive the browser; dispatcher catches this status and runs
  // generate with the original intent + the user's data, producing
  // a written report. Avoids the "task stuck thinking" mode where
  // supercar resumed in browser-mode but the user never wanted that.
  | 'handoff_to_generate';

/**
 * Shape the loop hands back to `tasks.ts`. Compatible with the legacy
 * vision-loop outcome enough that `TaskRepository.persistVisionOutcome`
 * can accept it after a thin adapter (see `toLegacyOutcome` below).
 */
export interface SupercarOutcome {
  status: SupercarStatus;
  /** Populated on status=completed — the model's final markdown report. */
  summary?: string;
  /** Populated on awaiting_user — the question the model asked the user. */
  question?: string;
  /** Populated on failed / timeout — short Chinese reason for the UI. */
  reason?: string;
  /** How many API round-trips we made (1 iteration = 1 messages.create call). */
  iterations: number;
  /** Which tools the model actually used over the run. Useful for audit + metrics. */
  toolsUsed: string[];
  /**
   * Populated on completed paths only when reconcileFinalAnswer
   * actually changed the model's text (URL or title mismatched
   * observed page). Carries the (truncated) corrected actionSummary
   * for the LAST step (`tickIndex === iterations`) so the dispatcher
   * can splice the new value into `task_steps` and rebroadcast
   * `server.vision.tick.end` — without this, the BrowserPanel "最近
   * 操作" overlay keeps showing the model's original (wrong) URL
   * after the final summary has been corrected, which is the bug
   * that made users distrust the answer.
   */
  reconciledStepUpdate?: { tickIndex: number; actionSummary: string };
}

export interface SupercarTickEvent {
  iteration: number;
  /**
   * All tool names the model invoked in THIS iteration. Typically 0 or
   * 1 entries — Claude emits one `tool_use` per response, but parallel
   * tool calls are possible when `disable_parallel_tool_use` is unset.
   */
  toolsInTurn: string[];
  /** Model's short text preamble this turn, if any — used for step cards. */
  textPreamble: string;
  /** Latency of the API call itself (ms). */
  apiLatencyMs: number;
}

export type SupercarAwaitingKind =
  | 'clarification'
  | 'login'
  | 'captcha'
  | 'permission'
  | 'browser_action';

export interface SupercarAwaitingUserEvent {
  question: string;
  /** When this question was asked. */
  at: Date;
  /**
   * P2 — current page URL captured pre-park, when available.
   * Lets the dispatcher persist tasks.finalUrl so the SPA's
   * BrowserPanel keeps showing the real URL through the pause
   * even when the screencast WS disconnects. Empty / null when
   * the runner has no executor (generate / scrape modes) or
   * the page isn't queryable at the moment.
   */
  currentUrl?: string | null;
  /**
   * P2-A — what KIND of input we're waiting on. The default
   * `clarification` means the agent asked an intake / follow-up
   * question (the user replies in the chat composer). The other
   * kinds need the user to do something IN the browser viewport,
   * which is the only context where the BrowserPanel auto-expands
   * and shows the "需要您手动完成验证" banner. Conflating the two
   * was the BOSS-reported bug: every clarification flashed the
   * verification banner and forced the panel open.
   */
  awaitingKind: SupercarAwaitingKind;
}

export interface SupercarWebSearchEvent {
  iteration: number;
  query: string;
  /**
   * Sources Anthropic returned for this query. Extracted from the
   * paired `web_search_tool_result` content block. Empty array if
   * the result block didn't ship sources (e.g. Anthropic returned an
   * error result for safe-search reasons).
   */
  sources?: Array<{ title: string; url: string; snippet?: string }>;
}

export interface SupercarScreencastEvent {
  iteration: number;
  /** Base64 JPEG, no data: prefix — matches the legacy screencast shape. */
  imageBase64: string;
  url: string;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Phase 1 Playbook B2 — one captured browse action (click / type /
 * navigate). Multi-signal: `visibleText` is the PRIMARY anchor; selector +
 * coordinate are fallbacks. `inputValue` is ALREADY redacted by the loop
 * before this event is emitted — a sensitive field's raw value never
 * appears here. `framePath` is reserved for B3 frame-routed capture.
 */
export interface SupercarActionCaptureEvent {
  actionIndex: number;
  stepType: 'navigate' | 'click' | 'type';
  siteDomain: string | null;
  visibleText: string | null;
  targetSelector: string | null;
  coordinate: { x: number; y: number } | null;
  entryUrl: string | null;
  inputValue: string | null;
  framePath: string | null;
  /**
   * B4 — post-action screenshot (base64 JPEG, no prefix) for SELECTED key
   * steps only (a page-advancing click); the consumer uploads it as a
   * screenshot anchor. Undefined when not selected / anchors disabled.
   */
  screenshotBase64?: string;
}

export interface SupercarAntiBotEvent {
  iteration: number;
  signal: AntiBotSignal;
  /**
   * Milliseconds the UI should show the "please solve this captcha"
   * prompt before we abandon the wait. The agent doesn't actually
   * pause on this (it keeps trying alternate tactics); this is how
   * long the UI's captcha banner stays visible by default.
   */
  waitTimeoutMs: number;
}

export interface SupercarAntiBotResolvedEvent {
  iteration: number;
  /** Why the banner cleared: 'auto' = next screenshot had no anti-bot markers. */
  reason: 'auto';
}

export interface SupercarEvidenceEvent {
  fact: string;
  sourceType: 'browser_state' | 'tool_result' | 'inference';
  sourceDetail: string;
  confidence: 'observed' | 'extracted' | 'inferred';
}

export interface RunSupercarOptions {
  /** External task id (task_…). Correlates hooks and WS frames. */
  taskId: string;
  /** Free-form user intent — the first user message. */
  intent: string;
  /**
   * Connected Playwright executor. Nullable: when null and no other
   * lane handles the task, runSupercarTask fails fast with a clear
   * reason rather than crashing on `executor.observe()`.
   */
  executor: PlaywrightExecutor | null;
  /** API key; defaults to `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Override the default model (`claude-sonnet-4-6`). */
  model?: string;
  /** Cap on messages.create calls per run. Default 50. */
  maxIterations?: number;
  /** Whole-task wall clock (ms). Default 600_000 (10 min). */
  timeoutMs?: number;
  /**
   * Classifier output — passed to the system-prompt composer so the
   * domain YAML fragment lands at the end of the cached prefix.
   */
  domain?: DomainName | null;

  // --- callbacks, all optional, all best-effort ---
  onTick?: (ev: SupercarTickEvent) => void | Promise<void>;
  onScreencast?: (ev: SupercarScreencastEvent) => void | Promise<void>;
  onWebSearch?: (ev: SupercarWebSearchEvent) => void | Promise<void>;
  onAwaitingUser?: (ev: SupercarAwaitingUserEvent) => void | Promise<void>;
  onThinking?: (summary: string) => void | Promise<void>;
  /**
   * Fired when detectAntiBot flags a fresh HIGH-confidence signal on
   * the page text (captcha / cloudflare / block). Called once per
   * detection — not per turn the banner remains visible. Caller
   * typically broadcasts `server.vision.captcha_detected`.
   */
  onAntiBotSignal?: (ev: SupercarAntiBotEvent) => void | Promise<void>;
  /**
   * Fired when a previously-flagged anti-bot banner clears on the
   * next screenshot. Caller typically broadcasts
   * `server.vision.captcha_resolved`.
   */
  onAntiBotResolved?: (ev: SupercarAntiBotResolvedEvent) => void | Promise<void>;
  /** Fired for compact, verifier-safe facts observed inside the loop. */
  onEvidence?: (ev: SupercarEvidenceEvent) => void | Promise<void>;
  /**
   * Phase 1 Playbook B2 — fired once per captured browse action (click /
   * type / navigate). Wired by tasks.ts ONLY when ACTION_CAPTURE is on;
   * when absent the loop skips the whole capture (incl. the page.evaluate),
   * so OFF = zero hot-path overhead. Best-effort (safeCall-guarded).
   */
  onAction?: (ev: SupercarActionCaptureEvent) => void | Promise<void>;
  /**
   * Phase 1 Playbook ④ explorer — LIVE-VETO hook. Fires BEFORE each live WRITE
   * action (click / navigate / type-or-key) executes; returning `{allowed:false}`
   * REFUSES the action (it is NOT executed) and terminates the task. The explorer
   * wires this to the Sensitive Site Protocol so a sensitive action (login / order /
   * pay / submit) is hard-blocked at the moment of dispatch — INCLUDING navigation,
   * which goes via `page.goto` (not `executor.navigate`), so this hook is the only
   * place that covers it. DEFAULT ABSENT → the loop never calls it = zero overhead,
   * byte-identical to a normal user task (same dark-ship discipline as `onAction`).
   * Only the explorer passes it; user tasks never do.
   */
  onBeforeAction?: (action: {
    kind: 'click' | 'navigate' | 'type';
    label?: string | null;
    ariaLabel?: string | null;
    title?: string | null;
    placeholder?: string | null;
    name?: string | null;
    inputType?: string | null;
    url?: string | null;
    // 预订站加固 + Layer C structural/context signals (login-mode veto consumes them).
    tagName?: string | null;
    pageUrl?: string | null;
    pageTitle?: string | null;
    pageTxSignal?: string | null;
  }) => { allowed: boolean; reason?: string } | Promise<{ allowed: boolean; reason?: string }>;
  /**
   * Phase 1 Playbook B4 — when true, the loop attaches the post-action
   * screenshot (base64) to onAction events for SELECTED key steps (a
   * page-advancing click). Set by tasks.ts from B4_SCREENSHOT_ANCHOR (AND
   * ACTION_CAPTURE). When false/absent the screenshot is NEVER attached →
   * zero overhead (the consumer then stores no anchor).
   */
  captureScreenshotAnchors?: boolean;
  /** Layer C — when true, the click-veto captures page title + visible transaction-field NAMES
   *  (a small page.title()+text scan, NO values) so the model fallback can judge SPA transaction
   *  pages. Set by the CLI only when LAYER_C_MODEL_VETO_ENABLED. Off → never scanned (zero cost). */
  captureLayerCSignals?: boolean;
  /**
   * Phase 1 Playbook ④ prerequisite — LLM cost recorder. When provided
   * (together with userExternalId), each SUCCESSFUL messages.create turn is
   * recorded to `llm_calls` (provider / model / tokens / cost / task) so the
   * exploration budget caps + circuit breaker + per-task spend have a source
   * of truth. This loop builds its OWN Anthropic client, so — unlike the
   * vision-loop commander — it was never wired to the recorder and browse
   * tasks recorded $0. Pure accounting: it changes NO execution / token
   * behaviour, and the write is fire-and-forget (never awaited, never throws
   * into the loop — a billing-write failure must not break browsing). Default
   * absent → no recording, identical to pre-④ behaviour (tests + callers that
   * don't pass it are unchanged).
   */
  recorder?: LlmCallRecorder;
  /**
   * External user id (usr_…) for the recorder — `llm_calls.user_id` is NOT
   * NULL, so recording is skipped when this is absent even if `recorder` is set.
   */
  userExternalId?: string;

  // --- Phase 6-2: 5-lane router inputs ---
  /**
   * Optional headed executor (Lane 2). When provided, the loop swaps
   * the active executor over to this on high-confidence anti-bot
   * signals or when stuckCount crosses STUCK_WARN_THRESHOLD. At most
   * one swap per task; swapping back is not supported.
   */
  headedExecutor?: PlaywrightExecutor | null;
  /** Zapier adapter (Lane 4). When provided AND the intent looks like a workflow trigger, the loop short-circuits. */
  zapierAdapter?: ZapierAdapter | null;
  /**
   * Apify adapter (Lane 5). When provided AND the intent has a
   * registered actor AND the browser gets stuck, the loop delegates
   * to the actor and folds the scraped items into the summary.
   */
  apifyAdapter?: ApifyAdapter | null;
  /**
   * Phase 24 RC follow-up — Firecrawl adapter. When provided, the
   * agent's `scrape_website` and `search_ecommerce` tools delegate
   * to Firecrawl instead of Apify. Cheaper + faster for the generic-
   * page case; Apify stays as a fallback when only it's configured.
   */
  firecrawl?: import('../../firecrawl/firecrawl-lane.js').FirecrawlLane | null;
  /**
   * Simple-search classifier output. Used today only as input to the
   * `skipPlan` decision in tasks.ts (no Brave fast lane any more —
   * search now goes through the model's web_search tool inside the loop).
   */
  isSimpleSearch?: boolean;
  /** Cross-platform-automation classifier output. Drives the Zapier short-circuit. */
  isCrossPlatformAutomation?: boolean;
  /**
   * Optional Zapier webhook path (e.g. "/hooks/catch/12345/abc/"). Only
   * used when isCrossPlatformAutomation + zapierAdapter are both set.
   * Absent → Zapier lane is skipped even if classifier matched.
   */
  zapierWebhookPath?: string | null;
  /**
   * Phase 10 Tier 2 — explicit role id, after the caller has applied
   * the user's plan/selected-roles permission gate. When set, the
   * loop uses this verbatim instead of recomputing `classifyRole`,
   * so a Free-plan user can never accidentally get a Pro-only role
   * even if `classifyRole` would have matched on their intent.
   * Tests that don't care about gating can leave it undefined.
   */
  roleIdOverride?: string;
  /**
   * Phase 10 Tier 3 — pre-parsed user-uploaded file blocks. The
   * caller (tasks.create) reads each fileId, runs it through
   * parseFileForPrompt, and passes the resulting content blocks
   * here. They get prepended to the agent's first user message so
   * the model sees the attachment alongside the original intent.
   * Empty / undefined → no attachment, identical to pre-T3
   * behaviour.
   */
  attachments?: Anthropic.Beta.BetaContentBlockParam[];
  /**
   * Phase 10 Tier 3 — per-plan format whitelist for the `create_file`
   * tool. When non-empty, the tool is exposed to the model with
   * `format` constrained to this list; an empty / undefined list
   * suppresses the tool entirely (Free plan). The list is also
   * re-checked at execution time below as a defence-in-depth
   * (a model can't smuggle a forbidden format past the schema).
   */
  createFileFormats?: readonly string[];
  /**
   * Callback invoked when the model calls `create_file`. The caller
   * (tasks.create) wires this to FileService.storeOutput so the
   * returned download URL points at /api/files/:id/download. Absent
   * → tool returns an error result asking the model to ask the user
   * to enable file output.
   */
  onCreateFile?: (input: {
    filename: string;
    format: string;
    content: string;
  }) => Promise<{ fileId: string; filename: string; size: number; downloadUrl: string } | { error: string }>;

  /**
   * Phase 3 R3 — `save_page_as_pdf` tool callback. Storage-only:
   * the loop renders the current page to PDF via Playwright's
   * `page.pdf()` (CDP `Page.printToPDF`) and hands the Buffer to
   * this callback; the callback persists it through DownloadManager
   * and returns the download URL. Splitting it this way keeps
   * page-rendering in the loop (where the executor handle lives)
   * and storage in the dispatcher (where DownloadManager lives).
   * Absent → tool is suppressed.
   */
  onSavePageAsPdf?: (input: {
    filename: string;
    pdfBuffer: Buffer;
  }) => Promise<{ fileId: string; filename: string; sizeBytes: number; downloadUrl: string } | { error: string }>;

  // --- Phase 13 Dim 5/6: cross-task memory + execution stats ---
  /**
   * Pre-rendered memory preamble (output of MemoryService.formatForPrompt).
   * Caller fetches the user's relevant memories and passes the
   * formatted block here; the loop appends it to the first user
   * message after the intent. Empty / undefined → no preamble.
   */
  memoryPreamble?: string;
  /**
   * Phase 14 — site-playbook context. Pre-rendered block from
   * `composePlaybookPreamble(intent)`. Lands in the same first user
   * message after memoryPreamble (still NOT in system prompt — keeps
   * cache hits intact). Empty / undefined → no preamble.
   */
  playbookContext?: string;
  /**
   * Stats sink: invoked after each tool_result is synthesized so
   * the loop can persist the (lane, latency, success, error_type)
   * tuple. Caller wires this to StatsService.record. Errors in
   * the sink are swallowed by StatsService itself.
   */
  onStatsRecord?: (input: {
    laneUsed: string;
    targetSite: string | null;
    success: boolean;
    latencyMs: number;
    errorType: string | null;
  }) => void | Promise<void>;
  /** Phase 13 Dim 1 — pre-generated plan output to broadcast on first tick. */
  planText?: string | null;
  /**
   * Phase 13 Dim 1 follow-up — initial plan-step status array.
   * When provided alongside `planText`, the loop appends a small
   * tracker hint to each tool_result user message so the model
   * embeds `[STEP N status]` markers in its text blocks; the loop
   * parses those markers and forwards every update through
   * `onPlanStepUpdate`.
   */
  planSteps?: Array<{
    idx: number;
    status: 'pending' | 'running' | 'done' | 'failed';
    note?: string;
  }>;
  /**
   * Phase 13 Dim 1 follow-up — fired whenever the loop parses a
   * plan-step marker out of the model's text. Caller (tasks.create)
   * wires this to a DB UPDATE on `tasks.plan_status` + a WS
   * broadcast `server.task.plan_step` so the SPA's PlanCard
   * updates state pills live.
   */
  onPlanStepUpdate?: (steps: Array<{
    idx: number;
    status: 'pending' | 'running' | 'done' | 'failed';
    note?: string;
  }>) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory handle table for the user-reply flow
// ---------------------------------------------------------------------------

interface RunHandle {
  /** Resolve the pending-reply promise with the user's text. */
  resolveReply: ((text: string) => void) | null;
  /** Flip to signal the loop that the client aborted the run. */
  abort: () => void;
  /**
   * F1 — when set, the next reply resolution exits the loop with
   * status='handoff_to_generate' instead of continuing the browser
   * loop. Carries the user's message so the dispatcher can build a
   * generate prompt that combines original intent + manual data.
   */
  handoffMessage: string | null;
  /** Stamp the original user intent so the handoff path can repackage it. */
  originalIntent: string;
  /**
   * F2 — attachment content blocks the user uploaded with their reply.
   * Set by `supercarReply(taskId, message, attachmentBlocks)`; the
   * loop reads + clears this on reply resume to build a multi-block
   * `{ role: 'user', content: [...blocks, { type: 'text', text }] }`
   * message instead of the bare-text path. Empty / missing means the
   * reply was text-only (the original behaviour).
   */
  pendingAttachmentBlocks: ReadonlyArray<{ type: string }> | null;
}

const handles = new Map<string, RunHandle>();

/**
 * Resume a supercar run that's parked on `onAwaitingUser`. Returns
 * true if the task accepted the reply, false if the task isn't
 * currently waiting for one (unknown taskId, already moved on, etc.).
 *
 * Called from the `tasks.reply` tRPC mutation. F2 — optional
 * `attachmentBlocks` plumb file uploads through the reply path; when
 * present, the loop pushes a multi-block user message instead of
 * bare text so the model sees the attachments alongside the reply.
 */
export function supercarReply(
  taskId: string,
  message: string,
  attachmentBlocks?: ReadonlyArray<{ type: string }>,
): boolean {
  const handle = handles.get(taskId);
  if (!handle || !handle.resolveReply) return false;
  if (attachmentBlocks && attachmentBlocks.length > 0) {
    handle.pendingAttachmentBlocks = attachmentBlocks;
  }
  const resolve = handle.resolveReply;
  handle.resolveReply = null;
  resolve(message);
  return true;
}

/**
 * Phase 3 R1 — pre-check whether a supercar handle exists AND is
 * currently parked on a user reply. Used by the reply path in
 * tasks.ts: it needs to know whether the user's reply will be
 * delivered to a parked supercar (so it can flip the DB row from
 * `awaiting_user` back to `executing` BEFORE supercarReply wakes the
 * agent), or whether it should fall through to the generate-resume
 * path. Pure observer — no side effects.
 */
export function hasParkedSupercarHandle(taskId: string): boolean {
  const handle = handles.get(taskId);
  return Boolean(handle && handle.resolveReply);
}

/**
 * F1 — variant of supercarReply that signals "user provided manual
 * data, exit the browser loop and hand off to generate". The dispatcher
 * checks the loop's outcome.status and, when it's
 * 'handoff_to_generate', invokes runGenerateTask with the original
 * intent + this manual data instead of marking the task failed /
 * cancelled. Returns true if the handoff was accepted (handle exists +
 * is parked); false if the task isn't currently parked.
 */
export function supercarHandoffToGenerate(
  taskId: string,
  message: string,
): boolean {
  const handle = handles.get(taskId);
  if (!handle || !handle.resolveReply) return false;
  handle.handoffMessage = message;
  const resolve = handle.resolveReply;
  handle.resolveReply = null;
  resolve(message);
  return true;
}

/**
 * Read the original intent stamped into the handle when the loop
 * started. Used by the dispatcher's handoff branch to rebuild the
 * generate prompt without requiring the user to retype.
 */
export function supercarHandleOriginalIntent(taskId: string): string | null {
  const handle = handles.get(taskId);
  return handle ? handle.originalIntent : null;
}

/**
 * Abort a running task. If the task is mid-API-call this will cause
 * the next loop iteration to bail; if it's parked on `onAwaitingUser`
 * the pending-reply promise rejects and the loop exits cancelled.
 */
export function supercarAbort(taskId: string): boolean {
  const handle = handles.get(taskId);
  if (!handle) return false;
  handle.abort();
  return true;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const COMPUTER_USE_BETA = 'computer-use-2025-11-24';

export async function runSupercarTask(opts: RunSupercarOptions): Promise<SupercarOutcome> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: 'failed',
      reason: 'missing ANTHROPIC_API_KEY',
      iterations: 0,
      toolsUsed: [],
    };
  }

  // Phase 10 Tier 1 — visibility log up-front. Fires for EVERY supercar
  // entry, including ones that exit via the Zapier short-circuit
  // below before the model loop ever runs.
  const tier1Diag = appEnv.PHASE10_TIER1;
  if (tier1Diag) {
    // Honour the gated role override here too — the diag log should
    // reflect what the loop will actually use, not the raw classifier
    // output that was about to be stripped by the gate.
    const roleIdDiag = opts.roleIdOverride ?? classifyRole(opts.intent);
    const routedDiag = selectModelAndEffort(opts.intent, roleIdDiag);
    logger.info(
      {
        taskId: opts.taskId,
        tier1: true,
        model: routedDiag.model,
        effort: routedDiag.effort,
        roleId: roleIdDiag,
        roleGated: opts.roleIdOverride != null,
        taskBudget: getTaskBudget(opts.intent, roleIdDiag),
      },
      'supercar: model + role routing',
    );
  }

  // ---------------------------------------------------------------
  // Phase 6-2: non-browser lane short-circuits (before any model call)
  // ---------------------------------------------------------------
  // Diagnostic: log routing inputs once per entry so BOSS can correlate
  // pm2 logs to which lane handled the task.
  logger.info(
    {
      taskId: opts.taskId,
      isSimpleSearch: Boolean(opts.isSimpleSearch),
      intentPreview: opts.intent.slice(0, 80),
    },
    'supercar: routing decision',
  );
  // Phase 10 Tier 3 — file attachments disable the Zapier fast lane.
  // The whole point of attaching a file is for the agent to read it;
  // short-circuiting through a webhook trigger throws the attachment
  // away. Forcing the model loop ensures the attachment blocks reach
  // the first user message.
  const hasAttachments = (opts.attachments?.length ?? 0) > 0;

  // Lane 4 — Zapier. Only triggers when the caller supplied BOTH the
  // classifier match AND an explicit webhook path; we don't guess
  // routes. The hook returns a run id the user can track in Zapier.
  if (
    opts.isCrossPlatformAutomation &&
    opts.zapierAdapter &&
    opts.zapierWebhookPath &&
    !hasAttachments
  ) {
    const r = await opts.zapierAdapter.trigger(opts.zapierWebhookPath, {
      intent: opts.intent,
      task_id: opts.taskId,
    });
    if ('ok' in r) {
      logger.info(
        { taskId: opts.taskId, lane: 'zapier', runId: r.runId ?? null },
        'supercar: triggered Zap via webhook',
      );
      const lines = [
        `# 已触发 Zap 工作流`,
        '',
        `任务已通过 Zapier 触发，后台异步执行。`,
      ];
      if (r.runId) lines.push(`- Run ID: \`${r.runId}\``);
      if (r.statusUrl) lines.push(`- 查看进度：${r.statusUrl}`);
      // P1 — Zapier short-circuit completes the task without ever
      // entering the loop, so the in-loop convergePlanOnSuccess
      // never runs. Mirror it inline here.
      if ((opts.planSteps?.length ?? 0) > 0) {
        const converged = opts.planSteps!.map((s) =>
          s.status === 'pending' || s.status === 'running'
            ? { ...s, status: 'done' as const }
            : { ...s },
        );
        void Promise.resolve(opts.onPlanStepUpdate?.(converged));
      }
      return {
        status: 'completed',
        summary: lines.join('\n'),
        iterations: 0,
        toolsUsed: ['zapier'],
      };
    }
    logger.warn(
      { taskId: opts.taskId, err: r.error },
      'supercar: Zapier trigger failed — falling through to browser',
    );
  }

  // Past every non-browser short-circuit. Anything below this point
  // dispatches tool calls against `executor`, so a null one is fatal
  // — fail the task with a clear reason rather than crash on the
  // first `executor.observe()`.
  if (!opts.executor) {
    logger.warn(
      { taskId: opts.taskId, isSimpleSearch: Boolean(opts.isSimpleSearch) },
      'supercar: no executor available — failing task',
    );
    return {
      status: 'failed',
      reason: '浏览器暂时不可用，请稍后再试。',
      iterations: 0,
      toolsUsed: [],
    };
  }

  const client = new Anthropic({ apiKey });
  // Phase 10 Tier 1: route model + effort + task_budget per (intent, role).
  // When the env flag is off the legacy fixed-model path runs, identical to
  // pre-Tier-1 behaviour. `roleId` also drives which Role layer the prompt
  // composer injects below.
  const tier1 = appEnv.PHASE10_TIER1;
  // Use the caller's gated role when supplied; only fall back to
  // classifying the raw intent for legacy callers (tests, the smoke
  // path) that don't have a user context. The gate matters because
  // the role text is hand-written for paid tiers — leaking it to
  // Free users devalues the upsell.
  const roleId = opts.roleIdOverride ?? classifyRole(opts.intent);
  const routedRaw = tier1
    ? selectModelAndEffort(opts.intent, roleId)
    : { model: opts.model ?? process.env.SUPERCAR_MODEL ?? 'claude-sonnet-4-6', effort: 'high' as Effort };
  // Phase 24 RC follow-up — supercar requires Sonnet or Opus.
  // selectModelAndEffort routes simple-search intents to Haiku 4.5 to
  // save cost on the generate path; that's correct for the generate
  // runner, but a browser-mode task running through supercar uses
  // computer-use-2025-11-24 beta + adaptive thinking + the multi-tick
  // tool loop, none of which are supported on Haiku. RC saw V5
  // (simple-search browser intent → Haiku → 400 "adaptive thinking
  // is not supported on this model") fail at iteration 1.
  // Upgrade transparently here so the agent never sees the bad
  // combination; log so we can audit cost lift if browser-mode
  // simple-search tasks become a major share.
  const routed: { model: string; effort: Effort } =
    routedRaw.model === 'claude-haiku-4-5'
      ? { model: 'claude-sonnet-4-6', effort: 'medium' }
      : routedRaw;
  if (routed.model !== routedRaw.model) {
    logger.info(
      { taskId: opts.taskId, originalModel: routedRaw.model, upgradedTo: routed.model },
      'supercar: upgraded Haiku → Sonnet (adaptive-thinking compatibility)',
    );
  }
  const model = routed.model;
  const effort: Effort = routed.effort;
  const taskBudget = tier1 ? getTaskBudget(opts.intent, roleId) : null;
  // Opus 4.7 has a more expensive tokenizer (1-1.35× input bytes/token);
  // give it more output room. Sonnet keeps the prior 8K cap.
  const maxTokens = model === 'claude-opus-4-7' ? 8192 : 8192;
  // Note: the routing decision is logged earlier (right after the
  // ANTHROPIC_API_KEY check) under 'supercar: model + role routing'
  // so it's visible even when Zapier short-circuits before the model
  // loop runs. No need to log again here.
  const maxIterations =
    opts.maxIterations ?? Number.parseInt(process.env.SUPERCAR_MAX_ITERATIONS ?? '50', 10);
  const timeoutMs =
    opts.timeoutMs ?? Number.parseInt(process.env.SUPERCAR_TIMEOUT_MS ?? '600000', 10);
  const deadline = Date.now() + timeoutMs;
  let lastSearchEcommerceResultText: string | null = null;

  // Browser executor is LET, not const — Phase 6-2 swaps it to the
  // headed lane on anti-bot strikes. Every subsequent screenshot /
  // click / type reads this var, so the swap is transparent to the
  // rest of the loop.
  let executor: PlaywrightExecutor = opts.executor;
  /** Fire at most once — multiple swaps mid-task cause page flicker. */
  let executorSwapped = false;
  async function swapToHeadedIfAvailable(reason: string): Promise<boolean> {
    if (executorSwapped) return false;
    if (!opts.headedExecutor) return false;
    executorSwapped = true;
    const priorUrl = page.url();
    logger.info(
      { taskId: opts.taskId, reason, priorUrl, lane: 'headed' },
      'supercar: swapping to headed executor',
    );
    executor = opts.headedExecutor;
    try {
      await executor.resetPageForTask();
      const hp = (await executor.getPage()) as unknown as PageLike;
      // Re-navigate to the prior URL so Claude sees the same
      // destination on the next tool_result. If the prior URL is
      // about:blank (we never navigated), skip — Claude will navigate
      // fresh on its next tool call.
      if (priorUrl && priorUrl !== 'about:blank') {
        await (hp as unknown as { goto: (u: string) => Promise<void> }).goto(priorUrl);
      }
    } catch (err) {
      logger.warn(
        { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
        'supercar: swap re-navigate failed — continuing',
      );
    }
    return true;
  }

  // Park the tab on a fresh about:blank so stale overlays from prior
  // tasks don't leak into the first screenshot.
  try {
    await executor.resetPageForTask();
  } catch (err) {
    logger.warn({ err, taskId: opts.taskId }, 'supercar: resetPageForTask failed — continuing');
  }

  let page = (await executor.getPage()) as unknown as PageLike;
  // Note: `page` is const-ish in spirit but the executor swap above
  // re-reads it via getPage() inside the helper, so downstream uses
  // can rely on always calling executor.getPage() to pick up the new
  // browser. The loop-body already does so on every iteration.

  // Initial observation — the model needs to see the current page to
  // ground its first action.
  //
  // Phase 24 RC follow-up — wrap in a small retry loop. RC data
  // showed 36/165 tasks died here on a transient "Target page,
  // context or browser has been closed" right after pool.allocate;
  // a single retry usually clears it (Brave is still finishing
  // hydration at the moment the agent first asks for a frame).
  // 3 attempts × 2s gap = at most 6s of admit latency before we
  // declare the slot unhealthy and fail the task.
  const SCREENSHOT_MAX_ATTEMPTS = 3;
  const SCREENSHOT_RETRY_GAP_MS = 2_000;
  let initialShot: Awaited<ReturnType<typeof executor.screenshot>> | null = null;
  for (let attempt = 1; attempt <= SCREENSHOT_MAX_ATTEMPTS; attempt++) {
    const shot = await executor.screenshot(page);
    if (!shot.error && shot.base64) {
      if (attempt > 1) {
        logger.info(
          { taskId: opts.taskId, attempt },
          'supercar: initial screenshot ok after retry',
        );
      }
      initialShot = shot;
      break;
    }
    logger.warn(
      { taskId: opts.taskId, attempt, max: SCREENSHOT_MAX_ATTEMPTS, err: shot.error },
      'supercar: initial screenshot attempt failed',
    );
    if (attempt < SCREENSHOT_MAX_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, SCREENSHOT_RETRY_GAP_MS));
      // Re-read the page in case the executor has swapped (Phase 6-2
      // headed/headless lane swap, Phase 24 reset-for-task path).
      try {
        page = (await executor.getPage()) as unknown as PageLike;
      } catch (err) {
        logger.warn(
          { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
          'supercar: getPage between screenshot retries failed — continuing',
        );
      }
    }
  }
  if (!initialShot || initialShot.error || !initialShot.base64) {
    return {
      status: 'failed',
      reason: `initial screenshot failed after ${SCREENSHOT_MAX_ATTEMPTS} attempts: ${initialShot?.error ?? 'unknown'}`,
      iterations: 0,
      toolsUsed: [],
    };
  }
  const displayWidth = initialShot.viewportWidth ?? 1280;
  const displayHeight = initialShot.viewportHeight ?? 800;

  // Fire the first screencast so the UI gets a frame before Claude's
  // first response lands.
  await safeCall(opts.onScreencast, {
    iteration: 0,
    imageBase64: initialShot.base64,
    url: page.url(),
    viewportWidth: displayWidth,
    viewportHeight: displayHeight,
  });

  // Pass the raw intent to the prompt composer so the role-matcher can
  // pick a specialisation (小红书运营 / 法律检索 / PM / ...). The role
  // addon appends after the domain fragment, before the cache
  // breakpoint gets placed on the composed string.
  //
  // Phase 10 Tier 1: when enabled, swap the monolithic core prompt for
  // the lean Base + Role + Style layout. Layered prompts cache better
  // (Base is identical across all tasks) and are cheaper per request.
  const systemPrompt = buildSupercarSystemPrompt({
    domain: opts.domain ?? null,
    intent: opts.intent,
    layered: tier1,
    // Plan-aware file-format guidance: honest degrade when the account
    // can't produce a requested format (free → can't generate files;
    // basic → office formats fall back to md/csv). Covers the free
    // path too, where create_file isn't even exposed.
    fileFormatGuidance: buildFileFormatGuidance(opts.createFileFormats ?? []),
  });

  type MsgParam = Anthropic.Beta.BetaMessageParam;
  type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

  // Phase 10 Tier 3: attachments slot in between the intent text and
  // the initial screenshot. Order matters — the model reads the
  // intent first, then the file context, then "here's the browser
  // state" — that progression mirrors how a human would brief a
  // colleague ("here's what I want, here's the data, here's where
  // we are right now"). Empty attachments array no-ops cleanly.
  //
  // Phase 13 Dim 5: memory preamble lands AFTER the intent + a blank
  // line, so the agent reads it as supplementary context rather than
  // part of the user request. Empty preamble no-ops.
  // Phase 14: playbook context lands AFTER the memory preamble (so
  // user-specific memories take precedence) and BEFORE attachments.
  const intentParts: string[] = [opts.intent];
  // Plan-aware file-format directive — when the user explicitly asks for a
  // format this account can't produce (e.g. PDF/DOCX on basic), a forceful
  // directive sits right next to the intent (far higher attention than the
  // trailing system guidance) so the model degrades to a real create_file
  // call instead of hallucinating "PDF 已生成 (reportlab)". No-ops when the
  // requested format is available or none is named.
  const fileFormatDirective = buildUnavailableFormatDirective(
    opts.intent,
    opts.createFileFormats ?? [],
  );
  if (fileFormatDirective) {
    intentParts.push(fileFormatDirective);
  }
  if (opts.memoryPreamble && opts.memoryPreamble.trim().length > 0) {
    intentParts.push(opts.memoryPreamble);
  }
  if (opts.playbookContext && opts.playbookContext.trim().length > 0) {
    intentParts.push(opts.playbookContext);
  }
  const intentBlock = intentParts.join('\n\n');
  const initialContent: ContentBlockParam[] = [
    { type: 'text', text: intentBlock },
  ];
  if (opts.attachments && opts.attachments.length > 0) {
    initialContent.push(...opts.attachments);
  }
  initialContent.push({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: initialShot.base64,
    },
  });
  const messages: MsgParam[] = [
    {
      role: 'user',
      content: initialContent,
    },
  ];

  const toolsUsed = new Set<string>();
  let iteration = 0;
  // Phase 1 Playbook B2 — monotonic per-action counter (task-internal
  // action sequence). Bumped once per tool_use in the dispatch loop below.
  let actionIndex = 0;
  let cancelled = false;

  // Phase 1 Playbook ④ explorer — LIVE-VETO. When opts.onBeforeAction is wired
  // (explorer only), every live WRITE action calls this BEFORE executing. A veto
  // means the action is NOT executed and the task terminates with a failed outcome
  // (the explorer's hook records the sensitive reason on its side). Default absent →
  // returns null immediately = zero overhead, zero behaviour change for user tasks.
  const vetoOutcome = async (action: {
    kind: 'click' | 'navigate' | 'type';
    label?: string | null;
    ariaLabel?: string | null;
    title?: string | null;
    placeholder?: string | null;
    name?: string | null;
    inputType?: string | null;
    url?: string | null;
    // 预订站加固 — structural signals from the descriptor (login-mode veto consumes them).
    tagName?: string | null;
    pageUrl?: string | null;
    // Layer C trigger signals (captured only when opts.captureLayerCSignals — LAYER_C on).
    pageTitle?: string | null;
    pageTxSignal?: string | null;
  }): Promise<SupercarOutcome | null> => {
    if (!opts.onBeforeAction) return null;
    const verdict = await opts.onBeforeAction(action);
    if (verdict.allowed) return null;
    logger.warn(
      { taskId: opts.taskId, iteration, actionKind: action.kind, reason: verdict.reason },
      'supercar: live action VETOED by onBeforeAction — not executed, task halting',
    );
    return {
      status: 'failed',
      reason: verdict.reason ?? `${action.kind} blocked by safety policy`,
      iterations: iteration,
      toolsUsed: Array.from(toolsUsed),
    };
  };
  // MD5 of the most recent screenshot we showed Claude. Compared after
  // each computer action's fresh shot — identical bytes means the page
  // didn't react to the action (reset on every real change).
  let lastScreenshotHash: string | null = createHash('md5').update(initialShot.base64).digest('hex');
  // Monotonic count of consecutive no-change screenshots. Reset to 0 on
  // any hash change.
  let stuckCount = 0;
  // Once we cross STUCK_EXIT_THRESHOLD we inject a "stop browsing, wrap
  // up" user turn exactly once. This flag prevents re-injecting on every
  // subsequent iteration while Claude finalises.
  let stuckForceFinalised = false;
  // Tracks whether the LAST detected signal is still "in effect" — set
  // on first HIGH-confidence detection, cleared on a turn that has
  // none. Used to avoid re-firing onAntiBotSignal every single turn
  // while the captcha banner sits there, and to fire onAntiBotResolved
  // the moment the page has moved on.
  let activeAntiBotSignal: AntiBotSignal | null = null;
  /** One-shot guard for the Apify fallback path; runs at most once per task. */
  let apifyAttempted = false;
  /** One-shot guard for the Ctrip flight-results extraction hint. Once we
   *  hand the model the page text it stays in history, so we only inject
   *  it the first time we successfully read a Ctrip flight-results page. */
  let ctripFlightHintSent = false;
  // Phase 13 Dim 1 follow-up — local plan-step state. Mutates as
  // markers parse out of the model's text. Caller seeded it from
  // tasks.plan_status; we copy to avoid mutating the caller's
  // reference.
  type PlanStepLocal = {
    idx: number;
    status: 'pending' | 'running' | 'done' | 'failed';
    note?: string;
  };
  const currentPlanSteps: PlanStepLocal[] = (opts.planSteps ?? []).map((s) => ({ ...s }));
  const planTrackerEnabled = currentPlanSteps.length > 0 && opts.planText != null;

  // P1 — converge plan on terminal success. The model isn't
  // disciplined about emitting a final `[STEP N done]` for every
  // bullet, and the handoff_to_generate path skips the supercar
  // marker scanner entirely. Without convergence, a successful run
  // can leave the PlanCard reading "0/5 完成" forever — the worst
  // possible signal to a user who just got a complete answer.
  // Rule: any pending/running step rolls to done; existing done /
  // failed are left alone (don't overwrite real signal). Only fired
  // on completed / handoff_to_generate paths — failure leaves the
  // plan as-is so the user can see how far the loop got.
  const convergePlanOnSuccess = (): void => {
    if (!planTrackerEnabled) return;
    let mutated = false;
    for (const step of currentPlanSteps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'done';
        mutated = true;
      }
    }
    if (mutated) {
      const snapshot = currentPlanSteps.map((s) => ({ ...s }));
      void Promise.resolve(opts.onPlanStepUpdate?.(snapshot));
    }
  };
  // Captured from the first response that materialised a server-side
  // code_execution sandbox (Sonnet 4.6 + computer-use-2025-11-24 beta
  // auto-enables this). Re-passed on every subsequent messages.create
  // so the replayed server_tool_use + *_tool_result blocks stay valid.
  // See the block in the loop where we set it from response.container.
  let containerId: string | null = null;

  // Install the per-task handle so `supercarReply` / `supercarAbort`
  // can find us later.
  const handle: RunHandle = {
    resolveReply: null,
    handoffMessage: null,
    originalIntent: opts.intent,
    pendingAttachmentBlocks: null,
    abort: () => {
      cancelled = true;
      if (handle.resolveReply) {
        // If we're parked on awaiting_user, wake the promise with a
        // sentinel the loop will recognise as abort.
        const r = handle.resolveReply;
        handle.resolveReply = null;
        r('__SUPERCAR_ABORT__');
      }
    },
  };
  handles.set(opts.taskId, handle);

  const parkForAuthWall = async (
    kind: 'login' | 'captcha' | 'permission',
    url: string | null,
  ): Promise<SupercarOutcome | null> => {
    const question = buildAuthParkQuestion(kind, url);
    await safeCall(opts.onAwaitingUser, {
      question,
      at: new Date(),
      currentUrl: url,
      awaitingKind: kind,
    });
    let waitTimer: NodeJS.Timeout | null = null;
    const replyPromise = new Promise<string>((resolve) => {
      handle.resolveReply = resolve;
    });
    const timeoutPromise = new Promise<string>((resolve) => {
      waitTimer = setTimeout(
        () => resolve('__SUPERCAR_AWAITING_TIMEOUT__'),
        AWAITING_USER_TIMEOUT_TAKEOVER_MS,
      );
    });
    const replyOrAbort = await Promise.race([replyPromise, timeoutPromise]);
    if (waitTimer) clearTimeout(waitTimer);
    handle.resolveReply = null;
    if (handle.handoffMessage !== null) {
      const handoffMsg = handle.handoffMessage;
      handle.handoffMessage = null;
      convergePlanOnSuccess();
      return {
        status: 'handoff_to_generate',
        question: handoffMsg,
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    if (replyOrAbort === '__SUPERCAR_ABORT__' || cancelled) {
      return {
        status: 'cancelled',
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    if (replyOrAbort === '__SUPERCAR_AWAITING_TIMEOUT__') {
      return {
        status: 'awaiting_user',
        question,
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    if (Date.now() >= deadline) {
      return {
        status: 'timeout',
        reason: 'task timeout elapsed while waiting for user reply',
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    if (
      handle.pendingAttachmentBlocks &&
      handle.pendingAttachmentBlocks.length > 0
    ) {
      const blocks = handle.pendingAttachmentBlocks;
      handle.pendingAttachmentBlocks = null;
      messages.push({
        role: 'user',
        content: [
          ...(blocks as unknown as ContentBlockParam[]),
          { type: 'text', text: replyOrAbort },
        ],
      });
    } else {
      messages.push({ role: 'user', content: replyOrAbort });
    }
    return null;
  };

  try {
    while (iteration < maxIterations && Date.now() < deadline && !cancelled) {
      iteration++;

      // Phase 13 Dim 6 — per-iteration timer for stats. Wall time
      // from the top of the iteration to the messages.push at the
      // bottom; covers the API call, tool dispatch, screenshot,
      // anti-bot detection, the full round-trip the model
      // experienced this iteration. Used by onStatsRecord below.
      const iterationStart = Date.now();
      const apiStart = Date.now();
      let response: Anthropic.Beta.BetaMessage;
      // Phase 10 follow-up: bound each API call at 120s and retry
      // once on timeout. Without this, a stalled Anthropic backend
      // can leave the task in 'executing' indefinitely (the outer
      // SUPERCAR_TIMEOUT_MS deadline only fires between iterations,
      // never during an in-flight await).
      const API_TIMEOUT_MS = 120_000;
      try {
        // Phase 10 Tier 1 betas: server-side compaction + advisory
        // task budgets. Each is appended only when the master flag is
        // on; the legacy path stays on COMPUTER_USE_BETA alone.
        const betas: string[] = [COMPUTER_USE_BETA];
        if (tier1) {
          betas.push('compact-2026-01-12', 'task-budgets-2026-03-13');
        }

        // output_config carries effort + task_budget. `effort` is GA
        // on both Opus and Sonnet 4.6; `task_budget` is the moving
        // target — the Anthropic API now returns 400 "model does not
        // support user-configurable task budgets" for all Sonnet
        // 4.6 calls, regardless of effort. The beta is currently
        // Opus-tier-only. Restrict the field accordingly so Sonnet
        // calls don't 400 on us; Opus 4.7 still gets the budget hint.
        // `xhigh` is Opus-4.7-only — selectModelAndEffort guards
        // that, so the safer key here is the model id itself.
        const supportsTaskBudget = model === 'claude-opus-4-7';
        const outputConfig: Record<string, unknown> | null = tier1
          ? {
              effort,
              ...(taskBudget !== null && supportsTaskBudget
                ? { task_budget: { type: 'tokens', total: taskBudget } }
                : {}),
            }
          : null;

        // Tool whitelist: filter the inline beta tool array by the
        // task type's registry. Today supercar always runs hybrid
        // (browser + web_search), so every tool below survives — but
        // when the registry adds new task types, the filter will
        // gate accordingly. BANNED_TOOLS (bash, shell, ...) can never
        // reach the model regardless of how the array was assembled.
        const supercarTaskType = classifyTaskType(opts.intent);
        const buildApiCall = () => client.beta.messages.create({
          model,
          max_tokens: maxTokens,
          // Top-level cache_control auto-places the breakpoint on the
          // last cacheable block (system here). Saves us hand-rolling
          // breakpoint placement and matches Anthropic's recommended
          // shape — see shared/prompt-caching.md.
          cache_control: { type: 'ephemeral' },
          system: [
            {
              type: 'text',
              text: systemPrompt,
            },
          ],
          messages,
          tools: filterTools([
            {
              type: 'computer_20251124',
              name: 'computer',
              display_width_px: displayWidth,
              display_height_px: displayHeight,
              enable_zoom: true,
            },
            {
              type: 'web_search_20260209',
              name: 'web_search',
            },
            // Custom `navigate` tool. The sole way to change the page's
            // URL in this environment — `page.screenshot()` captures
            // only the viewport, not the Chrome UI chrome, so Claude
            // can't see (or click) the address bar. Without this,
            // every task starts on about:blank and stays there.
            //
            // Phase 1-6 "browser" wins were all Claude silently routing
            // around this missing capability by spawning Python +
            // Playwright inside the server-side code_execution sandbox.
            // The computer tool itself never successfully drove a
            // page.goto. Adding this tool makes the browser path
            // actually work.
            {
              type: 'custom',
              name: 'navigate',
              description:
                '跳转浏览器标签到指定 URL。**本环境不显示地址栏，这是唯一的导航方式** —— 不要尝试用 key "ctrl+l" + type 的组合。返回跳转后的页面截图。',
              input_schema: {
                type: 'object',
                properties: {
                  url: {
                    type: 'string',
                    description: '完整 URL（包含 https://）。示例：https://m.jd.com/search?keyword=airpods',
                  },
                },
                required: ['url'],
              },
            },
            // Phase 10 Tier 3 — create_file. Only injected when the
            // caller's plan whitelist is non-empty. The format enum is
            // narrowed per-plan (Basic gets text-shaped formats only;
            // Pro gets all). Server-side check below also re-validates,
            // so a model that hallucinates 'xlsx' on Basic still fails
            // safely instead of producing a paid-tier file.
            // Phase 3 R3 — save_page_as_pdf. Renders the CURRENT
            // browser page to PDF via CDP Page.printToPDF (Playwright
            // exposes this as page.pdf()). 24h downloadable link.
            // Different from create_file which generates from text;
            // this captures whatever the user is looking at right
            // now (post-navigation, post-render).
            ...(opts.onSavePageAsPdf
              ? [
                  {
                    type: 'custom' as const,
                    name: 'save_page_as_pdf',
                    description:
                      '把当前浏览器页面（你现在看到的这一页）保存为 PDF，返回 24 小时有效的下载链接。**适用场景**：用户明确要求保存当前页为 PDF / 导出报告 / 存档。这工具捕获的是当前 DOM 渲染后的页面，跟 create_file 不一样（那个是从纯文本生成新文档）。',
                    input_schema: {
                      type: 'object',
                      properties: {
                        filename: {
                          type: 'string',
                          description: '可选：自定义文件名（不含路径）。默认 page-<taskId>.pdf。',
                        },
                      },
                      required: [],
                    },
                  },
                ]
              : []),
            ...(opts.createFileFormats && opts.createFileFormats.length > 0
              ? [
                  {
                    type: 'custom' as const,
                    name: 'create_file',
                    description: buildCreateFileToolDescription(opts.createFileFormats),
                    input_schema: {
                      type: 'object',
                      properties: {
                        filename: {
                          type: 'string',
                          description: '含扩展名的文件名，例如 sales-report.xlsx',
                        },
                        format: {
                          type: 'string',
                          enum: [...opts.createFileFormats],
                          description:
                            '文件格式。csv/txt/md/json 直接传文本；xlsx 传 JSON（数组的数组、对象数组、或 {sheetName: rows} 字典）；pdf/docx 传纯文本或 Markdown 风格段落；pptx 传 {"slides":[{"title":"...","bullets":["..."]}]}',
                        },
                        content: {
                          type: 'string',
                          description: '文件内容。结构按 format 描述。',
                        },
                      },
                      required: ['filename', 'format', 'content'],
                    },
                  },
                ]
              : []),
            // Phase 23 Step 3 / Phase 24 RC follow-up — escape-hatch
            // tools backed by Firecrawl (preferred when configured)
            // OR Apify (fallback). Exposed only when AT LEAST ONE
            // adapter is wired. The model sees these tools as a
            // Tier-3 fallback after browser attempts + search
            // engines fail; the descriptions tell the model to
            // RETURN to the browser afterwards to present results,
            // not just emit text.
            ...(opts.firecrawl || opts.apifyAdapter
              ? [
                  {
                    type: 'custom' as const,
                    name: 'scrape_website',
                    description:
                      '后台抓取网页内容（不经过当前浏览器标签）。**适用场景**：当浏览器无法加载目标网站、被反爬拦截、或加载超时（已经尝试过 navigate + 重试无效）时使用。**关键约束**：拿到数据后，你**必须**回到浏览器继续完成任务的后续步骤——比如打开一个能展示这些数据的页面（Google Sheets 等）、在当前页做对比、或导航到具体链接做进一步操作。**不要**把抓取到的纯文字直接当作最终回复——那会让用户看不到执行过程。返回页面文本（截断到 ~30KB）。',
                    input_schema: {
                      type: 'object',
                      properties: {
                        url: {
                          type: 'string',
                          description: '完整 URL（含 https://）。例：https://www.example.com/article',
                        },
                        extractionPrompt: {
                          type: 'string',
                          description:
                            '可选：告诉 scraper 重点提取什么（默认抓取主要正文）。例："产品名、价格、评分"',
                        },
                      },
                      required: ['url'],
                    },
                  },
                  {
                    type: 'custom' as const,
                    name: 'search_ecommerce',
                    description:
                      '搜索主流电商平台的商品（amazon / 京东 / 淘宝），后台调用 platform-specific scraper。**适用场景**：用户要查商品/比价时，浏览器路径被反爬阻止；或者搜索引擎给不出商品级别的结构化数据。**关键约束**：拿到 JSON 列表后，你**必须**回到浏览器中整理和呈现结果——比如打开第一个商品详情页让用户看，或在当前页面做对比表格。返回 { name, price, rating, url } 的 JSON 数组。',
                    input_schema: {
                      type: 'object',
                      properties: {
                        platform: {
                          type: 'string',
                          enum: ['amazon', 'jd', 'taobao'],
                          description: '电商平台',
                        },
                        query: {
                          type: 'string',
                          description: '搜索关键词，例如 "mechanical keyboard"',
                        },
                        maxResults: {
                          type: 'number',
                          description: '最多返回的商品条数。默认 10，上限 30。',
                        },
                      },
                      required: ['platform', 'query'],
                    },
                  },
                ]
              : []),
          ], supercarTaskType) as Anthropic.Beta.BetaToolUnion[],
          betas,
          thinking: { type: 'adaptive' },
          // Phase 10 Tier 1: opt into server-side compaction so long
          // research tasks don't blow past the context window. The
          // API returns compaction blocks in `response.content`; we
          // already append the full content array (line 666 below)
          // so they round-trip back on the next turn automatically.
          ...(tier1
            ? {
                context_management: {
                  edits: [{ type: 'compact_20260112' as const }],
                },
              }
            : {}),
          ...(outputConfig ? { output_config: outputConfig } : {}),
          // Pin the same sandbox container across turns when the model
          // used code_execution on a prior turn; null on the first call.
          ...(containerId ? { container: containerId } : {}),
        });

        try {
          response = await callWithTimeout(buildApiCall(), API_TIMEOUT_MS, `iter ${iteration} api`);
        } catch (firstErr) {
          if (!(firstErr instanceof IterationTimeoutError)) throw firstErr;
          logger.warn(
            { taskId: opts.taskId, iteration, apiTimeoutMs: API_TIMEOUT_MS },
            'supercar: api call timed out, retrying once',
          );
          // Reissue the same args. Anthropic API is stateless from our
          // side; a retry restarts the model from scratch with the
          // identical messages history.
          response = await callWithTimeout(buildApiCall(), API_TIMEOUT_MS, `iter ${iteration} api retry`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = err instanceof IterationTimeoutError;
        logger.error(
          { taskId: opts.taskId, iteration, err: message, isTimeout },
          isTimeout
            ? 'supercar: api call timed out twice — failing task'
            : 'supercar: messages.create threw',
        );
        // User-facing reason goes through translateError so technical
        // strings ("Anthropic API error: 400 invalid_request_error",
        // "ETIMEDOUT") never reach the SSE stream / task summary.
        // Original message is preserved in the logger.error above for
        // ops debugging.
        const friendly = isTimeout
          ? '请求处理时间过长，正在重试。'
          : translateError(message, opts.intent);
        return {
          status: 'failed',
          reason: friendly,
          iterations: iteration,
          toolsUsed: Array.from(toolsUsed),
        };
      }
      const apiLatencyMs = Date.now() - apiStart;

      // Phase 10 Tier 1 verification: log per-call usage so we can
      // confirm the prompt cache + compaction features are actually
      // firing (cache_read_input_tokens > 0 on the second turn of the
      // same task = caching works; cache_creation_input_tokens > 0 on
      // the first turn = breakpoint placed correctly).
      const toolUseCount = response.content.filter((b) => b.type === 'tool_use').length;
      const textBlockCount = response.content.filter((b) => b.type === 'text').length;
      logger.info(
        {
          taskId: opts.taskId,
          iteration,
          model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
          apiLatencyMs,
          // stop_reason + block counts let us tell at a glance why the
          // loop will exit / continue. Critical for diagnosing the
          // 'model wrote a complete answer but loop hung' class of bug.
          stopReason: response.stop_reason,
          toolUseCount,
          textBlockCount,
        },
        'supercar: api usage',
      );

      // Phase 1 Playbook ④ prerequisite — record this turn's spend to
      // `llm_calls`. This loop builds its own Anthropic client, so (unlike
      // the vision-loop commander) it was never wired to the recorder →
      // browse tasks showed $0. Reuses the shared recorder + estimateCostUsd
      // pricing (no hard-coded prices). FIRE-AND-FORGET: not awaited, the
      // `.catch` swallows everything — a billing-write failure must never
      // block or break the browse loop (same discipline as the B-series
      // captures). Recorded on the SUCCESS path only (the API-failure branch
      // above returns before here), once per iteration, so no double-count.
      if (opts.recorder && opts.userExternalId) {
        const usage = response.usage;
        void opts.recorder
          .record({
            userExternalId: opts.userExternalId,
            taskExternalId: opts.taskId,
            provider: 'anthropic',
            model,
            purpose: 'supercar.turn',
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
            latencyMs: apiLatencyMs,
            status: 'ok',
          })
          .catch(() => {
            /* fire-and-forget: a billing-write failure never breaks browsing */
          });
      }

      // Append the full assistant content — NEVER just the text, and
      // NEVER a filtered subset. The Anthropic API validates thinking-
      // block signatures against the exact content structure of the
      // original turn; dropping even one sibling block breaks the
      // signature and the next call 400s with "thinking blocks cannot
      // be modified".
      //
      // Phase 24 fix #3 — Anthropic occasionally returns a
      // `server_tool_use` (typically `code_execution` under
      // computer-use-2025-11-24) without its paired `*_tool_result`
      // block. Echoing that orphan triggers a 400 on the NEXT
      // messages.create. patchOrphanServerToolUses INSERTS (never
      // drops) a synthetic `*_tool_result_error` block right after
      // each orphan — preserving the surrounding order so thinking
      // signatures stay valid.
      const { patched: assistantContent, orphansFixed } =
        patchOrphanServerToolUses(response.content);
      if (orphansFixed.length > 0) {
        logger.warn(
          { taskId: opts.taskId, iteration, orphansFixed },
          'supercar: patched orphaned server_tool_use blocks (synthetic *_tool_result_error inserted)',
        );
      }
      messages.push({ role: 'assistant', content: assistantContent });

      // Phase 13 Dim 1 follow-up — scan response text blocks for
      // `[STEP N status]` markers the planner reminder asked for.
      // Markers are 1-based externally (匹配 plan 文本里的序号);
      // currentPlanSteps is 0-indexed, so subtract 1 on apply.
      // Multiple markers in one turn are honoured in order.
      if (planTrackerEnabled) {
        let mutated = false;
        for (const block of response.content) {
          if (block.type !== 'text' || !block.text) continue;
          const matches = block.text.matchAll(
            /\[STEP\s+(\d+)\s+(done|running|failed|pending)\]/gi,
          );
          for (const m of matches) {
            const oneBased = Number.parseInt(m[1] ?? '0', 10);
            const status = (m[2] ?? '').toLowerCase() as PlanStepLocal['status'];
            const idx = oneBased - 1;
            if (idx < 0 || idx >= currentPlanSteps.length) continue;
            const target = currentPlanSteps[idx]!;
            if (target.status === status) continue;
            target.status = status;
            mutated = true;
          }
        }
        if (mutated) {
          // Snapshot the array for the callback so the caller
          // can mutate without races against the next turn.
          const snapshot = currentPlanSteps.map((s) => ({ ...s }));
          void Promise.resolve(opts.onPlanStepUpdate?.(snapshot));
        }
      }

      // Bug: Sonnet 4.6 under computer-use-2025-11-24 implicitly enables
      // server-side code_execution alongside web_search. The first call
      // creates a sandbox container; the response carries `container.id`.
      // Every follow-up messages.create that replays server_tool_use
      // blocks from a prior turn MUST also pass `container` pointing at
      // that id — otherwise the API rejects with 400 "container_id is
      // required when there are pending tool uses generated by code
      // execution with tools." Capture it here so the next iteration's
      // create call can re-pin it.
      if (response.container?.id) {
        containerId = response.container.id;
      }

      // Extract surface info from this turn.
      const toolsInTurn: string[] = [];
      let textPreamble = '';
      const toolUseBlocks: Anthropic.Beta.BetaToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'thinking') {
          const thinking = (block as { thinking?: string }).thinking;
          if (thinking) await safeCall(opts.onThinking, thinking);
        } else if (block.type === 'text') {
          textPreamble += (textPreamble ? '\n' : '') + block.text;
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
          toolsInTurn.push(block.name);
          toolsUsed.add(block.name);
        } else if (block.type === 'server_tool_use') {
          const serverUse = block as Anthropic.Beta.BetaServerToolUseBlock;
          toolsInTurn.push(serverUse.name);
          toolsUsed.add(serverUse.name);
          if (serverUse.name === 'web_search') {
            const query = (serverUse.input as { query?: string } | null)?.query ?? '';
            // Extract sources from the matching web_search_tool_result
            // block in the SAME response.content array — Anthropic
            // emits them paired (server_tool_use → web_search_tool_result).
            const sources = extractWebSearchSources(response.content, serverUse.id);
            await safeCall(opts.onWebSearch, { iteration, query, sources });
          }
        }
      }

      await safeCall(opts.onTick, {
        iteration,
        toolsInTurn,
        textPreamble,
        apiLatencyMs,
      });

      // If the model didn't invoke any client-side tool, the turn is
      // finished. Decide between completed / awaiting_user.
      if (toolUseBlocks.length === 0) {
        // Phase 13 Dim 1 follow-up — strip plan-tracker markers from
        // the user-visible summary. The parser above has already
        // consumed them into planStatus updates; leaving them in
        // the rendered text shows users `[STEP 1 done]` lines that
        // mean nothing to them.
        const finalText = textPreamble
          .replace(/\[STEP\s+\d+\s+(?:done|running|failed|pending)\]\s*\n*/gi, '')
          .trim();
        // Phase 1 follow-up — deterministic login-page detection.
        // The model is right ~80-90% on login walls; the remaining
        // cases either silently treat the login page as the answer
        // ("here's the URL I reached") or burn iterations trying to
        // bypass. Probe the live page URL up front and short-circuit
        // to a forced park when a login pattern matches, regardless
        // of whether the LLM emitted [AWAITING_USER_INPUT].
        let preParkUrl: string | null = null;
        try {
          const livePage = (await executor.getPage()) as unknown as {
            url?: () => string;
          };
          const u = livePage?.url?.();
          if (typeof u === 'string' && u && u !== 'about:blank') {
            preParkUrl = u;
          }
        } catch {
          /* swallow — best-effort URL snapshot */
        }
        // Phase 3 R1 — extend the deterministic auth probe from
        // login-only to login | captcha | permission. Probe in
        // priority order: permission first (a 403/paywall is the
        // strongest signal — cleanly distinguishable), then captcha
        // (page hasn't returned content yet, user must solve a
        // puzzle), then login (default takeover). Page title is
        // pulled cheaply if available so captcha / permission text
        // detection works on pages whose URL doesn't say /captcha.
        let preParkTitle: string | null = null;
        let preParkBodyText: string | null = null;
        try {
          const livePage = (await executor.getPage()) as unknown as {
            title?: () => Promise<string> | string;
            evaluate?: (
              fn: () => string,
            ) => Promise<string> | string;
          };
          const t = livePage?.title?.();
          if (t) preParkTitle = (typeof t === 'string' ? t : await t) ?? null;
          // Phase 3 R1 fix — pull a body text sample so the detector
          // can see Chromium's 403 / paywall / captcha pages even when
          // the URL is `chrome-error://chromewebdata/` (Chromium swaps
          // to its internal error page on HTTP 403, hiding the original
          // URL). Cap at 1KB to keep the keyword scan cheap; that's
          // enough for "Access denied" / "HTTP ERROR 403" / "Forbidden"
          // / "需要登录" headers without dragging in article body.
          if (typeof livePage?.evaluate === 'function') {
            // Function runs in the browser context (Node TypeScript
            // doesn't see `document` here). Cast through unknown to
            // express that the lambda is opaque to the orchestrator.
            const evalFn = (() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const doc: any = (globalThis as any).document;
              return (doc?.body?.innerText ?? '').slice(0, 1024);
            }) as unknown as () => string;
            const raw = await livePage.evaluate(evalFn);
            preParkBodyText = typeof raw === 'string' ? raw : null;
          }
        } catch {
          /* swallow — best-effort title + body snapshot */
        }
        // Priority: URL is the strongest signal. Sites pin their auth
        // endpoints to canonical paths (/login, /signin, /captcha,
        // /403). Body text is incidental — a login page commonly has
        // the word "验证码" because it shows a captcha widget INSIDE
        // the login form, but the page is still primarily a login
        // wall. Probe URL first across all three kinds; fall back to
        // title + body only when URL gives no signal.
        const permissionUrlSignal = detectPermissionWall({
          url: preParkUrl,
          title: null,
          prominentText: null,
        });
        const captchaUrlSignal = detectCaptchaPage({
          url: preParkUrl,
          title: null,
          prominentText: null,
        });
        const loginUrlSignal = detectLoginUrl(preParkUrl);
        let forcedAuthKind: 'login' | 'captcha' | 'permission' | null = null;
        if (permissionUrlSignal.matched) forcedAuthKind = 'permission';
        else if (captchaUrlSignal.matched) forcedAuthKind = 'captcha';
        else if (loginUrlSignal.matched) forcedAuthKind = 'login';
        // Phase 3 R2 — site-specific URL path augmentation. If the
        // landed URL matches a registered site config, extend the
        // login URL probe with that site's loginUrlPaths (e.g.
        // douyin-compass adds /passport, /account/login). Cheap to
        // do here even when the global URL probe already hit.
        const siteConfig = matchSiteConfig(preParkUrl);
        if (forcedAuthKind === null && siteConfig?.auth?.loginUrlPaths && preParkUrl) {
          try {
            const path = new URL(preParkUrl).pathname.toLowerCase();
            for (const needle of siteConfig.auth.loginUrlPaths) {
              if (path.includes(needle.toLowerCase())) {
                forcedAuthKind = 'login';
                break;
              }
            }
          } catch {
            /* swallow — bad URL shape */
          }
        }
        if (forcedAuthKind === null) {
          // No URL hit → check title + body across all 3 kinds.
          // Order: permission > captcha > login.
          // Permission > captcha because a 403 / paywall is a stronger
          // product signal than a captcha widget. Login last because
          // the LOGIN_BODY_NEEDLES list includes generic words like
          // "登录" / "sign in" that articles or doc pages incidentally
          // mention; we only fall back to login-body when neither URL
          // nor permission/captcha body fired.
          const permissionTextSignal = detectPermissionWall({
            url: null,
            title: preParkTitle,
            prominentText: preParkBodyText,
          });
          const captchaTextSignal = detectCaptchaPage({
            url: null,
            title: preParkTitle,
            prominentText: preParkBodyText,
          });
          // Login body/title detection — covers the
          // compass.jinritemai.com case where the homepage has a "登录"
          // button + login form widgets but the URL is /. The
          // detectLoginPage helper combines URL+title+body in priority
          // order; here we feed only title+body since URL was already
          // tried above and didn't hit.
          let loginTextHit = detectLoginPage({
            url: null,
            title: preParkTitle,
            prominentText: preParkBodyText,
          }).matched;
          // Phase 3 R2 — site-specific body phrase augmentation.
          // Each site can add a few high-precision phrases the global
          // strict needles wouldn't catch (e.g. xiaohongshu's
          // "登录解锁更多内容", taobao's "亲，请登录"). Only checked when
          // the global login body probe missed AND the site config
          // matched — keeps the false-positive risk low.
          if (
            !loginTextHit &&
            siteConfig?.auth?.loginBodyPhrases &&
            preParkBodyText
          ) {
            const lower = preParkBodyText.toLowerCase();
            for (const phrase of siteConfig.auth.loginBodyPhrases) {
              if (lower.includes(phrase.toLowerCase())) {
                loginTextHit = true;
                break;
              }
            }
          }
          if (permissionTextSignal.matched) forcedAuthKind = 'permission';
          else if (captchaTextSignal.matched) forcedAuthKind = 'captcha';
          else if (loginTextHit) forcedAuthKind = 'login';
        }
        const forcedAuthPark = forcedAuthKind !== null;
        if (forcedAuthPark) {
          const authKind = forcedAuthKind!;
          if (
            shouldUseScraperAfterAuthWall({
              intent: opts.intent,
              kind: authKind,
              hasScraperTools: Boolean(opts.firecrawl || opts.apifyAdapter),
            })
          ) {
            const rescueText = buildAuthWallScraperRescueText({
              intent: opts.intent,
              kind: authKind,
              url: preParkUrl,
            });
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                kind: authKind,
                url: preParkUrl,
              },
              'supercar: auth wall detected on no-tool turn — continuing ecommerce query with scraper tools',
            );
            messages.push({ role: 'user', content: rescueText });
            continue;
          }
        }
        if (forcedAuthPark || looksLikePendingQuestion(finalText)) {
          // Park on a user reply. `supercarReply` resolves the promise;
          // `supercarAbort` rejects with a sentinel we swap to
          // cancelled. Capped at the kind-specific timeout below so a
          // polite-question end of turn (e.g. "需要补充哪部分？" after
          // a complete PRD) doesn't park the task in 'executing'
          // forever — the bug observed on tsk_SFsgUXHMrxgQSpJ5SXTqb.
          //
          // F1 — login / captcha / browser_action need a much longer
          // window than chat clarification. The user is physically in
          // the browser viewport doing 2FA / scanning a QR / filling a
          // captcha, which routinely takes 3-10min. The old uniform
          // 5min cap silently completed real takeover sessions and
          // released the per-task Brave under the user's hands.
          // clarification keeps 5min (and in practice doesn't even
          // reach this path anymore — expert intake routes to generate
          // upstream).
          // P1-A — strip the machine marker before showing the
          // question to the user. Detector consumed it; user
          // shouldn't see "[AWAITING_USER_INPUT]" verbatim.
          //
          // Phase 1 follow-up — when the deterministic login probe
          // forced this park (LLM didn't emit a marker), synthesise
          // a clear Chinese question with the friendly host name
          // instead of feeding the model's "completed-y" text into
          // classifyAwaitingKind (which would land on 'clarification'
          // → 5min timeout → silently complete under the user's hands).
          const visibleQuestion = forcedAuthPark
            ? buildAuthParkQuestion(forcedAuthKind!, preParkUrl)
            : stripAwaitingUserMarker(finalText);
          const parkAwaitingKind: ReturnType<typeof classifyAwaitingKind> =
            forcedAuthPark
              ? (forcedAuthKind as ReturnType<typeof classifyAwaitingKind>)
              : classifyAwaitingKind(visibleQuestion);
          const AWAITING_USER_TIMEOUT_MS =
            parkAwaitingKind === 'clarification'
              ? AWAITING_USER_TIMEOUT_CLARIFICATION_MS
              : AWAITING_USER_TIMEOUT_TAKEOVER_MS;
          // P2 — capture current page URL right before parking so
          // the dispatcher can persist tasks.finalUrl. Survives any
          // screencast disconnect that happens during the pause.
          // Phase 1 follow-up — reuse the URL snapshot taken above
          // for the deterministic login probe. Probing twice in
          // <1ms costs nothing but the value can't have changed in
          // between (no I/O between the two checks).
          const currentParkUrl: string | null = preParkUrl;
          await safeCall(opts.onAwaitingUser, {
            question: visibleQuestion,
            at: new Date(),
            currentUrl: currentParkUrl,
            awaitingKind: parkAwaitingKind,
          });
          let waitTimer: NodeJS.Timeout | null = null;
          const replyPromise = new Promise<string>((resolve) => {
            handle.resolveReply = resolve;
          });
          const timeoutPromise = new Promise<string>((resolve) => {
            waitTimer = setTimeout(
              () => resolve('__SUPERCAR_AWAITING_TIMEOUT__'),
              AWAITING_USER_TIMEOUT_MS,
            );
          });
          const replyOrAbort = await Promise.race([replyPromise, timeoutPromise]);
          if (waitTimer) clearTimeout(waitTimer);
          handle.resolveReply = null;
          // F1 — `supercarHandoffToGenerate` set handle.handoffMessage
          // before resolving the promise. Exit the loop now so the
          // dispatcher can run runGenerateTask with the user's data
          // instead of the supercar continuing to drive the browser.
          // The handoff is detected via the flag (not the message
          // content) because the user's text is also pushed onto the
          // messages array if we DID continue the loop — keeping the
          // exit decision orthogonal to message inspection.
          if (handle.handoffMessage !== null) {
            const handoffMsg = handle.handoffMessage;
            handle.handoffMessage = null;
            // P1 — handoff means the supercar gave up the browser
            // and the dispatcher will run generate to finish. From
            // the user's plan-card perspective every browser-tier
            // step the supercar managed counts as done; the
            // dispatcher converges again after generate completes.
            convergePlanOnSuccess();
            return {
              status: 'handoff_to_generate',
              question: handoffMsg,
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
            };
          }
          if (replyOrAbort === '__SUPERCAR_ABORT__' || cancelled) {
            return {
              status: 'cancelled',
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
            };
          }
          if (replyOrAbort === '__SUPERCAR_AWAITING_TIMEOUT__') {
            if (shouldKeepAwaitingOnUserTimeout(parkAwaitingKind)) {
              logger.info(
                {
                  taskId: opts.taskId,
                  iteration,
                  awaitingMs: AWAITING_USER_TIMEOUT_MS,
                  awaitingKind: parkAwaitingKind,
                },
                'supercar: takeover awaiting-user timed out — keeping task parked',
              );
              return {
                status: 'awaiting_user',
                question: visibleQuestion,
                iterations: iteration,
                toolsUsed: Array.from(toolsUsed),
              };
            }
            // No user reply within the cap. The model already produced
            // a complete answer (the trailing question is courteous,
            // not load-bearing). Surface what we have and let the user
            // submit a follow-up if they really want to extend it.
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                awaitingMs: AWAITING_USER_TIMEOUT_MS,
                finalTextLen: finalText.length,
              },
              'supercar: awaiting-user timed out — completing with available text',
            );
            convergePlanOnSuccess();
            const preReconcile = stripAwaitingUserMarker(finalText);
            const reconciled = await reconcileFinalAnswer(
              preReconcile,
              executor,
              opts.taskId,
            );
            const stepUpdate = buildReconciledStepUpdate(
              preReconcile,
              reconciled.summary,
              iteration,
            );
            return {
              status: 'completed',
              summary: reconciled.summary,
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
              ...(stepUpdate ? { reconciledStepUpdate: stepUpdate } : {}),
            };
          }
          if (Date.now() >= deadline) {
            return {
              status: 'timeout',
              reason: 'task timeout elapsed while waiting for user reply',
              iterations: iteration,
              toolsUsed: Array.from(toolsUsed),
            };
          }
          // F2 — when supercarReply was called with attachmentBlocks,
          // emit a multi-block user message so the model sees the
          // uploads inline with the reply text. Clear pending state
          // after consuming so a subsequent text-only reply doesn't
          // accidentally inherit the prior attachments.
          if (
            handle.pendingAttachmentBlocks &&
            handle.pendingAttachmentBlocks.length > 0
          ) {
            const blocks = handle.pendingAttachmentBlocks;
            handle.pendingAttachmentBlocks = null;
            messages.push({
              role: 'user',
              content: [
                ...(blocks as unknown as ContentBlockParam[]),
                { type: 'text', text: replyOrAbort },
              ],
            });
          } else {
            messages.push({ role: 'user', content: replyOrAbort });
          }
          continue;
        }
        convergePlanOnSuccess();
        const preReconcile = stripAwaitingUserMarker(finalText);
        const reconciled = await reconcileFinalAnswer(
          preReconcile,
          executor,
          opts.taskId,
        );
        const stepUpdate = buildReconciledStepUpdate(
          preReconcile,
          reconciled.summary,
          iteration,
        );
        return {
          status: 'completed',
          summary: reconciled.summary,
          iterations: iteration,
          toolsUsed: Array.from(toolsUsed),
          ...(stepUpdate ? { reconciledStepUpdate: stepUpdate } : {}),
        };
      }

      // Execute every client-side tool call from this turn. web_search
      // is server-side so it never appears in `tool_use`.
      const toolResults: ContentBlockParam[] = [];
      // Track whether ANY computer action in this turn produced a new
      // screenshot. We only update stuckCount once per turn (not once
      // per action), so Claude doesn't get penalised for emitting
      // multiple parallel tool_uses that all observe the same frame.
      let turnChangedScreenshot = false;
      for (const toolUse of toolUseBlocks) {
        actionIndex += 1;
        // -------- Custom `navigate` tool --------
        if (toolUse.name === 'navigate') {
          const navInput = (toolUse.input as { url?: string } | null) ?? {};
          const targetUrl = typeof navInput.url === 'string' ? navInput.url.trim() : '';
          if (!targetUrl) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'navigate tool_use missing required `url` parameter' }],
              is_error: true,
            });
            continue;
          }
          // Basic URL shape guard. We don't want to route chrome://
          // or file:// here; those require separate plumbing.
          if (!/^https?:\/\//i.test(targetUrl)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `navigate: URL must start with http:// or https:// (got ${targetUrl.slice(0, 80)})`,
                },
              ],
              is_error: true,
            });
            continue;
          }
          // Phase 1 Playbook ④ — LIVE-VETO before navigation. Navigation goes
          // via page.goto (not executor.navigate), so this is the ONLY place that
          // covers it. A veto returns before getPage/goto → the page never moves.
          // Call-site guarded so a hook-absent user task pays zero alloc/microtask.
          if (opts.onBeforeAction) {
            const navVeto = await vetoOutcome({ kind: 'navigate', url: targetUrl });
            if (navVeto) return navVeto;
          }
          const navPage = (await executor.getPage()) as unknown as PageLike & {
            goto: (
              url: string,
              opts?: { waitUntil?: string; timeout?: number },
            ) => Promise<unknown>;
          };
          // Phase 3 R4 — capture friendly error message for the
          // failure paths. We still continue to screenshot in case
          // the page has partial content (e.g. SSL warning page,
          // chrome-error page with translated copy), but the
          // friendly message is appended to the tool_result so the
          // model + user see what went wrong in plain language.
          let navErrorFriendly: string | null = null;
          try {
            await navPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch (err) {
            const translated = translateNavError(err);
            navErrorFriendly = translated.friendly;
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                url: targetUrl,
                kind: translated.kind,
                friendly: translated.friendly,
                rawErr: translated.rawMessage,
              },
              'supercar: navigate goto errored (continuing to screenshot)',
            );
          }
          // Phase 1 Playbook B2 — navigate capture: entry_url = landed URL.
          // Best-effort; gated by opts.onAction (ACTION_CAPTURE).
          if (opts.onAction) {
            const landedUrl = navPage.url();
            await safeCall(opts.onAction, {
              actionIndex,
              stepType: 'navigate',
              siteDomain: extractDomainStat(landedUrl),
              visibleText: null,
              targetSelector: null,
              coordinate: null,
              entryUrl: landedUrl,
              inputValue: null,
              framePath: null,
            });
          }
          // Phase 3 R2 — site-config post-nav hook. Match the URL
          // landed on (NOT the requested URL — they can differ on
          // redirect to login wall) and run any registered dismiss
          // patterns. Best-effort; on failure we just continue to
          // the screenshot. Single dismiss pass — most overlays
          // disappear in one click.
          try {
            const landedUrl = navPage.url();
            const cfg = matchSiteConfig(landedUrl);
            if (cfg) {
              const r = await applySiteConfigPostNavigation(
                cfg,
                navPage as unknown as Parameters<typeof applySiteConfigPostNavigation>[1],
              );
              if (r.dismissed.length > 0) {
                logger.info(
                  {
                    taskId: opts.taskId,
                    iteration,
                    siteId: cfg.siteId,
                    dismissed: r.dismissed,
                    url: landedUrl,
                  },
                  'supercar: site-config dismissed popup overlays',
                );
              }
            }
          } catch (err) {
            logger.warn(
              {
                taskId: opts.taskId,
                iteration,
                err: err instanceof Error ? err.message : String(err),
              },
              'supercar: site-config post-nav hook threw (non-fatal)',
            );
          }
          // Phase 3 R4 — blank-page detection + one retry.
          // Conservative (DOM-based; only fires when page has
          // essentially no content / images / inputs / buttons).
          // If blank AND we haven't already noticed a goto error,
          // wait 3s and probe again — sometimes domcontentloaded
          // fires before the SPA bundle mounts. After retry, if
          // still blank: surface the friendly message via the tool
          // result so the agent can tell the user instead of
          // pretending the navigation succeeded.
          let blankCheck = await detectBlankPage(
            navPage as unknown as Parameters<typeof detectBlankPage>[0],
          );
          if (blankCheck.blank && !navErrorFriendly) {
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                url: targetUrl,
                ...blankCheck.diagnostics,
              },
              'supercar: blank page detected after navigate, retrying in 3s',
            );
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            blankCheck = await detectBlankPage(
              navPage as unknown as Parameters<typeof detectBlankPage>[0],
            );
          }
          const navShot = await executor.screenshot(navPage);
          if (navShot.error || !navShot.base64) {
            const failureMsg = navErrorFriendly
              ? `${navErrorFriendly}（截图也失败：${navShot.error ?? '?'}）`
              : `导航失败：截图无法生成（${navShot.error ?? '?'}）`;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: failureMsg }],
              is_error: true,
            });
            continue;
          }
          // If goto errored OR the page is blank after retry, the
          // model needs to know — surface friendly text alongside
          // the (possibly empty) screenshot. The blank-page message
          // wins over a generic "could not connect" because blank
          // is the more actionable signal for the user.
          let extraStatusText: string | null = null;
          if (blankCheck.blank) {
            extraStatusText = navErrorFriendly
              ? `${navErrorFriendly}（页面也未能正常加载）`
              : '页面未能正常加载（DOM 内容为空）。请稍后重试或检查网址。';
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                url: targetUrl,
                ...blankCheck.diagnostics,
              },
              'supercar: blank page after retry, returning friendly error to agent',
            );
          } else if (navErrorFriendly) {
            // Page rendered SOMETHING but goto threw — usually
            // chrome-error page with content, or an SSL warning. The
            // agent should know goto errored so it doesn't pretend
            // the URL loaded normally.
            extraStatusText = navErrorFriendly;
          }
          const navHash = createHash('md5').update(navShot.base64).digest('hex');
          if (lastScreenshotHash !== navHash) {
            turnChangedScreenshot = true;
            lastScreenshotHash = navHash;
          }
          const navUrl = navPage.url();
          await safeCall(opts.onScreencast, {
            iteration,
            imageBase64: navShot.base64,
            url: navUrl,
            viewportWidth: navShot.viewportWidth ?? displayWidth,
            viewportHeight: navShot.viewportHeight ?? displayHeight,
          });
          logger.info(
            { taskId: opts.taskId, iteration, requested: targetUrl, landed: navUrl },
            'supercar: navigate completed',
          );
          const authWall = await probeCurrentAuthWall(executor, navUrl, true);
          if (authWall) {
            if (
              shouldUseScraperAfterAuthWall({
                intent: opts.intent,
                kind: authWall.kind,
                hasScraperTools: Boolean(opts.firecrawl || opts.apifyAdapter),
              })
            ) {
              logger.info(
                {
                  taskId: opts.taskId,
                  iteration,
                  kind: authWall.kind,
                  url: authWall.url,
                },
                'supercar: auth wall detected after navigate — handing ecommerce query back to scraper tools',
              );
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [
                  {
                    type: 'text',
                    text: buildAuthWallScraperRescueText({
                      intent: opts.intent,
                      kind: authWall.kind,
                      url: authWall.url,
                    }),
                  },
                ],
              });
              continue;
            }
            logger.info(
              {
                taskId: opts.taskId,
                iteration,
                kind: authWall.kind,
                url: authWall.url,
              },
              'supercar: auth wall detected immediately after navigate — parking',
            );
            const parkedOutcome = await parkForAuthWall(authWall.kind, authWall.url);
            if (parkedOutcome) return parkedOutcome;
            continue;
          }
          // Phase 3 R4 — when goto errored or the page is blank,
          // lead with the friendly Chinese message instead of the
          // happy "已导航到 X" line. The screenshot still goes
          // through so the model sees what (if anything) rendered.
          //
          // DELIBERATELY no is_error=true: setting that on the
          // tool_result was causing the Anthropic API to return
          // invalid_request_error (translated as "服务暂时繁忙") and
          // the supercar's give-up path firing. Without is_error,
          // the model reads the friendly text + screenshot, decides
          // whether to retry or report the failure to the user, and
          // produces a sensible final summary on its own. P3_AUTH_004
          // (httpbin.org/status/403) also stays awaiting_user
          // because the auth detector runs on the model's no-tool
          // turn, not the navigate tool turn.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'text',
                text: extraStatusText ?? `已导航到 ${navUrl}`,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: navShot.base64,
                },
              },
            ],
          });
          continue;
        }

        // -------- Custom `save_page_as_pdf` tool (Phase 3 R3 L2) --------
        if (toolUse.name === 'save_page_as_pdf') {
          if (!opts.onSavePageAsPdf) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'save_page_as_pdf: 当前会话未启用 PDF 保存' }],
              is_error: true,
            });
            continue;
          }
          const inp = (toolUse.input as { filename?: string } | null) ?? {};
          const filenameOpt = typeof inp.filename === 'string' ? inp.filename.trim() : '';
          const filename = filenameOpt || `page-${opts.taskId}.pdf`;
          try {
            // Render current page → PDF via Playwright's page.pdf().
            // Chromium-only; Brave shares Chromium under the hood so
            // this works. Default page.pdf() options give A4
            // portrait; sufficient for the L2 use case.
            const pdfPage = (await executor.getPage()) as unknown as {
              pdf?: (opts?: Record<string, unknown>) => Promise<Buffer>;
            };
            if (typeof pdfPage.pdf !== 'function') {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [
                  {
                    type: 'text',
                    text: 'save_page_as_pdf: 当前浏览器执行器不支持 PDF 渲染（需要 Playwright/Chromium）',
                  },
                ],
                is_error: true,
              });
              continue;
            }
            const pdfBuffer = await pdfPage.pdf({
              printBackground: true,
              format: 'A4',
            });
            const result = await opts.onSavePageAsPdf({ filename, pdfBuffer });
            if ('error' in result) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [{ type: 'text', text: `save_page_as_pdf: ${result.error}` }],
                is_error: true,
              });
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [
                  {
                    type: 'text',
                    text:
                      `已把当前页面保存为 PDF。文件名：${result.filename}。` +
                      `大小：${(result.sizeBytes / 1024).toFixed(1)} KB。` +
                      `下载链接：${result.downloadUrl}（24 小时有效）。`,
                  },
                ],
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(
              { taskId: opts.taskId, err: msg },
              'supercar: save_page_as_pdf threw',
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: `save_page_as_pdf: ${msg}` }],
              is_error: true,
            });
          }
          toolsUsed.add('save_page_as_pdf');
          continue;
        }

        // -------- Custom `create_file` tool (Phase 10 Tier 3) --------
        if (toolUse.name === 'create_file') {
          const inp = (toolUse.input as {
            filename?: string;
            format?: string;
            content?: string;
          } | null) ?? {};
          const filename = typeof inp.filename === 'string' ? inp.filename.trim() : '';
          const format = typeof inp.format === 'string' ? inp.format.trim() : '';
          const content = typeof inp.content === 'string' ? inp.content : '';
          if (!filename || !format) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'create_file: filename and format are required' }],
              is_error: true,
            });
            continue;
          }
          // Server-side plan defence — even though the schema enum
          // only listed allowed formats, a model can sometimes invent
          // values. Reject anything outside the per-plan whitelist
          // with a concrete error the model can recover from.
          const allowed = opts.createFileFormats ?? [];
          if (!allowed.includes(format)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `create_file: 当前套餐不支持 ${format} 格式（可用：${allowed.join(', ') || '无'}）`,
                },
              ],
              is_error: true,
            });
            continue;
          }
          if (!opts.onCreateFile) {
            // Caller hasn't wired the persistence callback. Tell the
            // model to skip and ask the user to enable file output.
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'create_file: 当前会话未启用文件生成，请把内容直接写在回复里' }],
              is_error: true,
            });
            continue;
          }
          try {
            const result = await opts.onCreateFile({ filename, format, content });
            if ('error' in result) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [{ type: 'text', text: `create_file: ${result.error}` }],
                is_error: true,
              });
              continue;
            }
            toolsUsed.add('create_file');
            // Tell the model the file was created. The download URL +
            // file id round-trip back to the SPA via the task summary
            // — agent-loop.ts doesn't render the card itself; instead
            // a clear "[文件已生成]" line plus the JSON shape lets
            // ReactMarkdown extract a download chip via a custom
            // `code` renderer. Future polish: persist this on the task
            // row directly instead of relying on text scraping.
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text:
                    `已生成文件 ${result.filename}（${formatBytesAgent(result.size)}）。\n` +
                    '在最终回复里附上一行（保留代码块）让用户能下载：\n' +
                    '```holaday-file\n' +
                    JSON.stringify(
                      {
                        fileId: result.fileId,
                        filename: result.filename,
                        size: result.size,
                        downloadUrl: result.downloadUrl,
                      },
                      null,
                      2,
                    ) +
                    '\n```',
                },
              ],
            });
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `create_file: 写文件失败：${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              is_error: true,
            });
          }
          continue;
        }

        // -------- `scrape_website` — Firecrawl-preferred, Apify fallback --------
        if (toolUse.name === 'scrape_website') {
          if (!opts.firecrawl && !opts.apifyAdapter) {
            // Defensive — the tool was exposed only when at least
            // one adapter is wired, but guard against a config-
            // reload race.
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: 'scrape_website: no scraper adapter configured (FIRECRAWL_API_KEY / APIFY_API_TOKEN both missing)',
                },
              ],
              is_error: true,
            });
            continue;
          }
          const inp = (toolUse.input as {
            url?: string;
            extractionPrompt?: string;
          } | null) ?? {};
          const url = typeof inp.url === 'string' ? inp.url.trim() : '';
          if (!url || !/^https?:\/\//i.test(url)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'scrape_website: url must be http(s) URL' }],
              is_error: true,
            });
            continue;
          }
          logger.info(
            {
              taskId: opts.taskId,
              iteration,
              url,
              backend: opts.firecrawl ? 'firecrawl' : 'apify',
            },
            'supercar: scrape_website invoked',
          );
          try {
            // Phase 24 RC follow-up — Firecrawl is the preferred
            // backend (cheaper, returns markdown directly). Apify
            // stays as a fallback for older deployments where the
            // Firecrawl key isn't yet provisioned.
            if (opts.firecrawl) {
              const r = await opts.firecrawl.scrape(url);
              if (!r.ok) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: [{ type: 'text', text: `scrape_website: ${r.error}` }],
                  is_error: true,
                });
                continue;
              }
              toolsUsed.add('scrape_website');
              const head = `# scrape_website 结果\n来源: ${r.url}${r.title ? ` — ${r.title}` : ''}\n\n---\n\n`;
              const markdown = absolutizeMarkdownLinks(r.markdown, r.url);
              const body = markdown.length > 30_000
                ? `${markdown.slice(0, 29_988)}\n\n…(truncated)`
                : markdown;
              const tail = '\n\n---\n**记得回到浏览器中整理 / 呈现这些信息，让用户看到执行过程**';
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [{ type: 'text', text: head + body + tail }],
              });
            } else if (opts.apifyAdapter) {
              const result = await opts.apifyAdapter.run(APIFY_SCRAPE_WEBSITE_ACTOR, {
                startUrls: [{ url }],
                maxRequestsPerCrawl: 1,
                maxResults: 1,
                ...(inp.extractionPrompt ? { extractionPrompt: inp.extractionPrompt } : {}),
              });
              if ('error' in result) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: [{ type: 'text', text: `scrape_website: ${result.error}` }],
                  is_error: true,
                });
                continue;
              }
              toolsUsed.add('scrape_website');
              const summary = formatScrapeWebsiteResult(result.items, url);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [{ type: 'text', text: summary }],
              });
            }
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `scrape_website: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              is_error: true,
            });
          }
          continue;
        }

        // -------- Phase 23 Step 3 — `search_ecommerce` Apify tool --------
        if (toolUse.name === 'search_ecommerce') {
          if (!opts.firecrawl && !opts.apifyAdapter) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: 'search_ecommerce: no scraper adapter configured (FIRECRAWL_API_KEY / APIFY_API_TOKEN both missing)',
                },
              ],
              is_error: true,
            });
            continue;
          }
          const inp = (toolUse.input as {
            platform?: string;
            query?: string;
            maxResults?: number;
          } | null) ?? {};
          const platform = inp.platform as keyof typeof APIFY_ECOMMERCE_ACTORS | undefined;
          const query = typeof inp.query === 'string' ? inp.query.trim() : '';
          const maxResults = Math.min(Math.max(Number(inp.maxResults ?? 10) || 10, 1), 30);
          if (!platform || !(platform in APIFY_ECOMMERCE_ACTORS)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `search_ecommerce: platform must be one of ${Object.keys(APIFY_ECOMMERCE_ACTORS).join(', ')}`,
                },
              ],
              is_error: true,
            });
            continue;
          }
          if (!query) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [{ type: 'text', text: 'search_ecommerce: query is required' }],
              is_error: true,
            });
            continue;
          }
          logger.info(
            {
              taskId: opts.taskId,
              iteration,
              platform,
              query,
              backend: opts.firecrawl ? 'firecrawl' : 'apify',
            },
            'supercar: search_ecommerce invoked',
          );
          try {
            // Phase 24 RC follow-up — Firecrawl-preferred. Firecrawl
            // /search returns generic markdown rather than the
            // structured {name, price, rating, url} shape Apify's
            // per-platform scrapers emit; we widen the platform-
            // specific query with the platform's site-name prefix
            // so Firecrawl's search is biased toward jd / amazon /
            // taobao results, then hand the markdown bundle to the
            // model (which is good at reading product cards).
            if (opts.firecrawl) {
              const platformName =
                platform === 'jd' ? '京东 jd.com' :
                platform === 'taobao' ? '淘宝 taobao.com' :
                'amazon.com';
              const r = await opts.firecrawl.search(
                `${platformName} ${query}`,
                { limit: maxResults },
              );
              if (!r.ok) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: [{ type: 'text', text: `search_ecommerce: ${r.error}` }],
                  is_error: true,
                });
                continue;
              }
              if (r.results.length === 0) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: [
                    {
                      type: 'text',
                      text: `search_ecommerce(${platform}): "${query}" 没有结果。试试更通用的关键词或换平台。`,
                    },
                  ],
                });
                continue;
              }
              toolsUsed.add('search_ecommerce');
              const ecommerceResults = r.results.slice(0, maxResults);
              for (const res of ecommerceResults) {
                if (!res.url) continue;
                await opts.onEvidence?.({
                  fact: `search_ecommerce_source platform=${platform} query="${query}" url=${res.url}`,
                  sourceType: 'tool_result',
                  sourceDetail: 'search_ecommerce.firecrawl',
                  confidence: 'extracted',
                });
              }
              for (const link of extractEcommerceProductLinks(ecommerceResults, platform)) {
                await opts.onEvidence?.({
                  fact: `search_ecommerce_product_link platform=${platform} query="${query}" url=${link.url}`,
                  sourceType: 'tool_result',
                  sourceDetail: 'search_ecommerce.firecrawl.product_link',
                  confidence: 'extracted',
                });
              }
              const summary = formatFirecrawlSearchEcommerceResult(
                r.results,
                platform,
                query,
                maxResults,
              );
              lastSearchEcommerceResultText = summary;
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [
                  {
                    type: 'text',
                    text: summary,
                  },
                ],
              });
            } else if (opts.apifyAdapter) {
              const actorId = APIFY_ECOMMERCE_ACTORS[platform];
              const result = await opts.apifyAdapter.run(actorId, {
                search: query,
                query,
                maxItems: maxResults,
                maxResults,
              });
              if ('error' in result) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: [{ type: 'text', text: `search_ecommerce: ${result.error}` }],
                  is_error: true,
                });
                continue;
              }
              toolsUsed.add('search_ecommerce');
              for (const item of result.items.slice(0, maxResults)) {
                const r = item as Record<string, unknown>;
                const url = r.url ?? r.productUrl ?? r.link ?? r.itemUrl;
                if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
                await opts.onEvidence?.({
                  fact: `search_ecommerce_source platform=${platform} query="${query}" url=${url}`,
                  sourceType: 'tool_result',
                  sourceDetail: 'search_ecommerce.apify',
                  confidence: 'extracted',
                });
              }
              const summary = formatSearchEcommerceResult(result.items, platform, query);
              lastSearchEcommerceResultText = summary;
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: [{ type: 'text', text: summary }],
              });
            }
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                {
                  type: 'text',
                  text: `search_ecommerce: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              is_error: true,
            });
          }
          continue;
        }

        if (toolUse.name !== 'computer') {
          // Unknown custom tool — tell the model we can't run it so it
          // can back off instead of looping forever.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: `Unknown tool: ${toolUse.name}` },
            ],
            is_error: true,
          });
          continue;
        }

        // Execute the computer use action and return a fresh screenshot.
        const computerInput = toolUse.input as ComputerActionInput;
        // Phase 1 Playbook B2 — best-effort per-action capture, taken BEFORE
        // the action so a click/type target reflects the page the model saw.
        // Gated by opts.onAction (wired only when ACTION_CAPTURE is on), so
        // OFF skips the page.evaluate entirely. null on any failure (bounded
        // + try/catch in the executor) → the row degrades to coordinate-only.
        const captureKind = opts.onAction ? computerCaptureKind(computerInput.action) : null;
        const captureCoord =
          captureKind === 'click' && Array.isArray(computerInput.coordinate)
            ? { x: Number(computerInput.coordinate[0]), y: Number(computerInput.coordinate[1]) }
            : null;
        let captureDescriptor: TargetDescriptor | null = null;
        if (captureKind) {
          captureDescriptor = await executor.captureTargetDescriptor(
            await executor.getPage(),
            captureCoord?.x,
            captureCoord?.y,
            { taskId: opts.taskId, actionIndex },
          );
        }
        // Phase 1 Playbook ④ — LIVE-VETO before the computer action executes.
        // Resolves the target descriptor (reuse the B2 one if already computed this
        // turn, else read it now: clicks → elementFromPoint at the coordinate; type/
        // key → the focused activeElement). Classify on ALL accessible-name signals —
        // visible text / aria-label / title / placeholder / name, fail-safe OR — plus
        // the input type (type=password ⇒ always vetoed). This catches an ICON-ONLY
        // control whose benign-glyph visible text (💳) would otherwise shadow its
        // sensitive aria-label/title, and a focused credential field. A veto returns
        // before executeComputerAction → the action never runs.
        if (opts.onBeforeAction) {
          const vk = vetoActionKind(computerInput.action);
          if (vk) {
            let desc: TargetDescriptor | null = captureDescriptor;
            if (!desc) {
              try {
                desc =
                  vk === 'click' && Array.isArray(computerInput.coordinate)
                    ? await executor.captureTargetDescriptor(
                        await executor.getPage(),
                        Number(computerInput.coordinate[0]),
                        Number(computerInput.coordinate[1]),
                      )
                    : await executor.captureTargetDescriptor(await executor.getPage());
              } catch {
                desc = null; // best-effort; the veto still runs (label null → see clean-context note)
              }
            }
            // Layer C — page-level signals (gated; LAYER_C off → never scanned). page.title() +
            // a small page-text scan for transaction-field NAMES (NO values). Best-effort: a
            // failure leaves them null and Layer C falls back to the proceed-word trigger.
            let pageTitleSig: string | null = null;
            let pageTxSig: string | null = null;
            if (opts.captureLayerCSignals && vk === 'click') {
              try {
                pageTitleSig = (await (await executor.getPage()).title()) ?? null;
              } catch {
                pageTitleSig = null;
              }
              try {
                // 收窄 (trip 首页页脚 prose 误触修): scan ONLY real <input|textarea|select> form
                // fields' name/id/placeholder/aria-label/label (NOT page prose, NEVER field VALUES);
                // the matcher (extractTxFieldSignal) keeps only ≤8 transaction-field terms. A page
                // with no transaction INPUT field (e.g. trip homepage: only search inputs + footer
                // "Payment methods" prose) → empty → Layer C NOT triggered by pageTxSignal.
                const FIELD_SCAN = `(() => { try {
                  const els = document.querySelectorAll('input, textarea, select');
                  const out = []; let n = 0;
                  for (const e of els) {
                    if (n++ > 40) break;
                    const parts = [e.name, e.id, e.getAttribute && e.getAttribute('placeholder'), e.getAttribute && e.getAttribute('aria-label')];
                    if (e.id) { var l = document.querySelector('label[for="' + (e.id + '').replace(/"/g, '') + '"]'); if (l) parts.push((l.textContent || '').slice(0, 40)); }
                    var pl = e.closest && e.closest('label'); if (pl) parts.push((pl.textContent || '').slice(0, 40));
                    for (const p of parts) { if (p) out.push((p + '').slice(0, 40)); }
                  }
                  return out.join(' ').slice(0, 1200);
                } catch (err) { return ''; } })()`;
                const fieldSig = await (await executor.getPage()).evaluate(FIELD_SCAN);
                const sig = extractTxFieldSignal(typeof fieldSig === 'string' ? fieldSig : '');
                pageTxSig = sig.length ? sig : null;
              } catch {
                pageTxSig = null;
              }
            }
            const actVeto = await vetoOutcome({
              kind: vk,
              label: desc?.visibleText ?? null,
              ariaLabel: desc?.ariaLabel ?? null,
              title: desc?.title ?? null,
              placeholder: desc?.placeholder ?? null,
              name: desc?.name ?? null,
              inputType: desc?.type ?? null,
              tagName: desc?.tagName ?? null, // 预订站加固: 提交型控件判定(层 B)
              pageUrl: desc?.url ?? null, // 预订站加固: 交易阶段反转(desc.url = page location.href)
              pageTitle: pageTitleSig, // Layer C: 页面标题(给模型)
              pageTxSignal: pageTxSig, // Layer C: 页面可见交易字段名(给模型 + 触发判定)
            });
            if (actVeto) return actVeto;
          }
        }
        const execResult = await executeComputerAction(executor, computerInput);
        const freshPage = (await executor.getPage()) as unknown as PageLike;
        // Phase 1 Playbook ④ — POST-ACTION URL re-check. A click on a link can
        // navigate to a sensitive URL the click veto never saw (it only had the
        // label, not the href) — and a navigate can 302-redirect. Re-classify the
        // LANDED url; if sensitive, halt (the action ran, but we go no further).
        if (opts.onBeforeAction) {
          const landedVeto = await vetoOutcome({ kind: 'navigate', url: freshPage.url() });
          if (landedVeto) return landedVeto;
        }
        const shot = await executor.screenshot(freshPage);
        if (shot.error || !shot.base64) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: `screenshot after ${execResult.summary} failed: ${shot.error ?? '?'}` },
            ],
            is_error: true,
          });
          continue;
        }

        // Hash this frame; if it differs from the last we showed Claude
        // the page moved, and we're not stuck. Only flag the turn if at
        // least ONE action moved the page.
        const shotHash = createHash('md5').update(shot.base64).digest('hex');
        if (lastScreenshotHash !== shotHash) {
          turnChangedScreenshot = true;
          lastScreenshotHash = shotHash;
        }

        await safeCall(opts.onScreencast, {
          iteration,
          imageBase64: shot.base64,
          url: freshPage.url(),
          viewportWidth: shot.viewportWidth ?? displayWidth,
          viewportHeight: shot.viewportHeight ?? displayHeight,
        });

        // Phase 1 Playbook B2 — emit the captured action. Redaction happens
        // HERE, before the value crosses the callback boundary: a sensitive
        // `type` target's raw value never enters the event.
        if (captureKind) {
          const rawText =
            captureKind === 'type' && typeof computerInput.text === 'string'
              ? computerInput.text
              : null;
          await safeCall(opts.onAction, {
            actionIndex,
            stepType: captureKind,
            siteDomain: extractDomainStat(captureDescriptor?.url ?? null),
            visibleText: captureDescriptor?.visibleText ?? null,
            targetSelector: captureDescriptor?.selector ?? null,
            coordinate: captureCoord,
            entryUrl: null,
            inputValue:
              captureKind === 'type' ? redactTypedValue(captureDescriptor, rawText) : null,
            framePath: captureDescriptor?.framePath ?? null,
            // B4 — attach the post-action screenshot ONLY for a page-advancing
            // click, and ONLY when anchors are enabled (else undefined → the
            // consumer stores no anchor). `shot.base64` is already in hand
            // (post-action frame, also fed to onScreencast above) — no re-shot.
            screenshotBase64:
              opts.captureScreenshotAnchors === true &&
              captureKind === 'click' &&
              turnChangedScreenshot
                ? shot.base64
                : undefined,
          });
        }

        // Anthropic requires that a tool_result marked is_error:true
        // contains ONLY text blocks — an image + is_error combo 400s
        // with "all content must be type `text` if `is_error` is true".
        // So split the shape: on failure we send a text description,
        // on success we send the fresh screenshot.
        if (execResult.ok) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: shot.base64,
                },
              },
            ],
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'text',
                text: `computer action failed: ${execResult.summary}`,
              },
            ],
            is_error: true,
          });
        }
      }

      // Update stuck counter — one increment per turn, not per action.
      // Only increment if the turn had at least one computer tool_use
      // AND none of those actions moved the page.
      const hadComputerAction = toolUseBlocks.some((b) => b.name === 'computer');
      if (hadComputerAction && !turnChangedScreenshot) {
        stuckCount++;
      } else if (hadComputerAction && turnChangedScreenshot) {
        stuckCount = 0;
      }

      // Lane 5 — Apify fallback the moment we've hit the stuck bar AND
      // the intent's site has a registered scraper actor. Runs once
      // per task; on success we fold the dataset into the summary and
      // exit before spending more API turns on a browser that clearly
      // isn't cooperating.
      if (
        !apifyAttempted &&
        stuckCount >= 3 &&
        opts.apifyAdapter
      ) {
        const match = opts.apifyAdapter.findActorForIntent(opts.intent);
        if (match) {
          apifyAttempted = true;
          logger.info(
            { taskId: opts.taskId, actor: match.actorId, stuckCount },
            'supercar: delegating to Apify actor',
          );
          const input = match.buildInput(opts.intent);
          const r = await opts.apifyAdapter.run(match.actorId, input);
          if ('items' in r && r.items.length > 0) {
            const itemsPreview = r.items
              .slice(0, 10)
              .map((it, i) => `${i + 1}. \`\`\`json\n${JSON.stringify(it, null, 2).slice(0, 400)}\n\`\`\``)
              .join('\n\n');
            convergePlanOnSuccess();
            return {
              status: 'completed',
              summary:
                `# ${match.hostLabel} — 通过 Apify Actor 获取（浏览器路径被反爬拦截）\n\n` +
                `Actor: \`${match.actorId}\`\n结果数：${r.items.length}（展示前 10 条）\n\n${itemsPreview}`,
              iterations: iteration,
              toolsUsed: [...toolsUsed, 'apify'],
            };
          }
          // Apify failed — log and keep going in the browser.
          logger.warn(
            { taskId: opts.taskId, err: 'error' in r ? r.error : 'empty' },
            'supercar: Apify actor returned no usable data — falling back to browser',
          );
        }
      }

      // Lane 2 escalation on pure stuck (no explicit anti-bot signal).
      // Triggers at the warn threshold so the headed browser gets a
      // chance before we inject the "try mobile sites" hint text.
      if (!executorSwapped && stuckCount >= STUCK_WARN_THRESHOLD) {
        await swapToHeadedIfAvailable(`stuck:${stuckCount}`);
      }

      // Anti-bot pattern scan. Runs on the freshest page text we can
      // get — fails open (no page text = no detection) so transient
      // evaluate errors don't break the loop. One scan per turn, not
      // per tool_use, so parallel tool_uses don't fire redundant
      // detections.
      let antiBotHintText: string | null = null;
      if (hadComputerAction && toolUseBlocks.length > 0) {
        const snapshotText = await readPageText(executor);
        const signal = snapshotText ? detectAntiBot({ snapshotText }) : null;
        if (signal && signal.confidence === 'high') {
          // Fire onAntiBotSignal at most once per distinct signal type;
          // don't spam the UI every turn while the banner sits there.
          if (!activeAntiBotSignal || activeAntiBotSignal.type !== signal.type) {
            activeAntiBotSignal = signal;
            logger.info(
              { taskId: opts.taskId, iteration, type: signal.type, rawMatch: signal.rawMatch },
              'supercar: anti-bot signal detected',
            );
            await safeCall(opts.onAntiBotSignal, {
              iteration,
              signal,
              waitTimeoutMs: 60_000,
            });
          }
          antiBotHintText =
            `检测到 **${describeSignal(signal)}**（匹配关键词："${signal.rawMatch.slice(0, 40)}"）。\n\n` +
            `这不是普通的页面未响应——是网站的反爬 / 人机验证机制。处理方式：\n` +
            `- 如果是**滑动验证 / 拖动滑块**：用户可以在右侧 panel 交互模式下手动完成，然后告诉你继续\n` +
            `- 如果是 **Cloudflare 质询页**：等 5 秒让它自动放行，或切 m.xxx.com 移动版绕开\n` +
            `- 如果是**明确的 403 / 访问被拒**：换站点（见移动版备选表）\n` +
            `- 不要继续点击同一元素——先换路径`;

          // Lane 2 escalation: swap the active executor to the headed
          // browser. Real GPU + real fingerprint defeats most of the
          // cheap "serve blank HTML to headless UAs" blocks even
          // without the model changing tactics. One-shot — the flag
          // prevents re-swapping on subsequent detections.
          const swapped = await swapToHeadedIfAvailable(`antibot:${signal.type}`);
          if (swapped) {
            antiBotHintText +=
              `\n\n系统已自动切换到 **headed 浏览器**（Lane 2，真实渲染指纹）。` +
              `下一个 computer action 会在新浏览器里执行，之前的页面状态已重放到当前 URL。`;
          }
        } else if (activeAntiBotSignal && !signal) {
          // Banner cleared on this turn — notify UI.
          logger.info(
            { taskId: opts.taskId, iteration, prev: activeAntiBotSignal.type },
            'supercar: anti-bot signal cleared',
          );
          await safeCall(opts.onAntiBotResolved, { iteration, reason: 'auto' });
          activeAntiBotSignal = null;
        }
      }

      // Ctrip flight-results extraction adapter. The model only sees
      // screenshots + scrape_website output, never the page's own text,
      // so the dense flights.ctrip.com SPA makes it vision-grind to the
      // iteration cap (QA: tsk_sjxJEBQavJ5sPzcKeCrwN, 50 iters, no
      // result). When parked on a Ctrip flight-results URL, read the
      // visible text and hand it to the model with an extraction
      // directive so it can finalize a table. One-shot — once the text
      // is in history we don't re-inject. Best-effort, never blocks.
      let ctripFlightHintText: string | null = null;
      if (!ctripFlightHintSent && hadComputerAction && toolUseBlocks.length > 0) {
        try {
          const cp = (await executor.getPage()) as unknown as { url?: () => string };
          const curUrl = typeof cp.url === 'function' ? cp.url() : '';
          if (isCtripFlightResultsUrl(curUrl)) {
            const longText = await readPageText(executor, 16384);
            ctripFlightHintText = buildCtripFlightHint({ pageText: longText, url: curUrl, topN: 3 });
            if (ctripFlightHintText) {
              ctripFlightHintSent = true;
              logger.info(
                { taskId: opts.taskId, iteration, url: curUrl.slice(0, 80) },
                'supercar: injected Ctrip flight extraction hint',
              );
            }
          }
        } catch {
          // best-effort — never break the loop on a page-read failure
        }
      }

      // Both stuck advisories go in the same user message as the
      // tool_results. Mixing text + tool_result blocks in one user turn
      // is legal per the Anthropic schema — tool_result blocks just
      // need to come before any free-form text.
      const nudgeContent: ContentBlockParam[] = [];
      if (antiBotHintText) {
        nudgeContent.push({ type: 'text', text: antiBotHintText });
      }
      if (ctripFlightHintText) {
        nudgeContent.push({ type: 'text', text: ctripFlightHintText });
      }
      // Phase 24 RC follow-up — `hasApifyTools` was the original
      // flag name, but the rescue nudge is correct whenever EITHER
      // scrape backend (Firecrawl OR Apify) is wired. Keep the
      // parameter name for backward compat in the helper signature
      // but compute it from the union.
      const hasScrapeBackend = Boolean(opts.firecrawl || opts.apifyAdapter);
      const nudge = buildStuckNudge({
        stuckCount,
        hasApifyTools: hasScrapeBackend,
        alreadyForcedExit: stuckForceFinalised,
      });
      if (nudge) {
        if (nudge.tier === 'exit-first') {
          stuckForceFinalised = true;
          logger.warn(
            {
              taskId: opts.taskId,
              iteration,
              stuckCount,
              hasScrapeBackend,
              backend: opts.firecrawl ? 'firecrawl' : opts.apifyAdapter ? 'apify' : 'none',
            },
            'supercar: stuck past exit threshold — injecting rescue nudge',
          );
        } else {
          logger.info(
            { taskId: opts.taskId, iteration, stuckCount },
            'supercar: stuck warning — nudging Claude to try alternate browser tactics',
          );
        }
        nudgeContent.push({ type: 'text', text: nudge.text });
      }

      // Phase 13 Dim 6 — emit one stats record per iteration that
      // actually invoked a client-side tool. Skip iterations that
      // produced only text (end_turn / awaiting_user) — those don't
      // map to a "lane" cleanly. The lane id mirrors the tool kind
      // since it directly maps to which back-end the agent drove.
      if (toolUseBlocks.length > 0) {
        const firstTool = toolUseBlocks[0];
        const laneUsed =
          firstTool?.name === 'navigate'
            ? 'navigate'
            : firstTool?.name === 'computer'
              ? 'browser_cdp'
              : firstTool?.name === 'create_file'
                ? 'create_file'
                : 'other';
        let currentUrl: string | null = null;
        try {
          const page = await executor?.getPage?.();
          if (page && typeof page.url === 'function') currentUrl = page.url();
        } catch {
          // Page might be torn down between turns; non-fatal.
        }
        const targetSite = extractDomainStat(currentUrl);
        // toolResults is typed as the wider BetaContentBlockParam[]; only
        // the tool_result variant carries is_error + content. Narrow
        // via type discriminator before reading those fields.
        type ToolResultBlock = Anthropic.Beta.BetaToolResultBlockParam;
        const errorBlocks = toolResults.filter(
          (r): r is ToolResultBlock => r.type === 'tool_result' && r.is_error === true,
        );
        const anyError = errorBlocks.length > 0;
        const errorMessage = anyError
          ? errorBlocks
              .flatMap((r) =>
                Array.isArray(r.content)
                  ? (r.content as Array<{ type?: string; text?: string }>)
                  : [],
              )
              .map((b) => (b?.type === 'text' ? b.text : null))
              .filter(Boolean)
              .join(' | ')
          : null;
        void opts.onStatsRecord?.({
          laneUsed,
          targetSite,
          success: !anyError,
          latencyMs: Date.now() - iterationStart,
          errorType: anyError ? classifyToolError(errorMessage ?? '') : null,
        });
      }

      // Phase 13 Dim 1 follow-up — append a plan-tracker reminder
      // so the model embeds [STEP N status] markers in its text
      // blocks next turn. Cheap (~30 tokens) and only fires when a
      // plan exists. Skipped on the iteration where the model
      // already terminated (stop_reason='end_turn' would mean no
      // next turn anyway).
      let plannerReminder: ContentBlockParam[] = [];
      if (planTrackerEnabled && response.stop_reason !== 'end_turn') {
        const stateLines = currentPlanSteps
          .map((s) => `${s.idx + 1}. ${s.status}`)
          .join('\n');
        plannerReminder = [
          {
            type: 'text',
            text:
              `[plan tracker] 当前执行计划进度：\n${stateLines}\n` +
              `回复时在 thinking 或正文里插入 \`[STEP N status]\` 标记，N 是 1-based 步骤号，status 是 ` +
              `\`done\` / \`running\` / \`failed\`。比如刚开始执行第二步就写 \`[STEP 2 running]\`。` +
              `不需要每步都重复，只在状态变化时打一次。`,
          },
        ];
      }

      messages.push({
        role: 'user',
        content:
          nudgeContent.length > 0 || plannerReminder.length > 0
            ? [...toolResults, ...nudgeContent, ...plannerReminder]
            : toolResults,
      });
    }

    if (cancelled) {
      return {
        status: 'cancelled',
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    const exhaustedAuthWall = await probeTimeoutAuthWall(executor);
    if (
      exhaustedAuthWall &&
      shouldUseScraperAfterAuthWall({
        intent: opts.intent,
        kind: exhaustedAuthWall.kind,
        hasScraperTools: Boolean(opts.firecrawl || opts.apifyAdapter),
      }) &&
      toolsUsed.has('search_ecommerce') &&
      lastSearchEcommerceResultText
    ) {
      logger.info(
        {
          taskId: opts.taskId,
          kind: exhaustedAuthWall.kind,
          url: exhaustedAuthWall.url,
          iterations: iteration,
        },
        'supercar: exhausted on ecommerce auth wall — completing from scraper evidence',
      );
      convergePlanOnSuccess();
      return {
        status: 'completed',
        summary: buildEcommerceAuthWallFallbackSummary({
          intent: opts.intent,
          authWallUrl: exhaustedAuthWall.url,
          searchResultText: lastSearchEcommerceResultText,
        }),
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    if (Date.now() >= deadline) {
      // Codex Round 2 P0-3 — auth-wall probe before reporting timeout.
      // If the agent ran out of clock on a login / captcha / permission
      // page, the right verdict is awaiting_user (so the user can
      // complete the wall and the task can be resumed) rather than a
      // dead-end "操作超时" failure.
      const probed = exhaustedAuthWall;
      if (probed) {
        const question = buildAuthParkQuestion(probed.kind, probed.url);
        await safeCall(opts.onAwaitingUser, {
          question,
          at: new Date(),
          currentUrl: probed.url,
          awaitingKind: probed.kind,
        });
        return {
          status: 'awaiting_user',
          question,
          iterations: iteration,
          toolsUsed: Array.from(toolsUsed),
        };
      }
      return {
        status: 'timeout',
        reason: `task timeout (${Math.round(timeoutMs / 1000)}s) elapsed`,
        iterations: iteration,
        toolsUsed: Array.from(toolsUsed),
      };
    }
    return {
      status: 'failed',
      reason: `exhausted maxIterations=${maxIterations} without completion`,
      iterations: iteration,
      toolsUsed: Array.from(toolsUsed),
    };
  } finally {
    handles.delete(opts.taskId);
  }
}

// ---------------------------------------------------------------------------
// Computer use dispatch
// ---------------------------------------------------------------------------

/**
 * Phase 1 Playbook B2 — which computer sub-actions warrant a capture row.
 * Click variants → 'click' (elementFromPoint at the coordinate); 'type' →
 * 'type' (activeElement). Everything else (scroll / key / wait / screenshot
 * / mouse_move) returns null and is skipped.
 */
function computerCaptureKind(action: unknown): 'click' | 'type' | null {
  if (
    action === 'left_click' ||
    action === 'right_click' ||
    action === 'middle_click' ||
    action === 'double_click' ||
    action === 'triple_click'
  ) {
    return 'click';
  }
  if (action === 'type') return 'type';
  return null;
}

/**
 * Phase 1 Playbook ④ — map a computer action to the LIVE-VETO kind. Like
 * computerCaptureKind but ALSO treats key / hold_key as a write ('type'), so the
 * keyboard-write path is covered. Read-class actions (screenshot / scroll / mouse_move
 * / wait / cursor_position / zoom) return null → not vetoed.
 */
export function vetoActionKind(action: unknown): 'click' | 'type' | null {
  switch (action) {
    // read-class — no page write → no veto.
    case 'screenshot':
    case 'cursor_position':
    case 'mouse_move':
    case 'scroll':
    case 'wait':
    case 'zoom':
      return null;
    // keyboard writes.
    case 'type':
    case 'key':
    case 'hold_key':
      return 'type';
    // FAIL-CLOSED: all click variants, the mouse PRIMITIVES that compose into a click
    // (left_mouse_down / left_mouse_up / left_click_drag), AND any unknown/future
    // action → treated as a click-class WRITE and vetoed. A click decomposed into
    // mouse_down+mouse_up, or a drag-to-confirm slider, must NOT slip past the veto
    // (adversarial review CAMERA-2 blocker).
    default:
      return 'click';
  }
}

interface ComputerActionInput {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  key?: string;
  duration?: number;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  region?: [number, number, number, number];
}

interface ActionResult {
  ok: boolean;
  summary: string;
}

/**
 * Map Anthropic's `computer_20251124` action schema to the
 * PlaywrightExecutor methods the legacy vision-loop already uses.
 *
 * Differences from the skill-plan sketch:
 *   - Scroll uses `scroll_direction` + `scroll_amount` (per the official
 *     schema — the sketch in the brief used `direction`/`amount`).
 *   - `wait` duration is in SECONDS (again per the schema, sketch used ms).
 *   - Modifier keys on click/scroll come through `input.text` (e.g.
 *     "shift"), handled by combining into Playwright's `key+click`.
 *   - `key` / `hold_key` actions receive the key string in `input.text`
 *     per the Anthropic schema, with a `key` fallback just in case.
 */
/**
 * Phase 24 RC follow-up — strict coordinate validation.
 *
 * RC data showed 4/165 tasks crashed because the model emitted a
 * malformed coordinate (string-typed numbers, NaN from over-eager
 * arithmetic, or a single-element tuple). Truthy-only checks like
 * `if (!input.coordinate)` accepted those and let them flow into
 * page.mouse.click(NaN, NaN). Validate the shape AND the values
 * before dispatch — a clean { ok: false } result tells the agent
 * the coordinate was bad and it can re-observe + retry on the next
 * tick. Coords must be a 2-element tuple of finite non-negative
 * numbers; max 50000 catches absurd values from stale viewport
 * arithmetic without rejecting any plausible 4K screen layout.
 */
function validateCoordinate(c: unknown): { ok: true; x: number; y: number } | { ok: false; reason: string } {
  if (!Array.isArray(c)) return { ok: false, reason: 'not an array' };
  if (c.length !== 2) return { ok: false, reason: `length ${c.length} (expected 2)` };
  const x = c[0];
  const y = c[1];
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { ok: false, reason: `non-number entries (got ${typeof x},${typeof y})` };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, reason: `non-finite (NaN/Infinity)` };
  }
  if (x < 0 || y < 0 || x > 50_000 || y > 50_000) {
    return { ok: false, reason: `out of range (${x},${y})` };
  }
  return { ok: true, x, y };
}

async function executeComputerAction(
  executor: PlaywrightExecutor,
  input: ComputerActionInput,
): Promise<ActionResult> {
  const page = (await executor.getPage()) as unknown as PageLike;
  const action = input.action;

  try {
    switch (action) {
      case 'screenshot':
        // No-op — caller grabs a fresh screenshot after every action.
        return { ok: true, summary: 'screenshot' };

      case 'left_click':
      case 'right_click':
      case 'middle_click': {
        const c = validateCoordinate(input.coordinate);
        if (!c.ok) return { ok: false, summary: `${action}: invalid coordinate (${c.reason})` };
        const button: 'left' | 'right' | 'middle' =
          action === 'left_click' ? 'left' : action === 'right_click' ? 'right' : 'middle';
        const { x, y } = c;
        // Modifier-key click (`text` carries "shift" / "ctrl" / "alt" /
        // "super"). Route through page.keyboard.down + click + up so we
        // don't need a new executor method.
        if (input.text) {
          const mod = normaliseModifier(input.text);
          const anyPage = page as unknown as { keyboard: { down: (k: string) => Promise<void>; up: (k: string) => Promise<void> }; mouse: typeof page.mouse };
          await anyPage.keyboard.down(mod);
          try {
            await anyPage.mouse.click(x, y, { button });
          } finally {
            await anyPage.keyboard.up(mod);
          }
          return { ok: true, summary: `${action}(${x},${y}) +${mod}` };
        }
        const r = await executor.click(page, x, y, button);
        return { ok: r.ok, summary: r.message ?? `${action}(${x},${y})` };
      }

      case 'double_click': {
        const c = validateCoordinate(input.coordinate);
        if (!c.ok) return { ok: false, summary: `double_click: invalid coordinate (${c.reason})` };
        const { x, y } = c;
        const r1 = await executor.click(page, x, y, 'left');
        if (!r1.ok) return { ok: false, summary: r1.message ?? 'double_click failed' };
        const r2 = await executor.click(page, x, y, 'left');
        return { ok: r2.ok, summary: `double_click(${x},${y})` };
      }

      case 'triple_click': {
        const c = validateCoordinate(input.coordinate);
        if (!c.ok) return { ok: false, summary: `triple_click: invalid coordinate (${c.reason})` };
        const { x, y } = c;
        for (let i = 0; i < 3; i++) {
          const r = await executor.click(page, x, y, 'left');
          if (!r.ok) return { ok: false, summary: r.message ?? 'triple_click failed' };
        }
        return { ok: true, summary: `triple_click(${x},${y})` };
      }

      case 'type': {
        const text = input.text ?? '';
        const r = await executor.type(page, text);
        return { ok: r.ok, summary: r.message ?? `type(${text.length}c)` };
      }

      case 'key': {
        // Anthropic schema puts the key string in `text` for the `key`
        // action. Older examples used `key`; tolerate both.
        const key = input.text ?? input.key ?? '';
        if (!key) return { ok: false, summary: 'key without text' };
        const r = await executor.pressKey(page, key);
        return { ok: r.ok, summary: r.message ?? `key(${key})` };
      }

      case 'hold_key': {
        const key = input.text ?? input.key ?? '';
        const durSec = input.duration ?? 1;
        if (!key) return { ok: false, summary: 'hold_key without text' };
        const anyPage = page as unknown as {
          keyboard: { down: (k: string) => Promise<void>; up: (k: string) => Promise<void> };
        };
        await anyPage.keyboard.down(key);
        await page.waitForTimeout(Math.min(10_000, Math.round(durSec * 1000)));
        await anyPage.keyboard.up(key);
        return { ok: true, summary: `hold_key(${key}, ${durSec}s)` };
      }

      case 'mouse_move': {
        const c = validateCoordinate(input.coordinate);
        if (!c.ok) return { ok: false, summary: `mouse_move: invalid coordinate (${c.reason})` };
        await page.mouse.move(c.x, c.y);
        return { ok: true, summary: `mouse_move(${c.x},${c.y})` };
      }

      case 'left_mouse_down':
      case 'left_mouse_up': {
        const anyPage = page as unknown as {
          mouse: { down: () => Promise<void>; up: () => Promise<void>; move: (x: number, y: number) => Promise<void> };
        };
        if (input.coordinate !== undefined) {
          const c = validateCoordinate(input.coordinate);
          if (!c.ok) return { ok: false, summary: `${action}: invalid coordinate (${c.reason})` };
          await anyPage.mouse.move(c.x, c.y);
        }
        if (action === 'left_mouse_down') await anyPage.mouse.down();
        else await anyPage.mouse.up();
        return { ok: true, summary: action };
      }

      case 'left_click_drag': {
        const start = validateCoordinate(input.start_coordinate);
        if (!start.ok) {
          return { ok: false, summary: `left_click_drag: invalid start_coordinate (${start.reason})` };
        }
        const end = validateCoordinate(input.coordinate);
        if (!end.ok) {
          return { ok: false, summary: `left_click_drag: invalid coordinate (${end.reason})` };
        }
        const anyPage = page as unknown as {
          mouse: { down: () => Promise<void>; up: () => Promise<void>; move: (x: number, y: number) => Promise<void> };
        };
        await anyPage.mouse.move(start.x, start.y);
        await anyPage.mouse.down();
        await anyPage.mouse.move(end.x, end.y);
        await anyPage.mouse.up();
        return { ok: true, summary: `drag (${start.x},${start.y})→(${end.x},${end.y})` };
      }

      case 'scroll': {
        const direction = input.scroll_direction ?? 'down';
        const amount = Math.max(1, Math.min(20, input.scroll_amount ?? 3));
        const pxPerUnit = 100;
        let dx = 0;
        let dy = 0;
        if (direction === 'down') dy = amount * pxPerUnit;
        else if (direction === 'up') dy = -amount * pxPerUnit;
        else if (direction === 'right') dx = amount * pxPerUnit;
        else dx = -amount * pxPerUnit;
        if (input.coordinate) await page.mouse.move(input.coordinate[0], input.coordinate[1]);
        // Modifier via `text` (e.g. shift+scroll = horizontal on some sites).
        const mod = input.text ? normaliseModifier(input.text) : null;
        const anyPage = page as unknown as { keyboard: { down: (k: string) => Promise<void>; up: (k: string) => Promise<void> } };
        if (mod) await anyPage.keyboard.down(mod);
        try {
          const r = await executor.scroll(page, dy + dx);
          return { ok: r.ok, summary: `scroll(${direction}, ${amount}${mod ? ` +${mod}` : ''})` };
        } finally {
          if (mod) await anyPage.keyboard.up(mod);
        }
      }

      case 'wait': {
        // Anthropic schema uses SECONDS; clamp 0..10.
        const ms = Math.round(Math.max(0, Math.min(10, input.duration ?? 1)) * 1000);
        const r = await executor.wait(page, ms);
        return { ok: r.ok, summary: r.message ?? `wait(${ms}ms)` };
      }

      case 'zoom':
        // Zoom is an observation-side operation; the commander asks the
        // executor to re-send a scaled region of the screenshot.
        // PlaywrightExecutor doesn't have a zoom method yet; acknowledge
        // as a no-op so the model doesn't hammer it. A future tier can
        // re-sharp to the requested region for higher resolution.
        return { ok: true, summary: 'zoom (noop)' };

      default:
        return { ok: false, summary: `unknown action: ${action}` };
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `${action} threw: ${m.slice(0, 200)}` };
  }
}

/**
 * Normalise Anthropic's modifier strings (shift / ctrl / alt / super)
 * to the capitalised form Playwright expects.
 */
function normaliseModifier(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (k === 'shift') return 'Shift';
  if (k === 'ctrl' || k === 'control') return 'Control';
  if (k === 'alt' || k === 'option') return 'Alt';
  if (k === 'super' || k === 'meta' || k === 'cmd' || k === 'command') return 'Meta';
  // Unknown modifier — pass through unchanged and let Playwright reject it
  // so we notice in logs.
  return raw;
}

/**
 * Decide whether the model's text-only turn is asking the user for
 * more input (→ park to awaiting_user) or genuinely terminating
 * (→ status=completed). Three signals, in priority order:
 *
 *   1. Explicit `[AWAITING_USER_INPUT]` marker — emitted by expert-
 *      workflow preambles (see expert-workflows.ts) when the model
 *      enters intake-guard mode. Strongest signal; overrides other
 *      heuristics. Stripped from the user-visible text by the caller
 *      before broadcast.
 *   2. Trailing question mark (zh / en) on the last non-empty line —
 *      original heuristic. Conservative: covers polite "需要其它部分
 *      吗？" tails without false-firing on summaries that mention a
 *      question internally.
 *   3. Structured intake without a trailing '?' — model lists missing
 *      fields as a numbered / bulleted block (matched by INTAKE_MARKERS
 *      AND ≥2 list lines, capped at 1500 chars to avoid finished
 *      reports that contain phrases like "请告诉我" inside prose).
 *      This is the failure mode P1-A targets: the douyin intake-guard
 *      output before the marker existed didn't end in '?', so the
 *      task hit completed and the user's question never showed.
 */
function looksLikePendingQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\[AWAITING[_ ]USER[_ ]INPUT\]/i.test(trimmed)) return true;
  // F1 — login / browser takeover detection. The model often signs
  // off a turn with "请接管浏览器完成登录" / "please log in" rather
  // than a question; without this the loop saw it as end-of-turn,
  // returned status='completed', dispatcher released the per-task
  // Brave, and the user faced "请接管" with no live session left.
  // Promoted ABOVE the trailing-? heuristic because takeover prompts
  // rarely end in a question mark.
  if (looksLikeBrowserTakeoverPrompt(trimmed)) return true;
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  if (last.endsWith('？') || last.endsWith('?')) return true;
  if (trimmed.length >= 1500) return false;
  const INTAKE_MARKERS: readonly RegExp[] = [
    /请(?:先\s*)?(?:告诉|提供|补充|发我|给我|确认|说明)/u,
    /需要(?:先|您|你|以下)(?:确认|提供|补充|说明|告知|信息|输入)/u,
    /缺少(?:以下|这些|关键|必要)(?:信息|输入|字段|数据)/u,
    /(?:才能|以便)(?:开始|执行|继续|分析|生成|出报告)/u,
    /(?:please\s+)?(?:provide|tell\s+me|share|confirm|let\s+me\s+know)\b/i,
    /\bbefore\s+(?:i\s+can|we\s+can|we\s+begin)\b/i,
    /\bi\s+(?:need|require|'ll\s+need)\s+(?:the|some|more|additional)\b/i,
  ];
  if (!INTAKE_MARKERS.some((re) => re.test(trimmed))) return false;
  const listLines = lines.filter(
    (l) => /^[\-\*•·]\s/.test(l) || /^\d+[\.、)]/u.test(l),
  ).length;
  if (listLines >= 2) return true;
  // Or: colon-then-list pattern ("请补充：\n1. ...\n2. ...")
  return /[：:]\s*\n\s*(?:[\d\-\*•·]|[一二三四五六七八九十])/u.test(trimmed);
}

/**
 * F1 — detect "model is asking the user to take over the browser to
 * log in / scan / verify". These prompts park the loop with
 * `awaitingKind='login'`; the per-task Brave stays allocated so the
 * user can actually do what was asked.
 *
 * Two-pass design:
 *   1. STANDALONE phrases — single regex hits that are unambiguous
 *      asks ("接管浏览器" / "完成登录" / "请登录" / "take over the
 *      browser"). The earlier "请(?:您|你|帮)?接管…" form required a
 *      leading 请 and missed real outputs like "直接接管浏览器自己
 *      完成登录" / "或者直接接管浏览器".
 *   2. Co-occurrence — if both a login keyword AND an ask-the-user
 *      keyword appear in a short text, treat as a takeover prompt.
 *      Catches patterns like "请告诉我你用哪个入口登录" where neither
 *      half is takeover-shaped on its own. Length cap dodges long
 *      completed reports that mention both incidentally; the past-
 *      tense exclusion skips "我已成功登录" style report sentences.
 *
 * Bias: prefer false positives (parks an already-completed turn —
 * user types "好的" or 30min timeout auto-completes) over false
 * negatives (Brave is released under an unfinished login — the
 * actual bug being fixed).
 */
export function looksLikeBrowserTakeoverPrompt(text: string): boolean {
  const t = text.toLowerCase();

  // Pass 1 — strong standalone phrases.
  const STANDALONE: readonly RegExp[] = [
    /接管(?:浏览器|页面|一下|这个|这里)/u,
    /(?:请|需要)(?:您|你)?(?:登录|登入)/u,
    /完成(?:登录|登入|扫码|验证)/u,
    /(?:扫码|手动|自己)\s*登[录入]/u,
    /帮我(?:登录|登入|扫码)/u,
    /请(?:扫|扫描|扫一下)(?:二维码|码)/u,
    /\bplease\s+(?:log\s*in|sign\s*in|take\s+over|scan)\b/i,
    /\btake\s+over\s+(?:the\s+)?(?:browser|page)\b/i,
    /\bsign\s+in\s+manually\b/i,
  ];
  if (STANDALONE.some((re) => re.test(text))) {
    return !looksLikePastTenseLoginReport(text);
  }

  // Pass 2 — co-occurrence (login keyword + ask-the-user keyword).
  // Cap at 1500 chars so a long completed report that mentions both
  // by accident isn't tripped.
  if (text.length > 1500) return false;
  const hasLogin =
    /登录|登入|扫码|二维码|入口|sign\s*in|log\s*in/i.test(t);
  const hasAsk =
    /接管|告诉我|选择|哪个|哪一个|你用|麻烦你|麻烦您|choose|select|take\s+over|please\s+(?:tell|let|specify|provide|share|choose|pick)/i.test(
      t,
    );
  if (!(hasLogin && hasAsk)) return false;
  return !looksLikePastTenseLoginReport(text);
}

/**
 * Past-tense completion context — model is REPORTING a successful
 * login (e.g. "已成功登录抖店后台并选择了…"), not asking the user to
 * do one. Skip the takeover heuristic when the only login mention
 * is in a past-tense / success frame so a real summary isn't parked
 * as awaiting_user.
 *
 * Phase 4 R1 follow-up — added negative lookaheads on the
 * "登录完成 / 登录了" branches so they DON'T fire on future-tense
 * "登录完成后告诉我" / "登录后再回来" patterns. Observed regression
 * on P0_006: model emitted "...请手动登录...登录完成后告诉我",
 * past-tense regex hit "登录完成", takeover heuristic was suppressed,
 * task terminated as completed instead of parking on the login wall.
 */
function looksLikePastTenseLoginReport(text: string): boolean {
  // `已 ... 登录` form — established success ("已成功登录", "已完成扫码").
  if (/已\s*(?:经)?\s*(?:成功)?\s*(?:完成)?\s*(?:登录|登入|扫码)/u.test(text)) {
    return true;
  }
  // "登录完成" / "登录成功" / "登录了" — but NOT when followed by
  // "后" / "再" / "之后" / "以后" (future-tense subordinate clause).
  // The lookahead allows incidental whitespace so "登录完成 后告诉我"
  // also gets excluded (defensive against a stray newline).
  if (
    /(?:登录|登入|扫码)\s*(?:成功|完成|了)(?!\s*(?:后|再|之后|以后))/u.test(text)
  ) {
    return true;
  }
  // "登录过" — past-tense aspectual marker. NOTE: 完 alone is
  // ambiguous: "登录完毕" is past but "登录完成后" is future and
  // shares the prefix "登录完". Branch 2 (above) already catches the
  // unambiguous 完成 form with the future-tense guard; dropping 完
  // from this branch avoids the false-positive on
  // "请...登录...登录完成后告诉我" that suppressed P0_006 takeover.
  if (/(?:登录|登入|扫码)\s*过/u.test(text)) {
    return true;
  }
  if (/successfully\s+(?:logged|signed)\s*in/i.test(text)) return true;
  return false;
}

/**
 * Strip the `[AWAITING_USER_INPUT]` machine marker from the user-
 * visible text — operators / users should never see the raw marker,
 * but the agent-loop has already consumed it as a park signal.
 */
function stripAwaitingUserMarker(text: string): string {
  return text.replace(/\s*\[AWAITING[_ ]USER[_ ]INPUT\]\s*/gi, ' ').trim();
}

/**
 * F2 — reconcile the model's final answer against what the browser
 * actually has on screen. The model occasionally invents a URL from
 * memory that doesn't match the page it's currently looking at —
 * the canonical case is "click 'More information…' on example.com",
 * where the model says https://www.iana.org/domains/reserved while
 * the page actually navigated to https://www.iana.org/help/example-domains.
 * Without this reconcile, the user reads a wrong link in the answer
 * and a different URL in the BrowserPanel evidence.
 *
 * Strategy: pull the live page URL + title via the executor, find
 * any URLs in `finalText`. If the text mentions URLs but none of
 * them match the observed page, append a "📍 实际浏览器页面" line
 * with the truthful URL. Conservative — we never rewrite the
 * model's text, only append. If `finalText` mentions no URLs at all
 * (a pure prose answer), nothing is appended.
 */
async function reconcileFinalAnswer(
  finalText: string,
  executor: PlaywrightExecutor,
  taskId: string,
): Promise<{
  summary: string;
  observedUrl: string | null;
  observedTitle: string | null;
}> {
  let observedUrl: string | null = null;
  let observedTitle: string | null = null;
  try {
    const page = (await executor.getPage()) as unknown as {
      url?: () => string;
      title?: () => Promise<string>;
    };
    const u = page?.url?.();
    if (typeof u === 'string' && u && u !== 'about:blank') {
      observedUrl = u;
    }
    if (page?.title) {
      // Bound the title call — a hung renderer shouldn't block the
      // outcome path. 2s is generous for a property read.
      observedTitle = await Promise.race<string | null>([
        page.title().then((t) => t ?? null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
      ]).catch(() => null);
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), taskId },
      'reconcile: failed to read observed page state (non-fatal)',
    );
  }

  const summary = reconcileFinalAnswerText(
    finalText,
    observedUrl,
    observedTitle,
    taskId,
  );
  return { summary, observedUrl, observedTitle };
}

/**
 * Pure URL/title reconciliation — extracted so unit tests can exercise
 * every branch without a Playwright mock. `reconcileFinalAnswer` is
 * the I/O wrapper; this is the algorithm.
 *
 * Strategy:
 *   - No observedUrl / no domain → return finalText unchanged.
 *   - Already-correct URL in finalText → unchanged.
 *   - Same-domain mismatch (path differs) → splice in observed URL
 *     (and title, for `[label](url)` markdown links). Multiple edits
 *     applied right-to-left so positions stay valid.
 *   - Different-domain mismatch → fall back to appending a "📍 实际
 *     浏览器页面" line. Replacing across domains would change the
 *     answer's meaning silently.
 */
export function reconcileFinalAnswerText(
  finalText: string,
  observedUrl: string | null,
  observedTitle: string | null,
  taskId?: string,
): string {
  if (!observedUrl) return finalText;
  const observedDomain = parseDomain(observedUrl);
  if (!observedDomain) return finalText;

  // Collect markdown links `[label](url)` first so we can swap label
  // along with url for same-domain mismatches. Bare URLs are detected
  // in a second pass and skipped if they fall inside an already-
  // captured markdown range.
  type MdLink = { start: number; end: number; label: string; url: string };
  type BareUrl = { start: number; end: number; url: string };
  const mdLinks: MdLink[] = [];
  const MD_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (let m = MD_LINK_RE.exec(finalText); m; m = MD_LINK_RE.exec(finalText)) {
    mdLinks.push({
      start: m.index,
      end: m.index + m[0].length,
      label: m[1] ?? '',
      url: m[2] ?? '',
    });
  }
  const bareUrls: BareUrl[] = [];
  // Stop at whitespace, closing brackets, AND common Chinese
  // punctuation — without that, "...example.com/foo，标题是..." swept
  // the comma + following Chinese into the URL match and broke
  // same-domain comparison downstream.
  const BARE_URL_RE = /https?:\/\/[^\s)\]，。、！？；：、]+/g;
  for (let m = BARE_URL_RE.exec(finalText); m; m = BARE_URL_RE.exec(finalText)) {
    const start = m.index;
    const end = start + m[0].length;
    if (mdLinks.some((ml) => start >= ml.start && end <= ml.end)) continue;
    bareUrls.push({ start, end, url: m[0] });
  }

  const allUrls = [...mdLinks.map((l) => l.url), ...bareUrls.map((b) => b.url)];
  if (allUrls.length === 0) return finalText;

  // Normalize: strip trailing punctuation (ASCII + Chinese) and a
  // final slash. Lowercase for host-insensitive compare. Used for
  // exact-match check vs observedUrl below.
  const normalize = (u: string): string =>
    u
      .replace(/[.,;:!?)\]、。，！？；：]+$/, '')
      .replace(/\/$/, '')
      .toLowerCase();
  const observedNorm = normalize(observedUrl);
  if (allUrls.some((u) => normalize(u) === observedNorm)) {
    // Already correct — nothing to fix.
    return finalText;
  }

  const safeTitle =
    observedTitle && observedTitle.trim().length > 0
      ? observedTitle.trim()
      : observedUrl;

  const sameDomainUrls = allUrls.filter((u) => parseDomain(u) === observedDomain);
  const distinctSameDomainUrls = new Set(sameDomainUrls.map((u) => normalize(u)));
  if (distinctSameDomainUrls.size > 1) {
    const correction = `\n\n> 📍 实际浏览器页面：[${safeTitle}](${observedUrl})`;
    logger.info(
      {
        taskId,
        observedUrl,
        observedTitle,
        sameDomainUrls: sameDomainUrls.slice(0, 5),
      },
      'reconcile: skipped inline rewrite for multiple distinct same-domain URLs',
    );
    return finalText + correction;
  }

  // Same-domain mismatch path: replace inline only when the answer has
  // a single distinct same-domain URL. Product/listing answers often
  // contain several legitimate URLs on the same host; replacing all of
  // them with the final observed page corrupts evidence.
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  if (distinctSameDomainUrls.size === 1) {
    for (const ml of mdLinks) {
      if (parseDomain(ml.url) === observedDomain) {
        edits.push({
          start: ml.start,
          end: ml.end,
          replacement: `[${safeTitle}](${observedUrl})`,
        });
      }
    }
    for (const bu of bareUrls) {
      if (parseDomain(bu.url) === observedDomain) {
        edits.push({ start: bu.start, end: bu.end, replacement: observedUrl });
      }
    }
  }

  if (edits.length > 0) {
    edits.sort((a, b) => b.start - a.start);
    let edited = finalText;
    for (const e of edits) {
      edited = edited.slice(0, e.start) + e.replacement + edited.slice(e.end);
    }
    logger.info(
      {
        taskId,
        observedUrl,
        observedTitle,
        replacements: edits.length,
      },
      'reconcile: replaced same-domain URL/title mismatches inline',
    );
    return edited;
  }

  // Different-domain mismatch — extreme case. The model is talking
  // about an entirely different host than the live page. Append
  // rather than replace, since silently rewriting a foreign-domain
  // mention would change the meaning of the answer.
  const correction = `\n\n> 📍 实际浏览器页面：[${safeTitle}](${observedUrl})`;
  logger.info(
    {
      taskId,
      observedUrl,
      mentionedUrls: allUrls.slice(0, 3),
    },
    'reconcile: appended observed-URL correction (different-domain mismatch)',
  );
  return finalText + correction;
}

/** Parse a URL's hostname (lowercased) or null on malformed input. */
function parseDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Build the optional `reconciledStepUpdate` outcome field. The
 * dispatcher's `onTick` truncated the model's per-iteration text to
 * 80 chars and stamped it onto `task_steps.input.summary` (and broad-
 * casted as the `actionSummary` for `server.vision.tick.end`). When
 * reconcileFinalAnswer rewrites the LAST iteration's text, the step
 * row stays stale, so the BrowserPanel "最近操作" overlay keeps
 * showing the wrong URL after the final summary has been corrected.
 *
 * Returns an update payload only when reconcile actually changed
 * something — otherwise the dispatcher skips the DB rewrite + WS
 * rebroadcast entirely.
 */
function buildReconciledStepUpdate(
  preReconcile: string,
  postReconcile: string,
  tickIndex: number,
): { tickIndex: number; actionSummary: string } | undefined {
  if (preReconcile === postReconcile) return undefined;
  // Match dispatcher's truncation budget so the step row's summary
  // field stays the same shape it had before reconcile (downstream
  // consumers expect ≤ 80-char preview).
  const STEP_SUMMARY_MAX = 80;
  const actionSummary = stripPlanTrackerMarkers(postReconcile)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, STEP_SUMMARY_MAX);
  return { tickIndex, actionSummary };
}

/**
 * Strip the `[STEP N status]` markers the planner reminder asks the
 * model to emit. Mirror of the dispatcher-side helper of the same
 * name; duplicated here so reconcile output stays clean.
 */
function stripPlanTrackerMarkers(s: string): string {
  // Drop the [STEP n …] plan markers AND the [AWAITING_USER_INPUT] machine
  // marker so neither reaches the reconciled step label / "最近操作" overlay
  // (P2-A). stripAwaitingUserMarker collapses the surrounding whitespace.
  return stripAwaitingUserMarker(
    s.replace(/\[STEP\s+\d+\s+(?:done|running|failed|pending)\]\s*/gi, ''),
  );
}

/**
 * P2-A — classify what KIND of user input the supercar is waiting on.
 * Drives the SPA's BrowserPanel: only the non-clarification kinds
 * auto-expand the panel and show the "需要您手动完成验证" banner.
 * Order matters — captcha/login wins over the looser browser_action
 * heuristic because the same question can mention "登录" inside a
 * generic prompt.
 */
export function classifyAwaitingKind(
  question: string,
): SupercarAwaitingKind {
  const t = question.toLowerCase();
  if (
    /验证码|滑块|滑动验证|拼图|captcha|recaptcha|hcaptcha|cloudflare|cf[\-\s]?turnstile|人机验证/.test(
      t,
    )
  ) {
    return 'captcha';
  }
  if (
    /扫码|二维码|扫一扫|scan\s*(?:the\s*)?(?:qr|code)|登录|登入|账号|密码|sign[\-\s]?in|log[\-\s]?in|登出后重新登录/.test(
      t,
    )
  ) {
    return 'login';
  }
  if (
    /请在(?:浏览器|页面|网页|当前页|右(?:边|侧)).*(?:点击|确认|操作|选择|完成|继续)|帮我点(?:一下|击)|请点击(?:一下|页面|按钮)|请前往|请打开(?:页面|这个|该)|在浏览器中(?:点击|确认|完成)/.test(
      t,
    )
  ) {
    return 'browser_action';
  }
  return 'clarification';
}

export function shouldKeepAwaitingOnUserTimeout(
  kind: SupercarAwaitingKind,
): boolean {
  return kind !== 'clarification';
}

/**
 * Sentinel error class so callers can distinguish a wall-clock
 * timeout from any other rejection — `instanceof` is more reliable
 * than string-matching the message and survives error wrapping.
 */
class IterationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IterationTimeoutError';
  }
}

/**
 * Race a promise against a wall-clock timer. Resolves with the
 * promise's value if it completes first; rejects with an
 * `IterationTimeoutError` after `ms` milliseconds. Always clears
 * the timer in `finally` so a long-running winning promise doesn't
 * leak a pending Node timer.
 */
async function callWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IterationTimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Invoke a user callback without letting its failure kill the loop.
 * Swallows thrown errors after logging them.
 */
async function safeCall<T>(fn: ((ev: T) => void | Promise<void>) | undefined, ev: T): Promise<void> {
  if (!fn) return;
  try {
    await fn(ev);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'supercar: callback threw');
  }
}

/**
 * Codex Round 2 P0-3 — last-chance auth-wall probe at deadline.
 *
 * The in-loop park path (line ~1740) already does the full URL +
 * title + body probe before a model-emitted awaiting_user marker.
 * This helper runs the SAME logic synchronously after the deadline
 * fires, so a wall-clock timeout that landed on a login / captcha
 * / permission page reports awaiting_user (recoverable by the user)
 * instead of a dead-end timeout.
 *
 * Body text intentionally skipped — pulling 1KB via page.evaluate
 * on a tab that already raced the clock isn't a great use of the
 * grace window. URL + title cover the common compass.jinritemai
 * /login and explicit captcha cases; the rare body-only signal
 * falls through to the standard timeout verdict.
 */
async function probeTimeoutAuthWall(
  executor: PlaywrightExecutor | null,
): Promise<{ kind: 'login' | 'captcha' | 'permission'; url: string | null } | null> {
  return probeCurrentAuthWall(executor, null, false);
}

async function probeCurrentAuthWall(
  executor: PlaywrightExecutor | null,
  fallbackUrl: string | null,
  includeBody: boolean,
): Promise<{ kind: 'login' | 'captcha' | 'permission'; url: string | null } | null> {
  if (!executor) return null;
  let url: string | null = fallbackUrl;
  let title: string | null = null;
  try {
    const livePage = (await executor.getPage()) as unknown as {
      url?: () => string;
      title?: () => Promise<string> | string;
    };
    if (typeof livePage?.url === 'function') {
      try {
        url = livePage.url();
      } catch {
        /* page torn down between turns */
      }
    }
    if (typeof livePage?.title === 'function') {
      try {
        const t = livePage.title();
        title = (typeof t === 'string' ? t : await t) ?? null;
      } catch {
        /* best-effort */
      }
    }
  } catch {
    return null;
  }
  const body = includeBody ? await readPageText(executor) : null;
  return detectAuthWallSnapshot({ url, title, body });
}

export function detectAuthWallSnapshot(inputs: {
  url: string | null;
  title: string | null;
  body: string | null;
}): { kind: 'login' | 'captcha' | 'permission'; url: string | null } | null {
  const { url, title, body } = inputs;
  if (!url && !title && !body) return null;
  if (detectPermissionWall({ url, title, prominentText: null }).matched) {
    return { kind: 'permission', url };
  }
  if (detectCaptchaPage({ url, title, prominentText: null }).matched) {
    return { kind: 'captcha', url };
  }
  if (detectLoginPage({ url, title, prominentText: null }).matched) {
    return { kind: 'login', url };
  }
  if (body) {
    if (detectPermissionWall({ url: null, title: null, prominentText: body }).matched) {
      return { kind: 'permission', url };
    }
    if (detectCaptchaPage({ url: null, title: null, prominentText: body }).matched) {
      return { kind: 'captcha', url };
    }
    if (detectLoginPage({ url: null, title: null, prominentText: body }).matched) {
      return { kind: 'login', url };
    }
    const siteConfig = matchSiteConfig(url);
    if (siteConfig?.auth?.loginBodyPhrases) {
      const lower = body.toLowerCase();
      for (const phrase of siteConfig.auth.loginBodyPhrases) {
        if (lower.includes(phrase.toLowerCase())) {
          return { kind: 'login', url };
        }
      }
    }
  }
  const siteConfig = matchSiteConfig(url);
  if (siteConfig?.auth?.loginUrlPaths && url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      for (const needle of siteConfig.auth.loginUrlPaths) {
        if (path.includes(needle.toLowerCase())) {
          return { kind: 'login', url };
        }
      }
    } catch {
      /* bad URL shape */
    }
  }
  return null;
}

/**
 * Grab the currently-visible text on the page for anti-bot scanning.
 * Capped at 4KB so a giant DOM doesn't make the regex scan dominate
 * per-turn latency — captcha / block copy lives near the top of the
 * page and is always short. Returns empty string (not null) on any
 * failure so the caller's `if (snapshotText)` branch fails open.
 */
/**
 * Walk a response.content array and find the web_search_tool_result
 * block paired with the given server_tool_use id, returning a flat
 * `{ title, url, snippet? }[]` for the UI. Anthropic's beta types for
 * search results are loose; this duck-types every candidate field.
 *
 * Returns an empty array when no result block matches OR when the
 * matching block carries an error / no usable entries. Never throws.
 */
function extractWebSearchSources(
  content: ReadonlyArray<unknown>,
  serverUseId: string,
): Array<{ title: string; url: string; snippet?: string }> {
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; tool_use_id?: string; content?: unknown };
    if (b.type !== 'web_search_tool_result') continue;
    if (b.tool_use_id !== serverUseId) continue;
    const items = Array.isArray(b.content) ? b.content : [];
    const out: { title: string; url: string; snippet?: string }[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const r = item as { type?: string; title?: string; url?: string; snippet?: string };
      if (r.type !== 'web_search_result') continue;
      const url = typeof r.url === 'string' ? r.url.trim() : '';
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      if (!url || !title) continue;
      const snippet = typeof r.snippet === 'string' ? r.snippet.trim() : undefined;
      out.push(snippet ? { title, url, snippet } : { title, url });
    }
    return out;
  }
  return [];
}

async function readPageText(
  executor: PlaywrightExecutor,
  maxChars = 4096,
): Promise<string> {
  try {
    const page = (await executor.getPage()) as unknown as {
      evaluate: <T>(fn: () => T) => Promise<T>;
    };
    const text = await Promise.race([
      page.evaluate<string>(() => {
        // innerText filters out <script> / <style> blocks and collapses
        // whitespace, which is exactly what we want the regex scanner
        // to see. Fallback to textContent for pages that aren't fully
        // hydrated yet (Cloudflare interstitial has the content in a
        // <noscript> sibling and textContent picks it up regardless).
        // Browser-side cap is a generous upper bound; the Node side
        // slices to the caller's requested maxChars below.
        const body = (globalThis as { document?: { body?: unknown } }).document?.body as
          | { innerText?: string; textContent?: string }
          | undefined;
        if (!body) return '';
        return (body.innerText ?? body.textContent ?? '').slice(0, 20000);
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 1500)),
    ]);
    return (text ?? '').slice(0, maxChars);
  } catch {
    return '';
  }
}

/**
 * Format a byte count for inclusion in a tool_result text block.
 * Local helper so the agent-loop doesn't pull a frontend formatter.
 */
function formatBytesAgent(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
