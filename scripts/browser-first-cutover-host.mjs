import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  collectCutoverEvidence,
  readCutoverDatabaseScope,
  readCutoverWorkScope,
} from './browser-cutover-evidence.mjs';
import { backupAndRestoreCheck } from './browser-first-cutover-backup.mjs';
import {
  applyCutoverFence,
  restoreCutoverIngress,
  verifyCutoverFence,
} from './browser-first-cutover-fence.mjs';
import { createCutoverIngressFiles } from './browser-first-cutover-ingress-files.mjs';
import {
  classifyFirstCutoverHostPair,
  classifyFirstCutoverRetirementPair,
} from './browser-first-cutover-inventory.mjs';
import {
  captureLegacyRuntime,
  initializeFirstMaintenanceState,
  retireLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';
import {
  candidatePreparationSystem,
  maintenanceCandidateEnvironment,
  parseMaintenanceCandidateConfig,
  stageReleaseCandidate,
} from './browser-maintenance-host.mjs';

const system = { ...fs, platform: process.platform, uid: process.getuid?.(), now: Date.now };
const directory = '/var/lib/holaday-deploy/maintenance';
const approvalPath = `${directory}/first-cutover-approved.json`;
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;
const fields = [
  'schemaVersion',
  'kind',
  'attempt',
  'branch',
  'candidate',
  'configDigest',
  'migrationDigest',
  'inventoryDigest',
  'legacyDigest',
  'maintenanceEndsAtMs',
  'reconcileByMs',
  'operatorRef',
];
const privateFile = (stat) =>
  stat.isFile() && stat.uid === 0 && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1;
const privateDirectory = (stat) =>
  stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o7777) === 0o700;

// Same closed tool set as the protected ingress bundle. These are source
// attestations, not readiness evidence or permission to perform a cutover.
const coordinatorModules = [
  'browser-backup-age.mjs',
  'browser-cutover-evidence.mjs',
  'browser-first-cutover-backup.mjs',
  'browser-first-cutover-fence.mjs',
  'browser-first-cutover-host.mjs',
  'browser-first-cutover-ingress-files.mjs',
  'browser-first-cutover-ingress-session.mjs',
  'browser-first-cutover-inventory.mjs',
  'browser-first-cutover-nginx.mjs',
  'browser-first-cutover-runtime.mjs',
  'browser-maintenance-host.mjs',
  'browser-maintenance-journal.mjs',
  'browser-maintenance-linux.mjs',
  'browser-maintenance-manifest.mjs',
  'browser-maintenance-policy.mjs',
  'browser-maintenance-release-tail.mjs',
  'browser-maintenance-runtime-system.mjs',
  'browser-maintenance-runtime.mjs',
  'browser-maintenance-transition.mjs',
  'browser-payment-port-fence.mjs',
];

/** Own fixed-entry Linux identity, pinned to protected approval and actual Git
 * candidate bytes. The trusted site holds this handle; no caller-provided PID
 * or receipt is accepted by the command entry. Any failed read ends its lifetime.
 */
export async function createFirstCutoverCoordinatorIdentity(input, overrides = {}) {
  const io = {
    fs,
    platform: process.platform,
    uid: process.getuid?.(),
    pid: process.pid,
    entry: fileURLToPath(import.meta.url),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    exec: candidatePreparationSystem().exec,
    ...overrides,
  };
  let closed = false;
  let initial;
  let originalApproval;
  let lastTime = -1;
  const reject = () => {
    throw new Error('CUTOVER_COORDINATOR_UNPROVEN');
  };
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const read = async () => {
    try {
      if (
        closed ||
        io.platform !== 'linux' ||
        io.uid !== 0 ||
        !input ||
        Object.keys(input).length !== 2 ||
        !uuid(input.attempt) ||
        input.mode !== 'check' ||
        !Number.isSafeInteger(io.pid) ||
        io.pid <= 1
      )
        reject();
      const approval = await io.readApproval({ attempt: input.attempt });
      const now = io.now();
      if (
        (originalApproval && !isDeepStrictEqual(originalApproval, approval)) ||
        approval.attempt !== input.attempt ||
        !/^[a-f0-9]{40}$/.test(approval.candidate ?? '') ||
        !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(approval.branch ?? '') ||
        !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) =>
          /^[a-f0-9]{64}$/.test(approval[k] ?? ''),
        ) ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < lastTime ||
        !Number.isSafeInteger(approval.maintenanceEndsAtMs) ||
        now >= approval.maintenanceEndsAtMs
      )
        reject();
      const folder = `/var/lib/holaday-deploy/first-cutover/${approval.candidate}`;
      const entry = `${folder}/browser-first-cutover-host.mjs`;
      if (io.entry !== entry) reject();
      const dir = await io.fs.lstat(folder);
      if (!privateDirectory(dir) || (await io.fs.realpath(folder)) !== folder) reject();
      const readPrivate = async (path) => {
        const handle = await io.fs.open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const a = await handle.stat();
          if (!privateFile(a) || a.size < 1 || a.size > 1024 * 1024) reject();
          const bytes = await handle.readFile();
          const b = await handle.stat();
          const c = await io.fs.lstat(path);
          if (
            ![b, c].every(
              (s) =>
                privateFile(s) &&
                sameFile(a, s) &&
                s.size === a.size &&
                s.mtimeMs === a.mtimeMs &&
                s.ctimeMs === a.ctimeMs,
            ) ||
            bytes.length !== a.size
          )
            reject();
          return bytes;
        } finally {
          await handle.close();
        }
      };
      const manifestBytes = await readPrivate(`${folder}/bundle.json`);
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      if (
        !isDeepStrictEqual(Object.keys(manifest).sort(), ['candidate', 'files', 'schemaVersion']) ||
        manifest.schemaVersion !== 1 ||
        manifest.candidate !== approval.candidate ||
        !isDeepStrictEqual(Object.keys(manifest.files).sort(), [...coordinatorModules].sort()) ||
        !isDeepStrictEqual(
          (await io.fs.readdir(folder)).sort(),
          [...coordinatorModules, 'bundle.json'].sort(),
        )
      )
        reject();
      const git = ['--no-replace-objects', '-C', '/opt/holaday-monorepo'];
      await io.exec('git', [
        ...git,
        'merge-base',
        '--is-ancestor',
        approval.candidate,
        `refs/remotes/origin/${approval.branch}`,
      ]);
      for (const name of coordinatorModules) {
        const bytes = await readPrivate(`${folder}/${name}`);
        const source = await io.exec('git', [
          ...git,
          'show',
          `${approval.candidate}:scripts/${name}`,
        ]);
        if (sha(bytes) !== manifest.files[name] || !bytes.equals(Buffer.from(source))) reject();
      }
      // Existing port-fence adapter reads this fixed module-relative resource.
      const policyRoot = '/var/lib/holaday-deploy/first-cutover/ops';
      for (const path of [policyRoot, `${policyRoot}/aliyun-edge`])
        if (!privateDirectory(await io.fs.lstat(path)) || (await io.fs.realpath(path)) !== path)
          reject();
      const policy = await readPrivate(`${policyRoot}/aliyun-edge/holaday-payment-ingress.nft`);
      if (
        sha(policy) !== 'de27f46f3bdad7d0c239c18a44e2775ef5c27e936d1a859f3f81d8fb8ee1cdb2' ||
        !policy.equals(
          Buffer.from(
            await io.exec('git', [
              ...git,
              'show',
              `${approval.candidate}:ops/aliyun-edge/holaday-payment-ingress.nft`,
            ]),
          ),
        )
      )
        reject();
      const currentDir = await io.fs.lstat(folder);
      if (
        !privateDirectory(currentDir) ||
        !sameFile(dir, currentDir) ||
        (await io.fs.realpath(folder)) !== folder ||
        !manifestBytes.equals(await readPrivate(`${folder}/bundle.json`))
      )
        reject();
      const processIdentity = async () => {
        const root = `/proc/${io.pid}`;
        const stat = await io.fs.readFile(`${root}/stat`, 'utf8');
        if (!stat.startsWith(`${io.pid} (`)) reject();
        const fields = stat
          .slice(stat.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/);
        const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m
          .exec(await io.fs.readFile(`${root}/status`, 'utf8'))
          ?.slice(1)
          .map(Number);
        const cmdline = await io.fs.readFile(`${root}/cmdline`);
        const bootId = (await io.fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
        const process = {
          pid: io.pid,
          ppid: Number(fields[1]),
          start: fields[19],
          uids,
          cwd: await io.fs.readlink(`${root}/cwd`),
          exe: await io.fs.readlink(`${root}/exe`),
          argvDigest: sha(cmdline),
          cgroup: await io.fs.readFile(`${root}/cgroup`, 'utf8'),
        };
        if (
          fields[0] === 'Z' ||
          !Number.isSafeInteger(process.ppid) ||
          process.ppid < 1 ||
          !/^[0-9]+$/.test(process.start ?? '') ||
          !isDeepStrictEqual(uids, [0, 0, 0, 0]) ||
          process.cwd !== '/' ||
          process.exe !== '/opt/node22/bin/node' ||
          !Buffer.from(`/opt/node22/bin/node\0${entry}\0--check\0${input.attempt}\0`).equals(
            cmdline,
          ) ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId) ||
          !process.cgroup ||
          process.cgroup.length > 65536
        )
          reject();
        return { bootId, process };
      };
      const self = await processIdentity();
      if (
        !isDeepStrictEqual(self, await processIdentity()) ||
        !isDeepStrictEqual(approval, await io.readApproval({ attempt: input.attempt })) ||
        io.now() < now ||
        io.now() >= approval.maintenanceEndsAtMs
      )
        reject();
      const finished = io.now();
      if (
        closed ||
        !Number.isSafeInteger(finished) ||
        finished < now ||
        finished >= approval.maintenanceEndsAtMs
      )
        reject();
      const result = {
        host: 'vultr',
        role: 'coordinator',
        binding: Object.fromEntries(
          ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map(
            (k) => [k, approval[k]],
          ),
        ),
        toolDigest: sha(manifestBytes),
        ...self,
      };
      if (initial && !isDeepStrictEqual(initial, result)) reject();
      initial ??= result;
      originalApproval ??= structuredClone(approval);
      lastTime = finished;
      return structuredClone(result);
    } catch {
      closed = true;
      reject();
    }
  };
  await read();
  return {
    readExecutionIdentity: read,
    close: () => {
      closed = true;
    },
  };
}

