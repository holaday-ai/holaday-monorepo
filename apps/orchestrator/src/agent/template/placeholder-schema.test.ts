import { describe, it, expect } from 'vitest';
import {
  validateFillJson,
  countPlaceholders,
  flattenPlaceholderNames,
  type PlaceholderSchema,
} from './placeholder-schema.js';

const invoiceSchema: PlaceholderSchema = {
  format: 'docx',
  fields: [
    { name: 'client_name', kind: 'field' },
    { name: 'invoice_no', kind: 'field' },
    { name: 'date', kind: 'field' },
    {
      name: 'items',
      kind: 'loop',
      fields: [
        { name: 'desc', kind: 'field' },
        { name: 'qty', kind: 'field' },
        { name: 'price', kind: 'field' },
      ],
    },
    { name: 'total', kind: 'field' },
  ],
};

describe('countPlaceholders', () => {
  it('counts simple fields + loop and its sub-fields', () => {
    // 4 simple (client_name, invoice_no, date, total) + items loop + 3 sub
    expect(countPlaceholders(invoiceSchema)).toBe(8);
  });
});

describe('flattenPlaceholderNames', () => {
  it('returns dotted paths for loop sub-fields', () => {
    expect(flattenPlaceholderNames(invoiceSchema)).toEqual([
      'client_name',
      'invoice_no',
      'date',
      'items',
      'items.desc',
      'items.qty',
      'items.price',
      'total',
    ]);
  });
});

describe('validateFillJson — happy path', () => {
  it('maps known fields + a loop and reports no missing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: {
        client_name: '张三',
        invoice_no: 'INV-001',
        date: '2026-06-11',
        total: '100',
      },
      loops: {
        items: [
          { desc: '苹果', qty: '2', price: '5' },
          { desc: '香蕉', qty: '3', price: '3' },
        ],
      },
    });
    expect(out.missing).toEqual([]);
    expect(out.typeErrors).toEqual([]);
    expect(out.unknownKeys).toEqual([]);
    expect(out.data.client_name).toBe('张三');
    expect(out.data.items).toEqual([
      { desc: '苹果', qty: '2', price: '5' },
      { desc: '香蕉', qty: '3', price: '3' },
    ]);
  });

  it('coerces number and boolean scalars to strings', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: '张三', invoice_no: 42, date: true, total: 99.5 },
      loops: { items: [{ desc: 'x', qty: 1, price: 2 }] },
    });
    expect(out.data.invoice_no).toBe('42');
    expect(out.data.date).toBe('是');
    expect(out.data.total).toBe('99.5');
    expect(out.data.items).toEqual([{ desc: 'x', qty: '1', price: '2' }]);
  });

  it('trims whitespace on string values', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: '  张三  ' },
    });
    expect(out.data.client_name).toBe('张三');
  });
});

describe('validateFillJson — missing detection', () => {
  it('flags absent simple fields as missing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: '张三' },
      loops: { items: [{ desc: 'a', qty: '1', price: '2' }] },
    });
    expect(out.missing).toContain('invoice_no');
    expect(out.missing).toContain('date');
    expect(out.missing).toContain('total');
    expect(out.missing).not.toContain('client_name');
  });

  it('treats empty / whitespace-only values as missing (honest blank)', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: '', invoice_no: '   ' },
    });
    expect(out.missing).toContain('client_name');
    expect(out.missing).toContain('invoice_no');
    expect(out.data.client_name).toBeUndefined();
  });

  it('flags an absent loop as missing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: {
        client_name: '张三',
        invoice_no: 'x',
        date: 'x',
        total: 'x',
      },
    });
    expect(out.missing).toEqual(['items']);
  });

  it('flags an empty loop array as missing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: 'a', invoice_no: 'b', date: 'c', total: 'd' },
      loops: { items: [] },
    });
    expect(out.missing).toEqual(['items']);
  });

  it('reports an entirely-empty loop column as a dotted missing path', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: 'a', invoice_no: 'b', date: 'c', total: 'd' },
      // every row omits `price`
      loops: { items: [{ desc: 'x', qty: '1' }, { desc: 'y', qty: '2' }] },
    });
    expect(out.missing).toContain('items.price');
    expect(out.missing).not.toContain('items.desc');
  });

  it('unions the model self-declared missing list (real names only)', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: '张三', invoice_no: 'x', date: 'x', total: 'x' },
      loops: { items: [{ desc: 'a', qty: '1', price: '2' }] },
      missing: ['date', 'not_a_real_field'],
    });
    // `date` was actually provided, but the model declared it missing →
    // honour the model's doubt; ignore the non-existent name.
    expect(out.missing).toContain('date');
    expect(out.missing).not.toContain('not_a_real_field');
  });
});

describe('validateFillJson — no invented placeholders', () => {
  it('drops unknown top-level keys into unknownKeys (never into data)', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: '张三', made_up: 'x' },
    });
    expect(out.unknownKeys).toContain('made_up');
    expect(out.data.made_up).toBeUndefined();
  });

  it('drops unknown loop sub-keys but keeps known ones', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: 'a', invoice_no: 'b', date: 'c', total: 'd' },
      loops: { items: [{ desc: 'x', qty: '1', price: '2', bogus: 'zzz' }] },
    });
    expect(out.unknownKeys).toContain('items.bogus');
    expect(out.data.items).toEqual([{ desc: 'x', qty: '1', price: '2' }]);
  });

  it('flags a field/loop kind mismatch as a typeError', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { items: 'should be a loop' },
      loops: { client_name: [{ a: 'b' }] },
    });
    expect(out.typeErrors.some((e) => e.includes('items'))).toBe(true);
    expect(out.typeErrors.some((e) => e.includes('client_name'))).toBe(true);
  });
});

