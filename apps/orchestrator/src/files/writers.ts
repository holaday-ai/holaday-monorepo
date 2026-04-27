/**
 * File writers — turn the agent's `create_file` tool input into a
 * downloadable buffer.
 *
 * Two tiers:
 *   - **Open formats** (csv / txt / md / json) need no third-party
 *     deps; they're just `Buffer.from(content)` with the right
 *     mimetype. Available to Basic + Pro.
 *   - **Office formats** (xlsx / pdf / docx / pptx) require xlsx,
 *     pdfkit, docx, and pptxgenjs respectively. Pro-only by spec.
 *
 * The agent passes `content` as a JSON string. The shape it should
 * follow is per-format and described in the tool's description in
 * agent-loop. We try to be forgiving: pass-through plain strings
 * for text-shaped formats, parse JSON for structured ones, fall
 * back to a stringified dump if parsing fails (better than tool
 * call failure on a single quote).
 */

import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { utils as xlsxUtils, write as xlsxWrite, type WorkSheet } from 'xlsx';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
// pptxgenjs ships as both ESM (default export class) and CJS
// (module.exports = class). With `esModuleInterop` the default
// import works in TS but `new PptxGenJS()` then sees the namespace
// shape under verbatimModuleSyntax. Use a star import + cast to
// the constructor signature for portability.
import * as pptxgen from 'pptxgenjs';

type PptxGenConstructor = new () => {
  addSlide(): {
    addText(
      text: string | Array<{ text: string; options?: Record<string, unknown> }>,
      opts: Record<string, unknown>,
    ): void;
  };
  write(opts: { outputType: string }): Promise<Buffer | string | Blob | ArrayBuffer>;
};
const PptxGenJS = (
  (pptxgen as unknown as { default: PptxGenConstructor }).default ??
    (pptxgen as unknown as PptxGenConstructor)
) as PptxGenConstructor;

export type CreateFileFormat =
  | 'csv'
  | 'txt'
  | 'md'
  | 'json'
  | 'xlsx'
  | 'pdf'
  | 'docx'
  | 'pptx';

export const OPEN_FORMATS = ['csv', 'txt', 'md', 'json'] as const;
export const OFFICE_FORMATS = ['xlsx', 'pdf', 'docx', 'pptx'] as const;

export const ALL_FORMATS: readonly CreateFileFormat[] = [
  ...OPEN_FORMATS,
  ...OFFICE_FORMATS,
];

const MIME_BY_FORMAT: Record<CreateFileFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface RenderResult {
  buffer: Buffer;
  mimetype: string;
}

/**
 * Allowed-formats lookup by plan. Used both at tool-definition time
 * (filter the enum the model sees) and at execution time (server-side
 * defence so a Basic user can't trick the tool by passing 'xlsx'
 * directly).
 */
export function allowedFormatsForPlan(plan: string): readonly CreateFileFormat[] {
  if (plan === 'pro') return ALL_FORMATS;
  if (plan === 'basic') return OPEN_FORMATS;
  return [];
}

export function isCreateFileFormat(value: string): value is CreateFileFormat {
  return (ALL_FORMATS as readonly string[]).includes(value);
}

/**
 * Main entry point — dispatch on format. `content` is whatever the
 * model passed in the tool input. For structured formats it MUST be
 * JSON-parseable; we surface the parse error in the file body so a
 * malformed call still yields something the user can see.
 */
export async function renderFile(
  format: CreateFileFormat,
  content: string,
): Promise<RenderResult> {
  const mimetype = MIME_BY_FORMAT[format];
  switch (format) {
    case 'txt':
    case 'md':
      return { buffer: Buffer.from(content, 'utf8'), mimetype };
    case 'csv':
      return { buffer: Buffer.from(toCsv(content), 'utf8'), mimetype };
    case 'json':
      return { buffer: Buffer.from(reformatJson(content), 'utf8'), mimetype };
    case 'xlsx':
      return { buffer: renderXlsx(content), mimetype };
    case 'pdf':
      return { buffer: await renderPdf(content), mimetype };
    case 'docx':
      return { buffer: await renderDocx(content), mimetype };
    case 'pptx':
      return { buffer: await renderPptx(content), mimetype };
  }
}

/**
 * CSV: accept either raw CSV text or a JSON array of rows. The
 * agent often picks the JSON form because it's easier to compose;
 * the tool description encourages either.
 */
function toCsv(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return content;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return content;
    if (parsed.length === 0) return '';
    if (Array.isArray(parsed[0])) {
      return parsed.map((row: unknown[]) => row.map(csvCell).join(',')).join('\n');
    }
    if (typeof parsed[0] === 'object' && parsed[0] !== null) {
      const rows = parsed as Record<string, unknown>[];
      const headerSet = new Set<string>();
      for (const row of rows) {
        for (const k of Object.keys(row)) headerSet.add(k);
      }
      const headers = Array.from(headerSet);
      const lines = [headers.map(csvCell).join(',')];
      for (const row of rows) {
        lines.push(headers.map((h) => csvCell(row[h])).join(','));
      }
      return lines.join('\n');
    }
    return content;
  } catch {
    return content;
  }
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function reformatJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

