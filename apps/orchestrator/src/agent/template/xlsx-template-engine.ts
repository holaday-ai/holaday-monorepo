/**
 * xlsx template engine (Phase 1 #1, M3) — extract placeholders from, and
 * fill, a user-uploaded .xlsx template, PRESERVING cell styles.
 *
 * 架构裁决四: SheetJS (the `xlsx` dep) writes back losing styles; exceljs
 * reads-modifies-writes keeping fonts / fills / borders / number formats.
 * SheetJS stays for data-file PARSING (parsers.ts); exceljs owns template
 * fill. Same `{field}` / `{#loop}…{/loop}` syntax as docx (裁决五), here
 * implemented over cells/rows.
 *
 * v1 scope: simple `{field}` substitution (any sheet, style preserved) +
 * SINGLE-ROW loops ({#items}…{/items} markers within one row → that row
 * is duplicated per data row). Multi-row loop bodies and nested loops are
 * a documented follow-up — fill() fails honestly rather than mis-render.
 *
 * Async (exceljs load/writeBuffer are async); the runner awaits it.
 */

import ExcelJS from 'exceljs';
import type {
  PlaceholderField,
  PlaceholderSchema,
  FillData,
  FillRow,
} from './placeholder-schema.js';

export class XlsxTemplateError extends Error {
  constructor(
    message: string,
    readonly kind: 'parse' | 'render' | 'unsupported' | 'empty',
  ) {
    super(message);
    this.name = 'XlsxTemplateError';
  }
}

