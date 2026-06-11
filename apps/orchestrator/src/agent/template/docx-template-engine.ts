/**
 * docx template engine (Phase 1 #1) — extract placeholders from, and
 * fill, a user-uploaded .docx template.
 *
 * 架构裁决四: the existing `docx` lib can only build documents from
 * scratch; it cannot edit an existing file. docxtemplater + pizzip is
 * the de-facto standard for `{field}` / `{#loop}…{/loop}` fill with
 * built-in XML escaping (MIT). The model never touches these bytes —
 * it only proposes a {@link FillData} mapping (see placeholder-schema).
 *
 * Vendored provenance: tag syntax + OOXML run-stitching handled by
 * docxtemplater 3.68 (open-xml-templating/docxtemplater, MIT/GPLv3 —
 * used under MIT).
 */

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import InspectModuleImport from 'docxtemplater/js/inspect-module.js';
import type {
  PlaceholderField,
  PlaceholderSchema,
  FillData,
} from './placeholder-schema.js';

/**
 * docxtemplater's inspect module is a CJS module whose `.d.ts` declares
 * an ESM `export default class`. Under NodeNext that resolves to the
 * module namespace (no construct signature), even though the runtime
 * value (`module.exports`) is the constructible factory. Cast it to the
 * shape we actually use so types match the runtime.
 */
interface InspectModuleInstance {
  getAllStructuredTags(): unknown[];
}
const InspectModule = InspectModuleImport as unknown as new () => InspectModuleInstance;

export class DocxTemplateError extends Error {
  constructor(
    message: string,
    readonly kind: 'parse' | 'render' | 'empty',
    /** Tag names docxtemplater flagged (unclosed loop, etc.), if any. */
    readonly tags?: readonly string[],
  ) {
    super(message);
    this.name = 'DocxTemplateError';
  }
}

/**
 * Minimal local view of docxtemplater's structured-tag tree. We read
 * only what we need so a d.ts drift in the library can't break us.
 */
interface StructuredTag {
  readonly type?: string;
  readonly value?: string;
  readonly module?: string;
  readonly subparsed?: StructuredTag[];
}

/**
 * Parse a .docx and return its placeholder schema. Loops ({#x}{/x})
 * become `kind:'loop'` with their inner placeholders; raw-XML tags
 * ({@x}) are recorded as `unsupported` and never offered for fill.
 */
export function extractPlaceholders(buf: Buffer): PlaceholderSchema {
  const zip = openZip(buf);
  const iModule = new InspectModule();
  try {
    // Constructing compiles the template, which populates the inspect
    // module. We don't keep the instance.
    void new Docxtemplater(zip, {
      modules: [iModule],
      paragraphLoop: true,
      linebreaks: true,
      errorLogging: false,
    });
  } catch (err) {
    throw mapDocxError(err, 'parse');
  }
  const tags = iModule.getAllStructuredTags() as unknown as StructuredTag[];
  const { fields, unsupported } = buildFields(tags);
  return {
    format: 'docx',
    fields,
    ...(unsupported.length > 0 ? { unsupported } : {}),
  };
}

/**
 * Fill the template with validated render data → a new .docx Buffer.
 * Missing placeholders render blank (nullGetter → '') so a partial
 * fill never leaves a literal `{tag}` in the output. The caller
 * (validateFillJson) decides partial_success from its `missing` set.
 */
export function fill(buf: Buffer, data: FillData): Buffer {
  const zip = openZip(buf);
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
      errorLogging: false,
    });
  } catch (err) {
    throw mapDocxError(err, 'parse');
  }
  try {
    doc.render(data as Record<string, unknown>);
  } catch (err) {
    throw mapDocxError(err, 'render');
  }
  let out: Buffer;
  try {
    out = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    }) as Buffer;
  } catch (err) {
    throw new DocxTemplateError(
      err instanceof Error ? `docx 生成失败：${err.message}` : 'docx 生成失败',
      'render',
    );
  }
  if (!out || out.length === 0) {
    throw new DocxTemplateError('生成的 docx 为空', 'empty');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildFields(tags: readonly StructuredTag[]): {
  fields: PlaceholderField[];
  unsupported: string[];
} {
  const fields: PlaceholderField[] = [];
  const unsupported = new Set<string>();
  const seen = new Set<string>();
  for (const tag of tags) {
    // Only real placeholder parts — skip literal content runs.
    if (tag.type !== 'placeholder') continue;
    const name = typeof tag.value === 'string' ? tag.value : '';
    if (!name) continue;
    if (tag.module === 'loop') {
      if (seen.has(name)) continue;
      seen.add(name);
      const inner = buildFields(tag.subparsed ?? []);
      for (const u of inner.unsupported) unsupported.add(u);
      fields.push({ name, kind: 'loop', fields: inner.fields });
    } else if (tag.module) {
      // rawxml ({@x}) or any non-loop module — cannot be safely filled
      // as escaped text, so it's never a fill target.
      unsupported.add(name);
    } else {
      if (seen.has(name)) continue;
      seen.add(name);
      fields.push({ name, kind: 'field' });
    }
  }
  return { fields, unsupported: [...unsupported] };
}

function openZip(buf: Buffer): PizZip {
  try {
    return new PizZip(buf);
  } catch {
    throw new DocxTemplateError('无法解析 docx（不是有效的 Office 文件）', 'parse');
  }
}

interface DocxErrorLike {
  properties?: {
    explanation?: string;
    errors?: Array<{ properties?: { explanation?: string; xtag?: string } }>;
  };
}

function mapDocxError(err: unknown, kind: 'parse' | 'render'): DocxTemplateError {
  const e = err as DocxErrorLike;
  const multi = e?.properties?.errors;
  if (Array.isArray(multi) && multi.length > 0) {
    const tags = multi
      .map((x) => x.properties?.xtag)
      .filter((t): t is string => Boolean(t));
    const explanations = multi
      .map((x) => x.properties?.explanation)
      .filter((t): t is string => Boolean(t));
    const detail = explanations.length > 0
      ? explanations.slice(0, 5).join('；')
      : '占位符语法有误';
    return new DocxTemplateError(
      `docx 模板占位符有误：${detail}`,
      kind,
      tags.length > 0 ? tags : undefined,
    );
  }
  const single = e?.properties?.explanation;
  if (single) return new DocxTemplateError(`docx 模板处理失败：${single}`, kind);
  return new DocxTemplateError(
    err instanceof Error ? `docx 模板处理失败：${err.message}` : 'docx 模板处理失败',
    kind,
  );
}
