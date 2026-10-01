import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { isDeepStrictEqual } from 'node:util';
import { ingressDiagnosticError } from './browser-first-cutover-ingress-diagnostics.mjs';
import { createCutoverNginxIO } from './browser-first-cutover-nginx.mjs';
import { installPaymentPortFence, verifyPaymentPortFence } from './browser-payment-port-fence.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validDigest = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const fail = () => {
  throw new Error('CUTOVER_FENCE_UNPROVEN');
};
const routeKey = (r) => JSON.stringify([r.serverName, r.listen, r.selector]);

// First-cutover legacy adapters, pinned to reviewed, complete source bytes.
// Not a general nginx parser or proof that other vhosts/includes are isolated.
// The host still has to approve the complete inventory and safe replacement path.
const bridgeRoutes = [
  ['/api/payment/paypal/webhook', 'callback'],
  ['/api/internal/payment/confirm', 'callback'],
  ['/api/internal/partner-payment/confirm', 'callback'],
  ['/api/healthz', 'health'],
  ['/api/internal/payment/health', 'health'],
];
const siteProfiles = {
  'vultr-20260926': {
    digest: 'c2372d3ed03847c794e3e49501ee5890a12e9c2c876b95dfadeeee585340897f',
    serverName: 'holaday.ai',
    listens: ['[::]:443 ssl ipv6only=on default_server', '443 ssl default_server'],
    business: ['/api/', '/trpc/', '/healthz', '/ws', '/screencast-ws/', '/vnc-ws/', '/vnc/'],
    exceptions: [
      ...bridgeRoutes.map(([path, kind]) => ({ path, kind, from: '/api/', stripApi: true })),
      { path: '/healthz', kind: 'health', from: '/healthz' },
    ],
  },
  'aliyun-app-20260926': {
    digest: '65973c9afc53c484ce7e2becbe013de3622adeb6d77723a29cefd1ef6dfcec4c',
    serverName: 'hd-app.orangebench.tech',
    listens: ['443 ssl http2', '[::]:443 ssl http2'],
    business: ['/api/', '^~ /screencast-ws/', '^~ /vnc-ws/', '= /ws'],
    exceptions: bridgeRoutes.map(([path, kind]) => ({ path, kind, from: '/api/' })),
  },
  'aliyun-pay-20260926': {
    digest: 'ffe595e8fc106be4fc4148bc054e348dcc05d59c773efe30e7b090bdad590261',
    serverName: 'hd-pay.orangebench.tech',
    listens: ['443 ssl http2'],
    business: ['/'],
    exceptions: [
      { path: '/payment/wechat/notify', kind: 'callback', from: '/' },
      { path: '/payment/alipay/notify', kind: 'callback', from: '/' },
      { path: '/healthz', kind: 'health', from: '/' },
    ],
  },
};
function siteDescription(profile) {
  if (!Object.hasOwn(siteProfiles, profile)) fail();
  const p = siteProfiles[profile];
  return {
    profile,
    digest: p.digest,
    locations: p.listens.flatMap((listen) =>
      [
        ...p.business.map((selector) => ({ selector, kind: 'business' })),
        ...p.exceptions.map(({ path, kind }) => ({ selector: `= ${path}`, kind })),
      ].map((route) => ({ serverName: p.serverName, listen, ...route })),
    ),
  };
}

/** Describe only the three reviewed legacy site sources. A changed byte requires
 * a new review, not a caller-supplied digest override. No config is installed. */
