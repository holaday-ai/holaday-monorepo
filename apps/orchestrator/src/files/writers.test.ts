import { describe, expect, it } from 'vitest';
import {
  allowedFormatsForPlan,
  buildCreateFileToolDescription,
  buildFileFormatGuidance,
  preferredFallbackFormat,
} from './writers.js';

const BASIC = allowedFormatsForPlan('basic'); // csv/txt/md/json
const PRO = allowedFormatsForPlan('pro'); // all 8
const FREE = allowedFormatsForPlan('free'); // []

describe('preferredFallbackFormat — basic office→open mapping (P1)', () => {
  it('basic: pdf→md, xlsx→csv, docx→md, pptx→md', () => {
    expect(preferredFallbackFormat('pdf', BASIC)).toBe('md');
    expect(preferredFallbackFormat('xlsx', BASIC)).toBe('csv');
    expect(preferredFallbackFormat('docx', BASIC)).toBe('md');
    expect(preferredFallbackFormat('pptx', BASIC)).toBe('md');
  });

  it('already-allowed format → null (no fallback needed)', () => {
    for (const f of ['md', 'csv', 'json', 'txt']) {
      expect(preferredFallbackFormat(f, BASIC), f).toBeNull();
    }
  });

  it('pro: every office format is allowed → null (no degrade)', () => {
    for (const f of ['pdf', 'xlsx', 'docx', 'pptx']) {
      expect(preferredFallbackFormat(f, PRO), f).toBeNull();
    }
  });
});

describe('buildFileFormatGuidance — plan-aware honest degrade (P1)', () => {
  it('free (no formats): honest "cannot generate", forbid claiming a file', () => {
    const g = buildFileFormatGuidance(FREE);
    expect(g).toMatch(/不支持生成可下载文件/);
    expect(g).toMatch(/切勿声称已生成文件/);
  });

  it('basic: lists allowed formats + office fallback map + no-browse + no-false-claim', () => {
    const g = buildFileFormatGuidance(BASIC);
    expect(g).toMatch(/可用的 create_file 格式仅：csv \/ txt \/ md \/ json/);
    expect(g).toMatch(/pdf→md/);
    expect(g).toMatch(/xlsx→csv/);
    expect(g).toMatch(/docx→md/);
    expect(g).toMatch(/pptx→md/);
    expect(g).toMatch(/绝不要声称已生成该格式/);
    expect(g).toMatch(/不要为生成文件去联网浏览网页/);
    expect(g).toMatch(/升级 Pro/);
  });

  it('pro: no "unavailable format" degrade clause (all formats available)', () => {
    const g = buildFileFormatGuidance(PRO);
    expect(g).not.toMatch(/不要声称已生成该格式|绝不要声称/);
    expect(g).not.toMatch(/→md|→csv/);
    // still carries the no-browse rule
    expect(g).toMatch(/不要为生成文件去联网浏览网页/);
  });
});

describe('buildCreateFileToolDescription — plan-aware tool blurb (P1)', () => {
  it('basic: names available formats + fallback + forbids false claim', () => {
    const d = buildCreateFileToolDescription(BASIC);
    expect(d).toMatch(/本账号可用格式：csv\/txt\/md\/json/);
    expect(d).toMatch(/pdf\/docx\/pptx→md，xlsx→csv/);
    expect(d).toMatch(/不要声称已生成不可用格式/);
  });

  it('pro: no unavailable-format clause', () => {
    const d = buildCreateFileToolDescription(PRO);
    expect(d).toMatch(/本账号可用格式/);
    expect(d).not.toMatch(/不可用格式/);
  });
});
