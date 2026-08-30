import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { __organizationsRouterInternals } from '../trpc/routers/organizations.js';

describe('production invitation-link privacy contract', () => {
  it('keeps bearer credentials in a fragment and disables access logs on the exact SPA route', () => {
    const inviteUrl = __organizationsRouterInternals.buildInvitationUrl(
      'https://holaday.ai',
      'release-secret',
    );
    const parsed = new URL(inviteUrl);
    const nginx = readFileSync(
      new URL('../../../../ops/vultr-nginx/holaday.conf', import.meta.url),
      'utf8',
    );
    const routeBlock = nginx.match(
      /location = \/organizations\/invitations\/accept\s*\{([\s\S]*?)\n\s*\}/,
    )?.[1];

    expect(parsed.search).toBe('');
    expect(new URLSearchParams(parsed.hash.slice(1)).get('token')).toBe('release-secret');
    expect(routeBlock).toContain('access_log off;');
    expect(routeBlock).toContain('try_files /index.html =404;');
  });
});
