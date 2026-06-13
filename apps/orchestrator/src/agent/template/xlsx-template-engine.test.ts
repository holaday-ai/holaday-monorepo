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
    const { buffer: out } = await fill(buf, { client_name: '张三' });
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
    const { buffer: out } = await fill(buf, { present: '有' });
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
    const { buffer: out } = await fill(buf, {
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
    const { buffer: out } = await fill(buf, { items: [] });
    const ws = await reload(out);
    // row 2 (the loop template) is spliced out; 结尾 shifts up to row 2
    expect(ws.getCell('A1').value).toBe('标题');
    expect(ws.getCell('A2').value).toBe('结尾');
  });

  // P0 / E10 — multi-row loop bodies are now block-duplicated (previously the
  // whole section was skipped and the data lost). This is the E10 shape:
  // {#tasks} on its own row, a body row of fields, {/tasks} on its own row.
  it('EXPANDS a multi-row loop (own-row markers) into one body row per item', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '本周完成事项：';
      ws.getCell('A2').value = '{#tasks}'; // pure open marker (delimiter)
      ws.getCell('A3').value = '{seq}';
      ws.getCell('B3').value = '{title}';
      ws.getCell('C3').value = '{status}';
      ws.getCell('A4').value = '{/tasks}'; // pure close marker (delimiter)
      ws.getCell('A5').value = '下周计划：{plan}';
    });
    const { buffer: out, skippedLoops } = await fill(buf, {
      plan: '灰度发布',
      tasks: [
        { seq: '1', title: '登录模块开发', status: '已完成' },
        { seq: '2', title: '支付联调', status: '进行中' },
        { seq: '3', title: '报表导出', status: '已完成' },
      ],
    });
    expect(skippedLoops).toHaveLength(0); // NOT skipped — fully expanded
    const ws = await reload(out);
    expect(ws.getCell('A1').value).toBe('本周完成事项：');
    // delimiter marker rows are gone; 3 task rows take their place at rows 2-4
    expect(ws.getCell('A2').value).toBe('1');
    expect(ws.getCell('B2').value).toBe('登录模块开发');
    expect(ws.getCell('C2').value).toBe('已完成');
    expect(ws.getCell('A3').value).toBe('2');
    expect(ws.getCell('B3').value).toBe('支付联调');
    expect(ws.getCell('A4').value).toBe('3');
    expect(ws.getCell('B4').value).toBe('报表导出');
    // content below the loop shifts up to row 5 and is filled
    expect(ws.getCell('A5').value).toBe('下周计划：灰度发布');
    // no {tag} leaks anywhere
    let leak = false;
    ws.eachRow((row) => row.eachCell((c) => { if (String(c.value ?? '').includes('{')) leak = true; }));
    expect(leak).toBe(false);
  });

  it('multi-row loop: preserves the body cells styles + row height across copies', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{#rows}';
      const body = ws.getCell('A2');
      body.value = '{label}';
      body.font = { bold: true, color: { argb: 'FF0000FF' } };
      body.numFmt = '@';
      ws.getRow(2).height = 33;
      ws.getCell('A3').value = '{/rows}';
    });
    const { buffer: out, skippedLoops } = await fill(buf, {
      rows: [{ label: '甲' }, { label: '乙' }],
    });
    expect(skippedLoops).toHaveLength(0);
    const ws = await reload(out);
    expect(ws.getCell('A1').value).toBe('甲');
    expect(ws.getCell('A2').value).toBe('乙');
    // style + height carried onto BOTH expanded rows
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A1').font?.color?.argb).toBe('FF0000FF');
    expect(ws.getCell('A2').font?.bold).toBe(true);
    expect(ws.getRow(1).height).toBe(33);
    expect(ws.getRow(2).height).toBe(33);
  });

  it('multi-row loop: handles a 2-row body block (each item spans two rows)', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{#items}{name}'; // inline open marker — row stays
      ws.getCell('A2').value = '  备注：{note}{/items}'; // inline close marker
    });
    const { buffer: out } = await fill(buf, {
      items: [
        { name: '苹果', note: '红色' },
        { name: '香蕉', note: '黄色' },
      ],
    });
    const ws = await reload(out);
    expect(ws.getCell('A1').value).toBe('苹果');
    expect(ws.getCell('A2').value).toBe('  备注：红色');
    expect(ws.getCell('A3').value).toBe('香蕉');
    expect(ws.getCell('A4').value).toBe('  备注：黄色');
  });

  it('multi-row loop with no data → the whole section is removed', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '标题';
      ws.getCell('A2').value = '{#items}';
      ws.getCell('A3').value = '{desc}';
      ws.getCell('A4').value = '{/items}';
      ws.getCell('A5').value = '结尾';
    });
    const { buffer: out, skippedLoops } = await fill(buf, { items: [] });
    expect(skippedLoops).toHaveLength(0);
    const ws = await reload(out);
    expect(ws.getCell('A1').value).toBe('标题');
    expect(ws.getCell('A2').value).toBe('结尾'); // section gone, 结尾 shifts up
  });

  it('produces a valid xlsx (PK zip) buffer', async () => {
    const buf = await buildXlsx((ws) => {
      ws.getCell('A1').value = '{x}';
    });
    const { buffer: out } = await fill(buf, { x: 'done' });
    expect(out[0]).toBe(0x50); // PK
    expect(out[1]).toBe(0x4b);
  });
});
