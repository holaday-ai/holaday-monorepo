import { describe, it, expect } from 'vitest';
import {
  isAcceptedUpload,
  isMacroOfficeUpload,
  ACCEPTED_MIMES,
  ACCEPTED_EXTENSIONS,
} from './file-service.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCM_MIME = 'application/vnd.ms-word.document.macroEnabled.12';

describe('upload allowlist — docx must be uploadable (Phase 1 #1 P0)', () => {
  it('allowlist includes the docx mime + extension', () => {
    expect(ACCEPTED_MIMES.has(DOCX_MIME)).toBe(true);
    expect(ACCEPTED_EXTENSIONS.has('.docx')).toBe(true);
  });

  it('accepts a docx by mimetype', () => {
    expect(isAcceptedUpload('发票模板.docx', DOCX_MIME)).toBe(true);
  });

  it('accepts a docx by extension even when the browser sends octet-stream', () => {
    expect(isAcceptedUpload('模板.docx', 'application/octet-stream')).toBe(true);
  });

  it('still accepts xlsx / csv / pdf / images', () => {
    expect(isAcceptedUpload('data.xlsx', XLSX_MIME)).toBe(true);
    expect(isAcceptedUpload('rows.csv', 'text/csv')).toBe(true);
    expect(isAcceptedUpload('doc.pdf', 'application/pdf')).toBe(true);
    expect(isAcceptedUpload('pic.png', 'image/png')).toBe(true);
  });

  it('rejects an unrelated binary', () => {
    expect(isAcceptedUpload('tool.exe', 'application/octet-stream')).toBe(false);
  });
});

describe('macro-Office rejection (docm still refused, coordinates with template-safety)', () => {
  it('flags macro extensions', () => {
    for (const f of ['x.docm', 'x.xlsm', 'x.pptm', 'x.dotm', 'x.xltm']) {
      expect(isMacroOfficeUpload(f, 'application/octet-stream'), f).toBe(true);
    }
  });

  it('flags a macroEnabled mimetype regardless of extension', () => {
    expect(isMacroOfficeUpload('renamed.bin', DOCM_MIME)).toBe(true);
  });

  it('does NOT flag plain docx / xlsx', () => {
    expect(isMacroOfficeUpload('报表.docx', DOCX_MIME)).toBe(false);
    expect(isMacroOfficeUpload('数据.xlsx', XLSX_MIME)).toBe(false);
  });

  it('a .docm is refused by the gate (macro check runs before the allowlist)', () => {
    // The upload route checks isMacroOfficeUpload first → friendly 415.
    // Even if it didn't, .docm is not in the allowlist.
    expect(isMacroOfficeUpload('m.docm', DOCM_MIME)).toBe(true);
    expect(isAcceptedUpload('m.docm', 'application/octet-stream')).toBe(false);
  });
});
