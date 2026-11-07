import type { Frame } from 'playwright';

/**
 * FIX-29 (FIRECRAWL-1 r7/r8 fc-douyin): a Douyin video page shows its like,
 * comment, favourite and share counts as four bare numbers next to unlabelled
 * icons ("20" "2" "10" "97"), and the model took the share count for the like
 * count. The page's own markup says which counter is which (`data-e2e=
 * "video-player-digg"`, aria-labels, titles, class names): the snapshot marks
 * each such number with its meaning (`[互动=点赞]`), and an answer's
 * engagement number must match the counter of that kind.
 */
export const ENGAGEMENT_KINDS = ['点赞', '评论', '收藏', '分享', '投币', '转发'] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

/** Markup hints (attributes, class names) per kind; the first level that names exactly one kind wins. */
const MARKUP_HINTS: ReadonlyArray<readonly [EngagementKind, string]> = [
  ['点赞', 'digg|(?<!dis)like|thumbs?-?up|upvote|praise|点赞|获赞'],
  ['评论', 'comment|评论'],
  ['收藏', 'collect|favou?rite|bookmark|收藏'],
  ['分享', 'share|分享'],
  ['投币', 'coin|投币'],
  ['转发', 'repost|retweet|forward|转发'],
];

/** Words in a line of page text or an answer that name each kind. */
const KIND_WORD_SOURCES: Record<EngagementKind, string> = {
  点赞: String.raw`点赞|获赞|赞(?!助)|顶|(?<!dis)likes?\b|\blike this video\b|喜欢`,
  评论: String.raw`评论|comments?\b`,
  收藏: String.raw`收藏|favou?rites?\b|bookmarks?\b|saves?\b`,
  分享: String.raw`分享|shares?\b`,
  投币: String.raw`投币|硬币|coins?\b`,
  转发: String.raw`转发|reposts?\b|retweets?\b|forwards?\b`,
};
const KIND_WORDS = Object.fromEntries(
  ENGAGEMENT_KINDS.map((kind) => [kind, new RegExp(KIND_WORD_SOURCES[kind], 'i')]),
) as Record<EngagementKind, RegExp>;

// FIX-36: 「4740\n评论」 is two lines — the unit sits on the number's own line.
const COUNT = String.raw`\d[\d.,]*[ \t]*(?:万|亿|千|[wkm])?\+?`;
/** A snapshot line whose whole text is one count: `- generic [ref=e456]: "20"`. */
const COUNT_LINE = new RegExp(
  String.raw`^(\s*-\s*[\w-]+(?: "[^"]*")?) \[ref=((?:f\d+)?e\d+)\]([^:\n]*): "?(${COUNT})"?$`,
  'i',
);
const MARK = /\[互动=([^\]]+)\]/;

/** "1.2W" / "1,234" / "20 " → "1.2万" / "1234" / "20". */
export function normalizeCount(value: string): string {
  return value
    .replace(/[,\s+]/g, '')
    .replace(/w$/i, '万')
    .toLowerCase();
}

const UNIT: Record<string, number> = { 万: 1e4, 亿: 1e8, 千: 1e3, k: 1e3, m: 1e6 };

/**
 * Whether an answer's count is the page's: 「12000」 is the page's 「1.2万」, also
 * unrounded (「12345」); a page count without a unit is exact (coordinator review 2).
 */
export function sameCount(answer: string, page: string): boolean {
  const parse = (raw: string) => {
    const m = normalizeCount(raw).match(/^(\d+(?:\.\d+)?)(万|亿|千|k|m)?$/);
    return m
      ? {
          n: Number(m[1]),
          unit: m[2] ? UNIT[m[2]]! : 1,
          decimals: m[1]!.split('.')[1]?.length ?? 0,
        }
      : null;
  };
  const a = parse(answer);
  const p = parse(page);
  if (!a || !p) return normalizeCount(answer) === normalizeCount(page);
  const value = a.n * a.unit;
  if (p.unit === 1) return value === p.n;
  // The answer's value at the page's unit, rounded to the page's own precision.
  return Math.abs(value / p.unit - p.n) < 10 ** -p.decimals / 2 + 1e-9;
}

/**
 * In-page: the kind of counter an element showing a bare number belongs to.
 * First its own markup and that of its nearest ancestors (climbing stops at an
 * ancestor holding more than one number — the whole action bar — and a level
 * naming two kinds is ambiguous). Douyin's detail bar has only hashed class
 * names, but the page also carries the same counters marked up in the player
 * (`data-e2e="video-player-digg"` 20, `video-player-share` 97, hidden): a value
 * that exactly one marked counter shows takes that counter's kind. Two marked
 * counters with the same value: no mark rather than a guess.
 *
 * No named local functions: tsx/esbuild keepNames would wrap them in `__name`,
 * which does not exist in the page.
 */