// Explicit inspection only. Until the original full site is wired, --execute
// must fail; source identity must never be reported as release readiness.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [mode, attempt, ...extra] = process.argv.slice(2);
    if (extra.length || !uuid(attempt) || !['--check', '--execute'].includes(mode))
      throw new Error('CUTOVER_COORDINATOR_USAGE');
    if (mode === '--execute') throw new Error('CUTOVER_COORDINATOR_SITE_UNAVAILABLE');
    const handle = await createFirstCutoverCoordinatorIdentity({ mode: 'check', attempt });
    try {
      const value = await handle.readExecutionIdentity();
      process.stdout.write(
        `${JSON.stringify({ kind: 'coordinator-source-inspection', candidate: value.binding.candidate, toolDigest: value.toolDigest, releaseReady: false })}\n`,
      );
    } finally {
      handle.close();
    }
  } catch (error) {
    process.stderr.write(
      `${/^CUTOVER_COORDINATOR_[A-Z_]+$/.test(error.message) ? error.message : 'CUTOVER_COORDINATOR_UNPROVEN'}\n`,
    );
    process.exitCode = 1;
  }
}

/** Real read-only transport for the two reviewed deployment hosts. Linux root
 * uses the dedicated Vultr channel and a local observer; the Mac audit path
 * retains existing administrator SSH/askpass. Raw snapshots contain private
 * configuration: return them to the trusted caller, never log them. No host
 * classification, approval, readiness, lock, remote file or service mutation is
 * implied. Both reads settle before return, including a failed pair; no retry.
 */
export async function readFirstCutoverHostPair(overrides = {}) {
  const io = {
    now: Date.now,
    randomUUID,
    readObserverSource: () =>
      fs.readFile(new URL('./browser-cutover-evidence.mjs', import.meta.url)),
    exec: candidatePreparationSystem().exec,
    transport:
      process.platform === 'linux' && process.getuid?.() === 0 ? 'root-channel' : 'administrator',
    platform: process.platform,
    uid: process.getuid?.(),
    ...overrides,
  };
  try {
    if (
      !['administrator', 'root-channel'].includes(io.transport) ||
      (io.transport === 'root-channel' && (io.platform !== 'linux' || io.uid !== 0))
    )
      throw new Error('transport');
    const rootChannel = io.transport === 'root-channel';
    const began = io.now();
    const requestUuid = io.randomUUID();
    if (!uuid(requestUuid)) throw new Error('request');
    const requestId = rootChannel ? requestUuid.replaceAll('-', '') : requestUuid;
    const source = Buffer.from(await io.readObserverSource());
    if (
      !Number.isSafeInteger(began) ||
      began < 0 ||
      source.length < 1 ||
      source.length > 1024 * 1024 ||
      !Buffer.from(source.toString('utf8')).equals(source)
    )
      throw new Error('input');
    const sourceDigest = createHash('sha256').update(source).digest('hex');
    const common = [
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ForwardAgent=no',
      '-o',
      'ClearAllForwardings=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=10',
      '-o',
      'ServerAliveCountMax=2',
      '-T',
    ];
    const requests = rootChannel
      ? [
          {
            host: 'aliyun',
            command: '/usr/bin/ssh',
            channel: true,
            args: [
              '-F',
              '/dev/null',
              ...common,
              '-o',
              'BatchMode=yes',
              '-o',
              'IdentitiesOnly=yes',
              '-o',
              'IdentityAgent=none',
              '-o',
              'PreferredAuthentications=publickey',
              '-o',
              'PasswordAuthentication=no',
              '-o',
              'KbdInteractiveAuthentication=no',
              '-o',
              'UserKnownHostsFile=/var/lib/holaday-deploy/channel/known_hosts',
              '-o',
              'GlobalKnownHostsFile=/dev/null',
              '-o',
              'HostKeyAlgorithms=ssh-ed25519',
              '-i',
              '/var/lib/holaday-deploy/channel/identity',
              'root@47.99.169.186',
              `holaday-cutover-v1 observe ${requestId}`,
            ],
          },
          { host: 'vultr', command: '/opt/node22/bin/node', args: ['--input-type=module'] },
        ]
      : [
          {
            host: 'aliyun',
            args: [...common, 'root@47.99.169.186', '/usr/bin/node --input-type=module'],
          },
          {
            host: 'vultr',
            args: [
              ...common,
              '-o',
              'ProxyCommand=ssh -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ConnectTimeout=15 -W %h:%p root@47.99.169.186',
              'root@207.148.70.106',
              '/opt/node22/bin/node --input-type=module',
            ],
          },
        ];
    const read = async ({ host, args, command = 'ssh', channel = false }) => {
      // This self-contained, existing collector is sent only through stdin; no
      // arbitrary operation/target parameter or remote installation is accepted.
      const envelope = { protocol: 1, requestId, host, sourceDigest };
      const input = `${source.toString('utf8')}\ntry {
  process.env.GIT_OPTIONAL_LOCKS = '0';
  const readSource = async () => {
    if (${JSON.stringify(host)} !== 'vultr') return null;
    const head = (await hostSystem.exec('git', ['-C', '/opt/holaday-monorepo', 'rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('checkout');
    await hostSystem.exec('git', ['-C', '/opt/holaday-monorepo', 'diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--']);
    return head;
  };
  const sourceCandidate = await readSource();
  const snapshot = await readCutoverHostSnapshot();
  snapshot.observer = snapshot.processes.find(row => row.pid === process.pid);
  if (!snapshot.observer || await readSource() !== sourceCandidate) throw new Error('observer');
  process.stdout.write(JSON.stringify({...${JSON.stringify(envelope)}, sourceCandidate, snapshot}));
} catch {
  process.stderr.write('CUTOVER_HOST_PAIR_UNPROVEN\\n'); process.exitCode = 1;
}\n`;
      const output = await io.exec(command, args, {
        ...(channel ? {} : { input }),
        shell: false,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (typeof output !== 'string' || Buffer.byteLength(output) > 16 * 1024 * 1024)
        throw new Error('output');
      const result = JSON.parse(output);
      if (
        !Object.entries(envelope).every(([key, value]) => result?.[key] === value) ||
        (host === 'vultr'
          ? !/^[a-f0-9]{40}$/.test(result.sourceCandidate ?? '')
          : result.sourceCandidate !== null)
      )
        throw new Error('response');
      return { host, sourceCandidate: result.sourceCandidate, snapshot: result.snapshot };
    };
    const results = [];
    if (rootChannel) {
      // The local collector follows descendants of this coordinator. Finish
      // the transient observe SSH first so it cannot appear/disappear midway
      // through that snapshot. Still settle both reads once, never retry.
      for (const request of requests) results.push(...(await Promise.allSettled([read(request)])));
    } else {
      results.push(...(await Promise.allSettled(requests.map(read))));
    }
    if (results.some((result) => result.status !== 'fulfilled')) throw new Error('transport');
    const hosts = results.map((result) => result.value);
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < began) throw new Error('clock');
    for (const { snapshot } of hosts) {
      if (
        !Number.isSafeInteger(snapshot?.observedAtMs) ||
        snapshot.observedAtMs < 0 ||
        snapshot.observedAtMs > now ||
        now - snapshot.observedAtMs > 60000 ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(snapshot.bootId ?? '') ||
        !Number.isSafeInteger(snapshot.observer?.pid) ||
        snapshot.observer.pid <= 1 ||
        !Array.isArray(snapshot.processes) ||
        snapshot.processes.filter((p) => p.pid === snapshot.observer.pid).length !== 1 ||
        !isDeepStrictEqual(
          snapshot.processes.find((p) => p.pid === snapshot.observer.pid),
          snapshot.observer,
        )
      )
        throw new Error('snapshot');
    }
    return {
      sourceDigest,
      sourceCandidate: hosts.find(({ host }) => host === 'vultr').sourceCandidate,
      observedAtMs: Math.min(...hosts.map(({ snapshot }) => snapshot.observedAtMs)),
      hosts,
    };
  } catch {
    // Do not expose process/config contents or SSH diagnostics to public output.
    throw new Error('CUTOVER_HOST_PAIR_UNPROVEN');
  }
}

/** Source proof for prepareFirstCutoverCandidate's existing inspectLegacySource
 * boundary. Reviews must come from the protected site inventory: this function
 * never creates or approves them. A fresh two-host read must match every review.
 * Hash physical identities and reviewed source fingerprints, not transient
 * observation time or the collector process. No raw environment leaves here.
 */
export async function readReviewedFirstCutoverLegacySource(input, overrides = {}) {
  const io = {
    readPair: readFirstCutoverHostPair,
    readExecutionIdentities: async () => [],
    now: Date.now,
    ...overrides,
  };
  try {
    const { reviews, inventoryDigest, binding } = structuredClone(input);
    if (
      !/^[a-f0-9]{64}$/.test(inventoryDigest ?? '') ||
      !reviews ||
      Object.keys(reviews).length !== 2 ||
      !reviews.aliyun ||
      !reviews.vultr
    )
      throw new Error('review');
    const began = io.now();
    const execution = structuredClone(await io.readExecutionIdentities());
    const pair = await io.readPair();
    if (
      !Array.isArray(execution) ||
      !isDeepStrictEqual(execution, await io.readExecutionIdentities()) ||
      execution.some((receipt) => !binding || !isDeepStrictEqual(receipt.binding, binding)) ||
      (execution.length &&
        (Object.keys(binding).length !== 5 ||
          !uuid(binding.attempt) ||
          !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
          !/^[a-f0-9]{64}$/.test(binding.configDigest ?? '') ||
          !/^[a-f0-9]{64}$/.test(binding.migrationDigest ?? '') ||
          binding.inventoryDigest !== inventoryDigest))
    )
      throw new Error('execution');
    const now = io.now();
    if (
      !Number.isSafeInteger(began) ||
      began < 0 ||
      !Number.isSafeInteger(now) ||
      now < began ||
      !/^[a-f0-9]{40}$/.test(pair?.sourceCandidate ?? '') ||
      pair.hosts?.find((h) => h.host === 'vultr')?.sourceCandidate !== pair.sourceCandidate ||
      pair.hosts?.find((h) => h.host === 'aliyun')?.sourceCandidate !== null
    )
      throw new Error('source');
    const actual = classifyFirstCutoverHostPair(
      { pair, reviews, inventoryDigest, execution },
      { now: () => now },
    );
    if (actual.unknownLaunchers.length) throw new Error('unreviewed');
    const byNumber = (key) => (a, b) => a[key] - b[key];
    const canonical = (value) =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
            )
          : value;
    const scope = (s) => ({
      host: s.host,
      bootId: s.bootId,
      ports: [...s.ports].sort((a, b) => a - b),
      processes: [...s.processes].sort(byNumber('pid')),
      managers: [...s.managers].sort(byNumber('pmId')),
      listeners: [...s.listeners].sort((a, b) => a.port - b.port || a.pid - b.pid),
    });
    const physical = actual.hosts.map((host) => ({
      host: host.host,
      registered: scope(host.registered),
      unmanaged: scope(host.unmanaged),
      preservedProcesses: [...host.preservedProcesses].sort(byNumber('pid')),
      preservedManagers: [...host.preservedManagers].sort(byNumber('pmId')),
      sources: host.sources,
    }));
    const legacyDigest = createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            inventoryDigest,
            sourceCandidate: pair.sourceCandidate,
            collectorDigest: pair.sourceDigest,
            hosts: physical,
          }),
        ),
      )
      .digest('hex');
    return {
      sourceCandidate: pair.sourceCandidate,
      legacyDigest,
      observedAtMs: actual.observedAtMs,
    };
  } catch {
    throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
  }
}

