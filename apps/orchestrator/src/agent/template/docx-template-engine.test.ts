import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import {
  extractPlaceholders,
  fill,
  DocxTemplateError,
} from './docx-template-engine.js';

/** Build a .docx template where each line is a paragraph of literal text. */
async function buildDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: lines.map(
          (line) => new Paragraph({ children: [new TextRun(line)] }),
        ),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Concatenated visible text of a .docx (post-fill assertions). */
function fullText(buf: Buffer): string {
  const doc = new Docxtemplater(new PizZip(buf));
  return doc.getFullText();
}

describe('extractPlaceholders (docx)', () => {
  it('returns simple fields', async () => {
    const buf = await buildDocx(['客户：{client_name}  编号：{invoice_no}']);
    const schema = extractPlaceholders(buf);
    expect(schema.format).toBe('docx');
    expect(schema.fields).toEqual([
      { name: 'client_name', kind: 'field' },
      { name: 'invoice_no', kind: 'field' },
    ]);
    expect(schema.unsupported).toBeUndefined();
  });

  it('returns a loop with its inner sub-fields', async () => {
    const buf = await buildDocx(['{#items}', '{desc} — {price}', '{/items}']);
    const schema = extractPlaceholders(buf);
    expect(schema.fields).toHaveLength(1);
    const loop = schema.fields[0]!;
    expect(loop.name).toBe('items');
    expect(loop.kind).toBe('loop');
    expect(loop.fields).toEqual([
      { name: 'desc', kind: 'field' },
      { name: 'price', kind: 'field' },
    ]);
  });

  it('de-duplicates a placeholder used twice', async () => {
    const buf = await buildDocx(['{name}', '再次出现：{name}']);
    const schema = extractPlaceholders(buf);
    expect(schema.fields).toEqual([{ name: 'name', kind: 'field' }]);
  });

  it('records raw-XML {@tag} as unsupported, never a fill field', async () => {
    // docxtemplater requires a raw tag to be alone in its paragraph.
    const buf = await buildDocx(['正文 {body}', '{@rawhtml}']);
    const schema = extractPlaceholders(buf);
    expect(schema.fields).toEqual([{ name: 'body', kind: 'field' }]);
    expect(schema.unsupported).toContain('rawhtml');
  });

  it('throws DocxTemplateError on a non-zip buffer', () => {
    expect(() => extractPlaceholders(Buffer.from('not a docx'))).toThrow(
      DocxTemplateError,
    );
  });

  it('throws DocxTemplateError with a tag on an unclosed loop', async () => {
    // {#items} with no {/items} → docxtemplater "Unclosed loop".
    const buf = await buildDocx(['{#items}', '{desc}']);
    try {
      extractPlaceholders(buf);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DocxTemplateError);
      expect((err as DocxTemplateError).kind).toBe('parse');
    }
  });
});

describe('fill (docx)', () => {
  it('writes scalar values and leaves no placeholder behind', async () => {
    const buf = await buildDocx(['客户：{client_name}  编号：{invoice_no}']);
    const out = fill(buf, { client_name: '张三', invoice_no: 'INV-001' });
    expect(out[0]).toBe(0x50); // PK zip signature
    expect(out[1]).toBe(0x4b);
    const text = fullText(out);
    expect(text).toContain('张三');
    expect(text).toContain('INV-001');
    expect(text).not.toContain('{client_name}');
    // round-trip: the output has no remaining placeholders
    expect(extractPlaceholders(out).fields).toEqual([]);
  });

  it('expands a loop over rows', async () => {
    const buf = await buildDocx(['{#items}', '{desc}:{price}', '{/items}']);
    const out = fill(buf, {
      items: [
        { desc: '苹果', price: '5' },
        { desc: '香蕉', price: '3' },
      ],
    });
    const text = fullText(out);
    expect(text).toContain('苹果:5');
    expect(text).toContain('香蕉:3');
  });

  it('renders a missing field as blank (no leftover tag, no throw)', async () => {
    const buf = await buildDocx(['A:{a} B:{b}']);
    const out = fill(buf, { a: '有值' });
    const text = fullText(out);
    expect(text).toContain('有值');
    expect(text).not.toContain('{b}');
    expect(text).toContain('B:'); // label kept, value blank
  });

  it('throws DocxTemplateError on a non-zip buffer', () => {
    expect(() => fill(Buffer.from('garbage'), { a: 'x' })).toThrow(
      DocxTemplateError,
    );
  });
});
