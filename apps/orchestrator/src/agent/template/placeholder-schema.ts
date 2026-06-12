/**
 * Template-fill placeholder schema + fill-JSON validator (Phase 1 #1).
 *
 * Pure functions — no zip / docx / I/O. The engine modules
 * (docx-template-engine.ts / xlsx-template-engine.ts) parse the user's
 * uploaded template into a {@link PlaceholderSchema}; the model is then
 * asked to map the user's data onto that schema and returns a
 * {@link FillJson}; {@link validateFillJson} checks that JSON
 * DETERMINISTICALLY — no invented placeholders, type-correct, required
 * coverage — and returns the render-ready data plus the canonical
 * `missing` list that drives partial_success.
 *
 * This is the 携程 model-primary + deterministic `validateHotelJson`
 * split (架构裁决一): the model only proposes a mapping, deterministic
 * code decides what is safe to write and what is honestly left blank.
 * The validator NEVER throws and NEVER invents — an unparseable or
 * hostile model output degrades to "everything missing", never to a
 * fake success.
 */

import {
  parseNumeric,
  evalArithmetic,
  sumLoopColumn,
  withinDerivationTolerance,
  TBD_MARK,
} from './derivation-check.js';

export type PlaceholderKind = 'field' | 'loop';

export interface PlaceholderField {
  /** Tag name as written in the template ({client_name} → "client_name"). */
  readonly name: string;
  readonly kind: PlaceholderKind;
  /** For loops ({#rows}…{/rows}): the placeholders inside one row. */
  readonly fields?: readonly PlaceholderField[];
}

export type TemplateFormat = 'docx' | 'xlsx' | 'pptx';

export interface PlaceholderSchema {
  readonly format: TemplateFormat;
  /** Top-level placeholders — simple fields and loops. */
  readonly fields: readonly PlaceholderField[];
  /**
   * Tags the engine saw but cannot safely fill (raw-XML `{@x}`, unknown
   * modules). Recorded for transparency / logs; NEVER offered to the
   * model and never written, so a template's own raw-XML tag can't
   * become an injection vector.
   */
  readonly unsupported?: readonly string[];
}

/**
 * What the model returns (one constrained call). Everything is
 * `unknown`-typed on the way in because it's untrusted model output;
 * {@link validateFillJson} coerces + prunes it.
 */
export interface FillJson {
  /** simple placeholder name → scalar value. */
  readonly fields?: Record<string, unknown>;
  /** loop name → array of row objects (sub-field → scalar). */
  readonly loops?: Record<string, unknown>;
  /** placeholder names the model itself says it could not fill. */
  readonly missing?: readonly unknown[];
  /**
   * Derived fields (合计 / 差值 / 环比 …) the model computed, each as
   * `{field, formula}` so the validator can deterministically re-check it
   * against the input values in this fill JSON (P1).
   */
  readonly derivations?: readonly unknown[];
}

/** Render-ready scalar — always a string by the time the engine sees it. */
export type FillScalar = string;
export type FillRow = Record<string, FillScalar | FillRow[]>;
export type FillValue = FillScalar | FillRow[];
/** The object handed to the engine's `fill()` (docxtemplater render data). */
export type FillData = Record<string, FillValue>;

export interface ValidatedFill {
  /**
   * Render-ready data — only KNOWN placeholders, scalars coerced to
   * strings, loop rows pruned to known sub-fields. Safe to hand
   * straight to the engine.
   */
  readonly data: FillData;
  /**
   * Schema placeholders with no usable value → rendered blank →
   * drives partial_success. Dotted path for loop sub-fields
   * ("items.price"). Sorted, de-duplicated.
   */
  readonly missing: string[];
  /** Keys the model supplied that aren't in the template (ignored at render). */
  readonly unknownKeys: string[];
  /**
   * Type problems — a loop given a scalar, a field given an object, a
   * non-coercible value. Those placeholders are also forced into
   * `missing`; this list is the diagnostic detail.
   */
  readonly typeErrors: string[];
  /** Non-fatal notices (e.g. a loop truncated to the row cap). */
  readonly warnings: string[];
  /**
   * Derived fields whose deterministic re-check failed (or couldn't be
   * evaluated) — their value is replaced with [待核对] rather than shipping
   * a wrong number. Drives partial_success (P1).
   */
  readonly flagged: string[];
}

