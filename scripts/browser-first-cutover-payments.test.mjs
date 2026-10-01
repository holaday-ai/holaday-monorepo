import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const api = await import('./browser-first-cutover-payments.mjs').catch(() => ({}));
const sha = (v) => createHash('sha256').update(v).digest('hex');
const hash = (v) => sha(JSON.stringify(v));
const queryPath = '/var/lib/holaday-deploy/channel/payment-cutover-query.cjs';
const evidence = '/var/lib/holaday-deploy/evidence-private';
const app = '/opt/holaday-cn-payment/releases/qa-20260928/apps/cn-payment';
const require = createRequire(new URL('../apps/cn-payment/package.json', import.meta.url));
let bundle;
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-payment-site-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  if (!bundle && process.env.CUTOVER_QA_QUERY_BUNDLE)
    bundle = await fs.readFile(process.env.CUTOVER_QA_QUERY_BUNDLE);
  if (!bundle) {
    const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild');
    bundle = (
      await esbuild.build({
        entryPoints: [
          new URL('../apps/cn-payment/scripts/payment-cutover-query.ts', import.meta.url).pathname,
        ],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        packages: 'bundle',
      })
    ).outputFiles[0].contents;
  }
  const env = Buffer.from(
    `ALIPAY_APPID=APP\nALIPAY_SELLER_ID=MERCHANT\nALIPAY_MODE=sandbox\nALIPAY_PRIVATE_KEY=${JSON.stringify(keys.privateKey)}\nALIPAY_PUBLIC_KEY=${JSON.stringify(keys.publicKey)}\n`,
  );
  for (const [path, bytes] of [
    [queryPath, bundle],
    [`${app}/.env`, env],
  ]) {
    await fs.mkdir(root + path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    await fs.writeFile(root + path, bytes, { mode: 0o600 });
  }
  await fs.mkdir(root + evidence, { recursive: true, mode: 0o700 });
  const merchantDigest = hash(['alipay', 'sandbox', 'APP', 'MERCHANT']);
  const inventory = {
    merchants: [
      { provider: 'alipay', environment: 'sandbox', merchantDigest, codeDigest: sha(bundle) },
    ],
  };
  const binding = {
    attempt: '11111111-1111-4111-8111-111111111111',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: hash(inventory),
  };
  const site = {
    binding,
    maintenanceEndsAtMs: 200_000,
    payments: {
      inventory,
      queryBundleDigest: sha(bundle),
      dependencyRoot: app,
      profiles: [
        {
          provider: 'alipay',
          environment: 'sandbox',
          merchantDigest,
          config: { path: `${app}/.env`, digest: sha(env) },
          materials: {},
        },
      ],
    },
  };
  const row = {
    id: 1,
    external_id: 'SYNTHETIC',
    provider: 'alipay',
    provider_order_id: 'QA_ORDER',
    provider_capture_id: null,
    amount_cents: 1234,
    currency: 'CNY',
    status: 'pending',
    metadata: null,
    created_at: '2026-01-01 00:00:00.000',
    updated_at: '2026-01-01 00:00:00.000',
  };
  const order = {
    ...row,
    table: 'payments',
    orderRef: hash([merchantDigest, 'QA_ORDER']),
    merchantDigest,
    environment: 'sandbox',
    fieldsDigest: hash(row),
  };
  const input = { stage: 'prepare', observedAtMs: 100_000, orders: [order] };
  const calls = [];
  let phase = 'preflight';
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 100_000,
    assertScope: async () => site,
    journal: {
      assertOwnership: async () => binding,
      readFirstCutoverEffects: async () => ({ ...binding, phase }),
    },
    fs: {
      ...fs,
      lstat: async (p) => Object.assign(await fs.lstat(root + p), { uid: 0 }),
      realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
      open: async (p, flags, mode) => {
        const h = await fs.open(root + p, flags, mode);
        const stat = h.stat.bind(h);
        h.stat = async () => Object.assign(await stat(), { uid: 0 });
        return h;
      },
    },
    transport: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.stringify({
        code: '10000',
        out_trade_no: 'QA_ORDER',
        trade_no: 'QA_TRADE',
        seller_id: 'MERCHANT',
        trade_status: 'WAIT_BUYER_PAY',
        total_amount: '12.34',
      });
      const sign = createSign('RSA-SHA256').update(body).sign(keys.privateKey, 'base64');
      return new Response(`{"alipay_trade_query_response":${body},"sign":${JSON.stringify(sign)}}`);
    },
  };
  return {
    root,
    keys,
    site,
    input,
    io,
    calls,
    order,
    setPhase: (v) => {
      phase = v;
    },
  };
}

