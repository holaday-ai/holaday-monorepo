/**
 * FIX-58 P1-10 (live-sh, Saturday, search lane): the five quote fields came back as a markdown
 * table, which a phone shows as five 「表格记录」 cards. A market answer is one paragraph and one
 * source line — the table is said as a sentence: 「今开 3612.15，最高 3660.49，…。」
 *
 * 复审 #1 必须修 2: a task that asks for a table (表 / 表格 / 列表 / table) keeps it, and the
 * sentence keeps the column names — 「上证收盘 3600，涨跌 +0.5%」, never 「上证 3600 +0.5%」.
 */
const MARKET_INTENT_RE =
  /指数|股价|行情|大盘|收盘|开盘|涨跌|点位|涨了|跌了|成交额|\bindex\b|\bstock price\b/i;
const WANTS_TABLE_RE = /表|列表|清单|\btables?\b|\blist\b/i;

/** A header that only says 「the value」: its cells are said bare after the row's name. */
const VALUE_HEADER_RE =
  /^(?:数值|值|数据|结果|内容|最新|最新值|当前|今日|数字|信息|value|values?|data)$/i;

const cellsOf = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.replace(/\*\*/g, '').trim());

/** One row said with its column names: 「上证收盘 3600，涨跌 +0.5%」. */
function rowAsWords(header: readonly string[], cells: readonly string[]): string {
  const [name = '', ...rest] = cells;
  const said = rest
    .map((cell, i) => {
      const column = header[i + 1] ?? '';
      const named = !!column && !VALUE_HEADER_RE.test(column);
      return cell ? { text: named ? `${column} ${cell}` : cell, named } : null;
    })
    .filter((piece): piece is { text: string; named: boolean } => piece !== null);
  const [first, ...others] = said;
  if (!first) return name;
  // The row's name leads a column name without a gap in Chinese: 「上证收盘 3600」; 「今开 3612.15」.
  const gap = first.named && /[一-龥]$/u.test(name) && /^[一-龥]/u.test(first.text) ? '' : ' ';
  return [`${name}${name ? gap : ''}${first.text}`, ...others.map((piece) => piece.text)]
    .join('，')
    .trim();
}

/** A markdown table block (header, separator, rows) said as one sentence. */
function tableAsSentence(block: string): string {
  const lines = block.split('\n').filter((line) => line.trim());
  const header = cellsOf(lines[0] ?? '');
  const rows = lines
    .slice(2)
    .map(cellsOf)
    .filter((cells) => cells.some(Boolean));
  if (!rows.length) return block;
  const said = rows.map((cells) => rowAsWords(header, cells));
  // Key–value rows (「今开 | 3612.15」) read as one list; wider rows each as a clause.
  return `${said.join(header.length > 2 ? '；' : '，')}。`;
}

export function marketTableAsText(text: string, intent: string): string {
  if (!MARKET_INTENT_RE.test(intent) || WANTS_TABLE_RE.test(intent)) return text;
  return text.replace(
    /(?:^|\n)(\|[^\n]*\|[ \t]*\n\|[\s:|-]+\|[ \t]*\n(?:\|[^\n]*\|[ \t]*(?:\n|$))+)/g,
    (m, block: string) => `${m.startsWith('\n') ? '\n' : ''}${tableAsSentence(block)}\n`,
  );
}

/** A citation link's lead-in: 「数据来自[X](…)」「打开[X](…)」 already say what the link is. */
const LINK_LEAD_RE = /(?:来自|来源[：:]?|出自|据|见|参考|查看|打开|访问|在|从|via|see|from)\s*$/iu;

/**
 * 复审 #1 建议修 (「今天北京天气」): a source link glued to the sentence before it (「…暴雪黄色预警
 * [中国天气网](…)。」) reads as part of the sentence — it is set apart as 「（来源：[中国天气网](…)）」. A
 * link followed by a space before Chinese (「[中央气象台](…) 实况」) loses the space.
 */
export function withSourceLinksApart(text: string): string {
  if (!/[一-龥]/u.test(text)) return text;
  return text
    .replace(
      /(\S)(\[[^\]\n]{1,30}\]\(https?:\/\/[^)\s]+\))(?=[。；;，,！!？?]|\s*$|\n)/gmu,
      (m, before: string, link: string, offset: number, whole: string) => {
        if (!/[一-龥A-Za-z0-9）)%℃*]/u.test(before)) return m;
        if (LINK_LEAD_RE.test(whole.slice(Math.max(0, offset - 8), offset + 1))) return m;
        return `${before}（来源：${link}）`;
      },
    )
    .replace(/(\]\(https?:\/\/[^)\s]+\))[ \t]+(?=[一-龥])/gu, '$1');
}
