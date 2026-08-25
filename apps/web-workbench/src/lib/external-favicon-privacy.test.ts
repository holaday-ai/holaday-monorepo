import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const searchResultCard = readFileSync(
  new URL('../components/SearchResultCard.tsx', import.meta.url),
  'utf8',
);
const adminLearningDomain = readFileSync(
  new URL('../pages/admin/AdminLearningDomainPage.tsx', import.meta.url),
  'utf8',
);

describe('external favicon privacy boundary', () => {
  it('does not contact Google favicon services while rendering source domains', () => {
    expect(searchResultCard).not.toContain('www.google.com/s2/favicons');
    expect(adminLearningDomain).not.toContain('www.google.com/s2/favicons');
  });

  it('keeps local globe icons as the source-domain affordance', () => {
    expect(searchResultCard).toContain('<Globe2');
    expect(adminLearningDomain).toContain('<Globe');
  });
});