function counterKind(
  element: Element,
  hints: ReadonlyArray<readonly [string, string]>,
): string | null {
  let node: Element | null = element;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    if (depth > 0 && (((node as HTMLElement).innerText ?? '').match(/\d[\d.,]*/g) ?? []).length > 1)
      break;
    const parts = [
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
      node.getAttribute('data-e2e'),
      node.getAttribute('data-testid'),
      node.getAttribute('class'),
    ];
    for (const icon of Array.from(node.querySelectorAll(':scope > svg, :scope > img, :scope > i')))
      parts.push(
        icon.getAttribute('aria-label'),
        icon.getAttribute('alt'),
        icon.getAttribute('title'),
        icon.getAttribute('class'),
      );
    const hint = parts.filter(Boolean).join(' ');
    const kinds = hints
      .filter(([, source]) => new RegExp(source, 'i').test(hint))
      .map(([kind]) => kind);
    if (kinds.length === 1) return kinds[0]!;
    if (kinds.length > 1) return null;
  }
  const value = ((element as HTMLElement).innerText ?? element.textContent ?? '').trim();
  const owners = new Set<string>();
  for (const marked of Array.from(
    element.ownerDocument.querySelectorAll('[data-e2e], [aria-label], [title], [data-testid]'),
  )) {
    if (
      marked.contains(element) ||
      ((marked as HTMLElement).innerText ?? marked.textContent ?? '').trim() !== value
    )
      continue;
    const hint = [
      marked.getAttribute('aria-label'),
      marked.getAttribute('title'),
      marked.getAttribute('data-e2e'),
      marked.getAttribute('data-testid'),
    ]
      .filter(Boolean)
      .join(' ');
    const kinds = hints
      .filter(([, source]) => new RegExp(source, 'i').test(hint))
      .map(([kind]) => kind);
    if (kinds.length === 1) owners.add(kinds[0]!);
    if (kinds.length > 1 || owners.size > 1) return null;
  }
  return owners.size === 1 ? [...owners][0]! : null;
}

const TEXT_COUNT_LINE = new RegExp(String.raw`^(\s*)- text: "?(${COUNT})"?$`, 'i');
const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * Marks each bare count in a snapshot tree with the counter kind the page's
 * markup gives it. A count is its own node (`- generic [ref=e456]: "20"`) or the
 * text of a node beside its icon (`- generic [ref=e5]:` / `- img` / `- text: "20"`);
 * the latter is judged by that node, when it holds no other count.
 */
export async function markEngagementCounts(frame: Frame, tree: string): Promise<string> {
  const lines = tree.split('\n');
  const candidates: Array<{ index: number; ref: string }> = [];
  for (let index = 0; index < lines.length && candidates.length < 40; index += 1) {
    const line = lines[index]!;
    if (MARK.test(line)) continue;
    const own = line.match(COUNT_LINE);
    if (own) {
      candidates.push({ index, ref: own[2]! });
      continue;
    }
    if (!TEXT_COUNT_LINE.test(line)) continue;
    const indent = indentOf(line);
    let parent = index - 1;
    while (parent >= 0 && indentOf(lines[parent]!) >= indent) parent -= 1;
    const ref = parent >= 0 ? lines[parent]!.match(/\[ref=((?:f\d+)?e\d+)\]/)?.[1] : undefined;
    if (!ref) continue;
    let counts = 0;
    for (let j = parent + 1; j < lines.length && indentOf(lines[j]!) >= indent; j += 1)
      if (indentOf(lines[j]!) === indent && TEXT_COUNT_LINE.test(lines[j]!)) counts += 1;
    if (counts === 1) candidates.push({ index, ref });
  }
  // A heavy page with many bare numbers does not hold up the read (review): 3 s in all.
  const deadline = Date.now() + 3000;
  for (const { index, ref } of candidates) {
    if (Date.now() > deadline) break;
    const kind = await frame
      .locator(`aria-ref=${ref}`)
      .evaluate(counterKind, MARKUP_HINTS, { timeout: 1000 })
      .catch(() => null);
    if (!kind) continue;
    lines[index] = /\[ref=/.test(lines[index]!)
      ? lines[index]!.replace(/(\[ref=[^\]]+\])/, `$1 [互动=${kind}]`)
      : lines[index]!.replace(/- text:/, `- text [互动=${kind}]:`);
  }
  return lines.join('\n');
}

