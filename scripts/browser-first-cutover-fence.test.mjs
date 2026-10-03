import { installPaymentPortFence, verifyPaymentPortFence } from './browser-payment-port-fence.mjs';
import {
  ingressDiagnosticError,
  ingressDiagnosticStage,
} from './browser-first-cutover-ingress-diagnostics.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  applyCutoverFence,
  describeCutoverSite,
  restoreCutoverIngress,
  verifyCutoverFence,
} from './browser-first-cutover-fence.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const original = `server {
 listen 127.0.0.1:8080;
 server_name fixture.local;
 location /api/ { proxy_pass http://127.0.0.1:4001; }
 location = /payment/notify { proxy_pass http://127.0.0.1:4010; }
 location = /health { return 200; }
}\n`;
const digest = 'a'.repeat(64);
const paymentTable = {
  nftables: [
    { table: { family: 'inet', name: 'holaday_payment_ingress', handle: 1 } },
    {
      chain: {
        family: 'inet',
        table: 'holaday_payment_ingress',
        name: 'input',
        handle: 1,
        type: 'filter',
        hook: 'input',
        prio: -10,
        policy: 'accept',
      },
    },
    {
      rule: {
        family: 'inet',
        table: 'holaday_payment_ingress',
        chain: 'input',
        handle: 3,
        expr: [
          { match: { op: '!=', left: { meta: { key: 'iifname' } }, right: 'lo' } },
          {
            match: {
              op: '==',
              left: { payload: { protocol: 'tcp', field: 'dport' } },
              right: { set: [4010, 4011] },
            },
          },
          { reject: { type: 'tcp reset' } },
        ],
      },
    },
  ],
};
function fixture(site) {
  let bytes = site?.bytes ?? original;
  let receipt;
  let backup;
  const events = [];
  let networkInstalled = false;
  const input = { inventoryDigest: digest, stage: 'orders' };
  const file = {
    path: '/etc/nginx/conf.d/holaday.conf',
    digest: hash(original),
    locations: [
      {
        serverName: 'fixture.local',
        listen: '127.0.0.1:8080',
        selector: '/api/',
        kind: 'business',
      },
      {
        serverName: 'fixture.local',
        listen: '127.0.0.1:8080',
        selector: '= /payment/notify',
        kind: 'callback',
      },
      {
        serverName: 'fixture.local',
        listen: '127.0.0.1:8080',
        selector: '= /health',
        kind: 'health',
      },
    ],
  };
  if (site) Object.assign(file, describeCutoverSite(site.bytes, site.profile));
  const io = {
    paymentPortFence: {
      platform: 'linux',
      uid: 0,
      execNft: async (args) => {
        if (args.includes('ruleset'))
          return JSON.stringify(networkInstalled ? paymentTable : { nftables: [] });
        if (args.includes('table'))
          return JSON.stringify(networkInstalled ? paymentTable : { nftables: [] });
        if (args.includes('--check')) {
          events.push('network-check');
          return '';
        }
        assert.deepEqual(args, ['-f', '-']);
        events.push('network-install');
        networkInstalled = true;
        return '';
      },
    },
    now: () => 1000,
    assertJournalOwnership: async () => ({
      inventoryDigest: digest,
      attempt: '11111111-1111-4111-8111-111111111111',
    }),
    readApprovedIngress: async () => ({
      inventoryDigest: digest,
      unknownIngress: [],
      files: [structuredClone(file)],
    }),
    readConfig: async (p) => {
      assert.equal(p, file.path);
      return bytes;
    },
    readFenceReceipt: async () => receipt,
    backupOriginal: async (_f, b) => {
      events.push('backup');
      backup = b;
      return hash(b);
    },
    readBackup: async () => backup,
    replaceConfig: async (p, expected, b) => {
      assert.equal(p, file.path);
      assert.equal(hash(bytes), expected);
      events.push('replace');
      bytes = b;
    },
    testNginx: async () => {
      events.push('test');
    },
    reloadNginx: async () => {
      events.push('reload');
    },
    persistFenceReceipt: async (r) => {
      events.push(`receipt:${r.phase}`);
      receipt = structuredClone(r);
    },
    probeIngress: async () => ({
      observedAtMs: 1000,
      inventoryDigest: digest,
      probes: file.locations
        .filter((r) => r.kind !== 'health')
        .map((r) => ({
          ...r,
          path: file.path,
          status: r.kind === 'business' || receipt?.stage === 'all-writers' ? 503 : 400,
          noStore: true,
        })),
      existingSockets: 0,
      internalWriters: 0,
      producersRunning: 0,
    }),
    verifyOpenedIdentity: async (id) => ({ identity: id, mode: 'serving' }),
  };
  return {
    io,
    input,
    events,
    file,
    bytes: () => bytes,
    setBytes: (b) => {
      bytes = b;
    },
  };
}

const sites = [
  ['vultr-20260926', 'holaday'],
  ['aliyun-app-20260926', 'hd-app.orangebench.tech'],
  ['aliyun-pay-20260926', 'hd-pay.orangebench.tech'],
].map(([profile, name]) => ({
  profile,
  bytes: readFileSync(new URL(`./fixtures/cutover-nginx/${name}.conf`, import.meta.url), 'utf8'),
}));

test('payment ingress is fenced after durable intent and before nginx replacement', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  await applyCutoverFence(f.input, f.io);
  assert.ok(f.events.includes('network-install'));
  assert.ok(f.events.indexOf('receipt:installing') < f.events.indexOf('network-install'));
  assert.ok(f.events.indexOf('network-install') < f.events.indexOf('replace'));
});

test('missing direct-port isolation rejects a valid nginx fence without restoring ingress', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  await applyCutoverFence(f.input, f.io);
  f.io.paymentPortFence.execNft = async () => JSON.stringify({ nftables: [] });
  await assert.rejects(verifyCutoverFence(f.input, f.io), /CUTOVER_FENCE_UNPROVEN/);
});

for (const fault of ['accept-rule', 'wrong-port', 'loopback-bypass', 'extra-rule', 'ipv4-only']) {
  test(`payment direct-port rule drift refuses readiness: ${fault}`, async () => {
    const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
    await applyCutoverFence(f.input, f.io);
    const changed = structuredClone(paymentTable);
    const rule = changed.nftables[2].rule;
    if (fault === 'accept-rule') rule.expr[2] = { accept: null };
    if (fault === 'wrong-port') rule.expr[1].match.right.set = [4010];
    if (fault === 'loopback-bypass') rule.expr[0].match.op = '==';
    if (fault === 'extra-rule')
      changed.nftables.push({ rule: { ...rule, expr: [{ accept: null }] } });
    if (fault === 'ipv4-only') changed.nftables[0].table.family = 'ip';
    f.io.paymentPortFence.execNft = async () => JSON.stringify(changed);
    await assert.rejects(verifyCutoverFence(f.input, f.io), /CUTOVER_FENCE_UNPROVEN/);
  });
}

test('uncertain network install leaves installing intent and does not mutate nginx', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  const exec = f.io.paymentPortFence.execNft;
  f.io.paymentPortFence.execNft = async (args) => {
    if (args[0] === '-f') throw new Error('uncertain acknowledgement');
    return exec(args);
  };
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_UNPROVEN/);
  assert.equal((await f.io.readFenceReceipt()).phase, 'installing');
  assert.equal(f.events.includes('replace'), false);
});

test('unreviewed network policy bytes are rejected before any nft transaction', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  f.io.paymentPortFence.readPolicy = async () => 'flush ruleset\n';
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_UNPROVEN/);
  assert.equal(f.events.includes('network-install'), false);
  assert.equal(f.events.includes('network-check'), false);
  assert.equal(f.events.includes('replace'), false);
});

test('existing payment table is not adopted or overwritten', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  f.io.paymentPortFence.execNft = async () => JSON.stringify(paymentTable);
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_UNPROVEN/);
  assert.equal(f.events.includes('replace'), false);
});

test('rule loss during HTTP probes refuses a successful nginx result', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  const probe = f.io.probeIngress;
  f.io.probeIngress = async (...args) => {
    const result = await probe(...args);
    f.io.paymentPortFence.execNft = async () => JSON.stringify({ nftables: [] });
    return result;
  };
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_UNPROVEN/);
});

for (const site of sites) {
  test(`${site.profile}: real captured topology applies both stages and restores exact bytes`, async () => {
    const f = fixture(site);
    await applyCutoverFence(f.input, f.io);
    const orders = f.bytes();
    for (const route of f.file.locations) {
      if (route.kind !== 'callback') continue;
      const start = orders.indexOf(`location ${route.selector} {`);
      assert(start >= 0);
      const body = orders.slice(start, orders.indexOf('}', start));
      assert(body.includes('proxy_pass '));
      assert(!body.includes('return 503;'));
    }
    if (site.profile.startsWith('vultr')) {
      assert(orders.includes('proxy_pass http://127.0.0.1:4001/internal/payment/confirm;'));
      assert(orders.includes('proxy_pass http://127.0.0.1:4001/internal/partner-payment/confirm;'));
      assert(orders.includes('proxy_pass http://127.0.0.1:4001/payment/paypal/webhook;'));
    }
    assert(!orders.includes('location = /api/internal/auth/sms-login'));
    await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
    for (const route of f.file.locations.filter((r) => r.kind === 'callback')) {
      const start = f.bytes().indexOf(`location ${route.selector} {`);
      assert(f.bytes().slice(start, f.bytes().indexOf('}', start)).includes('return 503;'));
    }
    await restoreCutoverIngress(
      { inventoryDigest: digest, identity: { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) } },
      f.io,
    );
    assert.equal(f.bytes(), site.bytes);
  });

  test(`${site.profile}: caller cannot approve changed source, route kinds or incomplete listeners`, async () => {
    assert.throws(
      () => describeCutoverSite(`${site.bytes}# drift\n`, site.profile),
      /CUTOVER_FENCE_/,
    );
    assert.throws(() => describeCutoverSite(site.bytes, 'unreviewed'), /CUTOVER_FENCE_/);
    for (const mutate of [
      (f) => {
        f.file.locations.pop();
      },
      (f) => {
        f.file.locations.find((r) => r.kind === 'business').kind = 'health';
      },
      (f) => {
        const b = `${site.bytes}# drift\n`;
        f.setBytes(b);
        f.file.digest = hash(b);
      },
      (f) => {
        f.file.profile = 'unreviewed';
      },
    ]) {
      const f = fixture(site);
      mutate(f);
      await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
      assert.deepEqual(f.events, []);
    }
  });
}

