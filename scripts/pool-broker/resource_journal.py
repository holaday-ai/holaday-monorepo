"""Durable dispatch/observation evidence. No readiness or exit claims."""

import fcntl
import hmac
import json
import os
import re
import stat

import launch_authorization
from launch_registration import LaunchRegistration
from protocol import CreateRequest, ResourceRequest, decode_request, _identifier, _unique_object, _reject_constant

_HEADER = b'{"version":1,"action":"initialize"}\n'
_NAME = 'resource-journal.jsonl'
_LIMIT = 262144


def _deny():
    try:
        raise ValueError('POOL_BROKER_RESOURCE_JOURNAL_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _replay(raw):
    if not raw.startswith(_HEADER) or not raw.endswith(b'\n') or len(raw) > _LIMIT:
        raise ValueError()
    resources, requests, slots, capabilities = {}, {}, set(), set()
    lines = raw[len(_HEADER):].splitlines()
    for revision, line in enumerate(lines, 1):
        row = json.loads(line.decode('utf-8'), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        if (type(row) is not dict or type(row.get('version')) is not int or row['version'] != 1
                or type(row.get('revision')) is not int or row['revision'] != revision):
            raise ValueError()
        resource = _identifier(row.get('resource'), 32)
        common = {'version', 'action', 'revision', 'resource'}
        if row.get('action') == 'prepare':
            if set(row) != common | {'capability', 'candidate', 'boot', 'requestId', 'component', 'slot'}:
                raise ValueError()
            for name, length in (('capability', 64), ('candidate', 40), ('boot', 32), ('requestId', 32)):
                _identifier(row[name], length)
            request = decode_request(json.dumps({key: row[key] for key in
                ('version', 'requestId', 'boot', 'component', 'slot')} | {'action': 'create'}).encode())
            key, slot = (request.boot, request.request_id), (request.component, request.slot)
            if (len(resources) >= 128 or resource in resources or key in requests
                    or slot in slots or row['capability'] in capabilities):
                raise ValueError()
            resources[resource] = row | {'state': 'prepared'}
            requests[key] = resource
            slots.add(slot)
            capabilities.add(row['capability'])
        elif row.get('action') == 'dispatch':
            binding = {'unit', 'managerGuid', 'managerOwner'}
            if (set(row) not in (common, common | binding) or resource not in resources
                    or resources[resource]['state'] != 'prepared'):
                raise ValueError()
            if set(row) == common | binding:
                if (resources[resource]['component'] != 'xvfb'
                        or row['unit'] != 'holaday-pool-xvfb-' + resource + '.service'
                        or type(row['managerOwner']) is not str or len(row['managerOwner']) > 64
                        or re.fullmatch(r':[0-9]+\.[0-9]+', row['managerOwner']) is None):
                    raise ValueError()
                _identifier(row['managerGuid'], 32)
                resources[resource].update({key:row[key] for key in binding})
            resources[resource]['state'] = 'dispatching'
        elif row.get('action') == 'accepted':
            if (set(row) != common | {'job'} or resource not in resources
                    or resources[resource]['state'] != 'dispatching' or 'unit' not in resources[resource]
                    or type(row['job']) is not str
                    or re.fullmatch(r'/org/freedesktop/systemd1/job/[1-9][0-9]{0,9}', row['job']) is None
                    or int(row['job'].rsplit('/',1)[1]) > 4294967295):
                raise ValueError()
            resources[resource].update(state='accepted', job=row['job'])
        elif row.get('action') == 'observe':
            if (set(row) != common | {'invocation'} or resource not in resources
                    or resources[resource]['state'] != 'accepted'):
                raise ValueError()
            _identifier(row['invocation'], 32)
            resources[resource].update(state='observed', invocation=row['invocation'])
        else:
            raise ValueError()
    return resources, requests, len(lines)


class PreparedResource:
    """Opaque instance-local reference; not an execution permission."""
    __slots__ = ()

    def __init__(self):
        raise TypeError('private resource reference')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private resource reference')


class ResourceJournal:
    """Single trusted writer; poison on uncertainty and retain every written byte."""

    def __init__(self):
        raise TypeError('use fixed journal open')

    @classmethod
    def open(cls, registration):
        journal = object.__new__(cls)
        journal._fds, journal._handles = [], {}
        journal._busy, journal._retired = True, False
        failed = True
        try:
            if type(registration) is not LaunchRegistration:
                raise ValueError()
            registration._require_registered()
            journal._registration, journal._pin = registration, registration._pin
            journal._candidate, journal._boot = registration._candidate.hex(), registration._pin._boot
            journal._identity_guard()
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            for name in ('/', 'var', 'lib', 'holaday-pool-broker'):
                fd = os.open(name, flags, **({'dir_fd': journal._fds[-1]} if journal._fds else {}))
                journal._fds.append(fd)
                journal._alive()
                journal._metadata(fd, mode=0o700 if name == 'holaday-pool-broker' else None)
            journal._parent = journal._fds[-1]
            fd = os.open(_NAME, os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
                         dir_fd=journal._parent)
            journal._fds.append(fd)
            journal._fd = fd
            journal._alive()
            info = journal._metadata(fd, regular=True, mode=0o600)
            journal._identity = (info.st_dev, info.st_ino)
            journal._io(fcntl.flock, fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            journal._expected = journal._read()
            journal._resources, journal._requests, journal._revision = _replay(journal._expected)
            journal._guard()
            failed = False
        except Exception:
            journal._retired = True
        finally:
            journal._busy = False
            if failed:
                journal._release()
        if failed:
            _deny()
        return journal

    def _alive(self):
        if self._retired:
            raise ValueError()

    def _io(self, call, *args, **kwargs):
        self._alive()
        result = call(*args, **kwargs)
        self._alive()
        return result

    def _metadata(self, fd, regular=False, mode=None):
        info = self._io(os.fstat, fd)
        if (info.st_uid != 0 or info.st_gid != 0 or info.st_mode & 0o7022
                or not (stat.S_ISREG(info.st_mode) if regular else stat.S_ISDIR(info.st_mode))
                or mode is not None and stat.S_IMODE(info.st_mode) != mode
                or regular and info.st_nlink != 1):
            raise ValueError()
        attrs = self._io(os.listxattr, fd)
        if any(name in attrs for name in ('system.posix_acl_access', 'system.posix_acl_default', 'security.capability')):
            raise ValueError()
        return info

    def _identity_guard(self):
        self._io(launch_authorization._context)
        self._io(self._registration._require_registered)
        if (self._registration._pin is not self._pin or self._pin._boot != self._boot
                or self._registration._candidate.hex() != self._candidate):
            raise ValueError()

    def _read(self):
        before = self._metadata(self._fd, regular=True, mode=0o600)
        if not len(_HEADER) <= before.st_size <= _LIMIT:
            raise ValueError()
        raw = bytearray()
        while len(raw) < before.st_size:
            part = self._io(os.pread, self._fd, before.st_size - len(raw), len(raw))
            if type(part) is not bytes or not 0 < len(part) <= before.st_size - len(raw):
                raise ValueError()
            raw.extend(part)
        after = self._metadata(self._fd, regular=True, mode=0o600)
        if ((before.st_dev, before.st_ino, before.st_size) != (after.st_dev, after.st_ino, after.st_size)
                or (after.st_dev, after.st_ino) != self._identity):
            raise ValueError()
        return bytes(raw)

    def _guard(self):
        self._identity_guard()
        for index, fd in enumerate(self._fds[:-1]):
            info = self._metadata(fd, mode=0o700 if index == len(self._fds) - 2 else None)
            if index:
                linked = self._io(os.stat, ('var', 'lib', 'holaday-pool-broker')[index - 1],
                                  dir_fd=self._fds[index - 1], follow_symlinks=False)
                if (linked.st_dev, linked.st_ino) != (info.st_dev, info.st_ino):
                    raise ValueError()
        info = self._metadata(self._fd, regular=True, mode=0o600)
        linked = self._io(os.stat, _NAME, dir_fd=self._parent, follow_symlinks=False)
        if ((info.st_dev, info.st_ino) != self._identity
                or (linked.st_dev, linked.st_ino) != self._identity
                or self._read() != self._expected):
            raise ValueError()
        self._identity_guard()

    def _run(self, operation):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy, failed = True, True
        try:
            self._guard()
            result = operation()
            self._guard()
            failed = False
        except Exception:
            self._retired = True
        finally:
            self._busy = False
            if self._retired:
                self._release()
        if failed:
            _deny()
        return result

    def _foreign(self):
        return any(row['candidate'] != self._candidate or row['boot'] != self._boot
                   for row in self._resources.values())

    def _local(self):
        if self._foreign():
            raise ValueError()

    def _append(self, row):
        row = row | {'version': 1, 'revision': self._revision + 1}
        line = json.dumps(row, separators=(',', ':')).encode() + b'\n'
        expected = self._expected + line
        resources, requests, revision = _replay(expected)
        self._guard()
        offset = 0
        while offset < len(line):
            count = self._io(os.write, self._fd, line[offset:])
            if type(count) is not int or not 0 < count <= len(line) - offset:
                raise ValueError()
            offset += count
        self._io(os.fsync, self._fd)
        self._io(os.fsync, self._parent)
        self._expected = expected
        self._resources, self._requests, self._revision = resources, requests, revision
        self._guard()

    def prepare(self, request):
        def operation():
            self._local()
            if type(request) is not CreateRequest:
                raise ValueError()
            data = {'version': request.version, 'action': request.action, 'requestId': request.request_id,
                    'boot': request.boot, 'component': request.component, 'slot': request.slot}
            if decode_request(json.dumps(data).encode()) != request or request.boot != self._boot:
                raise ValueError()
            resource = self._requests.get((request.boot, request.request_id))
            if resource is not None:
                row = self._resources[resource]
                if row['component'] != request.component or row['slot'] != request.slot:
                    raise ValueError()
            else:
                resource = self._io(os.urandom, 16).hex()
                capability = self._io(os.urandom, 32).hex()
                self._append(data | {'action': 'prepare', 'resource': resource,
                    'capability': capability, 'candidate': self._candidate})
            if resource not in self._handles:
                self._handles[resource] = object.__new__(PreparedResource)
            return self._handles[resource]
        return self._run(operation)

    def claim_dispatch(self, handle):
        def operation():
            self._local()
            resource = next((key for key, value in self._handles.items() if value is handle), None)
            if resource is None or self._resources[resource]['state'] != 'prepared':
                raise ValueError()
            self._append({'action': 'dispatch', 'resource': resource})
        return self._run(operation)

    def query(self, request):
        def operation():
            self._local()
            if type(request) is not ResourceRequest or request.action != 'query' or request.boot != self._boot:
                raise ValueError()
            decode_request(json.dumps({'version': request.version, 'action': request.action,
                'requestId': request.request_id, 'boot': request.boot, 'capability': request.capability}).encode())
            row = next((row for row in self._resources.values()
                        if hmac.compare_digest(row['capability'], request.capability)), None)
            if row is None:
                raise ValueError()
            return {'state': row['state'], 'groupExitProven': False}
        return self._run(operation)

    def snapshot(self):
        def operation():
            prepared = sum(row['state'] == 'prepared' for row in self._resources.values())
            return {'total': len(self._resources), 'prepared': prepared,
                    'dispatching': len(self._resources) - prepared,
                    'foreignBoot': self._foreign(), 'groupExitProven': False}
        return self._run(operation)

    def _release(self):
        self._handles.clear()
        failed = False
        while self._fds:
            fd = self._fds.pop()
            try:
                os.close(fd)
            except Exception:
                failed = True
        return failed

    def close(self):
        self._retired = True
        # Never release the append FD/flock while a synchronous operation owns it.
        if not self._busy:
            if self._release():
                _deny()
