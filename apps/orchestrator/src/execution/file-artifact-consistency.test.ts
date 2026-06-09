import { describe, expect, it } from 'vitest';
import {
  answerClaimsDownloadableFile,
  claimedDownloadFamilies,
  evaluateFileArtifact,
  fencedFileIds,
  fileFamily,
  isDocumentOutput,
} from './file-artifact-consistency.js';

const fence = (fileId: string, filename: string): string =>
  '```holaday-file\n' +
  JSON.stringify(
    { fileId, filename, size: 100, downloadUrl: `/api/files/${fileId}/download` },
    null,
    2,
  ) +
  '\n```';

const SCREENSHOT = { filename: 'screenshot-tsk_x.jpg', mimetype: 'image/jpeg' };
const PDF = { filename: 'qa-summary.pdf', mimetype: 'application/pdf' };
const MD = { filename: 'productivity-tips.md', mimetype: 'text/markdown' };

describe('fencedFileIds', () => {
  it('extracts fileIds from well-formed fences', () => {
    expect([...fencedFileIds(`文件已生成：\n${fence('file_abc', 'a.md')}`)]).toEqual([
      'file_abc',
    ]);
  });

  it('ignores a corrupted fence (dropped closing brace)', () => {
    const broken = '```holaday-file\n{\n  "fileId": "file_x"\n```';
    expect(fencedFileIds(broken).size).toBe(0);
  });

  it('returns empty for nullish / no-fence text', () => {
    expect(fencedFileIds(null).size).toBe(0);
    expect(fencedFileIds('普通回答，没有文件。').size).toBe(0);
  });
});

describe('answerClaimsDownloadableFile', () => {
  it('detects explicit download / generation claims', () => {
    expect(answerClaimsDownloadableFile('文件已生成，点击下载：x.md')).toBe(true);
    expect(answerClaimsDownloadableFile('PDF 已生成，可从上方卡片下载。')).toBe(true);
    expect(answerClaimsDownloadableFile('已为你生成一个可下载的 Markdown 文件。')).toBe(true);
  });

  it('does NOT trip on a source link or passing filename mention', () => {
    expect(answerClaimsDownloadableFile('来源：https://example.com/spec.pdf')).toBe(false);
    expect(answerClaimsDownloadableFile('Markdown 后缀是 .md。')).toBe(false);
    expect(answerClaimsDownloadableFile('')).toBe(false);
  });
});

describe('isDocumentOutput / fileFamily', () => {
  it('treats screenshots and images as NON-document outputs', () => {
    expect(isDocumentOutput(SCREENSHOT)).toBe(false);
    expect(isDocumentOutput({ filename: 'final.png', mimetype: 'image/png' })).toBe(false);
  });

  it('treats real documents as document outputs', () => {
    expect(isDocumentOutput(PDF)).toBe(true);
    expect(isDocumentOutput(MD)).toBe(true);
    expect(isDocumentOutput({ filename: 'data.csv', mimetype: 'text/csv' })).toBe(true);
  });

  it('maps families by extension then mimetype', () => {
    expect(fileFamily(PDF)).toBe('pdf');
    expect(fileFamily(MD)).toBe('md');
    expect(fileFamily({ filename: 'noext', mimetype: 'application/pdf' })).toBe('pdf');
  });
});

describe('claimedDownloadFamilies', () => {
  it('reads families from explicit words and filenames', () => {
    expect([...claimedDownloadFamilies('PDF 已生成：qa-summary.pdf')]).toContain('pdf');
    expect([...claimedDownloadFamilies('可下载的 Markdown 文件')]).toContain('md');
  });

  it('is empty for a generic file claim', () => {
    expect(claimedDownloadFamilies('文件已生成，点击下载。').size).toBe(0);
  });
});

