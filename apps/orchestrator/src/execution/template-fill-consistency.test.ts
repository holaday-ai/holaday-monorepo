import { describe, it, expect } from 'vitest';
import {
  evaluateTemplateFill,
  answerClaimsTemplateFill,
} from './template-fill-consistency.js';
import type { OutputFileDescriptor } from './file-artifact-consistency.js';

const docxOut: OutputFileDescriptor = {
  filename: '发票模板-已填充.docx',
  mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const screenshotOut: OutputFileDescriptor = {
  filename: 'screenshot-final.png',
  mimetype: 'image/png',
};

const SUCCESS = '已根据你的数据填充模板「发票.docx」，并保留了模板原有格式。\n\n下载链接见下方，24 小时内有效。';
const PREVIEW = '你的账号暂不支持生成 .docx 文件，以下是模板「发票.docx」的字段填充预览：\n\n升级到 Pro 套餐即可下载。';

describe('answerClaimsTemplateFill', () => {
  it('recognises the runner success skeleton', () => {
    expect(answerClaimsTemplateFill(SUCCESS)).toBe(true);
  });
  it('does NOT recognise the basic-plan preview (no file claimed)', () => {
    expect(answerClaimsTemplateFill(PREVIEW)).toBe(false);
  });
  it('does NOT fire on an unrelated answer', () => {
    expect(answerClaimsTemplateFill('这是一份关于市场的分析报告。')).toBe(false);
    expect(answerClaimsTemplateFill('')).toBe(false);
  });
});

describe('evaluateTemplateFill', () => {
  it('is consistent when a filled docx output backs the claim', () => {
    const v = evaluateTemplateFill({ answerText: SUCCESS, outputFiles: [docxOut] });
    expect(v.claimsFill).toBe(true);
    expect(v.hasArtifact).toBe(true);
    expect(v.inconsistent).toBe(false);
  });

  it('is INCONSISTENT when the claim has no output file', () => {
    const v = evaluateTemplateFill({ answerText: SUCCESS, outputFiles: [] });
    expect(v.inconsistent).toBe(true);
  });

  it('is INCONSISTENT when only a screenshot output exists (not a document)', () => {
    const v = evaluateTemplateFill({ answerText: SUCCESS, outputFiles: [screenshotOut] });
    expect(v.inconsistent).toBe(true);
  });

  it('is consistent when a holaday-file fence backs the claim', () => {
    const withFence = `${SUCCESS}\n\n\`\`\`holaday-file\n{"fileId":"file_1"}\n\`\`\``;
    const v = evaluateTemplateFill({ answerText: withFence, outputFiles: [] });
    expect(v.inconsistent).toBe(false);
  });

  it('is a no-op (not inconsistent) for the basic-plan preview without a file', () => {
    const v = evaluateTemplateFill({ answerText: PREVIEW, outputFiles: [] });
    expect(v.claimsFill).toBe(false);
    expect(v.inconsistent).toBe(false);
  });

  it('is a no-op for an unrelated answer with no file', () => {
    const v = evaluateTemplateFill({ answerText: '普通文本回答', outputFiles: [] });
    expect(v.inconsistent).toBe(false);
  });
});
