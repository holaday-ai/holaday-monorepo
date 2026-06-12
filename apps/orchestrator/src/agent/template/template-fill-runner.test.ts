import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import {
  runTemplateFillTask,
  parseFillJson,
  buildUserPrompt,
  type SaveTemplateFn,
  type TemplateFillModelFn,
  type TemplateAttachment,
} from './template-fill-runner.js';
import type { PlaceholderSchema } from './placeholder-schema.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, debug: noop, error: noop, fatal: noop, trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

async function buildDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: lines.map((l) => new Paragraph({ children: [new TextRun(l)] })) }],
  });
  return Packer.toBuffer(doc);
}

function fullText(buf: Buffer): string {
  return new Docxtemplater(new PizZip(buf)).getFullText();
}

/** A `save` that records the filled buffer so tests can inspect the output. */
function capturingSave(): { save: SaveTemplateFn; captured: { buffer?: Buffer; filename?: string } } {
  const captured: { buffer?: Buffer; filename?: string } = {};
  const save: SaveTemplateFn = async (out) => {
    captured.buffer = out.buffer;
    captured.filename = out.filename;
    const a: TemplateAttachment = {
      fileId: 'file_x',
      downloadUrl: '/api/files/file_x/download',
      filename: out.filename,
      mimetype: out.mimetype,
      sizeBytes: out.buffer.length,
      expiresAt: '2026-06-12T00:00:00.000Z',
      kind: 'output',
    };
    return a;
  };
  return { save, captured };
}

function modelReturning(json: string): TemplateFillModelFn {
  return vi.fn(async () => json);
}

const PRO_FORMATS = ['docx', 'xlsx', 'md', 'csv', 'json', 'txt', 'pdf', 'pptx'];
const BASIC_FORMATS = ['csv', 'txt', 'md', 'json'];

describe('runTemplateFillTask — happy path', () => {
  it('fills a docx and returns a completed result with an attachment', async () => {
    const template = await buildDocx(['客户：{client_name}  编号：{invoice_no}']);
    const { save, captured } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '客户是张三，编号 INV-1',
      template: { buffer: template, filename: '发票模板.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{"fields":{"client_name":"张三","invoice_no":"INV-1"},"loops":{},"missing":[]}'),
      logger: fakeLogger(),
    });

    expect(out.status).toBe('completed');
    expect(out.format).toBe('docx');
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0]!.filename).toBe('发票模板-已填充.docx');
    expect(out.summary).toContain('张三');
    // the captured output is a real docx with the values rendered in
    expect(captured.buffer && fullText(captured.buffer)).toContain('张三');
    expect(captured.buffer && fullText(captured.buffer)).toContain('INV-1');
  });

  it('expands a loop from the model mapping', async () => {
    const template = await buildDocx(['{#items}', '{desc}:{price}', '{/items}']);
    const { save, captured } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '苹果5元，香蕉3元',
      template: { buffer: template, filename: '清单.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning(
        '{"fields":{},"loops":{"items":[{"desc":"苹果","price":"5"},{"desc":"香蕉","price":"3"}]},"missing":[]}',
      ),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('completed');
    const text = fullText(captured.buffer!);
    expect(text).toContain('苹果:5');
    expect(text).toContain('香蕉:3');
  });
});

