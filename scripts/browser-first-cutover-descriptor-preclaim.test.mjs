import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareFirstCutoverCandidate } from './browser-first-cutover-host.mjs';
import {
  readFirstCutoverExecutionSiteScope,
  readFirstCutoverIngressSite,
} from './browser-first-cutover-ingress-session.mjs';
import { createFirstCutoverExecutionSite } from './browser-first-cutover-site.mjs';
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: createHash('sha256').update('qa config').digest('hex'),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};
const parsed = {
  MODEL_RUNTIME_POLICY: 'qwen_only',
  QWEN_CORE_ENABLED_LANES: 'qa',
  DASHSCOPE_INTL_API_KEY: 'fake',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://example.invalid',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://example.invalid',
  QWEN_CORE_ROLLOUT_MODE: 'off',
  TEAM_TASK_LIFECYCLE_ENABLED: 'false',
  ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
};
const now = Date.now();
const end = now + 60000;
const legacy = 'e'.repeat(64);
const files = JSON.parse(
  await fs.readFile(
    new URL('./fixtures/browser-first-cutover-ingress-descriptors.json', import.meta.url),
  ),
);
async function fixture(t, change) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'descriptor-preclaim-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = '/var/lib/holaday-deploy/maintenance';
  await fs.mkdir(root + folder, { recursive: true, mode: 0o700 });
  const selected = structuredClone(files);
  change?.(selected);
  const scope = {
    legacyDigest: legacy,
    reviews: { vultr: {}, aliyun: {} },
    ingress: {
      inventoryDigest: binding.inventoryDigest,
      unknownIngress: [],
      files: selected,
      remoteSiteDigest: '1'.repeat(64),
    },
    gatewaySiteDigest: '2'.repeat(64),
    producerStartupFiles: [
      {
        path: '/root/.pm2/dump.pm2',
        digest: '3'.repeat(64),
        remove: [{ name: 'holaday-orchestrator', entryDigest: '4'.repeat(64) }],
      },
      { path: '/root/.pm2/dump.pm2.bak', digest: null, remove: [] },
    ],
  };
  const approval = { ...binding, legacyDigest: legacy, maintenanceEndsAtMs: end };
  const disk = {
    lstat: async (p) => Object.assign(await fs.lstat(root + p), { uid: 0 }),
    realpath: async (p) => (await fs.realpath(root + p)).slice(root.length),
    open: async (p, flags) => {
      const h = await fs.open(root + p, flags);
      const stat = h.stat.bind(h);
      h.stat = async () => Object.assign(await stat(), { uid: 0 });
      return h;
    },
  };
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => now,
    fs: disk,
    readApproval: async () => approval,
  };
  await fs.writeFile(
    `${root + folder}/first-cutover-execution-approved.json`,
    JSON.stringify({
      schemaVersion: 1,
      host: 'vultr',
      binding,
      maintenanceEndsAtMs: end,
      site: scope,
    }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    `${root + folder}/first-cutover-ingress-approved.json`,
    JSON.stringify({
      schemaVersion: 1,
      host: 'aliyun',
      binding,
      maintenanceEndsAtMs: end,
      ingress: {
        inventoryDigest: binding.inventoryDigest,
        unknownIngress: [],
        files: selected.filter((f) => f.profile !== 'vultr-20260926'),
      },
    }),
    { mode: 0o600 },
  );
  return { approval, io };
}
for (const [name, change] of [
  [
    'missing digest',
    (f) => {
      f[0].digest = undefined;
    },
  ],
  [
    'digest drift',
    (f) => {
      f[0].digest = '0'.repeat(64);
    },
  ],
  [
    'locations drift',
    (f) => {
      f[0].locations = [];
    },
  ],
  [
    'unexpected field',
    (f) => {
      f[0].unexpected = true;
    },
  ],
  [
    'duplicate profile',
    (f) => {
      f[1] = structuredClone(f[0]);
    },
  ],
  [
    'link drift',
    (f) => {
      f[0].links[0].target = '/etc/nginx/sites-available/other';
    },
  ],
  [
    'source drift',
    (f) => {
      f[0].sourcePath = '/tmp/other';
    },
  ],
])
  test(`malformed ${name} is rejected by original inspectSource before any acquisition or stage`, async (t) => {
    const f = await fixture(t, change);
    const calls = { inspect: 0, config: 0, target: 0, journal: 0, stage: 0, service: 0 };
    const site = createFirstCutoverExecutionSite(
      { attempt: binding.attempt },
      {
        platform: 'linux',
        uid: 0,
        now: () => now,
        readSite: () => readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, f.io),
        inspectSource: async () => {
          calls.inspect++;
          return { sourceCandidate: '9'.repeat(40), legacyDigest: legacy, observedAtMs: now };
        },
        readCoordinatorIdentity: async () => ({}),
        acquireJournal: async () => {
          calls.journal++;
        },
        stageCandidate: async () => {
          calls.stage++;
        },
        createIngress: async () => {
          calls.service++;
        },
      },
    );
    await assert.rejects(
      prepareFirstCutoverCandidate(
        { attempt: binding.attempt },
        {
          platform: 'linux',
          uid: 0,
          now: () => now,
          readApproval: async () => f.approval,
          inspectLegacySource: site.inspectLegacySource,
          readConfig: async () => {
            calls.config++;
            return Buffer.from('qa config');
          },
          targetAbsent: async () => {
            calls.target++;
          },
          journal: async () => {
            calls.journal++;
            throw Error('UNEXPECTED_CLAIM');
          },
          exec: async () => '998',
          parseConfig: () => parsed,
          manifest: () => {
            calls.stage++;
            throw Error('UNEXPECTED_STAGE');
          },
        },
      ),
      /UNPROVEN/,
    );
    assert.deepEqual(calls, { inspect: 0, config: 0, target: 0, journal: 0, stage: 0, service: 0 });
  });