test('fixed payment site uses real signed query and exclusively retains private evidence', async (t) => {
  assert.equal(typeof api.queryFirstCutoverOrders, 'function');
  const f = await fixture(t);
  const result = await api.queryFirstCutoverOrders(f.site, f.input, f.io);
  assert.equal(result.length, 1);
  assert.equal(result[0].state, 'unpaid-valid');
  assert.equal(result[0].orderRef, f.order.orderRef);
  assert.equal(f.calls.length, 1);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get('method'), 'alipay.trade.query');
  const files = await fs.readdir(f.root + evidence);
  assert.equal(files.length, 1);
  const path = join(f.root + evidence, files[0]);
  assert.equal(sha(await fs.readFile(path)), result[0].rawDigest);
  assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert(!JSON.stringify(result).includes('QA_ORDER'));
  assert(!JSON.stringify(result).includes('PRIVATE KEY'));
});

for (const fault of [
  'paypal',
  'duplicate',
  'order-change',
  'credential-drift',
  'stale',
  'deadline',
  'phase',
  'ownership',
  'bundle',
  'merchant',
  'oversize-bundle',
  'oversize-config',
]) {
  test(`payment site ${fault} refuses before any provider request`, async (t) => {
    assert.equal(typeof api.queryFirstCutoverOrders, 'function');
    const f = await fixture(t);
    if (fault === 'paypal') f.input.orders[0].provider = 'paypal';
    if (fault === 'duplicate') f.input.orders.push(structuredClone(f.order));
    if (fault === 'order-change') f.order.amount_cents++;
    if (fault === 'credential-drift')
      await fs.appendFile(`${f.root}${app}/.env`, '\nALIPAY_APPID=OTHER');
    if (fault === 'stale') f.input.observedAtMs = 1;
    if (fault === 'deadline') f.io.now = () => 200_000;
    if (fault === 'phase') f.setPhase('stopped');
    if (fault === 'ownership')
      f.io.journal.assertOwnership = async () => ({ ...f.site.binding, attempt: 'wrong' });
    if (fault === 'bundle') await fs.appendFile(f.root + queryPath, '\n// different');
    if (fault === 'merchant') f.site.payments.profiles[0].merchantDigest = '9'.repeat(64);
    if (fault === 'oversize-bundle') {
      const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, ' ');
      await fs.writeFile(f.root + queryPath, bytes);
      f.site.payments.queryBundleDigest = sha(bytes);
      f.site.payments.inventory.merchants[0].codeDigest = sha(bytes);
      f.site.binding.inventoryDigest = hash(f.site.payments.inventory);
    }
    if (fault === 'oversize-config') {
      const bytes = Buffer.alloc(1024 * 1024 + 1, ' ');
      await fs.writeFile(`${f.root}${app}/.env`, bytes);
      f.site.payments.profiles[0].config.digest = sha(bytes);
    }
    await assert.rejects(
      api.queryFirstCutoverOrders(f.site, f.input, f.io),
      /^Error: CUTOVER_PAYMENT_SITE_UNPROVEN$/,
    );
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await fs.readdir(f.root + evidence), []);
  });
}

