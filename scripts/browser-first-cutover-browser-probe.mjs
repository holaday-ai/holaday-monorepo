import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Fixed foundational browser probe. Creates one about:blank target, executes a
 * literal expression only on that target, and closes only that returned target.
 * It does not prove the application's full task routing or success rate.
 */
export async function probeFirstCutoverRecoveredBrowser(native, deadline, overrides = {}) {
  const io = {
    fs,
    now: Date.now,
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    ...overrides,
  };
  const fail = () => {
    throw new Error('CUTOVER_BROWSER_MINIMUM_PROBE_UNPROVEN');
  };
  const began = io.now();
  const end = Math.min(deadline, began + 15000);
  const clock = () => {
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < began || now >= end) fail();
    return now;
  };
  if (
    native?.purpose !== 'cloud-recovery-native-observation' ||
    native.name !== 'holaday-chromium-headed' ||
    !Array.isArray(native.processes) ||
    !native.processes.length ||
    !Number.isSafeInteger(deadline) ||
    native.observedAtMs > began ||
    began - native.observedAtMs > 60000
  )
    fail();
  const ownership = async () => {
    clock();
    const text = await io.fs.readFile('/proc/net/tcp', 'utf8');
    if (Buffer.byteLength(text) > 1024 * 1024) fail();
    const listeners = text
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((f) => f[1] === '0100007F:2407' && f[3] === '0A');
    if (listeners.length !== 1 || !/^\d+$/.test(listeners[0][9])) fail();
    const inode = listeners[0][9];
    const owners = [];
    for (const p of native.processes) {
      const stat = await io.fs.readFile(`/proc/${p.pid}/stat`, 'utf8');
      if (!stat.startsWith(`${p.pid} (`)) fail();
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (fields[0] === 'Z' || fields[19] !== p.start || Number(fields[1]) !== p.ppid) fail();
      const fd = await io.fs.readdir(`/proc/${p.pid}/fd`);
      if (fd.length > 1024) fail();
      for (const name of fd) {
        let link;
        try {
          link = await io.fs.readlink(`/proc/${p.pid}/fd/${name}`);
        } catch (e) {
          if (e.code === 'ENOENT') continue;
          throw e;
        }
        if (link === `socket:[${inode}]`) owners.push(p.pid);
      }
    }
    if (!owners.length) fail();
    clock();
  };
  const request = async (path, method = 'GET') => {
    const response = await io.fetch(`http://127.0.0.1:9223${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(5000, end - clock())),
    });
    if (!response.ok || !response.body) fail();
    const parts = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 8192) fail();
      parts.push(Buffer.from(chunk));
      clock();
    }
    return Buffer.concat(parts).toString('utf8');
  };
  let target,
    socket,
    completed = false,
    closeAttempted = false;
  try {
    await ownership();
    const created = JSON.parse(await request('/json/new?about%3Ablank', 'PUT'));
    if (typeof created.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(created.id)) fail();
    target = created.id;
    if (
      created.type !== 'page' ||
      created.url !== 'about:blank' ||
      created.webSocketDebuggerUrl !== `ws://127.0.0.1:9223/devtools/page/${target}`
    )
      fail();
    socket = new io.WebSocket(created.webSocketDebuggerUrl);
    const result = await new Promise((resolve, reject) => {
      let count = 0;
      const timer = setTimeout(
        () => reject(new Error('CUTOVER_BROWSER_MINIMUM_PROBE_UNPROVEN')),
        Math.min(5000, end - clock()),
      );
      const finish = (fn, value) => {
        clearTimeout(timer);
        fn(value);
      };
      socket.addEventListener(
        'error',
        () => finish(reject, new Error('CUTOVER_BROWSER_MINIMUM_PROBE_UNPROVEN')),
        { once: true },
      );
      socket.addEventListener(
        'close',
        () => finish(reject, new Error('CUTOVER_BROWSER_MINIMUM_PROBE_UNPROVEN')),
        { once: true },
      );
      socket.addEventListener(
        'open',
        () =>
          socket.send(
            JSON.stringify({
              id: 1,
              method: 'Runtime.evaluate',
              params: {
                expression:
                  'JSON.stringify({url:location.href,value:2+2,ready:document.readyState})',
                returnByValue: true,
                awaitPromise: false,
              },
            }),
          ),
        { once: true },
      );
      socket.addEventListener('message', (event) => {
        try {
          clock();
          if (
            ++count > 32 ||
            typeof event.data !== 'string' ||
            Buffer.byteLength(event.data) > 8192
          )
            fail();
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          if (
            message.error ||
            message.result?.exceptionDetails ||
            message.result?.result?.type !== 'string'
          )
            fail();
          const value = JSON.parse(message.result.result.value);
          if (
            JSON.stringify(value) !==
            JSON.stringify({ url: 'about:blank', value: 4, ready: 'complete' })
          )
            fail();
          finish(resolve, value);
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    socket.close();
    socket = undefined;
    closeAttempted = true;
    if ((await request(`/json/close/${target}`)).trim() !== 'Target is closing') fail();
    await ownership();
    completed = true;
    return {
      kind: 'browser-minimum-execution-result',
      targetDigest: createHash('sha256').update(target).digest('hex'),
      resultDigest: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      observedAtMs: clock(),
    };
  } finally {
    socket?.close();
    if (target && !completed && !closeAttempted) {
      closeAttempted = true;
      await request(`/json/close/${target}`);
    }
  }
}
