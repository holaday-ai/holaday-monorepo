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
  // GOAL2 H1: Xiaohongshu's comment counter is `chat-wrapper`; Bilibili's favourite is `video-fav`.
  ['评论', 'comment|chat-wrapper|评论'],
  ['收藏', 'collect|favou?rite|(?:^|[\\s_-])fav(?:$|[\\s_-])|bookmark|收藏'],
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

/**
 * GOAL2 H1 (G6 r5 xhs-read): a note page also shows each comment's own 点赞 / 回复 counters and the
 * related cards' counters, with the same class names as the note's bar (`like-wrapper`). A counter
 * under one of these ancestors is another item's: it is marked `[互动=点赞·其他条目]`, never the
 * note's own 点赞.
 */
const OTHER_ITEM_SCOPE = String.raw`comment-?item|comment-inner|comment-?list|comments?-(?:el|container|wrap)|reply-?(?:item|list)|sub-comment|parent-comment|related|recommend|rec-list|note-item|feeds?-(?:container|list|item)|video-page-card|card-box`;
export const OTHER_ITEM = '·其他条目';
const MARKUP = { hints: MARKUP_HINTS, scope: OTHER_ITEM_SCOPE };

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
  { hints, scope }: { hints: ReadonlyArray<readonly [string, string]>; scope: string },
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
    if (kinds.length > 1) return null;
    if (kinds.length === 1) {
      // GOAL2 H1: a comment's or a related card's counter is that item's, not the page's own.
      const other = new RegExp(scope, 'i');
      let up = node.parentElement;
      for (let i = 0; up && i < 25; i += 1, up = up.parentElement)
        if (
          other.test(
            [up.getAttribute('class'), up.getAttribute('id'), up.getAttribute('data-e2e')]
              .filter(Boolean)
              .join(' '),
          )
        )
          return `${kinds[0]!}·其他条目`;
      return kinds[0]!;
    }
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
      .evaluate(counterKind, MARKUP, { timeout: 1000 })
      .catch(() => null);
    if (!kind) continue;
    lines[index] = /\[ref=/.test(lines[index]!)
      ? lines[index]!.replace(/(\[ref=[^\]]+\])/, `$1 [互动=${kind}]`)
      : lines[index]!.replace(/- text:/, `- text [互动=${kind}]:`);
  }
  return lines.join('\n');
}

/**
 * GOAL2 H1: in-page, every counter the page's own markup names (its icon's class, its aria-label,
 * its data-e2e), for the page's own item only — a comment's or a related card's counters are left
 * out, and a value two kinds both claim tells nothing (FIX-29 `/same`). A heavy page's snapshot
 * reaches its 40-count cap inside the comments before the note's own bar (G6 r5 xhs-read: the
 * note's 1584 was never marked, a comment's 「1」 was); this reads the whole document once.
 * No named local functions (see counterKind).
 */