describe('validateFillJson — type errors', () => {
  it('rejects an object value for a simple field and marks it missing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: { nested: 'no' } },
    });
    expect(out.typeErrors.some((e) => e.includes('client_name'))).toBe(true);
    expect(out.missing).toContain('client_name');
    expect(out.data.client_name).toBeUndefined();
  });

  it('rejects a non-array loop value and marks the loop missing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: 'a', invoice_no: 'b', date: 'c', total: 'd' },
      loops: { items: 'not an array' },
    });
    expect(out.typeErrors.some((e) => e.includes('items'))).toBe(true);
    expect(out.missing).toContain('items');
  });

  it('rejects a non-object loop row', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: 'a', invoice_no: 'b', date: 'c', total: 'd' },
      loops: { items: ['just a string'] },
    });
    expect(out.typeErrors.some((e) => e.includes('items'))).toBe(true);
  });

  it('rejects NaN / Infinity as non-writable', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: { client_name: NaN, invoice_no: Infinity },
    });
    expect(out.missing).toContain('client_name');
    expect(out.missing).toContain('invoice_no');
  });
});

describe('validateFillJson — loop row cap (§7)', () => {
  it('truncates a loop to maxLoopRows and warns', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ desc: `d${i}`, qty: '1', price: '1' }));
    const out = validateFillJson(
      invoiceSchema,
      {
        fields: { client_name: 'a', invoice_no: 'b', date: 'c', total: 'd' },
        loops: { items: rows },
      },
      { maxLoopRows: 2 },
    );
    expect((out.data.items as unknown[]).length).toBe(2);
    expect(out.warnings.some((w) => w.includes('截断'))).toBe(true);
  });
});

describe('validateFillJson — hostile / empty input (no fake success)', () => {
  it('null model output → everything missing, nothing written', () => {
    const out = validateFillJson(invoiceSchema, null);
    expect(out.data).toEqual({});
    expect(out.missing).toEqual([
      'client_name',
      'date',
      'invoice_no',
      'items',
      'total',
    ]);
  });

  it('garbage shapes degrade safely rather than throwing', () => {
    const out = validateFillJson(invoiceSchema, {
      fields: ['not', 'a', 'record'] as unknown as Record<string, unknown>,
      loops: 42 as unknown as Record<string, unknown>,
    });
    expect(out.data).toEqual({});
    expect(out.missing.length).toBeGreaterThan(0);
  });
});


describe('validateFillJson — derived-calc re-check (P1)', () => {
  const calcSchema: PlaceholderSchema = {
    format: 'docx',
    fields: [
      { name: 'revenue', kind: 'field' },
      { name: 'cost', kind: 'field' },
      { name: 'profit', kind: 'field' },
    ],
  };

  it('keeps a correct derived value', () => {
    const out = validateFillJson(calcSchema, {
      fields: { revenue: '50万', cost: '30万', profit: '20万' },
      derivations: [{ field: 'profit', formula: 'revenue - cost' }],
    });
    expect(out.flagged).toEqual([]);
    expect(out.data.profit).toBe('20万');
  });

  it('flags a UNIT-CONFUSED derived value as [待核对] (model dropped the 万)', () => {
    const out = validateFillJson(calcSchema, {
      fields: { revenue: '50万', cost: '30万', profit: '20' },
      derivations: [{ field: 'profit', formula: 'revenue - cost' }],
    });
    expect(out.flagged).toContain('profit');
    expect(out.data.profit).toBe('[待核对]');
    expect(out.warnings.some((w) => w.includes('profit'))).toBe(true);
  });

  it('flags when the formula cannot be evaluated', () => {
    const out = validateFillJson(calcSchema, {
      fields: { revenue: '50万', cost: '30万', profit: '20万' },
      derivations: [{ field: 'profit', formula: 'revenue - nonexistent' }],
    });
    expect(out.data.profit).toBe('[待核对]');
    expect(out.flagged).toContain('profit');
  });

  it('re-checks a loop-sum total and flags a wrong one', () => {
    const loopSchema: PlaceholderSchema = {
      format: 'docx',
      fields: [
        { name: 'items', kind: 'loop', fields: [{ name: 'price', kind: 'field' }] },
        { name: 'total', kind: 'field' },
      ],
    };
    const ok = validateFillJson(loopSchema, {
      loops: { items: [{ price: '5' }, { price: '3' }] },
      fields: { total: '8' },
      derivations: [{ field: 'total', formula: 'sum(items.price)' }],
    });
    expect(ok.flagged).toEqual([]);
    const bad = validateFillJson(loopSchema, {
      loops: { items: [{ price: '5' }, { price: '3' }] },
      fields: { total: '80' },
      derivations: [{ field: 'total', formula: 'sum(items.price)' }],
    });
    expect(bad.data.total).toBe('[待核对]');
    expect(bad.flagged).toContain('total');
  });

  it('no derivations → flagged empty (back-compat)', () => {
    const out = validateFillJson(calcSchema, {
      fields: { revenue: '1', cost: '2', profit: '3' },
    });
    expect(out.flagged).toEqual([]);
  });
});
