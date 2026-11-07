import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('observation-redaction mirror', () => {
  it('is byte-identical to packages/browser-driver (after the mirror header)', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../../packages/browser-driver/src/observation-redaction.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const mirror = readFileSync(
      fileURLToPath(new URL('./observation-redaction.ts', import.meta.url)),
      'utf8',
    );
    expect(mirror.endsWith(source)).toBe(true);
  });
});