/** Read the candidate's real control socket as the application user, bracketing
 * the existing full local runtime observer. Read-only and fixed argv only. */
export async function readFirstCutoverCandidateRuntime(identity, overrides = {}) {
  const io = { ...candidatePreparationSystem(), ...overrides };
  const fail = () => {
    throw new Error('CUTOVER_CANDIDATE_OBSERVATION_UNPROVEN');
  };
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !identity ||
      Object.keys(identity).length !== 2 ||
      !/^[a-f0-9]{40}$/.test(identity.candidate ?? '') ||
      !/^[a-f0-9]{32}$/.test(identity.bootId ?? '')
    )
      fail();
    const root = `/opt/holaday-releases/${identity.candidate}`;
    const read = async () => {
      const status = JSON.parse(
        await io.exec(
          'runuser',
          [
            '-u',
            'holaday',
            '--',
            '/opt/node22/bin/node',
            `${root}/scripts/browser-maintenance-control.mjs`,
            'status',
            identity.candidate,
            identity.bootId,
          ],
          {
            cwd: `${root}/apps/orchestrator`,
            env: {
              PATH: '/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
              PM2_HOME: '/root/.pm2',
            },
          },
        ),
      );
      if (
        status.protocol !== 1 ||
        !isDeepStrictEqual(status.identity, identity) ||
        !['closed', 'serving'].includes(status.mode) ||
        typeof status.idle !== 'boolean' ||
        typeof status.needsReconciliation !== 'boolean'
      )
        fail();
      return {
        identity: status.identity,
        mode: status.mode,
        idle: status.idle,
        needsReconciliation: status.needsReconciliation,
      };
    };
    const before = await read();
    const runtime = await io.observe(identity);
    if (
      !isDeepStrictEqual(before, await read()) ||
      !isDeepStrictEqual(runtime.identity, identity) ||
      runtime.root !== root
    )
      fail();
    return { ...before, runtime };
  } catch {
    fail();
  }
}

/** Use the already staged candidate and protected approved configuration. Each
 * read owns one dedicated connection, never a pool or an application's session.
 * No dotenv auto-loading, provider API call, lease cleanup or status mutation.
 */
export async function readFirstCutoverPersistedWork(context, overrides = {}) {
  return withApprovedCutoverDatabase(
    context,
    overrides,
    'CUTOVER_WORK_OBSERVATION_UNPROVEN',
    (connection, io) => readCutoverWorkScope(connection, { now: io.now }),
  );
}

/** This maps only explicit approved metadata. It does not prove historical
 * merchant ownership, query a provider, or manufacture a recovery receipt. */
export async function readFirstCutoverPaymentScope(context, input, overrides = {}) {
  const code = 'CUTOVER_PAYMENT_OBSERVATION_UNPROVEN';
  try {
    const inventory = structuredClone(input);
    if (
      !inventory ||
      createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
        context?.binding?.inventoryDigest ||
      !Number.isSafeInteger(inventory.paymentWindowStartMs) ||
      inventory.paymentWindowStartMs < 0 ||
      inventory.paymentWindowStartMs >= context.approval.maintenanceEndsAtMs ||
      !Array.isArray(inventory.merchants)
    )
      throw new Error(code);
    const merchants = new Map();
    for (const m of inventory.merchants) {
      if (
        !['wechat', 'alipay'].includes(m?.provider) ||
        !['sandbox', 'production'].includes(m.environment) ||
        !/^[a-f0-9]{64}$/.test(m.merchantDigest ?? '') ||
        merchants.has(m.provider)
      )
        throw new Error(code);
      merchants.set(m.provider, { merchantDigest: m.merchantDigest, environment: m.environment });
    }
    return await withApprovedCutoverDatabase(context, overrides, code, (connection, io) =>
      readCutoverDatabaseScope(connection, {
        now: io.now,
        windowStartMs: inventory.paymentWindowStartMs,
        deferredSandboxPayment: inventory.deferredSandboxPayment,
        deferredAlipayPayments: inventory.deferredAlipayPayments,
        resolveMerchant: (provider, row) => {
          const merchant = merchants.get(provider);
          const metadata =
            typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          if (!merchant || (metadata?.env !== undefined && metadata.env !== merchant.environment))
            throw new Error(code);
          return structuredClone(merchant);
        },
      }),
    );
  } catch {
    throw new Error(code);
  }
}

/** Select the original backup plan only after physical stop has been checked by
 * the site. This verifies the connected SOURCE, not target isolation or restore;
 * the existing backup coordinator must independently verify both databases. */
