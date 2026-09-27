import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = () => {
  throw new Error('CUTOVER_INVENTORY_UNPROVEN');
};
const retiredNames = new Map([
  ['holaday-orchestrator', 'main'],
  ['holaday-account-closure-worker', 'worker'],
  ['holaday-files-cron', 'cron'],
  ['holaday-cn-payment', 'gateway'],
]);
const lines = (text) => {
  if (typeof text !== 'string') fail();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
};

/** Pair the actual two-host observations with their separately reviewed source
 * and process identities. A review is trusted protected input, never generated
 * by this function. Unknowns stay visible and cannot become a stop/readiness
 * receipt. Boot changes invalidate the review even when numeric PIDs recur.
 */
export function classifyFirstCutoverHostPair(input, io = { now: Date.now }) {
  const { pair, reviews, inventoryDigest } = structuredClone(input ?? {});
  const names = ['aliyun', 'vultr'];
  if (
    !hash(inventoryDigest) ||
    !hash(pair?.sourceDigest) ||
    !Array.isArray(pair.hosts) ||
    pair.hosts.length !== 2 ||
    !names.every((name) => pair.hosts.filter((row) => row?.host === name).length === 1) ||
    !reviews ||
    Object.keys(reviews).length !== 2 ||
    !names.every((name) => Object.hasOwn(reviews, name))
  )
    fail();
  const now = io.now();
  const hosts = names.map((host) => {
    const { snapshot } = pair.hosts.find((row) => row.host === host);
    const approved = reviews[host];
    if (!approved || approved.bootId !== snapshot?.bootId) fail();
    return {
      host,
      ...classifyFirstCutoverHost(
        {
          snapshot,
          host,
          inventoryDigest,
          ports: approved.ports,
          review: approved.review,
        },
        { now: () => now },
      ),
    };
  });
  const observedAtMs = Math.min(...hosts.map((h) => h.registered.observedAtMs));
  if (pair.observedAtMs !== observedAtMs) fail();
  return {
    observedAtMs,
    inventoryDigest,
    sourceDigest: pair.sourceDigest,
    hosts,
    unknownLaunchers: hosts.flatMap((host) =>
      host.unknownLaunchers.map((row) => ({ host: host.host, ...row })),
    ),
  };
}

/** Fingerprints for EXPLICIT source review, not a launcher allowlist generator.
 * The caller must review referenced dependencies beyond the collector's bounded
 * roots too. A hash match establishes unchanged bytes, not their safety or scope.
 * No raw PM2 environments, nginx content or command lines leave this function. */
