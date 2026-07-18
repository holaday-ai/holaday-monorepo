import { describe, expect, it } from 'vitest';
import { resolveBrowserStreamProxyTarget } from '../../vite-browser-proxy';

describe('resolveBrowserStreamProxyTarget', () => {
  it('routes browser upgrades through the orchestrator HTTP server by default', () => {
    expect(
      resolveBrowserStreamProxyTarget('http://127.0.0.1:3001'),
    ).toBe('ws://127.0.0.1:3001');
    expect(
      resolveBrowserStreamProxyTarget('https://orchestrator.internal'),
    ).toBe('wss://orchestrator.internal');
  });

  it('allows an explicit browser-stream proxy override', () => {
    expect(
      resolveBrowserStreamProxyTarget(
        'http://127.0.0.1:3001',
        'ws://browser-stream.internal:8080',
      ),
    ).toBe('ws://browser-stream.internal:8080');
  });
});
