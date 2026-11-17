import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { BrowserTaskFiles } from './browser-task-files.js';
import { BrowserTaskTable, TASK_TABLE_LIMITS } from './browser-task-table.js';
import { decimalAdd, decimalAverage, decimalText, tableDecimal } from './table-decimal.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(text: string | Buffer, name = 'report.csv') {
  const f = await browserOutputFixture();
  roots.push(f.root);
  const row = await f.service.storeUpload({
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename: name,
    mimetype: 'application/octet-stream',
    buffer: Buffer.from(text),
  });
  let active = true;
  const scope = new BrowserTaskFiles({
    taskId: 'tsk_alice',
    userId: 7,
    files: f.service,
    active: async () => active,
  });
  scope.admitValidated(await f.service.loadMany([row.externalId], 7));
  return {
    ...f,
    row,
    scope,
    table: new BrowserTaskTable(scope),
    revoke: () => {
      active = false;
    },
  };
}
describe('owned CSV table analysis', () => {
  it('computes exact decimal statistics over the real full CSV, including rows beyond the old 50k preview', async () => {
    const f = await fixture(`channel,amount\n${'web,0.10\n'.repeat(10000)}store,99.90\n`);
    const result = await f.table.run({
      fileId: f.row.externalId,
      mode: 'aggregate',
      metrics: [
        { op: 'count_rows' },
        { op: 'sum', column: 'B' },
        { op: 'avg', column: 'B' },
        { op: 'min', column: 'B' },
        { op: 'max', column: 'B' },
      ],
    });
    expect(result.mode).toBe('aggregate');
    if (result.mode !== 'aggregate') throw new Error('wrong result');
    expect(result.scope).toMatchObject({ scannedRows: 10001, matchedRows: 10001, blankRows: 0 });
    expect(result.overall.map((metric) => metric.value)).toEqual([
      '10001',
      '1099.9',
      '0.1099790021',
      '0.1',
      '99.9',
    ]);
    expect(result.overall[1]).toMatchObject({
      exact: true,
      numericCount: 10001,
      missingCount: 0,
      invalidCount: 0,
    });
    expect(result.complete).toBe(true);
  });
  it('keeps duplicate headers and quoted multiline cells distinct by their actual column IDs', async () => {
    const f = await fixture('name,name,amount\n"alpha, beta","line1\nline2",0.10\n001,002,0.20\n');
    const result = await f.table.run({ fileId: f.row.externalId, mode: 'describe' });
    expect(result.mode).toBe('describe');
    if (result.mode !== 'describe') throw new Error('wrong result');
    expect(result.columns.map((column) => [column.id, column.label])).toEqual([
      ['A', 'name'],
      ['B', 'name'],
      ['C', 'amount'],
    ]);
    expect(result.sample[0]?.values).toEqual(['alpha, beta', 'line1\nline2', '0.10']);
    expect(result.sample[1]?.values).toEqual(['001', '002', '0.20']);
    expect(result.scope.scannedRows).toBe(2);
  });
  it('counts blanks and invalid numbers separately and never reports their sum as complete', async () => {
    const f = await fixture('channel,amount\nweb,0.1\nweb,0.2\nstore,\nstore,N/A\n');
    const result = await f.table.run({
      fileId: f.row.externalId,
      mode: 'aggregate',
      metrics: [{ op: 'sum', column: 'B' }, { op: 'count_rows' }],
    });
    if (result.mode !== 'aggregate') throw new Error('wrong result');
    expect(result.overall[0]).toMatchObject({
      value: '0.3',
      numericCount: 2,
      missingCount: 1,
      invalidCount: 1,
      invalidExamples: ['N/A'],
      complete: false,
    });
    expect(result.overall[1]).toMatchObject({ value: '4', complete: true });
    expect(result.complete).toBe(false);
    expect(f.table.incomplete()).toBe(true);
  });
  it('applies explicit filters to all rows before grouping without depending on AND filter order', async () => {
    const f = await fixture(
      'channel,amount,status\nweb,0.1,done\nweb,0.2,done\nstore,,done\nstore,N/A,done\nstore,99.9,draft\n',
    );
    const result = await f.table.run({
      fileId: f.row.externalId,
      mode: 'aggregate',
      filters: [
        { column: 'B', op: 'gt', value: '0.15' },
        { column: 'B', op: 'nonempty' },
        { column: 'B', op: 'ne', value: 'N/A' },
        { column: 'C', op: 'eq', value: 'done' },
      ],
      groupBy: ['A'],
      metrics: [{ op: 'sum', column: 'B' }, { op: 'count_rows' }],
    });
    if (result.mode !== 'aggregate') throw new Error('wrong result');
    expect(result.scope).toMatchObject({ scannedRows: 5, matchedRows: 1 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.keys).toEqual(['web']);
    expect(result.groups[0]?.metrics[0]?.value).toBe('0.2');
    expect(result.complete).toBe(true);
  });
  it('tracks pagination gaps and overlapping groups without mistaking the last page for the full result', async () => {
    const f = await fixture(
      `group,amount\n${Array.from({ length: 12 }, (_, i) => `G${String(i).padStart(2, '0')},0.1`).join('\n')}\n`,
    );
    const query = {
      fileId: f.row.externalId,
      mode: 'aggregate' as const,
      groupBy: ['A'],
      metrics: [{ op: 'sum' as const, column: 'B' }],
      limit: 5,
    };
    const last = await f.table.run({ ...query, offset: 10 });
    if (last.mode !== 'aggregate') throw new Error('wrong result');
    expect(last.page).toMatchObject({ total: 12, nextOffset: 0, ranges: [[10, 12]] });
    expect(last.complete).toBe(false);
    const first = await f.table.run(query);
    if (first.mode !== 'aggregate') throw new Error('wrong result');
    expect(first.page.nextOffset).toBe(5);
    expect(first.overall[0]?.value).toBe('1.2');
    first.page.ranges[0]![1] = 12;
    const middle = await f.table.run({ ...query, offset: 5, delimiter: ',', headerRow: 1 });
    if (middle.mode !== 'aggregate') throw new Error('wrong result');
    expect(middle.analysisId).toBe(last.analysisId);
    expect(middle.page).toMatchObject({ nextOffset: null, ranges: [[0, 12]] });
    expect(middle.complete).toBe(true);
    expect(f.table.completeFiles().has(f.row.externalId)).toBe(true);
  });
  it('retains BOM, separator/header choices and blank-row accounting without parsing IDs or formulas as numbers', async () => {
    const f = await fixture(
      '\ufeffmetadata\r\ncode;amount\r\n001;0.1\r\n\r\n=HYPERLINK("https://example.com");0.2\r\n',
    );
    // A literal quote in an unquoted CSV cell is malformed; proper CSV escapes it.
    await expect(
      f.table.run({ fileId: f.row.externalId, mode: 'describe', delimiter: ';', headerRow: 2 }),
    ).rejects.toThrow('引号');
    const valid = await fixture(
      '\ufeffmetadata\r\ncode;amount\r\n001;0.1\r\n\r\n"=HYPERLINK(""https://example.com"")";0.2\r\n',
    );
    const result = await valid.table.run({
      fileId: valid.row.externalId,
      mode: 'describe',
      delimiter: ';',
      headerRow: 2,
    });
    if (result.mode !== 'describe') throw new Error('wrong result');
    expect(result.scope).toMatchObject({
      scannedRows: 2,
      blankRows: 1,
      headerRow: 2,
      delimiter: ';',
    });
    const formula = '=HYPERLINK("https://example.com")';
    expect(result.sample.map((row) => row.values[0])).toEqual(['001', formula.slice(0, 32)]);
    expect(result.sample[1]?.truncated).toBe(true);
    const literal = await valid.table.run({
      fileId: valid.row.externalId,
      mode: 'aggregate',
      delimiter: ';',
      headerRow: 2,
      metrics: [{ op: 'sum', column: 'A' }],
    });
    if (literal.mode !== 'aggregate') throw new Error('wrong result');
    expect(literal.overall[0]?.invalidExamples).toContain(formula);
  });
  it.each(['code,amount\n"unclosed,1', 'code,amount\na"b,1\n', 'code,amount\n"a"oops,1\n'])(
    'rejects malformed CSV instead of reporting a partial parse: %s',
    async (csv) => {
      const f = await fixture(csv);
      await expect(f.table.run({ fileId: f.row.externalId, mode: 'describe' })).rejects.toThrow(
        '引号',
      );
    },
  );
  it('refuses unadmitted file IDs, other owners, invalid numeric filters, cancellation and revoked tasks', async () => {
    const f = await fixture('a,b\nx,1\n');
    const other = await f.service.storeUpload({
      userIdInternal: 8,
      userExternalId: 'usr_bob',
      filename: 'private.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('secret,9'),
    });
    await expect(f.table.run({ fileId: other.externalId, mode: 'describe' })).rejects.toThrow(
      '材料范围',
    );
    await expect(
      f.table.run({
        fileId: f.row.externalId,
        mode: 'aggregate',
        filters: [{ column: 'B', op: 'gt', value: 'no-number' }],
        metrics: [{ op: 'sum', column: 'B' }],
      }),
    ).rejects.toThrow('有效十进制');
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.table.run({ fileId: f.row.externalId, mode: 'describe' }, controller.signal),
    ).rejects.toThrow('取消');
    f.revoke();
    await expect(f.table.run({ fileId: f.row.externalId, mode: 'describe' })).rejects.toThrow(
      '不可用',
    );
  });
  it('keeps decimal sums, large integers and rounded means explicit', () => {
    expect(decimalText(decimalAdd(tableDecimal('0.1')!, tableDecimal('0.2')!))).toBe('0.3');
    expect(decimalText(decimalAdd(tableDecimal('9007199254740993')!, tableDecimal('1')!))).toBe(
      '9007199254740994',
    );
    expect(decimalAverage(tableDecimal('1')!, 3)).toEqual({
      value: '0.333333333333',
      exact: false,
      fractionDigits: 12,
    });
    expect(decimalAverage(tableDecimal('-0.000000000001')!, 2)).toEqual({
      value: '-0.000000000001',
      exact: false,
      fractionDigits: 12,
    });
    expect(tableDecimal('1,234.50')).toBeNull();
    expect(tableDecimal('1.2e30')).toBeNull();
  });
  it('bounds wide previews and grouped responses while preserving exact pagination coverage', async () => {
    const header = Array.from({ length: 128 }, (_, i) => `${i}-${'列'.repeat(70)}`).join(',');
    const wide = await fixture(
      `${header}\n${Array.from({ length: 5 }, () => Array(128).fill('x'.repeat(80)).join(',')).join('\n')}\n`,
    );
    const description = await wide.table.run({ fileId: wide.row.externalId, mode: 'describe' });
    expect(Buffer.byteLength(JSON.stringify(description))).toBeLessThanOrEqual(
      TASK_TABLE_LIMITS.responseBytes,
    );
    if (description.mode !== 'describe') throw new Error('wrong result');
    expect(description.columns).toHaveLength(128);
    expect(
      description.sample.length === 0 || description.sample.every((row) => row.truncated),
    ).toBe(true);
    const f = await fixture(
      `group,amount\n${Array.from({ length: 50 }, (_, i) => `${String(i).padStart(3, '0')}${'组'.repeat(60)},0.1`).join('\n')}\n`,
    );
    const result = await f.table.run({
      fileId: f.row.externalId,
      mode: 'aggregate',
      groupBy: ['A'],
      limit: 50,
      metrics: Array.from({ length: 8 }, () => ({ op: 'sum' as const, column: 'B' })),
    });
    if (result.mode !== 'aggregate') throw new Error('wrong result');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      TASK_TABLE_LIMITS.responseBytes,
    );
    expect(result.page.end).toBeLessThan(50);
    expect(result.complete).toBe(false);
    expect(result.page.nextOffset).toBe(result.page.end);
  });
  it('keeps CRLF and LF within quoted group values distinct instead of silently merging identifiers', async () => {
    const f = await fixture('group,amount\r\n"a\r\nb",0.1\r\n"a\nb",0.2\r\n');
    const result = await f.table.run({
      fileId: f.row.externalId,
      mode: 'aggregate',
      groupBy: ['A'],
      metrics: [{ op: 'sum', column: 'B' }],
    });
    if (result.mode !== 'aggregate') throw new Error('wrong result');
    expect(new Set(result.groups.map((group) => group.keys[0]))).toEqual(
      new Set(['a\r\nb', 'a\nb']),
    );
    expect(result.overall[0]?.value).toBe('0.3');
  });
  it('rejects oversized structures and status changes before delivering computed results', async () => {
    const tooWide = await fixture(`${Array(129).fill('column').join(',')}\n`);
    await expect(
      tooWide.table.run({ fileId: tooWide.row.externalId, mode: 'describe' }),
    ).rejects.toThrow('列数');
    const tooBig = await fixture(Buffer.alloc(TASK_TABLE_LIMITS.bytes + 1, 65));
    await expect(
      tooBig.table.run({ fileId: tooBig.row.externalId, mode: 'describe' }),
    ).rejects.toThrow('8MB');
    const f = await fixture('a,b\nx,1\n');
    vi.spyOn(f.scope, 'isActive').mockResolvedValue(false);
    await expect(
      f.table.run({
        fileId: f.row.externalId,
        mode: 'aggregate',
        metrics: [{ op: 'sum', column: 'B' }],
      }),
    ).rejects.toThrow('不可用');
  });
});
