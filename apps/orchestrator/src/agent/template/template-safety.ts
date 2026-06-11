/**
 * Template safety (Phase 1 #1, §7) — a user-uploaded template is an
 * untrusted zip. These PURE functions sniff + bound it BEFORE any
 * decompression so a malicious upload can't bomb, run a macro, or
 * phone home via an external relationship.
 *
 * Design (§7):
 *   - zip-bomb caps read from the central directory WITHOUT inflating
 *     (entry count / per-entry + total uncompressed size / ratio).
 *   - macro (.docm/.xlsm/vbaProject.bin) → hard reject (no "strip &
 *     continue" — the user would think the macro still ran).
 *   - external relationships (remote attachedTemplate / externalLink…)
 *     → reject (template-injection vector). Hyperlinks are benign.
 *   - MIME sniff from bytes, not the client-declared extension.
 *
 * No fs / network — only Buffer parsing + pizzip for the small metadata
 * parts, which are read only after the size caps pass.
 */

import PizZip from 'pizzip';
import type { TemplateFormat } from './placeholder-schema.js';

export const TEMPLATE_LIMITS = {
  /** Max uploaded template file size. */
  maxFileBytes: 20 * 1024 * 1024,
  /** Max zip entries. */
  maxEntries: 2000,
  /** Max total uncompressed bytes across all entries. */
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  /** Max uncompressed bytes for a single entry. */
  maxEntryUncompressedBytes: 30 * 1024 * 1024,
  /** Reject when uncompressed/compressed ratio exceeds this … */
  maxCompressionRatio: 200,
  /** … but only for entries at least this big (avoid tiny-XML false positives). */
  ratioMinUncompressedBytes: 1024 * 1024,
  /** Max fillable placeholders. */
  maxPlaceholders: 500,
} as const;

export type RejectReason =
  | 'not_a_zip'
  | 'too_large'
  | 'corrupt_zip'
  | 'too_many_entries'
  | 'entry_too_large'
  | 'uncompressed_too_large'
  | 'compression_bomb'
  | 'macro_enabled'
  | 'external_relations'
  | 'unsupported_format'
  | 'too_many_placeholders';

export interface SafetyVerdict {
  readonly ok: boolean;
  /** Byte-sniffed format when ok (or recognisable). */
  readonly format?: TemplateFormat;
  readonly reason?: RejectReason;
  /** User-facing Chinese message (honest, no internals leaked). */
  readonly message?: string;
  /** Operator-facing diagnostic detail (logs only). */
  readonly detail?: string;
  readonly entryCount?: number;
  readonly totalUncompressed?: number;
}

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CEN_SIG = 0x02014b50;

/**
 * Parse the ZIP central directory and return entry metadata. Reads
 * sizes from the headers — NEVER inflates content (that's the whole
 * point of the bomb guard). Throws on a malformed directory.
 */
export function parseZipEntries(buf: Buffer): ZipEntry[] {
  // Find the End Of Central Directory record (scan back from the end;
  // the trailing comment is almost always empty for Office files).
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === ZIP_EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no EOCD record');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < totalEntries; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== ZIP_CEN_SIG) {
      throw new Error(`bad central-directory header at ${off}`);
    }
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const uncompressedSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const nameEnd = off + 46 + nameLen;
    if (nameEnd > buf.length) throw new Error('truncated entry name');
    const name = buf.toString('utf8', off + 46, nameEnd);
    entries.push({ name, method, compressedSize, uncompressedSize });
    off = nameEnd + extraLen + commentLen;
  }
  return entries;
}

/**
 * Apply the zip-bomb size caps to parsed entries. Pure over the entry
 * metadata so it can be unit-tested without crafting real bombs.
 * Returns the first violated reason (+ detail) or null when clean.
 */
