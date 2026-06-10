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

// ---------------------------------------------------------------------------
// Plan-aware file-format guidance (P1 — honest degrade on basic/free)
// ---------------------------------------------------------------------------

/** Closest open-format substitute for an office format the plan can't render. */
const OFFICE_FALLBACK: Readonly<Record<string, CreateFileFormat>> = {
  pdf: 'md',
  docx: 'md',
  pptx: 'md',
  xlsx: 'csv',
};

/**
 * Pick the fallback format when `requested` is NOT in the account's allowed
 * list. Returns null when `requested` is already allowed (no fallback needed)
 * or no sensible open format is available. Prefers the office→open mapping
 * (pdf/docx/pptx→md, xlsx→csv), then md/csv/txt/json, then any allowed.
 */
export function preferredFallbackFormat(
  requested: string,
  allowed: readonly string[],
): CreateFileFormat | null {
  if (allowed.includes(requested)) return null; // already available
  const mapped = OFFICE_FALLBACK[requested];
  if (mapped && allowed.includes(mapped)) return mapped;
  for (const f of ['md', 'csv', 'txt', 'json'] as const) {
    if (allowed.includes(f)) return f;
  }
  return (allowed[0] as CreateFileFormat) ?? null;
}

/**
 * Plan-aware guidance string injected into the supercar system prompt so the
 * model behaves consistently when the account can't produce a requested
 * format. Empty `allowed` (free) → honest "cannot generate files". Otherwise
 * → list available formats + office→open fallback map + two hard rules:
 * never claim an unavailable format was generated, and don't browse the web
 * just to produce a file. Plain code (no model call) so it's deterministic.
 */
export function buildFileFormatGuidance(allowed: readonly string[]): string {
  if (allowed.length === 0) {
    return (
      '【文件生成】本账号当前套餐不支持生成可下载文件。若用户要求生成或下载文件，' +
      '请诚实说明当前套餐无法生成可下载文件，并直接在回答正文给出内容，' +
      '**切勿声称已生成文件或已提供下载链接**。'
    );
  }
  const unavailable = ALL_FORMATS.filter((f) => !allowed.includes(f));
  const lines = [
    `【文件生成】本账号可用的 create_file 格式仅：${allowed.join(' / ')}。`,
    // Kill the "I can author a PDF/DOCX directly" hallucination: the model
    // has no code-exec/reportlab/office renderer; create_file is the ONLY way.
    '你没有 Python / reportlab / 代码执行 / Office 渲染能力；**产出任何可下载文件的唯一方式就是调用 create_file 工具**。',
    '生成文件时若内容可直接写出，**不要为生成文件去联网浏览网页**（除非用户明确要求查资料）。',
  ];
  if (unavailable.length > 0) {
    const exMap = unavailable
      .map((f) => {
        const fb = preferredFallbackFormat(f, allowed);
        return fb ? `${f}→${fb}` : null;
      })
      .filter((s): s is string => s != null)
      .join('、');
    lines.push(
      `若用户要的格式（${unavailable.join('/')}）不在可用列表：**绝不要声称已生成该格式、绝不要假装用 reportlab 等库直接生成**；` +
        `你必须实际调用 create_file 以最接近的可用格式生成真实文件（${exMap}），` +
        '然后在最终回答中说明「已改用 X 文件交付；PDF/Office 等格式需升级 Pro 套餐」。未调用 create_file 就不得声称已生成任何文件。',
    );
  }
  return lines.join('\n');
}

const FORMAT_REQUEST_PATTERNS: ReadonlyArray<readonly [CreateFileFormat, RegExp]> = [
  ['pdf', /\bpdf\b|pdf\s*文件|pdf\s*文档/i],
  ['xlsx', /\bxlsx\b|\bexcel\b|电子表格|excel\s*文件/i],
  ['docx', /\bdocx\b|word\s*文档|word\s*文件|\bword\b/i],
  ['pptx', /\bpptx\b|\bppt\b|幻灯片|演示文稿|演示文件/i],
  ['csv', /\bcsv\b|csv\s*文件/i],
  ['json', /\bjson\b|json\s*文件/i],
  ['md', /\bmarkdown\b|\bmd\b|md\s*文件|markdown\s*文件/i],
  ['txt', /\btxt\b|纯文本文件|文本文件/i],
];

/**
 * Best-effort: which concrete file format did the user explicitly ask for?
 * Returns null when no explicit format is named. Office formats are matched
 * before open ones so "可下载的 PDF 文件" → 'pdf'. Used to inject a forceful
 * per-task directive when the requested format is unavailable on the plan.
 */
export function detectRequestedFileFormat(intent: string | null | undefined): CreateFileFormat | null {
  const t = intent ?? '';
  for (const [fmt, re] of FORMAT_REQUEST_PATTERNS) {
    if (re.test(t)) return fmt;
  }
  return null;
}

/**
 * High-attention directive prepended to the FIRST user message when the user
 * asked for a format the plan can't produce. Returns '' when the requested
 * format is available (or none detected) so it no-ops in the common case.
 * This sits next to the intent (far higher attention than the trailing system
 * guidance) to stop the PDF/DOCX "I'll just render it" hallucination.
 */
export function buildUnavailableFormatDirective(
  intent: string | null | undefined,
  allowed: readonly string[],
): string {
  const requested = detectRequestedFileFormat(intent);
  if (!requested) return '';
  if (allowed.includes(requested)) return '';
  if (allowed.length === 0) {
    return (
      `【重要·文件格式】本账号当前套餐无法生成可下载文件，更无法生成 ${requested}。` +
      '请诚实告知用户当前套餐不支持生成可下载文件，直接在正文给出内容，**切勿声称已生成任何文件或下载链接**。'
    );
  }
  const fb = preferredFallbackFormat(requested, allowed) ?? 'md';
  return (
    `【重要·文件格式】本账号无法生成 ${requested}（需升级 Pro）。你也没有 reportlab/代码执行能力。` +
    `请**直接调用 create_file，format='${fb}'**，生成真实的 ${fb} 文件来承载用户要的内容；` +
    `然后在回答中说明「已改用 ${fb} 文件交付；${requested} 需升级 Pro 套餐」。` +
    `**严禁声称已生成 ${requested}、严禁假装用库直接渲染、严禁为此联网浏览。**`
  );
}

/**
 * create_file tool description, plan-aware. Lists the account's available
 * formats and the fallback rule so the model substitutes (instead of
 * hallucinating) when asked for an unavailable office format.
 */
export function buildCreateFileToolDescription(allowed: readonly string[]): string {
  const base =
    '为用户生成一个可下载的文件。任务结果若需以文件形式交付（数据表/报告/演示稿/JSON 数据等），调用此工具。文件 24 小时内可供用户下载。';
  const unavailable = ALL_FORMATS.filter((f) => !allowed.includes(f));
  let note = ` 本账号可用格式：${allowed.join('/')}。`;
  if (unavailable.length > 0) {
    note +=
      `若用户要 ${unavailable.join('/')} 等不可用格式，请改用可用格式生成真实文件` +
      '（pdf/docx/pptx→md，xlsx→csv），并在回答中说明已降级交付、该格式需升级 Pro，**不要声称已生成不可用格式**。';
  }
  return base + note;
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
