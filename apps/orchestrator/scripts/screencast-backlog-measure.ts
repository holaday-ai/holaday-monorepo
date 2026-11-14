/**
 * STREAM-1 step 1 (G2h) — local measurement of screencast backlog on a slow viewer link.
 * Local only: no credentials, DB, models or production. Every server it starts is closed at exit.
 *
 * Path measured: real headless Chromium → real createScreencastProxy (→ CdpStreamer) → a TCP
 * "link" that limits throughput and adds one-way latency → a WebSocket viewer.
 *
 * The page paints Date.now() as a 2×24-bit black/white code (value + complement as a check) every
 * animation frame, plus changing content so JPEGs are of realistic size. The viewer decodes the
 * code from each frame it receives: frame age = receive time − time the page painted it.
 *
 *   pnpm exec tsx scripts/screencast-backlog-measure.ts
 *   env: MODE=legacy|v2 (default legacy)  RATE_KBIT=1500 (0 = no limit)  LATENCY_MS=60 (one way)
 *        DURATION_S=60  LINK_BUFFER_KB=64  OUT=/path/result.json
 */
// Placeholder env only (no DB / Redis is ever contacted): must load before src/config/env.ts.
import '../vitest.setup.js';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { pino } from 'pino';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { WebSocket } from 'ws';
import type { BrowserInstance } from '../src/browser-pool/types.js';
import { CdpStreamer } from '../src/streaming/cdp-streamer.js';
import { createScreencastProxy } from '../src/streaming/screencast-proxy.js';

const MODE = process.env.MODE === 'v2' ? 'v2' : 'legacy';
const RATE_KBIT = Number(process.env.RATE_KBIT ?? 1500);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 60);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const LINK_BUFFER = Number(process.env.LINK_BUFFER_KB ?? 64) * 1024;
const OUT = process.env.OUT;
const BITS = 24;
const CELL = 24;

const T0 = Date.now();
const PAGE = `<!doctype html><style>html,body{margin:0;overflow:hidden;background:#fff}</style>
<canvas id=c width=1280 height=800></canvas><script>
const T0=${T0},B=${BITS},S=${CELL},c=document.getElementById('c'),g=c.getContext('2d');
let n=0;
function draw(){
  n++;
  const t=Date.now()-T0;
  g.fillStyle='hsl('+(n%360)+',40%,92%)';g.fillRect(0,0,1280,800);
  // Changing article-like content: text lines and boxes so a frame is a realistic JPEG.
  for(let i=0;i<34;i++){
    const y=70+i*21;
    g.fillStyle='hsl('+((i*37+n*3)%360)+',55%,45%)';
    g.fillRect(40+((n*4+i*29)%200),y,160+((i*53)%300),14);
    g.fillStyle='#222';g.font='15px sans-serif';
    g.fillText('Line '+i+' frame '+n+' — the quick brown fox jumps over the lazy dog '+(t%9973),420,y+12);
  }
  for(let k=0;k<B;k++){
    const bit=(t>>k)&1;
    g.fillStyle=bit?'#000':'#fff';g.fillRect(k*S,0,S,S);
    g.fillStyle=bit?'#fff':'#000';g.fillRect(k*S,S,S,S);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>`;

async function decodePaintedAt(jpegBase64: string): Promise<number | null> {
  const img = sharp(Buffer.from(jpegBase64, 'base64'));
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / 1280;
  const lum = (x: number, y: number) => {
    const at = (Math.round(y * scale) * info.width + Math.round(x * scale)) * info.channels;
    return (data[at]! + data[at + 1]! + data[at + 2]!) / 3;
  };
  let t = 0;
  for (let k = 0; k < BITS; k++) {
    const top = lum(k * CELL + CELL / 2, CELL / 2) < 128;
    const bottom = lum(k * CELL + CELL / 2, CELL + CELL / 2) < 128;
    if (top === bottom) return null; // torn or unreadable
    if (top) t |= 1 << k;
  }
  // 24 bits wrap every ~4.6 h; runs are minutes long.
  return T0 + t;
}

