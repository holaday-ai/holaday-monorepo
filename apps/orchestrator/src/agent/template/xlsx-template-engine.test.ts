import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  extractPlaceholders,
  fill,
  XlsxTemplateError,
} from './xlsx-template-engine.js';

/** Build an .xlsx from a per-cell setup callback. */
async function buildXlsx(
  setup: (ws: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  setup(ws);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function reload(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.getWorksheet('Sheet1')!;
}

describe('extractPlaceholders (xlsx)', () => {
  it('extracts simple fields from cells', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '客户：{client_name}';
      ws.getCell('B1').value = '{date}';
    });
    const schema = await extractPlaceholders(buf);
    expect(schema.format).toBe('xlsx');
    expect(schema.fields).toEqual([
      { name: 'client_name', kind: 'field' },
      { name: 'date', kind: 'field' },
    ]);
  });

  it('extracts a single-row loop with its sub-fields', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{client_name}';
      ws.getCell('A3').value = '{#items}';
      ws.getCell('B3').value = '{desc}';
      ws.getCell('C3').value = '{price}';
      ws.getCell('D3').value = '{/items}';
    });
    const schema = await extractPlaceholders(buf);
    expect(schema.fields).toEqual([
      { name: 'client_name', kind: 'field' },
      {
        name: 'items',
        kind: 'loop',
        fields: [
          { name: 'desc', kind: 'field' },
          { name: 'price', kind: 'field' },
        ],
      },
    ]);
  });

  it('throws on an unmatched loop close', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{/orphan}';
    });
    await expect(extractPlaceholders(buf)).rejects.toBeInstanceOf(XlsxTemplateError);
  });
});

describe('fill (xlsx)', () => {
  it('substitutes a simple field and PRESERVES the cell style', async () => {
    const buf = await buildXlsx((ws) => {
      const c = ws.getCell('A1');
      c.value = '客户：{client_name}';
      c.font = { bold: true, color: { argb: 'FF0000FF' } };
    });
    const out = await fill(buf, { client_name: '张三' });
    const ws = await reload(out);
    expect(ws.getCell('A1').value).toBe('客户：张三');
    // style preserved
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A1').font?.color?.argb).toBe('FF0000FF');
  });

  it('leaves a missing field blank (cell cleared, no leftover tag)', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{present}';
      ws.getCell('A2').value = '{absent}';
    });
    const out = await fill(buf, { present: '有' });
    const ws = await reload(out);
    expect(ws.getCell('A1').value).toBe('有');
    expect(ws.getCell('A2').value).toBeNull();
  });

  it('expands a single-row loop into one row per data item', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '清单';
      ws.getCell('A2').value = '{#items}{desc}';
      ws.getCell('B2').value = '{price}{/items}';
    });
    const out = await fill(buf, {
      items: [
        { desc: '苹果', price: '5' },
        { desc: '香蕉', price: '3' },
        { desc: '橙子', price: '4' },
      ],
    });
    const ws = await reload(out);
    expect(ws.getCell('A2').value).toBe('苹果');
    expect(ws.getCell('B2').value).toBe('5');
    expect(ws.getCell('A3').value).toBe('香蕉');
    expect(ws.getCell('A4').value).toBe('橙子');
    expect(ws.getCell('B4').value).toBe('4');
    // the title row above the loop is untouched
    expect(ws.getCell('A1').value).toBe('清单');
  });

  it('removes the template row when a loop has no data', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '标题';
      ws.getCell('A2').value = '{#items}{desc}{/items}';
      ws.getCell('A3').value = '结尾';
    });
    const out = await fill(buf, { items: [] });
    const ws = await reload(out);
    // row 2 (the loop template) is spliced out; 结尾 shifts up to row 2
    expect(ws.getCell('A1').value).toBe('标题');
    expect(ws.getCell('A2').value).toBe('结尾');
  });

  it('fails honestly on a multi-row loop (v1 single-row only)', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{#items}';
      ws.getCell('A2').value = '{desc}';
      ws.getCell('A3').value = '{/items}';
    });
    await expect(fill(buf, { items: [{ desc: 'x' }] })).rejects.toMatchObject({
      kind: 'unsupported',
    });
  });

  it('produces a valid xlsx (PK zip) buffer', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{x}';
    });
    const out = await fill(buf, { x: 'done' });
    expect(out[0]).toBe(0x50); // PK
    expect(out[1]).toBe(0x4b);
  });
});
