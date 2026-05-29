import { describe, expect, it } from 'vitest';
import {
  clearComposerOnSubmitSuccess,
  composerSubmitErrorMessage,
  keepComposerOnSubmitFailure,
  shouldClearComposerAfterSubmit,
} from './composer-submit.js';

describe('shouldClearComposerAfterSubmit', () => {
  it('keeps legacy void submitters as success', () => {
    expect(shouldClearComposerAfterSubmit(undefined)).toBe(true);
    expect(shouldClearComposerAfterSubmit(null)).toBe(true);
  });

  it('clears after explicit success', () => {
    expect(shouldClearComposerAfterSubmit(clearComposerOnSubmitSuccess)).toBe(true);
    expect(shouldClearComposerAfterSubmit({ ok: true })).toBe(true);
  });

  it('keeps the draft after explicit failure', () => {
    expect(shouldClearComposerAfterSubmit(keepComposerOnSubmitFailure)).toBe(false);
    expect(shouldClearComposerAfterSubmit({ ok: false })).toBe(false);
  });

  it('keeps the draft after a structured error', () => {
    expect(shouldClearComposerAfterSubmit({ error: 'quota exceeded' })).toBe(false);
    expect(shouldClearComposerAfterSubmit({ ok: true, error: 'network down' })).toBe(false);
  });

  it('humanizes submit errors before they reach the toast', () => {
    expect(composerSubmitErrorMessage('net::ERR_NAME_NOT_RESOLVED')).toBe(
      '提交失败：无法访问该网址，请检查网址是否拼写正确。',
    );
    expect(composerSubmitErrorMessage('扩展未连接，无法走 Mode B')).toBe(
      '提交失败：浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。',
    );
  });
});
