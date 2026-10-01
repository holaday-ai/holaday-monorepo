import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  cutoverLegacyInterruptionRisk,
  validateCutoverLegacyCapability,
} from './browser-cutover-evidence.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = () => {
  throw new Error('CUTOVER_INVENTORY_UNPROVEN');
};

// Supplemental host-network TCP evidence, not an in-flight request count or
// proof about other network namespaces/external effects. In particular an
// ownerless socket on a reviewed service port must not disappear with its
// listener. TIME-WAIT cannot dispatch; half-closed connections still block.
function observeConnectedTcp(snapshot, ports) {
  const tcp = snapshot.tcp;
  if (!tcp || Object.keys(tcp).sort().join(',') !== 'after,before') fail();
  const endpoint = (text) => {
    const match = /^(\[[^\]]+\]|[^\s]+):(\d+|\*)$/.exec(text ?? '');
    if (!match) fail();
    const address = match[1].replace(/^\[|\]$/g, '').split('%')[0];
    if (address !== '*' && !isIP(address)) fail();
    const port = match[2] === '*' ? 0 : Number(match[2]);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) fail();
    return port;
  };
  const selected = (raw) => {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8 * 1024 * 1024) fail();
    return lines(raw)
      .flatMap((line) => {
        const [state, received, sent, local, remote, ...owner] = line.split(/\s+/);
        if (
          ![
            'ESTAB',
            'SYN-SENT',
            'SYN-RECV',
            'FIN-WAIT-1',
            'FIN-WAIT-2',
            'TIME-WAIT',
            'CLOSE-WAIT',
            'LAST-ACK',
            'LISTEN',
            'CLOSING',
            'UNCONN',
          ].includes(state) ||
          !/^\d+$/.test(received ?? '') ||
          !/^\d+$/.test(sent ?? '')
        )
          fail();
        const port = endpoint(local);
        endpoint(remote);
        if (!ports.includes(port) || ['LISTEN', 'TIME-WAIT'].includes(state)) return [];
        return [JSON.stringify([state, local, remote, owner.join(' ')])];
      })
      .sort();
  };
  const before = selected(tcp.before);
  if (!equal(before, selected(tcp.after))) fail();
  return {
    observedAtMs: snapshot.observedAtMs,
    existingSockets: before.length,
    sourceDigest: digest({ bootId: snapshot.bootId, ports, tcp }),
  };
}
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
const executionHost = (role) =>
  ['ingress', 'gateway'].includes(role)
    ? 'aliyun'
    : ['ingress-ssh', 'gateway-ssh', 'coordinator'].includes(role)
      ? 'vultr'
      : null;

