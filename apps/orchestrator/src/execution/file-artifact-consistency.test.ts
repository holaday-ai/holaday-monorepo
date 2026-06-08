import { describe, expect, it } from 'vitest';
import {
  answerClaimsDownloadableFile,
  evaluateFileArtifact,
  fencedFileIds,
} from './file-artifact-consistency.js';

const fence = (fileId: string, filename: string): string =>
  '```holaday-file\n' +
  JSON.stringify(
    { fileId, filename, size: 100, downloadUrl: `/api/files/${fileId}/download` },
    null,
    2,
  ) +
  '\n```';

describe('fencedFileIds', () => {
  it('extracts fileIds from well-formed holaday-file fences', () => {
    const text = `文件已生成：\n${fence('file_abc', 'a.md')}`;
    expect([...fencedFileIds(text)]).toEqual(['file_abc']);
  });

  it('handles multiple fences', () => {
    const text = `${fence('file_a', 'a.md')}\n和\n${fence('file_b', 'b.md')}`;
    expect(fencedFileIds(text).size).toBe(2);
  });

  it('ignores a corrupted fence (missing closing brace) so it is recovered elsewhere', () => {
    // STRAY_CLOSER_LINE_RE in the sanitizer can drop the trailing `}`.
    const broken = '```holaday-file\n{\n  "fileId": "file_x",\n  "filename": "x.md"\n```';
    expect(fencedFileIds(broken).size).toBe(0);
  });

  it('returns empty for nullish / no-fence text', () => {
    expect(fencedFileIds('').size).toBe(0);
    expect(fencedFileIds(null).size).toBe(0);
    expect(fencedFileIds('就是一段普通回答，没有文件。').size).toBe(0);
  });
});

describe('answerClaimsDownloadableFile', () => {
  it('detects explicit download / generation claims', () => {
    expect(answerClaimsDownloadableFile('文件已生成，点击下载：x.md')).toBe(true);
    expect(answerClaimsDownloadableFile('PDF 已生成，可以下载：report.pdf')).toBe(true);
    expect(answerClaimsDownloadableFile('已为你生成一个可下载的 Markdown 文件。')).toBe(true);
    expect(answerClaimsDownloadableFile('下载链接：/api/files/x')).toBe(true);
  });

  it('does NOT trip on a source link ending in .pdf or a passing filename mention', () => {
    expect(
      answerClaimsDownloadableFile('来源：https://example.com/spec.pdf（仅供参考）'),
    ).toBe(false);
    expect(
      answerClaimsDownloadableFile('Markdown 是一种轻量标记语言，常见后缀 .md。'),
    ).toBe(false);
    expect(answerClaimsDownloadableFile('')).toBe(false);
  });
});

describe('evaluateFileArtifact', () => {
  it('flags a download claim with no fence and no output file', () => {
    const v = evaluateFileArtifact({
      answerText: '文件已生成，点击下载：📄 productivity-tips.md',
      outputFileCount: 0,
    });
    expect(v.inconsistent).toBe(true);
    expect(v.hasArtifact).toBe(false);
  });

  it('passes when a holaday-file fence backs the claim', () => {
    const v = evaluateFileArtifact({
      answerText: `文件已生成：\n${fence('file_ok', 'ok.md')}`,
      outputFileCount: 0,
    });
    expect(v.inconsistent).toBe(false);
    expect(v.hasArtifact).toBe(true);
    expect(v.fencedCount).toBe(1);
  });

  it('passes when an output file was created even if the fence was dropped', () => {
    // Agent created the file (outputFileCount=1) but omitted the fence.
    // Result finalisation folds it into metadata.attachments, so this
    // is NOT an inconsistency to flag.
    const v = evaluateFileArtifact({
      answerText: '文件已生成，点击下载：productivity-tips.md',
      outputFileCount: 1,
    });
    expect(v.inconsistent).toBe(false);
    expect(v.hasArtifact).toBe(true);
  });

  it('does not flag a normal answer that makes no file claim', () => {
    const v = evaluateFileArtifact({
      answerText: '北京今天晴，最高 26 度。',
      outputFileCount: 0,
    });
    expect(v.claimsFile).toBe(false);
    expect(v.inconsistent).toBe(false);
  });
});
