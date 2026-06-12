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
  //    indices while later spans grow/shrink.
  for (const sheet of worksheets(wb)) {
    const loops = findLoopSpans(sheet);
    for (const loop of [...loops].sort((a, b) => b.startRow - a.startRow)) {
      if (loop.startRow !== loop.endRow) {
        // v1 — multi-row loops aren't supported yet (P1 backlog). DON'T fail
        // the whole task: skip this loop section and fill everything else.
        // Its leftover {#x}/{/x}/{sub} cells are cleared by the simple-field
        // pass below; the runner marks partial_success + explains which loop
        // ({#name}…{/name}) went unfilled.
        if (!skippedLoops.includes(loop.name)) skippedLoops.push(loop.name);
        continue;
      }
      const rows = Array.isArray(data[loop.name]) ? (data[loop.name] as FillRow[]) : [];
      expandSingleRowLoop(sheet, loop, rows);
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
