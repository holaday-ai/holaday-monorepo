import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import { governanceRegistry } from './index.js';
import { publicDisclosures } from './public-disclosure-map.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const spa = readFileSync(`${repoRoot}/apps/web-workbench/src/pages/PrivacyPage.tsx`, 'utf8');
const landing = readFileSync(`${repoRoot}/apps/holaday-landing/privacy.html`, 'utf8');

describe('public disclosure map', () => {
  it('maps every registered public category to both policy surfaces', () => {
    expect(publicDisclosures).toHaveLength(13);
    expect(new Set(publicDisclosures.map((item) => item.categoryId)).size).toBe(13);
    for (const item of publicDisclosures) {
      expect(spa).toContain(item.spaLabel);
      expect(landing).toContain(item.landingLabel);
      for (const boundary of item.requiredBoundaries) {
        expect(spa).toContain(boundary);
        expect(landing).toContain(boundary);
      }
    }
  });

  it('passes strict public-disclosure registry audit', () => {
    const report = auditGovernanceRegistry(governanceRegistry, {
      repoRoot,
      verifyEvidenceFiles: true,
      requirePublicDisclosures: true,
    });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
