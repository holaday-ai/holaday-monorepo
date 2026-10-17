import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BROWSER_FRAME } from './frame.mjs';
import { ExpectedSeedError, createSeed, dispatch } from './seed.mjs';
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain',
};
export async function startSeedServer(appDir, { port = 0 } = {}) {
  let seed = createSeed();
  let broadcastBrowser = () => {};
  const uploads = new Map();
  const dist = path.resolve(appDir, 'dist');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      const json = (value, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === '/__ui_seed/reset') {
        seed = createSeed();
        uploads.clear();
        return json({ ok: true });
      }
      if (url.pathname === '/__ui_seed/state')
        return json({ requests: seed.requests, unhandled: seed.unhandled });
      if (url.pathname.startsWith('/api/trpc/')) {
        const names = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
        let input = {};
        if (req.method === 'POST') {
          let bytes = '';
          for await (const chunk of req) {
            bytes += chunk;
            if (bytes.length > 1_000_000) throw Error('INPUT_LIMIT');
          }
          input = JSON.parse(bytes || '{}');
        } else input = JSON.parse(url.searchParams.get('input') || '{}');
        let status = 200;
        const output = names.map((name, i) => {
          try {
            const raw = url.searchParams.has('batch') ? input[i] : input;
            return { result: { data: dispatch(seed, name, raw?.json ?? raw ?? {}, req.method) } };
          } catch (error) {
            if (error instanceof ExpectedSeedError) {
              status = error.status;
              return {
                error: {
                  message: error.message,
                  code: -32003,
                  data: { code: error.code, httpStatus: error.status, path: name },
                },
              };
            }
            status = 501;
            return {
              error: {
                message: 'Local seed API contract missing',
                code: -32601,
                data: { code: 'NOT_IMPLEMENTED', httpStatus: 501, path: name },
              },
            };
          }
        });
        if (names.some((name) => name === 'tasks.browserNav')) broadcastBrowser();
        return json(url.searchParams.has('batch') ? output : output[0], status);
      }
      if (url.pathname === '/api/browser-data')
        return json({ enabled: false, importEnabled: false, profileEnabled: false, grants: [] });
      if (url.pathname === '/api/stream-token') return json({ token: 'local-synthetic-stream' });
      if (url.pathname === '/api/health' || url.pathname === '/healthz') return json({ ok: true });
      if (/^\/api\/files\/[^/]+\/download$/.test(url.pathname)) {
        const id = url.pathname.split('/')[3];
        if (uploads.has(id)) {
          const file = uploads.get(id);
          res.writeHead(200, { 'Content-Type': file.mimetype });
          res.end(file.bytes);
          return;
        }
        if (id === 'fil_image_ui') {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(
            Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
              'base64',
            ),
          );
          return;
        }
        if (id !== 'fil_ui' && id !== 'fil_saved_ui') return json({ error: 'FILE_NOT_FOUND' }, 404);
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="ui-seed.txt"',
        });
        res.end('Local UI seed attachment');
        return;
      }
      if (url.pathname === '/api/upload' || url.pathname === '/api/files/upload') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1000000) throw Error('UPLOAD_LIMIT');
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const text = body.toString('latin1');
        const filename = text.match(/filename="([^"]+)"/)?.[1] ?? 'ui.txt';
        const boundary = req.headers['content-type']?.match(/boundary=(?:"([^"]+)"|([^;]+))/);
        const marker = boundary?.[1] ?? boundary?.[2];
        const start = text.indexOf('\r\n\r\n');
        const end = marker ? text.indexOf(`\r\n--${marker}`, start + 4) : -1;
        const bytes = start >= 0 && end >= 0 ? body.subarray(start + 4, end) : body;
        const mimetype = filename.endsWith('.png') ? 'image/png' : 'text/plain';
        const fileId = `fil_upload_${uploads.size}`;
        uploads.set(fileId, { bytes, mimetype });
        return json({
          fileId,
          filename,
          mimetype,
          size: bytes.length,
          url: `/api/files/${fileId}/download`,
        });
      }
      if (url.pathname.startsWith('/api/')) {
        seed.unhandled.push({ path: url.pathname, method: req.method });
        return json({ error: 'UNHANDLED_SEED_REST' }, 501);
      }
      const normalized = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (!normalized.startsWith(dist + path.sep) && normalized !== dist)
        return json({ error: 'PATH' }, 400);
      if (path.extname(normalized) && !fs.existsSync(normalized))
        return json({ error: 'ASSET_NOT_FOUND' }, 404);
      const file =
        fs.existsSync(normalized) && fs.statSync(normalized).isFile()
          ? normalized
          : path.join(dist, 'index.html');
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      });
      fs.createReadStream(file).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"LOCAL_SEED_ERROR"}');
    }
  });
  const require = createRequire(path.resolve(appDir, '../orchestrator/package.json'));
  const { WebSocketServer } = require('ws');
  const sockets = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('holaday.v1') ? 'holaday.v1' : false),
  });
  server.on('upgrade', (req, socket, head) =>
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws, req)),
  );
  const frame = BROWSER_FRAME;
  const sendFrame = (ws) => {
    const state = seed.browserSessions[ws.localTaskId];
    if (ws.readyState !== 1 || !state) return;
    ws.send(JSON.stringify({ type: 'url-changed', url: state.url }));
    ws.send(JSON.stringify({ type: 'frame', data: frame }));
  };
  broadcastBrowser = () => {
    for (const ws of sockets.clients) sendFrame(ws);
  };
  sockets.on('connection', (ws, req) => {
    const taskId = new URL(req.url, 'http://127.0.0.1').pathname.match(
      /^\/screencast-ws\/(tsk_ui_browser_[a-z_]+)$/,
    )?.[1];
    ws.localTaskId = taskId;
    sendFrame(ws);
    ws.on('message', (bytes) => {
      let msg;
      try {
        msg = JSON.parse(bytes.toString());
      } catch {
        return;
      }
      if (msg.type === 'input' && msg.payload?.type === 'viewport') sendFrame(ws);
      if (taskId)
        seed.requests.push({
          name: 'local.browser.input',
          input: { taskId, type: msg.payload?.type ?? msg.type },
        });
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    get seed() {
      return seed;
    },
    close: async () => {
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
