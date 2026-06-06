import { describe, expect, it } from 'vitest';
import { uploadFailureMessage } from './upload-file';

describe('uploadFailureMessage', () => {
  it('uses actionable copy for known upload failures', () => {
    expect(
      uploadFailureMessage({
        status: 403,
        code: 'plan_does_not_allow_uploads',
        message: 'plan does not allow uploads',
      }),
    ).toBe('当前套餐不支持文件上传，升级后即可使用。');

    expect(
      uploadFailureMessage({
        status: 413,
        code: 'file_too_large',
        message: 'Payload Too Large',
      }),
    ).toBe('文件超过大小限制，请换一个更小的文件。');

    expect(
      uploadFailureMessage({
        status: 415,
        message: 'unsupported media type',
      }),
    ).toBe('不支持的文件类型，请换一个文件。');
  });

  it('hides raw English upload messages', () => {
    expect(
      uploadFailureMessage({
        status: 500,
        message: 'FetchError: socket hang up',
      }),
    ).toBe('任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。');
  });

  it('keeps localized upload messages intact', () => {
    expect(
      uploadFailureMessage({
        status: 400,
        message: '文件名不能为空',
      }),
    ).toBe('文件名不能为空');
  });
});