// Private native observation contract. The host additionally binds sourcesDigest
// to its freshly collected protected source material. This is not an input-file
// approval or a replacement for the original reviewed process identities.
export function validateFirstCutoverOwnedDisplayObservation({ observation, snapshot, now }) {
  const o = observation;
  const names = ['holaday-vnc', 'holaday-chromium-headed'];
  const project = (p) =>
    Object.fromEntries(
      ['pid', 'ppid', 'start', 'uids', 'exe', 'cwd', 'argvDigest', 'cgroup'].map((k) => [k, p[k]]),
    );
  if (
    !o ||
    Object.keys(o).sort().join(',') !==
      'bootId,censusDigest,clients,contextDigest,display,hostname,members,observedAtMs,purpose,roots,socketDigest,sourcesDigest,treeDigests' ||
    o.purpose !== 'cloud-owned-display-observation' ||
    o.hostname !== snapshot.hostname ||
    o.bootId !== snapshot.bootId ||
    ![o.sourcesDigest, o.contextDigest, o.censusDigest, o.socketDigest].every(hash) ||
    !Number.isSafeInteger(o.observedAtMs) ||
    !Number.isSafeInteger(now) ||
    o.observedAtMs < 0 ||
    o.observedAtMs > now ||
    now - o.observedAtMs > 60000 ||
    !Array.isArray(o.roots) ||
    o.roots.length !== 2 ||
    !Array.isArray(o.members) ||
    !Array.isArray(o.clients) ||
    o.clients.length > 16384
  )
    fail();
  const roots = names.map((name) => {
    const matches = snapshot.managers.filter((m) => m.name === name);
    if (matches.length !== 1) fail();
    const m = matches[0];
    if (
      !(
        (m.status === 'online' && m.pid > 1) ||
        (name === names[0] && m.status === 'stopped' && m.pid === 0)
      )
    )
      fail();
    const p = snapshot.processes.find((p) => p.pid === m.pid);
    if (m.pid && (!p || p.ppid !== snapshot.pm2Runtime.pid)) fail();
    return {
      name,
      pmId: m.pmId,
      pid: m.pid,
      start: p?.start ?? null,
      status: m.status,
      configDigest: m.configDigest,
    };
  });
  if (!equal(o.roots, roots)) fail();
  const groups = roots.map((root) => {
    const ids = new Set(root.pid ? [root.pid] : []);
    for (let i = 0; i < snapshot.processes.length; i++)
      for (const p of snapshot.processes) if (ids.has(p.ppid)) ids.add(p.pid);
    return ids;
  });
  const treeDigests = groups.map((ids) =>
    digest(
      snapshot.processes
        .filter((p) => ids.has(p.pid))
        .sort((a, b) => a.pid - b.pid)
        .map(project),
    ),
  );
  if (!equal(o.treeDigests, treeDigests)) fail();
  const members = snapshot.processes
    .filter((p) => groups.some((g) => g.has(p.pid)) && /\/(?:Xvfb|Xorg|openbox)$/.test(p.exe))
    .sort((a, b) => a.pid - b.pid);
  const displays = members.filter((p) => p.exe === '/usr/bin/Xvfb');
  if (
    displays.length !== 1 ||
    !members.length ||
    members.some(
      (p) =>
        !groups[1].has(p.pid) ||
        groups[0].has(p.pid) ||
        !['/usr/bin/Xvfb', '/usr/bin/openbox'].includes(p.exe) ||
        p.uids?.length !== 4 ||
        p.uids.some((u) => u !== 0),
    ) ||
    !equal(o.members, members.map(project)) ||
    displays[0].ppid !== roots[1].pid ||
    !o.display ||
    Object.keys(o.display).sort().join(',') !==
      'argvDigest,cgroup,cwd,exe,mountNamespace,pid,ppid,start,uids' ||
    !/^mnt:\[\d+\]$/.test(o.display.mountNamespace) ||
    !equal(project(o.display), project(displays[0]))
  )
    fail();
  const seen = new Set();
  for (const c of o.clients) {
    if (!c) fail();
    const role = names.indexOf(c.role);
    const p = snapshot.processes.find((p) => p.pid === c.pid);
    const key = `${c.pid}:${c.fd}`;
    if (
      !c ||
      Object.keys(c).sort().join(',') !== 'fd,inode,pid,role,serverInode,start' ||
      role < 0 ||
      !p ||
      !groups[role].has(c.pid) ||
      groups[1 - role].has(c.pid) ||
      c.start !== p.start ||
      !Number.isSafeInteger(c.fd) ||
      c.fd < 0 ||
      !/^[1-9]\d{0,19}$/.test(c.inode) ||
      !/^[1-9]\d{0,19}$/.test(c.serverInode) ||
      seen.has(key)
    )
      fail();
    seen.add(key);
  }
  if (members.some((p) => p.exe === '/usr/bin/openbox' && !o.clients.some((c) => c.pid === p.pid)))
    fail();
}