export function describeCutoverSite(bytes, profile) {
  const description = siteDescription(profile);
  if (typeof bytes !== 'string' || digest(bytes) !== description.digest) fail();
  return description;
}
function validateSiteDescription(file) {
  const expected = siteDescription(file.profile);
  if (file.digest !== expected.digest || !isDeepStrictEqual(file.locations, expected.locations))
    fail();
}
const deny = '\n        add_header Cache-Control "no-store" always;\n        return 503;\n';
function generateSite(bytes, file, stage) {
  describeCutoverSite(bytes, file.profile);
  validateSiteDescription(file);
  const profile = siteProfiles[file.profile];
  const edits = [];
  const blocks = new Map();
  // Exact, flat proxy blocks in SHA-bound source only. Static regex locations,
  // maps, TLS includes, dual-stack listens and redirects are left byte-for-byte.
  for (const selector of profile.business) {
    const header = `    location ${selector} {`;
    const matches = [...bytes.matchAll(/^ {4}location [^\n]+ \{\n[\s\S]*?^ {4}\}/gm)].filter(
      (m) => m[0].startsWith(`${header}\n`) && /\n {8}proxy_pass /.test(m[0]),
    );
    if (matches.length !== 1) fail();
    const match = matches[0];
    const body = match[0].slice(header.length, -5);
    if (/[{}]/.test(body)) fail();
    blocks.set(selector, { body, at: match.index, insert: match.index + header.length });
    edits.push({ at: match.index + header.length, text: deny });
  }
  if ((bytes.match(/^ {8}proxy_pass /gm) ?? []).length !== blocks.size) fail();
  const extra = profile.exceptions
    .map(({ path, kind, from, stripApi }) => {
      let body = blocks.get(from)?.body;
      if (!body) fail();
      if (stripApi) {
        const upstream = 'proxy_pass http://127.0.0.1:4001/;';
        if (!body.includes(upstream)) fail();
        body = body.replace(upstream, `proxy_pass http://127.0.0.1:4001${path.slice(4)};`);
      }
      return `    location = ${path} {${kind === 'callback' && stage === 'all-writers' ? deny : ''}${body}    }\n\n`;
    })
    .join('');
  edits.push({ at: Math.min(...[...blocks.values()].map((b) => b.at)), text: extra });
  let generated = bytes;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    generated = generated.slice(0, edit.at) + edit.text + generated.slice(edit.at);
  return generated;
}

/** Narrow nginx subset, never regex rewriting a guessed server block. Unsupported
 * includes, regex/nested locations and response rewriting require explicit review.
 * Token offsets retain the exact original file for digest-bound insertions. */
function locations(bytes) {
  if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 1024 * 1024) fail();
  const tokens = [
    ...bytes.matchAll(/#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[{};]|[^\s{};#]+/g),
  ]
    .filter((m) => !m[0].startsWith('#'))
    .map((m) => ({ text: m[0], at: m.index }));
  let i = 0;
  function block(nested = false) {
    const items = [];
    while (i < tokens.length) {
      if (tokens[i].text === '}') {
        if (!nested) fail();
        i++;
        return items;
      }
      const words = [];
      while (i < tokens.length && ![';', '{', '}'].includes(tokens[i].text))
        words.push(tokens[i++].text);
      if (!words.length || i === tokens.length) fail();
      const end = tokens[i++];
      if (end.text === ';') items.push({ words });
      else if (end.text === '{') items.push({ words, insert: end.at + 1, body: block(true) });
      else fail();
    }
    if (nested) fail();
    return items;
  }
  const servers = block();
  const result = [];
  if (!servers.length) fail();
  for (const server of servers) {
    if (server.words.join(' ') !== 'server' || !server.body) fail();
    const names = server.body.filter((d) => d.words[0] === 'server_name');
    const listens = server.body.filter((d) => d.words[0] === 'listen');
    if (names.length !== 1 || names[0].words.length !== 2 || listens.length !== 1) fail();
    for (const node of server.body) {
      if (node.words[0] !== 'location') {
        if (
          node.body ||
          ![
            'listen',
            'server_name',
            'ssl_certificate',
            'ssl_certificate_key',
            'ssl_protocols',
            'ssl_ciphers',
            'ssl_prefer_server_ciphers',
            'access_log',
            'error_log',
            'client_max_body_size',
            'add_header',
          ].includes(node.words[0])
        )
          fail();
        continue;
      }
      const selector = node.words.slice(1).join(' ');
      if (!node.body || !/^(?:(?:=|\^~) )?\/[a-zA-Z0-9/_-]*$/.test(selector)) fail();
      for (const d of node.body)
        if (
          d.body ||
          [
            'include',
            'error_page',
            'rewrite',
            'try_files',
            'mirror',
            'auth_request',
            'proxy_intercept_errors',
          ].includes(d.words[0])
        )
          fail();
      result.push({
        serverName: names[0].words[1],
        listen: listens[0].words.slice(1).join(' '),
        selector,
        insert: node.insert,
      });
    }
  }
  if (!result.length || new Set(result.map(routeKey)).size !== result.length) fail();
  return result;
}
function generate(bytes, file, stage) {
  if (file.profile !== undefined) return generateSite(bytes, file, stage);
  const observed = locations(bytes);
  if (
    !Array.isArray(file.locations) ||
    file.locations.length !== observed.length ||
    new Set(file.locations.map(routeKey)).size !== observed.length
  )
    fail();
  const edits = [];
  for (const r of observed) {
    const match = file.locations.find((x) => routeKey(x) === routeKey(r));
    if (
      !match ||
      !['business', 'callback', 'health'].includes(match.kind) ||
      (match.kind === 'health' && !['= /health', '= /healthz'].includes(match.selector))
    )
      fail();
    if (match.kind === 'business' || (stage === 'all-writers' && match.kind === 'callback'))
      edits.push(r.insert);
  }
  let generated = bytes;
  for (const at of edits.sort((a, b) => b - a))
    generated = `${generated.slice(0, at)}\n add_header Cache-Control "no-store" always;\n return 503;\n${generated.slice(at)}`;
  return generated;
}
/** Actual local TLS probes for the three reviewed sites, not a writer detector.
 * The site adapter must supply its current physical/business writer observation.
 * No credentials, valid payment signature, remote destination or redirect follow.
 */