function documentCounters({
  hints,
  scope,
}: {
  hints: ReadonlyArray<readonly [string, string]>;
  scope: string;
}): Array<{ kind: string; value: string }> {
  const found: Array<{ kind: string; value: string; shown: boolean }> = [];
  const other = new RegExp(scope, 'i');
  const number = /^\d[\d.,]*\s*(?:万|亿|千|[wkm])?\+?$/i;
  const elements = document.querySelectorAll('span,div,a,button,strong,b,em,i,p,li,dd,label');
  for (let at = 0; at < elements.length && at < 25000 && found.length < 40; at += 1) {
    const element = elements[at]!;
    if (element.children.length > 2) continue;
    const raw = (element.textContent ?? '').trim();
    if (raw.length > 12 || !number.test(raw)) continue;
    // The innermost element holding the number speaks for it.
    if (Array.from(element.children).some((child) => (child.textContent ?? '').trim() === raw))
      continue;
    let kind: string | null = null;
    let owner: Element | null = null;
    let node: Element | null = element;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      if (depth > 0 && ((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []).length > 1) break;
      const parts = [
        node.getAttribute('aria-label'),
        node.getAttribute('title'),
        node.getAttribute('data-e2e'),
        node.getAttribute('data-testid'),
        node.getAttribute('class'),
      ];
      for (const icon of Array.from(
        node.querySelectorAll(':scope > svg, :scope > img, :scope > i'),
      ))
        parts.push(
          icon.getAttribute('aria-label'),
          icon.getAttribute('alt'),
          icon.getAttribute('title'),
          icon.getAttribute('class'),
        );
      const hint = parts.filter(Boolean).join(' ');
      const kinds = hints
        .filter(([, source]) => new RegExp(source, 'i').test(hint))
        .map(([name]) => name);
      if (kinds.length > 1) break;
      if (kinds.length === 1) {
        kind = kinds[0]!;
        owner = node;
        break;
      }
    }
    if (!kind || !owner) continue;
    let mine = true;
    let up = owner.parentElement;
    for (let i = 0; up && i < 25; i += 1, up = up.parentElement)
      if (
        other.test(
          [up.getAttribute('class'), up.getAttribute('id'), up.getAttribute('data-e2e')]
            .filter(Boolean)
            .join(' '),
        )
      ) {
        mine = false;
        break;
      }
    if (!mine) continue;
    const value = raw.replace(/\s+/g, '');
    const shown = element.getClientRects().length > 0;
    if (
      !found.some((entry) => entry.kind === kind && entry.value === value && entry.shown === shown)
    )
      found.push({ kind, value, shown });
  }
  // 复审 #10: a kind shown on screen speaks for itself; a hidden copy (Douyin's player bar, a
  // preloaded next video) only where nothing of that kind is shown.
  const kept = found.filter(
    (entry) => entry.shown || !found.some((two) => two.kind === entry.kind && two.shown),
  );
  const unique: Array<{ kind: string; value: string }> = [];
  for (const entry of kept)
    if (!unique.some((one) => one.kind === entry.kind && one.value === entry.value))
      unique.push({ kind: entry.kind, value: entry.value });
  return unique.filter(
    (entry) => !unique.some((two) => two.value === entry.value && two.kind !== entry.kind),
  );
}

export const PAGE_COUNTERS_HEAD =
  '页面计数（页面标记在图标 / 标签旁的数字，只含这一项自己的；评论、推荐里的不算）：';

/** The page's own labelled counters as lines `engagementFindings` reads as marks; '' when none. */
export async function pageCountersBlock(frame: Frame): Promise<string> {
  // 复审 #10: a heavy page does not hold up the read.
  const found = await Promise.race([
    frame.evaluate(documentCounters, MARKUP),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
  ]).catch(() => [] as Array<{ kind: string; value: string }>);
  if (!found.length) return '';
  return [
    PAGE_COUNTERS_HEAD,
    ...found.slice(0, 12).map(({ kind, value }) => `- 计数 [互动=${kind}]: "${value}"`),
  ].join('\n');
}

/** Engagement numbers an answer states, by kind ("点赞数为「97」", "评论：2", "20 个赞"). */
export interface EngagementClaim {
  kind: EngagementKind;
  value: string;
  text: string;
  /** The number as the answer writes it (「1,584」), and where it starts in the answer. */
  raw: string;
  index: number;
  /** 「1584 个赞」: the number comes before its word. */
  numberFirst?: boolean;
}

/** Every engagement number the answer states, each time it states it (GOAL2 H1 复审 #2). */
export function engagementClaims(answer: string): EngagementClaim[] {
  const claims: EngagementClaim[] = [];
  const kindOf = (word: string) => ENGAGEMENT_KINDS.find((kind) => KIND_WORDS[kind].test(word));
  // FIX-36 (local reg-dy-2): a numbered list's marker is no count — 「3. 点赞数：4740」 is not
  // 「3 点赞」. Blanked, not cut, so every index is the answer's own.
  const text = answer.replace(
    /^([ \t]*)(\d{1,3}[.)、])(?=[ \t])/gm,
    (_, lead: string, marker: string) => `${lead}${' '.repeat(marker.length)}`,
  );
  // GOAL2 H1 复审 #3: 「点赞数：**217**」 and 「| 点赞数 | **217** |」 are claims too.
  const labelFirst = new RegExp(
    String.raw`(点赞|获赞|评论|收藏|分享|转发|投币|(?<![A-Za-z])(?:likes?|comments?|shares?|favou?rites?|reposts?)\b)(?:数|量|次数|数量|count)?\s*[*\x60]*\s*(?:\|\s*)?(?:[:：]|为|是|有)?\s*[*\x60]*\s*[「“"']?\s*(${COUNT})(?![\d年月日号:：/-])`,
    'giud',
  );
  for (const m of text.matchAll(labelFirst)) {
    const kind = kindOf(m[1]!);
    if (!kind) continue;
    const raw = m[2]!.trim();
    claims.push({
      kind,
      value: normalizeCount(raw),
      text: m[0].trim(),
      raw,
      index: m.indices![2]![0],
    });
  }
  const numberFirst = new RegExp(
    // On one line: 「4740\n评论数：214」 is two lines, not 「4740 评论」. 复审 #9: 「点赞最高的 3 个
    // 评论」「前 5 条评论」 count the items listed, not a counter.
    String.raw`(?<![\d.])(?<!(?<![目当此之提以先])前\s{0,2}|最[高多]的?\s{0,2}|top\s{0,2})(${COUNT})[ \t]*(?:个|次|人)?[ \t]*(赞|点赞|评论|收藏|分享|转发|likes?|comments?|shares?)`,
    'giud',
  );
  for (const m of text.matchAll(numberFirst)) {
    const kind = kindOf(m[2]!);
    if (!kind) continue;
    const index = m.indices![1]![0];
    if (claims.some((c) => c.index === index)) continue;
    const raw = m[1]!.trim();
    claims.push({
      kind,
      value: normalizeCount(raw),
      text: m[0].trim(),
      raw,
      index,
      numberFirst: true,
    });
  }
  return claims.sort((a, b) => a.index - b.index);
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
  return engagementFindings(answer, pageTexts).contradictions;
}