/** A one-direction shaped link: token bucket at RATE_KBIT, fixed one-way latency, bounded queue. */
function shapedPipe(from: net.Socket, to: net.Socket, rateKbit: number, stats: { bytes: number }) {
  const queue: Array<{ at: number; buf: Buffer }> = [];
  let queued = 0;
  let credit = 0;
  let last = performance.now();
  const bytesPerMs = rateKbit > 0 ? (rateKbit * 1000) / 8 / 1000 : Number.POSITIVE_INFINITY;
  from.on('data', (buf: Buffer) => {
    queue.push({ at: performance.now() + LATENCY_MS, buf });
    queued += buf.length;
    if (queued > LINK_BUFFER) from.pause();
  });
  const timer = setInterval(() => {
    const now = performance.now();
    credit = Math.min(credit + (now - last) * bytesPerMs, 64 * 1024 + bytesPerMs * 10);
    last = now;
    while (queue.length && queue[0]!.at <= now && credit > 0) {
      const head = queue[0]!;
      const take = Math.min(head.buf.length, Math.floor(credit) || 1);
      const chunk = head.buf.subarray(0, take);
      if (take === head.buf.length) queue.shift();
      else head.buf = head.buf.subarray(take);
      credit -= take;
      queued -= take;
      stats.bytes += take;
      to.write(chunk);
    }
    if (queued <= LINK_BUFFER / 2 && from.isPaused()) from.resume();
  }, 2);
  const end = () => {
    clearInterval(timer);
    to.destroy();
  };
  from.on('close', end);
  from.on('error', end);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(PAGE);

const taskId = 'tsk_backlog_measure';
const instance = {
  taskId,
  userId: 'usr_fixture',
  index: 0,
  status: 'ready',
  capabilities: { viewportV2: MODE === 'v2', observationV2: false, replayV1: false },
  executor: { getPage: async () => page },
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
} as unknown as BrowserInstance;
const pool = {
  touch: () => {},
  peek: (id: string) => (id === taskId ? instance : null),
  peekActiveForUser: () => instance,
  peekBrowserHome: () => null,
  release: async () => {},
};
const logger = pino({ level: process.env.TRACE ? 'debug' : 'silent' });
const proxy = createScreencastProxy({
  pool: pool as never,
  logger,
  authenticateToken: async (token) => (token === 'local-fixture-only' ? 'usr_fixture' : null),
});

// Server side: count what the streamer hands to the socket and how much it keeps buffered.
const serverSide = { sentFrames: 0, sentBytes: 0, maxBuffered: 0, ws: null as WebSocket | null };
const server: Server = createServer();
server.on('upgrade', (req, socket, head) => proxy.handleUpgrade(req, socket, head));
// Only the server sends frame messages: count them (and find the server socket) at ws.send.
const origSend = WebSocket.prototype.send;
WebSocket.prototype.send = function patched(this: WebSocket, data: unknown, ...rest: unknown[]) {
  if (typeof data === 'string' && data.startsWith('{"type":"frame"')) {
    serverSide.ws = this;
    serverSide.sentFrames += 1;
    serverSide.sentBytes += data.length;
  }
  return (origSend as (...a: unknown[]) => void).call(this, data, ...rest);
} as typeof WebSocket.prototype.send;
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const serverPort = (server.address() as net.AddressInfo).port;

const link = { down: { bytes: 0 }, up: { bytes: 0 } };
const linkServer = net.createServer((client) => {
  const upstream = net.connect(serverPort, '127.0.0.1');
  shapedPipe(upstream, client, RATE_KBIT, link.down);
  shapedPipe(client, upstream, 0, link.up);
});
await new Promise<void>((r) => linkServer.listen(0, '127.0.0.1', r));
const linkPort = (linkServer.address() as net.AddressInfo).port;

// Frames Chromium delivers to the streamer: listen on each CDP session it opens.
let chromeFrames = 0;
const origStart = CdpStreamer.prototype.start;
CdpStreamer.prototype.start = async function counted(this: CdpStreamer) {
  await origStart.call(this);
  this.getSession()?.on('Page.screencastFrame', () => {
    chromeFrames += 1;
  });
};
type Sample = { at: number; age: number; bytes: number };
const samples: Sample[] = [];
let unreadable = 0;
const decodeQueue: Array<{ at: number; data: string; bytes: number }> = [];
let decoding = false;
async function drainDecode(): Promise<void> {
  if (decoding) return;
  decoding = true;
  while (decodeQueue.length) {
    const item = decodeQueue.shift()!;
    const paintedAt = await decodePaintedAt(item.data).catch(() => null);
    if (paintedAt === null) unreadable++;
    else samples.push({ at: item.at - T0, age: item.at - paintedAt, bytes: item.bytes });
  }
  decoding = false;
}

const query = MODE === 'v2' ? '?viewportV2=1' : '';
const viewer: WebSocket = new WebSocket(
  `ws://127.0.0.1:${linkPort}/screencast-ws/${taskId}${query}`,
  ['bearer.local-fixture-only'],
);
viewer.on('message', (raw) => {
  const at = Date.now();
  const text = raw.toString();
  if (!text.startsWith('{"type":"frame"')) return;
  const msg = JSON.parse(text) as { data: string };
  decodeQueue.push({ at, data: msg.data, bytes: text.length });
  void drainDecode();
});
await new Promise<void>((resolve, reject) => {
  viewer.once('open', () => resolve());
  viewer.once('error', reject);
});

const buffered: Array<{ at: number; buffered: number; inLink: number }> = [];
const poll = setInterval(() => {
  const b = serverSide.ws?.bufferedAmount ?? 0;
  serverSide.maxBuffered = Math.max(serverSide.maxBuffered, b);
}, 50);
const second = setInterval(() => {
  const ws = serverSide.ws;
  buffered.push({
    at: Date.now() - T0,
    buffered: ws?.bufferedAmount ?? 0,
    inLink: serverSide.sentBytes - link.down.bytes,
  });
}, 1000);
const started = Date.now();
await new Promise((r) => setTimeout(r, DURATION_S * 1000));
const elapsed = (Date.now() - started) / 1000;
clearInterval(poll);
clearInterval(second);
viewer.terminate();
await new Promise((r) => setTimeout(r, 200));
await browser.close();
linkServer.close();
server.close();
WebSocket.prototype.send = origSend;

function pct(xs: number[], p: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
const windows: Array<Record<string, number>> = [];
for (let w = 0; w < Math.ceil(DURATION_S / 10); w++) {
  const inW = samples.filter((s) => s.at >= w * 10_000 && s.at < (w + 1) * 10_000);
  const snap = buffered.filter((b) => b.at >= w * 10_000 && b.at < (w + 1) * 10_000).at(-1);
  windows.push({
    fromS: w * 10,
    frames: inW.length,
    ageP50: pct(
      inW.map((s) => s.age),
      50,
    ),
    ageP95: pct(
      inW.map((s) => s.age),
      95,
    ),
    ageMax: inW.length ? Math.max(...inW.map((s) => s.age)) : Number.NaN,
    serverBufferedKB: Math.round((snap?.buffered ?? 0) / 1024),
    notYetDeliveredKB: Math.round((snap?.inLink ?? 0) / 1024),
  });
}
const result = {
  mode: MODE,
  rateKbit: RATE_KBIT,
  latencyMsOneWay: LATENCY_MS,
  linkBufferKB: LINK_BUFFER / 1024,
  durationS: elapsed,
  framesSentByServer: serverSide.sentFrames,
  framesReceivedByViewer: samples.length + unreadable + decodeQueue.length,
  framesDecoded: samples.length,
  unreadable,
  serverSentMB: +(serverSide.sentBytes / 1e6).toFixed(2),
  deliveredMB: +(link.down.bytes / 1e6).toFixed(2),
  avgFrameKB: serverSide.sentFrames
    ? Math.round(serverSide.sentBytes / serverSide.sentFrames / 1024)
    : 0,
  maxServerBufferedKB: Math.round(serverSide.maxBuffered / 1024),
  ageP50: pct(
    samples.map((s) => s.age),
    50,
  ),
  ageP95: pct(
    samples.map((s) => s.age),
    95,
  ),
  ageMax: samples.length ? Math.max(...samples.map((s) => s.age)) : Number.NaN,
  chromeFrames,
  framesDroppedBeforeSend: chromeFrames - serverSide.sentFrames,
  windows,
};
console.log(JSON.stringify(result, null, 2));
if (OUT) await writeFile(OUT, JSON.stringify(result, null, 2));
process.exit(0);