export async function readFirstCutoverBackupPlan(context, input, overrides = {}) {
  const code = 'CUTOVER_BACKUP_PLAN_UNPROVEN';
  try {
    const inventory = structuredClone(input);
    const plan = inventory?.backupPlan;
    const validIdentity = (v) =>
      v &&
      isDeepStrictEqual(Object.keys(v).sort(), ['database', 'serverUuid']) &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.serverUuid ?? '') &&
      /^[a-zA-Z0-9_]{1,64}$/.test(v.database ?? '');
    if (
      !inventory ||
      createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
        context?.binding?.inventoryDigest ||
      !plan ||
      !isDeepStrictEqual(Object.keys(plan).sort(), ['isolatedTarget', 'sourceIdentity']) ||
      !validIdentity(plan.sourceIdentity) ||
      !validIdentity(plan.isolatedTarget) ||
      plan.sourceIdentity.serverUuid === plan.isolatedTarget.serverUuid
    )
      throw new Error(code);
    const record = structuredClone(await context.journal.readFirstCutoverEffects());
    const assertPhase = async () => {
      if (
        record.phase !== 'backup_verified' ||
        !['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].every(
          (k) => record[k] === context.binding[k],
        ) ||
        !isDeepStrictEqual(record, await context.journal.readFirstCutoverEffects())
      )
        throw new Error(code);
    };
    await assertPhase();
    return await withApprovedCutoverDatabase(context, overrides, code, async (connection) => {
      for (let sample = 0; sample < 2; sample++) {
        await assertPhase();
        const [rows] = await connection.query(
          'SELECT @@server_uuid AS serverUuid, DATABASE() AS `database`',
        );
        if (
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          !isDeepStrictEqual(rows[0], plan.sourceIdentity)
        )
          throw new Error(code);
      }
      await assertPhase();
      return plan;
    });
  } catch {
    throw new Error(code);
  }
}

async function withApprovedCutoverDatabase(context, overrides, errorCode, read) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    connectWorkDatabase: (uri, root) =>
      createRequire(`${root}/apps/orchestrator/package.json`)('mysql2/promise').createConnection({
        uri,
        connectTimeout: 5000,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        jsonStrings: true,
        timezone: 'Z',
      }),
    ...overrides,
  };
  const fail = () => {
    throw new Error(errorCode);
  };
  let connection;
  let firstTime;
  try {
    const binding = structuredClone(context?.binding);
    const guard = async () => {
      const now = io.now();
      if (
        io.platform !== 'linux' ||
        io.uid !== 0 ||
        !/^[a-f0-9]{40}$/.test(binding?.candidate ?? '') ||
        !/^[a-f0-9]{64}$/.test(binding?.configDigest ?? '') ||
        context.root !== `/opt/holaday-releases/${binding.candidate}` ||
        !['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].every(
          (k) => context.approval?.[k] === binding[k],
        ) ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        (firstTime !== undefined && now < firstTime) ||
        !Number.isSafeInteger(context.approval.maintenanceEndsAtMs) ||
        now >= context.approval.maintenanceEndsAtMs ||
        !isDeepStrictEqual(await context.journal.assertOwnership(), binding)
      )
        fail();
      firstTime ??= now;
      const bytes = await io.readConfig();
      if (createHash('sha256').update(bytes).digest('hex') !== binding.configDigest) fail();
      return bytes;
    };
    const bytes = await guard();
    const config = io.parseConfig(bytes, context.root);
    const url = new URL(config.DATABASE_URL);
    if (url.protocol !== 'mysql:' || !url.hostname || url.pathname.length < 2) fail();
    connection = await io.connectWorkDatabase(config.DATABASE_URL, context.root);
    const work = await read(connection, io);
    await guard();
    return work;
  } catch {
    fail();
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        fail();
      }
    }
  }
}

/** Capture the approved baseline BEFORE effects and keep it private for later
 * observations. The same live journal is read on both sides of each fresh pair;
 * no uploaded event log, automatic baseline refresh, or "all stopped" fallback.
 * This does not by itself verify fences or authorize advancement of the release.
 */
export async function createFirstCutoverRetirementObserver(input, overrides = {}) {
  const io = {
    readPair: readFirstCutoverHostPair,
    readFenceReceipts: async () => [],
    // Trusted live session handles, never a CLI/uploaded process allowlist.
    readExecutionIdentities: async () => [],
    readCandidateRuntime: readFirstCutoverCandidateRuntime,
    now: Date.now,
    ...overrides,
  };
  const fail = () => {
    throw new Error('CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN');
  };
  try {
    const { reviews, binding, legacyDigest } = structuredClone(input);
    let last = io.now();
    const effects = async () => {
      if (!isDeepStrictEqual(await io.journal.assertOwnership(), binding)) fail();
      const record = await io.journal.readFirstCutoverEffects();
      if (
        !Object.entries(binding).every(([key, value]) => record[key] === value) ||
        record.legacyDigest !== legacyDigest
      )
        fail();
      return record;
    };
    const first = await effects();
    if (
      !['preflight', 'prepared'].includes(first.phase) ||
      first.startupEvents.length ||
      first.registrationEvents.length ||
      first.unmanagedEvents?.length ||
      !isDeepStrictEqual(await io.readFenceReceipts(), [])
    )
      fail();
    let baseline;
    let baselineExecution;
    const proof = await readReviewedFirstCutoverLegacySource(
      { reviews, inventoryDigest: binding.inventoryDigest, binding },
      {
        readPair: async () => {
          baseline = structuredClone(await io.readPair());
          return baseline;
        },
        readExecutionIdentities: async () => {
          baselineExecution = structuredClone(await io.readExecutionIdentities());
          return baselineExecution;
        },
        now: io.now,
      },
    );
    if (
      proof.legacyDigest !== legacyDigest ||
      !isDeepStrictEqual(first, await effects()) ||
      !isDeepStrictEqual(await io.readFenceReceipts(), [])
    )
      fail();
    const checkClock = () => {
      const now = io.now();
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(last) || last < 0 || now < last)
        fail();
      last = now;
      return now;
    };
    checkClock();
    const read = async (
      requestedRegistrationHost,
      requestedUnmanagedHost,
      candidateIdentity,
      fenceProgress = false,
    ) => {
      try {
        checkClock();
        const before = await effects();
        let registrationProgressHost = requestedRegistrationHost;
        let unmanagedProgressHost = requestedUnmanagedHost;
        if (fenceProgress) {
          // Read-only in-flight fence checks use the existing progress classifier,
          // with scope selected by THIS owned journal, never caller-supplied host.
          // Strict completion reads below keep their original semantics.
          if (before.phase === 'producers_stopped') registrationProgressHost = 'vultr';
          else if (['all_fenced', 'stopped'].includes(before.phase)) {
            if (before.unmanagedEvents?.length === 1) unmanagedProgressHost = 'aliyun';
            else registrationProgressHost = 'aliyun';
          }
        }
        const execution = structuredClone(await io.readExecutionIdentities());
        const fences = structuredClone(await io.readFenceReceipts());
        const candidate =
          candidateIdentity === undefined
            ? undefined
            : await io.readCandidateRuntime(candidateIdentity);
        if (
          candidateIdentity !== undefined &&
          !isDeepStrictEqual(candidate?.identity, candidateIdentity)
        )
          fail();
        const pair = structuredClone(await io.readPair());
        if (
          !isDeepStrictEqual(before, await effects()) ||
          !isDeepStrictEqual(execution, await io.readExecutionIdentities()) ||
          !isDeepStrictEqual(fences, await io.readFenceReceipts()) ||
          (candidateIdentity !== undefined &&
            !isDeepStrictEqual(candidate, await io.readCandidateRuntime(candidateIdentity))) ||
          pair.sourceCandidate !== baseline.sourceCandidate ||
          pair.sourceDigest !== baseline.sourceDigest ||
          !['aliyun', 'vultr'].every(
            (host) =>
              pair.hosts.find((h) => h.host === host)?.sourceCandidate ===
              baseline.hosts.find((h) => h.host === host)?.sourceCandidate,
          )
        )
          fail();
        const result = classifyFirstCutoverRetirementPair(
          {
            baseline,
            baselineExecution,
            pair,
            reviews,
            inventoryDigest: binding.inventoryDigest,
            effects: before,
            fences,
            registrationProgressHost,
            unmanagedProgressHost,
            candidate,
            execution,
          },
          { now: checkClock },
        );
        if (result.unknownLaunchers.length) fail();
        if (fenceProgress) return { purpose: 'fence-progress', pair: result };
        if (registrationProgressHost !== undefined)
          return {
            purpose: 'registration-progress',
            host: registrationProgressHost,
            inventory: result.hosts.find((h) => h.host === registrationProgressHost).registered,
          };
        if (unmanagedProgressHost !== undefined)
          return {
            purpose: 'unmanaged-progress',
            host: unmanagedProgressHost,
            inventory: result.hosts.find((h) => h.host === unmanagedProgressHost).unmanaged,
          };
        return result;
      } catch {
        fail();
      }
    };
    let unmanagedAttempted = false;
    return {
      read: () => read(),
      readFenceProgress: () => read(undefined, undefined, undefined, true),
      readRegistrationProgress: (host) => read(host ?? 'invalid'),
      readUnmanagedProgress: (host) => read(undefined, host ?? 'invalid'),
      readWithCandidate: (identity) => read(undefined, undefined, structuredClone(identity ?? {})),
      // Signal execution is a trusted, fixed-host I/O seam; production supplies
      // createLegacyRuntimeEffects on that host, never a command from approval.
      retireUnmanaged: async ({ maintenanceEndsAtMs }, operations) => {
        if (
          unmanagedAttempted ||
          !Number.isSafeInteger(maintenanceEndsAtMs) ||
          ['verifyFence', 'sleep', 'signalPinned'].some(
            (k) => typeof operations?.[k] !== 'function',
          )
        )
          fail();
        unmanagedAttempted = true;
        const remaining = maintenanceEndsAtMs - checkClock();
        if (remaining <= 0 || remaining > 900000 || (await effects()).phase !== 'stopped') fail();
        const inventory = (await read()).hosts.find((h) => h.host === 'aliyun').unmanaged;
        const captured = await captureLegacyRuntime(
          { inventory, approvedTargets: inventory.processes },
          { now: checkClock },
        );
        const original = baseline.hosts.find((h) => h.host === 'aliyun').snapshot;
        const base = {
          attempt: binding.attempt,
          inventoryDigest: binding.inventoryDigest,
          host: 'aliyun',
          targets: captured.targets
            .map((p) => ({
              pid: p.pid,
              identityDigest: createHash('sha256')
                .update(JSON.stringify(original.processes.find((r) => r.pid === p.pid)))
                .digest('hex'),
            }))
            .sort((a, b) => a.pid - b.pid),
        };
        await io.journal.recordUnmanagedEvent({ ...base, phase: 'unmanaged-stop-intent' });
        const left = maintenanceEndsAtMs - checkClock();
        if (left <= 0) fail();
        const result = await retireLegacyRuntime(
          { captured, deadlineMs: left },
          {
            now: checkClock,
            sleep: operations.sleep,
            verifyFence: operations.verifyFence,
            signalPinned: operations.signalPinned,
            assertJournalOwnership: () => io.journal.assertOwnership(),
            readInventory: async () => (await read(undefined, 'aliyun')).inventory,
          },
        );
        await io.journal.recordUnmanagedEvent({ ...base, phase: 'unmanaged-stopped' });
        await read();
        return result;
      },
    };
  } catch {
    fail();
  }
}

