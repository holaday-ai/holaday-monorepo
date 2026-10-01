import assert from 'node:assert/strict';
import test from 'node:test';
import { probeFirstCutoverRecoveredBrowser } from './browser-first-cutover-browser-probe.mjs';
for (const fault of [
  'none',
  'stale',
  'unowned',
  'foreign-url',
  'wrong-result',
  'close-ack',
  'deadline',
]) {
  test(`fixed own-target browser probe ${fault}`, async () => {
    const calls = [];
    const native = {
      purpose: 'cloud-recovery-native-observation',
      name: 'holaday-chromium-headed',
      observedAtMs: 1000,
      processes: [{ pid: 2, ppid: 1, start: '200' }],
    };
    const fields = Array(22).fill('0');
    fields[0] = 'S';
    fields[1] = '1';
    fields[19] = '200';
    const fs = {
      readFile: async (p) =>
        p === '/proc/net/tcp'
          ? 'header\n0: 0100007F:2407 00000000:0000 0A 0 0 0 0 0 42\n'
          : `2 (brave) ${fields.join(' ')}`,
      readdir: async () => ['3'],
      readlink: async () => (fault === 'unowned' ? 'socket:[43]' : 'socket:[42]'),
    };
    class Socket extends EventTarget {
      constructor(url) {
        super();
        calls.push(['socket', url]);
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(raw) {
        const req = JSON.parse(raw);
        assert.equal(req.method, 'Runtime.evaluate');
        assert.equal(
          req.params.expression,
          'JSON.stringify({url:location.href,value:2+2,ready:document.readyState})',
        );
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                id: 1,
                result: {
                  result: {
                    type: 'string',
                    value: JSON.stringify({
                      url: 'about:blank',
                      value: fault === 'wrong-result' ? 5 : 4,
                      ready: 'complete',
                    }),
                  },
                },
              }),
            }),
          ),
        );
      }
      close() {
        calls.push(['socket-close']);
      }
    }
    const fetch = async (url, options) => {
      calls.push([options.method, url]);
      if (url.endsWith('/json/new?about%3Ablank'))
        return new Response(
          JSON.stringify({
            id: 'OWN_TARGET',
            type: 'page',
            url: 'about:blank',
            webSocketDebuggerUrl: `ws://${fault === 'foreign-url' ? 'example.test' : '127.0.0.1:9223'}/devtools/page/OWN_TARGET`,
          }),
        );
      if (fault === 'close-ack') throw Error('unknown close result');
      return new Response('Target is closing');
    };
    if (fault === 'stale') native.observedAtMs = -60000;
    const operation = probeFirstCutoverRecoveredBrowser(
      native,
      fault === 'deadline' ? 1000 : 90000,
      { now: () => 1000, fs, fetch, WebSocket: Socket },
    );
    if (fault === 'none') assert.equal((await operation).kind, 'browser-minimum-execution-result');
    else await assert.rejects(operation);
    assert(
      !calls.some((row) =>
        row.some((v) => typeof v === 'string' && /json\/list|EXISTING_USER_TARGET/.test(v)),
      ),
    );
    assert(calls.filter((row) => row[1]?.includes('/json/close')).length <= 1);
    if (['stale', 'unowned', 'deadline'].includes(fault)) assert.equal(calls.length, 0);
    if (['foreign-url', 'wrong-result', 'close-ack'].includes(fault))
      assert.equal(calls.filter((row) => row[1]?.endsWith('/json/close/OWN_TARGET')).length, 1);
  });
}