test('orders fencing backs up before replacement and preserves callbacks until all-writers', async () => {
  const f = fixture();
  await applyCutoverFence(f.input, f.io);
  assert(f.bytes().indexOf('return 503') > f.bytes().indexOf('location /api/'));
  assert(!f.bytes().slice(f.bytes().indexOf('location = /payment/notify')).includes('return 503'));
  assert(f.events.indexOf('backup') < f.events.indexOf('replace'));
  assert(f.events.indexOf('test') < f.events.indexOf('reload'));
  assert(f.events.indexOf('receipt:installing') < f.events.indexOf('replace'));
  await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  assert(f.bytes().slice(f.bytes().indexOf('location = /payment/notify')).includes('return 503'));
  const result = await verifyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  assert.equal(result.stage, 'all-writers');
});

test('unmapped or conflicting route and unsupported nginx rewrites refuse before changes', async () => {
  for (const change of [
    (f) => {
      f.file.locations.pop();
    },
    (f) => {
      f.file.locations[0].kind = 'health';
    },
    (f) => {
      const b = original.replace(
        'server_name fixture.local;',
        'server_name fixture.local; error_page 503 =200 /health;',
      );
      f.file.digest = hash(b);
      f.setBytes(b);
    },
    (f) => {
      const read = f.io.readApprovedIngress;
      f.io.readApprovedIngress = async () => ({ ...(await read()), unknownIngress: ['other'] });
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
    assert.deepEqual(f.events, []);
  }
});

test('nginx validation failure never reloads or marks active', async () => {
  const f = fixture();
  f.io.testNginx = async () => {
    throw new Error('invalid config');
  };
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
  assert(!f.events.includes('reload'));
  assert(!f.events.includes('receipt:active'));
});

test('config replaced after nginx validation is not reloaded', async () => {
  const f = fixture();
  f.io.testNginx = async () => {
    f.setBytes(original);
  };
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
  assert.equal(f.events.includes('reload'), false);
});

test('HTTP 503 does not prove existing WebSocket, direct writers or producers stopped', async () => {
  for (const key of ['existingSockets', 'internalWriters', 'producersRunning']) {
    const f = fixture();
    await applyCutoverFence(f.input, f.io);
    await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
    const probe = f.io.probeIngress;
    f.io.probeIngress = async () => ({ ...(await probe()), [key]: 1 });
    await assert.rejects(
      verifyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io),
      /CUTOVER_FENCE_/,
    );
  }
});

test('missing or successful invalid-signature probe cannot prove callback fencing', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    await applyCutoverFence(f.input, f.io);
    await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
    const probe = f.io.probeIngress;
    f.io.probeIngress = async () => {
      const r = await probe();
      if (missing) r.probes.pop();
      else r.probes[1].status = 200;
      return r;
    };
    await assert.rejects(
      verifyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io),
      /CUTOVER_FENCE_/,
    );
  }
});