// One canonical original stop range for approval producers and every consumer.
// Detached members require private native IPC facts AND original review entries.
export function firstCutoverCloudStopScope({ snapshot, name, association, display, review, now }) {
  const managers = snapshot.managers.filter((m) => m.name === name);
  if (managers.length !== 1) fail();
  const manager = managers[0];
  const ids = new Set([manager.pid]);
  for (let i = 0; i < snapshot.processes.length; i++)
    for (const p of snapshot.processes) if (ids.has(p.ppid)) ids.add(p.pid);
  let associationDigest;
  if (association !== undefined) {
    const o = association;
    if (
      name !== 'holaday-chromium-headed' ||
      !display ||
      !o ||
      Object.keys(o).sort().join(',') !==
        'bootId,censusDigest,contextDigest,displayObservationDigest,hostname,members,observedAtMs,purpose,socketDigest,sourcesDigest' ||
      o.purpose !== 'cloud-old-browser-association-observation' ||
      o.hostname !== snapshot.hostname ||
      o.bootId !== snapshot.bootId ||
      o.sourcesDigest !== display.sourcesDigest ||
      o.contextDigest !== display.contextDigest ||
      o.displayObservationDigest !== digest(display) ||
      ![o.censusDigest, o.socketDigest, o.sourcesDigest, o.contextDigest].every(hash) ||
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(o.observedAtMs) ||
      o.observedAtMs < 0 ||
      o.observedAtMs > now ||
      now - o.observedAtMs > 60000 ||
      !Array.isArray(o.members) ||
      o.members.length > 32 ||
      new Set(o.members.map((p) => p.pid)).size !== o.members.length
    )
      fail();
    for (const member of o.members) {
      const p = snapshot.processes.find((p) => p.pid === member.pid);
      if (
        !p ||
        !equal(p, member) ||
        !review?.processes.some(
          (r) => r.pid === p.pid && r.disposition === 'preserve' && r.identityDigest === digest(p),
        )
      )
        fail();
      ids.add(p.pid);
    }
    if (o.members.length) associationDigest = digest(o);
  }
  const processes = snapshot.processes.filter((p) => ids.has(p.pid)).sort((a, b) => a.pid - b.pid);
  const daemon = snapshot.processes.find((p) => p.pid === snapshot.pm2Runtime.pid);
  return {
    host: 'vultr',
    hostname: snapshot.hostname,
    bootId: snapshot.bootId,
    pm2Runtime: snapshot.pm2Runtime,
    daemon,
    manager,
    processes,
    ...(associationDigest ? { associationDigest } : {}),
  };
}

