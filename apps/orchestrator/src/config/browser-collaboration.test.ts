import { expect, it } from 'vitest';
import { resolveBrowserCapabilities } from './browser-capabilities.js';
it('keeps collaboration off independently of old browser canaries/routing', () => {
  expect(
    resolveBrowserCapabilities('owner', { allowlist: 'owner', routing: true }),
  ).not.toHaveProperty('collaborationV2');
  expect(
    resolveBrowserCapabilities('owner', { collaboration: true, routing: false }),
  ).toMatchObject({ collaborationV2: true, routingV2: false });
});
