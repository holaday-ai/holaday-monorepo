/**
 * Phase 14 — Site Playbook 服务。
 *
 * - matchPlaybooks(intent)        基于任务文本匹配涉及的网站
 * - getPlaybook(urlOrDomain)      已知 URL/域名查手册
 * - formatForPrompt(playbooks)    渲染 user-message 注入块
 * - getRecommendedLane(domain)    cold-start 路由推荐（stats < 3 时使用）
 *
 * 注入点：tasks.ts 在调 runSupercarTask 之前，把 matchPlaybooks 的
 * 结果交给 formatForPrompt，再以 playbookContext 字段递给 agent-loop。
 * agent-loop 把 playbookContext 拼到 intentBlock 的尾部（同一 user
 * message 内），不进 system prompt — 不破坏 prompt cache。
 */

import { PLAYBOOKS, type PlaybookLane, type SitePlaybook } from './site-playbooks.js';
import { extractDomain } from './stats-service.js';

const CLAUSE_BOUNDARY = /[，。；、,;！？!？\n]/;
const NEGATED_SITE_PREFIX_CN =
  /(?:不要|别|无需|无须|不用|不需要|不必|禁止|请勿|勿)\s*(?:(?:打开|访问|进入|使用|搜索|查询|浏览|前往|去|用)\s*(?:在\s*)?)?$/i;
const NEGATED_SITE_PREFIX_EN =
  /\b(?:do\s+not|don't|never|without)\s*(?:(?:open|visit|use|search|browse|go\s+to)\s*)?(?:on\s+)?$/i;
const NEGATED_SITE_SUFFIX_CN = /^(?:打开|访问|进入|使用|搜索|查询|浏览)/i;

function isNegatedSiteMention(text: string, start: number, length: number): boolean {
  const before = text.slice(0, start);
  const after = text.slice(start + length);
  const clauseStart = Math.max(
    ...Array.from(before.matchAll(new RegExp(CLAUSE_BOUNDARY.source, 'g')), (match) =>
      match.index === undefined ? -1 : match.index,
    ),
    -1,
  );
  const clauseEndOffset = after.search(CLAUSE_BOUNDARY);
  const prefix = before.slice(clauseStart + 1).trim();
  const suffix = (clauseEndOffset < 0 ? after : after.slice(0, clauseEndOffset)).trim();

  if (NEGATED_SITE_PREFIX_CN.test(prefix) || NEGATED_SITE_PREFIX_EN.test(prefix)) return true;

  return (
    /(?:不要|别|无需|无须|不用|不需要|不必|禁止|请勿|勿)\s*(?:在|用)\s*$/i.test(prefix) &&
    NEGATED_SITE_SUFFIX_CN.test(suffix)
  );
}

function hasNonNegatedMention(text: string, alias: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerAlias = alias.toLowerCase();
  let start = lowerText.indexOf(lowerAlias);

  while (start >= 0) {
    if (!isNegatedSiteMention(lowerText, start, lowerAlias.length)) return true;
    start = lowerText.indexOf(lowerAlias, start + lowerAlias.length);
  }

  return false;
}

/**
 * 直接按域名/URL 取手册。子域名会回退到根域名（search.jd.com → jd.com）。
 */
export function getPlaybook(urlOrDomain: string | null | undefined): SitePlaybook | null {
  if (!urlOrDomain) return null;
  const root = extractDomain(urlOrDomain);
  if (!root) return null;
  const exactPlaybook = PLAYBOOKS[root];
  if (exactPlaybook) return exactPlaybook;
  // Sub-domain fallback: e.g. "list.tmall.com" → "tmall.com".
  for (const [key, pb] of Object.entries(PLAYBOOKS)) {
    if (root.endsWith(`.${key}`)) return pb;
  }
  return null;
}

/**
 * 任务描述里挑出涉及的网站。优先匹配中文名（substring），其次域名
 * （substring），最后英文名（case-insensitive substring 但要求名称
 * 长度 ≥ 4 以避免 "Bing" 误中 "binge" 之类）。
 *
 * 同一手册命中多次只算一次。
 */
export function matchPlaybooks(taskDescription: string | null | undefined): SitePlaybook[] {
  if (!taskDescription) return [];
  const matched: SitePlaybook[] = [];
  const seen = new Set<string>();
  for (const pb of Object.values(PLAYBOOKS)) {
    if (seen.has(pb.domain)) continue;
    const aliases = [pb.name, pb.domain, pb.nameEn && pb.nameEn.length >= 4 ? pb.nameEn : null];
    const hit = aliases.some((alias) => alias && hasNonNegatedMention(taskDescription, alias));
    if (hit) {
      matched.push(pb);
      seen.add(pb.domain);
    }
  }
  return matched;
}

/**
 * 渲染 playbook 列表为 user-message 注入块。空数组返回空字符串
 * （调用方仅在非空时拼接）。结构和 MemoryService.formatForPrompt
 * 一致：`---` 分隔，方便模型把它当作"上下文盒子"处理。
 */
export function formatForPrompt(playbooks: SitePlaybook[]): string {
  if (playbooks.length === 0) return '';
  const lines: string[] = ['---', '以下网站你可能会用到，这是操作手册：'];
  for (const pb of playbooks) {
    const header = `【${pb.name}】(${pb.domain})`;
    lines.push('');
    lines.push(header);
    lines.push(`- 操作提示：${pb.tips}`);
    if (pb.loginRequired === true) {
      lines.push('- 登录要求：必须登录');
    } else if (pb.loginRequired === 'partial') {
      lines.push(`- 登录要求：${pb.loginTrigger ?? '部分功能'}需要登录`);
    }
    if (pb.preferredLane === 'brave_api') {
      lines.push('- 路由建议：优先用搜索 API 获取信息，减少浏览器访问');
    }
    if (pb.antiBot === 'high') {
      lines.push('- 反爬警告：访问要谨慎控制频率，频繁访问会触发验证码或封 IP');
    }
    if (pb.commonPitfalls && pb.commonPitfalls.length > 0) {
      lines.push(`- 常见坑：${pb.commonPitfalls.join('；')}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Cold-start 路由推荐 — stats 不足 3 样本时由 ExecutionRouter 调用。
 * 命中 playbook 返回 preferredLane，否则 null。
 */
export function getRecommendedLane(urlOrDomain: string | null | undefined): PlaybookLane | null {
  const pb = getPlaybook(urlOrDomain);
  return pb?.preferredLane ?? null;
}

/**
 * 对外暴露的合并入口：给一段任务文本，返回准备注入的字符串。空返回空。
 * tasks.ts 直接 `const playbookPreamble = composePlaybookPreamble(intent)` 即可。
 */
export function composePlaybookPreamble(taskDescription: string | null | undefined): string {
  return formatForPrompt(matchPlaybooks(taskDescription));
}
