/**
 * F2-followup — pins down `reconcileFinalAnswerText`. Earlier version
 * only APPENDED a "📍 实际浏览器页面" line; the user saw two
 * conflicting URLs in the same answer. New behaviour replaces same-
 * domain mismatches inline and falls back to append for cross-domain.
 */

import { describe, expect, it } from 'vitest';
import { reconcileFinalAnswerText } from './agent-loop.js';

describe('reconcileFinalAnswerText', () => {
  describe('no observed URL — passthrough', () => {
    it('returns finalText unchanged when observedUrl is null', () => {
      const text = 'Some answer with no live page.';
      expect(reconcileFinalAnswerText(text, null, null)).toBe(text);
    });

    it('returns finalText unchanged when observedUrl is malformed', () => {
      const text = 'Answer';
      expect(reconcileFinalAnswerText(text, 'not-a-url', null)).toBe(text);
    });
  });

  describe('text contains no URLs — passthrough', () => {
    it('plain text answer', () => {
      const text = '页面标题是 Example Domain。';
      expect(
        reconcileFinalAnswerText(
          text,
          'https://www.iana.org/help/example-domains',
          'Example Domains - IANA',
        ),
      ).toBe(text);
    });
  });

  describe('URL already matches observed — passthrough', () => {
    it('exact match', () => {
      const text =
        '页面跳转到 https://www.iana.org/help/example-domains，标题是 Example Domains - IANA。';
      expect(
        reconcileFinalAnswerText(
          text,
          'https://www.iana.org/help/example-domains',
          'Example Domains - IANA',
        ),
      ).toBe(text);
    });

    it('match modulo trailing slash + punctuation', () => {
      const text = '查看 https://www.iana.org/help/example-domains/。';
      expect(
        reconcileFinalAnswerText(
          text,
          'https://www.iana.org/help/example-domains',
          null,
        ),
      ).toBe(text);
    });
  });

  describe('same-domain mismatch — replace inline', () => {
    it('replaces a bare URL with observed URL', () => {
      const text =
        '点击后跳转到 https://www.iana.org/domains/reserved，标题是 IANA — Reserved。';
      const out = reconcileFinalAnswerText(
        text,
        'https://www.iana.org/help/example-domains',
        'Example Domains - IANA',
      );
      expect(out).toContain('https://www.iana.org/help/example-domains');
      expect(out).not.toContain('https://www.iana.org/domains/reserved');
      // No appended correction line — the answer is now correct in place.
      expect(out).not.toContain('📍 实际浏览器页面');
    });

    it('replaces markdown link AND swaps label to observed title', () => {
      const text =
        '跳转到 [IANA — Reserved](https://www.iana.org/domains/reserved)。';
      const out = reconcileFinalAnswerText(
        text,
        'https://www.iana.org/help/example-domains',
        'Example Domains - IANA',
      );
      expect(out).toContain(
        '[Example Domains - IANA](https://www.iana.org/help/example-domains)',
      );
      expect(out).not.toContain('IANA — Reserved');
      expect(out).not.toContain('/domains/reserved');
    });

    it('replaces multiple same-domain URLs in one go', () => {
      const text = [
        '页面 1: https://www.iana.org/foo',
        '页面 2: [IANA Page](https://www.iana.org/bar)',
        '页面 3: https://www.iana.org/baz',
      ].join('\n');
      const out = reconcileFinalAnswerText(
        text,
        'https://www.iana.org/help/example-domains',
        'Example Domains - IANA',
      );
      // All three should now point at the observed URL.
      const matches = out.match(
        /https:\/\/www\.iana\.org\/help\/example-domains/g,
      );
      expect(matches?.length).toBe(3);
      expect(out).not.toContain('iana.org/foo');
      expect(out).not.toContain('iana.org/bar');
      expect(out).not.toContain('iana.org/baz');
    });

    it('falls back to URL itself when observedTitle is empty', () => {
      const text = '跳转到 [Old Label](https://www.iana.org/wrong)。';
      const out = reconcileFinalAnswerText(
        text,
        'https://www.iana.org/help/example-domains',
        null,
      );
      expect(out).toContain(
        '[https://www.iana.org/help/example-domains](https://www.iana.org/help/example-domains)',
      );
    });
  });

  describe('different-domain mismatch — append correction', () => {
    it('keeps the foreign-domain URL intact and appends 📍 line', () => {
      const text =
        '页面是 https://example.com/some-other-thing，请查看。';
      const out = reconcileFinalAnswerText(
        text,
        'https://www.iana.org/help/example-domains',
        'Example Domains - IANA',
      );
      // Original mention preserved (we don't silently rewrite cross-domain).
      expect(out).toContain('https://example.com/some-other-thing');
      // Append marker present with observed page details.
      expect(out).toContain('📍 实际浏览器页面');
      expect(out).toContain(
        '[Example Domains - IANA](https://www.iana.org/help/example-domains)',
      );
    });
  });

  describe('regression — original IANA example BOSS provided', () => {
    it('rewrites /domains/reserved → /help/example-domains and updates the title', () => {
      const text = [
        '跳转后：',
        '- 页面标题：Example Domains - Reserved',
        '- 完整 URL：https://www.iana.org/domains/reserved',
      ].join('\n');
      const out = reconcileFinalAnswerText(
        text,
        'https://www.iana.org/help/example-domains',
        'Example Domains - IANA',
      );
      expect(out).toContain('https://www.iana.org/help/example-domains');
      expect(out).not.toContain('https://www.iana.org/domains/reserved');
      // No conflicting append line — single source of truth.
      expect(out).not.toContain('📍 实际浏览器页面');
    });
  });
});
