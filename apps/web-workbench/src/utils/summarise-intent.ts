/**
 * Turn a raw user intent into a short sidebar title. Rule-based; no
 * LLM call. The goal isn't perfect natural-language compression —
 * just "drop the polite filler and keep the subject + verb + object"
 * so a 40-character intent shows its actual content in the 20-char
 * sidebar row instead of just "帮我打开百度搜索今..."
 *
 * Returns the intent unchanged if no rule matches — ensures the
 * user can always find their original wording somewhere in the UI.
 */
export function summariseIntent(intent: string, maxLen = 20): string {
  if (!intent) return '';
  let t = intent.trim();

  // Drop polite opening phrases. Longest-match-first so "能不能" wins
  // before "能".
  const OPENINGS = [
    '麻烦你帮我',
    '麻烦帮我',
    '劳驾帮我',
    '请帮我',
    '能不能帮我',
    '能否帮我',
    '可以帮我吗',
    '可以帮我',
    '你能帮我',
    '你能',
    '你可以',
    '可以',
    '能否',
    '能不能',
    '帮我',
    '帮忙',
    '请',
    '麻烦',
    '劳驾',
    '拜托',
  ];
  for (const o of OPENINGS) {
    if (t.startsWith(o)) {
      t = t.slice(o.length).trimStart();
      break;
    }
  }

  // FIX-57 复审 #1-1d: 「使用云端浏览器，」「用浏览器」 says how, not what — drop it, and
  // name a pasted address by its site so the row tells tasks apart.
  t = t
    .replace(
      /^(?:请)?(?:使用|用|在|通过)?(?:云端|本地|真实)?浏览器(?:里|中|上)?(?:帮我)?[,，、:：\s]*/u,
      '',
    )
    .replace(/(?:打开|访问|进入)\s*(https?:\/\/\S+)\s*/u, (m: string, url: string) => {
      const name = addressName(url);
      return name ? `${name} ` : m;
    })
    .replace(/https?:\/\/\S+/gu, (url) => addressName(url) ?? url)
    .replace(/\s{2,}/g, ' ')
    .trimStart();

  // Drop softening particles anywhere near the start.
  t = t.replace(/^(先|然后|接下来|顺便|顺路)[,，]?\s*/, '');

  // Drop trailing filler: 好吗/好不好/吧/呀/啊/哦
  t = t.replace(/[,，。.?!！]?\s*(好吗|好不好|可以吗|行吗|吧|呀|啊|哦|呢)[?？]?$/, '');

  // Drop "一下 / 一次 / 一会" mid-sentence filler near an action verb
  // so "去东方财富查一下茅台最新股价" → "去东方财富查茅台最新股价".
  t = t.replace(/(查|看|搜|搜索|找|列|整理|打开)一(下|次|会)/g, '$1');

  // Drop trailing explanations that usually don't fit in 20 chars:
  // ", 不超过 xx 条" / ", 谢谢" / ", 详细一点" — any trailing
  // comma + tail > 10 chars.
  const commaIdx = t.search(/[,，]/);
  if (commaIdx > 0 && commaIdx < t.length - 1) {
    const tail = t.slice(commaIdx + 1).trim();
    if (tail.length > maxLen - commaIdx) {
      t = t.slice(0, commaIdx);
    }
  }

  t = t.trim();
  return truncateAtBoundary(t, maxLen);
}

/**
 * FIX-57 复审 #2-3: cut by whole characters (an emoji is one, never half of a surrogate
 * pair), and where possible at a space or punctuation mark near the end.
 */
export function truncateAtBoundary(text: string, maxLen: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLen) return text;
  if (maxLen <= 1) return '…';
  const keep = chars.slice(0, maxLen - 1);
  const floor = Math.ceil((maxLen - 1) / 2);
  for (let i = keep.length - 1; i >= floor; i--) {
    if (/[\s,，。、;；:：!！?？)）」】]/u.test(keep[i] ?? '')) {
      const cut = keep
        .slice(0, /[)）」】]/u.test(keep[i] ?? '') ? i + 1 : i)
        .join('')
        .trim();
      if (cut) return `${cut}…`;
    }
  }
  return `${keep.join('').trim()}…`;
}

const ADDRESS_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)item\.(?:m\.)?jd\.com$/, '京东商品页'],
  [/(^|\.)search\.jd\.com$/, '京东搜索'],
  [/(^|\.)jd\.com$/, '京东'],
  [/(^|\.)xiaohongshu\.com$/, '小红书笔记'],
  [/(^|\.)zhihu\.com$/, '知乎问题'],
  [/(^|\.)douyin\.com$/, '抖音视频'],
  [/(^|\.)amap\.com$/, '高德地图'],
  [/(^|\.)amazon\.[a-z.]+$/, '亚马逊'],
  [/(^|\.)youtube\.com$/, 'YouTube'],
  [/(^|\.)wikipedia\.org$/, '维基百科'],
  [/(^|\.)baike\.baidu\.com$/, '百度百科'],
  [/(^|\.)ctrip\.com$/, '携程'],
];

/** A pasted address of a known site, by the site's name; others stay as written. */
function addressName(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return ADDRESS_NAMES.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}
