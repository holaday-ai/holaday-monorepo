/**
 * Template-fill execution lane (Phase 1 #1) — orchestrates a
 * format-preserving template fill end-to-end:
 *
 *   upload → safety inspect → extract placeholder schema →
 *   model maps user data → schema (strict JSON) → validate (deterministic)
 *   → engine fills bytes → persist (injected `save`) → attachments[]
 *
 * Mirrors agent/image/image-runner.ts: persistence + the model call are
 * INJECTED (`save`, `model`) so this stays a pure, unit-testable
 * orchestrator. The model NEVER touches the file bytes — it only
 * proposes a {fields,loops,missing} mapping (架构裁决一). Determinism
 * (no invented placeholders, type checks, required coverage, honest
 * blanks) lives in validateFillJson, not the model.
 *
 * The returned `attachments` match the SPA's `result.metadata.attachments`
 * shape (FileDownloadCard) — the same robust, deterministic surface the
 * image lane uses, so the download never depends on the model carrying a
 * fence (the §3 design goal, achieved via structured metadata).
 */

import type { Logger } from 'pino';
import {
  validateFillJson,
  countPlaceholders,
  type PlaceholderSchema,
  type PlaceholderField,
  type FillJson,
  type FillData,
  type TemplateFormat,
} from './placeholder-schema.js';
import { inspectTemplate, checkPlaceholderBudget } from './template-safety.js';
import * as docxEngine from './docx-template-engine.js';
// M3 will add: import * as xlsxEngine from './xlsx-template-engine.js';

/** Matches the SPA's metadata.attachments entry shape (task-store.ts). */
export interface TemplateAttachment {
  fileId: string;
  downloadUrl: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  /** ISO string — the SPA rejects non-string expiresAt. */
  expiresAt: string;
  kind: 'output';
}

export type TemplateFillStatus =
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'awaiting_user';

export interface RunTemplateFillResult {
  status: TemplateFillStatus;
  /** Final answer text — the deterministic skeleton (filled table + missing + note). */
  summary: string;
  attachments: TemplateAttachment[];
  /** Present on failure. */
  reason?: string;
  /** awaiting_user clarification question. */
  awaitingQuestion?: string;
  /** Placeholders left blank (drives partial_success). */
  missing?: string[];
  /** Byte-sniffed template format. */
  format?: TemplateFormat;
  /** Honest-degrade marker for analytics. */
  degraded?: 'plan' | 'pptx' | 'no_data';
}

/** Persist the filled file → an attachment row. Injected (mirrors SaveImageFn). */
export type SaveTemplateFn = (out: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}) => Promise<TemplateAttachment>;

/**
 * Thin model seam — one constrained call returning raw text. The runner
 * builds the system + user prompt (vendor 工艺知识 lives here, 裁决三)
 * and parses the JSON itself, so the seam is trivial to fake in tests.
 */
export type TemplateFillModelFn = (req: {
  system: string;
  user: string;
}) => Promise<string>;

export interface RunTemplateFillOpts {
  intent: string;
  /** Raw bytes + meta of the uploaded template. Absent → awaiting_user. */
  template?: { buffer: Buffer; filename: string; mimetype: string };
  /** Stringified text of any data files (csv/xlsx/json), already parsed. */
  dataText?: string;
  /** Output formats the user's plan can produce (allowedFormatsForPlan). */
  allowedFormats: readonly string[];
  save: SaveTemplateFn;
  model: TemplateFillModelFn;
  logger: Logger;
}