export function firstCutoverSourceBindings(snapshot) {
  if (
    !Array.isArray(snapshot?.startup?.files) ||
    !Array.isArray(snapshot.startup.directories) ||
    !Array.isArray(snapshot.nginxFiles) ||
    !hash(snapshot.pm2Runtime?.sourceDigest)
  )
    fail();
  const timers = lines(snapshot.timers)
    .map((line) => {
      const match = /(?:^|\s)([^\s]+\.timer)\s+([^\s]+\.service)$/.exec(line);
      if (!match) fail();
      return [match[1], match[2]];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  const bindings = [
    { key: 'pm2-runtime', digest: snapshot.pm2Runtime.sourceDigest },
    { key: 'pm2-unit', digest: digest(snapshot.startup.pm2Unit) },
    { key: 'systemd', digest: digest(lines(snapshot.systemd)) },
    { key: 'unit-files', digest: digest(lines(snapshot.unitFiles)) },
    { key: 'timers', digest: digest(timers) },
    {
      key: 'root-crontab',
      digest: digest({ present: snapshot.rootCrontabPresent, content: snapshot.cron }),
    },
  ];
  for (const [kind, records] of [
    ['startup', snapshot.startup.files],
    ['directory', snapshot.startup.directories],
    ['nginx', snapshot.nginxFiles],
  ]) {
    for (const record of records) {
      if (typeof record.path !== 'string' || !record.path.startsWith('/')) fail();
      const { content, ...metadata } = record;
      if (
        content !== undefined &&
        (typeof content !== 'string' ||
          createHash('sha256').update(content).digest('hex') !== record.digest)
      )
        fail();
      bindings.push({ key: `${kind}:${record.path}`, digest: digest(metadata) });
    }
  }
  if (new Set(bindings.map((row) => row.key)).size !== bindings.length) fail();
  return bindings.sort((a, b) => a.key.localeCompare(b.key));
}

/** Adapt an actual host snapshot plus its trusted, protected review to the EXISTING
 * runtime/registration capture APIs. This has no stop/write/approval side effects.
 * A missing review stays unknown; never filter an unknown process to make a scope
 * pass. review is not accepted from a CLI upload or used as a readiness report.
 * observer must be bound by the remote collector to its actual process.pid.
 * This is pre-retirement inventory; after effects, a new reviewed observation is
 * required. It does not pretend old PM2 sources remain unchanged after removal. */
export function classifyFirstCutoverHost(input, io = { now: Date.now }) {
  const { snapshot: s, review, host, ports, inventoryDigest } = structuredClone(input);
  const now = io.now();
  if (
    !['aliyun', 'vultr'].includes(host) ||
    !hash(inventoryDigest) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(s?.observedAtMs) ||
    s.observedAtMs < 0 ||
    s.observedAtMs > now ||
    now - s.observedAtMs > 60000 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.bootId ?? '') ||
    !Array.isArray(s.processes) ||
    !Array.isArray(s.managers) ||
    !Array.isArray(ports) ||
    !ports.length ||
    new Set(ports).size !== ports.length ||
    ports.some((p) => !Number.isSafeInteger(p) || p < 1 || p > 65535) ||
    (host === 'aliyun' ? [4010, 4011] : [4001, 4002]).some((port) => !ports.includes(port)) ||
    !Array.isArray(review?.processes) ||
    !Array.isArray(review.registrations) ||
    !Array.isArray(review.sources)
  )
    fail();
  const unique = (rows, key) => {
    if (
      rows.some((row) => !row || row[key] === undefined) ||
      new Set(rows.map((row) => row[key])).size !== rows.length
    )
      fail();
  };
  unique(s.processes, 'pid');
  unique(s.managers, 'pmId');
  unique(review.processes, 'pid');
  unique(review.registrations, 'pmId');
  unique(review.sources, 'key');
  for (const p of s.processes) {
    if (
      !Number.isSafeInteger(p.pid) ||
      p.pid <= 1 ||
      !Number.isSafeInteger(p.ppid) ||
      p.ppid < 1 ||
      !/^[0-9]+$/.test(p.start ?? '') ||
      !hash(p.argvDigest) ||
      !Array.isArray(p.uids) ||
      p.uids.length !== 4 ||
      p.uids.some((uid) => !Number.isSafeInteger(uid) || uid < 0) ||
      typeof p.cwd !== 'string' ||
      typeof p.exe !== 'string'
    )
      fail();
  }
  const runtime = s.pm2Runtime;
  const daemon = s.processes.find((p) => p.pid === runtime?.pid);
  const observer = s.processes.find((p) => p.pid === s.observer?.pid);
  if (
    !daemon ||
    !observer ||
    !equal(observer, s.observer) ||
    daemon.pid === observer.pid ||
    !equal(daemon.uids, [0, 0, 0, 0]) ||
    !['/usr/bin/node', '/opt/node22/bin/node'].includes(daemon.exe) ||
    runtime.version !== '6.0.14' ||
    !['SIGINT', 'SIGTERM'].includes(runtime.killSignal) ||
    !Number.isSafeInteger(runtime.killTimeoutMs) ||
    runtime.killTimeoutMs < 1 ||
    runtime.killTimeoutMs > 900000
  )
    fail();
  const unknown = [];
  const unresolved = (kind, id) => unknown.push({ kind, id });
  const sources = firstCutoverSourceBindings(s);
  const explained = (row) => typeof row?.reason === 'string' && row.reason.trim().length > 0;
  for (const source of sources) {
    const r = review.sources.find((row) => row.key === source.key);
    if (!explained(r) || r.digest !== source.digest) unresolved('source', source.key);
  }
  for (const r of review.sources)
    if (!sources.some((s) => s.key === r.key)) unresolved('missing-source', r.key);
  const selectedManagers = [];
  const preservedManagers = [];
  for (const m of s.managers) {
    if (
      !['online', 'stopped'].includes(m.status) ||
      (m.status === 'online' && !s.processes.some((p) => p.pid === m.pid && p.ppid === daemon.pid))
    )
      unresolved('manager-root', m.pmId);
    const r = review.registrations.find((row) => row.pmId === m.pmId);
    const requiredRole = retiredNames.get(m.name);
    if (
      !explained(r) ||
      !hash(m.configDigest) ||
      r.configDigest !== m.configDigest ||
      r.disposition !== (requiredRole ? 'retire' : 'preserve')
    ) {
      unresolved('registration', m.pmId);
      continue;
    }
    if (!requiredRole) {
      preservedManagers.push(m);
      continue;
    }
    const manager = {
      kind: 'pm2',
      pid: daemon.pid,
      start: daemon.start,
      exe: daemon.exe,
      argvDigest: daemon.argvDigest,
      pm2Home: '/root/.pm2',
      version: runtime.version,
      pmId: m.pmId,
      name: m.name,
      configDigest: m.configDigest,
      killTimeoutMs: m.killTimeoutMs ?? runtime.killTimeoutMs,
      killSignal: runtime.killSignal,
      watch: m.watch,
      cron: m.cronRestart ?? false,
      memoryRestart: m.maxMemoryRestart ?? 0,
      status: m.status,
      rootPid: m.pid,
    };
    selectedManagers.push(manager);
  }
  for (const r of review.registrations)
    if (!s.managers.some((m) => m.pmId === r.pmId)) unresolved('missing-registration', r.pmId);
  const roots = s.managers.filter((m) => Number.isSafeInteger(m.pid) && m.pid > 1);
  unique(roots, 'pid');
  const owner = (p) => {
    const seen = new Set();
    let current = p;
    while (current && current.pid !== daemon.pid) {
      if (seen.has(current.pid)) fail();
      seen.add(current.pid);
      const m = roots.find((row) => row.pid === current.pid);
      if (m) return m;
      current = s.processes.find((row) => row.pid === current.ppid);
    }
    return null;
  };
  const registered = [];
  const unmanaged = [];
  const preserved = [];
  for (const p of s.processes) {
    if ([daemon.pid, observer.pid].includes(p.pid)) continue;
    const r = review.processes.find((row) => row.pid === p.pid);
    if (!explained(r) || r.identityDigest !== digest(p)) {
      unresolved('process', p.pid);
      continue;
    }
    const m = owner(p);
    if (r.disposition === 'preserve') {
      // A known application writer/producer is not made irrelevant by a label.
      if (
        (m && !preservedManagers.some((row) => row.pmId === m.pmId)) ||
        /\/opt\/holaday-(?:monorepo\/apps\/orchestrator|cn-payment)(?:\/|$)/.test(p.cwd)
      ) {
        unresolved('preserved-writer', p.pid);
        continue;
      }
      preserved.push(p);
      continue;
    }
    const manager = m && selectedManagers.find((row) => row.pmId === m.pmId);
    if (
      r.disposition !== 'retire' ||
      !['main', 'worker', 'gateway'].includes(r.role) ||
      (m && (!manager || retiredNames.get(m.name) !== r.role)) ||
      (!m && r.role !== 'gateway')
    ) {
      unresolved('retirement', p.pid);
      continue;
    }
    const target = {
      host,
      bootId: s.bootId.replaceAll('-', ''),
      pid: p.pid,
      ppid: p.ppid,
      start: p.start,
      uids: p.uids,
      exe: p.exe,
      cwd: p.cwd,
      argvDigest: p.argvDigest,
      role: r.role,
      managerIdentity: manager ?? { kind: 'unmanaged' },
    };
    (m ? registered : unmanaged).push(target);
  }
  for (const r of review.processes)
    if (!s.processes.some((p) => p.pid === r.pid) || [daemon.pid, observer.pid].includes(r.pid))
      unresolved('invalid-process-review', r.pid);
  const listeners = [];
  for (const line of lines(s.listeners)) {
    const columns = line.split(/\s+/);
    const port = Number(/:(\d+)$/.exec(columns[3] ?? '')?.[1]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail();
    const pids = [...line.matchAll(/\bpid=(\d+)\b/g)].map((m) => Number(m[1]));
    if (!ports.includes(port)) {
      if (pids.some((pid) => [...registered, ...unmanaged].some((p) => p.pid === pid)))
        unresolved('unapproved-port', port);
      continue;
    }
    if (!pids.length) unresolved('listener-owner', port);
    for (const pid of new Set(pids)) {
      if (![...registered, ...unmanaged].some((p) => p.pid === pid)) unresolved('listener', pid);
      listeners.push({ port, pid });
    }
  }
  const scope = (processes, managers) => ({
    inventoryDigest,
    host,
    bootId: s.bootId.replaceAll('-', ''),
    observedAtMs: s.observedAtMs,
    ports,
    processes,
    managers,
    unknownLaunchers: unknown,
    listeners: listeners.filter((l) => processes.some((p) => p.pid === l.pid)),
  });
  return {
    registered: scope(registered, selectedManagers),
    unmanaged: scope(unmanaged, []),
    preservedProcesses: preserved,
    preservedManagers,
    unknownLaunchers: unknown,
    sources,
  };
}