export async function probeCutoverIngress(approval, stage, overrides = {}) {
  const io = { now: Date.now, request: httpsRequest, ...overrides };
  const reject = (stage = 'PROBE_ENTRY', previous) => {
    throw ingressDiagnosticError('CUTOVER_INGRESS_PROBE_UNPROVEN', stage, previous);
  };
  try {
    const scope = structuredClone(approval);
    const began = io.now();
    if (
      !Number.isSafeInteger(began) ||
      began < 0 ||
      !['orders', 'all-writers'].includes(stage) ||
      !validDigest(scope?.inventoryDigest) ||
      !Array.isArray(scope.unknownIngress) ||
      scope.unknownIngress.length ||
      !Array.isArray(scope.files) ||
      !scope.files.length ||
      scope.files.length > 3 ||
      new Set(scope.files.map((f) => f.profile)).size !== scope.files.length ||
      typeof io.observeWriters !== 'function'
    )
      reject();
    const paths = {
      'vultr-20260926': 'holaday',
      'aliyun-app-20260926': 'hd-app.orangebench.tech',
      'aliyun-pay-20260926': 'hd-pay.orangebench.tech',
    };
    for (const file of scope.files) {
      validateSiteDescription(file);
      if (file.path !== `/etc/nginx/sites-available/${paths[file.profile]}`) reject();
    }
    let lastTime = began;
    const clock = () => {
      const now = io.now();
      if (!Number.isSafeInteger(now) || now < lastTime || now - began > 60000)
        reject('PROBE_CLOCK');
      lastTime = now;
      return now;
    };
    const counts = ['existingSockets', 'internalWriters', 'producersRunning'];
    const writers = async () => {
      let observed;
      try {
        observed = structuredClone(await io.observeWriters());
      } catch (error) {
        reject('PROBE_WRITER_READ', error);
      }
      const now = clock();
      if (
        observed?.inventoryDigest !== scope.inventoryDigest ||
        !Number.isSafeInteger(observed.observedAtMs) ||
        observed.observedAtMs < 0 ||
        observed.observedAtMs > now ||
        now - observed.observedAtMs > 60000 ||
        counts.some((k) => !Number.isSafeInteger(observed[k]) || observed[k] < 0)
      )
        reject('PROBE_WRITER_SHAPE');
      return observed;
    };
    const before = await writers();
    const targets = scope.files.flatMap((file) =>
      file.locations.filter((r) => r.kind !== 'health').map((route) => ({ file, route })),
    );
    const observe = ({ file, route }) =>
      new Promise((resolve, rejectRequest) => {
        let req;
        let timer;
        let finished = false;
        const finish = (error, value, previous) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (error) {
            req?.destroy();
            rejectRequest(
              ingressDiagnosticError('CUTOVER_INGRESS_PROBE_UNPROVEN', error, previous),
            );
          } else resolve(value);
        };
        try {
          clock();
          const literal = route.selector.replace(/^(?:=|\^~) /, '');
          const ws =
            route.kind === 'business' && ['/ws', '/screencast-ws/', '/vnc-ws/'].includes(literal);
          const uri =
            route.kind === 'business' && !route.selector.startsWith('= ') && literal !== '/ws'
              ? `${literal}__holaday_cutover_probe__`
              : literal;
          const headers = {
            host: route.serverName,
            'cache-control': 'no-cache',
            connection: ws ? 'Upgrade' : 'close',
            ...(ws
              ? {
                  upgrade: 'websocket',
                  'sec-websocket-version': '13',
                  'sec-websocket-key': randomBytes(16).toString('base64'),
                }
              : { 'content-type': 'application/json', 'content-length': '2' }),
          };
          req = io.request(
            {
              hostname: route.listen.startsWith('[::]') ? '::1' : '127.0.0.1',
              port: 443,
              servername: route.serverName,
              rejectUnauthorized: true,
              agent: false,
              path: uri,
              method: ws ? 'GET' : 'POST',
              headers,
            },
            (res) => {
              let bytes = 0;
              res.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > 65536) {
                  res.destroy();
                  finish('PROBE_BODY');
                }
              });
              res.once('aborted', () => finish(bytes > 65536 ? 'PROBE_BODY' : 'PROBE_RESPONSE'));
              res.once('error', () => finish(bytes > 65536 ? 'PROBE_BODY' : 'PROBE_RESPONSE'));
              res.once('end', () => {
                if (
                  !res.complete ||
                  !Number.isInteger(res.statusCode) ||
                  res.statusCode < 100 ||
                  res.statusCode > 599
                )
                  return finish('PROBE_RESPONSE');
                const cache = res.headers['cache-control'];
                finish(null, {
                  ...route,
                  path: file.path,
                  status: res.statusCode,
                  noStore:
                    typeof cache === 'string' &&
                    cache
                      .toLowerCase()
                      .split(',')
                      .some((v) => v.trim() === 'no-store'),
                });
              });
            },
          );
          req.once('error', () => finish('PROBE_REQUEST'));
          req.once('upgrade', (_res, socket) => {
            socket.destroy();
            finish('PROBE_UPGRADE');
          });
          timer = setTimeout(() => finish('PROBE_TIMEOUT'), 5000);
          timer.unref?.();
          req.end(ws ? undefined : '{}');
        } catch (error) {
          finish('PROBE_REQUEST', undefined, error);
        }
      });
    // Await every bounded request before exposing a result/error. No half-success,
    // detached socket, automatic retry, or caller-controlled concurrency target.
    const results = await Promise.allSettled(targets.map(observe));
    if (results.some((r) => r.status !== 'fulfilled'))
      reject('PROBE_SETTLED', results.find((r) => r.status !== 'fulfilled').reason);
    const after = await writers();
    if (counts.some((k) => before[k] !== after[k])) reject('PROBE_WRITER_DRIFT');
    clock();
    return {
      inventoryDigest: scope.inventoryDigest,
      observedAtMs: Math.min(began, before.observedAtMs, after.observedAtMs),
      ...Object.fromEntries(counts.map((k) => [k, after[k]])),
      probes: results.map((r) => r.value),
    };
  } catch (error) {
    reject('PROBE_ENTRY', error);
  }
}

