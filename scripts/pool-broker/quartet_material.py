"""Exclusive group objects and private anchor handshake. No business launch."""
import fcntl
import hashlib
import hmac
import json
import math
import os
import socket
from socket import socket as Socket
import stat
import time

import manager_probe
import quartet_root_view
import quartet_worker_guard
import slot_identity
from quartet_journal import PreparedQuartet
from quartet_protocol import _derive_data_key
from quartet_records import ROLES
from resource_journal import ResourceJournal

_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_PARTS = ('/', 'var', 'lib', 'holaday-pool-broker', 'groups')
_NAMES = ('control', 'credentials', 'tmp', 'shm', 'profile')
_NS = {'net': 0x40000000, 'ipc': 0x08000000, 'mnt': 0x00020000, 'pid': 0x20000000}


def _deny():
    try:
        raise ValueError('POOL_BROKER_MATERIAL_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _sig(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid)


class _GroupMaterial:
    def __init__(self):
        raise TypeError('private original group material')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private original group material')

    @classmethod
    def create(cls, journal, manager, prepared, *, deadline_ns=None, scope_guard=None):
        item = object.__new__(cls)
        item._fds, item._chain, item._objects = [], [], {}
        item._host_ns, item._credentials, item._bindings = {}, {}, {}
        item._workers = {}
        item._terminal_workers = ()
        item._runtime = item._ready_offer = item._launch_offer = None
        item._scope_guard = scope_guard
        item._authority = None
        item._endpoints = None
        item._egress = None
        item._bridge = None
        item._probe_clock = None
        item._protocol = None
        item._socket, item._view = None, None
        item._busy, item._retired = False, False
        try:
            if scope_guard is not None and not callable(scope_guard): raise ValueError()
            item._create_last_ns = time.monotonic_ns()
            if type(item._create_last_ns) is not int or not 0 <= item._create_last_ns < 2**63 - 60000000000:
                raise ValueError()
            item._create_deadline_ns = item._create_last_ns + 60000000000
            if deadline_ns is not None:
                if (type(deadline_ns) is not int
                        or not item._create_last_ns < deadline_ns <= item._create_deadline_ns): raise ValueError()
                item._create_deadline_ns = deadline_ns
            item._transaction_deadline_ns = item._create_deadline_ns
            if (type(journal) is not ResourceJournal or type(manager) is not manager_probe.SystemManagerProbe
                    or type(prepared) is not PreparedQuartet or journal._retired or manager._retired
                    or journal._registration is not manager._registration or journal._pin is not manager._pin):
                raise ValueError()
            resource = next((key for key, value in journal._handles.items() if value is prepared), None)
            if (resource is None or journal._resources[resource]['version'] != 2
                    or journal._resources[resource]['state'] != 'prepared' or 'material' in journal._resources[resource]):
                raise ValueError()
            item._journal, item._manager, item._prepared = journal, manager, prepared
            item._resource, item._registration, item._pin = resource, journal._registration, journal._pin
            item._candidate = journal._candidate
            item._view = quartet_root_view._RootView.open(journal, scope_guard=item._creation_budget)
            item._run(item._create)
            return item
        except Exception:
            item.close()
            _deny()

    def _creation_budget(self):
        # Used before material has its root view or enters a material transaction.
        precise = time.monotonic_ns()
        if (type(precise) is not int or precise < self._create_last_ns or precise >= self._create_deadline_ns):
            raise ValueError()
        self._create_last_ns = precise
        outer = self._outer_budget()
        if (self._retired or self._journal._retired or self._manager._retired or self._registration._revoked
                or self._journal._registration is not self._registration
                or self._manager._registration is not self._registration
                or self._journal._pin is not self._pin or self._manager._pin is not self._pin
                or self._registration._pin is not self._pin or self._pin._fd is None): raise ValueError()
        remaining = (self._create_deadline_ns - precise) / 1000000000
        return min(remaining, outer) if outer is not None else remaining

    def _outer_budget(self):
        launch_budget = (self._launch_offer._budget()
            if self._runtime is None and self._launch_offer is not None else None)
        scope = self._scope_guard if self._runtime is None else None
        if scope is None: return launch_budget
        if (self._launch_offer is not None and getattr(scope, '__self__', None) is self._launch_offer
                and getattr(scope, '__func__', None) is type(self._launch_offer)._budget):
            return launch_budget  # Same original scope was checked just above.
        value = scope()
        if (scope is not self._scope_guard or type(value) not in (int, float)
                or not math.isfinite(value) or value <= 0): raise ValueError()
        return min(value, launch_budget) if launch_budget is not None else value

    def _veto(self):
        if not self._busy: raise ValueError()
        self._owner_veto()

    def _owner_veto(self):
        # Pure ownership tail; also usable after a locked transaction returns.
        # It performs no IO and grants no new transaction/deadline authority.
        reg, journal, manager = self._registration, self._journal, self._manager
        if self._launch_offer is not None:
            self._launch_offer._veto()
        if (self._retired or journal._retired or manager._retired
                or reg._revoked or not reg._received or reg._pin is not self._pin or self._pin._fd is None
                or journal._registration is not reg or manager._registration is not reg
                or journal._pin is not self._pin or manager._pin is not self._pin
                or reg._candidate.hex() != self._candidate or manager._candidate != self._candidate
                or journal._handles.get(self._resource) is not self._prepared
                or self._view._retired or self._endpoints is not None and self._endpoints._retired
                or self._egress is not None and self._egress._retired
                or self._bridge is not None and self._bridge._retired):
            raise ValueError()
        if self._bridge is not None:
            self._bridge._veto()  # Pure original-object veto also covers journal-native IO.
        if self._egress is not None:
            self._egress._veto()
        if self._probe_clock is not None:
            self._probe_clock._veto()
        if self._protocol is not None:
            self._protocol._veto()
        # Once terminal validation begins, every earlier original worker stays
        # in scope during later workers, journal IO and the final return tail.
        for role, worker, pin, view in self._terminal_workers:
            if (self._workers.get(role) is not worker or worker._retired or worker._material is not self
                    or worker._pin is not pin or worker._view is not view or pin._retired
                    or pin._fd is None or pin._proc is None or view._retired or view._pin is not pin):
                raise ValueError()
        if self._runtime is not None:
            from quartet_runtime import _RunningQuartet
            if type(self._runtime) is not _RunningQuartet: raise ValueError()
            self._runtime._veto()

    def _remaining(self):
        now = time.monotonic()
        if not math.isfinite(now) or now < self._last or now >= self._deadline:
            raise ValueError()
        self._last = now
        precise = time.monotonic_ns()
        precise_deadline = (self._transaction_deadline_ns if self._runtime is not None
            else min(self._create_deadline_ns, self._transaction_deadline_ns))
        if (type(precise) is not int or precise < self._create_last_ns or precise >= precise_deadline):
            raise ValueError()
        self._create_last_ns = precise
        outer = self._outer_budget()
        self._veto()
        remaining = min(self._deadline - now, (precise_deadline - precise) / 1000000000)
        return min(remaining, outer) if outer is not None else remaining

    def _io(self, call, *args, **kw):
        self._remaining()
        result = call(*args, **kw)
        self._remaining()
        return result

    def _open(self, name, parent=None):
        return self._raw_fd(name, _DIR, **({'dir_fd': parent} if parent is not None else {}))

    def _raw_fd(self, name, flags, **kw):
        self._remaining()
        fd = os.open(name, flags, **kw)
        self._fds.append(fd)
        self._remaining()
        return fd

    def _close_fd(self, fd):
        self._fds.remove(fd)
        os.close(fd)
        self._remaining()

    def _metadata(self, fd, uid=0, gid=0, mode=None):
        info = self._io(os.fstat, fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_gid != gid
                or info.st_mode & 0o7022 or mode is not None and stat.S_IMODE(info.st_mode) != mode
                or set(self._io(os.listxattr, fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
            raise ValueError()
        return info

    def _identity(self):
        self._journal._local()
        self._journal._guard()
        row = self._journal._resources[self._resource]
        snapshot = self._io(slot_identity.inspect_slot_identities, self._candidate)
        identity = snapshot.for_slot(row['slot'])
        if (row['uid'] != identity.uid or row['gid'] != identity.gid or row['policyDigest'] != snapshot.policy_digest):
            raise ValueError()
        self._uid, self._gid = identity.uid, identity.gid
        self._manager._run(self._manager._probe, self._remaining, terminal_veto=self._owner_veto)
        self._view._check_locked()
        self._remaining()

    def _append(self, action, **fields):
        self._remaining()
        if not self._journal._busy:
            raise ValueError()
        self._journal._append({'version': 2, 'action': action, 'resource': self._resource} | fields)
        self._remaining()

    def _create(self):
        self._identity()
        for name in _PARTS:
            fd = self._open(name, self._chain[-1][0] if self._chain else None)
            info = self._metadata(fd, mode=0o700 if name in ('holaday-pool-broker', 'groups') else None)
            self._chain.append((fd, _sig(info)))
        self._append('material_claim', rootfsDigest=self._view._policy_digest,
                     managerGuid=self._manager._guid, managerOwner=self._manager._owner)
        parent = self._chain[-1][0]
        self._io(os.mkdir, self._resource, 0o700, dir_fd=parent)
        group = self._open(self._resource, parent)
        self._group = (group, _sig(self._metadata(group, mode=0o700)))
        self._io(os.fsync, group)
        self._io(os.fsync, parent)
        for name in _NAMES:
            self._io(os.mkdir, name, 0o700, dir_fd=group)
            fd = self._open(name, group)
            uid, gid, mode = (self._uid, self._gid, 0o700) if name in ('tmp', 'shm', 'profile') else (
                (0, self._gid, 0o710) if name == 'control' else (0, 0, 0o700))
            self._io(os.fchown, fd, uid, gid)
            self._io(os.fchmod, fd, mode)
            self._objects[name] = (fd, _sig(self._metadata(fd, uid, gid, mode)))
            self._io(os.fsync, fd)
            self._io(os.fsync, group)
        # One random Xau record shared only by this original group. The earlier
        # material_claim reserves partial creation too; never recreate on failure.
        entropy = self._io(os.urandom, 16)
        if type(entropy) is not bytes or len(entropy) != 16 or entropy == b'\0' * 16:
            raise ValueError()
        raw = b'\xff\xff\0\0\0\x02' + b'99' + b'\0\x12MIT-MAGIC-COOKIE-1\0\x10' + entropy
        credentials = self._objects['credentials'][0]
        authority = self._raw_fd('xauthority', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                                 mode=0o400, dir_fd=credentials)
        self._io(os.fchown, authority, 0, 0)
        self._io(os.fchmod, authority, 0o400)
        offset = 0
        while offset < len(raw):
            written = self._io(os.write, authority, raw[offset:])
            if type(written) is not int or not 0 < written <= len(raw) - offset:
                raise ValueError()
            offset += written
        self._authority = (authority, _sig(self._io(os.fstat, authority)), hashlib.sha256(raw).hexdigest(), len(raw))
        self._check_private_file('xauthority', self._authority)
        self._io(os.fsync, authority)
        self._io(os.fsync, credentials)
        self._remaining()
        self._socket = Socket(socket.AF_UNIX, socket.SOCK_SEQPACKET | getattr(socket, 'SOCK_CLOEXEC', 0))
        self._remaining()
        self._io(self._socket.set_inheritable, False)
        self._io(self._socket.setsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
        control = self._objects['control'][0]
        self._io(self._socket.bind, '/proc/self/fd/' + str(control) + '/control.sock')
        self._io(os.chown, 'control.sock', 0, self._gid, dir_fd=control, follow_symlinks=False)
        self._io(os.chmod, 'control.sock', 0o660, dir_fd=control, follow_symlinks=False)
        self._endpoint = _sig(self._io(os.stat, 'control.sock', dir_fd=control, follow_symlinks=False))
        self._io(self._socket.listen, 1)
        self._io(os.fsync, control)
        self._io(os.fsync, group)
        self._verify()
        self._append('material_ready')
        self._verify()

    def _verify(self):
        self._identity()
        row = self._journal._resources[self._resource]
        binding = row.get('material', {})
        if (binding.get('managerGuid') != self._manager._guid or binding.get('managerOwner') != self._manager._owner
                or binding.get('rootfsDigest') != self._view._policy_digest):
            raise ValueError()
        for index, (fd, signature) in enumerate(self._chain):
            if _sig(self._metadata(fd, mode=0o700 if index >= 3 else None)) != signature:
                raise ValueError()
            if index:
                linked = self._io(os.stat, _PARTS[index], dir_fd=self._chain[index - 1][0], follow_symlinks=False)
                if _sig(linked) != signature:
                    raise ValueError()
        fd, signature = self._group
        if (_sig(self._metadata(fd, mode=0o700)) != signature or _sig(self._io(os.stat,
                self._resource, dir_fd=self._chain[-1][0], follow_symlinks=False)) != signature
                or set(self._io(os.listdir, fd)) != set(_NAMES)):
            raise ValueError()
        for name, (child, original) in self._objects.items():
            if (_sig(self._metadata(child, original[3], original[4], stat.S_IMODE(original[2]))) != original
                    or _sig(self._io(os.stat, name, dir_fd=fd, follow_symlinks=False)) != original):
                raise ValueError()
        control = self._objects['control'][0]
        endpoint = self._io(os.stat, 'control.sock', dir_fd=control, follow_symlinks=False)
        if (_sig(endpoint) != self._endpoint or not stat.S_ISSOCK(endpoint.st_mode) or endpoint.st_nlink != 1
                or endpoint.st_uid != 0 or endpoint.st_gid != self._gid or stat.S_IMODE(endpoint.st_mode) != 0o660
                or set(self._io(os.listdir, control)) != {'control.sock'}
                or set(self._io(os.listdir, self._objects['credentials'][0])) !=
                    {'xauthority', *(r + '.binding' for r in self._credentials),
                     *(['egress'] if self._egress is not None and self._egress._credential is not None else [])}):
            raise ValueError()
        self._check_private_file('xauthority', self._authority)
        self._check_namespaces()
        for role in self._credentials:
            self._check_credential(role)
        if self._endpoints is not None:
            self._endpoints._verify_locked()
        if self._egress is not None:
            self._egress._verify_locked()

    def _namespace(self, fd, name):
        if self._io(fcntl.ioctl, fd, 0xb703) != _NS[name]:
            raise ValueError()
        info = self._io(os.fstat, fd)
        return (info.st_dev, info.st_ino)

    def _check_namespaces(self):
        for name, (original, identity) in self._host_ns.items():
            if self._namespace(original, name) != identity:
                raise ValueError()
            # Intentional proc magic links are verified NSFS handles.
            current = self._raw_fd('/proc/self/ns/' + name, os.O_RDONLY | os.O_CLOEXEC)
            try:
                if self._namespace(current, name) != identity:
                    raise ValueError()
            finally:
                self._close_fd(current)

    def _check_credential(self, role):
        self._check_private_file(role + '.binding', self._credentials[role])

    def _check_private_file(self, name, record):
        fd, signature, digest, size = record
        info = self._io(os.fstat, fd)
        linked = self._io(os.stat, name, dir_fd=self._objects['credentials'][0], follow_symlinks=False)
        if (_sig(info) != signature or _sig(linked) != signature or not stat.S_ISREG(info.st_mode)
                or info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o400
                or info.st_nlink != 1 or info.st_size != size
                or set(self._io(os.listxattr, fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
            raise ValueError()
        raw = self._io(os.pread, fd, 8193, 0)
        if len(raw) != size or not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), digest):
            raise ValueError()
        if _sig(self._io(os.fstat, fd)) != signature:
            raise ValueError()

    def prepare_role(self, role):
        def prepare():
            count = len(self._credentials)
            if type(role) is not str or count >= len(ROLES) or role != ROLES[count]:
                raise ValueError()
            group = None
            if role == 'anchor':
                self._verify()
                if self._host_ns or self._workers:
                    raise ValueError()
                for name in _NS:
                    fd = self._raw_fd('/proc/self/ns/' + name, os.O_RDONLY | os.O_CLOEXEC)
                    self._host_ns[name] = (fd, self._namespace(fd, name))
            else:
                if set(self._workers) != set(ROLES[:count]):
                    raise ValueError()
                # The composed bridge check already validates this exact
                # anchor and material. Do not repeat that same initial scan.
                anchor = self._bridge_locked() if self._endpoints is not None else self._anchor_locked()
                group = {name: list(anchor._view._namespaces[name][1]) for name in ('net', 'ipc')}
            entropy = self._io(os.urandom, 32)
            if type(entropy) is not bytes or len(entropy) != 32 or entropy == b'\0' * 32:
                raise ValueError()
            objects = {'root': self._view._root, 'tmp': self._objects['tmp'][0], 'shm': self._objects['shm'][0]}
            pairs = {}
            for name, fd in objects.items():
                info = self._io(os.fstat, fd)
                pairs[name] = [info.st_dev, info.st_ino]
            binding = {'version': 1, 'candidate': self._candidate, 'resource': self._resource, 'role': role,
                'slot': self._journal._resources[self._resource]['slot'], 'uid': self._uid, 'gid': self._gid,
                'brokerPid': self._io(os.getpid), 'handshake': entropy.hex(),
                'hostNamespaces': {name: list(self._host_ns[name][1]) for name in ('net', 'ipc', 'mnt')},
                'groupNamespaces': group, 'objects': pairs}
            if role == 'anchor':
                binding['application'] = {'pid': self._pin._pid, 'uid': 998, 'gid': self._pin._gid,
                    'boot': self._pin._boot, 'pidNamespace': list(self._host_ns['pid'][1])}
                binding['dataKey'] = _derive_data_key(self._journal._resources[self._resource]['capability'],
                    self._candidate, self._pin._boot, self._resource)
            raw = json.dumps(binding, separators=(',', ':')).encode()
            quartet_worker_guard._decode_binding(raw, self._candidate, self._resource, role)
            self._append('credential_claim', role=role)
            parent = self._objects['credentials'][0]
            fd = self._raw_fd(role + '.binding', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                              mode=0o400, dir_fd=parent)
            self._io(os.fchown, fd, 0, 0)
            self._io(os.fchmod, fd, 0o400)
            offset = 0
            while offset < len(raw):
                count = self._io(os.write, fd, raw[offset:])
                if type(count) is not int or not 0 < count <= len(raw) - offset:
                    raise ValueError()
                offset += count
            digest = hashlib.sha256(raw).hexdigest()
            self._credentials[role] = (fd, _sig(self._io(os.fstat, fd)), digest, len(raw))
            self._bindings[role] = binding
            self._check_credential(role)
            self._io(os.fsync, fd)
            self._io(os.fsync, parent)
            if role == 'anchor': self._verify()
            else: self._anchor_locked()
            self._append('credential_ready', role=role, bindingDigest=digest)
            if role == 'anchor': self._verify()
            else: self._anchor_locked()
        self._run(prepare)

    def _anchor_locked(self):
        from quartet_worker_channel import _WorkerChannel
        self._remaining()
        anchor = self._workers.get('anchor')
        row = self._journal._resources[self._resource]['roles'].get('anchor', {})
        if (type(anchor) is not _WorkerChannel or anchor._material is not self or anchor._role != 'anchor'
                or not row.get('granted', False)):
            raise ValueError()
        anchor._check_locked()
        self._remaining()
        return anchor

    def accept_role(self, role):
        # Trusted loader preloads this module after material/view dependencies.
        from quartet_worker_channel import _WorkerChannel
        def accept():
            _WorkerChannel._accept_locked(self, role)
        self._run(accept, handshake=True)

    def _bridge_locked(self):
        from quartet_bridge_channel import _BridgeChannel
        if (type(self._bridge) is not _BridgeChannel or not self._bridge._committed
                or self._journal._resources[self._resource].get('bridge', {}).get('state') != 'committed'):
            raise ValueError()
        return self._bridge._check_locked()

    def _run(self, operation, *, handshake=False):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy = True
        try:
            duration = 5 if handshake else 30
            precise = time.monotonic_ns()
            if type(precise) is not int or not self._create_last_ns <= precise < 2**63 - duration * 1000000000:
                raise ValueError()
            self._create_last_ns = precise
            self._transaction_deadline_ns = (precise + duration * 1000000000 if self._runtime is not None
                else self._create_deadline_ns)
            self._last = time.monotonic()
            if not math.isfinite(self._last):
                raise ValueError()
            self._deadline = self._last + duration
            def retire():
                self._retired = True
                self._discard()
            self._journal._run(operation, self._remaining, failure_cleanup=retire)
            self._remaining()
        except Exception:
            self._retired = True
            _deny()
        finally:
            self._busy = False
            if self._retired:
                self._discard()

    def _check(self):
        self._run(self._verify)

    def _discard(self):
        failed = False
        runtime, self._runtime = self._runtime, None
        if runtime is not None: runtime._discard()
        offer, self._launch_offer = self._launch_offer, None
        if offer is not None: offer.close()
        self._ready_offer = self._scope_guard = None
        self._terminal_workers = ()
        protocol, self._protocol = self._protocol, None
        if protocol is not None:
            try: protocol.close()
            except Exception: failed = True
        clock, self._probe_clock = self._probe_clock, None
        if clock is not None:
            try: clock.close()
            except Exception: failed = True
        egress, self._egress = self._egress, None
        if egress is not None:
            try: egress.close()
            except Exception: failed = True
        bridge, self._bridge = self._bridge, None
        if bridge is not None:
            try:
                bridge.close()
            except Exception:
                failed = True
        endpoints, self._endpoints = self._endpoints, None
        if endpoints is not None:
            try:
                endpoints.close()
            except Exception:
                failed = True
        workers, self._workers = self._workers, {}
        for worker in reversed(tuple(workers.values())):
            try:
                worker.close()
            except Exception:
                failed = True
        channel, self._socket = self._socket, None
        if channel is not None:
            try:
                channel.close()
            except Exception:
                failed = True
        while self._fds:
            fd = self._fds.pop()
            try:
                os.close(fd)
            except Exception:
                failed = True
        view, self._view = self._view, None
        if view is not None:
            try:
                view.close()
            except Exception:
                failed = True
        if failed:
            _deny()

    def close(self):
        self._retired = True
        if not self._busy:
            self._discard()

    def __enter__(self):
        self._check()
        return self

    def __exit__(self, *_exc):
        self.close()