test('drifted original is not overwritten and drifted generated config is not restored', async () => {
  const f = fixture();
  f.setBytes(`${original}# another owner\n`);
  await assert.rejects(applyCutoverFence(f.input, f.io), /CUTOVER_FENCE_/);
  assert.deepEqual(f.events, []);
  f.setBytes(original);
  await applyCutoverFence(f.input, f.io);
  await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  f.setBytes(`${f.bytes()}# another owner\n`);
  const before = f.bytes();
  await assert.rejects(
    restoreCutoverIngress(
      { inventoryDigest: digest, identity: { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) } },
      f.io,
    ),
    /CUTOVER_FENCE_/,
  );
  assert.equal(f.bytes(), before);
});

test('restoration requires same open identity, restores exact original and revalidates before reload', async () => {
  const f = fixture();
  await applyCutoverFence(f.input, f.io);
  await applyCutoverFence({ ...f.input, stage: 'all-writers' }, f.io);
  const identity = { candidate: 'c'.repeat(40), bootId: 'd'.repeat(32) };
  const verify = f.io.verifyOpenedIdentity;
  f.io.verifyOpenedIdentity = async () => ({
    identity: { ...identity, bootId: 'f'.repeat(32) },
    mode: 'serving',
  });
  await assert.rejects(
    restoreCutoverIngress({ inventoryDigest: digest, identity }, f.io),
    /CUTOVER_FENCE_/,
  );
  f.io.verifyOpenedIdentity = verify;
  await restoreCutoverIngress({ inventoryDigest: digest, identity }, f.io);
  assert.equal(f.bytes(), original);
  assert.deepEqual(f.events.slice(-4), ['replace', 'test', 'reload', 'receipt:restored']);
});

