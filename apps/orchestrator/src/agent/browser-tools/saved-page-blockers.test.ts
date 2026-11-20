import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { type BrowserBlockerEvidence, detectBrowserBlocker } from './browser-completion.js';
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/login-public-snapshots.json', import.meta.url), 'utf8'),
) as {
  pages: Array<{
    name: string;
    url: string;
    title: string;
    snapshot: string;
    expected: string | null;
    scope: BrowserBlockerEvidence['scope'];
    readableContent: boolean;
  }>;
};
it.each(fixture.pages)('rechecks the saved real $name snapshot', (page) => {
  const result = detectBrowserBlocker({
    ...page,
    text: page.snapshot,
    visible: true,
    blocking: true,
  });
  expect(result?.reason ?? null).toBe(page.expected);
  if (result) expect(result.evidence.scope).toBe(page.scope);
});