/** Compose the first lifecycle around ONE real prepared journal. Site-specific
 * two-host observations/effects remain mandatory trusted I/O, not uploaded
 * success reports. No default site adapter, shell entry or old protocol identity.
 * Import/construction has no effects. Call finish with the transition result to
 * close handles; only completed reconciliation may release the persisted lock.
 */
export function createFirstCutoverHostAdapter(options, overrides = {}) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    ...overrides,
  };
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (!options || Object.keys(options).length !== 1 || !uuid(options.attempt))
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  const request = { attempt: options.attempt };
  const required = {
    lifecycle: [
      'attach',
      'detach',
      'fenceOrders',
      'settleLegacy',
      'stopProducers',
      'fenceAll',
      'stopLegacy',
      'assertStopped',
      'verifyFence',
      'restoreIngress',
      'resumeWorker',
      'reconcile',
      'holdMaintenance',
      'readBackupPlan',
    ],
    backup: [
      'readDatabaseIdentity',
      'inspectBackupFacility',
      'exportDatabase',
      'hashArtifact',
      'restoreIsolated',
      'compareInventoryAndData',
      'runApprovedMigrations',
      'verifySchema',
      'readSourceDigest',
    ],
    evidence: [
      'readHostInventory',
      'readDatabaseScope',
      'queryOrders',
      'readRehearsalArtifacts',
      'readFenceState',
    ],
  };
  if (
    typeof io.inspectLegacySource !== 'function' ||
    Object.entries(required).some(([group, names]) =>
      names.some((name) => typeof io[group]?.[name] !== 'function'),
    )
  )
    throw new Error('CUTOVER_HOST_OBSERVER_REQUIRED');
  // Retain methods, not caller-mutable groups. All are trusted host operations.
  for (const group of Object.keys(required)) io[group] = { ...io[group] };
  let approval;
  let prepared;
  let env;
  let phase = 'preflight';
  let identity;
  let stoppedEvidence;
  let seed;
  let migrated = false;
  let reconciled = false;
  let siteAttachStarted = false;
  let siteDetachStarted = false;
  let siteDetached = false;
  let lastTime = -1;
  const attempted = new Set();
  const reject = () => {
    throw new Error('CUTOVER_HOST_STATE_UNPROVEN');
  };
  const context = () => ({
    approval: structuredClone(approval),
    binding: structuredClone(prepared.binding),
    root: prepared.root,
    applicationGid: prepared.applicationGid,
    journal: prepared.journal,
  });
  const detachSite = async () => {
    if (siteDetached) return;
    if (siteDetachStarted) reject();
    siteDetachStarted = true;
    // Resource closure never authorizes another effect or clears the journal.
    // A failed/lost acknowledgement is not replayed by finish().
    await io.lifecycle.detach(context());
    siteDetached = true;
  };
  const clock = (reconciling = false) => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now < lastTime ||
      now >= (reconciling ? approval?.reconcileByMs : approval?.maintenanceEndsAtMs)
    )
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = now;
  };
  const ownership = async () => {
    const bound = await prepared.journal.assertOwnership();
    if (!isDeepStrictEqual(bound, prepared.binding))
      throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    return bound;
  };
  const guard = async (reconciling = false) => {
    clock(reconciling);
    if (prepared) await ownership();
    // Approval's maintenance expiry is deliberately not extended. Reconciliation
    // uses the original protected absolute reconcile deadline and retained lock.
    if (!reconciling && !isDeepStrictEqual(await io.readApproval(request), approval))
      throw new Error('CUTOVER_APPROVAL_UNPROVEN');
    clock(reconciling);
  };
  const once = async (name, expected, effect, reconciling = false) => {
    if (phase !== expected || attempted.has(name)) reject();
    attempted.add(name); // Uncertain effects cannot be replayed by this adapter.
    await guard(reconciling);
    const value = await effect();
    await guard(reconciling);
    return value;
  };
  const assertStopped = async () => {
    await guard();
    const actual = await io.lifecycle.assertStopped(context(), structuredClone(stoppedEvidence));
    const now = io.now();
    if (
      actual?.inventoryDigest !== prepared.binding.inventoryDigest ||
      actual.phase !== 'stopped' ||
      !Number.isSafeInteger(actual.observedAtMs) ||
      actual.observedAtMs < 0 ||
      actual.observedAtMs > now ||
      now - actual.observedAtMs > 60000 ||
      !['survivors', 'listeners', 'unknownLaunchers'].every(
        (k) => Array.isArray(actual[k]) && actual[k].length === 0,
      )
    )
      throw new Error('CUTOVER_RUNTIME_UNPROVEN');
    const fence = await io.lifecycle.verifyFence(context());
    const observedNow = io.now();
    if (
      fence?.inventoryDigest !== prepared.binding.inventoryDigest ||
      fence.stage !== 'all-writers' ||
      !Number.isSafeInteger(fence.observedAtMs) ||
      fence.observedAtMs < 0 ||
      fence.observedAtMs > observedNow ||
      observedNow - fence.observedAtMs > 60000 ||
      fence.existingSockets !== 0 ||
      fence.internalWriters !== 0 ||
      fence.unsettledWork !== 0 ||
      fence.externalWork !== 0 ||
      fence.producersRunning !== 0
    )
      throw new Error('CUTOVER_FENCE_UNPROVEN');
    await guard();
    return structuredClone(actual);
  };
  const sameIdentity = (value) =>
    value?.candidate === approval?.candidate &&
    /^[a-f0-9]{32}$/.test(value?.bootId ?? '') &&
    (!identity || value.bootId === identity.bootId);
  const control = async (op, target, discovery = false) => {
    if (!prepared || (!discovery && !sameIdentity(target)))
      throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    const args = [
      '-u',
      'holaday',
      '--',
      '/opt/node22/bin/node',
      '--import',
      'tsx',
      `${prepared.root}/scripts/browser-maintenance-control.mjs`,
      op,
    ];
    if (!discovery) args.push(target.candidate, target.bootId);
    const value = JSON.parse(
      await io.exec('runuser', args, { cwd: `${prepared.root}/apps/orchestrator`, env }),
    );
    if (
      value?.protocol !== 1 ||
      !sameIdentity(value.identity) ||
      (!discovery && value.identity.bootId !== target.bootId)
    )
      throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    return value;
  };
  const readiness = async (target) => {
    await guard();
    const { binding, root, applicationGid } = prepared;
    const scope = {
      binding: { ...binding },
      stage: target ? 'preopen' : 'prepare',
      window: {
        maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
        reconcileByMs: approval.reconcileByMs,
        operatorRef: approval.operatorRef,
      },
      ...(target ? { identity: { ...target } } : {}),
    };
    await collectCutoverEvidence(scope, {
      now: io.now,
      assertJournalOwnership: ownership,
      ...Object.fromEntries(
        ['readHostInventory', 'readDatabaseScope', 'readRehearsalArtifacts', 'readFenceState'].map(
          (name) => [name, () => io.evidence[name](structuredClone(scope))],
        ),
      ),
      queryOrders: (orders) => io.evidence.queryOrders(orders, structuredClone(scope)),
      publishPrivate: (evidence) =>
        io.publishEvidence(evidence, { applicationGid, assertJournalOwnership: ownership }),
    });
    await guard();
    await io.exec(
      'runuser',
      [
        '-u',
        'holaday',
        '--',
        '/opt/node22/bin/node',
        '--import',
        'tsx',
        `${root}/apps/orchestrator/scripts/browser-maintenance-readiness.ts`,
        target ? 'verify' : 'services',
        binding.attempt,
        binding.candidate,
        binding.configDigest,
        binding.migrationDigest,
        binding.inventoryDigest,
        ...(target ? [target.bootId] : []),
      ],
      { cwd: `${root}/apps/orchestrator`, env },
    );
    await guard();
  };
  const assertManifest = async () => {
    if (io.manifest(prepared.root).sha256 !== approval.migrationDigest)
      throw new Error('MAINTENANCE_MIGRATIONS_UNPROVEN');
    if (
      createHash('sha256')
        .update(await io.readConfig())
        .digest('hex') !== approval.configDigest
    )
      throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
    await guard();
  };
  const adapter = {
    preflight: async (candidate) => {
      if (approval) reject();
      approval = structuredClone(await io.readApproval(request));
      if (approval.candidate !== candidate || approval.attempt !== request.attempt)
        throw new Error('CUTOVER_APPROVAL_UNPROVEN');
      await guard();
    },
    stage: () =>
      once('stage', 'preflight', async () => {
        prepared = await prepareFirstCutoverCandidate(request, io);
        if (!isDeepStrictEqual(prepared.approval, approval))
          throw new Error('CUTOVER_APPROVAL_UNPROVEN');
        const bytes = await io.readConfig();
        if (createHash('sha256').update(bytes).digest('hex') !== approval.configDigest)
          throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
        env = maintenanceCandidateEnvironment(
          parseMaintenanceCandidateConfig(bytes, prepared.root, io),
          approval.candidate,
        );
        siteAttachStarted = true;
        await io.lifecycle.attach(context());
        await guard();
        await readiness();
      }),
    persist: async (next, detail) => {
      await guard(next === 'reconciled');
      await prepared.journal.persist(next, detail);
      phase = next;
    },
    ...Object.fromEntries(
      [
        ['fenceOrders', 'orders_fenced'],
        ['settleLegacy', 'legacy_settled'],
        ['stopProducers', 'producers_stopped'],
        ['fenceAll', 'all_fenced'],
      ].map(([name, at]) => [name, () => once(name, at, () => io.lifecycle[name](context()))]),
    ),
    stopLegacy: () =>
      once('stopLegacy', 'stopped', async () => {
        stoppedEvidence = structuredClone(await io.lifecycle.stopLegacy(context()));
        stoppedEvidence = await assertStopped();
      }),
    backupAndRestoreCheck: () =>
      once('backupAndRestoreCheck', 'backup_verified', async () => {
        const plan = await io.lifecycle.readBackupPlan(context());
        if (
          !plan ||
          Object.keys(plan).length !== 2 ||
          !Object.hasOwn(plan, 'sourceIdentity') ||
          !Object.hasOwn(plan, 'isolatedTarget')
        )
          throw new Error('CUTOVER_BACKUP_UNPROVEN');
        await backupAndRestoreCheck(
          { ...plan, binding: prepared.binding, maintenanceEndsAtMs: approval.maintenanceEndsAtMs },
          {
            ...io.backup,
            now: io.now,
            assertOwnership: ownership,
            assertWritersStopped: assertStopped,
            sealReceipt: (receipt) => prepared.journal.bindBackupReceipt(receipt),
          },
        );
      }),
    migrate: () =>
      once('migrate', 'migration_started', async () => {
        await assertStopped();
        await assertManifest();
        for (const script of ['db:migrate:numbered', 'db:verify']) {
          await guard();
          await io.exec('pnpm', ['--filter', '@holaday/orchestrator', script], {
            cwd: prepared.root,
            env,
          });
          await guard();
        }
        migrated = true;
      }),
    initializeState: () =>
      once('initializeState', 'migration_started', async () => {
        if (!migrated) reject();
        stoppedEvidence = await assertStopped();
        const result = await initializeFirstMaintenanceState(
          { candidate: approval.candidate, attempt: approval.attempt, stoppedEvidence },
          {
            platform: io.platform,
            uid: io.uid,
            fs: io.stateFs,
            now: io.now,
            applicationGid: prepared.applicationGid,
            assertJournalOwnership: ownership,
            assertStopped,
            verifyFence: () => io.lifecycle.verifyFence(context()),
            recordBootstrap: (value) => prepared.journal.bindBootstrapSeed(value),
          },
        );
        seed = result.bootstrapSeed;
      }),
    start: () =>
      once('start', 'candidate_started', async () => {
        if (!seed || !migrated) reject();
        await assertStopped();
        await assertManifest();
        const root = prepared.root;
        await io.exec(
          'pm2',
          [
            'start',
            `${root}/scripts/start-orchestrator-production.sh`,
            '--name',
            'holaday-orchestrator',
            '--interpreter',
            '/usr/bin/bash',
            '--cwd',
            `${root}/apps/orchestrator`,
            '--uid',
            '998',
            '--gid',
            String(prepared.applicationGid),
            '--no-autorestart',
          ],
          { cwd: root, env },
        );
        const until = Math.min(io.now() + 60000, approval.maintenanceEndsAtMs);
        for (;;) {
          await guard();
          let status;
          try {
            status = await control('status', undefined, true);
          } catch (error) {
            if (io.now() >= until) throw error;
            await io.sleep(100);
            continue;
          }
          identity = { ...status.identity }; // Retain known identity even on dirty-start failure.
          if (
            identity.bootId === seed ||
            status.mode !== 'closed' ||
            status.idle !== true ||
            status.needsReconciliation !== false
          )
            throw new Error('MAINTENANCE_START_UNPROVEN');
          await io.observe(identity);
          return { ...identity };
        }
      }),
    verify: (target) =>
      once('verify', 'candidate_started', async () => {
        if (!sameIdentity(target)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
        await io.observe(target);
        await readiness(target);
      }),
    beforeOpen: (target) =>
      once('beforeOpen', 'verified', async () => {
        if (!sameIdentity(target)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
        await io.observe(target);
        await readiness(target);
      }),
    open: (target) => once('open', 'verified', () => control('open', target)),
    status: async (target) => {
      await guard();
      return control('status', target);
    },
    close: (target) => control('close', target), // Protective close is never deadline-gated.
    afterOpen: (target) =>
      once('afterOpen', 'verified', async () => {
        const status = await control('status', target);
        if (
          status.mode !== 'serving' ||
          status.idle !== false ||
          status.needsReconciliation !== true
        )
          throw new Error('MAINTENANCE_OPEN_UNPROVEN');
        await io.lifecycle.restoreIngress(context(), target);
      }),
    resumeWorker: (target) =>
      once('resumeWorker', 'verified', async () => {
        await io.lifecycle.resumeWorker(context(), target);
        await guard();
        await detachSite();
      }),
    reconcile: (target) =>
      once(
        'reconcile',
        'reconciled',
        async () => {
          if (!sameIdentity(target)) throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
          await io.lifecycle.reconcile(context(), target);
          reconciled = true;
        },
        true,
      ),
    holdMaintenance: async (result) => {
      let closeAcknowledged = result.closeAcknowledged === true;
      if (identity && !closeAcknowledged) {
        try {
          closeAcknowledged = (await control('close', identity)).mode === 'closed';
        } catch {
          closeAcknowledged = false;
        }
      }
      if (prepared)
        await io.lifecycle.holdMaintenance(context(), { ...result, identity, closeAcknowledged });
      return { closeAcknowledged };
    },
    finish: async (result) => {
      if (!prepared) return;
      try {
        if (siteAttachStarted && !siteDetachStarted) await detachSite();
        if (result.ok) {
          if (
            !siteDetached ||
            !reconciled ||
            phase !== 'reconciled' ||
            !sameIdentity(result.identity)
          )
            reject();
          await guard(true);
          await prepared.journal.finish();
        }
      } catch (error) {
        await adapter.holdMaintenance({ phase, closeAcknowledged: false });
        throw error;
      } finally {
        await prepared.journal.close();
      }
    },
  };
  return adapter;
}

/** Preparation segment of the first host, not a deploy command or readiness
 * proof. Real source classification is mandatory and has no permissive default.
 * A successful return retains the actual journal for the remaining lifecycle;
 * failure closes handles only, preserving the lock and any staged candidate.
 */
export async function prepareFirstCutoverCandidate(options, overrides = {}) {
  const io = {
    ...candidatePreparationSystem(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    ...overrides,
  };
  if (io.platform !== 'linux' || io.uid !== 0) throw new Error('MAINTENANCE_LINUX_ROOT_REQUIRED');
  if (!options || Object.keys(options).length !== 1 || !uuid(options.attempt))
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  if (typeof io.inspectLegacySource !== 'function')
    throw new Error('CUTOVER_HOST_OBSERVER_REQUIRED');
  const approval = structuredClone(await io.readApproval(options));
  const binding = Object.fromEntries(
    ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map((key) => [
      key,
      approval[key],
    ]),
  );
  const root = `/opt/holaday-releases/${approval.candidate}`;
  const sourceRoot = '/opt/holaday-monorepo';
  let journal;
  let lastTime = -1;
  const guard = async () => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now < lastTime ||
      now >= approval.maintenanceEndsAtMs
    )
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = now;
    if (!isDeepStrictEqual(await io.readApproval(options), approval))
      throw new Error('CUTOVER_APPROVAL_UNPROVEN');
    if (journal && !isDeepStrictEqual(await journal.assertOwnership(), binding))
      throw new Error('MAINTENANCE_JOURNAL_UNPROVEN');
    const after = io.now();
    if (!Number.isSafeInteger(after) || after < now || after >= approval.maintenanceEndsAtMs)
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = after;
  };
  const source = async () => {
    const observed = await io.inspectLegacySource(structuredClone(approval));
    const now = io.now();
    if (
      !/^[a-f0-9]{40}$/.test(observed?.sourceCandidate ?? '') ||
      observed.legacyDigest !== approval.legacyDigest ||
      !Number.isSafeInteger(observed.observedAtMs) ||
      observed.observedAtMs < 0 ||
      observed.observedAtMs > now ||
      now - observed.observedAtMs > 60000
    )
      throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
    return observed.sourceCandidate;
  };
  try {
    await guard();
    const sourceCandidate = await source();
    const config = Buffer.from(await io.readConfig());
    if (createHash('sha256').update(config).digest('hex') !== approval.configDigest)
      throw new Error('MAINTENANCE_CONFIG_UNPROVEN');
    const parsed = parseMaintenanceCandidateConfig(config, sourceRoot, io);
    if ((await io.exec('id', ['-u', 'holaday'])).trim() !== '998')
      throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
    const gidText = (await io.exec('id', ['-g', 'holaday'])).trim();
    const gid = Number(gidText);
    if (!/^[1-9][0-9]*$/.test(gidText) || !Number.isSafeInteger(gid))
      throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
    await io.targetAbsent(root);
    await guard();
    journal = await io.journal(directory, {
      ...binding,
      kind: 'first-cutover',
      legacyDigest: approval.legacyDigest,
    });
    await guard();
    await stageReleaseCandidate(
      {
        branch: approval.branch,
        candidate: approval.candidate,
        sourceRoot,
        sourceCandidate,
        config,
        configDigest: approval.configDigest,
        migrationDigest: approval.migrationDigest,
        gid,
        env: maintenanceCandidateEnvironment(parsed, approval.candidate),
      },
      {
        ...io,
        assertOwnership: guard,
        bindManifest: async (manifest) => {
          if (
            (await source()) !== sourceCandidate ||
            createHash('sha256')
              .update(await io.readConfig())
              .digest('hex') !== approval.configDigest
          )
            throw new Error('CUTOVER_LEGACY_SOURCE_UNPROVEN');
          await guard();
          await journal.bindManifest(manifest);
        },
      },
    );
    return { approval, binding, root, sourceCandidate, applicationGid: gid, journal };
  } catch (error) {
    await journal?.close();
    throw error;
  }
}

