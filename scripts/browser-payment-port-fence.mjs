import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import { ingressDiagnosticError } from './browser-first-cutover-ingress-diagnostics.mjs';

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
        (error, stdout) => {
          if (!error) return resolve(stdout);
          const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
          const killed = Object.getOwnPropertyDescriptor(error, 'killed')?.value;
          const signal = Object.getOwnPropertyDescriptor(error, 'signal')?.value;
          const stage =
            code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 'PORT_OUTPUT_LIMIT'
              : killed === true || ['SIGTERM', 'SIGKILL'].includes(signal)
                ? 'PORT_TERMINATED'
                : Number.isInteger(code)
                  ? 'PORT_EXIT'
                  : 'PORT_START';
          reject(ingressDiagnosticError('CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN', stage));
        },
      );
      child.stdin.on('error', () =>
        reject(ingressDiagnosticError('CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN', 'PORT_STDIN')),
      );
      child.stdin.end(input);
    }),
};
const fail = (stage, previous) => {
  throw ingressDiagnosticError('CUTOVER_PAYMENT_PORT_FENCE_UNPROVEN', stage, previous);
};
function parse(bytes) {
  let data;
  try {
    data = JSON.parse(bytes);
  } catch (error) {
    fail('PORT_JSON', error);
  }
  try {
    if (!Array.isArray(data?.nftables) || Object.keys(data).length !== 1) fail('PORT_SHAPE');
    return data.nftables.filter((item) => {
      if (Object.keys(item).length !== 1) fail('PORT_SHAPE');
      if (item.metainfo) {
        if (item.metainfo.json_schema_version !== 1) fail('PORT_SHAPE');
        return false;
      }
      return true;
    });
  } catch (error) {
    fail('PORT_SHAPE', error);
  }
}
async function guard(input, io, installing = false) {
  let stage = 'PORT_INPUT';
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        input.binding?.attempt ?? '',
      ) ||
      !/^[a-f0-9]{64}$/.test(input.binding?.inventoryDigest ?? '') ||
      !['orders', 'all-writers'].includes(input.stage)
    )
      fail(stage);
    stage = 'PORT_CLOCK';
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < 0) fail(stage);
    stage = 'PORT_OWNER';
    if (!isDeepStrictEqual(await io.assertJournalOwnership(), input.binding)) fail(stage);
    // This is the existing durable fence store; it also enforces the approved
    // deadline and same-attempt ownership. There is no separate network lock.
    stage = 'PORT_RECEIPT';
    const receipt = await io.readFenceReceipt();
    if (
      receipt?.attempt !== input.binding.attempt ||
      receipt.inventoryDigest !== input.binding.inventoryDigest ||
      receipt.stage !== input.stage ||
      (installing
        ? input.stage !== 'orders' || receipt.phase !== 'installing'
        : !['installing', 'active', 'restoring', 'restored'].includes(receipt.phase))
    )
      fail(stage);
    stage = 'PORT_CLOCK';
    const after = io.now();
    if (!Number.isSafeInteger(after) || after < now) fail(stage);
    if (after - now > 60000) fail('PORT_DEADLINE');
    return after;
  } catch (error) {
    fail(stage, error);
  }
}

/** Fixed Aliyun payment scope only. Never flushes, adopts, removes or persists
 * boot rules. Failure retains the fence/intent; a reboot requires new evidence.
 * Kernel rule observation is not proof of business quiescence or all host ingress.
 */
export async function installPaymentPortFence(options, overrides) {
  const io = { ...system, ...overrides };
  const input = structuredClone(options);
  let stage = 'PORT_INPUT';
  try {
    await guard(input, io, true);
    stage = 'PORT_COMMAND';
    const existing = parse(await io.execNft(['-j', 'list', 'ruleset']));
    if (existing.some((item) => item.table?.family === 'inet' && item.table.name === table))
      fail('PORT_EXISTING');
    stage = 'PORT_POLICY';
    const policy = await io.readPolicy();
    if (
      typeof policy !== 'string' ||
      createHash('sha256').update(policy).digest('hex') !== policyDigest
    )
      fail(stage);
    stage = 'PORT_COMMAND';
    await io.execNft(['--check', '-f', '-'], policy);
    await guard(input, io, true);
    // One atomic create transaction also refuses a table created after the read.
    // A lost acknowledgement is an error, never a reason to replay or remove it.
    stage = 'PORT_COMMAND';
    await io.execNft(['-f', '-'], policy);
    return await verifyPaymentPortFence(input, io);
  } catch (error) {
    fail(stage, error);
  }
}

export async function verifyPaymentPortFence(options, overrides) {
  const io = { ...system, ...overrides };
  const input = structuredClone(options);
  let stage = 'PORT_INPUT';
  try {
    const began = await guard(input, io);
    stage = 'PORT_COMMAND';
    const entries = parse(await io.execNft(['-j', 'list', 'table', 'inet', table]));
    stage = 'PORT_SHAPE';
    const normalized = entries.map((entry) => {
      const [kind, value] = Object.entries(entry)[0];
      if (!['table', 'chain', 'rule'].includes(kind) || !value || typeof value !== 'object')
        fail(stage);
      const { handle, ...configuration } = value;
      if (handle !== undefined && (!Number.isSafeInteger(handle) || handle < 0)) fail(stage);
      return { [kind]: configuration };
    });
    if (!isDeepStrictEqual(normalized, expected)) fail('PORT_RULES');
    const observedAtMs = await guard(input, io);
    if (observedAtMs < began) fail('PORT_CLOCK');
    if (observedAtMs - began > 60000) fail('PORT_DEADLINE');
    return { inventoryDigest: input.binding.inventoryDigest, observedAtMs, ports: [4010, 4011] };
  } catch (error) {
    fail(stage, error);
  }
}
