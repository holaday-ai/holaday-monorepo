import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validDigest = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const fail = () => {
  throw new Error('CUTOVER_FENCE_UNPROVEN');
};
const routeKey = (r) => JSON.stringify([r.serverName, r.listen, r.selector]);

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

/** IO is the root host adapter: fixed protected backups/receipt, compare-and-swap
 * file replacement, actual nginx -t/reload, and invalid-signature HTTP probes.
 * There is no arbitrary config-upload or success-boolean CLI. */
export async function applyCutoverFence(input, io) {
  try {
    if (!['orders', 'all-writers'].includes(input.stage)) fail();
    const { binding, approval } = await context(input, io);
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
  try {
    const { binding, approval } = await context(input, io);
    const receipt = await io.readFenceReceipt();
    checkReceipt(receipt, binding, approval);
    if (receipt.stage !== input.stage) fail();
    for (const f of receipt.files)
      if (digest(await io.readConfig(f.path)) !== f.generatedDigest) fail();
    const results = await io.probeIngress(approval, input.stage);
    const now = io.now();
    if (
      results?.inventoryDigest !== input.inventoryDigest ||
      !Number.isSafeInteger(results.observedAtMs) ||
      results.observedAtMs > now ||
      now - results.observedAtMs > 60000 ||
      !Array.isArray(results.probes)
    )
      fail();
    const required = approval.files.flatMap((f) =>
      f.locations.filter((r) => r.kind !== 'health').map((r) => ({ ...r, path: f.path })),
    );
    if (results.probes.length !== required.length) fail();
    for (const r of required) {
      const p = results.probes.filter((v) => v.path === r.path && routeKey(v) === routeKey(r));
      if (p.length !== 1) fail();
      const blocked = r.kind === 'business' || input.stage === 'all-writers';
      if (
        blocked
          ? p[0].status !== 503 || p[0].noStore !== true
          : ![400, 401, 403].includes(p[0].status)
      )
        fail();
    }
    if (
      input.stage === 'all-writers' &&
      ['existingSockets', 'internalWriters', 'producersRunning'].some((k) => results[k] !== 0)
    )
      fail();
    return {
      inventoryDigest: input.inventoryDigest,
      stage: input.stage,
      observedAtMs: results.observedAtMs,
      existingSockets: results.existingSockets,
      internalWriters: results.internalWriters,
      producersRunning: results.producersRunning,
    };
  } catch {
    throw new Error('CUTOVER_FENCE_UNPROVEN');
  }
}

export async function restoreCutoverIngress({ inventoryDigest, identity }, io) {
  try {
    if (
      !/^[a-f0-9]{40}$/.test(identity?.candidate ?? '') ||
      !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '')
    )
      fail();
    const { binding, approval } = await context({ inventoryDigest }, io);
    const receipt = await io.readFenceReceipt();
    checkReceipt(receipt, binding, approval);
    if (receipt.stage !== 'all-writers') fail();
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
  } catch {
    throw new Error('CUTOVER_FENCE_UNPROVEN');
  }
}