export interface EngagementOptions {
  /**
   * GOAL2 H1 复审 #5: the request is about several items (a search's notes, a note's comments):
   * their own counters are what it asks for, so 「·其他条目」 marks pair too.
   */
  manyItems?: boolean;
}

/**
 * A request about several items or a note's comments, said in so many words (「前 5 条笔记」「每条」
 * 「热门评论」). 复审 #2-4: 「点赞、评论、收藏」「搜索…打开第一篇」「结果」 are about one item.
 */
const N = '(?:\\d+|[一二三四五六七八九十两几百]+)';
export const MANY_ITEMS_RE = new RegExp(
  [
    `前\\s*${N}\\s*(?:条|个|篇|名|位|项)`,
    // 复审 #3-3: 「5 条笔记」「三篇笔记」「几个视频」; two or more, never 「一条」.
    `(?<![\\d])(?:[2-9]|\\d{2,}|[二三四五六七八九十两几])\\s*(?:条|篇|个)\\s*(?:笔记|视频|评论|帖子|结果|内容|回答)`,
    // 复审 #4-2: 「列出」「搜索结果」「评论区」 only with a number or a many-word after them.
    `列出\\s*(?:前\\s*)?(?:${N}|所有|全部|各|每|这些)`,
    `搜索结果(?:里|中|的)?[^，。,；;]{0,6}(?:最多|最高|每|各|前|所有|全部|几)`,
    `评论区(?:里|中|的)?[^，。,；;]{0,6}(?:点赞|赞数|最多|最高|热门|每|各|前)`,
    `最[高多]的?\\s*${N}?\\s*(?:条|个)?\\s*(?:评论|笔记|视频)`,
    '每(?:条|个|篇|一条|一个|一篇)|各(?:条|个|篇)',
    '(?:热门|精选|最新|高赞)评论',
    '(?:这些|多条|几条)(?:笔记|评论|视频|结果)',
    '\\btop[-\\s]?(?:\\d+|liked|rated)\\b',
    '\\bfirst\\s+(?:\\d+|two|three|four|five|six|seven|eight|nine|ten)\\b',
    '\\b(?:each|every)\\s+(?:note|post|video|comment|result)\\b',
  ].join('|'),
  'i',
);

/** 复审 #4-2: 「第 3 篇」「第十二个」 name one item; they are taken out before the request is read. */
export function manyItemsRequest(intent: string): boolean {
  return MANY_ITEMS_RE.test(
    intent.replace(new RegExp(`第\\s*${N}\\s*(?:条|篇|个|名|位|项)`, 'g'), ''),
  );
}

type Verdict =
  | { claim: EngagementClaim; kind: 'paired' | 'unchecked' }
  | { claim: EngagementClaim; kind: 'contradiction' | 'unverified'; message: string };