/** Read-only approval metadata, not evidence that hosts/payments are safe.
 * The future host adapter must still collect live facts under its real journal.
 * Importing this module never starts a service, opens a database, or reads secrets. */
export async function readFirstCutoverApproval(options, io = system) {
  let handle;
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !options ||
      Object.keys(options).length !== 1 ||
      !uuid(options.attempt)
    )
      throw new Error('input');
    const began = io.now();
    if (!Number.isSafeInteger(began) || began < 0) throw new Error('clock');
    const folder = await io.lstat(directory);
    if (!privateDirectory(folder) || (await io.realpath(directory)) !== directory)
      throw new Error('directory');
    handle = await io.open(
      approvalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!privateFile(before) || before.size < 1 || before.size > 64 * 1024) throw new Error('file');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await io.lstat(approvalPath);
    const currentFolder = await io.lstat(directory);
    if (
      !privateFile(after) ||
      !privateFile(current) ||
      !sameFile(before, after) ||
      !sameFile(after, current) ||
      before.size !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.size !== current.size ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs ||
      !privateDirectory(currentFolder) ||
      !sameFile(folder, currentFolder) ||
      (await io.realpath(directory)) !== directory ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)
    )
      throw new Error('changed');
    const record = JSON.parse(bytes.toString('utf8'));
    const now = io.now();
    if (
      !record ||
      Object.keys(record).length !== fields.length ||
      !fields.every((k) => Object.hasOwn(record, k)) ||
      record.schemaVersion !== 1 ||
      record.kind !== 'first-cutover' ||
      record.attempt !== options.attempt ||
      typeof record.branch !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(record.branch) ||
      typeof record.candidate !== 'string' ||
      !/^[a-f0-9]{40}$/.test(record.candidate) ||
      !['configDigest', 'migrationDigest', 'inventoryDigest', 'legacyDigest'].every(
        (k) => typeof record[k] === 'string' && /^[a-f0-9]{64}$/.test(record[k]),
      ) ||
      !Number.isSafeInteger(record.maintenanceEndsAtMs) ||
      !Number.isSafeInteger(record.reconcileByMs) ||
      record.reconcileByMs < record.maintenanceEndsAtMs ||
      !Number.isSafeInteger(now) ||
      now < began ||
      now >= record.maintenanceEndsAtMs ||
      typeof record.operatorRef !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(record.operatorRef)
    )
      throw new Error('binding');
    return { ...record, approvalDigest: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    throw new Error('CUTOVER_APPROVAL_UNPROVEN');
  } finally {
    await handle?.close();
  }
}

