import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';
import { describe, expect, it } from 'vitest';
import { CoreFileInputError, docxHtmlToText, parseFileForPrompt } from './parsers.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function sampleDocx(): Promise<Buffer> {
  const cell = (text: string) => new TableCell({ children: [new Paragraph(text)] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph('季度销售总结'),
          new Paragraph('华东区增长最快，华北区持平。'),
          new Table({
            rows: [
              new TableRow({ children: [cell('区域'), cell('销售额')] }),
              new TableRow({ children: [cell('华东'), cell('120 万')] }),
              new TableRow({ children: [cell('华北'), cell('80 万')] }),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

describe('Word attachments', () => {
  it('extracts Chinese text and renders tables as markdown in complete-text mode', async () => {
    const parsed = await parseFileForPrompt(await sampleDocx(), '销售.docx', DOCX_MIME, {
      completeText: true,
    });
    const text = parsed.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
    expect(text).toContain('季度销售总结');
    expect(text).toContain('华东区增长最快');
    expect(text).toContain('| 区域 | 销售额 |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| 华东 | 120 万 |');
    expect(parsed.truncated).toBe(false);
  });

  it('reports a corrupt .docx as unreadable', async () => {
    await expect(
      parseFileForPrompt(Buffer.from('not a zip'), 'broken.docx', DOCX_MIME, {
        completeText: true,
      }),
    ).rejects.toMatchObject({ code: 'CORE_FILE_UNREADABLE' });
  });

  it.each([
    ['旧格式.doc', 'application/msword'],
    ['汇报.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('asks to re-save %s as docx/pdf instead of failing silently', async (filename, mime) => {
    const error = await parseFileForPrompt(Buffer.from('x'), filename, mime, {
      completeText: true,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoreFileInputError);
    expect((error as CoreFileInputError).code).toBe('CORE_FILE_CONVERT_REQUIRED');
  });

  it('escapes pipes inside table cells', () => {
    expect(docxHtmlToText('<table><tr><td>a|b</td><td>c</td></tr></table>')).toContain(
      '| a\\|b | c |',
    );
  });
});
