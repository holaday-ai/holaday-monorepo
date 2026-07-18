import { describe, expect, it } from 'vitest';
import { buildBraveArgs, buildNativeChromiumArgs } from './spawn.js';

describe('buildBraveArgs', () => {
  it('forces pooled browser traffic through the loopback egress guard', () => {
    const args = buildBraveArgs({
      display: 100,
      cdpPort: 9300,
      userDataDir: '/tmp/browser-profile',
      proxyServer: 'http://127.0.0.1:41234',
    });

    expect(args).toContain('--proxy-server=http://127.0.0.1:41234');
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
    expect(args).toContain('--disable-quic');
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });
});

describe('buildNativeChromiumArgs', () => {
  it('launches a headless local CDP browser through the same egress guard', () => {
    const args = buildNativeChromiumArgs({
      display: 0,
      cdpPort: 9300,
      userDataDir: '/tmp/browser-profile',
      windowSize: '1280,800',
      proxyServer: 'http://127.0.0.1:41234',
    });

    expect(args).toContain('--headless=new');
    expect(args).toContain('--remote-debugging-port=9300');
    expect(args).toContain('--user-data-dir=/tmp/browser-profile');
    expect(args).toContain('--window-size=1280,800');
    expect(args).toContain('--proxy-server=http://127.0.0.1:41234');
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
  });
});
