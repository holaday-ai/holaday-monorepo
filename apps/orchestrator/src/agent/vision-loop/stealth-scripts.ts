/**
 * Stealth init scripts — Layer 1 of the anti-detection stack.
 *
 * Injected via `page.addInitScript` (future navigations) + a one-shot
 * `page.evaluate` (current document) so headless-Chrome fingerprints
 * don't give us away to the "is this a bot?" checks that live in
 * every real site these days. None of this evades a real captcha —
 * that's Layer 4. This just stops us showing up as an obvious bot in
 * the signal-light tier: `navigator.webdriver`, missing plugins,
 * SwiftShader renderer, etc.
 *
 * The evasions are pulled from the industry-standard list maintained
 * by puppeteer-extra-plugin-stealth; we hand-roll the critical ones
 * rather than pulling the plugin in because:
 *   1. `puppeteer-extra-plugin-stealth` is a Puppeteer plugin. It
 *      doesn't plug directly into Playwright's `connectOverCDP` flow.
 *   2. We'd be adding three runtime deps (puppeteer-extra, the stealth
 *      plugin, its evasion chain) just to run ~10 lines of JS.
 *   3. Hand-written evasions stay debuggable: every property we touch
 *      is visible in this file; upgrading to a new Chromium is a grep
 *      + audit instead of a plugin version bump.
 *
 * Evasions included:
 *   - navigator.webdriver → undefined
 *   - navigator.plugins → fake PDF viewer triad
 *   - navigator.languages → [zh-CN, zh, en]
 *   - navigator.permissions.query → real state for notifications
 *   - WebGL vendor/renderer → Intel (not SwiftShader)
 *   - window.chrome.runtime → shim so UA-sniffers see "normal Chrome"
 *
 * Every evasion is wrapped in its own try/catch so a single failure
 * (e.g. strict-CSP page that blocks Object.defineProperty on
 * navigator) doesn't break the others.
 */

/**
 * A single concatenated IIFE that applies every evasion. This is the
 * string fed to `page.addInitScript` and `page.evaluate`. Exported as
 * a template for readability; Playwright doesn't care about the
 * wrapping as long as what we inject is valid JS.
 */
export const STEALTH_INIT_SCRIPT = `(() => {
  // 1. navigator.webdriver
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      configurable: true,
      get: () => undefined,
    });
  } catch (_e) {}

  // 2. navigator.plugins — a real desktop Chrome ships with at least
  //    the three PDF viewers below; an empty array is the giveaway.
  try {
    const plugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    Object.defineProperty(Navigator.prototype, 'plugins', {
      configurable: true,
      get: () => {
        const arr = plugins.slice();
        Object.defineProperty(arr, 'item', { value: (i) => arr[i] || null });
        Object.defineProperty(arr, 'namedItem', {
          value: (n) => arr.find((p) => p.name === n) || null,
        });
        Object.defineProperty(arr, 'refresh', { value: () => {} });
        return arr;
      },
    });
  } catch (_e) {}

  // 3. navigator.languages — a lot of checks read .languages (not .language)
  try {
    Object.defineProperty(Navigator.prototype, 'languages', {
      configurable: true,
      get: () => ['zh-CN', 'zh', 'en'],
    });
  } catch (_e) {}

  // 4. permissions.query({name:'notifications'}) — some detectors
  //    rely on this returning 'denied' for a headless browser.
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      const original = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (params) => {
        if (params && params.name === 'notifications') {
          const state =
            (typeof Notification !== 'undefined' && Notification.permission) || 'default';
          return Promise.resolve({ state, onchange: null });
        }
        return original(params);
      };
    }
  } catch (_e) {}

  // 5. WebGL vendor/renderer — real Chrome reports the user's GPU;
  //    headless Chrome reports "Google Inc." + "SwiftShader" which
  //    is an instant flag.
  try {
    const FAKE_VENDOR = 'Intel Inc.';
    const FAKE_RENDERER = 'Intel Iris OpenGL Engine';
    const patch = (proto) => {
      if (!proto || !proto.getParameter) return;
      const orig = proto.getParameter;
      proto.getParameter = function (p) {
        // 37445 = UNMASKED_VENDOR_WEBGL, 37446 = UNMASKED_RENDERER_WEBGL
        if (p === 37445) return FAKE_VENDOR;
        if (p === 37446) return FAKE_RENDERER;
        return orig.call(this, p);
      };
    };
    if (typeof WebGLRenderingContext !== 'undefined') patch(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patch(WebGL2RenderingContext.prototype);
  } catch (_e) {}

  // 6. window.chrome.runtime — real Chrome always has this object;
  //    its absence is a classic "you're a bot" tell. We stub just
  //    enough surface for UA-sniffing checks; we're NOT trying to
  //    pass as a content script.
  try {
    if (typeof window !== 'undefined') {
      if (!window.chrome) {
        window.chrome = {};
      }
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          id: undefined,
          connect: () => ({
            postMessage: () => {},
            disconnect: () => {},
            onMessage: { addListener: () => {}, removeListener: () => {} },
            onDisconnect: { addListener: () => {}, removeListener: () => {} },
          }),
          sendMessage: () => {},
          onMessage: { addListener: () => {}, removeListener: () => {} },
        };
      }
    }
  } catch (_e) {}
})();`;

/**
 * Env gate: stealth is on by default. Set `STEALTH_ENABLED=false` /
 * `0` / empty to opt out (e.g. for E2E tests that measure real-Chrome
 * baseline fingerprints). The boolean read is intentionally lenient
 * — anything other than explicitly falsy is "on".
 */
export function isStealthEnabled(): boolean {
  const raw = process.env.STEALTH_ENABLED;
  if (raw === undefined) return true;
  const lower = raw.trim().toLowerCase();
  return !(lower === 'false' || lower === '0' || lower === 'no' || lower === '');
}