export interface ValidateOptions {
  /** Hard cap on loop rows (§7 安全上限). Default 2000. */
  readonly maxLoopRows?: number;
}

const DEFAULT_MAX_LOOP_ROWS = 2000;

/** Count every placeholder (fields + loop sub-fields), recursively. */
export function countPlaceholders(schema: PlaceholderSchema): number {
  const count = (fields: readonly PlaceholderField[]): number =>
    fields.reduce(
      (acc, f) => acc + 1 + (f.fields ? count(f.fields) : 0),
      0,
    );
  return count(schema.fields);
}

/** Flatten placeholder names to dotted paths — for prompts / logging. */
export function flattenPlaceholderNames(schema: PlaceholderSchema): string[] {
  const out: string[] = [];
  const walk = (fields: readonly PlaceholderField[], prefix: string): void => {
    for (const f of fields) {
      const path = prefix ? `${prefix}.${f.name}` : f.name;
      out.push(path);
      if (f.fields) walk(f.fields, path);
    }
  };
  walk(schema.fields, '');
  return out;
}

/**
 * Validate the model's fill JSON against the template's placeholder
 * schema. Pure + total — always returns, never throws. The returned
 * `data` is safe to render; `missing` is the canonical blank set.
 */
export function validateFillJson(
  schema: PlaceholderSchema,
  json: FillJson | null | undefined,
  opts: ValidateOptions = {},
): ValidatedFill {
  const maxLoopRows = opts.maxLoopRows ?? DEFAULT_MAX_LOOP_ROWS;
  const data: FillData = {};
  const missing = new Set<string>();
  const unknownKeys = new Set<string>();
  const typeErrors: string[] = [];
  const warnings: string[] = [];

  const fields = isRecord(json?.fields) ? json!.fields! : {};
  const loops = isRecord(json?.loops) ? json!.loops! : {};

  // Names the model declared as deliberately unfilled.
  const modelMissing = new Set<string>(
    Array.isArray(json?.missing)
      ? json!.missing!.filter((m): m is string => typeof m === 'string')
      : [],
  );

  const knownSimple = new Set<string>();
  const knownLoops = new Map<string, readonly PlaceholderField[]>();
  for (const f of schema.fields) {
    if (f.kind === 'loop') knownLoops.set(f.name, f.fields ?? []);
    else knownSimple.add(f.name);
  }

  // ---- simple fields ----
  for (const f of schema.fields) {
    if (f.kind !== 'field') continue;
    const raw = fields[f.name];
    if (raw === undefined) {
      missing.add(f.name);
      continue;
    }
    const coerced = coerceScalar(raw);
    if (coerced === null) {
      typeErrors.push(`字段 "${f.name}" 的值无法作为文本写入（收到 ${describe(raw)}）`);
      missing.add(f.name);
      continue;
    }
    if (coerced === '') {
      // Model returned an empty value → honestly blank.
      missing.add(f.name);
      continue;
    }
    data[f.name] = coerced;
  }

  // ---- loops ----
  for (const f of schema.fields) {
    if (f.kind !== 'loop') continue;
    const raw = loops[f.name];
    const sub = f.fields ?? [];
    if (raw === undefined) {
      missing.add(f.name);
      continue;
    }
    if (!Array.isArray(raw)) {
      typeErrors.push(`循环 "${f.name}" 需要一个数组，收到 ${describe(raw)}`);
      missing.add(f.name);
      continue;
    }
    if (raw.length === 0) {
      missing.add(f.name);
      continue;
    }
    let rows = raw;
    if (rows.length > maxLoopRows) {
      warnings.push(
        `循环 "${f.name}" 有 ${rows.length} 行，超过上限 ${maxLoopRows}，已截断`,
      );
      rows = rows.slice(0, maxLoopRows);
    }
    const builtRows: FillRow[] = [];
    // Track which sub-fields ever got a value, to report empty columns.
    const subSeen = new Set<string>();
    const subKnown = new Set(sub.map((s) => s.name));
    for (const rowRaw of rows) {
      if (!isRecord(rowRaw)) {
        typeErrors.push(`循环 "${f.name}" 的某一行不是对象（收到 ${describe(rowRaw)}）`);
        builtRows.push({});
        continue;
      }
      const row: FillRow = {};
      for (const [k, v] of Object.entries(rowRaw)) {
        if (!subKnown.has(k)) {
          unknownKeys.add(`${f.name}.${k}`);
          continue;
        }
        const coerced = coerceScalar(v);
        if (coerced === null) {
          typeErrors.push(
            `循环 "${f.name}" 的字段 "${k}" 值无法写入（收到 ${describe(v)}）`,
          );
          continue;
        }
        if (coerced === '') continue;
        row[k] = coerced;
        subSeen.add(k);
      }
      builtRows.push(row);
    }
    data[f.name] = builtRows;
    // A known sub-field that never appeared in any row is a blank column.
    for (const s of sub) {
      if (!subSeen.has(s.name)) missing.add(`${f.name}.${s.name}`);
    }
  }

  // ---- unknown top-level keys ----
  for (const key of Object.keys(fields)) {
    if (knownSimple.has(key)) continue;
    if (knownLoops.has(key)) {
      typeErrors.push(`"${key}" 是循环占位符，但出现在 fields 中（应放入 loops）`);
      continue;
    }
    unknownKeys.add(key);
  }
  for (const key of Object.keys(loops)) {
    if (knownLoops.has(key)) continue;
    if (knownSimple.has(key)) {
      typeErrors.push(`"${key}" 是普通占位符，但出现在 loops 中（应放入 fields）`);
      continue;
    }
    unknownKeys.add(key);
  }

  // Union the model's self-declared misses (only those that are real
  // placeholders — declaring a non-existent name as missing is noise).
  for (const name of modelMissing) {
    if (knownSimple.has(name) || knownLoops.has(name)) missing.add(name);
  }

  // P1 — derived-calculation defence. The model may compute fields like
  // 合计 / 差值 / 环比 and get them wrong (esp. unit confusion). Re-derive
  // each declared derivation deterministically from this fill JSON's input
  // values; on a mismatch (or an un-evaluable formula) mark the field
  // [待核对] instead of shipping a wrong number.
  const flagged: string[] = [];
  const derivations = Array.isArray(json?.derivations) ? json!.derivations! : [];
  for (const raw of derivations) {
    if (!isRecord(raw)) continue;
    const field = typeof raw.field === 'string' ? raw.field : '';
    const formula = typeof raw.formula === 'string' ? raw.formula : '';
    if (!field || !formula) continue;
    if (!knownSimple.has(field)) {
      unknownKeys.add(field);
      continue;
    }
    // Only re-check fields the model actually filled with a scalar.
    if (missing.has(field) || typeof data[field] !== 'string') continue;
    const computed = evalArithmetic(
      formula,
      (name) => parseNumeric(fields[name] ?? data[name]),
      (arg) => sumLoopColumn(arg, data),
    );
    const claimed = parseNumeric(data[field]);
    if (
      computed === null ||
      claimed === null ||
      !withinDerivationTolerance(computed, claimed)
    ) {
      data[field] = TBD_MARK;
      flagged.push(field);
      warnings.push(
        computed === null
          ? `字段 "${field}" 的推算无法复核（公式 "${formula}"），已标记 ${TBD_MARK}`
          : `字段 "${field}" 推算复核不一致（公式算得 ${computed}，模型填 ${claimed}），已标记 ${TBD_MARK}`,
      );
    }
  }

  return {
    data,
    missing: [...missing].sort(),
    unknownKeys: [...unknownKeys].sort(),
    typeErrors,
    warnings,
    flagged,
  };
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/**
 * Coerce an untrusted model value to a render scalar string.
 *   string  → trimmed
 *   number  → String() (finite only)
 *   boolean → "是" / "否"  (Chinese-facing documents)
 *   null / undefined / object / array / NaN → null (= cannot write)
 */
function coerceScalar(v: unknown): FillScalar | null {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? '是' : '否';
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '数组';
  return typeof v === 'object' ? '对象' : typeof v;
}
