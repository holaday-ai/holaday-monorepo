/**
 * File parsers — turn an uploaded buffer into the right shape for
 * an Anthropic content block.
 *
 *   Text-shaped (csv / txt / json / md)  → { type: 'text', text }
 *   PDF                                  → { type: 'text', text }
 *   XLSX                                 → { type: 'text', text } (CSV-ified)
 *   Image (png / jpg / webp / gif)       → { type: 'image', source }
 *
 * Token budget guard: `MAX_INLINE_TEXT_CHARS` truncates large text
 * payloads before they hit the API. The 50K char ceiling is roughly
 * 12K tokens — the message stays useful for Sonnet's 200K context
 * without bulldozing the cache. Truncation is lossy on purpose: a
 * tail trim with a note is better than blowing the budget.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
// pdf-parse 2.x is ESM with a named `pdf()` export rather than a
// default. Use a star import so the dispatch below works regardless
// of whether the consumed module shape is { pdf, default: pdf } or
// { default: pdf }; either way `pdfModule.pdf` resolves the parser.
import * as pdfModule from 'pdf-parse';

const pdfParse = (pdfModule as unknown as { pdf: (b: Buffer) => Promise<{ text?: string }> }).pdf;

type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export const MAX_INLINE_TEXT_CHARS = 50_000;

export interface ParsedFile {
  blocks: ContentBlockParam[];
  /** True when the parser truncated the source — used in user-facing copy. */
  truncated: boolean;
}

/**
 * Dispatch on mimetype + extension. Falls back to "text" for anything
 * that isn't explicitly recognised but smells text-shaped — better
 * than a hard fail on a benign .log file the user attached.
 */
export async function parseFileForPrompt(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<ParsedFile> {
  const ext = extOf(filename).toLowerCase();
  const mt = mimetype.toLowerCase();

  if (mt.startsWith('image/')) {
    return parseImage(buffer, mt);
  }
  if (mt === 'application/pdf' || ext === '.pdf') {
    return parsePdf(buffer, filename);
  }
  if (
    mt === 'application/vnd.ms-excel' ||
    mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === '.xlsx' ||
    ext === '.xls'
  ) {
    return parseXlsx(buffer, filename);
  }
  if (mt === 'application/json' || ext === '.json') {
    return parseTextLike(buffer, filename, '```json');
  }
  if (mt === 'text/csv' || ext === '.csv') {
    return parseTextLike(buffer, filename, '```csv');
  }
  if (mt === 'text/markdown' || ext === '.md') {
    return parseTextLike(buffer, filename, '```markdown');
  }
  // Fallback: treat as plain text. Risky for binaries but cheap
  // for the common case where mimetype came back as octet-stream.
  return parseTextLike(buffer, filename, '');
}

function parseImage(buffer: Buffer, mt: string): ParsedFile {
  // Anthropic's vision API supports png / jpeg / gif / webp.
  // Anything else gets re-tagged as png and the API will likely
  // 400 — that's a more useful error than silently substituting.
  const allowedMt = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const safeMt = allowedMt.includes(mt) ? mt : 'image/png';
  return {
    blocks: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: safeMt as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: buffer.toString('base64'),
        },
      },
    ],
    truncated: false,
  };
}

async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedFile> {
  try {
    const result = await pdfParse(buffer);
    const text = (result?.text ?? '').trim();
    return wrapText(text, filename, '```pdf');
  } catch (err) {
    return {
      blocks: [
        {
          type: 'text',
          text: `[附件 ${filename}: PDF 解析失败 — ${err instanceof Error ? err.message : String(err)}]`,
        },
      ],
      truncated: false,
    };
  }
}

function parseXlsx(buffer: Buffer, filename: string): ParsedFile {
  try {
    const wb = xlsxRead(buffer, { type: 'buffer' });
    const lines: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const csv = xlsxUtils.sheet_to_csv(sheet);
      if (wb.SheetNames.length > 1) {
        lines.push(`# ${sheetName}`);
      }
      lines.push(csv);
      lines.push('');
    }
    const text = lines.join('\n').trim();
    return wrapText(text, filename, '```csv');
  } catch (err) {
    return {
      blocks: [
        {
          type: 'text',
          text: `[附件 ${filename}: XLSX 解析失败 — ${err instanceof Error ? err.message : String(err)}]`,
        },
      ],
      truncated: false,
    };
  }
}

function parseTextLike(
  buffer: Buffer,
  filename: string,
  fence: string,
): ParsedFile {
  const text = buffer.toString('utf8');
  return wrapText(text, filename, fence);
}

function wrapText(text: string, filename: string, fence: string): ParsedFile {
  let body = text;
  let truncated = false;
  if (body.length > MAX_INLINE_TEXT_CHARS) {
    body = body.slice(0, MAX_INLINE_TEXT_CHARS);
    truncated = true;
  }
  const heading = `[附件: ${filename}${truncated ? `（已截断到 ${MAX_INLINE_TEXT_CHARS} 字符，仅前段供分析）` : ''}]`;
  const closeFence = fence ? '```' : '';
  const wrapped = fence
    ? `${heading}\n${fence}\n${body}\n${closeFence}`
    : `${heading}\n${body}`;
  return {
    blocks: [{ type: 'text', text: wrapped }],
    truncated,
  };
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx) : '';
}