describe('runTemplateFillTask — xlsx', () => {
  it('fills an xlsx template (style preserved) and completes', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quote');
    const c = ws.getCell('A1');
    c.value = '客户：{client_name}';
    c.font = { bold: true };
    const template = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { save, captured } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '客户是李四',
      template: {
        buffer: template,
        filename: '报价单.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{"fields":{"client_name":"李四"},"loops":{},"missing":[]}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('completed');
    expect(out.format).toBe('xlsx');
    expect(out.attachments[0]!.filename).toBe('报价单-已填充.xlsx');
    // verify the captured output is a real xlsx with the value + style
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(captured.buffer!);
    const cell = wb2.getWorksheet('Quote')!.getCell('A1');
    expect(cell.value).toBe('客户：李四');
    expect(cell.font?.bold).toBe(true);
  });

  it('DEGRADES a multi-row xlsx loop to partial_success (P0) — fills the rest', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ws.getCell('A1').value = 'GMV：{gmv}';
    ws.getCell('A3').value = '{#tasks}';
    ws.getCell('A4').value = '{title}';
    ws.getCell('A5').value = '{/tasks}';
    const template = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { save, captured } = capturingSave();
    const out = await runTemplateFillTask({
      intent: 'gmv 100万，任务：A、B',
      template: {
        buffer: template,
        filename: '周报.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning(
        '{"fields":{"gmv":"100万"},"loops":{"tasks":[{"title":"A"},{"title":"B"}]},"missing":[]}',
      ),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('partial_success'); // NOT failed
    expect(out.skippedLoops).toContain('tasks');
    expect(out.summary).toContain('循环段未填充');
    expect(out.attachments).toHaveLength(1); // file still delivered
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(captured.buffer!);
    expect(wb2.getWorksheet('Report')!.getCell('A1').value).toBe('GMV：100万');
  });
});

describe('runTemplateFillTask — partial / honest paths', () => {
  it('returns partial_success and lists missing fields', async () => {
    const template = await buildDocx(['{client_name} {invoice_no} {date}']);
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '客户张三',
      template: { buffer: template, filename: 't.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{"fields":{"client_name":"张三"},"loops":{},"missing":["invoice_no","date"]}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('partial_success');
    expect(out.missing).toContain('invoice_no');
    expect(out.summary).toContain('留空');
    expect(out.attachments).toHaveLength(1); // still delivers the partially-filled file
  });

  it('returns partial_success with NO file when nothing is fillable', async () => {
    const template = await buildDocx(['{a} {b}']);
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '随便聊聊',
      template: { buffer: template, filename: 't.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{"fields":{},"loops":{},"missing":["a","b"]}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('partial_success');
    expect(out.degraded).toBe('no_data');
    expect(out.attachments).toHaveLength(0);
  });

  it('degrades a basic plan to a preview + upgrade note (no file)', async () => {
    const template = await buildDocx(['{client_name}']);
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '客户张三',
      template: { buffer: template, filename: 't.docx', mimetype: 'x' },
      allowedFormats: BASIC_FORMATS,
      save,
      model: modelReturning('{"fields":{"client_name":"张三"},"loops":{},"missing":[]}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('completed');
    expect(out.degraded).toBe('plan');
    expect(out.attachments).toHaveLength(0);
    expect(out.summary).toContain('Pro');
    expect(out.summary).toContain('张三'); // the preview still shows the mapping
  });
});

describe('runTemplateFillTask — guard rails', () => {
  it('asks the user to upload when no template is provided', async () => {
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '帮我填一下模板',
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('awaiting_user');
    expect(out.awaitingQuestion).toContain('上传');
  });

  it('fails honestly when the template has no placeholders', async () => {
    const template = await buildDocx(['这是一份没有占位符的普通文档']);
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '填充',
      template: { buffer: template, filename: 't.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('占位符');
  });

  it('rejects an unsafe upload (non-zip) via the safety layer', async () => {
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '填充',
      template: { buffer: Buffer.from('not office'), filename: 'x.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('Office');
  });

  it('declines a pptx template honestly (v1)', async () => {
    // minimal pptx: a zip with ppt/presentation.xml so the sniffer says pptx
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('ppt/presentation.xml', '<p:presentation/>');
    const buf = zip.generate({ type: 'nodebuffer' }) as Buffer;
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: '填充',
      template: { buffer: buf, filename: 'deck.pptx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: modelReturning('{}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('failed');
    expect(out.degraded).toBe('pptx');
  });

  it('fails cleanly when the model call throws', async () => {
    const template = await buildDocx(['{a}']);
    const { save } = capturingSave();
    const out = await runTemplateFillTask({
      intent: 'x',
      template: { buffer: template, filename: 't.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save,
      model: vi.fn(async () => {
        throw new Error('api down');
      }),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('映射失败');
  });

  it('fails when saving the filled file fails', async () => {
    const template = await buildDocx(['{a}']);
    const failingSave: SaveTemplateFn = vi.fn(async () => {
      throw new Error('disk full');
    });
    const out = await runTemplateFillTask({
      intent: 'a 是 1',
      template: { buffer: template, filename: 't.docx', mimetype: 'x' },
      allowedFormats: PRO_FORMATS,
      save: failingSave,
      model: modelReturning('{"fields":{"a":"1"},"loops":{},"missing":[]}'),
      logger: fakeLogger(),
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('保存失败');
  });
});

describe('parseFillJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseFillJson('{"fields":{"a":"1"}}')).toEqual({ fields: { a: '1' } });
  });
  it('parses a ```json fenced block', () => {
    expect(parseFillJson('好的：\n```json\n{"fields":{"a":"1"}}\n```')).toEqual({
      fields: { a: '1' },
    });
  });
  it('extracts a JSON object embedded in prose', () => {
    expect(parseFillJson('结果是 {"fields":{"a":"1"}} 完成')).toEqual({ fields: { a: '1' } });
  });
  it('returns null for non-JSON', () => {
    expect(parseFillJson('完全不是 JSON')).toBeNull();
    expect(parseFillJson('')).toBeNull();
  });
});

describe('buildUserPrompt', () => {
  it('lists simple fields and loop sub-fields', () => {
    const schema: PlaceholderSchema = {
      format: 'docx',
      fields: [
        { name: 'client_name', kind: 'field' },
        { name: 'items', kind: 'loop', fields: [{ name: 'desc', kind: 'field' }] },
      ],
    };
    const prompt = buildUserPrompt(schema, '帮我填', '一些数据');
    expect(prompt).toContain('client_name');
    expect(prompt).toContain('items');
    expect(prompt).toContain('desc');
    expect(prompt).toContain('一些数据');
  });
});
