import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { BrowserEgressProxy } from '../src/browser-pool/egress-proxy.js';

const privateTarget = createServer((_req, res) => {
  privateTargetReached = true;
  res.end('private target reached');
});
let privateTargetReached = false;

await new Promise<void>((resolve, reject) => {
  privateTarget.once('error', reject);
  privateTarget.listen(0, '127.0.0.1', resolve);
});

const targetAddress = privateTarget.address();
if (!targetAddress || typeof targetAddress === 'string') {
  throw new Error('private smoke target did not start');
}

const proxy = new BrowserEgressProxy();
const proxyServer = await proxy.start();
const browser = await chromium.launch({
  ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}),
  headless: true,
  proxy: { server: proxyServer },
  args: [
    '--proxy-bypass-list=<-loopback>',
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ],
});

try {
  const page = await browser.newPage();
  await page.goto('https://example.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  if (!page.url().startsWith('https://example.com')) {
    throw new Error(`public navigation landed on unexpected URL: ${page.url()}`);
  }

  let privateBlocked = false;
  try {
    const response = await page.goto(`http://127.0.0.1:${targetAddress.port}/secret`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    privateBlocked = response?.status() === 403;
  } catch {
    privateBlocked = true;
  }
  if (!privateBlocked || privateTargetReached) {
    throw new Error(
      `private target guard failed (blocked=${privateBlocked}, reached=${privateTargetReached})`,
    );
  }

  process.stdout.write(
    JSON.stringify({ publicNavigation: 'ok', privateNetwork: 'blocked' }) + '\n',
  );
} finally {
  process.stderr.write('[browser-egress-smoke] closing browser\n');
  await browser.close();
  process.stderr.write('[browser-egress-smoke] closing proxy\n');
  await proxy.close();
  process.stderr.write('[browser-egress-smoke] closing private target\n');
  privateTarget.closeAllConnections?.();
  await new Promise<void>((resolve) => privateTarget.close(() => resolve()));
  process.stderr.write('[browser-egress-smoke] cleanup complete\n');
}