test('WeChat uses reviewed original certificate files and verifies signed closed responses', async (t) => {
  const f = await fixture(t);
  const material = `${app}/qa`;
  await fs.mkdir(f.root + material, { mode: 0o700 });
  await fs.writeFile(`${f.root}${material}/key.pem`, f.keys.privateKey, { mode: 0o600 });
  execFileSync(
    '/usr/bin/openssl',
    [
      'req',
      '-new',
      '-x509',
      '-key',
      `${f.root}${material}/key.pem`,
      '-out',
      `${f.root}${material}/cert.pem`,
      '-days',
      '1',
      '-subj',
      '/CN=synthetic-cutover',
    ],
    { stdio: 'ignore' },
  );
  await fs.writeFile(`${f.root}${material}/verify.pem`, f.keys.publicKey, { mode: 0o600 });
  const files = {
    WX_KEY_PATH: `${material}/key.pem`,
    WX_CERT_PATH: `${material}/cert.pem`,
    WX_PUBLIC_KEY_PATH: `${material}/verify.pem`,
  };
  const env = `WX_APPID=APP\nWX_MCHID=MERCHANT\nWX_PUBLIC_KEY_ID=QA_PUBLIC\n${Object.entries(files)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;
  await fs.writeFile(`${f.root}${app}/.env`, env);
  const profile = f.site.payments.profiles[0];
  profile.provider = 'wechat';
  profile.environment = 'production';
  profile.merchantDigest = hash(['wechat', 'production', 'APP', 'MERCHANT']);
  profile.config.digest = sha(env);
  for (const [k, path] of Object.entries(files))
    profile.materials[k] = { path, digest: sha(await fs.readFile(f.root + path)) };
  f.site.payments.inventory.merchants = [
    {
      provider: 'wechat',
      environment: 'production',
      merchantDigest: profile.merchantDigest,
      codeDigest: f.site.payments.queryBundleDigest,
    },
  ];
  f.site.binding.inventoryDigest = hash(f.site.payments.inventory);
  const { table, orderRef, fieldsDigest, merchantDigest, environment, ...row } = f.order;
  row.provider = 'wechat';
  f.input.orders = [
    {
      ...row,
      table,
      fieldsDigest: hash(row),
      merchantDigest: profile.merchantDigest,
      environment: 'production',
      orderRef: hash([profile.merchantDigest, row.provider_order_id]),
    },
  ];
  f.io.transport = async (url, init) => {
    f.calls.push({ url, init });
    assert.equal(
      url,
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/QA_ORDER?mchid=MERCHANT',
    );
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    const body = JSON.stringify({
      appid: 'APP',
      mchid: 'MERCHANT',
      out_trade_no: 'QA_ORDER',
      trade_state: 'CLOSED',
    });
    const signature = createSign('RSA-SHA256')
      .update(`100\nnonce\n${body}\n`)
      .sign(f.keys.privateKey, 'base64');
    return new Response(body, {
      headers: {
        'wechatpay-timestamp': '100',
        'wechatpay-nonce': 'nonce',
        'wechatpay-serial': 'QA_PUBLIC',
        'wechatpay-signature': signature,
      },
    });
  };
  const result = await api.queryFirstCutoverOrders(f.site, f.input, f.io);
  assert.equal(result[0].state, 'closed');
  assert.equal(f.calls.length, 1);
  await fs.appendFile(f.root + files.WX_PUBLIC_KEY_PATH, 'changed');
  await assert.rejects(
    api.queryFirstCutoverOrders(f.site, f.input, f.io),
    /CUTOVER_PAYMENT_SITE_UNPROVEN/,
  );
  assert.equal(f.calls.length, 1);
});

test('uncertain query retains evidence but is never retried or reported as ready', async (t) => {
  assert.equal(typeof api.queryFirstCutoverOrders, 'function');
  const f = await fixture(t);
  const transport = f.io.transport;
  f.io.transport = async (...args) => {
    const result = await transport(...args);
    f.setPhase('stopped');
    return result;
  };
  await assert.rejects(
    api.queryFirstCutoverOrders(f.site, f.input, f.io),
    /CUTOVER_PAYMENT_SITE_UNPROVEN/,
  );
  assert.equal(f.calls.length, 1);
  assert.equal((await fs.readdir(f.root + evidence)).length, 1);
});

for (const time of [150000, 210000])
  test(`real signed postopen query retains original deadline at ${time}`, async (t) => {
    const f = await fixture(t);
    const identity = { candidate: f.site.binding.candidate, bootId: '2'.repeat(32) };
    f.site.reconcileByMs = 250000;
    f.input.stage = 'postopen';
    f.input.identity = identity;
    f.input.observedAtMs = time;
    f.io.now = () => time;
    f.io.journal.readFirstCutoverEffects = async () => ({
      ...f.site.binding,
      phase: 'reconciled',
      identity,
      bootstrapSeed: '1'.repeat(32),
    });
    const result = await api.queryFirstCutoverOrders(f.site, f.input, f.io);
    assert.equal(result[0].state, 'unpaid-valid');
    assert.equal(f.calls.length, 1);
    f.io.now = () => 250000;
    await assert.rejects(api.queryFirstCutoverOrders(f.site, f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 1);
  });
