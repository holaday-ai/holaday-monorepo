import { X509Certificate, createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { Module } from 'node:module';
import { isDeepStrictEqual as equal, parseEnv } from 'node:util';

const directory = '/var/lib/holaday-deploy/evidence-private';
const queryPath = '/var/lib/holaday-deploy/channel/payment-cutover-query.cjs';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const hash = (v) => sha(JSON.stringify(v));
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fail = () => {
  throw new Error('CUTOVER_PAYMENT_SITE_UNPROVEN');
};
const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];

// These are protected receiving-host metadata, never request-supplied paths or
// credentials. The caller also pins the entire independent gateway site file.
export function assertFirstCutoverPaymentMetadata(payments, binding) {
  if (
    !payments ||
    hash(payments.inventory) !== binding.inventoryDigest ||
    !digest(payments.queryBundleDigest) ||
    !/^\/opt\/holaday-cn-payment\/releases\/[a-zA-Z0-9_-]+\/apps\/cn-payment$/.test(
      payments.dependencyRoot ?? '',
    ) ||
    !Array.isArray(payments.inventory?.merchants) ||
    !Array.isArray(payments.profiles) ||
    payments.profiles.length !== payments.inventory.merchants.length ||
    payments.profiles.length > 2
  )
    fail();
  const seen = new Set();
  for (const profile of payments.profiles) {
    if (
      !['wechat', 'alipay'].includes(profile?.provider) ||
      seen.has(profile.provider) ||
      !['production', 'sandbox'].includes(profile.environment) ||
      !digest(profile.merchantDigest) ||
      !/^\/opt\/holaday-cn-payment\/releases\/[a-zA-Z0-9_-]+\/apps\/cn-payment\/\.env$/.test(
        profile.config?.path ?? '',
      ) ||
      !digest(profile.config?.digest) ||
      !profile.materials ||
      typeof profile.materials !== 'object' ||
      Array.isArray(profile.materials) ||
      payments.inventory.merchants.filter(
        (m) =>
          m.provider === profile.provider &&
          m.environment === profile.environment &&
          m.merchantDigest === profile.merchantDigest &&
          m.codeDigest === payments.queryBundleDigest,
      ).length !== 1
    )
      fail();
    seen.add(profile.provider);
    const names =
      profile.provider === 'wechat' ? ['WX_CERT_PATH', 'WX_KEY_PATH', 'WX_PUBLIC_KEY_PATH'] : [];
    if (!equal(Object.keys(profile.materials).sort(), names.sort())) fail();
    for (const file of Object.values(profile.materials)) {
      if (
        !file ||
        typeof file.path !== 'string' ||
        !file.path.startsWith('/') ||
        file.path.includes('\0') ||
        file.path.split('/').some((p) => p === '..' || p === '.') ||
        !digest(file.digest)
      )
        fail();
    }
  }
}

/** Runs on the original credential host. Only signed read-only queries; private
 * raw responses stay here. It does not settle, refund or change any order. */