const portBinding = { attempt: '11111111-1111-4111-8111-111111111111', inventoryDigest: digest };
function portFixture() {
  return {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    assertJournalOwnership: async () => portBinding,
    readFenceReceipt: async () => ({ ...portBinding, stage: 'orders', phase: 'active' }),
    execNft: async () => JSON.stringify(paymentTable),
  };
}
const portOptions = { binding: portBinding, stage: 'orders' };
for (const [name, mutate, stage] of [
  [
    'input',
    (io) => {
      io.uid = 1;
    },
    'PORT_INPUT',
  ],
  [
    'clock',
    (io) => {
      io.now = () => NaN;
    },
    'PORT_CLOCK',
  ],
  [
    'owner value',
    (io) => {
      io.assertJournalOwnership = async () => ({});
    },
    'PORT_OWNER',
  ],
  [
    'owner read',
    (io) => {
      io.assertJournalOwnership = async () => {
        throw new Error('SECRET');
      };
    },
    'PORT_OWNER',
  ],
  [
    'receipt value',
    (io) => {
      io.readFenceReceipt = async () => ({});
    },
    'PORT_RECEIPT',
  ],
  [
    'receipt read',
    (io) => {
      io.readFenceReceipt = async () => {
        throw new Error('SECRET');
      };
    },
    'PORT_RECEIPT',
  ],
  [
    'command',
    (io) => {
      io.execNft = async () => {
        throw new Error('SECRET');
      };
    },
    'PORT_COMMAND',
  ],
  [
    'json',
    (io) => {
      io.execNft = async () => 'SECRET';
    },
    'PORT_JSON',
  ],
  [
    'shape null item',
    (io) => {
      io.execNft = async () => '{"nftables":[null]}';
    },
    'PORT_SHAPE',
  ],
  [
    'shape metadata',
    (io) => {
      io.execNft = async () => '{"nftables":[{"metainfo":{"json_schema_version":2}}]}';
    },
    'PORT_SHAPE',
  ],
  [
    'shape handle',
    (io) => {
      const changed = structuredClone(paymentTable);
      changed.nftables[0].table.handle = -1;
      io.execNft = async () => JSON.stringify(changed);
    },
    'PORT_SHAPE',
  ],
  [
    'rules',
    (io) => {
      io.execNft = async () => '{"nftables":[]}';
    },
    'PORT_RULES',
  ],
  [
    'guard clock rollback',
    (io) => {
      let n = 0;
      io.now = () => [1000, 999][n++];
    },
    'PORT_CLOCK',
  ],
  [
    'guard elapsed',
    (io) => {
      let n = 0;
      io.now = () => [1000, 61001][n++];
    },
    'PORT_DEADLINE',
  ],
  [
    'overall elapsed',
    (io) => {
      let n = 0;
      io.now = () => [1000, 1000, 61001, 61001][n++];
    },
    'PORT_DEADLINE',
  ],
  [
    'overall rollback',
    (io) => {
      let n = 0;
      io.now = () => [1000, 1000, 999, 999][n++];
    },
    'PORT_CLOCK',
  ],
]) {
  test(`payment port diagnostics preserve rejection and classify ${name}`, async () => {
    const io = portFixture();
    mutate(io);
    await assert.rejects(verifyPaymentPortFence(portOptions, io), (error) => {
      assert.equal(error.message, 'CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN');
      assert.equal(ingressDiagnosticStage(error), stage);
      assert.equal(JSON.stringify(error.cause).includes('SECRET'), false);
      return true;
    });
  });
}
for (const stage of ['LOCAL_OWNER', 'STORE_CLOCK', 'APPROVAL_DEADLINE']) {
  test(`payment port diagnostics retain nested ${stage}`, async () => {
    const io = portFixture();
    io.readFenceReceipt = async () => {
      throw ingressDiagnosticError('original', stage);
    };
    await assert.rejects(
      verifyPaymentPortFence(portOptions, io),
      (e) =>
        e.message === 'CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN' && ingressDiagnosticStage(e) === stage,
    );
  });
}
test('payment port guard retains original successful read order and command exactly once', async () => {
  const io = portFixture(),
    calls = [];
  for (const key of ['now', 'assertJournalOwnership', 'readFenceReceipt', 'execNft']) {
    const original = io[key];
    io[key] = (...args) => {
      calls.push(key);
      return original(...args);
    };
  }
  assert.deepEqual(await verifyPaymentPortFence(portOptions, io), {
    inventoryDigest: digest,
    observedAtMs: 1000,
    ports: [4010, 4011],
  });
  assert.deepEqual(calls, [
    'now',
    'assertJournalOwnership',
    'readFenceReceipt',
    'now',
    'execNft',
    'now',
    'assertJournalOwnership',
    'readFenceReceipt',
    'now',
  ]);
});
test('late payment port failure retains its fixed cause through real fence validation', async () => {
  const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
  await applyCutoverFence(f.input, f.io);
  const probe = f.io.probeIngress;
  f.io.probeIngress = async (...args) => {
    const result = await probe(...args);
    f.io.paymentPortFence.execNft = async () => {
      throw new Error('SECRET');
    };
    return result;
  };
  await assert.rejects(
    verifyCutoverFence(f.input, f.io),
    (e) => e.message === 'CUTOVER_FENCE_UNPROVEN' && ingressDiagnosticStage(e) === 'PORT_COMMAND',
  );
});