/** Local ingress slice of the existing first-cutover lifecycle. The site owns
 * the protected approval reader and LIVE shared journal; these callbacks are
 * trusted code, not a deserialized authorization or a remote success report.
 * Construction observes only. Each mutation requires the persisted phase intent,
 * pins that journal revision throughout the operation, and is attempted once.
 * Files/store/nginx/TLS default to the actual local Linux implementations.
 * This does not replace business settlement, stop proof, or cross-host transport.
 */
export async function createFirstCutoverIngressLifecycle(input, overrides = {}) {
  const reject = () => {
    throw new Error('CUTOVER_INGRESS_LIFECYCLE_UNPROVEN');
  };
  try {
    const io = { platform: process.platform, uid: process.getuid?.(), now: Date.now, ...overrides };
    const { binding, maintenanceEndsAtMs } = structuredClone(input);
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      ['assertOwnership', 'readFirstCutoverEffects'].some(
        (k) => typeof io.journal?.[k] !== 'function',
      ) ||
      ['readApprovedIngress', 'observeWriters', 'verifyOpenedIdentity'].some(
        (k) => typeof io[k] !== 'function',
      )
    )
      reject();
    const journal = {
      assertOwnership: io.journal.assertOwnership.bind(io.journal),
      readFirstCutoverEffects: io.journal.readFirstCutoverEffects.bind(io.journal),
    };
    let last = -1;
    let approval = null;
    let revision;
    let busy = false;
    let failed = false;
    const attempted = new Set();
    const clock = () => {
      const now = io.now();
      if (!Number.isSafeInteger(now) || now < 0 || now < last || now >= maintenanceEndsAtMs)
        reject();
      last = now;
    };
    const guard = async (phases) => {
      clock();
      if (!isDeepStrictEqual(await journal.assertOwnership(), binding)) reject();
      const record = await journal.readFirstCutoverEffects();
      if (
        !Object.entries(binding).every(([key, value]) => record[key] === value) ||
        !/^[a-f0-9]{64}$/.test(record.recordDigest ?? '') ||
        (revision !== undefined && revision !== record.recordDigest) ||
        (phases && !phases.includes(record.phase))
      )
        reject();
      const current = structuredClone(await io.readApprovedIngress());
      if (
        current?.inventoryDigest !== binding.inventoryDigest ||
        !Array.isArray(current.unknownIngress) ||
        current.unknownIngress.length ||
        (approval && !isDeepStrictEqual(current, approval))
      )
        reject();
      clock();
      return { record, current };
    };
    const initial = await guard(['preflight', 'prepared']);
    approval = initial.current;
    revision = initial.record.recordDigest;
    const assertJournalOwnership = async () => {
      await guard();
      return structuredClone(binding);
    };
    const dependencies = {
      ...io,
      assertJournalOwnership,
      readApprovedIngress: async () => {
        await guard();
        return structuredClone(approval);
      },
      nginx: { ...io.nginx, maintenanceEndsAtMs },
      ingressProbe: { ...io.ingressProbe, observeWriters: io.observeWriters },
      verifyOpenedIdentity: async (identity) => {
        const { record } = await guard(['verified']);
        if (
          !isDeepStrictEqual(record.identity, identity) ||
          identity.candidate !== binding.candidate
        )
          reject();
        const opened = await io.verifyOpenedIdentity(structuredClone(identity));
        if (
          !isDeepStrictEqual(opened?.identity, identity) ||
          opened.mode !== 'serving' ||
          opened.idle !== false ||
          opened.needsReconciliation !== true
        )
          reject();
        await guard(['verified']);
        return opened;
      },
    };
    const args = { binding, files: approval.files, maintenanceEndsAtMs };
    Object.assign(dependencies, await createFirstCutoverFenceStore(args, dependencies));
    Object.assign(dependencies, await createCutoverIngressFiles(args, dependencies));
    await guard(['preflight', 'prepared']);
    revision = undefined;
    const run = async (name, phases, operation, mutation = false) => {
      if (busy || (mutation && (failed || attempted.has(name)))) reject();
      busy = true;
      if (mutation) attempted.add(name);
      try {
        const { record } = await guard(phases);
        revision = record.recordDigest;
        const value = await operation();
        await guard(phases);
        return value;
      } catch {
        if (mutation) failed = true;
        reject();
      } finally {
        revision = undefined;
        busy = false;
      }
    };
    const verifyPhases = [
      'all_fenced',
      'stopped',
      'backup_verified',
      'migration_started',
      'candidate_started',
      'verified',
    ];
    return {
      fenceOrders: () =>
        run(
          'orders',
          ['orders_fenced'],
          () =>
            applyCutoverFence(
              { inventoryDigest: binding.inventoryDigest, stage: 'orders' },
              dependencies,
            ),
          true,
        ),
      fenceAll: () =>
        run(
          'all-writers',
          ['all_fenced'],
          () =>
            applyCutoverFence(
              { inventoryDigest: binding.inventoryDigest, stage: 'all-writers' },
              dependencies,
            ),
          true,
        ),
      verifyFence: () =>
        run('verify', verifyPhases, () =>
          verifyCutoverFence(
            { inventoryDigest: binding.inventoryDigest, stage: 'all-writers' },
            dependencies,
          ),
        ),
      verifyOrders: () =>
        run('verify-orders', ['orders_fenced', 'legacy_settled', 'producers_stopped'], () =>
          verifyCutoverFence(
            { inventoryDigest: binding.inventoryDigest, stage: 'orders' },
            dependencies,
          ),
        ),
      restoreIngress: (identity) =>
        run(
          'restore',
          ['verified'],
          () =>
            restoreCutoverIngress(
              { inventoryDigest: binding.inventoryDigest, identity: structuredClone(identity) },
              dependencies,
            ),
          true,
        ),
      // Preserve read-only access to an uncertain installing/restoring receipt;
      // it is diagnostic evidence, never an instruction to replay the operation.
      readFenceReceipt: () => run('receipt', undefined, () => dependencies.readFenceReceipt()),
    };
  } catch {
    reject();
  }
}