/**
 * G7 (G6 r5 xhs-read, tsk f24-cuxBxon1): the run read 「1584」 from the note's own bar
 * (get_page_text 「评论\n1584\n1823\n24」), but a comment's like button was marked 点赞 「1」, the
 * check said 「页面标注为点赞的数字是「1」」 and the answer was changed to 「点赞数：1」 to pass. A
 * page marks other items' counters too (comments, related notes), so a number the run did read
 * from the page, marked as no other kind, is not contradicted by a different 点赞 mark: it is
 * delivered with an 未核实 note instead, and no message ever offers another number to switch to.
 *
 * GOAL2 H1: one verdict per number as written — the loop's check and the delivery rule
 * (settleUnpairedCounts) read the same verdicts, so what goes out 「未能核实」 is exactly what the
 * check could not pair.
 */
function claimVerdicts(
  answer: string,
  pageTexts: readonly string[],
  options: EngagementOptions = {},
): Verdict[] {
  const claims = engagementClaims(answer);
  if (!claims.length) return [];
  const page = readCounters(pageTexts);
  const { marks, bare, worded } = page;
  // 复审 #2-3: only a request about several items pairs their own counters; for one item another
  // item's counter is never its, marked page or not.
  const pairsOthers = options.manyItems === true;
  return claims.map((claim): Verdict => {
    const hit = (values?: Set<string>) =>
      !!values && [...values].some((v) => sameCount(claim.value, v));
    const own = new Set([
      ...(marks.get(claim.kind) ?? []),
      ...(pairsOthers ? (marks.get(`${claim.kind}${OTHER_ITEM}`) ?? []) : []),
    ]);
    if (hit(own) || hit(worded.get(claim.kind))) return { claim, kind: 'paired' };
    const other = [...marks].find(
      ([kind, values]) =>
        kind !== claim.kind &&
        !(pairsOthers && kind === `${claim.kind}${OTHER_ITEM}`) &&
        hit(values),
    )?.[0];
    // GOAL2 H1: a comment's or a related card's counter (「1」 under a comment) is never this one's.
    const otherItem = other?.endsWith(OTHER_ITEM) ? other.slice(0, -OTHER_ITEM.length) : null;
    const say = (kind: 'contradiction' | 'unverified', message: string): Verdict => ({
      claim,
      kind,
      message,
    });
    if (otherItem)
      return say(
        'contradiction',
        `答案的${claim.kind}数「${claim.value}」在页面上是评论或推荐里其他条目的${otherItem}数，不是这一项的${
          own.size ? `：这一项标注为${claim.kind}的数字是「${[...own].join('、')}」` : ''
        }；确认不了就如实写「${claim.kind}数未能核实」`,
      );
    if (own.size && !other && hit(bare))
      return say(
        'unverified',
        `${claim.kind}数「${claim.value}」（页面上另有标为${claim.kind}的数字，可能属于评论等其他内容）`,
      );
    if (own.size && !other)
      return say(
        'contradiction',
        `答案的${claim.kind}数「${claim.value}」在已读页面上没有找到（页面上标为${claim.kind}的数字也可能属于评论等其他内容）：只写你在页面上确认属于这一项的数字；确认不了就如实写「${claim.kind}数未能核实」，不要为了通过核对改成页面上别的数字`,
      );
    if (own.size)
      // A definite wrong counter (FIX-29 Douyin 97 = 分享): the page's own mark may be named.
      return say(
        'contradiction',
        `答案的${claim.kind}数「${claim.value}」在页面上标注的是${other}数，不是${claim.kind}数：页面标注为${claim.kind}的数字是「${[...own].join('、')}」；确认不了就如实写「${claim.kind}数未能核实」`,
      );
    if (other)
      return say(
        'contradiction',
        `答案的${claim.kind}数「${claim.value}」在页面上标注的是${other}数，不是${claim.kind}数`,
      );
    if (hit(bare))
      return say(
        'contradiction',
        `答案的${claim.kind}数「${claim.value}」在页面上只是图标旁的数字，没有标签能确认它是${claim.kind}数；请用 snapshot 查看带 [互动=…] 标注的数字，读不到标签就如实写「无法确认${claim.kind}数」，不要按图标顺序猜`,
      );
    // GOAL2 H1 (r5a1 xhs: 217 / 3052): a counter page, and the number is nowhere on it.
    if (page.marked && !page.anywhere(claim.value))
      return say(
        'contradiction',
        `答案的${claim.kind}数「${claim.value}」在已读页面上没有出现：只写页面上和这一项的图标 / 标签直接相邻的数字；读不到就如实写「${claim.kind}数未能核实」，不要估计或编数字`,
      );
    return { claim, kind: 'unchecked' };
  });
}