test('complete descriptors pass both protected readers and original preclaim inspectSource', async (t) => {
  const f = await fixture(t);
  const scope = await readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, f.io);
  assert.deepEqual(scope.ingress.files, files);
  await readFirstCutoverIngressSite({ attempt: binding.attempt }, f.io);
  let inspect = 0;
  const site = createFirstCutoverExecutionSite(
    { attempt: binding.attempt },
    {
      platform: 'linux',
      uid: 0,
      now: () => now,
      readSite: () => readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, f.io),
      inspectSource: async () => {
        inspect++;
        return { legacyDigest: legacy };
      },
      readCoordinatorIdentity: async () => ({}),
    },
  );
  assert.equal((await site.inspectLegacySource(f.approval)).legacyDigest, legacy);
  assert.equal(inspect, 1);
});
for (const [name, change] of [
  [
    'missing',
    (f) => {
      f[1].digest = undefined;
    },
  ],
  [
    'extra',
    (f) => {
      f[1].extra = true;
    },
  ],
  [
    'duplicate',
    (f) => {
      f[2] = structuredClone(f[1]);
    },
  ],
  [
    'digest drift',
    (f) => {
      f[1].digest = '0'.repeat(64);
    },
  ],
  [
    'locations drift',
    (f) => {
      f[1].locations = [];
    },
  ],
  [
    'link drift',
    (f) => {
      f[1].links[0].target = '/tmp/other';
    },
  ],
])
  test(`remote protected ingress reader rejects ${name}`, async (t) => {
    const f = await fixture(t, change);
    await assert.rejects(
      readFirstCutoverIngressSite({ attempt: binding.attempt }, f.io),
      /UNPROVEN/,
    );
  });
test('observed optional link stat does not restrict approved source owner or static shape', async (t) => {
  const f = await fixture(t, (rows) => {
    for (const row of rows) for (const link of row.links) link.stat = { observationOnly: true };
  });
  const v = await readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, f.io);
  const app = v.ingress.files.find((f) => f.profile === 'aliyun-app-20260926');
  assert.equal(app.sourceUid, 501);
  assert.equal(app.sourceGid, 50);
});

test('complete descriptors let original prepare reach only an explicit no-effect journal barrier', async (t) => {
  const f = await fixture(t);
  const calls = { config: 0, target: 0, journal: 0, stage: 0, service: 0 };
  const site = createFirstCutoverExecutionSite(
    { attempt: binding.attempt },
    {
      platform: 'linux',
      uid: 0,
      now: () => now,
      readSite: () => readFirstCutoverExecutionSiteScope({ attempt: binding.attempt }, f.io),
      inspectSource: async () => ({
        sourceCandidate: '9'.repeat(40),
        legacyDigest: legacy,
        observedAtMs: now,
      }),
      readCoordinatorIdentity: async () => ({}),
    },
  );
  await assert.rejects(
    prepareFirstCutoverCandidate(
      { attempt: binding.attempt },
      {
        platform: 'linux',
        uid: 0,
        now: () => now,
        readApproval: async () => f.approval,
        inspectLegacySource: site.inspectLegacySource,
        readConfig: async () => {
          calls.config++;
          return Buffer.from('qa config');
        },
        parseConfig: () => ({
          MODEL_RUNTIME_POLICY: 'qwen_only',
          QWEN_CORE_ENABLED_LANES: 'qa',
          DASHSCOPE_INTL_API_KEY: 'fake',
          DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://example.invalid',
          DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://example.invalid',
          QWEN_CORE_ROLLOUT_MODE: 'off',
          TEAM_TASK_LIFECYCLE_ENABLED: 'false',
          ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
        }),
        exec: async () => '998',
        targetAbsent: async () => {
          calls.target++;
        },
        journal: async () => {
          calls.journal++;
          throw Error('CUTOVER_TEST_READONLY_BARRIER');
        },
        manifest: () => {
          calls.stage++;
          throw Error('UNEXPECTED_STAGE');
        },
      },
    ),
    /CUTOVER_TEST_READONLY_BARRIER/,
  );
  assert.deepEqual(calls, { config: 1, target: 1, journal: 1, stage: 0, service: 0 });
});