export async function queryFirstCutoverOrders(value, request, overrides = {}) {
  const io = {
    fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    loadQuery: async (bytes, root) => {
      const mod = new Module(`${root}/holaday-cutover-query.cjs`);
      mod.filename = `${root}/holaday-cutover-query.cjs`;
      mod.paths = Module._nodeModulePaths(root);
      mod._compile(bytes.toString('utf8'), mod.filename);
      return mod.exports.queryPaymentOrder;
    },
    ...overrides,
  };
  try {
    const site = structuredClone(value);
    const input = structuredClone(request);
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      typeof io.assertScope !== 'function' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        site.binding?.attempt ?? '',
      ) ||
      !/^[a-f0-9]{40}$/.test(site.binding?.candidate ?? '') ||
      !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) =>
        digest(site.binding[k]),
      ) ||
      !['prepare', 'preopen'].includes(input?.stage) ||
      !Array.isArray(input.orders) ||
      input.orders.length >= 10000
    )
      fail();
    assertFirstCutoverPaymentMetadata(site.payments, site.binding);
    let previousTime = -1;
    let record;
    const guard = async () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < previousTime ||
        !Number.isSafeInteger(site.maintenanceEndsAtMs) ||
        now >= site.maintenanceEndsAtMs ||
        !Number.isSafeInteger(input.observedAtMs) ||
        input.observedAtMs < 0 ||
        input.observedAtMs > now ||
        now - input.observedAtMs > 60000 ||
        !equal(await io.assertScope(), site) ||
        !equal(await io.journal.assertOwnership(), site.binding)
      )
        fail();
      previousTime = now;
      const next = await io.journal.readFirstCutoverEffects();
      if (
        !bindingKeys.every((k) => next[k] === site.binding[k]) ||
        !(
          input.stage === 'prepare' ? ['preflight', 'prepared'] : ['candidate_started', 'verified']
        ).includes(next.phase) ||
        (record && !equal(next, record))
      )
        fail();
      if (input.stage === 'prepare') {
        if (input.identity !== undefined) fail();
      } else if (
        !input.identity ||
        input.identity.candidate !== site.binding.candidate ||
        !/^[a-f0-9]{32}$/.test(input.identity.bootId ?? '') ||
        !/^[a-f0-9]{32}$/.test(next.bootstrapSeed ?? '') ||
        input.identity.bootId === next.bootstrapSeed ||
        (next.identity && !equal(next.identity, input.identity))
      )
        fail();
      record ??= structuredClone(next);
    };
    await guard();
    const dir = await io.fs.lstat(directory);
    if (
      !dir.isDirectory() ||
      dir.uid !== 0 ||
      (dir.mode & 0o7777) !== 0o700 ||
      (await io.fs.realpath(directory)) !== directory
    )
      fail();
    const read = async (path, expected, privateOnly = false) => {
      if ((await io.fs.realpath(path)) !== path) fail();
      const handle = await io.fs.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          ![0, 998].includes(before.uid) ||
          before.mode & 0o022 ||
          before.size < 1 ||
          // The fixed, hash-pinned query artifact includes both provider SDKs.
          // Credentials and raw evidence retain the smaller one-MiB bound.
          before.size > (path === queryPath ? 8 : 1) * 1024 * 1024 ||
          (privateOnly && (before.uid !== 0 || (before.mode & 0o7777) !== 0o600))
        )
          fail();
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const current = await io.fs.lstat(path);
        if (
          ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some(
            (k) => before[k] !== after[k] || after[k] !== current[k],
          ) ||
          bytes.length !== before.size ||
          sha(bytes) !== expected ||
          !Buffer.from(bytes.toString('utf8')).equals(bytes)
        )
          fail();
        return bytes;
      } finally {
        await handle.close();
      }
    };
    const bundle = await read(queryPath, site.payments.queryBundleDigest, true);
    const profiles = new Map();
    const files = [[queryPath, site.payments.queryBundleDigest, true]];
    for (const profile of site.payments.profiles) {
      const env = parseEnv(
        (await read(profile.config.path, profile.config.digest)).toString('utf8'),
      );
      files.push([profile.config.path, profile.config.digest, false]);
      const materials = {};
      for (const [name, file] of Object.entries(profile.materials)) {
        if (env[name] !== file.path) fail();
        materials[name] = (await read(file.path, file.digest)).toString('utf8');
        files.push([file.path, file.digest, false]);
      }
      let auth;
      if (profile.provider === 'alipay') {
        if (env.ALIPAY_MODE !== profile.environment) fail();
        auth = {
          provider: 'alipay',
          environment: profile.environment,
          appId: env.ALIPAY_APPID,
          merchantId: env.ALIPAY_SELLER_ID,
          privateKey: env.ALIPAY_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          publicKey: env.ALIPAY_PUBLIC_KEY?.replace(/\\n/g, '\n'),
        };
      } else {
        if (profile.environment !== 'production') fail();
        const cert = materials.WX_CERT_PATH;
        auth = {
          provider: 'wechat',
          environment: 'production',
          appId: env.WX_APPID,
          merchantId: env.WX_MCHID,
          certificate: cert,
          privateKey: materials.WX_KEY_PATH,
          serial: new X509Certificate(cert).serialNumber.toUpperCase(),
          verifySerial: env.WX_PUBLIC_KEY_ID,
          verifyKey: materials.WX_PUBLIC_KEY_PATH,
        };
      }
      if (
        Object.values(auth).some((v) => typeof v !== 'string' || !v) ||
        hash([auth.provider, auth.environment, auth.appId, auth.merchantId]) !==
          profile.merchantDigest
      )
        fail();
      profiles.set(profile.provider, { auth, profile });
    }
    // Validate the ENTIRE SQL-selected set first, so a later invalid row cannot
    // cause a partial round of provider requests. No PayPal profile or handler.
    const seen = new Set();
    const requests = input.orders.map((order) => {
      const { table, orderRef, merchantDigest, environment, fieldsDigest, ...row } = order;
      const bound = profiles.get(row.provider);
      const amount = Number(row.amount_cents);
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      if (
        !bound ||
        !['payments', 'partner_recharge_orders'].includes(table) ||
        !digest(fieldsDigest) ||
        hash(row) !== fieldsDigest ||
        bound.profile.merchantDigest !== merchantDigest ||
        bound.profile.environment !== environment ||
        (metadata?.env !== undefined && metadata.env !== environment) ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(row.provider_order_id ?? '') ||
        hash([merchantDigest, row.provider_order_id]) !== orderRef ||
        seen.has(orderRef) ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        row.currency !== 'CNY' ||
        !['pending', 'completed', 'failed', 'cancelled'].includes(row.status) ||
        (row.status !== 'completed' && row.provider_capture_id != null) ||
        (row.status === 'completed' &&
          (typeof row.provider_capture_id !== 'string' || !row.provider_capture_id))
      )
        fail();
      seen.add(orderRef);
      return {
        orderRef,
        body: {
          ...bound.auth,
          orderId: row.provider_order_id,
          amountCents: amount,
          currency: row.currency,
          settlement:
            row.status === 'completed'
              ? {
                  transactionId: row.provider_capture_id,
                  amountCents: amount,
                  currency: row.currency,
                }
              : null,
        },
      };
    });
    const verifyDirectory = async () => {
      const current = await io.fs.lstat(directory);
      if (
        current.ino !== dir.ino ||
        current.dev !== dir.dev ||
        current.uid !== 0 ||
        (current.mode & 0o7777) !== 0o700 ||
        !current.isDirectory() ||
        (await io.fs.realpath(directory)) !== directory
      )
        fail();
    };
    const verify = async () => {
      await guard();
      for (const args of files) await read(...args);
      await verifyDirectory();
    };
    const query = await io.loadQuery(bundle, site.payments.dependencyRoot);
    if (typeof query !== 'function') fail();
    const result = [];
    for (const item of requests) {
      await verify();
      let retained;
      const observation = await query(item.body, {
        now: io.now,
        ...(io.transport ? { transport: io.transport } : {}),
        retain: async (raw) => {
          if (retained || typeof raw !== 'string' || Buffer.byteLength(raw) > 512 * 1024) fail();
          await verifyDirectory();
          // Preserve the response even when the query later fails verification.
          const path = `${directory}/${site.binding.attempt}-${item.orderRef}-${randomUUID()}.json`;
          const handle = await io.fs.open(
            path,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          );
          try {
            await handle.writeFile(raw);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await verifyDirectory();
          await read(path, sha(raw), true);
          retained = sha(raw);
        },
      });
      await verify();
      if (observation.orderRef !== item.orderRef || observation.rawDigest !== retained) fail();
      result.push(observation);
    }
    await verify();
    return result;
  } catch {
    fail();
  }
}