export function checkBombLimits(
  entries: readonly ZipEntry[],
  fileBytes: number,
): { reason: RejectReason; detail: string } | null {
  if (entries.length > TEMPLATE_LIMITS.maxEntries) {
    return {
      reason: 'too_many_entries',
      detail: `${entries.length} entries > ${TEMPLATE_LIMITS.maxEntries}`,
    };
  }
  let total = 0;
  for (const e of entries) {
    if (e.uncompressedSize > TEMPLATE_LIMITS.maxEntryUncompressedBytes) {
      return {
        reason: 'entry_too_large',
        detail: `${e.name}: ${e.uncompressedSize} bytes uncompressed`,
      };
    }
    total += e.uncompressedSize;
    if (
      e.uncompressedSize >= TEMPLATE_LIMITS.ratioMinUncompressedBytes &&
      e.compressedSize > 0 &&
      e.uncompressedSize / e.compressedSize > TEMPLATE_LIMITS.maxCompressionRatio
    ) {
      return {
        reason: 'compression_bomb',
        detail: `${e.name}: ratio ${(e.uncompressedSize / e.compressedSize).toFixed(0)}`,
      };
    }
  }
  if (total > TEMPLATE_LIMITS.maxTotalUncompressedBytes) {
    return {
      reason: 'uncompressed_too_large',
      detail: `${total} bytes total uncompressed`,
    };
  }
  void fileBytes;
  return null;
}

/** Byte-sniff the OOXML format from entry names (not the extension). */
export function detectFormat(entries: readonly ZipEntry[]): TemplateFormat | null {
  const names = new Set(entries.map((e) => e.name));
  if (names.has('word/document.xml')) return 'docx';
  if (names.has('xl/workbook.xml')) return 'xlsx';
  if (names.has('ppt/presentation.xml')) return 'pptx';
  return null;
}

/**
 * Macro present? Two precise signals:
 *   1. a `vbaProject.bin` entry — the actual macro payload (authoritative,
 *      survives a .docm→.docx rename since we sniff bytes not extension);
 *   2. the MAIN document part declared as a macro-enabled content type
 *      (`…macroEnabled.main+xml` in an Override).
 *
 * We deliberately do NOT match a bare `macroEnabled` substring: writers
 * such as SheetJS always emit a `<Default Extension="bin"
 * ContentType="…sheet.binary.macroEnabled.main"/>` extension mapping
 * (ends `.main`, no `+xml`) in every plain .xlsx — matching that would
 * reject every normal spreadsheet.
 */
export function hasMacro(
  entries: readonly ZipEntry[],
  contentTypesXml: string | null,
): boolean {
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) return true;
  if (contentTypesXml && /macroEnabled\.main\+xml/i.test(contentTypesXml)) {
    return true;
  }
  return false;
}

// Relationship types that can fetch/execute remote content. Hyperlinks
// (Type …/hyperlink) are deliberately excluded — they're benign.
const DANGEROUS_REL_TYPE =
  /(attachedTemplate|externalLink|externalLinkPath|oleObject|subDocument|frame|dde)$/i;

/**
 * Scan one `.rels` XML for a dangerous EXTERNAL relationship. Returns a
 * short detail string for the first threat, or null.
 */
export function findExternalRelThreat(relsXml: string): string | null {
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const tag = m[0];
    const type = (tag.match(/\bType="([^"]*)"/i)?.[1] ?? '').trim();
    const target = (tag.match(/\bTarget="([^"]*)"/i)?.[1] ?? '').trim();
    const mode = (tag.match(/\bTargetMode="([^"]*)"/i)?.[1] ?? '').trim();
    const typeLeaf = type.split('/').pop() ?? type;
    const isExternal =
      mode.toLowerCase() === 'external' || /^(https?:|file:|\\\\)/i.test(target);
    if (isExternal && DANGEROUS_REL_TYPE.test(typeLeaf)) {
      return `${typeLeaf} → ${target.slice(0, 80)}`;
    }
  }
  return null;
}

/**
 * Full safety verdict for an uploaded template. Order matters: cheap
 * byte checks → header-only size caps → only then inflate the small
 * metadata parts.
 */