for (const [fault, expectedStage] of [
  [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'PORT_OUTPUT_LIMIT'],
  [{ killed: true, signal: 'SIGTERM' }, 'PORT_TERMINATED'],
  [{ signal: 'SIGKILL' }, 'PORT_TERMINATED'],
  [{ code: 1 }, 'PORT_EXIT'],
  [{ code: 'ENOENT' }, 'PORT_START'],
  ['stdin', 'PORT_STDIN'],
]) {
  test(`actual nft child wrapper keeps ${expectedStage} through fence`, async () => {
    const source = readFileSync(
      new URL('./browser-payment-port-fence.mjs', import.meta.url),
      'utf8',
    );
    const block = source
      .slice(source.indexOf('const system ='), source.indexOf('const fail ='))
      .replace('import.meta.url', "'file:///qa/module.mjs'");
    let invoked = 0;
    const execFile = (command, args, options, callback) => {
      invoked++;
      assert.equal(command, 'nft');
      assert.equal(options.timeout, 10000);
      assert.equal(options.maxBuffer, 1024 * 1024);
      let stdinError;
      queueMicrotask(() => {
        if (fault === 'stdin') stdinError(new Error('SECRET'));
        else callback(Object.assign(new Error('SECRET'), fault), 'SECRET');
      });
      return {
        stdin: {
          on: (event, handler) => {
            assert.equal(event, 'error');
            stdinError = handler;
          },
          end: () => {},
        },
      };
    };
    const system = new Function(
      'execFile',
      'ingressDiagnosticError',
      'readFile',
      block + ';return system;',
    )(execFile, ingressDiagnosticError, () => {});
    const io = portFixture();
    io.execNft = system.execNft;
    await assert.rejects(
      verifyPaymentPortFence(portOptions, io),
      (e) =>
        e.message === 'CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN' &&
        ingressDiagnosticStage(e) === expectedStage,
    );
    assert.equal(invoked, 1);
    const f = fixture(sites.find((s) => s.profile === 'aliyun-pay-20260926'));
    await applyCutoverFence(f.input, f.io);
    f.io.paymentPortFence.execNft = system.execNft;
    await assert.rejects(
      verifyCutoverFence(f.input, f.io),
      (e) => e.message === 'CUTOVER_FENCE_UNPROVEN' && ingressDiagnosticStage(e) === expectedStage,
    );
    assert.equal(invoked, 2);
  });
}

