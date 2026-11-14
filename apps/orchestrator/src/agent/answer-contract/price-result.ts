/**
 * REBUILD-3: the structured result a price task hands in (`finish.price_result`).
 *
 * The model fills fields; code checks and renders them. `quote` is page text copied verbatim,
 * `block_ref` names where it was read (see read-blocks.ts). What was not obtained goes to
 * `missing` — it is delivered as 部分完成, never sent back.
 */

export type PriceLanguage = 'zh' | 'en';

export interface PriceItem {
  name: string;
  variant: string | null;
  price: string;
  currency: string | null;
  source_url: string | null;
  quote: string;
  block_ref: string;
}

export interface PriceMissing {
  field: string;
  item: string;
  reason: string;
}

export interface PriceResult {
  language: PriceLanguage;
  items: PriceItem[];
  missing: PriceMissing[];
  note: string | null;
}

const text = (maxLength: number) => ({ type: 'string', maxLength });
const nullableText = (maxLength: number) => ({ type: ['string', 'null'], maxLength });

/** JSON schema of `price_result` on the finish tool. */
export const PRICE_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', enum: ['zh', 'en'] },
    items: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: text(400),
          variant: nullableText(200),
          price: text(60),
          currency: nullableText(12),
          source_url: nullableText(2048),
          quote: text(600),
          block_ref: text(80),
        },
        required: ['name', 'price', 'quote', 'block_ref'],
      },
    },
    missing: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { field: text(40), item: text(400), reason: text(300) },
        required: ['field', 'item', 'reason'],
      },
    },
    note: nullableText(500),
  },
  required: ['language', 'items', 'missing'],
};

export type PriceResultParse = { ok: true; value: PriceResult } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function str(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
  options: { required?: boolean; max: number },
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    if (options.required) errors.push(`${path}.${key} 缺失`);
    return null;
  }
  if (typeof value !== 'string') {
    errors.push(`${path}.${key} 不是字符串`);
    return null;
  }
  const trimmed = value.trim();
  if (options.required && !trimmed) errors.push(`${path}.${key} 为空`);
  if (trimmed.length > options.max) errors.push(`${path}.${key} 超过 ${options.max} 字`);
  return trimmed || null;
}

/**
 * Validates `price_result` against the schema. A JSON string is accepted (some providers
 * pass nested objects as text). Nothing is repaired or guessed: an invalid result is retried.
 */
export function parsePriceResult(raw: unknown): PriceResultParse {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, errors: ['price_result 不是合法 JSON'] };
    }
  }
  if (!isRecord(value)) return { ok: false, errors: ['price_result 缺失或不是对象'] };
  const errors: string[] = [];
  const language = value.language;
  if (language !== 'zh' && language !== 'en') errors.push('price_result.language 须为 zh 或 en');
  if (!Array.isArray(value.items)) errors.push('price_result.items 须为数组');
  if (!Array.isArray(value.missing)) errors.push('price_result.missing 须为数组');
  const items: PriceItem[] = [];
  for (const [i, entry] of (Array.isArray(value.items) ? value.items : []).entries()) {
    const path = `items[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${path} 不是对象`);
      continue;
    }
    const name = str(entry, 'name', path, errors, { required: true, max: 400 });
    const price = str(entry, 'price', path, errors, { required: true, max: 60 });
    const quote = str(entry, 'quote', path, errors, { required: true, max: 600 });
    const blockRef = str(entry, 'block_ref', path, errors, { required: true, max: 80 });
    const item: PriceItem = {
      name: name ?? '',
      variant: str(entry, 'variant', path, errors, { max: 200 }),
      price: price ?? '',
      currency: str(entry, 'currency', path, errors, { max: 12 }),
      source_url: str(entry, 'source_url', path, errors, { max: 2048 }),
      quote: quote ?? '',
      block_ref: blockRef ?? '',
    };
    items.push(item);
  }
  const missing: PriceMissing[] = [];
  for (const [i, entry] of (Array.isArray(value.missing) ? value.missing : []).entries()) {
    const path = `missing[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${path} 不是对象`);
      continue;
    }
    missing.push({
      field: str(entry, 'field', path, errors, { required: true, max: 40 }) ?? '',
      item: str(entry, 'item', path, errors, { required: true, max: 400 }) ?? '',
      reason: str(entry, 'reason', path, errors, { required: true, max: 300 }) ?? '',
    });
  }
  const note = isRecord(value) ? str(value, 'note', 'price_result', errors, { max: 500 }) : null;
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { language: language as PriceLanguage, items, missing, note },
  };
}
