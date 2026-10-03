"""Root-side necessary worker identity, distinct from PinnedApplication.

The first SCM PID is only a candidate. This pins it before original-unit
observations; a fresh same-pin challenge/reply and durable one-use grant are
still required by the (not yet wired) root transaction. No work is authorized
by this object and no application registration contract is relaxed.
"""

import json
import math
import os
import re
import select
import signal
import struct
import sys
import time

import manager_probe
import slot_identity
from protocol import _identifier, _unique_object, _reject_constant
from quartet_records import ROLES
from resource_journal import ResourceJournal
from xvfb_launch import _message

_UNIT_FIELDS = (('Id', 's'), ('InvocationID', 'ay'), ('ActiveState', 's'))
_SERVICE_FIELDS = (('Type', 's'), ('Restart', 's'), ('UID', 'u'), ('GID', 'u'),
                   ('MainPID', 'u'), ('ControlGroup', 's'))


def _deny():
    try:
        raise ValueError('POOL_BROKER_WORKER_PIN_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class _WorkerPin:
    __slots__ = ('_fd', '_proc', '_temporary', '_journal', '_manager', '_resource', '_role',
                 '_peer', '_pid', '_uid', '_gid', '_record', '_busy', '_retired', '_origin_veto')

    def __init__(self):
        raise TypeError('use original worker transaction')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private worker pin')

    @classmethod
    def from_received_peer(cls, journal, manager, resource, role, credentials, *, scope_guard=None, scope_veto=None):
        """Only the root listener supplies kernel SCM_CREDENTIALS, never JSON.

        scope_guard can only shorten/veto the manager's fixed budget. The
        eventual root handshake must pass its original absolute-deadline veto.
        """
        return cls._acquire(journal, manager, resource, role, credentials, scope_guard, False, scope_veto)

    @classmethod
    def _from_received_peer_locked(cls, journal, manager, resource, role, credentials, *, scope_guard=None, scope_veto=None):
        """Join the same original writer; never acquire or release its lock."""
        return cls._acquire(journal, manager, resource, role, credentials, scope_guard, True, scope_veto)

    @classmethod
    def _acquire(cls, journal, manager, resource, role, credentials, scope_guard, locked, scope_veto):
        self = object.__new__(cls)
        self._fd, self._proc, self._temporary = None, None, []
        self._retired, self._busy = False, False
        self._origin_veto = scope_veto
        try:
            if scope_veto is not None and not callable(scope_veto): raise ValueError()
            if (type(journal) is not ResourceJournal or type(manager) is not manager_probe.SystemManagerProbe
                    or journal._registration is not manager._registration or journal._pin is not manager._pin
                    or type(role) is not str or role not in ROLES
                    or type(credentials) is not bytes or len(credentials) != 12):
                raise ValueError()
            _identifier(resource, 32)
            self._journal, self._manager, self._resource, self._role = journal, manager, resource, role
            self._peer = credentials
            self._pid, self._uid, self._gid = struct.unpack('=iII', credentials)
            if not 2 <= self._pid <= 2147483647:
                raise ValueError()

            def acquire():
                journal._local()
                row, role_row = self._row()
                snapshot = slot_identity.inspect_slot_identities(manager._candidate)
                identity = snapshot.for_slot(row['slot'])
                if ((self._uid, self._gid) != (row['uid'], row['gid'])
                        or (identity.uid, identity.gid) != (self._uid, self._gid)
                        or snapshot.policy_digest != row['policyDigest']):
                    raise ValueError()
                self._record = self._record_of(role_row)
                self._budget()
                self._fd = os.pidfd_open(self._pid, 0)
                self._budget()
                os.set_inheritable(self._fd, False)
                self._observe()
                self._proc = os.open('/proc/' + str(self._pid), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
                self._budget()
                self._verify()

            self._run(acquire, scope_guard, locked=locked)
            return self
        except Exception:
            self.close()
            _deny()

    @staticmethod
    def _record_of(row):
        return tuple(row[key] for key in ('unit', 'managerGuid', 'managerOwner', 'invocation'))

    def _row(self):
        row = self._journal._resources[self._resource]
        if (row['version'] != 2 or row['component'] != 'quartet'
                or row['candidate'] != self._manager._candidate or row['boot'] != self._journal._boot):
            raise ValueError()
        role = row['roles'][self._role]
        if (role['state'] != 'observed' or role['managerGuid'] != self._manager._guid
                or role['managerOwner'] != self._manager._owner
                or role['unit'] != 'holaday-pool-' + self._role + '-' + self._resource + '.service'):
            raise ValueError()
        return row, role

    def _budget(self):
        if (self._retired or not self._busy or sys.platform != 'linux'
                or os.getresuid() != (0, 0, 0) or os.getresgid() != (0, 0, 0)):
            raise ValueError()
        self._journal._alive()
        self._manager._remaining()
        if self._retired:
            raise ValueError()

    def _read(self, path, limit, *, parent=None):
        self._budget()
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                     **({'dir_fd': parent} if parent is not None else {}))
        self._temporary.append(fd)
        try:
            self._budget()
            raw = os.read(fd, limit + 1)
            self._budget()
            if type(raw) is not bytes or not raw or len(raw) > limit:
                raise ValueError()
        finally:
            owned = self._temporary.pop()
            os.close(owned)
        self._budget()
        return raw

    def _observe(self):
        self._budget()
        if self._fd is None:
            raise ValueError()
        signal.pidfd_send_signal(self._fd, 0, None, 0)
        self._budget()
        raw = self._read('/proc/self/fdinfo/' + str(self._fd), 8192)
        pids = [line for line in raw.splitlines() if line.startswith(b'Pid:')]
        if len(pids) != 1 or re.fullmatch(rb'Pid:[ \t]+' + str(self._pid).encode(), pids[0]) is None:
            raise ValueError()
        poller = select.poll()
        poller.register(self._fd, select.POLLIN | select.POLLHUP | select.POLLERR)
        if poller.poll(0):
            raise ValueError()
        self._budget()

    def _property(self, name, signature, *, service=False):
        manager = self._manager
        self._observe()
        manager._guard()
        unit = self._record[0]
        path = '/org/freedesktop/systemd1/unit/' + unit.replace('-', '_2d').replace('.', '_2e')
        argv = ('/proc/self/fd/' + str(manager._tool),
                '--address=unix:path=/run/dbus/system_bus_socket,guid=' + manager._guid,
                '--json=short', '--no-pager', '--auto-start=no', '--allow-interactive-authorization=no',
                '--timeout=2s', 'call', manager._owner, path, 'org.freedesktop.DBus.Properties', 'Get',
                'ss', 'org.freedesktop.systemd1' + ('.Service' if service else '.Unit'), name)
        raw = manager._io(manager_probe._capture, argv, manager._tool, manager._deadline, manager._live_budget)
        value = _message(raw, 'v')
        result = self._typed_property(value, signature)
        manager._guard()
        self._observe()
        return result

    @staticmethod
    def _typed_property(value, signature):
        if type(value) is not dict or set(value) != {'type', 'data'} or value['type'] != signature:
            raise ValueError()
        result = value['data']
        if signature == 'u':
            if type(result) is not int or not 0 <= result <= 4294967295:
                raise ValueError()
        elif signature == 's':
            if type(result) is not str or len(result) > 512:
                raise ValueError()
        elif signature == 'ay':
            if type(result) is not list or len(result) != 16 or any(type(v) is not int or not 0 <= v <= 255 for v in result):
                raise ValueError()
            result = _identifier(bytes(result).hex(), 32)
        return result

    def _properties(self, *, service):
        """One bounded read-only batch, not a snapshot or reusable lease.

        busctl v249 get-property does not apply call's message timeout flags.
        The real collector instead enforces a 2s absolute deadline AND the
        original outer budget, including EOF, child reaping and final veto.
        Only the already-pinned unique bus owner receives fixed Properties.Get
        calls; this never names an activatable service or invokes a mutation.
        """
        if type(service) is not bool:
            raise ValueError()
        fields = _SERVICE_FIELDS if service else _UNIT_FIELDS
        manager = self._manager
        self._observe()
        manager._guard()
        path = '/org/freedesktop/systemd1/unit/' + self._record[0].replace('-', '_2d').replace('.', '_2e')
        argv = ('/proc/self/fd/' + str(manager._tool),
                '--address=unix:path=/run/dbus/system_bus_socket,guid=' + manager._guid,
                '--json=short', '--no-pager', '--auto-start=no', '--allow-interactive-authorization=no',
                '--timeout=2s', 'get-property', manager._owner, path,
                'org.freedesktop.systemd1' + ('.Service' if service else '.Unit'),
                *(name for name, _signature in fields))
        now = time.monotonic()
        self._budget()
        if type(now) not in (int, float) or not math.isfinite(now):
            raise ValueError()
        raw = manager._io(manager_probe._capture, argv, manager._tool,
            min(manager._deadline, now + 2), manager._live_budget)
        if type(raw) is not bytes or not 1 <= len(raw) <= 16384:
            raise ValueError()
        lines = raw.splitlines()
        if len(lines) != len(fields) or any(not line for line in lines):
            raise ValueError()
        values = tuple(self._typed_property(json.loads(line.decode('utf-8'),
            object_pairs_hook=_unique_object, parse_constant=_reject_constant), signature)
            for line, (_name, signature) in zip(lines, fields))
        manager._guard()
        self._observe()
        return values

    def _verify(self):
        self._budget()
        self._journal._guard()
        row, role = self._row()
        if self._record_of(role) != self._record or (row['uid'], row['gid']) != (self._uid, self._gid):
            raise ValueError()
        self._observe()
        self._manager._probe()
        group = '/holadaypool.slice/holadaypool-' + self._resource + '.slice/' + self._record[0]
        if (self._properties(service=False) != (self._record[0], self._record[3], 'active')
                or self._properties(service=True) != ('exec', 'no', self._uid, self._gid, self._pid, group)):
            raise ValueError()
        if self._read('cgroup', 8192, parent=self._proc) != ('0::' + group + '\n').encode():
            raise ValueError()
        raw = self._read('status', 65536, parent=self._proc)
        for key, value in ((b'Uid:', self._uid), (b'Gid:', self._gid)):
            lines = [line for line in raw.splitlines() if line.startswith(key)]
            if (len(lines) != 1 or re.fullmatch(key + rb'[ \t]+[0-9]+(?:[ \t]+[0-9]+){3}', lines[0]) is None
                    or [int(v) for v in lines[0].split()[1:]] != [value] * 4):
                raise ValueError()
        if (self._property('MainPID', 'u', service=True) != self._pid
                or self._property('InvocationID', 'ay') != self._record[3]):
            raise ValueError()
        self._manager._probe()
        self._journal._guard()
        self._observe()

    def _run(self, operation, scope_guard, *, locked=False, terminal_veto=None):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy = True
        try:
            if terminal_veto is not None and not callable(terminal_veto): raise ValueError()
            def terminal():
                if terminal_veto is not None: terminal_veto()
                self._veto()
                if locked and not self._journal._busy: raise ValueError()
            last = time.monotonic()
            def scope():
                nonlocal last
                self._journal._alive()
                if locked and not self._journal._busy:
                    raise ValueError()
                remaining = scope_guard() if scope_guard is not None else None
                now = time.monotonic()
                if (not math.isfinite(now) or not math.isfinite(last) or now < last
                        or (remaining is not None and (type(remaining) not in (int, float)
                            or not math.isfinite(remaining) or remaining <= 0))):
                    raise ValueError()
                last = now
                budget = self._manager._deadline - now
                if budget <= 0:
                    raise ValueError()
                # Last pure-state veto AFTER arbitrary caller/native callbacks.
                self._veto()
                if locked and not self._journal._busy:
                    raise ValueError()
                return budget if remaining is None else min(budget, remaining)
            def transaction():
                if not locked:
                    return self._journal._run(operation)
                scope()
                self._journal._guard()
                result = operation()
                self._journal._guard()
                scope()
                return result
            result = self._manager._run(transaction, scope, terminal_veto=terminal)
            terminal()
            return result
        except Exception:
            self._retired = True
            _deny()
        finally:
            self._busy = False
            if self._retired:
                self._discard()

    def _veto(self):
        if self._origin_veto is not None: self._origin_veto()
        journal, manager = self._journal, self._manager
        registration = journal._registration
        if (self._retired or not self._busy or journal._retired or manager._retired
                or registration is not manager._registration or registration._revoked
                or not registration._received or registration._pin is not journal._pin
                or journal._pin is not manager._pin or journal._pin._fd is None
                or registration._candidate.hex() != manager._candidate):
            raise ValueError()

    def check_sender(self, credentials, *, scope_guard=None):
        self._check_sender(credentials, scope_guard, False)

    def _check_sender_locked(self, credentials, *, scope_guard=None):
        self._check_sender(credentials, scope_guard, True)

    def _check_sender(self, credentials, scope_guard, locked):
        try:
            if type(credentials) is not bytes or credentials != self._peer:
                raise ValueError()
            self._run(self._verify, scope_guard, locked=locked)
        except Exception:
            self.close()
            _deny()

    def _discard(self):
        fds, self._temporary = self._temporary, []
        for name in ('_proc', '_fd'):
            fd = getattr(self, name)
            setattr(self, name, None)
            if fd is not None:
                fds.append(fd)
        failed = False
        while fds:
            fd = fds.pop()
            try:
                os.close(fd)
            except Exception:
                failed = True
        return failed

    def close(self):
        self._retired = True
        if not self._busy and self._discard():
            _deny()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()