// Temporary stop accounting stays separate from permanent retirement. Compare
// with the original protected process review, never create a new allowlist from
// whatever happens to be running after an effect. Recovery is not inferred here.
function observeCloudStops({
  baseline,
  pair,
  adjusted,
  effects,
  inventoryDigest,
  progress,
  cloudDisplay,
  cloudAssociations,
  cloudCensus,
  cloudRecovery,
  now,
}) {
  const scope = effects.cloudMaintenanceScope;
  const events = effects.cloudMaintenanceEvents ?? [];
  if (scope === undefined) {
    if (!Array.isArray(events) || events.length) fail();
    return undefined;
  }
  const names = ['holaday-vnc', 'holaday-chromium-headed'];
  if (
    !hash(effects.executionSiteDigest) ||
    !Array.isArray(scope) ||
    scope.length !== 2 ||
    new Set(scope.map((s) => s.pmId)).size !== 2 ||
    !Array.isArray(events) ||
    events.length > 8 ||
    (events.length &&
      ![
        'producers_stopped',
        'all_fenced',
        'stopped',
        'backup_verified',
        'migration_started',
        'candidate_started',
        'verified',
        'opened',
        'reconciled',
      ].includes(effects.phase)) ||
    (events.length % 2 &&
      (!progress || effects.phase !== (events.length < 4 ? 'producers_stopped' : 'verified')))
  )
    fail();
  const before = baseline.hosts.find((h) => h.host === 'vultr')?.snapshot;
  const current = pair.hosts.find((h) => h.host === 'vultr')?.snapshot;
  const review = adjusted.vultr.review;
  const tree = (snapshot, pid) => {
    const ids = new Set([pid]);
    for (let i = 0; i < snapshot.processes.length; i++)
      for (const p of snapshot.processes) if (ids.has(p.ppid)) ids.add(p.pid);
    return snapshot.processes.filter((p) => ids.has(p.pid)).sort((a, b) => a.pid - b.pid);
  };
  const special = scope.flatMap((d) => {
    const m = before.managers.find((m) => m.name === d.name);
    return m ? tree(before, m.pid).filter((p) => /\/(?:Xvfb|Xorg|openbox)$/.test(p.exe)) : [];
  });
  let approvedDisplay = [];
  if (special.length) {
    if (!cloudDisplay || Object.keys(cloudDisplay).sort().join(',') !== 'current,original') fail();
    const original = cloudDisplay.original;
    // This retained fact accounts for the original reviewed members after exit;
    // it cannot substitute for a fresh live ownership observation before stop.
    if (!original || original.observedAtMs < before.observedAtMs || original.observedAtMs > now)
      fail();
    validateFirstCutoverOwnedDisplayObservation({
      observation: original,
      snapshot: before,
      now: original.observedAtMs,
    });
    const headed = current.managers.find((m) => m.name === names[1]);
    if (headed?.status === 'online' && !cloudRecovery?.[names[1]]) {
      validateFirstCutoverOwnedDisplayObservation({
        observation: cloudDisplay.current,
        snapshot: current,
        now,
      });
      if (
        !equal(original.members, cloudDisplay.current.members) ||
        original.contextDigest !== cloudDisplay.current.contextDigest ||
        cloudDisplay.current.roots.some(
          (r, i) =>
            r.status === 'online' &&
            cloudDisplay.current.treeDigests[i] !== original.treeDigests[i],
        )
      )
        fail();
    } else if (cloudDisplay.current !== undefined) fail();
    approvedDisplay = original.members;
  } else if (cloudDisplay !== undefined) fail();
  return scope.map((declaration, i) => {
    if (
      Object.keys(declaration).sort().join(',') !== 'name,pmId,recoveryDigest,scopeDigest' ||
      declaration.name !== names[i] ||
      !Number.isSafeInteger(declaration.pmId) ||
      declaration.pmId < 0 ||
      !hash(declaration.scopeDigest) ||
      !hash(declaration.recoveryDigest) ||
      before.hostname !== current.hostname ||
      before.bootId !== current.bootId ||
      !equal(before.pm2Runtime, current.pm2Runtime)
    )
      fail();
    const matches = before.managers.filter((m) => m.name === declaration.name);
    const manager = matches[0];
    if (
      matches.length !== 1 ||
      manager.pmId !== declaration.pmId ||
      manager.status !== 'online' ||
      manager.pid <= 1 ||
      manager.watch ||
      !hash(manager.stopConfigDigest) ||
      review.registrations.find((r) => r.pmId === manager.pmId)?.configDigest !==
        manager.configDigest ||
      review.registrations.find((r) => r.pmId === manager.pmId)?.disposition !== 'preserve'
    )
      fail();
    const stopScope = firstCutoverCloudStopScope({
      snapshot: before,
      name: manager.name,
      association: i === 1 ? cloudAssociations?.original : undefined,
      display: cloudDisplay?.original,
      review,
      now: cloudAssociations?.original?.observedAtMs ?? now,
    });
    const processes = stopScope.processes;
    const daemon = before.processes.find((p) => p.pid === before.pm2Runtime.pid);
    if (
      !processes.length ||
      processes.find((p) => p.pid === manager.pid)?.ppid !== daemon?.pid ||
      processes.some(
        (p) =>
          [daemon.pid, before.observer.pid].includes(p.pid) ||
          (/\/(?:Xvfb|Xorg|openbox)$/.test(p.exe) &&
            !approvedDisplay.some((member) => equal(member, p))) ||
          review.processes.find((r) => r.pid === p.pid)?.disposition !== 'preserve',
      ) ||
      declaration.scopeDigest !== digest(stopScope)
    )
      fail();
    const liveMatches = current.managers.filter(
      (m) => m.pmId === manager.pmId || m.name === manager.name,
    );
    if (liveMatches.length !== 1) fail();
    const live = liveMatches[0];
    const base = { attempt: effects.attempt, inventoryDigest, host: 'vultr', ...declaration };
    const recovery = cloudRecovery?.[declaration.name];
    const restoreIndex = i === 1 ? 4 : 6;
    const restoreIntent = events[restoreIndex];
    const restoreAck = events[restoreIndex + 1];
    if (restoreIntent && !equal(restoreIntent, { ...base, phase: 'cloud-restore-intent' })) fail();
    if (restoreAck && !equal(restoreAck, { ...base, phase: 'cloud-restored' })) fail();
    if (recovery) {
      const { native, configuration } = recovery;
      if (
        !restoreIntent ||
        (!restoreAck && !progress) ||
        !native ||
        !configuration ||
        native.purpose !== 'cloud-recovery-native-observation' ||
        native.name !== manager.name ||
        native.pmId !== manager.pmId ||
        native.hostname !== current.hostname ||
        native.bootId !== current.bootId ||
        native.launchDigest !== declaration.recoveryDigest ||
        !Number.isSafeInteger(native.observedAtMs) ||
        native.observedAtMs > now ||
        now - native.observedAtMs > 60000 ||
        !hash(configuration.stoppedConfigDigest) ||
        configuration.recoveredConfigDigest !== native.configDigest ||
        configuration.restartCount !== manager.restartCount ||
        live.restartCount !== manager.restartCount ||
        live.configDigest !== native.configDigest ||
        live.pid !== native.pid ||
        live.status !== 'online' ||
        !Array.isArray(native.processes) ||
        !native.processes.length ||
        native.processes.length > 16384 ||
        !cloudCensus ||
        cloudCensus.processes.some((p) => processes.some((old) => old.pid === p.pid))
      )
        fail();
      const project = (p) =>
        Object.fromEntries(
          ['pid', 'ppid', 'start', 'uids', 'exe', 'cwd', 'argvDigest', 'cgroup'].map((k) => [
            k,
            p[k],
          ]),
        );
      const ids = new Set();
      for (const p of native.processes) {
        const actual = current.processes.find((row) => row.pid === p.pid);
        if (
          !actual ||
          !equal(actual, project(p)) ||
          ids.has(p.pid) ||
          before.processes.some((old) => old.pid === p.pid) ||
          p.mountNamespace !== native.mountNamespace ||
          !equal(p.uids, [0, 0, 0, 0])
        )
          fail();
        ids.add(p.pid);
      }
      const root = current.processes.find((p) => p.pid === native.pid);
      if (
        !root ||
        root.start !== native.start ||
        root.ppid !== native.ppid ||
        root.ppid !== current.pm2Runtime.pid ||
        cloudCensus.processes.some(
          (p) => p.mountNamespace === native.mountNamespace && !ids.has(p.pid),
        )
      )
        fail();
      review.processes = review.processes.filter((r) => !processes.some((p) => p.pid === r.pid));
      for (const p of native.processes)
        review.processes.push({
          pid: p.pid,
          identityDigest: digest(project(p)),
          disposition: 'preserve',
          reason: 'bound native cloud recovery',
        });
      review.registrations.find((r) => r.pmId === manager.pmId).configDigest = live.configDigest;
      return { ...declaration, status: 'recovered' };
    }
    if (restoreAck) fail();
    const intent = events[i * 2];
    const ack = events[i * 2 + 1];
    if (intent && !equal(intent, { ...base, phase: 'cloud-stop-intent' })) fail();
    if (ack && !equal(ack, { ...base, phase: 'cloud-stopped' })) fail();
    if (!intent || (!ack && live.status === 'online')) {
      if (
        !equal(live, manager) ||
        !equal(
          [
            ...tree(current, manager.pid),
            ...(i === 1
              ? (cloudAssociations?.original?.members ?? [])
                  .filter((p) => !tree(current, manager.pid).some((row) => row.pid === p.pid))
                  .map((p) => current.processes.find((row) => row.pid === p.pid))
              : []),
          ].sort((a, b) => a?.pid - b?.pid),
          processes,
        )
      )
        fail();
      return { ...declaration, status: 'online' };
    }
    if (
      !hash(live.configDigest) ||
      live.stopConfigDigest !== manager.stopConfigDigest ||
      !equal(live, { ...manager, pid: 0, status: 'stopped', configDigest: live.configDigest }) ||
      current.processes.some((p) => processes.some((old) => old.pid === p.pid)) ||
      (cloudCensus !== undefined &&
        cloudCensus.processes.some((p) => processes.some((old) => old.pid === p.pid)))
    )
      fail();
    const ports = i === 0 ? [5901, 6080] : [9223];
    if (
      lines(current.listeners).some((line) =>
        ports.includes(Number(/:(\d+)$/.exec(line.split(/\s+/)[3] ?? '')?.[1])),
      )
    )
      fail();
    // Only absent, explicitly stopped original processes are removed from the
    // comparison. The preserved PM2 registration and every source stay checked.
    review.processes = review.processes.filter((r) => !processes.some((p) => p.pid === r.pid));
    // The collector's pre-bound stopConfigDigest compares ALL launch bytes,
    // including environment, unknown fields and restart counters; only PM2
    // status/exit_code differ on this proved stop. This is a local comparison
    // clone, NOT mutation of a protected review or acceptance of arbitrary drift.
    review.registrations.find((r) => r.pmId === manager.pmId).configDigest = live.configDigest;
    return { ...declaration, status: 'stopped' };
  });
}