export function engagementFindings(
  answer: string,
  pageTexts: readonly string[],
  options: EngagementOptions = {},
): { contradictions: string[]; unverified: string[] } {
  const contradictions: string[] = [];
  const unverified: string[] = [];
  for (const verdict of claimVerdicts(answer, pageTexts, options)) {
    if (verdict.kind !== 'contradiction' && verdict.kind !== 'unverified') continue;
    // One line per number, however often the answer repeats it (local g7y2 / g7y3).
    const list = verdict.kind === 'contradiction' ? contradictions : unverified;
    if (!list.includes(verdict.message)) list.push(verdict.message);
  }
  return { contradictions, unverified };
}

/** What the read pages say about counters: marked values by kind, bare numbers, worded ones. */
function readCounters(pageTexts: readonly string[]) {
  const marks = new Map<string, Set<string>>();
  const bare = new Set<string>();
  const worded = new Map<EngagementKind, Set<string>>();
  const numbers = new Set<string>();
  // A tool result as it came (JSON): its escaped quotes and line breaks read as the page's.
  for (const text of pageTexts.map((one) => one.replace(/\\"/g, '"'))) {
    // 复审 #8: an element id (`[ref=e217]`) or a link address is no number the page shows.
    const shown = text
      .replace(/\[ref=[^\]]*\]/g, ' ')
      .replace(/(?:^|\\n|\n)\s*-\s*\/url:[^\n\\]*/g, '\n')
      .replace(/https?:\/\/[^\s"'\\)]+/g, ' ');
    for (const m of shown.matchAll(new RegExp(COUNT, 'gi'))) numbers.add(normalizeCount(m[0]));
    for (const raw of text.split(/\\n|\n/)) {
      const line = raw.trim();
      const kind = line.match(MARK)?.[1];
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
  return {
    marks,
    bare,
    worded,
    /** The page marks counters at all (a social / video page), so its counters can be paired. */
    marked: marks.size > 0,
    anywhere: (value: string) => [...numbers].some((n) => sameCount(value, n)),
  };
}

const KIND_EN: Record<EngagementKind, string> = {
  点赞: 'like count',
  评论: 'comment count',
  收藏: 'favourite count',
  分享: 'share count',
  投币: 'coin count',
  转发: 'repost count',
};

/**
 * GOAL2 H1 — the delivery rule for counters: a number the check could not pair with its counter
 * (a guess, another counter's, a comment's, one the page shows only beside an unlabelled icon) is
 * written 「未能核实」 where it stands, every time the answer states it; no other number is put in
 * its place. A number the check leaves alone (no counter on the page to pair it with, shown with
 * words around it) is left as it is.
 */
export function settleUnpairedCounts(
  answer: string,
  pageTexts: readonly string[],
  options: EngagementOptions & { english?: boolean } = {},
): { answer: string; settled: EngagementKind[] } {
  const unpaired = claimVerdicts(answer, pageTexts, options).filter(
    (verdict) => verdict.kind === 'contradiction' || verdict.kind === 'unverified',
  );
  if (!unpaired.length) return { answer, settled: [] };
  let out = answer;
  // From the end, so each earlier index still holds.
  for (const { claim } of [...unpaired].reverse()) {
    if (out.slice(claim.index, claim.index + claim.raw.length) !== claim.raw) continue;
    if (claim.numberFirst) {
      const end = answer.indexOf(claim.text, claim.index) + claim.text.length;
      if (end < claim.index + claim.raw.length) continue;
      const written = options.english
        ? `${KIND_EN[claim.kind]} not verified`
        : `${claim.kind}数未能核实`;
      out = `${out.slice(0, claim.index)}${written}${out.slice(end)}`;
    } else {
      out = `${out.slice(0, claim.index)}${options.english ? 'not verified' : '未能核实'}${out.slice(claim.index + claim.raw.length)}`;
    }
  }
  const settled: EngagementKind[] = [];
  for (const { claim } of unpaired) if (!settled.includes(claim.kind)) settled.push(claim.kind);
  return { answer: out, settled };
}

/** Engagement kinds a line names (「点赞数在未登录时不显示」 → 点赞). */
export function engagementKindsIn(line: string): EngagementKind[] {
  return ENGAGEMENT_KINDS.filter((kind) => KIND_WORDS[kind].test(line));
}
