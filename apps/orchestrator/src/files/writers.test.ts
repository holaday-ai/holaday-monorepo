import { describe, expect, it } from 'vitest';
import {
  allowedFormatsForPlan,
  buildCreateFileToolDescription,
  buildFileFormatGuidance,
  buildUnavailableFormatDirective,
  detectRequestedFileFormat,
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

  it('basic: lists allowed formats + office fallback map + no-browse + no-false-claim + no-reportlab', () => {
    const g = buildFileFormatGuidance(BASIC);
    expect(g).toMatch(/可用的 create_file 格式仅：csv \/ txt \/ md \/ json/);
    expect(g).toMatch(/pdf→md/);
    expect(g).toMatch(/xlsx→csv/);
    expect(g).toMatch(/docx→md/);
    expect(g).toMatch(/pptx→md/);
    expect(g).toMatch(/绝不要声称已生成该格式/);
    expect(g).toMatch(/不要为生成文件去联网浏览网页/);
    expect(g).toMatch(/升级 Pro/);
    // kill the reportlab / direct-author hallucination
    expect(g).toMatch(/没有 Python \/ reportlab \/ 代码执行/);
    expect(g).toMatch(/唯一方式就是调用 create_file/);
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

describe('detectRequestedFileFormat (P1 strengthen)', () => {
  it.each([
    ['生成一个可下载的 PDF 文件，总结 HTTP 状态码', 'pdf'],
    ['做一个可下载的 PDF 文件，内容是番茄工作法', 'pdf'],
    ['生成一个可下载的 xlsx 文件，三列数据', 'xlsx'],
    ['生成一个可下载的 docx 文件，会议纪要模板', 'docx'],
    ['生成一个可下载的 pptx 文件，3 页大纲', 'pptx'],
    ['生成一个 Word 文档', 'docx'],
    ['做一个 Excel 表', 'xlsx'],
    ['生成一个可下载的 Markdown 文件', 'md'],
    ['生成一个可下载的 CSV 文件', 'csv'],
  ])('%s → %s', (intent, fmt) => {
    expect(detectRequestedFileFormat(intent)).toBe(fmt);
  });

  it('no explicit format named → null', () => {
    expect(detectRequestedFileFormat('帮我整理一份会议纪要')).toBeNull();
    expect(detectRequestedFileFormat('你好')).toBeNull();
  });
});

describe('buildUnavailableFormatDirective (P1 strengthen — high-attention)', () => {
  it('basic + PDF request → forceful md directive, no-reportlab, no-browse, no-false-claim', () => {
    const d = buildUnavailableFormatDirective('生成一个可下载的 PDF 文件', BASIC);
    expect(d).toMatch(/无法生成 pdf/);
    expect(d).toMatch(/create_file，format='md'/);
    expect(d).toMatch(/严禁声称已生成 pdf/);
    expect(d).toMatch(/reportlab/);
    expect(d).toMatch(/严禁为此联网浏览/);
  });

  it('basic + xlsx → csv directive', () => {
    expect(buildUnavailableFormatDirective('生成一个 xlsx 文件', BASIC)).toMatch(/format='csv'/);
  });

  it('basic + Markdown (allowed) → no directive (no-op)', () => {
    expect(buildUnavailableFormatDirective('生成一个可下载的 Markdown 文件', BASIC)).toBe('');
  });

  it('basic + no format named → no directive', () => {
    expect(buildUnavailableFormatDirective('整理一份会议纪要', BASIC)).toBe('');
  });

  it('pro + PDF → no directive (pdf available)', () => {
    expect(buildUnavailableFormatDirective('生成一个 PDF 文件', PRO)).toBe('');
  });

  it('free + PDF → honest cannot-generate directive (no fake claim)', () => {
    const d = buildUnavailableFormatDirective('生成一个 PDF 文件', FREE);
    expect(d).toMatch(/无法生成可下载文件/);
    expect(d).toMatch(/切勿声称已生成/);
  });
});
