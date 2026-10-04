/**
 * Offline mock orchestrator for the extension e2e.
 *
 * One loopback HTTP server carries everything the local-QA extension build
 * talks to, on a single random port:
 *   GET /healthz        → 200 (ws-client health preflight)
 *   GET /ws (no upgrade)→ 426 (ws-client route probe)
 *   WS  /ws             → holaday.v1 protocol (hello → welcome, tool calls)
 *   GET /page*.html     → local fixture pages the extension acts on
 *
 * The server never talks to the network beyond 127.0.0.1 and is started /
 * stopped by the test itself (`start()` / `stop()`); `drop()` + `start()` on
 * the same port simulates an orchestrator restart / network cut.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Reuse the workspace's locked `ws` (an orchestrator dependency) so this
// e2e adds no new package to the lockfile.
const require = createRequire(new URL('../../orchestrator/package.json', import.meta.url));
const { WebSocketServer } = require('ws');

const SUBPROTOCOL = 'holaday.v1';

const PAGE_ONE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>E2E 页面一</title></head>
<body>
  <h1>扩展离线 e2e</h1>
  <button id="submit" type="button">提交</button>
  <p id="status">已点击 0 次</p>
  <label>搜索词 <input id="query" type="text"></label>
  <label>密码 <input id="pw" type="password" autocomplete="current-password"></label>
  <label>验证码 <input id="otp" type="text" autocomplete="one-time-code"></label>
  <script>
    let n = 0;
    document.getElementById('submit').addEventListener('click', () => {
      n += 1;
      document.getElementById('status').textContent = '已点击 ' + n + ' 次';
    });
  </script>
</body></html>`;

const PAGE_TWO = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>E2E 页面二</title></head>
<body><h1>第二个标签页</h1><button type="button">第二页按钮</button></body></html>`;

export class MockOrchestrator {
  constructor() {
    this.port = 0;
    this.http = null;
    this.wss = null;
    this.sockets = new Set();
    this.pending = new Map();
    this.connections = [];
    this.received = [];
    this.connectionWaiters = [];
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Start (or restart on the same port after `drop()`). */
  async start() {
    this.http = createServer((req, res) => this.#onHttp(req, res));
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
    });
    this.http.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.#onSocket(ws, req));
    });
    await new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, '127.0.0.1', () => resolve(undefined));
    });
    this.port = this.http.address().port;
  }

  /** Terminate every socket and stop listening (simulated outage). */
  async drop() {
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    for (const [, waiter] of this.pending) waiter.reject(new Error('mock orchestrator dropped'));
    this.pending.clear();
    await new Promise((resolve) => this.wss.close(() => resolve(undefined)));
    this.http.closeAllConnections?.();
    await new Promise((resolve) => this.http.close(() => resolve(undefined)));
    this.http = null;
    this.wss = null;
  }

  async stop() {
    if (this.http) await this.drop();
  }

  /** Resolve once `count` authenticated (hello'd) connections were seen in total. */
  waitForConnection(count, timeoutMs) {
    if (this.connections.filter((c) => c.helloAt).length >= count) {
      return Promise.resolve(this.connections.at(-1));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for connection #${count}`)),
        timeoutMs,
      );
      this.connectionWaiters.push({
        count,
        resolve: (c) => {
          clearTimeout(timer);
          resolve(c);
        },
      });
    });
  }

  /** Send `server.extension.tool_call` and await the matching tool_result. */
  call(taskId, kind, args, timeoutMs = 30_000) {
    const ws = [...this.sockets].at(-1);
    if (!ws) return Promise.reject(new Error('no extension connected'));
    const requestId = randomUUID().slice(0, 32);
    const frame = { type: 'server.extension.tool_call', taskId, requestId, kind, timeoutMs };
    if (args) frame.args = args;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`tool_call ${kind} timed out`));
      }, timeoutMs + 2_000);
      this.pending.set(requestId, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify(frame));
    });
  }

  #onHttp(req, res) {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (process.env.HOLADAY_E2E_DEBUG === '1') console.log(`[mock] ${Date.now() % 100000} ${req.method} ${path}`);
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (path === '/ws') {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('upgrade required');
      return;
    }
    const page = path === '/page.html' ? PAGE_ONE : path === '/page2.html' ? PAGE_TWO : null;
    if (page) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    res.writeHead(404);
    res.end();
  }

  #onSocket(ws, req) {
    const offered = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((p) => p.trim());
    const bearer = offered.find((p) => p.startsWith('jwt.'))?.slice(4) ?? null;
    const connection = { bearer, helloAt: null, pongs: 0, closedAt: null };
    if (process.env.HOLADAY_E2E_DEBUG === '1') console.log(`[mock] ${Date.now() % 100000} ws connection`);
    this.connections.push(connection);
    this.sockets.add(ws);
    ws.on('close', () => {
      connection.closedAt = Date.now();
      this.sockets.delete(ws);
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.received.push(msg);
      if (msg.type === 'client.hello') {
        connection.helloAt = Date.now();
        ws.send(
          JSON.stringify({ type: 'server.welcome', clientId: randomUUID(), heartbeatMs: 30_000 }),
        );
        const authed = this.connections.filter((c) => c.helloAt).length;
        this.connectionWaiters = this.connectionWaiters.filter((w) => {
          if (authed < w.count) return true;
          w.resolve(connection);
          return false;
        });
        return;
      }
      if (msg.type === 'client.pong') {
        connection.pongs += 1;
        return;
      }
      if (msg.type === 'client.extension.tool_result') {
        const waiter = this.pending.get(msg.requestId);
        if (waiter) {
          this.pending.delete(msg.requestId);
          waiter.resolve(msg);
        }
      }
    });
  }
}