/** Reconcile completed, named-host registration retirements against the ORIGINAL
 * reviewed snapshot. The host obtains effects from its owned live journal. This
 * is an observation, never permission to delete, a replacement review, or proof
 * of ingress isolation. Source changes without separate evidence remain unknown.
 */
export function classifyFirstCutoverRetirementPair(input, io = { now: Date.now }) {
  const {
    baseline,
    baselineExecution = [],
    pair,
    reviews,
    inventoryDigest,
    effects,
    fences = [],
    registrationProgressHost,
    unmanagedProgressHost,
    candidate,
    execution = [],
    cloudProgress = false,
    cloudDisplay,
    cloudAssociations,
    cloudCensus,
    cloudRecovery,
  } = structuredClone(input);
  if (
    effects?.phase === 'legacy_interruption_accepted' &&
    (effects.schemaVersion !== 2 || effects.riskDigest !== cutoverLegacyInterruptionRisk(effects))
  )
    fail();
  if (
    !Array.isArray(execution) ||
    !Array.isArray(baselineExecution) ||
    [...execution, ...baselineExecution].some(
      (row) =>
        !equal(
          row.binding,
          Object.fromEntries(
            ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'].map(
              (key) => [key, effects?.[key]],
            ),
          ),
        ),
    )
  )
    fail();
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
  const cloudMaintenance = observeCloudStops({
    baseline,
    pair,
    adjusted,
    effects,
    inventoryDigest,
    progress: cloudProgress,
    cloudDisplay,
    cloudAssociations,
    cloudCensus,
    cloudRecovery,
    now: io.now(),
  });
  const actualSources = new Map(
    pair.hosts.map((h) => [h.host, firstCutoverSourceBindings(h.snapshot)]),
  );
  if (!Array.isArray(effects?.registrationEvents) || !Array.isArray(effects.startupEvents)) fail();
  const candidateStartup = effects.candidateStartupEvents ?? [];
  if (!Array.isArray(candidateStartup)) fail();
  if (candidateStartup.length) {
    const base = { attempt: effects.attempt, inventoryDigest, ...candidate?.identity };
    const backed = candidateStartup[1];
    if (
      candidate?.mode !== 'serving' ||
      !['verified', 'opened', 'reconciled'].includes(effects.phase) ||
      candidateStartup.length !== 6 ||
      !equal(candidateStartup[0], { ...base, phase: 'candidate-startup-backup-intent' }) ||
      !equal(backed, { ...base, phase: 'candidate-startup-backed-up', files: backed?.files }) ||
      !Array.isArray(backed?.files) ||
      backed.files.length !== 2
    )
      fail();
    for (const [i, change] of [...backed.files].reverse().entries()) {
      if (
        !equal(Object.keys(change).sort(), ['afterDigest', 'beforeDigest', 'path']) ||
        change.path !== `/root/.pm2/${i === 0 ? 'dump.pm2.bak' : 'dump.pm2'}` ||
        !(change.beforeDigest === null || hash(change.beforeDigest)) ||
        !hash(change.afterDigest) ||
        change.beforeDigest === change.afterDigest ||
        !equal(candidateStartup[2 + i * 2], {
          ...base,
          ...change,
          phase: 'candidate-startup-file-intent',
        }) ||
        !equal(candidateStartup[3 + i * 2], {
          ...base,
          ...change,
          phase: 'candidate-startup-file-written',
        })
      )
        fail();
    }
  }
  const unmanaged = effects.unmanagedEvents ?? [];
  if (!Array.isArray(unmanaged) || unmanaged.length > 2) fail();
  if (unmanaged.length) {
    const intent = unmanaged[0];
    const original = classifyFirstCutoverHostPair(
      { pair: baseline, reviews, inventoryDigest, execution: baselineExecution },
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
          ![
            'orders_fenced',
            'legacy_settled',
            'legacy_interruption_accepted',
            'producers_stopped',
          ].includes(effects.phase)) ||
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
    const candidateChanges =
      host === 'vultr' && candidateStartup.length ? candidateStartup[1].files : [];
    for (const change of candidateChanges) {
      const original = before.startup.files.find((f) => f.path === change.path);
      const retired = startup[1]?.files?.find((f) => f.path === change.path);
      const prior = retired ? retired.afterDigest : original?.present ? original.digest : null;
      const index = current.startup.files.findIndex((f) => f.path === change.path);
      const file = current.startup.files[index];
      const a = original?.stat;
      const b = file?.stat;
      const keys = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
      if (
        !original ||
        change.beforeDigest !== prior ||
        !file?.present ||
        !b ||
        file.resolved !== change.path ||
        !equal(file.link, b) ||
        !equal(Object.keys(file).sort(), [
          'content',
          'digest',
          'link',
          'path',
          'present',
          'resolved',
          'stat',
        ]) ||
        !equal(Object.keys(b).sort(), [...keys].sort()) ||
        !keys.every((key) => Number.isFinite(b[key]) && b[key] >= 0) ||
        !Number.isSafeInteger(b.ino) ||
        b.ino < 1 ||
        b.uid !== 0 ||
        b.nlink !== 1 ||
        (original.present
          ? !a ||
            original.resolved !== change.path ||
            !equal(original.link, a) ||
            b.dev !== a.dev ||
            b.gid !== a.gid ||
            b.mode !== a.mode
          : b.gid !== 0 || b.mode !== 0o100600) ||
        (b.mode & 0o170000) !== 0o100000 ||
        b.mode & 0o7022 ||
        typeof file.content !== 'string' ||
        b.size !== Buffer.byteLength(file.content) ||
        file.digest !== change.afterDigest ||
        createHash('sha256').update(file.content).digest('hex') !== change.afterDigest
      )
        fail();
      // Only the complete same-boot journal chain accounts for these bytes.
      // The old retirement chain below is still validated against its review.
      current.startup.files[index] = structuredClone(original);
    }
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
        if (candidateChanges.some((f) => f.path === change.path)) continue;
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
  const result = classifyFirstCutoverHostPair(
    { pair, reviews: adjusted, inventoryDigest, execution },
    io,
  );
  if (candidate !== undefined) result.candidate = candidate;
  if (cloudMaintenance !== undefined) result.cloudMaintenance = cloudMaintenance;
  for (const host of result.hosts) host.sources = actualSources.get(host.host);
  return result;
}