/** Engagement numbers an answer states, by kind ("点赞数为「97」", "评论：2", "20 个赞"). */
export function engagementClaims(
  answer: string,
): Array<{ kind: EngagementKind; value: string; text: string }> {
  const claims: Array<{ kind: EngagementKind; value: string; text: string }> = [];
  const kindOf = (word: string) => ENGAGEMENT_KINDS.find((kind) => KIND_WORDS[kind].test(word));
  // FIX-36 (local reg-dy-2): a numbered list's marker is no count — 「3. 点赞数：4740」 is not
  // 「3 点赞」.
  const text = answer.replace(/^([ \t]*)\d{1,3}[.)、][ \t]+/gm, '$1');
  const labelFirst = new RegExp(
    String.raw`(点赞|获赞|评论|收藏|分享|转发|投币|(?<![A-Za-z])(?:likes?|comments?|shares?|favou?rites?|reposts?)\b)(?:数|量|次数|数量|count)?\s*[*\x60]*\s*(?:[:：]|为|是|有)?\s*[「“"']?\s*(${COUNT})(?![\d年月日号:：/-])`,
    'giu',
  );
  for (const m of text.matchAll(labelFirst)) {
    const kind = kindOf(m[1]!);
    if (kind) claims.push({ kind, value: normalizeCount(m[2]!), text: m[0].trim() });
  }
  const numberFirst = new RegExp(
    // On one line: 「4740\n评论数：214」 is two lines, not 「4740 评论」.
    String.raw`(?<![\d.])(${COUNT})[ \t]*(?:个|次|人)?[ \t]*(赞|点赞|评论|收藏|分享|转发|likes?|comments?|shares?)`,
    'giu',
  );
  for (const m of text.matchAll(numberFirst)) {
    const kind = kindOf(m[2]!);
    if (kind && !claims.some((c) => c.kind === kind && c.value === normalizeCount(m[1]!)))
      claims.push({ kind, value: normalizeCount(m[1]!), text: m[0].trim() });
  }
  return claims;
}

/**
 * An answer's engagement number is checked against the page's counters:
 * - the page marks counters of that kind → the number must be one of them;
 * - the number is a counter of another kind → wrong counter;
 * - the number only appears bare (an icon, no label, no kind word on its line)
 *   → which counter it is cannot be told from the page, so it is not delivered.
 * A number with its kind's word on the same line (YouTube's "与另外 471 人一起顶此视频")
 * is fine. Returns the contradictions.
 */
export function assessEngagementClaims(answer: string, pageTexts: readonly string[]): string[] {
  const claims = engagementClaims(answer);
  if (!claims.length) return [];
  const marks = new Map<EngagementKind, Set<string>>();
  const bare = new Set<string>();
  const worded = new Map<EngagementKind, Set<string>>();
  for (const text of pageTexts) {
    for (const raw of text.split(/\\n|\n/)) {
      const line = raw.trim();
      const kind = line.match(MARK)?.[1] as EngagementKind | undefined;
      const count = line.match(new RegExp(String.raw`\]:\s*"?(${COUNT})"?$`, 'i'))?.[1];
      if (kind && count) {
        if (!marks.has(kind)) marks.set(kind, new Set());
        marks.get(kind)!.add(normalizeCount(count));
        continue;
      }
      if (count) bare.add(normalizeCount(count));
      if (new RegExp(String.raw`^"?(${COUNT})"?$`, 'i').test(line))
        bare.add(normalizeCount(line.replace(/"/g, '')));
      // A count next to its kind's word on the same line: "与另外 471 人一起顶此视频", "点赞 1.2万".
      for (const k of ENGAGEMENT_KINDS) {
        const near = new RegExp(
          String.raw`(?:${KIND_WORD_SOURCES[k]})[^\d\n]{0,12}?(${COUNT})|(${COUNT})[^\d\n]{0,12}?(?:${KIND_WORD_SOURCES[k]})`,
          'gi',
        );
        for (const m of line.matchAll(near)) {
          if (!worded.has(k)) worded.set(k, new Set());
          worded.get(k)!.add(normalizeCount(m[1] ?? m[2]!));
        }
      }
    }
  }
  const out: string[] = [];
  for (const claim of claims) {
    const own = marks.get(claim.kind);
    const hit = (values?: Set<string>) =>
      !!values && [...values].some((v) => sameCount(claim.value, v));
    if (hit(own) || hit(worded.get(claim.kind))) continue;
    const other = [...marks].find(([kind, values]) => kind !== claim.kind && hit(values))?.[0];
    if (own?.size) {
      out.push(
        `答案的${claim.kind}数「${claim.value}」与页面不符：页面标注为${claim.kind}的数字是「${[...own].join('、')}」${other ? `，「${claim.value}」标注的是${other}数` : ''}`,
      );
    } else if (other) {
      out.push(
        `答案的${claim.kind}数「${claim.value}」在页面上标注的是${other}数，不是${claim.kind}数`,
      );
    } else if (hit(bare)) {
      out.push(
        `答案的${claim.kind}数「${claim.value}」在页面上只是图标旁的数字，没有标签能确认它是${claim.kind}数；请用 snapshot 查看带 [互动=…] 标注的数字，读不到标签就如实写「无法确认${claim.kind}数」，不要按图标顺序猜`,
      );
    }
  }
  return out;
}