const MIME_BY_FORMAT: Record<TemplateFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export async function runTemplateFillTask(
  opts: RunTemplateFillOpts,
): Promise<RunTemplateFillResult> {
  const { template, logger } = opts;

  // 1. No template uploaded → ask for one (§5: don't spin).
  if (!template || !template.buffer || template.buffer.length === 0) {
    return {
      status: 'awaiting_user',
      summary: '',
      attachments: [],
      awaitingQuestion:
        '请上传需要填充的模板文件（.docx 或 .xlsx），并在模板中用 {字段名} 标注需要填充的位置。',
    };
  }

  // 2. Safety (§7) — bytes are untrusted.
  const safety = inspectTemplate(template.buffer);
  if (!safety.ok || !safety.format) {
    logger.warn(
      { reason: safety.reason, detail: safety.detail },
      'template-fill: rejected by safety',
    );
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: safety.message ?? '模板文件无法处理。',
    };
  }
  const format = safety.format;

  // 3. pptx → honest decline in v1 (no auto-conversion; §6.3 / 裁决四).
  if (format === 'pptx') {
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason:
        '暂不支持填充 PowerPoint（.pptx）模板。请改用 .docx 或 .xlsx 模板，或把内容整理后由我直接生成文档。',
      format,
      degraded: 'pptx',
    };
  }

  // 4. Engine (docx now; xlsx wired in M3).
  const engine = selectEngine(format);
  if (!engine) {
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: `目前支持 .docx 模板填充，.${format} 模板支持即将上线。`,
      format,
    };
  }

  // 5. Extract the placeholder schema.
  let schema: PlaceholderSchema;
  try {
    schema = engine.extractPlaceholders(template.buffer);
  } catch (err) {
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: errMessage(err, '解析模板占位符失败。'),
      format,
    };
  }

  // 6. No placeholders → honest fail (§5 杜绝"模型猜锚点").
  if (schema.fields.length === 0) {
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason:
        '模板中未发现 {字段} 占位符。请在需要填充的位置用花括号标注，例如：客户名称 {client_name}、循环行 {#items}{desc}{/items}，然后重新上传。',
      format,
    };
  }

  // 7. Placeholder budget (§7).
  const budget = checkPlaceholderBudget(countPlaceholders(schema));
  if (!budget.ok) {
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: budget.message ?? '模板占位符过多。',
      format,
    };
  }

  // 8. Map user data → fields (one constrained model call).
  let fillJson: FillJson | null;
  try {
    const raw = await opts.model({
      system: buildSystemPrompt(),
      user: buildUserPrompt(schema, opts.intent, opts.dataText),
    });
    fillJson = parseFillJson(raw);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'template-fill: model mapping failed',
    );
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: '模板字段映射失败，请稍后重试。',
      format,
    };
  }

  // 9. Validate deterministically (never throws; null → all missing).
  const validated = validateFillJson(schema, fillJson);
  if (validated.typeErrors.length > 0) {
    logger.info({ typeErrors: validated.typeErrors }, 'template-fill: validator type notes');
  }

  // 10. Nothing fillable → honest partial, no useless blank file.
  if (Object.keys(validated.data).length === 0) {
    return {
      status: 'partial_success',
      summary:
        `未能从你提供的内容中提取到可填充的数据。模板「${template.filename}」需要这些字段：` +
        `${flattenTop(schema).join('、')}。请在指令中补充数据，或上传一个包含数据的 csv/xlsx 文件后重试。`,
      attachments: [],
      missing: validated.missing,
      format,
      degraded: 'no_data',
    };
  }

  // 11. Plan gate (§7) — basic/free can't produce office files → field-
  //     mapping preview + upgrade note (复用 filegen P1 诚实降级文案).
  if (!opts.allowedFormats.includes(format)) {
    return {
      status: 'completed',
      summary: buildPreviewMarkdown(schema, validated.data, template.filename, format),
      attachments: [],
      missing: validated.missing,
      format,
      degraded: 'plan',
    };
  }

  // 12. Fill the bytes deterministically.
  let outBuf: Buffer;
  try {
    outBuf = engine.fill(template.buffer, validated.data);
  } catch (err) {
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: errMessage(err, '填充模板失败。'),
      format,
    };
  }

  // 13. Persist.
  let attachment: TemplateAttachment;
  try {
    attachment = await opts.save({
      buffer: outBuf,
      filename: outputFilename(template.filename, format),
      mimetype: MIME_BY_FORMAT[format],
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'template-fill: save failed',
    );
    return {
      status: 'failed',
      summary: '',
      attachments: [],
      reason: '文件已填充但保存失败，请重试。',
      format,
    };
  }

  // 14. Final text + terminal status.
  const status: TemplateFillStatus =
    validated.missing.length > 0 ? 'partial_success' : 'completed';
  return {
    status,
    summary: buildFinalText(schema, validated.data, validated.missing, template.filename),
    attachments: [attachment],
    missing: validated.missing,
    format,
  };
}

// ---------------------------------------------------------------------------
// Engine dispatch
// ---------------------------------------------------------------------------

interface TemplateEngine {
  extractPlaceholders(buf: Buffer): PlaceholderSchema;
  fill(buf: Buffer, data: FillData): Buffer;
}

function selectEngine(format: TemplateFormat): TemplateEngine | null {
  if (format === 'docx') {
    return { extractPlaceholders: docxEngine.extractPlaceholders, fill: docxEngine.fill };
  }
  // xlsx → M3; pptx handled before this.
  return null;
}

