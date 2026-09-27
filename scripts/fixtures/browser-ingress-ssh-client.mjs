// Real authenticated SSH attach/validation in a disposable container, not deployment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { describeCutoverSite } from '/source/browser-first-cutover-fence.mjs';
import { connectFirstCutoverGatewaySession } from '/source/browser-first-cutover-gateway-session.mjs';
import { connectFirstCutoverIngressSession } from '/source/browser-first-cutover-ingress-session.mjs';
import { acquireReleaseJournal } from '/source/browser-maintenance-journal.mjs';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const root = process.argv[2];
assert.match(root, /^\/root\/cutover-ssh-qa-[a-zA-Z0-9_-]+$/);
const directory = '/var/lib/holaday-deploy/maintenance';
await fs.mkdir(directory, { mode: 0o700 });
const manifest = { synthetic: 'ssh-session-only' };
const hash = (s) => createHash('sha256').update(s).digest('hex');
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: hash(JSON.stringify(manifest)),
  inventoryDigest: 'd'.repeat(64),
};
const maintenanceEndsAtMs = Date.now() + 60000;
const approved = {
  schemaVersion: 1,
  kind: 'first-cutover',
  ...binding,
  legacyDigest: 'e'.repeat(64),
  branch: 'codex/qa-session',
  maintenanceEndsAtMs,
  reconcileByMs: maintenanceEndsAtMs + 60000,
  operatorRef: 'qa-fixture',
};
await fs.writeFile(`${directory}/first-cutover-approved.json`, JSON.stringify(approved), {
  mode: 0o600,
});
for (const p of ['/etc/nginx/sites-enabled', '/etc/nginx/sites-available'])
  await fs.mkdir(p, { recursive: true });
const files = [];
for (const [name, profile] of [
  ['hd-app.orangebench.tech', 'aliyun-app-20260926'],
  ['hd-pay.orangebench.tech', 'aliyun-pay-20260926'],
]) {
  const bytes = await fs.readFile(`/source/fixtures/cutover-nginx/${name}.conf`, 'utf8');
  const path = `/etc/nginx/sites-available/${name}`;
  const enabledPath = `/etc/nginx/sites-enabled/${name}`;
  await fs.writeFile(path, bytes, { mode: 0o644 });
  await fs.symlink(`../sites-available/${name}`, enabledPath);
  files.push({
    ...describeCutoverSite(bytes, profile),
    path,
    enabledPath,
    sourcePath: path,
    sourceUid: 0,
    sourceGid: 0,
    sourceMode: 0o644,
    links: [{ path: enabledPath, target: `../sites-available/${name}` }],
  });
}
const scope = {
  schemaVersion: 1,
  host: 'aliyun',
  binding,
  maintenanceEndsAtMs,
  ingress: { inventoryDigest: binding.inventoryDigest, unknownIngress: [], files },
};
const scopeBytes = JSON.stringify(scope);
await fs.writeFile(`${directory}/first-cutover-ingress-approved.json`, scopeBytes, { mode: 0o600 });
const journal = await acquireReleaseJournal(directory, {
  ...binding,
  kind: 'first-cutover',
  legacyDigest: approved.legacyDigest,
});
await journal.bindManifest(manifest);
let connects = 0;
const io = {
  journal,
  observeWriters: async () => {
    throw new Error('not an effect test');
  },
  verifyOpenedIdentity: async () => {
    throw new Error('not an effect test');
  },
  open: async (command, args, options) => {
    connects++;
    assert.equal(command, '/usr/bin/ssh');
    assert.equal(args.at(-2), 'root@47.99.169.186');
    const child = spawn(
      command,
      [
        '-F',
        '/dev/null',
        '-T',
        '-b',
        '207.148.70.106',
        '-p',
        '22222',
        '-i',
        `${root}/identity`,
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'IdentityAgent=none',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        `UserKnownHostsFile=${root}/known_hosts`,
        '-o',
        'GlobalKnownHostsFile=/dev/null',
        'root@127.0.0.1',
        args.at(-1),
      ],
      { ...options, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stderr.resume();
    const completion = new Promise((resolve) => child.once('close', (code) => resolve({ code })));
    return { input: child.stdout, output: child.stdin, completion };
  },
};
try {
  const expected = { binding, maintenanceEndsAtMs, siteDigest: hash(scopeBytes) };
  const client = await connectFirstCutoverIngressSession(expected, io);
  assert.equal(await client.readFenceReceipt(), undefined);
  await client.close();
  // Receiver must independently reject a changed application-writable approval.
  await fs.chmod(`${directory}/first-cutover-ingress-approved.json`, 0o644);
  await assert.rejects(
    connectFirstCutoverIngressSession(expected, io),
    /CUTOVER_INGRESS_SESSION_UNPROVEN/,
  );
  assert.equal(connects, 2); // Deliberate new readonly test, not an automatic retry.
  for (const file of files) assert.equal(hash(await fs.readFile(file.path)), file.digest);
  await assert.rejects(fs.access(`${directory}/${binding.attempt}.ingress.json`), {
    code: 'ENOENT',
  });
  console.log(
    'ingress SSH: real forced entry, pinned module bundle, protected approval, live owned journal, no-effect detach, changed-approval refusal passed',
  );
  const gatewayPath = `${directory}/first-cutover-gateway-approved.json`;
  const gatewayBytes = JSON.stringify({
    schemaVersion: 1,
    host: 'aliyun',
    binding,
    maintenanceEndsAtMs,
    startupFiles: [
      {
        path: '/root/.pm2/dump.pm2',
        digest: '1'.repeat(64),
        remove: [{ name: 'holaday-cn-payment', entryDigest: '2'.repeat(64) }],
      },
      { path: '/root/.pm2/dump.pm2.bak', digest: null, remove: [] },
    ],
  });
  await fs.writeFile(gatewayPath, gatewayBytes, { mode: 0o600 });
  const noEffect = async () => {
    throw new Error('not an effect test');
  };
  const gatewayIO = {
    journal,
    open: io.open,
    verifyFence: noEffect,
    observer: {
      read: noEffect,
      readRegistrationProgress: noEffect,
      readUnmanagedProgress: noEffect,
      retireUnmanaged: noEffect,
    },
  };
  const gatewayExpected = { binding, maintenanceEndsAtMs, siteDigest: hash(gatewayBytes) };
  const gatewayClient = await connectFirstCutoverGatewaySession(gatewayExpected, gatewayIO);
  await gatewayClient.close();
  await fs.chmod(gatewayPath, 0o644);
  await assert.rejects(
    connectFirstCutoverGatewaySession(gatewayExpected, gatewayIO),
    /CUTOVER_GATEWAY_SESSION_UNPROVEN/,
  );
  assert.equal(connects, 4);
  console.log(
    'gateway SSH: separate fixed entry, 24 pinned modules including signal helper, independent approval, live original journal, no-effect detach and writable-approval refusal passed',
  );
} finally {
  await journal.close();
}
