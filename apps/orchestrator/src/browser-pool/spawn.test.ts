import { describe, expect, it } from 'vitest';
import {
  assertSandboxedBrowserUser,
  buildBraveArgs,
  buildBrowserChildEnv,
  buildNativeChromiumArgs,
} from './spawn.js';

describe('assertSandboxedBrowserUser', () => {
  it('refuses to launch a managed browser as root', () => {
    expect(() => assertSandboxedBrowserUser(0)).toThrow(/non-root/i);
    expect(() => assertSandboxedBrowserUser(501)).not.toThrow();
    expect(() => assertSandboxedBrowserUser(undefined)).not.toThrow();
  });
});

describe('buildBrowserChildEnv', () => {
  it('passes only non-secret runtime variables into the user-controlled browser process', () => {
    const env = buildBrowserChildEnv(
      {
        PATH: '/usr/bin',
        LANG: 'zh_CN.UTF-8',
        DATABASE_URL: 'mysql://secret',
        GEMINI_API_KEY: 'secret-key',
        AWS_SECRET_ACCESS_KEY: 'secret-cloud-key',
      },
      { DISPLAY: ':100', HOLADAY_SPAWN_LABEL: 'brave:9300' },
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      LANG: 'zh_CN.UTF-8',
      DISPLAY: ':100',
      HOLADAY_SPAWN_LABEL: 'brave:9300',
    });
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env).not.toHaveProperty('GEMINI_API_KEY');
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });
});

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
    expect(args).not.toContain('--no-sandbox');
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