describe('evaluateFileArtifact — screenshot must not satisfy the claim', () => {
  it('1. claims PDF + only a screenshot output => inconsistent (fixable)', () => {
    const v = evaluateFileArtifact({
      answerText: 'PDF 已生成：qa-summary.pdf，可从上方卡片下载。',
      outputFiles: [SCREENSHOT],
    });
    expect(v.inconsistent).toBe(true);
    expect(v.hasArtifact).toBe(false);
  });

  it('2. claims Markdown + only a screenshot output => inconsistent (fixable)', () => {
    const v = evaluateFileArtifact({
      answerText: '已生成可下载的 Markdown 文件 notes.md。',
      outputFiles: [SCREENSHOT],
    });
    expect(v.inconsistent).toBe(true);
  });

  it('3. claims PDF + a PDF output => pass', () => {
    const v = evaluateFileArtifact({
      answerText: 'PDF 已生成：qa-summary.pdf。',
      outputFiles: [SCREENSHOT, PDF],
    });
    expect(v.inconsistent).toBe(false);
    expect(v.hasArtifact).toBe(true);
  });

  it('4. claims Markdown + a Markdown output (no fence) => pass', () => {
    const v = evaluateFileArtifact({
      answerText: '文件已生成，点击下载：productivity-tips.md',
      outputFiles: [SCREENSHOT, MD],
    });
    expect(v.inconsistent).toBe(false);
    expect(v.hasArtifact).toBe(true);
  });

  it('claims PDF but only a Markdown document exists => inconsistent (family mismatch)', () => {
    const v = evaluateFileArtifact({
      answerText: 'PDF 已生成：report.pdf。',
      outputFiles: [MD],
    });
    expect(v.inconsistent).toBe(true);
  });

  it('a holaday-file fence backs the claim regardless of family', () => {
    const v = evaluateFileArtifact({
      answerText: `PDF 已生成：\n${fence('file_ok', 'qa.pdf')}`,
      outputFiles: [],
    });
    expect(v.inconsistent).toBe(false);
    expect(v.fencedCount).toBe(1);
  });

  it('an ordinary answer with no file claim is never flagged', () => {
    const v = evaluateFileArtifact({
      answerText: '北京今天晴，26 度。',
      outputFiles: [SCREENSHOT],
    });
    expect(v.claimsFile).toBe(false);
    expect(v.inconsistent).toBe(false);
  });
});

describe('answerClaimsDownloadableFile — filename + generation phrasing', () => {
  it('matches "filename.ext 已生成" including backtick-wrapped + lowercase ext', () => {
    expect(answerClaimsDownloadableFile('`qa-summary.pdf` 已生成')).toBe(true);
    expect(answerClaimsDownloadableFile('qa-summary.pdf 已生成')).toBe(true);
    expect(answerClaimsDownloadableFile('productivity-tips.md 已生成')).toBe(true);
    expect(answerClaimsDownloadableFile('report.csv 已创建，可下载')).toBe(true);
  });

  it('does NOT match a bare source link ending in .pdf', () => {
    expect(
      answerClaimsDownloadableFile('来源：https://example.com/spec.pdf（仅供参考）'),
    ).toBe(false);
    expect(answerClaimsDownloadableFile('参考文档 spec.pdf，可供参考')).toBe(false);
  });
});

describe('evaluateFileArtifact — filename-phrasing claims vs screenshot-only', () => {
  it('1. `qa-summary.pdf` 已生成 + only screenshot => inconsistent', () => {
    expect(
      evaluateFileArtifact({
        answerText: '`qa-summary.pdf` 已生成，可从上方卡片下载。',
        outputFiles: [SCREENSHOT],
      }).inconsistent,
    ).toBe(true);
  });

  it('2. qa-summary.pdf 已生成 + only screenshot => inconsistent', () => {
    expect(
      evaluateFileArtifact({
        answerText: 'qa-summary.pdf 已生成。',
        outputFiles: [SCREENSHOT],
      }).inconsistent,
    ).toBe(true);
  });

  it('3. productivity-tips.md 已生成 + only screenshot => inconsistent', () => {
    expect(
      evaluateFileArtifact({
        answerText: 'productivity-tips.md 已生成。',
        outputFiles: [SCREENSHOT],
      }).inconsistent,
    ).toBe(true);
  });

  it('4. source-link-only .pdf without generation phrasing => not flagged', () => {
    const v = evaluateFileArtifact({
      answerText: '总结完成。来源：https://example.com/spec.pdf',
      outputFiles: [SCREENSHOT],
    });
    expect(v.claimsFile).toBe(false);
    expect(v.inconsistent).toBe(false);
  });

  it('5. qa-summary.pdf 已生成 + a real PDF output => pass', () => {
    expect(
      evaluateFileArtifact({
        answerText: 'qa-summary.pdf 已生成。',
        outputFiles: [SCREENSHOT, PDF],
      }).inconsistent,
    ).toBe(false);
  });
});