async function context(input, io) {
  if (!validDigest(input.inventoryDigest)) fail();
  const binding = await io.assertJournalOwnership();
  if (
    binding.inventoryDigest !== input.inventoryDigest ||
    !/^[a-f0-9-]{36}$/.test(binding.attempt ?? '')
  )
    fail();
  const approval = await io.readApprovedIngress();
  if (
    approval?.inventoryDigest !== input.inventoryDigest ||
    !Array.isArray(approval.unknownIngress) ||
    approval.unknownIngress.length ||
    !Array.isArray(approval.files) ||
    !approval.files.length ||
    new Set(approval.files.map((f) => f.path)).size !== approval.files.length
  )
    fail();
  for (const f of approval.files)
    if (
      !/^\/etc\/nginx\/(?:conf.d|sites-available)\/[a-zA-Z0-9._-]+$/.test(f.path) ||
      !validDigest(f.digest)
    )
      fail();
  for (const f of approval.files) if (f.profile !== undefined) validateSiteDescription(f);
  return { binding, approval };
}
function checkReceipt(r, binding, approval) {
  if (
    r?.attempt !== binding.attempt ||
    r.inventoryDigest !== binding.inventoryDigest ||
    r.phase !== 'active' ||
    !['orders', 'all-writers'].includes(r.stage) ||
    !Array.isArray(r.files) ||
    r.files.length !== approval.files.length
  )
    fail();
  for (const f of approval.files) {
    const found = r.files.filter((p) => p.path === f.path && p.originalDigest === f.digest);
    if (
      found.length !== 1 ||
      !validDigest(found[0].generatedDigest) ||
      found[0].backupDigest !== f.digest
    )
      fail();
  }
}

