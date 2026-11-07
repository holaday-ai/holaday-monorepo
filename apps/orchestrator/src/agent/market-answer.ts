/**
 * FIX-58 P1-10 (live-sh, Saturday, search lane): the five quote fields came back as a markdown
 * table, which a phone shows as five 「表格记录」 cards. A market answer is one paragraph and one
 * source line — the table is said as a sentence: 「今开 3612.15，最高 3660.49，…。」
 */
const MARKET_INTENT_RE =
  /指数|股价|行情|大盘|收盘|开盘|涨跌|点位|涨了|跌了|成交额|\bindex\b|\bstock price\b/i;

const cellsOf = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.replace(/\*\*/g, '').trim());

/** A markdown table block (header, separator, rows) said as one sentence. */
function tableAsSentence(block: string): string {
  const lines = block.split('\n').filter((line) => line.trim());
  const rows = lines
    .slice(2)
    .map(cellsOf)
    .filter((cells) => cells.some(Boolean));
  if (!rows.length) return block;
  return `${rows.map((cells) => cells.filter(Boolean).join(' ')).join('，')}。`;
}

export function marketTableAsText(text: string, intent: string): string {
  if (!MARKET_INTENT_RE.test(intent)) return text;
  return text.replace(
    /(?:^|\n)(\|[^\n]*\|[ \t]*\n\|[\s:|-]+\|[ \t]*\n(?:\|[^\n]*\|[ \t]*(?:\n|$))+)/g,
    (m, block: string) => `${m.startsWith('\n') ? '\n' : ''}${tableAsSentence(block)}\n`,
  );
}
