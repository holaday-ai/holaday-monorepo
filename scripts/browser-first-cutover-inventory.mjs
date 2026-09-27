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

/** Reconcile completed, named-host registration retirements against the ORIGINAL
 * reviewed snapshot. The host obtains effects from its owned live journal. This
 * is an observation, never permission to delete, a replacement review, or proof
 * of ingress isolation. Source changes without separate evidence remain unknown.
 */
export function classifyFirstCutoverRetirementPair(input, io = { now: Date.now }) {
  const {
    baseline,
    pair,
    reviews,
    inventoryDigest,
    effects,
    fences = [],
    registrationProgressHost,
    unmanagedProgressHost,
    candidate,
  } = structuredClone(input);
  if (candidate !== undefined) {
    const { identity, runtime, mode } = candidate ?? {};
    if (
      registrationProgressHost !== undefined ||
      unmanagedProgressHost !== undefined ||
      !['candidate_started', 'verified', 'opened', 'reconciled'].includes(effects?.phase) ||
      identity?.candidate !== effects.candidate ||
      !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '') ||
      identity.bootId === effects.bootstrapSeed ||
      (effects.identity && !equal(identity, effects.identity)) ||
      !equal(runtime?.identity, identity) ||
      runtime.root !== `/opt/holaday-releases/${identity.candidate}` ||
      (mode === 'closed'
        ? candidate.idle !== true ||
          candidate.needsReconciliation !== false ||
          runtime.worker !== null
        : mode !== 'serving' ||
          effects.phase === 'candidate_started' ||
          candidate.idle !== false ||
          candidate.needsReconciliation !== true)
    )
      fail();
    const live = pair.hosts.find((h) => h.host === 'vultr').snapshot;
    const old = baseline.hosts.find((h) => h.host === 'vultr').snapshot;
    const selected = [];
    for (const [role, name] of [
      ['main', 'holaday-orchestrator'],
      ['worker', 'holaday-account-closure-worker'],
    ]) {
      const p = runtime[role];
      if (role === 'worker' && p === null) continue;
      const actual = live.processes.find((r) => r.pid === p?.pid);
      const managers = live.managers.filter((m) => m.name === name);
      if (
        !p ||
        !actual ||
        p.uid !== 998 ||
        p.command !== role ||
        p.autorestart !== false ||
        p.cwd !== `${runtime.root}/apps/orchestrator` ||
        p.start !== actual.start ||
        p.cwd !== actual.cwd ||
        !equal(actual.uids, [998, 998, 998, 998]) ||
        actual.exe !== '/opt/node22/bin/node' ||
        actual.ppid !== live.pm2Runtime.pid ||
        old.processes.some((r) => r.pid === p.pid) ||
        managers.length !== 1 ||
        managers[0].pid !== p.pid ||
        managers[0].status !== 'online' ||
        managers[0].watch ||
        managers[0].cronRestart ||
        managers[0].maxMemoryRestart
      )
        fail();
      selected.push({ pid: p.pid, pmId: managers[0].pmId });
    }
    const candidatePorts = new Set();
    live.listeners = lines(live.listeners)
      .filter((line) => {
        const port = Number(/:(\d+)$/.exec(line.split(/\s+/)[3] ?? '')?.[1]);
        if (![4001, 4002].includes(port)) return true;
        const pids = [...line.matchAll(/\bpid=(\d+)\b/g)].map((m) => Number(m[1]));
        if (!pids.length || pids.some((pid) => pid !== runtime.main.pid)) fail();
        candidatePorts.add(port);
        return false;
      })
      .join('\n');
    if (candidatePorts.size !== 2) fail();
    live.processes = live.processes.filter((p) => !selected.some((r) => r.pid === p.pid));
    live.managers = live.managers.filter((m) => !selected.some((r) => r.pmId === m.pmId));
  }
  if (
    unmanagedProgressHost !== undefined &&
    (unmanagedProgressHost !== 'aliyun' ||
      effects?.phase !== 'stopped' ||
      registrationProgressHost !== undefined)
  )
    fail();
  if (
    registrationProgressHost !== undefined &&
    !(
      (registrationProgressHost === 'vultr' && effects?.phase === 'producers_stopped') ||
      (registrationProgressHost === 'aliyun' && ['all_fenced', 'stopped'].includes(effects?.phase))
    )
  )
    fail();
  const adjusted = structuredClone(reviews);
  const actualSources = new Map(
    pair.hosts.map((h) => [h.host, firstCutoverSourceBindings(h.snapshot)]),
  );
  if (!Array.isArray(effects?.registrationEvents) || !Array.isArray(effects.startupEvents)) fail();
  const unmanaged = effects.unmanagedEvents ?? [];
  if (!Array.isArray(unmanaged) || unmanaged.length > 2) fail();
  if (unmanaged.length) {
    const intent = unmanaged[0];
    const original = classifyFirstCutoverHostPair(
      { pair: baseline, reviews, inventoryDigest },
      { now: () => baseline.observedAtMs },
    );
    const snapshot = baseline.hosts.find((h) => h.host === 'aliyun').snapshot;
    const expected = original.hosts
      .find((h) => h.host === 'aliyun')
      .unmanaged.processes.map((p) => ({
        pid: p.pid,
        identityDigest: digest(snapshot.processes.find((r) => r.pid === p.pid)),
      }))
      .sort((a, b) => a.pid - b.pid);
    if (
      original.unknownLaunchers.length ||
      !expected.length ||
      !equal(intent, {
        attempt: effects.attempt,
        inventoryDigest,
        host: 'aliyun',
        phase: 'unmanaged-stop-intent',
        targets: expected,
      }) ||
      (unmanaged.length === 2
        ? !equal(unmanaged[1], { ...intent, phase: 'unmanaged-stopped' })
        : unmanagedProgressHost !== 'aliyun')
    )
      fail();
    const actual = pair.hosts.find((h) => h.host === 'aliyun').snapshot;
    for (const p of expected) {
      const remains = actual.processes.some((row) => row.pid === p.pid);
      if (unmanaged.length === 2 && remains) fail();
      if (!remains)
        adjusted.aliyun.review.processes = adjusted.aliyun.review.processes.filter(
          (r) => r.pid !== p.pid,
        );
    }
  }
  if (
    !Array.isArray(fences) ||
    fences.length > 2 ||
    new Set(fences.map((f) => f.host)).size !== fences.length ||
    fences.some((f) => !['aliyun', 'vultr'].includes(f.host))
  )
    fail();
  for (const event of [...effects.registrationEvents, ...effects.startupEvents])
    if (
      !['aliyun', 'vultr'].includes(event.host) ||
      event.attempt !== effects.attempt ||
      event.inventoryDigest !== inventoryDigest
    )
      fail();
  for (const host of ['aliyun', 'vultr']) {
    const before = baseline.hosts.find((h) => h.host === host)?.snapshot;
    const current = pair.hosts.find((h) => h.host === host)?.snapshot;
    if (
      !before ||
      !current ||
      before.bootId !== current.bootId ||
      before.hostname !== current.hostname ||
      !equal(before.pm2Runtime, current.pm2Runtime) ||
      !equal(
        before.processes.find((p) => p.pid === before.pm2Runtime.pid),
        current.processes.find((p) => p.pid === current.pm2Runtime.pid),
      )
    )
      fail();
    const fence = fences.find((f) => f.host === host)?.receipt;
    if (fence) {
      const restored = fence.phase === 'restored';
      const names =
        host === 'vultr' ? ['holaday'] : ['hd-app.orangebench.tech', 'hd-pay.orangebench.tech'];
      if (
        fence.schemaVersion !== 1 ||
        fence.attempt !== effects.attempt ||
        fence.inventoryDigest !== inventoryDigest ||
        (!restored && fence.phase !== 'active') ||
        (restored &&
          (fence.stage !== 'all-writers' ||
            candidate?.mode !== 'serving' ||
            !equal(fence.identity, candidate.identity) ||
            !['verified', 'opened', 'reconciled'].includes(effects.phase))) ||
        !['orders', 'all-writers'].includes(fence.stage) ||
        !Array.isArray(fence.files) ||
        fence.files.length !== names.length ||
        new Set(fence.files.map((f) => f.path)).size !== names.length ||
        (fence.stage === 'orders' &&
          !['orders_fenced', 'legacy_settled', 'producers_stopped'].includes(effects.phase)) ||
        (fence.stage === 'all-writers' &&
          ![
            'all_fenced',
            'stopped',
            'backup_verified',
            'migration_started',
            'candidate_started',
            'verified',
            'opened',
            'reconciled',
          ].includes(effects.phase))
      )
        fail();
      for (const name of names) {
        const record = fence.files.find((f) => f.path === `/etc/nginx/sites-available/${name}`);
        const path = `/etc/nginx/sites-enabled/${name}`;
        const original = before.nginxFiles.find((f) => f.path === path);
        const index = current.nginxFiles.findIndex((f) => f.path === path);
        const file = current.nginxFiles[index];
        if (
          !record ||
          !original ||
          !file ||
          !hash(record.generatedDigest) ||
          record.originalDigest !== original.digest ||
          record.backupDigest !== original.digest ||
          (restored
            ? !equal(file, original)
            : file.digest !== record.generatedDigest ||
              file.uid !== 0 ||
              file.gid !== 0 ||
              file.mode !== 0o600 ||
              file.resolved !==
                `/etc/nginx/holaday-maintenance/${effects.attempt}/${name}-${record.generatedDigest}.conf` ||
              !equal(Object.keys(original).sort(), Object.keys(file).sort()))
        )
          fail();
        current.nginxFiles[index] = structuredClone(original);
      }
    }
    const startup = effects.startupEvents.filter((e) => e.host === host);
    if (startup.length) {
      const backed = startup[1];
      if (
        startup[0]?.phase !== 'startup-backup-intent' ||
        backed?.phase !== 'startup-backed-up' ||
        !Array.isArray(backed.files) ||
        backed.files.length !== 2 ||
        backed.files.some((f, i) => f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}`)
      )
        fail();
      const changes = backed.files.filter((f) => f.beforeDigest !== f.afterDigest).reverse();
      if (!changes.length || startup.length !== 2 + changes.length * 2) fail();
      for (const f of backed.files) {
        const original = before.startup.files.find((row) => row.path === f.path);
        if (!original || (original.present ? original.digest : null) !== f.beforeDigest) fail();
      }
      for (const [i, change] of changes.entries()) {
        const base = { attempt: effects.attempt, inventoryDigest, host, ...change };
        if (
          !equal(startup[2 + i * 2], { ...base, phase: 'startup-file-intent' }) ||
          !equal(startup[3 + i * 2], { ...base, phase: 'startup-file-written' })
        )
          fail();
        const original = before.startup.files.find((f) => f.path === change.path);
        const index = current.startup.files.findIndex((f) => f.path === change.path);
        const file = current.startup.files[index];
        const a = original?.stat;
        const b = file?.stat;
        const keys = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
        if (
          !a ||
          !b ||
          !original.present ||
          !file.present ||
          original.resolved !== change.path ||
          file.resolved !== change.path ||
          !equal(original.link, a) ||
          !equal(file.link, b) ||
          !equal(Object.keys(original).sort(), Object.keys(file).sort()) ||
          !equal(Object.keys(b).sort(), [...keys].sort()) ||
          !keys.every((key) => Number.isFinite(b[key]) && b[key] >= 0) ||
          !Number.isSafeInteger(b.ino) ||
          b.ino < 1 ||
          b.dev !== a.dev ||
          b.uid !== 0 ||
          b.gid !== a.gid ||
          b.mode !== a.mode ||
          (b.mode & 0o170000) !== 0o100000 ||
          b.mode & 0o7022 ||
          b.nlink !== 1 ||
          typeof file.content !== 'string' ||
          b.size !== Buffer.byteLength(file.content) ||
          file.digest !== change.afterDigest ||
          !hash(change.afterDigest)
        )
          fail();
        // Only this completed atomic replacement is compared to the old source
        // review. Every other source, including an absent backup, stays exact.
        current.startup.files[index] = structuredClone(original);
      }
    }
    const events = effects.registrationEvents.filter((e) => e.host === host);
    if (!events.length) continue;
    const progress = registrationProgressHost === host;
    if (progress && events.length === 1 && events[0].phase === 'registration-backup-intent')
      continue;
    const backed = events[1];
    if (
      events[0]?.phase !== 'registration-backup-intent' ||
      backed?.phase !== 'registration-backed-up' ||
      !Array.isArray(backed.registrations) ||
      (progress
        ? events.length > 2 + backed.registrations.length * 2
        : events.length !== 2 + backed.registrations.length * 2)
    )
      fail();
    for (const [i, registration] of backed.registrations.entries()) {
      const base = { attempt: effects.attempt, inventoryDigest, host, ...registration };
      const intent = events[2 + i * 2];
      const completed = events[3 + i * 2];
      if (progress && !intent) continue;
      if (
        !equal(intent, { ...base, phase: 'registration-delete-intent' }) ||
        (completed
          ? !equal(completed, { ...base, phase: 'registration-deleted' })
          : !progress || events.length !== 3 + i * 2)
      )
        fail();
      const manager = before.managers.find((m) => m.pmId === registration.pmId);
      const reviewed = adjusted[host].review.registrations.find(
        (r) => r.pmId === registration.pmId,
      );
      // Progress consumers still compare returned remaining targets to their
      // own captured scope. An intent cannot remove a still-present manager.
      if (progress && !completed && current.managers.some((m) => m.pmId === manager?.pmId)) {
        if (
          !equal(
            current.managers.find((m) => m.pmId === manager.pmId),
            manager,
          )
        )
          fail();
        continue;
      }
      if (
        !manager ||
        manager.name !== registration.name ||
        manager.configDigest !== registration.configDigest ||
        reviewed?.disposition !== 'retire' ||
        reviewed.configDigest !== registration.configDigest ||
        current.managers.some((m) => m.pmId === manager.pmId || m.name === manager.name)
      )
        fail();
      const descendants = new Set(manager.pid > 1 ? [manager.pid] : []);
      for (let i = 0; i < before.processes.length; i++)
        for (const p of before.processes) if (descendants.has(p.ppid)) descendants.add(p.pid);
      // A deleted registration is not proof that its process tree exited.
      if (current.processes.some((p) => descendants.has(p.pid))) fail();
      for (const pid of descendants)
        if (adjusted[host].review.processes.find((r) => r.pid === pid)?.disposition !== 'retire')
          fail();
      adjusted[host].review.registrations = adjusted[host].review.registrations.filter(
        (r) => r.pmId !== manager.pmId,
      );
      adjusted[host].review.processes = adjusted[host].review.processes.filter(
        (r) => !descendants.has(r.pid),
      );
    }
  }
  const result = classifyFirstCutoverHostPair({ pair, reviews: adjusted, inventoryDigest }, io);
  if (candidate !== undefined) result.candidate = candidate;
  for (const host of result.hosts) host.sources = actualSources.get(host.host);
  return result;
}

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
  const machine = s?.hostname ?? host;
  const now = io.now();
  if (
    !['aliyun', 'vultr'].includes(host) ||
    !/^[a-zA-Z0-9.-]{1,128}$/.test(machine) ||
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
      host: machine,
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
    host: machine,
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