const TAG_RE = /\{([#/]?)([^{}]+)\}/g;

type TagKind = 'field' | 'open' | 'close';
interface TagOcc {
  readonly row: number;
  readonly kind: TagKind;
  readonly name: string;
}

export async function extractPlaceholders(buf: Buffer): Promise<PlaceholderSchema> {
  const wb = await load(buf);
  const occ = collectTags(wb);
  const { fields } = buildSchema(occ);
  return { format: 'xlsx', fields };
}

export async function fill(
  buf: Buffer,
  data: FillData,
): Promise<{ buffer: Buffer; skippedLoops: string[] }> {
  const wb = await load(buf);
  const skippedLoops: string[] = [];

  // 1. Expand loops first — bottom-to-top so earlier-row spans keep their
  //    indices while later spans grow/shrink. Single-row bodies use
  //    duplicateRow (style-preserving); MULTI-row bodies ({#x}…{/x} spanning
  //    rows) use block duplication (P0 / E10 fix — previously these were
  //    skipped, losing all loop data). A loop that throws on an unusual
  //    template (e.g. merged body cells) degrades to a skip rather than
  //    crashing the whole fill; the runner then flags it.
  for (const sheet of worksheets(wb)) {
    const loops = findLoopSpans(sheet);
    for (const loop of [...loops].sort((a, b) => b.startRow - a.startRow)) {
      const rows = Array.isArray(data[loop.name]) ? (data[loop.name] as FillRow[]) : [];
      try {
        if (loop.startRow === loop.endRow) {
          expandSingleRowLoop(sheet, loop, rows);
        } else {
          expandMultiRowLoop(sheet, loop, rows);
        }
      } catch {
        if (!skippedLoops.includes(loop.name)) skippedLoops.push(loop.name);
      }
    }
  }

  // 2. Substitute simple fields in every remaining cell. Loop rows no
  //    longer carry tags, so this only touches top-level placeholders.
  for (const sheet of worksheets(wb)) {
    eachCell(sheet, (cell) => {
      const text = cellText(cell);
      if (!text || !text.includes('{')) return;
      const next = substitute(text, (name, kind) => {
        if (kind !== 'field') return ''; // stray markers → blank
        const v = data[name];
        return typeof v === 'string' ? v : '';
      });
      setCellText(cell, next);
    });
  }

  let out: ArrayBuffer | Buffer;
  try {
    out = await wb.xlsx.writeBuffer();
  } catch (err) {
    throw new XlsxTemplateError(
      err instanceof Error ? `xlsx 生成失败：${err.message}` : 'xlsx 生成失败',
      'render',
    );
  }
  const buffer = Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
  if (buffer.length === 0) throw new XlsxTemplateError('生成的 xlsx 为空', 'empty');
  return { buffer, skippedLoops };
}

// ---------------------------------------------------------------------------
// Schema extraction
// ---------------------------------------------------------------------------

function collectTags(wb: ExcelJS.Workbook): TagOcc[] {
  const occ: TagOcc[] = [];
  for (const sheet of worksheets(wb)) {
    eachCell(sheet, (cell, rowNumber) => {
      const text = cellText(cell);
      if (!text) return;
      for (const m of text.matchAll(TAG_RE)) {
        const name = (m[2] ?? '').trim();
        if (!name) continue;
        const kind: TagKind = m[1] === '#' ? 'open' : m[1] === '/' ? 'close' : 'field';
        occ.push({ row: rowNumber, kind, name });
      }
    });
  }
  return occ;
}

function buildSchema(occ: readonly TagOcc[]): { fields: PlaceholderField[] } {
  const fields: PlaceholderField[] = [];
  const topSeen = new Set<string>();
  let current: { name: string; fields: PlaceholderField[]; seen: Set<string> } | null = null;

  for (const t of occ) {
    if (t.kind === 'open') {
      if (current) {
        throw new XlsxTemplateError(
          `xlsx 不支持嵌套循环（"${t.name}" 在 "${current.name}" 内）。`,
          'unsupported',
        );
      }
      current = { name: t.name, fields: [], seen: new Set() };
    } else if (t.kind === 'close') {
      if (!current || current.name !== t.name) {
        throw new XlsxTemplateError(
          `xlsx 循环标记不匹配：{/${t.name}} 没有对应的 {#${t.name}}。`,
          'parse',
        );
      }
      if (!topSeen.has(current.name)) {
        topSeen.add(current.name);
        fields.push({ name: current.name, kind: 'loop', fields: current.fields });
      }
      current = null;
    } else {
      // field
      if (current) {
        if (!current.seen.has(t.name)) {
          current.seen.add(t.name);
          current.fields.push({ name: t.name, kind: 'field' });
        }
      } else if (!topSeen.has(t.name)) {
        topSeen.add(t.name);
        fields.push({ name: t.name, kind: 'field' });
      }
    }
  }
  if (current) {
    throw new XlsxTemplateError(
      `xlsx 循环 "${current.name}" 未闭合（缺少 {/${current.name}}）。`,
      'parse',
    );
  }
  return { fields };
}

// ---------------------------------------------------------------------------
// Loop expansion
// ---------------------------------------------------------------------------

interface LoopSpan {
  readonly name: string;
  readonly startRow: number;
  readonly endRow: number;
}

function findLoopSpans(sheet: ExcelJS.Worksheet): LoopSpan[] {
  const opens = new Map<string, number>();
  const spans: LoopSpan[] = [];
  eachCell(sheet, (cell, rowNumber) => {
    const text = cellText(cell);
    if (!text) return;
    for (const m of text.matchAll(TAG_RE)) {
      const name = (m[2] ?? '').trim();
      if (m[1] === '#') opens.set(name, rowNumber);
      else if (m[1] === '/') {
        const startRow = opens.get(name);
        if (startRow != null) {
          spans.push({ name, startRow, endRow: rowNumber });
          opens.delete(name);
        }
      }
    }
  });
  return spans;
}

function expandSingleRowLoop(
  sheet: ExcelJS.Worksheet,
  loop: LoopSpan,
  rows: readonly FillRow[],
): void {
  const r = loop.startRow;
  if (rows.length === 0) {
    sheet.spliceRows(r, 1); // loop with no data → remove the template row
    return;
  }
  if (rows.length > 1) {
    sheet.duplicateRow(r, rows.length - 1, true); // r .. r+rows.length-1
  }
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i]!;
    const row = sheet.getRow(r + i);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell);
      if (!text || !text.includes('{')) return;
      const next = substitute(text, (name, kind) => {
        if (kind !== 'field') return ''; // strip {#x}/{/x} markers
        const v = item[name];
        return typeof v === 'string' ? v : '';
      });
      setCellText(cell, next);
    });
  }
}

// --- multi-row loop block duplication (P0 / E10) ---------------------------

interface CellSnapshot {
  readonly col: number;
  readonly text: string;
  readonly style: Partial<ExcelJS.Style>;
}
interface RowSnapshot {
  readonly height: number | undefined;
  readonly cells: readonly CellSnapshot[];
}
interface BuiltRow {
  readonly values: (string | null)[];
  readonly height: number | undefined;
  readonly cells: readonly { col: number; style: Partial<ExcelJS.Style> }[];
}

/**
 * Multi-row loop body — {#name} and {/name} sit on DIFFERENT rows, so the
 * body is a BLOCK of rows that must be repeated once per data row while
 * preserving cell styles + row heights. exceljs has no "duplicate a block"
 * primitive, so we snapshot the body, splice the original span out, then
 * splice N substituted copies back in and re-stamp styles.
 *
 * Boundary rows whose ONLY content is the loop marker are treated as
 * delimiters and dropped, so a natural template
 *   row R   : {#tasks}
 *   row R+1 : {seq} | {title} | {status}
 *   row R+2 : {/tasks}
 * expands to one clean row per task (no blank marker rows). When a marker
 * shares its row with real content the whole row stays part of the body.
 */