/** Pair the actual two-host observations with their separately reviewed source
 * and process identities. A review is trusted protected input, never generated
 * by this function. Unknowns stay visible and cannot become a stop/readiness
 * receipt. Boot changes invalidate the review even when numeric PIDs recur.
 */
export function classifyFirstCutoverHostPair(input, io = { now: Date.now }) {
  const { pair, reviews, inventoryDigest, execution = [] } = structuredClone(input ?? {});
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
  if (
    !Array.isArray(execution) ||
    execution.length > 5 ||
    new Set(execution.map((r) => `${r.host}:${r.role}`)).size !== execution.length ||
    execution.some(
      (r) =>
        !r ||
        !executionHost(r.role) ||
        r.host !== executionHost(r.role) ||
        r.binding?.inventoryDigest !== inventoryDigest ||
        !hash(r.role === 'coordinator' ? r.toolDigest : r.siteDigest),
    )
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
          execution: execution.filter((row) => row.host === host),
        },
        { now: () => now },
      ),
    };
  });
  const observedAtMs = Math.min(...hosts.map((h) => h.registered.observedAtMs));
  if (pair.observedAtMs !== observedAtMs) fail();
  const source = pair.hosts.find((row) => row.host === 'vultr');
  const capability = source.snapshot.legacyCapability;
  if (pair.hosts.find((row) => row.host === 'aliyun').snapshot.legacyCapability !== undefined)
    fail();
  if (capability !== undefined) {
    validateCutoverLegacyCapability(capability, now);
    if (
      capability.sourceCandidate !== source.sourceCandidate ||
      capability.sourceCandidate !== pair.sourceCandidate
    )
      fail();
  }
  return {
    observedAtMs,
    inventoryDigest,
    sourceDigest: pair.sourceDigest,
    ...(capability === undefined ? {} : { legacyCapability: capability }),
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
  const {
    snapshot: s,
    review,
    host,
    ports,
    inventoryDigest,
    execution = [],
  } = structuredClone(input);
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
  const executionProcesses = [];
  if (
    !Array.isArray(execution) ||
    new Set(execution.map((r) => r.process?.pid)).size !== execution.length
  )
    fail();
  for (const receipt of execution) {
    const p = s.processes.find((row) => row.pid === receipt.process?.pid);
    // No removal from the snapshot and no implicit child exemption. Only the
    // exact owned receiver/client can be separate from immutable legacy reviews.
    if (
      receipt.host !== host ||
      host !== executionHost(receipt.role) ||
      receipt.bootId !== s.bootId ||
      receipt.binding?.inventoryDigest !== inventoryDigest ||
      !hash(receipt.role === 'coordinator' ? receipt.toolDigest : receipt.siteDigest) ||
      !p ||
      !equal(p, receipt.process) ||
      !equal(p.uids, [0, 0, 0, 0]) ||
      p.cwd !== '/' ||
      p.exe !==
        (receipt.role === 'coordinator'
          ? '/opt/node22/bin/node'
          : host === 'vultr'
            ? '/usr/bin/ssh'
            : '/usr/bin/node') ||
      !hash(p.argvDigest) ||
      typeof p.cgroup !== 'string' ||
      !p.cgroup ||
      [daemon.pid, observer.pid].includes(p.pid) ||
      p.ppid === daemon.pid ||
      owner(p) ||
      review.processes.some((r) => r.pid === p.pid) ||
      [...s.listeners.matchAll(/\bpid=(\d+)\b/g)].some((m) => Number(m[1]) === p.pid)
    )
      fail();
    executionProcesses.push(p);
  }
  for (const p of s.processes) {
    if ([daemon.pid, observer.pid].includes(p.pid)) continue;
    if (executionProcesses.some((r) => r.pid === p.pid)) continue;
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
    executionProcesses,
    preservedManagers,
    unknownLaunchers: unknown,
    sources,
    ...(s.tcp !== undefined ? { tcpObservation: observeConnectedTcp(s, ports) } : {}),
  };
}
