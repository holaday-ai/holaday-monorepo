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
    '麻烦你帮我', '麻烦帮我', '劳驾帮我', '请帮我', '能不能帮我',
    '能否帮我', '可以帮我吗', '可以帮我', '你能帮我',
    '你能', '你可以', '可以', '能否', '能不能',
    '帮我', '帮忙', '请', '麻烦', '劳驾', '拜托',
  ];
  for (const o of OPENINGS) {
    if (t.startsWith(o)) {
      t = t.slice(o.length).trimStart();
      break;
    }
  }

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
  if (t.length <= maxLen) return t;
  // Trim by char (not byte) so CJK is safe.
  return `${t.slice(0, maxLen - 1).trim()}…`;
}
