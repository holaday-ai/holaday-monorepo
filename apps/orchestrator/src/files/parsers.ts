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
// pdf-parse 2.x exposes a `PDFParse` class instead of the legacy
// callable. Construct per-call (cheap) and pull text via getText().
import { PDFParse } from 'pdf-parse';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import { VERIFICATION_INPUT_LIMITS } from '../execution/verification-input-budget.js';

type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export const MAX_INLINE_TEXT_CHARS = 50_000;

export interface ParsedFile {
  blocks: ContentBlockParam[];
  /** True when the parser truncated the source — used in user-facing copy. */
  truncated: boolean;
}

class CoreFileInputError extends Error {
  constructor(code: 'CORE_FILE_INPUT_LIMIT' | 'CORE_FILE_UNREADABLE') {
    super(code);
    this.name = 'CoreFileInputError';
  }
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
  options: { completeText?: boolean } = {},
): Promise<ParsedFile> {
  const ext = extOf(filename).toLowerCase();
  const mt = mimetype.toLowerCase();
  if (options.completeText && ['.docx', '.doc', '.zip'].includes(ext))
    throw new CoreFileInputError('CORE_FILE_UNREADABLE');

  if (mt.startsWith('image/')) {
    return parseImage(buffer, mt);
  }
  if (mt === 'application/pdf' || ext === '.pdf') {
    return parsePdf(buffer, filename, options.completeText);
  }
  if (
    mt === 'application/vnd.ms-excel' ||
    mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === '.xlsx' ||
    ext === '.xls'
  ) {
    return parseXlsx(buffer, filename, options.completeText);
  }
  if (mt === 'application/json' || ext === '.json') {
    return parseTextLike(buffer, filename, '```json', options.completeText);
  }
  if (mt === 'text/csv' || ext === '.csv') {
    return parseTextLike(buffer, filename, '```csv', options.completeText);
  }
  if (mt === 'text/markdown' || ext === '.md') {
    return parseTextLike(buffer, filename, '```markdown', options.completeText);
  }
  // Fallback: treat as plain text. Risky for binaries but cheap
  // for the common case where mimetype came back as octet-stream.
  if (
    options.completeText &&
    !(
      mt.startsWith('text/') ||
      (mt === 'application/octet-stream' && ['.txt', '.csv', '.md', '.json', '.log'].includes(ext))
    )
  )
    throw new CoreFileInputError('CORE_FILE_UNREADABLE');
  return parseTextLike(buffer, filename, '', options.completeText);
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

async function parsePdf(
  buffer: Buffer,
  filename: string,
  completeText = false,
): Promise<ParsedFile> {
  let parser: InstanceType<typeof PDFParse> | null = null;
  try {
    // PDFParse expects a Uint8Array or { data: Uint8Array }. A Node
    // Buffer is a Uint8Array subclass, so it passes through directly.
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = ((result as { text?: string })?.text ?? '').trim();
    return wrapText(text, filename, '```pdf', completeText);
  } catch (err) {
    if (completeText)
      throw err instanceof CoreFileInputError
        ? err
        : new CoreFileInputError('CORE_FILE_UNREADABLE');
    return {
      blocks: [
        {
          type: 'text',
          text: `[附件 ${filename}: PDF 解析失败 — ${err instanceof Error ? err.message : String(err)}]`,
        },
      ],
      truncated: false,
    };
  } finally {
    // PDFParse holds a worker handle; destroying it lets node exit
    // cleanly when the caller is a one-shot script.
    if (parser) {
      await parser.destroy().catch(() => {
        /* best-effort cleanup */
      });
    }
  }
}

function parseXlsx(buffer: Buffer, filename: string, completeText = false): ParsedFile {
  try {
    const wb = xlsxRead(buffer, { type: 'buffer' });
    const lines: string[] = [];
    let hasCellContent = false;
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      if (completeText) {
        hasCellContent ||= Object.entries(sheet).some(
          ([address, cell]) =>
            !address.startsWith('!') && cell?.v != null && String(cell.v).trim().length > 0,
        );
      }
      const csv = xlsxUtils.sheet_to_csv(sheet);
      if (wb.SheetNames.length > 1) {
        lines.push(`# ${sheetName}`);
      }
      lines.push(csv);
      lines.push('');
    }
    if (completeText && !hasCellContent) throw new CoreFileInputError('CORE_FILE_UNREADABLE');
    const text = lines.join('\n').trim();
    return wrapText(text, filename, '```csv', completeText);
  } catch (err) {
    if (completeText)
      throw err instanceof CoreFileInputError
        ? err
        : new CoreFileInputError('CORE_FILE_UNREADABLE');
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
  completeText = false,
): ParsedFile {
  let text: string;
  try {
    text = completeText
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
      : buffer.toString('utf8');
  } catch {
    throw new CoreFileInputError('CORE_FILE_UNREADABLE');
  }
  if (completeText && text.includes('\u0000')) throw new CoreFileInputError('CORE_FILE_UNREADABLE');
  return wrapText(text, filename, fence, completeText);
}

function wrapText(text: string, filename: string, fence: string, completeText = false): ParsedFile {
  if (completeText && !text.trim()) throw new CoreFileInputError('CORE_FILE_UNREADABLE');
  if (completeText && Buffer.byteLength(text, 'utf8') > VERIFICATION_INPUT_LIMITS.materialsBytes)
    throw new CoreFileInputError('CORE_FILE_INPUT_LIMIT');
  let body = text;
  let truncated = false;
  if (!completeText && body.length > MAX_INLINE_TEXT_CHARS) {
    body = body.slice(0, MAX_INLINE_TEXT_CHARS);
    truncated = true;
  }
  const heading = `[附件: ${filename}${truncated ? `（已截断到 ${MAX_INLINE_TEXT_CHARS} 字符，仅前段供分析）` : ''}]`;
  const closeFence = fence ? '```' : '';
  const wrapped = fence ? `${heading}\n${fence}\n${body}\n${closeFence}` : `${heading}\n${body}`;
  return {
    blocks: [{ type: 'text', text: wrapped }],
    truncated,
  };
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx) : '';
}