async function paymentPorts(binding, approval, stage, io, install = false) {
  if (!approval.files.some((f) => f.profile === 'aliyun-pay-20260926')) return;
  await (install ? installPaymentPortFence : verifyPaymentPortFence)(
    { binding, stage },
    {
      ...io.paymentPortFence,
      now: io.now,
      assertJournalOwnership: io.assertJournalOwnership,
      readFenceReceipt: io.readFenceReceipt,
    },
  );
}

function nginxIO(io, binding) {
  if (typeof io.testNginx === 'function' && typeof io.reloadNginx === 'function') return io;
  if (io.testNginx !== undefined || io.reloadNginx !== undefined) fail();
  return {
    ...io,
    ...createCutoverNginxIO(
      { binding, maintenanceEndsAtMs: io.nginx?.maintenanceEndsAtMs },
      {
        ...io.nginx,
        now: io.now,
        assertJournalOwnership: io.assertJournalOwnership,
        readFenceReceipt: io.readFenceReceipt,
      },
    ),
  };
}

/** IO is the root host adapter: fixed protected backups/receipt, compare-and-swap
 * file replacement, actual nginx -t/reload, and invalid-signature HTTP probes.
 * There is no arbitrary config-upload or success-boolean CLI. */
export async function applyCutoverFence(input, overrides) {
  try {
    if (!['orders', 'all-writers'].includes(input.stage)) fail();
    const { binding, approval } = await context(input, overrides);
    const io = nginxIO(overrides, binding);
    const previous = await io.readFenceReceipt();
    if (input.stage === 'orders') {
      if (previous) fail();
    } else {
      checkReceipt(previous, binding, approval);
      if (previous.stage !== 'orders') fail();
    }
    const files = [];
    // Validate every file before writing any file or backup.
    for (const f of approval.files) {
      const bytes = await io.readConfig(f.path);
      const old = previous?.files.find((p) => p.path === f.path);
      const expected = old?.generatedDigest ?? f.digest;
      if (digest(bytes) !== expected) fail();
      const original = old ? await io.readBackup(old) : bytes;
      if (digest(original) !== f.digest) fail();
      const generated = generate(original, f, input.stage);
      files.push({
        path: f.path,
        originalDigest: f.digest,
        generatedDigest: digest(generated),
        backupDigest: f.digest,
        original,
        generated,
        expected,
      });
    }
    for (const f of files)
      if (!previous && (await io.backupOriginal(f, f.original)) !== f.backupDigest) fail();
    const receipt = {
      schemaVersion: 1,
      attempt: binding.attempt,
      inventoryDigest: input.inventoryDigest,
      stage: input.stage,
      files: files.map(({ path, originalDigest, generatedDigest, backupDigest }) => ({
        path,
        originalDigest,
        generatedDigest,
        backupDigest,
      })),
    };
    await io.persistFenceReceipt({ ...receipt, phase: 'installing' });
    await paymentPorts(binding, approval, input.stage, io, input.stage === 'orders');
    for (const f of files) {
      await context(input, io);
      await io.replaceConfig(f.path, f.expected, f.generated);
    }
    await io.testNginx();
    await context(input, io);
    for (const f of files) if (digest(await io.readConfig(f.path)) !== f.generatedDigest) fail();
    await io.reloadNginx();
    await io.persistFenceReceipt({ ...receipt, phase: 'active' });
    return await verifyCutoverFence(input, io);
  } catch {
    throw new Error('CUTOVER_FENCE_UNPROVEN');
  }
}