function expandMultiRowLoop(
  sheet: ExcelJS.Worksheet,
  loop: LoopSpan,
  rows: readonly FillRow[],
): void {
  const openOnly = isPureMarkerRow(sheet, loop.startRow, '#', loop.name);
  const closeOnly = isPureMarkerRow(sheet, loop.endRow, '/', loop.name);
  const bodyStart = openOnly ? loop.startRow + 1 : loop.startRow;
  const bodyEnd = closeOnly ? loop.endRow - 1 : loop.endRow;

  // Snapshot the body block BEFORE mutating any rows.
  const block: RowSnapshot[] = [];
  for (let r = bodyStart; r <= bodyEnd; r++) block.push(snapshotRow(sheet, r));

  // Replace the whole original span (markers + body) in one delete + one
  // insert so rows below shift exactly once.
  const spanHeight = loop.endRow - loop.startRow + 1;
  sheet.spliceRows(loop.startRow, spanHeight);

  const built: BuiltRow[] = [];
  for (const item of rows) {
    for (const snap of block) built.push(buildRow(snap, item));
  }
  if (built.length === 0) return; // no data (or empty body) → region removed

  sheet.spliceRows(loop.startRow, 0, ...built.map((b) => b.values));
  for (let k = 0; k < built.length; k++) {
    stampRow(sheet.getRow(loop.startRow + k), built[k]!);
  }
}

/** True when the row's only non-empty content is this loop's marker. */
function isPureMarkerRow(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  prefix: '#' | '/',
  name: string,
): boolean {
  const marker = new RegExp(`\\{${prefix}${escapeRegExp(name)}\\}`, 'g');
  let sawMarker = false;
  let sawOther = false;
  sheet.getRow(rowNum).eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell);
    if (!text) return;
    const stripped = text.replace(marker, '');
    if (stripped !== text) sawMarker = true;
    if (stripped.trim() !== '') sawOther = true;
  });
  return sawMarker && !sawOther;
}

function snapshotRow(sheet: ExcelJS.Worksheet, rowNum: number): RowSnapshot {
  const row = sheet.getRow(rowNum);
  const cells: CellSnapshot[] = [];
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    cells.push({ col, text: cellText(cell) ?? '', style: cloneStyle(cell.style) });
  });
  return { height: row.height, cells };
}

function buildRow(snap: RowSnapshot, item: FillRow): BuiltRow {
  const maxCol = snap.cells.reduce((m, c) => Math.max(m, c.col), 0);
  const values: (string | null)[] = new Array(maxCol).fill(null);
  const cells: { col: number; style: Partial<ExcelJS.Style> }[] = [];
  for (const c of snap.cells) {
    const text = c.text.includes('{')
      ? substitute(c.text, (name, kind) => {
          if (kind !== 'field') return ''; // strip {#x}/{/x} markers
          const v = item[name];
          return typeof v === 'string' ? v : '';
        })
      : c.text;
    values[c.col - 1] = text.length > 0 ? text : null;
    cells.push({ col: c.col, style: c.style });
  }
  return { values, height: snap.height, cells };
}

function stampRow(row: ExcelJS.Row, built: BuiltRow): void {
  if (built.height != null) row.height = built.height;
  for (const { col, style } of built.cells) {
    row.getCell(col).style = cloneStyle(style);
  }
}

/** exceljs cell styles are plain data (font/fill/border/alignment/numFmt). */
function cloneStyle(style: Partial<ExcelJS.Style> | undefined): Partial<ExcelJS.Style> {
  if (!style) return {};
  return JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Cell + workbook helpers
// ---------------------------------------------------------------------------

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch (err) {
    throw new XlsxTemplateError(
      err instanceof Error
        ? `无法解析 xlsx 模板：${err.message}`
        : '无法解析 xlsx 模板（不是有效的 Office 文件）',
      'parse',
    );
  }
  return wb;
}

function worksheets(wb: ExcelJS.Workbook): ExcelJS.Worksheet[] {
  const out: ExcelJS.Worksheet[] = [];
  wb.eachSheet((sheet) => out.push(sheet));
  return out;
}

function eachCell(
  sheet: ExcelJS.Worksheet,
  fn: (cell: ExcelJS.Cell, rowNumber: number) => void,
): void {
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell) => fn(cell, rowNumber));
  });
}

/** Plain text of a cell — handles string, number, and richText cells. */
function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'richText' in v && Array.isArray(v.richText)) {
    return v.richText.map((r) => r.text).join('');
  }
  return null;
}

/** Set a cell's text, clearing to null when empty. Style is preserved. */
function setCellText(cell: ExcelJS.Cell, text: string): void {
  cell.value = text.length > 0 ? text : null;
}

function substitute(
  text: string,
  lookup: (name: string, kind: TagKind) => string,
): string {
  return text.replace(TAG_RE, (_m, prefix: string, raw: string) => {
    const name = raw.trim();
    const kind: TagKind = prefix === '#' ? 'open' : prefix === '/' ? 'close' : 'field';
    return lookup(name, kind);
  });
}