// ---------------------------------------------------------------------------
// Prompt construction (vendor 工艺知识, 裁决三)
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  return [
    '你是 HOLA DAY 的模板填充助手。用户上传了一个 Office 模板，其中用 {占位符} 标注了需要填充的位置。',
    '你的唯一任务：把用户提供的数据映射到这些占位符，输出一个严格的 JSON 对象。',
    '',
    '规则：',
    '1. 只输出 JSON 本身，不要任何解释文字。',
    '2. JSON 结构固定为：',
    '   {',
    '     "fields": { "占位符名": "值" },',
    '     "loops":  { "循环名": [ { "子字段名": "值" } ] },',
    '     "missing": ["占位符名"]',
    '   }',
    '3. 普通字段（fields）的值是标量（字符串或数字）。循环（loops）用于重复的行，每行一个对象。',
    '4. 绝对不要发明 schema 之外的占位符名——只使用提示里列出的占位符。',
    '5. 数据里确实找不到的占位符，放进 "missing"，不要编造、不要填占位文字。',
    '6. 所有值按字面文本照抄用户数据（金额、日期、单位原样保留）。',
  ].join('\n');
}

export function buildUserPrompt(
  schema: PlaceholderSchema,
  intent: string,
  dataText: string | undefined,
): string {
  const parts = ['模板占位符 schema：', describeSchema(schema), ''];
  parts.push('用户指令 / 内联数据：', (intent || '（无）').trim(), '');
  if (dataText && dataText.trim()) {
    parts.push('数据文件内容：', dataText.trim(), '');
  }
  parts.push('请输出填充 JSON。');
  return parts.join('\n');
}

function describeSchema(schema: PlaceholderSchema): string {
  const simple = schema.fields.filter((f) => f.kind === 'field').map((f) => f.name);
  const loops = schema.fields.filter((f) => f.kind === 'loop');
  const lines: string[] = [];
  if (simple.length > 0) lines.push(`普通字段：${simple.join('、')}`);
  for (const loop of loops) {
    const sub = (loop.fields ?? []).map((s) => s.name).join('、');
    lines.push(`循环 ${loop.name}（每行字段：${sub || '（无子字段）'}）`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Model-output parsing
// ---------------------------------------------------------------------------

export function parseFillJson(text: string): FillJson | null {
  if (!text) return null;
  // Prefer a ```json fenced block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1]);
  const balanced = extractBalancedObject(text);
  if (balanced) candidates.push(balanced);
  candidates.push(text);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as FillJson;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Final-text assembly (§3⑨ fixed skeleton)
// ---------------------------------------------------------------------------

function buildFinalText(
  schema: PlaceholderSchema,
  data: FillData,
  missing: readonly string[],
  filename: string,
): string {
  const lines: string[] = [];
  lines.push(`已根据你的数据填充模板「${filename}」，并保留了模板原有格式。`);
  lines.push('');
  lines.push(...renderFilledTable(schema, data));
  if (missing.length > 0) {
    lines.push('');
    lines.push(
      `⚠️ 以下 ${missing.length} 个字段未能从你提供的数据中找到，已留空：${missing.join('、')}。` +
        '请补充这些数据后重试，或在下载的文件中手动填写。',
    );
  }
  lines.push('');
  lines.push('下载链接见下方，24 小时内有效。');
  return lines.join('\n');
}

function buildPreviewMarkdown(
  schema: PlaceholderSchema,
  data: FillData,
  filename: string,
  format: TemplateFormat,
): string {
  const lines: string[] = [];
  lines.push(
    `你的账号暂不支持生成 .${format} 文件，以下是模板「${filename}」的字段填充预览：`,
  );
  lines.push('');
  lines.push(...renderFilledTable(schema, data));
  lines.push('');
  lines.push(
    `升级到 Pro 套餐即可下载保留原格式的 .${format} 成品文件；当前已为你生成上方字段映射预览。`,
  );
  return lines.join('\n');
}

function renderFilledTable(schema: PlaceholderSchema, data: FillData): string[] {
  const lines = ['| 占位符 | 填充值 |', '| --- | --- |'];
  for (const f of schema.fields) {
    if (f.kind === 'loop') {
      const rows = data[f.name];
      const count = Array.isArray(rows) ? rows.length : 0;
      lines.push(`| ${f.name}（循环） | ${count > 0 ? `展开 ${count} 行` : '（空）'} |`);
    } else {
      const v = data[f.name];
      const shown = typeof v === 'string' && v ? truncateCell(v) : '（空）';
      lines.push(`| ${f.name} | ${shown} |`);
    }
  }
  return lines;
}

function truncateCell(v: string): string {
  const oneLine = v.replace(/\s+/g, ' ').trim();
  const escaped = oneLine.replace(/\|/g, '\\|');
  return escaped.length > 60 ? `${escaped.slice(0, 57)}…` : escaped;
}

function flattenTop(schema: PlaceholderSchema): string[] {
  return schema.fields.map((f: PlaceholderField) => f.name);
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function outputFilename(templateName: string, format: TemplateFormat): string {
  const base = templateName.replace(/\.[^.]+$/, '').trim() || '模板';
  return `${base}-已填充.${format}`;
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