test('payment installation keeps one atomic attempt and rejects uncertain acknowledgement without replay', async () => {
  const io = portFixture(),
    calls = [];
  io.readFenceReceipt = async () => ({ ...portBinding, stage: 'orders', phase: 'installing' });
  io.readPolicy = async () =>
    readFileSync(
      new URL('../ops/aliyun-edge/holaday-payment-ingress.nft', import.meta.url),
      'utf8',
    );
  io.execNft = async (args) => {
    calls.push(args);
    if (args.includes('ruleset')) return '{"nftables":[]}';
    if (args[0] === '-f') throw ingressDiagnosticError('secret', 'PORT_TERMINATED');
    return '';
  };
  await assert.rejects(
    installPaymentPortFence(portOptions, io),
    (e) =>
      e.message === 'CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN' &&
      ingressDiagnosticStage(e) === 'PORT_TERMINATED',
  );
  assert.deepEqual(calls, [
    ['-j', 'list', 'ruleset'],
    ['--check', '-f', '-'],
    ['-f', '-'],
  ]);
});
for (const [name, mutate, stage] of [
  [
    'existing',
    (io) => {
      io.execNft = async () => JSON.stringify(paymentTable);
    },
    'PORT_EXISTING',
  ],
  [
    'policy read',
    (io) => {
      io.readPolicy = async () => {
        throw new Error('SECRET');
      };
    },
    'PORT_POLICY',
  ],
  [
    'policy bytes',
    (io) => {
      io.readPolicy = async () => 'SECRET';
    },
    'PORT_POLICY',
  ],
])
  test(`payment installation fixed diagnostics: ${name}`, async () => {
    const io = portFixture();
    io.readFenceReceipt = async () => ({ ...portBinding, stage: 'orders', phase: 'installing' });
    io.execNft = async () => '{"nftables":[]}';
    mutate(io);
    await assert.rejects(
      installPaymentPortFence(portOptions, io),
      (e) =>
        e.message === 'CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN' && ingressDiagnosticStage(e) === stage,
    );
  });
