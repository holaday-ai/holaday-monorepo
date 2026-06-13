/**
 * Messy-material end-to-end fixture (Phase 1 #1) — pinned in CI because this
 * exact scenario caught real bugs during acceptance (2026-06-13): the derived-
 * calc re-check ([待核对]), the xlsx multi-row loop degrade, and honest missing.
 *
 * Deterministic + offline: builds a 14-field weekly-report xlsx template, feeds
 * a FIXED model mapping (the shape the real model produced), runs the full
 * runTemplateFillTask, and asserts the per-field outcomes + the downloaded
 * workbook. No network / no live model — so it's a stable regression guard.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import ExcelJS from 'exceljs';
import {
  runTemplateFillTask,
  type SaveTemplateFn,
  type TemplateAttachment,
} from './template-fill-runner.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, debug: noop, error: noop, fatal: noop, trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

function capturingSave(): { save: SaveTemplateFn; captured: { buffer?: Buffer } } {
  const captured: { buffer?: Buffer } = {};
  const save: SaveTemplateFn = async (out) => {
    captured.buffer = out.buffer;
    const a: TemplateAttachment = {
      fileId: 'file_e2e', downloadUrl: '/api/files/file_e2e/download',
      filename: out.filename, mimetype: out.mimetype, sizeBytes: out.buffer.length,
      expiresAt: '2026-06-14T00:00:00.000Z', kind: 'output',
    };
    return a;
  };
  return { save, captured };
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 14-field weekly report: simple + 2 correct derivations + 1 unit-confused
 *  derivation + a multi-row loop + an honest-missing field. */
async function buildWeeklyTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('周报');
  ws.getCell('A1').value = '{report_title}'; ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = '周次：{week_no}';
  ws.getCell('A3').value = '编制：{author}  日期：{report_date}';
  ws.getCell('A5').value = '本周GMV：{gmv_this}';
  ws.getCell('A6').value = '上周GMV：{gmv_last}';
  ws.getCell('A7').value = 'GMV环比：{gmv_wow}%';
  ws.getCell('A8').value = '本周订单：{orders_this}';
  ws.getCell('A9').value = '上周订单：{orders_last}';
  ws.getCell('A10').value = '订单环比：{orders_wow}%';
  ws.getCell('A11').value = '毛利：{gross_profit}'; // derived, unit-confused → [待核对]
  ws.getCell('A13').value = '{#tasks}';              // multi-row loop → degrade
  ws.getCell('A14').value = '{task_name} — {task_status}';
  ws.getCell('A15').value = '{/tasks}';
  ws.getCell('A17').value = '任务数：{task_count}';
  ws.getCell('A18').value = '备注：{remark}';        // missing → blank
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// The fixed mapping a model produces for the messy material. gross_profit is
// the unit-confusion trap: the diff is 1,200,000-1,000,000 = 200,000 (20万) but
// the model wrote "20" (dropped 万) → the deterministic re-check must flag it.
const MODEL_JSON = JSON.stringify({
  fields: {
    report_title: '第24周经营周报', week_no: '24', author: '张三', report_date: '2026-06-13',
    gmv_this: '120万', gmv_last: '100万', gmv_wow: '20',
    orders_this: '1500', orders_last: '1200', orders_wow: '25',
    gross_profit: '20', task_count: '3',
  },
  loops: {
    tasks: [
      { task_name: '拉新', task_status: '已完成' },
      { task_name: '上架', task_status: '进行中' },
      { task_name: '对账', task_status: '待办' },
    ],
  },
  missing: ['remark'],
  derivations: [
    { field: 'gmv_wow', formula: '(gmv_this - gmv_last) / gmv_last * 100' },
    { field: 'orders_wow', formula: '(orders_this - orders_last) / orders_last * 100' },
    { field: 'gross_profit', formula: 'gmv_this - gmv_last' },
  ],
});

describe('messy-material e2e (2026-06-13 acceptance fixture)', () => {
  it('fills 14 fields with the right per-field outcomes', async () => {
    const template = await buildWeeklyTemplate();
    const { save, captured } = capturingSave();
    const out = await runTemplateFillTask({
      intent:
        '按这个周报模板填充：第24周，编制张三，本周GMV 120万、上周100万，本周订单1500、上周1200，毛利你算，任务：拉新已完成/上架进行中/对账待办，共3个',
      template: { buffer: template, filename: '经营周报.xlsx', mimetype: XLSX_MIME },
      allowedFormats: ['docx', 'xlsx', 'md', 'csv', 'json', 'txt', 'pdf', 'pptx'],
      save,
      model: vi.fn(async () => MODEL_JSON),
      logger: fakeLogger(),
    });

    // terminal status: partial_success (missing remark + flagged gross_profit + skipped tasks)
    expect(out.status).toBe('partial_success');
    expect(out.format).toBe('xlsx');

    // multi-row loop degraded (not failed)
    expect(out.skippedLoops).toContain('tasks');
    // honest missing
    expect(out.missing).toContain('remark');
    // the summary surfaces the derived re-check, the degrade, and the missing
    // field honestly (gross_profit flagged; the correct derivations are NOT).
    expect(out.summary).toContain('待核对');
    expect(out.summary).toContain('gross_profit');
    expect(out.summary).toContain('循环段未填充');
    expect(out.summary).toContain('remark');
    // (per-field re-check outcome is asserted on the downloaded cells below:
    //  A7/A10 hold the correct derived values, A11 is [待核对].)

    // the downloaded workbook reflects the 14-field expectations
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(captured.buffer!);
    const w = wb.getWorksheet('周报')!;
    const cell = (a: string): string => String(w.getCell(a).value ?? '');
    expect(cell('A1')).toBe('第24周经营周报');
    expect(cell('A2')).toBe('周次：24');
    expect(cell('A3')).toBe('编制：张三  日期：2026-06-13');
    expect(cell('A5')).toBe('本周GMV：120万');
    expect(cell('A6')).toBe('上周GMV：100万');
    expect(cell('A7')).toBe('GMV环比：20%'); // derived, re-check passed
    expect(cell('A8')).toBe('本周订单：1500');
    expect(cell('A10')).toBe('订单环比：25%'); // derived, re-check passed
    expect(cell('A11')).toBe('毛利：[待核对]'); // derived, unit-confused → flagged
    expect(cell('A17')).toBe('任务数：3');
    expect(cell('A18')).toBe('备注：'); // remark missing → blank
    // multi-row loop markers cleared (no {tag} leak)
    expect(cell('A13')).not.toContain('{');
    expect(cell('A15')).not.toContain('{');
  });
});