describe('answerClaimsDownloadableFile — reverse word order (verb before filename)', () => {
  it('matches "已生成 <filename.ext>" and "生成了 <filename.ext>"', () => {
    expect(answerClaimsDownloadableFile('已生成 qa-summary.pdf')).toBe(true);
    expect(answerClaimsDownloadableFile('已生成了 qa-summary.pdf，可下载')).toBe(true);
    expect(answerClaimsDownloadableFile('生成了 report.md')).toBe(true);
    expect(answerClaimsDownloadableFile('为你创建了 notes.csv')).toBe(true);
    expect(answerClaimsDownloadableFile('已创建：`data.xlsx`')).toBe(true);
  });

  it('does NOT match a source/reference link with no generation verb', () => {
    expect(
      answerClaimsDownloadableFile('这是参考链接 https://example.com/spec.pdf'),
    ).toBe(false);
    expect(answerClaimsDownloadableFile('任务已完成。详见 https://x.com/report.pdf')).toBe(false);
    expect(answerClaimsDownloadableFile('参考文档 spec.pdf，可供参考')).toBe(false);
  });
});

describe('answerClaimsDownloadableFile — Task C boundary phrasings', () => {
  it('detects 报告已生成 / 为你准备好 / 下载文件 phrasings', () => {
    expect(answerClaimsDownloadableFile('报告已生成：qa-summary.pdf')).toBe(true);
    expect(answerClaimsDownloadableFile('我已经为你准备好 qa-summary.pdf')).toBe(true);
    expect(answerClaimsDownloadableFile('下载文件：qa-summary.pdf')).toBe(true);
  });

  it('does NOT trip on a reference link or a "详见 file" pointer', () => {
    expect(
      answerClaimsDownloadableFile('参考链接：https://example.com/qa-summary.pdf'),
    ).toBe(false);
    expect(answerClaimsDownloadableFile('任务已完成，详见 report.pdf')).toBe(false);
  });

  it('evaluateFileArtifact flags the new phrasings vs screenshot-only', () => {
    for (const answerText of [
      '报告已生成：qa-summary.pdf',
      '我已经为你准备好 qa-summary.pdf',
      '下载文件：qa-summary.pdf',
    ]) {
      expect(
        evaluateFileArtifact({ answerText, outputFiles: [SCREENSHOT] }).inconsistent,
        answerText,
      ).toBe(true);
    }
  });

  it('evaluateFileArtifact does NOT flag the reference-link / pointer cases', () => {
    for (const answerText of [
      '参考链接：https://example.com/qa-summary.pdf',
      '任务已完成，详见 report.pdf',
    ]) {
      const v = evaluateFileArtifact({ answerText, outputFiles: [SCREENSHOT] });
      expect(v.claimsFile, answerText).toBe(false);
      expect(v.inconsistent, answerText).toBe(false);
    }
  });
});

describe('evaluateFileArtifact — reverse-order claims vs screenshot-only', () => {
  it('已生成 qa-summary.pdf + only screenshot => inconsistent (fixable)', () => {
    const v = evaluateFileArtifact({
      answerText: '已生成 qa-summary.pdf',
      outputFiles: [SCREENSHOT],
    });
    expect(v.inconsistent).toBe(true);
    expect(v.hasArtifact).toBe(false);
  });

  it('文件 qa-summary.pdf 已创建，可下载 + only screenshot => inconsistent', () => {
    expect(
      evaluateFileArtifact({
        answerText: '文件 qa-summary.pdf 已创建，可下载。',
        outputFiles: [SCREENSHOT],
      }).inconsistent,
    ).toBe(true);
  });

  it('reference link spec.pdf + only screenshot => not flagged', () => {
    const v = evaluateFileArtifact({
      answerText: '这是参考链接 https://example.com/spec.pdf',
      outputFiles: [SCREENSHOT],
    });
    expect(v.claimsFile).toBe(false);
    expect(v.inconsistent).toBe(false);
  });

  it('已生成 report.md + a real Markdown output (no fence) => pass (fold-in)', () => {
    const v = evaluateFileArtifact({
      answerText: '已生成 report.md',
      outputFiles: [SCREENSHOT, { filename: 'report.md', mimetype: 'text/markdown' }],
    });
    expect(v.inconsistent).toBe(false);
    expect(v.hasArtifact).toBe(true);
  });
});
