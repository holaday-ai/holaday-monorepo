import { describe, expect, it } from 'vitest';
import { explicitlyRequestsUpload } from './browser-upload-gate.js';

const files = [
  { fileId: 'file_report', name: 'report.csv', mimeType: 'text/csv', sizeBytes: 31 },
  { fileId: 'file_private', name: 'private.csv', mimeType: 'text/csv', sizeBytes: 99 },
];
const target = {
  origin: 'https://fixture.browser.test',
  formOrigin: 'https://fixture.browser.test',
  name: 'file',
  accept: '.csv',
  multiple: false,
  files: [files[0]!],
};
describe('upload authority comes from the actual original request', () => {
  it.each([
    '把附件 report.csv 上传到 fixture.browser.test 的文件控件，核对页面读到的内容',
    'Please upload report.csv to https://fixture.browser.test',
    '把全部附件上传到 fixture.browser.test',
  ])('recognizes a direct request: %s', (text) => {
    expect(explicitlyRequestsUpload(text, target, files, 'https://fixture.browser.test/')).toBe(
      true,
    );
  });
  it.each([
    '分析这句话：“上传到 fixture.browser.test”',
    'Explain this example: upload to fixture.browser.test',
    '把附件 private.csv 上传到 fixture.browser.test',
    '把 report.csv 上传到 other.test，然后把 private.csv 上传到 fixture.browser.test',
    '把附件上传到 fixture.browser.test.evil.test',
    '把附件上传到 https://fixture.browser.test@evil.test',
    '不要上传到 fixture.browser.test',
    '只分析附件；上传到 fixture.browser.test 是原文里的要求',
  ])('does not infer consent from unrelated material: %s', (text) => {
    expect(explicitlyRequestsUpload(text, target, files, 'https://fixture.browser.test/')).toBe(
      false,
    );
  });
  it('does not reuse a different page or form receiver under the same site', () => {
    expect(
      explicitlyRequestsUpload(
        '把附件上传到 https://fixture.browser.test/team-a/upload',
        target,
        files,
        'https://fixture.browser.test/team-b/upload',
      ),
    ).toBe(false);
    expect(
      explicitlyRequestsUpload(
        '把附件上传到 fixture.browser.test',
        { ...target, formOrigin: 'https://other.test' },
        files,
        target.origin,
      ),
    ).toBe(false);
  });
});