/**
 * XLSX: content is JSON. Either an array of arrays (rows of cells),
 * an array of objects (rows keyed by column name), or an object
 * keyed by sheet name pointing at one of the above.
 */
function renderXlsx(content: string): Buffer {
  const wb = xlsxUtils.book_new();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const sheet = xlsxUtils.aoa_to_sheet([['raw'], [content]]);
    xlsxUtils.book_append_sheet(wb, sheet, 'Sheet1');
    return Buffer.from(xlsxWrite(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  const sheets: Record<string, unknown> =
    Array.isArray(parsed) ? { Sheet1: parsed } : (parsed as Record<string, unknown>);
  for (const [name, data] of Object.entries(sheets)) {
    let sheet: WorkSheet;
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      sheet = xlsxUtils.aoa_to_sheet(data as unknown[][]);
    } else if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      sheet = xlsxUtils.json_to_sheet(data as Record<string, unknown>[]);
    } else {
      sheet = xlsxUtils.aoa_to_sheet([[name], [JSON.stringify(data)]]);
    }
    xlsxUtils.book_append_sheet(wb, sheet, name.slice(0, 31));
  }
  return Buffer.from(xlsxWrite(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// pdfkit's default Helvetica has no CJK glyphs; we ship a Noto Sans
// SC sidecar so 中文 / 日本語 / 한국어 mixed content renders. The
// font file is committed under apps/orchestrator/assets/fonts/.
// Resolved relative to this source file (works under tsx + the
// production tsx-direct boot) so the path is stable regardless of
// where the orchestrator is invoked from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CJK_FONT_PATH = path.resolve(__dirname, '../../assets/fonts/NotoSansSC-Regular.ttf');

let cjkFontBuffer: Buffer | null = null;
async function loadCjkFont(): Promise<Buffer | null> {
  if (cjkFontBuffer) return cjkFontBuffer;
  try {
    cjkFontBuffer = await fs.readFile(CJK_FONT_PATH);
    return cjkFontBuffer;
  } catch {
    return null;
  }
}

/**
 * PDF: content is plain text or markdown-ish. We don't render full
 * markdown — pdfkit's text renderer handles paragraph breaks and
 * basic line wrapping, which is enough for "agent dumped a report".
 *
 * CJK support: when the Noto Sans SC sidecar font is present,
 * register it and use it as the default. fontkit (pdfkit's font
 * backend) sniffs OTF vs TTF from magic bytes regardless of file
 * extension, so the .ttf-named OTF we ship works fine. Missing font
 * falls back to Helvetica + .notdef rectangles for CJK glyphs;
 * English content still renders.
 */
async function renderPdf(content: string): Promise<Buffer> {
  const cjk = await loadCjkFont();
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      if (cjk) {
        doc.registerFont('cjk', cjk);
        doc.font('cjk').fontSize(11);
      } else {
        doc.fontSize(11).font('Helvetica');
      }
      doc.text(content, { align: 'left' });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * DOCX: content is plain text or markdown-ish. We split on blank
 * lines for paragraphs and treat lines starting with `# ` as H1.
 * Anything richer (tables, lists) falls through as plain paragraphs.
 */
async function renderDocx(content: string): Promise<Buffer> {
  const blocks = content.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const paragraphs: Paragraph[] = [];
  for (const block of blocks) {
    if (block.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({ text: block.slice(2).trim(), heading: HeadingLevel.HEADING_1 }),
      );
    } else if (block.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({ text: block.slice(3).trim(), heading: HeadingLevel.HEADING_2 }),
      );
    } else {
      paragraphs.push(new Paragraph({ text: block }));
    }
  }
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const arr = await Packer.toBuffer(doc);
  return Buffer.from(arr);
}

/**
 * PPTX: content is JSON: { slides: [{ title, bullets }] }. Plain
 * text fallback: one slide with the whole content as bullets split
 * by newlines.
 */
async function renderPptx(content: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  let parsed: { slides?: Array<{ title?: string; bullets?: string[] }> } | null = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  const slides = parsed?.slides && parsed.slides.length > 0
    ? parsed.slides
    : [{ title: 'Slide 1', bullets: content.split(/\n+/).filter(Boolean).slice(0, 8) }];
  for (const s of slides) {
    const slide = pptx.addSlide();
    if (s.title) {
      slide.addText(s.title, { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 28, bold: true });
    }
    const bullets = (s.bullets ?? []).slice(0, 12);
    if (bullets.length > 0) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true } })),
        { x: 0.5, y: 1.4, w: 9, h: 5, fontSize: 16 },
      );
    }
  }
  // pptxgenjs returns a Promise<Buffer | string | Blob | ArrayBuffer>;
  // 'nodebuffer' yields a Buffer in node.
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return buf;
}
