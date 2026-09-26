import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const table = 'holaday_payment_ingress';
const policyDigest = 'de27f46f3bdad7d0c239c18a44e2775ef5c27e936d1a859f3f81d8fb8ee1cdb2';
const expected = [
  { table: { family: 'inet', name: table } },
  {
    chain: {
      family: 'inet',
      table,
      name: 'input',
      type: 'filter',
      hook: 'input',
      prio: -10,
      policy: 'accept',
    },
  },
  {
    rule: {
      family: 'inet',
      table,
      chain: 'input',
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
];
const system = {
  platform: process.platform,
  uid: process.getuid?.(),
  readPolicy: () =>
    readFile(new URL('../ops/aliyun-edge/holaday-payment-ingress.nft', import.meta.url), 'utf8'),
  execNft: (args, input) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        'nft',
        args,
        {
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 1024 * 1024,
          env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin.on('error', reject);
      child.stdin.end(input);
    }),
};
const fail = () => {
  throw new Error('CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN');
};
function parse(bytes) {
  const data = JSON.parse(bytes);
  if (!Array.isArray(data?.nftables) || Object.keys(data).length !== 1) fail();
  return data.nftables.filter((item) => {
    if (Object.keys(item).length !== 1) fail();
    if (item.metainfo) {
      if (item.metainfo.json_schema_version !== 1) fail();
      return false;
    }
    return true;
  });
}
async function guard(input, io, installing = false) {
  if (
    io.platform !== 'linux' ||
    io.uid !== 0 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      input.binding?.attempt ?? '',
    ) ||
    !/^[a-f0-9]{64}$/.test(input.binding?.inventoryDigest ?? '') ||
    !['orders', 'all-writers'].includes(input.stage)
  )
    fail();
  const now = io.now();
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !isDeepStrictEqual(await io.assertJournalOwnership(), input.binding)
  )
    fail();
  // This is the existing durable fence store; it also enforces the approved
  // deadline and same-attempt ownership. There is no separate network lock.
  const receipt = await io.readFenceReceipt();
  if (
    receipt?.attempt !== input.binding.attempt ||
    receipt.inventoryDigest !== input.binding.inventoryDigest ||
    receipt.stage !== input.stage ||
    (installing
      ? input.stage !== 'orders' || receipt.phase !== 'installing'
      : !['installing', 'active', 'restoring', 'restored'].includes(receipt.phase))
  )
    fail();
  const after = io.now();
  if (!Number.isSafeInteger(after) || after < now || after - now > 60000) fail();
  return after;
}

/** Fixed Aliyun payment scope only. Never flushes, adopts, removes or persists
 * boot rules. Failure retains the fence/intent; a reboot requires new evidence.
 * Kernel rule observation is not proof of business quiescence or all host ingress.
 */
export async function installPaymentPortFence(options, overrides) {
  const io = { ...system, ...overrides };
  const input = structuredClone(options);
  try {
    await guard(input, io, true);
    const existing = parse(await io.execNft(['-j', 'list', 'ruleset']));
    if (existing.some((item) => item.table?.family === 'inet' && item.table.name === table)) fail();
    const policy = await io.readPolicy();
    if (
      typeof policy !== 'string' ||
      createHash('sha256').update(policy).digest('hex') !== policyDigest
    )
      fail();
    await io.execNft(['--check', '-f', '-'], policy);
    await guard(input, io, true);
    // One atomic create transaction also refuses a table created after the read.
    // A lost acknowledgement is an error, never a reason to replay or remove it.
    await io.execNft(['-f', '-'], policy);
    return await verifyPaymentPortFence(input, io);
  } catch {
    fail();
  }
}

export async function verifyPaymentPortFence(options, overrides) {
  const io = { ...system, ...overrides };
  const input = structuredClone(options);
  try {
    const began = await guard(input, io);
    const entries = parse(await io.execNft(['-j', 'list', 'table', 'inet', table]));
    const normalized = entries.map((entry) => {
      const [kind, value] = Object.entries(entry)[0];
      if (!['table', 'chain', 'rule'].includes(kind) || !value || typeof value !== 'object') fail();
      const { handle, ...configuration } = value;
      if (handle !== undefined && (!Number.isSafeInteger(handle) || handle < 0)) fail();
      return { [kind]: configuration };
    });
    if (!isDeepStrictEqual(normalized, expected)) fail();
    const observedAtMs = await guard(input, io);
    if (observedAtMs < began || observedAtMs - began > 60000) fail();
    return { inventoryDigest: input.binding.inventoryDigest, observedAtMs, ports: [4010, 4011] };
  } catch {
    fail();
  }
}