/** Durable local-host receipts for the existing fence protocol. Caller supplies
 * the real shared journal and protected file scope. Never resumes an old attempt,
 * proves isolation, reloads nginx or grants permission to restore on its own.
 * The journal excludes cooperative concurrent deployment; this is not root-adversary CAS.
 */
export async function createFirstCutoverFenceStore(input, io) {
  const disk = io.fs ?? fs;
  const reject = () => {
    throw new Error('CUTOVER_FENCE_RECORD_UNPROVEN');
  };
  const wrap =
    (operation) =>
    async (...args) => {
      try {
        return await operation(...args);
      } catch {
        reject();
      }
    };
  return wrap(async () => {
    const { binding, files, maintenanceEndsAtMs } = structuredClone(input);
    const bindingKeys = [
      'attempt',
      'candidate',
      'configDigest',
      'migrationDigest',
      'inventoryDigest',
    ];
    const hash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
    if (
      (io.platform ?? process.platform) !== 'linux' ||
      (io.uid ?? process.getuid?.()) !== 0 ||
      !binding ||
      Object.keys(binding).length !== bindingKeys.length ||
      !uuid(binding.attempt) ||
      !/^[a-f0-9]{40}$/.test(binding.candidate ?? '') ||
      !['configDigest', 'migrationDigest', 'inventoryDigest'].every((key) => hash(binding[key])) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      !Array.isArray(files) ||
      !files.length ||
      files.length > 3 ||
      new Set(files.map((f) => f.path)).size !== files.length ||
      files.some(
        (f) =>
          !/^\/etc\/nginx\/sites-available\/(?:holaday|hd-app\.orangebench\.tech|hd-pay\.orangebench\.tech)$/.test(
            f.path ?? '',
          ) || !hash(f.digest),
      )
    )
      reject();
    let lastTime = -1;
    let failed = false;
    let current;
    let currentStat;
    let currentBytes;
    let queue = Promise.resolve();
    const path = `${directory}/${binding.attempt}.ingress.json`;
    const sameStat = (a, b) =>
      ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].every(
        (key) => a[key] === b[key],
      );
    const guard = async () => {
      const now = io.now();
      if (
        failed ||
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < lastTime ||
        now >= maintenanceEndsAtMs
      )
        reject();
      const owner = await io.assertJournalOwnership();
      const after = io.now();
      if (
        !bindingKeys.every((key) => owner?.[key] === binding[key]) ||
        !Number.isSafeInteger(after) ||
        after < now ||
        after >= maintenanceEndsAtMs
      )
        reject();
      lastTime = after;
    };
    await guard();
    const folder = await disk.lstat(directory);
    const checkFolder = async () => {
      const current = await disk.lstat(directory);
      if (
        !privateDirectory(current) ||
        !sameFile(folder, current) ||
        (await disk.realpath(directory)) !== directory
      )
        reject();
    };
    await checkFolder();
    const absent = async () => {
      try {
        await disk.lstat(path);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      reject();
    };
    await absent(); // A partial/historical record is never an invitation to resume.
    const read = async () => {
      await guard();
      await checkFolder();
      if (!current) {
        await absent();
        return undefined;
      }
      const h = await disk.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await h.stat();
        if (!privateFile(before) || !sameStat(currentStat, before) || before.size > 16 * 1024)
          reject();
        const bytes = await h.readFile();
        if (
          !bytes.equals(currentBytes) ||
          !sameStat(before, await h.stat()) ||
          !sameStat(before, await disk.lstat(path))
        )
          reject();
      } finally {
        await h.close();
      }
      await checkFolder();
      await guard();
      return structuredClone(current);
    };
    const phase = (r) => (r ? `${r.stage}:${r.phase}` : 'new');
    const phases = [
      'new',
      'orders:installing',
      'orders:active',
      'all-writers:installing',
      'all-writers:active',
      'all-writers:restoring',
      'all-writers:restored',
    ];
    const validate = (r) => {
      const restoring = ['restoring', 'restored'].includes(r?.phase);
      const keys = [
        'schemaVersion',
        'attempt',
        'inventoryDigest',
        'stage',
        'phase',
        'files',
        ...(restoring ? ['identity'] : []),
      ];
      if (
        !r ||
        Object.keys(r).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(r, key)) ||
        r.schemaVersion !== 1 ||
        r.attempt !== binding.attempt ||
        r.inventoryDigest !== binding.inventoryDigest ||
        phases.indexOf(phase(r)) !== phases.indexOf(phase(current)) + 1 ||
        !Array.isArray(r.files) ||
        r.files.length !== files.length
      )
        reject();
      for (const [index, expected] of files.entries()) {
        const value = r.files[index];
        if (
          !value ||
          Object.keys(value).length !== 4 ||
          value.path !== expected.path ||
          value.originalDigest !== expected.digest ||
          value.backupDigest !== expected.digest ||
          !hash(value.generatedDigest)
        )
          reject();
      }
      // Only the start of the next isolation stage may change generated content.
      if (current && r.phase !== 'installing' && !isDeepStrictEqual(r.files, current.files))
        reject();
      if (
        restoring &&
        (!r.identity ||
          Object.keys(r.identity).length !== 2 ||
          r.identity.candidate !== binding.candidate ||
          !/^[a-f0-9]{32}$/.test(r.identity.bootId ?? '') ||
          (r.phase === 'restored' && !isDeepStrictEqual(r.identity, current.identity)))
      )
        reject();
    };
    const persist = async (r) => {
      validate(r);
      await read();
      const bytes = Buffer.from(`${JSON.stringify(r)}\n`);
      if (bytes.length > 16 * 1024) reject();
      const destination = current
        ? `${directory}/${binding.attempt}.${randomUUID()}.ingress.tmp`
        : path;
      let h;
      let folderHandle;
      try {
        await guard();
        await checkFolder();
        folderHandle = await disk.open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        if (!sameFile(folder, await folderHandle.stat())) reject();
        h = await disk.open(
          destination,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await h.writeFile(bytes);
        await h.sync();
        const written = await h.stat();
        if (!privateFile(written) || written.size !== bytes.length) reject();
        await h.close();
        h = undefined;
        if (current) await read();
        await checkFolder();
        if (!sameStat(written, await disk.lstat(destination))) reject();
        await guard();
        if (current) await disk.rename(destination, path);
        await folderHandle.sync();
        const installed = await disk.lstat(path);
        if (
          !privateFile(installed) ||
          !sameFile(written, installed) ||
          installed.size !== bytes.length
        )
          reject();
        current = structuredClone(r);
        currentBytes = bytes;
        currentStat = installed;
        await read();
      } catch (error) {
        failed = true; // Preserve uncertain files and stop; never retry or auto-clean.
        throw error;
      } finally {
        await h?.close();
        await folderHandle?.close();
      }
    };
    const serial = (operation) => {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    };
    return {
      readFenceReceipt: () => serial(wrap(read)),
      persistFenceReceipt: (value) => {
        const record = structuredClone(value);
        return serial(wrap(() => persist(record)));
      },
    };
  })();
}