export async function verifyCutoverFence(input, io) {
  let stage = 'FENCE_CONTEXT';
  try {
    const { binding, approval } = await context(input, io);
    stage = 'FENCE_RECEIPT';
    const receipt = await io.readFenceReceipt();
    checkReceipt(receipt, binding, approval);
    if (receipt.stage !== input.stage) fail();
    stage = 'FENCE_PORTS_BEFORE';
    await paymentPorts(binding, approval, input.stage, io);
    stage = 'FENCE_CONFIG';
    for (const f of receipt.files)
      if (digest(await io.readConfig(f.path)) !== f.generatedDigest) fail();
    stage = 'FENCE_PROBE';
    const results =
      typeof io.probeIngress === 'function'
        ? await io.probeIngress(approval, input.stage)
        : await probeCutoverIngress(approval, input.stage, { ...io.ingressProbe, now: io.now });
    stage = 'FENCE_RESULT';
    const now = io.now();
    if (
      results?.inventoryDigest !== input.inventoryDigest ||
      !Number.isSafeInteger(results.observedAtMs) ||
      results.observedAtMs > now ||
      now - results.observedAtMs > 60000 ||
      !Array.isArray(results.probes)
    )
      fail();
    stage = 'FENCE_TARGETS';
    const required = approval.files.flatMap((f) =>
      f.locations.filter((r) => r.kind !== 'health').map((r) => ({ ...r, path: f.path })),
    );
    if (results.probes.length !== required.length) fail();
    for (const r of required) {
      stage = 'FENCE_ROUTE';
      const p = results.probes.filter((v) => v.path === r.path && routeKey(v) === routeKey(r));
      if (p.length !== 1) fail();
      stage = 'FENCE_STATUS';
      const blocked = r.kind === 'business' || input.stage === 'all-writers';
      if (
        blocked
          ? p[0].status !== 503 || p[0].noStore !== true
          : ![400, 401, 403].includes(p[0].status)
      )
        fail();
    }
    stage = 'FENCE_WRITERS';
    if (
      input.stage === 'all-writers' &&
      ['existingSockets', 'internalWriters', 'producersRunning'].some((k) => results[k] !== 0)
    )
      fail();
    stage = 'FENCE_PORTS_AFTER';
    await paymentPorts(binding, approval, input.stage, io);
    return {
      inventoryDigest: input.inventoryDigest,
      stage: input.stage,
      observedAtMs: results.observedAtMs,
      existingSockets: results.existingSockets,
      internalWriters: results.internalWriters,
      producersRunning: results.producersRunning,
    };
  } catch (error) {
    throw ingressDiagnosticError('CUTOVER_FENCE_UNPROVEN', stage, error);
  }
}

export async function restoreCutoverIngress({ inventoryDigest, identity }, overrides) {
  try {
    if (
      !/^[a-f0-9]{40}$/.test(identity?.candidate ?? '') ||
      !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '')
    )
      fail();
    const { binding, approval } = await context({ inventoryDigest }, overrides);
    const io = nginxIO(overrides, binding);
    const receipt = await io.readFenceReceipt();
    checkReceipt(receipt, binding, approval);
    if (receipt.stage !== 'all-writers') fail();
    await paymentPorts(binding, approval, 'all-writers', io);
    const opened = await io.verifyOpenedIdentity(identity);
    if (!isDeepStrictEqual(opened?.identity, identity) || opened.mode !== 'serving') fail();
    const restore = [];
    for (const f of receipt.files) {
      if (digest(await io.readConfig(f.path)) !== f.generatedDigest) fail();
      const original = await io.readBackup(f);
      if (digest(original) !== f.originalDigest) fail();
      restore.push({ ...f, original });
    }
    await io.persistFenceReceipt({ ...receipt, identity, phase: 'restoring' });
    for (const f of restore) {
      await context({ inventoryDigest }, io);
      await io.replaceConfig(f.path, f.generatedDigest, f.original);
    }
    await io.testNginx();
    await context({ inventoryDigest }, io);
    for (const f of restore) if (digest(await io.readConfig(f.path)) !== f.originalDigest) fail();
    await io.reloadNginx();
    await io.persistFenceReceipt({ ...receipt, identity, phase: 'restored' });
    await paymentPorts(binding, approval, 'all-writers', io);
  } catch {
    throw new Error('CUTOVER_FENCE_UNPROVEN');
  }
}
