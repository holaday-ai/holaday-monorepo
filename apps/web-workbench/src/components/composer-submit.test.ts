import { describe, expect, it } from 'vitest';
import {
  clearComposerOnSubmitSuccess,
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
});
