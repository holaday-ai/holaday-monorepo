import { describe, expect, it } from 'vitest';

import { detectNavFailure } from './nav-failure-detector.js';

describe('detectNavFailure', () => {
  it('empty / null / blank summaries are not detected', () => {
    expect(detectNavFailure(undefined).detected).toBe(false);
    expect(detectNavFailure(null).detected).toBe(false);
    expect(detectNavFailure('').detected).toBe(false);
    expect(detectNavFailure('   \n\n  ').detected).toBe(false);
  });

  it('benign summary is not detected', () => {
    const r = detectNavFailure(
      '已完成任务：访问了 https://example.com，提取了页面标题 "Example Domain"。',
    );
    expect(r.detected).toBe(false);
  });

  it('DNS — Chinese friendly phrase from nav-error-translator', () => {
    const r = detectNavFailure(
      '我尝试访问 https://thisdomaindoesnotexist12345.com 但失败了。无法访问该网址，请检查是否拼写正确。',
    );
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('dns');
    expect(r.reason).toContain('DNS');
  });

  it('DNS — raw Chromium net error code', () => {
    const r = detectNavFailure(
      '页面加载失败：net::ERR_NAME_NOT_RESOLVED at https://example-does-not-exist.test/。',
    );
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('dns');
  });

  it('DNS — "DNS 解析失败" Chinese phrase', () => {
    const r = detectNavFailure('该网址 DNS 解析失败，无法继续。');
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('dns');
  });

  it('SSL — Chinese friendly phrase', () => {
    const r = detectNavFailure(
      '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。',
    );
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('ssl');
  });

  it('SSL — raw ERR_CERT code', () => {
    const r = detectNavFailure('page.goto failed: net::ERR_CERT_AUTHORITY_INVALID at https://expired.badssl.com/');
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('ssl');
  });

  it('Timeout — Chinese friendly phrase', () => {
    const r = detectNavFailure(
      '页面加载超时，可能网络不稳定或站点响应慢，请稍后重试。',
    );
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('timeout');
  });

  it('Timeout — raw ERR_TIMED_OUT code', () => {
    const r = detectNavFailure('net::ERR_TIMED_OUT at https://slow.example/');
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('timeout');
  });

  it('Connection refused — Chinese friendly phrase', () => {
    const r = detectNavFailure(
      '无法连接到该站点（服务器拒绝连接或不可达），请稍后重试或换一个站点。',
    );
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('connection_refused');
  });

  it('Connection refused — raw ERR_CONNECTION_REFUSED', () => {
    const r = detectNavFailure('failed: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9999/');
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('connection_refused');
  });

  it('Connection reset — raw ECONNRESET', () => {
    const r = detectNavFailure('socket hang up: ECONNRESET while connecting to host');
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('connection_refused');
  });

  it('long report mentioning DNS as one bullet is NOT flagged (conservative gate)', () => {
    const longReport =
      '# 报告\n\n本次任务覆盖三个站点：\n\n## 1. example.com\n标题：Example Domain。\n\n## 2. another-site.com\n标题：Another Site。内容详尽，包含若干 H2 段落与示例代码。\n\n## 3. third-site.com\n该站点 DNS 解析失败，跳过。\n\n## 总结\n本报告覆盖了三个独立站点，提供了页面标题与简要内容描述，可作为后续分析的输入。'.padEnd(
        500,
        '。',
      );
    const r = detectNavFailure(longReport);
    expect(r.detected).toBe(false);
  });

  it('reason field is populated whenever detected', () => {
    const r = detectNavFailure('无法访问该网址，请检查是否拼写正确。');
    expect(r.detected).toBe(true);
    expect(r.reason).toBeTruthy();
    expect(typeof r.reason).toBe('string');
  });

  it('matchedPattern is populated for telemetry', () => {
    const r = detectNavFailure('页面加载超时');
    expect(r.detected).toBe(true);
    expect(r.matchedPattern).toBeTruthy();
  });

  it('case-insensitive on raw error codes', () => {
    const r = detectNavFailure('Error: net::err_name_not_resolved at https://x/');
    expect(r.detected).toBe(true);
    expect(r.kind).toBe('dns');
  });
});
