import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { STEALTH_INIT_SCRIPT, isStealthEnabled } from './stealth-scripts.js';

/**
 * The stealth script is meant to run inside a real Chrome page. We
 * can't boot Chromium in a unit test, so we approximate: a minimal
 * vm context with the objects the script touches (Navigator prototype,
 * navigator instance, Notification.permission, WebGLRenderingContext,
 * window.chrome), then `runInNewContext` the IIFE and assert the
 * evasions landed.
 *
 * This doesn't prove real fingerprint-tester tools like `bot.sannysoft
 * .com` clear (that needs a browser); it proves the property descriptors
 * + getter returns are what we intended. Real-browser coverage comes
 * from the E2E triage.
 */

function makeFakeWindow(): Record<string, unknown> {
  // Real Chrome exposes navigator.webdriver / plugins / languages as
  // getters on Navigator.prototype — NOT own properties on the
  // instance. The stealth script rewrites those prototype getters
  // with `Object.defineProperty(Navigator.prototype, ...)`. If the
  // test fake sets them as own properties (e.g. `this.webdriver =
  // true`), the own value shadows the prototype getter and the
  // evasion looks broken even though it landed. Mirror Chrome's shape
  // here so the evasion gets actually exercised.
  class FakeNavigator {
    permissions = {
      query: async (params: { name: string }) => {
        if (params.name === 'notifications') {
          return { state: 'default', onchange: null };
        }
        return { state: 'granted', onchange: null };
      },
    };
  }
  Object.defineProperty(FakeNavigator.prototype, 'webdriver', {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(FakeNavigator.prototype, 'plugins', {
    configurable: true,
    get: () => [],
  });
  Object.defineProperty(FakeNavigator.prototype, 'languages', {
    configurable: true,
    get: () => ['en-US'],
  });

  class FakeWebGLRenderingContext {
    getParameter(p: number): string {
      if (p === 37445) return 'Google Inc.'; // pre-stealth
      if (p === 37446) return 'SwiftShader';
      return 'unknown';
    }
  }
  const navigator = new FakeNavigator();
  const ctx: Record<string, unknown> = {
    Navigator: FakeNavigator,
    navigator,
    WebGLRenderingContext: FakeWebGLRenderingContext,
    Notification: { permission: 'default' },
  };
  ctx.window = ctx;
  return ctx;
}

describe('STEALTH_INIT_SCRIPT', () => {
  it('removes navigator.webdriver', () => {
    const ctx = makeFakeWindow();
    vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx);
    expect((ctx.navigator as { webdriver?: unknown }).webdriver).toBeUndefined();
  });

  it('installs at least three plugins on navigator.plugins', () => {
    const ctx = makeFakeWindow();
    vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx);
    const plugins = (ctx.navigator as { plugins: { length: number } }).plugins;
    expect(plugins.length).toBeGreaterThanOrEqual(3);
  });

  it('sets navigator.languages with zh-CN first', () => {
    const ctx = makeFakeWindow();
    vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx);
    const langs = (ctx.navigator as { languages: string[] }).languages;
    expect(langs[0]).toBe('zh-CN');
    expect(langs).toContain('en');
  });

  it('patches WebGLRenderingContext.getParameter to hide SwiftShader', () => {
    const ctx = makeFakeWindow();
    vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx);
    const WebGLCtor = ctx.WebGLRenderingContext as new () => { getParameter: (p: number) => string };
    const instance = new WebGLCtor();
    expect(instance.getParameter(37445)).toBe('Intel Inc.');
    expect(instance.getParameter(37446)).toBe('Intel Iris OpenGL Engine');
    // unrelated parameters still delegate to the original
    expect(instance.getParameter(42)).toBe('unknown');
  });

  it('shims window.chrome.runtime when missing', () => {
    const ctx = makeFakeWindow();
    vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx);
    const win = ctx.window as { chrome?: { runtime?: unknown } };
    expect(win.chrome).toBeDefined();
    expect(win.chrome?.runtime).toBeDefined();
  });

  it('permissions.query on notifications returns the current Notification.permission', async () => {
    const ctx = makeFakeWindow();
    (ctx.Notification as { permission: string }).permission = 'granted';
    vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx);
    const res = await (
      ctx.navigator as {
        permissions: { query: (p: { name: string }) => Promise<{ state: string }> };
      }
    ).permissions.query({ name: 'notifications' });
    expect(res.state).toBe('granted');
  });

  it('does not throw when Navigator prototype is locked down', () => {
    // Simulate a hostile page that froze Navigator.prototype — every
    // evasion's individual try/catch should swallow the defineProperty
    // failure so the rest of the evasions still land.
    const ctx = makeFakeWindow();
    Object.freeze((ctx.Navigator as { prototype: object }).prototype);
    expect(() => vm.runInNewContext(STEALTH_INIT_SCRIPT, ctx)).not.toThrow();
  });
});

describe('isStealthEnabled', () => {
  it('defaults to true when STEALTH_ENABLED is unset', () => {
    const prev = process.env.STEALTH_ENABLED;
    delete process.env.STEALTH_ENABLED;
    expect(isStealthEnabled()).toBe(true);
    if (prev !== undefined) process.env.STEALTH_ENABLED = prev;
  });

  it('returns false for "false" / "0" / empty string', () => {
    const prev = process.env.STEALTH_ENABLED;
    for (const v of ['false', 'FALSE', '0', '  0 ', 'no', '']) {
      process.env.STEALTH_ENABLED = v;
      expect(isStealthEnabled()).toBe(false);
    }
    if (prev === undefined) delete process.env.STEALTH_ENABLED;
    else process.env.STEALTH_ENABLED = prev;
  });

  it('returns true for any other string', () => {
    const prev = process.env.STEALTH_ENABLED;
    for (const v of ['true', '1', 'on', 'yes']) {
      process.env.STEALTH_ENABLED = v;
      expect(isStealthEnabled()).toBe(true);
    }
    if (prev === undefined) delete process.env.STEALTH_ENABLED;
    else process.env.STEALTH_ENABLED = prev;
  });
});
