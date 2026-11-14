import { randomUUID } from 'node:crypto';
import type { BrowserContext, Frame, Locator } from 'playwright';

export interface CausalRequest {
  token: string;
  method: string;
  url: string;
}

/** Attribute requests to a trusted interaction and its asynchronous callbacks.
 * No request headers/bodies are modified or collected. A timer which was already
 * running before the interaction has no causal token, even if it fires during it.
 */
export class ActionCausality {
  private readonly binding = `__hdCausal_${randomUUID().replaceAll('-', '')}`;
  private readonly ready: ReturnType<BrowserContext['exposeBinding']>;
  private disposed = false;
  constructor(context: BrowserContext, onRequest: (frame: Frame, request: CausalRequest) => void) {
    this.ready = context
      .exposeBinding(this.binding, ({ frame }, request: CausalRequest) => {
        if (
          !this.disposed &&
          request &&
          typeof request.token === 'string' &&
          typeof request.method === 'string' &&
          typeof request.url === 'string'
        )
          onRequest(frame, request);
      })
      .then(async (binding) => {
        await context.addInitScript({ content: this.script(null) });
        return binding;
      });
    // An executor may be constructed for an already-closed context. Preserve
    // rejection for prepare()/arm(), but do not emit an unhandled rejection.
    void this.ready.catch(() => {});
  }
  dispose() {
    this.disposed = true;
    void this.ready.then((binding) => binding.dispose()).catch(() => {});
  }
  async arm(frame: Frame, token: string, target?: Locator) {
    await this.ready;
    await frame.evaluate(this.script(token));
    if (target)
      await target.evaluate((node) => {
        const state = (
          globalThis as unknown as { __holadayRequestCausality: { target: Element | null } }
        ).__holadayRequestCausality;
        state.target = node;
      });
  }
  async prepare() {
    await this.ready;
  }
  private script(token: string | null) {
    // This runs in the page's realm. Use a literal to avoid transpiler closures.
    return `(() => {
      const key = '__holadayRequestCausality';
      let state = globalThis[key];
      if (!state) {
        state = globalThis[key] = { armed: null, active: null, binding: null, target: null };
        const current = () => state.active || ((globalThis.event?.isTrusted ||
          (state.target && globalThis.event?.target === state.target)) &&
          ['click','keydown','input','change','submit'].includes(globalThis.event.type) ? state.armed : null);
        const nativeMicrotask = globalThis.queueMicrotask.bind(globalThis);
        const wrap = (fn, token) => typeof fn !== 'function' ? fn : function(...args) {
          const previous = state.active; state.active = token;
          try { return fn.apply(this, args); } finally {
            nativeMicrotask(() => { if (state.active === token) state.active = previous; });
          }
        };
        for (const type of ['click','keydown','input','change','submit']) {
          globalThis.addEventListener(type, event => {
            if ((!event.isTrusted && event.target !== state.target) || !state.armed) return;
            if (type === 'submit' && event.target instanceof HTMLFormElement) {
              report(event.target.method || 'GET', event.target.action || location.href);
            }
            if (type === 'click' && event.target instanceof Element) {
              const link = event.target.closest('a[href]');
              if (link) report('GET', link.href);
            }
          }, true);
        }
        // Form handlers can change action/method after the capture phase.
        globalThis.addEventListener('submit', event => {
          if (event.target instanceof HTMLFormElement) report(event.target.method, event.target.action);
        });
        for (const name of ['submit','requestSubmit']) {
          const original = HTMLFormElement.prototype[name];
          if (original) HTMLFormElement.prototype[name] = function() {
            report(this.method, this.action); return original.apply(this, arguments);
          };
        }
        for (const name of ['setTimeout','setInterval','queueMicrotask']) {
          const original = globalThis[name].bind(globalThis);
          globalThis[name] = (fn, ...args) => original(wrap(fn, current()), ...args);
        }
        const then = Promise.prototype.then;
        Promise.prototype.then = function(ok, fail) {
          return then.call(this, wrap(ok, current()), wrap(fail, current()));
        };
        function report(method, url) {
          const token = current(); if (!token) return;
          try {
            globalThis[state.binding]({ token, method: String(method).toUpperCase(),
              url: new URL(String(url), location.href).href }).catch(() => {});
          } catch {}
        }
        const fetch = globalThis.fetch;
        globalThis.fetch = function(input, init) {
          report(init?.method || (input instanceof Request ? input.method : 'GET'), input instanceof Request ? input.url : input);
          return fetch.apply(this, arguments);
        };
        const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
        const xhr = new WeakMap();
        XMLHttpRequest.prototype.open = function(method, url) { xhr.set(this, { method, url }); return open.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function() { const item = xhr.get(this); if (item) report(item.method, item.url); return send.apply(this, arguments); };
        const beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) { report('POST', url); return beacon(url, data); };
      }
      state.binding = ${JSON.stringify(this.binding)};
      state.armed = ${JSON.stringify(token)};
      state.active = null;
      state.target = null;
    })()`;
  }
  async disarm(frame: Frame, token: string) {
    await frame
      .evaluate((token) => {
        const state = (
          globalThis as unknown as {
            __holadayRequestCausality?: { armed: string | null; target: Element | null };
          }
        ).__holadayRequestCausality;
        if (state?.armed === token) {
          state.armed = null;
          state.target = null;
        }
      }, token)
      .catch(() => {});
  }
}
