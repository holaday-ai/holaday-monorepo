import { describe, expect, it } from 'vitest';
import { MAX_SIDE_PANEL_INTENT_CHARS, normalizeSidePanelIntent } from './task-intent.js';

describe('normalizeSidePanelIntent', () => {
  it('trims the side panel task intent before submit', () => {
    expect(normalizeSidePanelIntent('  open this page  ')).toBe('open this page');
  });

  it('bounds pasted side panel task intents before submit', () => {
    expect(normalizeSidePanelIntent('x'.repeat(MAX_SIDE_PANEL_INTENT_CHARS + 200))).toHaveLength(
      MAX_SIDE_PANEL_INTENT_CHARS,
    );
  });

  it('falls back to an empty task intent for malformed input', () => {
    expect(normalizeSidePanelIntent(null)).toBe('');
  });
});