export function inspectTemplate(buf: Buffer): SafetyVerdict {
  if (!buf || buf.length === 0) return reject('not_a_zip');
  if (buf.length > TEMPLATE_LIMITS.maxFileBytes) return reject('too_large');
  // Local-file-header signature PK\x03\x04 — an Office file always
  // starts with one. (PK\x05\x06 = empty archive, not a valid template.)
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    return reject('not_a_zip');
  }

  let entries: ZipEntry[];
  try {
    entries = parseZipEntries(buf);
  } catch (err) {
    return reject('corrupt_zip', err instanceof Error ? err.message : undefined);
  }
  if (entries.length === 0) return reject('corrupt_zip', 'no entries');

  const bomb = checkBombLimits(entries, buf.length);
  if (bomb) return reject(bomb.reason, bomb.detail);

  let zip: PizZip;
  try {
    zip = new PizZip(buf);
  } catch (err) {
    return reject('corrupt_zip', err instanceof Error ? err.message : undefined);
  }

  const format = detectFormat(entries);
  if (!format) return reject('unsupported_format');

  const contentTypes = safeRead(zip, '[Content_Types].xml');
  if (hasMacro(entries, contentTypes)) return reject('macro_enabled');

  for (const e of entries) {
    if (!/\.rels$/i.test(e.name)) continue;
    const xml = safeRead(zip, e.name);
    if (!xml) continue;
    const threat = findExternalRelThreat(xml);
    if (threat) return reject('external_relations', `${e.name}: ${threat}`);
  }

  const totalUncompressed = entries.reduce((a, e) => a + e.uncompressedSize, 0);
  return {
    ok: true,
    format,
    entryCount: entries.length,
    totalUncompressed,
  };
}

/** Post-extract budget check (§7: ≤500 placeholders). */
export function checkPlaceholderBudget(count: number): SafetyVerdict {
  if (count > TEMPLATE_LIMITS.maxPlaceholders) {
    return reject(
      'too_many_placeholders',
      `${count} placeholders > ${TEMPLATE_LIMITS.maxPlaceholders}`,
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function safeRead(zip: PizZip, name: string): string | null {
  try {
    const f = zip.file(name);
    return f ? f.asText() : null;
  } catch {
    return null;
  }
}

const MESSAGES: Record<RejectReason, string> = {
  not_a_zip: '这不是有效的 Office 文件，请上传 .docx 或 .xlsx 模板。',
  too_large: `模板文件超过大小上限（${TEMPLATE_LIMITS.maxFileBytes / (1024 * 1024)}MB），请精简后重试。`,
  corrupt_zip: '模板文件已损坏或无法解析，请重新导出后再上传。',
  too_many_entries: '模板文件结构异常（条目过多），出于安全考虑已拒绝处理。',
  entry_too_large: '模板文件结构异常（内部文件过大），出于安全考虑已拒绝处理。',
  uncompressed_too_large: '模板文件解压后过大，出于安全考虑已拒绝处理。',
  compression_bomb: '模板文件疑似异常压缩包，出于安全考虑已拒绝处理。',
  macro_enabled:
    '出于安全考虑，暂不支持含宏的 Office 文件（.docm/.xlsm 等）。请上传不含宏的 .docx / .xlsx 模板。',
  external_relations:
    '模板包含指向外部资源的引用（可能存在安全风险），已拒绝。请移除外部模板/链接引用后重试。',
  unsupported_format: '无法识别的模板格式，目前支持 .docx 与 .xlsx 模板。',
  too_many_placeholders: `模板中的占位符超过上限（${TEMPLATE_LIMITS.maxPlaceholders} 个），请精简模板后重试。`,
};

function reject(reason: RejectReason, detail?: string): SafetyVerdict {
  return {
    ok: false,
    reason,
    message: MESSAGES[reason],
    ...(detail ? { detail } : {}),
  };
}
