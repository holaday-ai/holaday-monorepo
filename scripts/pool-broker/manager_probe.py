"""Fixed manager probe and private original-job transport. No physical exit authority."""
import array
import hashlib
import json
import math
import os
import re
import select
import selectors
import socket
import stat
import struct
import subprocess
import time

import launch_authorization
from launch_registration import LaunchRegistration
from protocol import _unique_object, _reject_constant, _identifier

Socket = socket.socket
_PATH = '/run/dbus/system_bus_socket'
_BUS = 'org.freedesktop.DBus'
_OBJECT = '/org/freedesktop/DBus'
_SERVICE = 'org.freedesktop.systemd1'


def _deny():
    try:
        raise ValueError('POOL_BROKER_MANAGER_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _capture(argv, tool_fd, deadline, scope_guard):
    """Private external-program boundary, called only with fixed trusted argv.

    Killing this owned CLI does not cancel a manager operation or prove exit of
    any resource. Fixed resource mutations stay inside original group transactions.
    """
    def budget():
        before = time.monotonic()
        # The original probe checks retired AFTER reading its current clock.
        # This is a veto, not a new scope or caller-supplied success proof.
        original = scope_guard()
        after = time.monotonic()
        # Fixed get-property batches can have a deadline shorter than their
        # enclosing manager operation. Count time spent in original pin/proc
        # checks too, then apply a pure owner veto after this final clock read.
        owner = getattr(scope_guard, '__self__', None)
        if type(owner) is SystemManagerProbe:
            owner._capture_veto()
        if (type(before) not in (int, float) or type(after) not in (int, float)
                or not math.isfinite(before) or not math.isfinite(after) or after < before):
            raise TimeoutError()
        remaining = deadline - after
        if (type(original) not in (int, float) or not math.isfinite(remaining) or not math.isfinite(original)
                or remaining <= 0 or original <= 0):
            raise TimeoutError()
        return min(remaining, original)

    budget()
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, cwd='/', close_fds=True,
        pass_fds=(tool_fd,), start_new_session=True)
    out, err, failed = bytearray(), bytearray(), True
    try:
        with selectors.DefaultSelector() as selector:
            for stream, data in ((child.stdout, out), (child.stderr, err)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, data)
            while selector.get_map():
                for key, _ in selector.select(budget()):
                    budget()
                    chunk = os.read(key.fd, 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        key.data.extend(chunk)
                        if len(out) + len(err) > 16384:
                            raise ValueError()
            if child.wait(timeout=budget()) != 0 or err:
                raise ValueError()
            budget()
            failed = False
    except Exception:
        failed = True
    finally:
        # Only this still-owned child, never PID scans or manager units. Failure
        # to reap remains failure; no external lifecycle/idle claim is returned.
        try:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=1)
        except Exception:
            failed = True
        finally:
            for stream in (child.stdout, child.stderr):
                try:
                    stream.close()
                except Exception:
                    failed = True
    if failed:
        _deny()
    budget()
    return bytes(out)


class SystemManagerProbe:
    """Root-only authenticated observations, not a transferable manager lease."""

    def __init__(self):
        raise TypeError('use fixed manager probe')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private manager connection')

    @classmethod
    def open(cls, registration):
        probe = object.__new__(cls)
        probe._fds, probe._entries = [], []
        probe._channel, probe._owner = None, None
        probe._job_stream = None
        probe._busy, probe._retired = True, False
        probe._scope_guard = None
        probe._terminal_veto = None
        probe._last = time.monotonic()
        probe._deadline = probe._last + 5
        failed = True
        try:
            if type(registration) is not LaunchRegistration:
                raise ValueError()
            probe._registration = registration
            probe._io(registration._require_registered)
            probe._pin = registration._pin
            probe._candidate = registration._candidate.hex()
            probe._identity()
            path = '/usr/local/lib/holaday-pool-broker/releases/' + probe._candidate + '/native-build-manifest.json'
            probe._manifest = probe._walk(path, 0o644)
            probe._manifest_raw = probe._read(probe._manifest, 65536)
            manifest = json.loads(probe._manifest_raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
            if (type(manifest) is not dict or type(manifest.get('version')) is not int or manifest['version'] != 1
                    or manifest.get('status') != 'linux-verified' or manifest.get('candidate') != probe._candidate
                    or manifest.get('architecture') not in ('x86_64', 'aarch64')
                    or manifest['architecture'] != os.uname().machine):
                raise ValueError()
            tool = manifest['tools']['/usr/bin/busctl']
            if (type(tool) is not dict or set(tool) != {'resolved', 'sha256'}
                    or tool['resolved'] != '/usr/bin/busctl'):
                raise ValueError()
            probe._digest = _identifier(tool['sha256'], 64)
            probe._tool = probe._walk('/usr/bin/busctl', 0o755)
            if probe._hash_tool() != probe._digest:
                raise ValueError()
            probe._parent = probe._walk('/run/dbus')
            probe._socket_identity = probe._socket_info()
            channel = Socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
            probe._channel = channel
            probe._prepare_socket()
            probe._io(channel.connect, _PATH)
            peer = probe._io(channel.getsockopt, socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            if type(peer) is not bytes or len(peer) != 12:
                raise ValueError()
            pid, uid, gid = struct.unpack('=iII', peer)
            if pid < 1 or uid == 4294967295 or gid == 4294967295:
                raise ValueError()
            probe._peer, probe._authenticated_channel = peer, channel
            probe._prepare_socket()
            probe._io(channel.sendall, b'\x00AUTH EXTERNAL 30\r\n')
            reply = bytearray()
            while len(reply) < 37:
                probe._prepare_socket()
                chunk = probe._io(channel.recv, 37 - len(reply))
                if not chunk:
                    raise ValueError()
                reply.extend(chunk)
            if reply[:3] != b'OK ' or reply[-2:] != b'\r\n':
                raise ValueError()
            probe._guid = _identifier(bytes(reply[3:-2]).decode('ascii'), 32)
            probe._probe()
            failed = False
        except Exception:
            probe._retired = True
        finally:
            probe._busy = False
            if failed:
                probe._release()
        if failed:
            _deny()
        return probe

    def _remaining(self):
        now = time.monotonic()
        outer_remaining = None
        if self._scope_guard is not None:
            outer_remaining = self._scope_guard()
            if outer_remaining is not None and (type(outer_remaining) not in (int,float)
                    or not math.isfinite(outer_remaining) or outer_remaining <= 0):
                raise ValueError()
        # Last, non-IO veto after the clock/native checks. Closing a registration
        # or its original pin does not necessarily close this manager object.
        self._veto()
        if (type(now) not in (int, float) or not math.isfinite(now)
                or now < self._last or not 0 < self._deadline - now <= 5):
            raise ValueError()
        self._last = now
        remaining = self._deadline - now
        return remaining if outer_remaining is None else min(remaining, outer_remaining)

    def _veto(self):
        if self._retired: raise ValueError()
        if hasattr(self, '_pin') and (self._registration._revoked or not self._registration._received
                or self._registration._pin is not self._pin or self._pin._fd is None
                or self._registration._candidate.hex() != self._candidate):
            raise ValueError()

    def _capture_veto(self):
        # Composed trusted scopes expose a separate pure-state tail. Calling
        # their IO-bearing budget again would recreate the timing window.
        veto = self._terminal_veto
        if veto is not None: veto()
        if self._terminal_veto is not veto: raise ValueError()
        self._veto()

    def _live_budget(self):
        self._registration._require_registered()
        return self._remaining()

    def _io(self, call, *args, **kwargs):
        self._remaining()
        result = call(*args, **kwargs)
        self._remaining()
        return result

    def _prepare_socket(self):
        channel = self._channel
        self._identity()
        channel.settimeout(self._remaining())
        # No expensive filesystem checks after applying the fresh IO budget.
        self._remaining()
        if self._channel is not channel:
            raise ValueError()

    def _identity(self):
        self._io(launch_authorization._context)
        self._io(self._registration._require_registered)
        if self._registration._pin is not self._pin or self._registration._candidate.hex() != self._candidate:
            raise ValueError()

    def _metadata(self, fd, mode=None):
        info = self._io(os.fstat, fd)
        if (info.st_uid != 0 or info.st_gid != 0 or info.st_mode & 0o7022
                or (mode is None and not stat.S_ISDIR(info.st_mode))
                or (mode is not None and (not stat.S_ISREG(info.st_mode)
                    or stat.S_IMODE(info.st_mode) != mode or info.st_nlink != 1))):
            raise ValueError()
        if set(self._io(os.listxattr, fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}:
            raise ValueError()
        return info

    def _walk(self, path, mode=None):
        parent = None
        parts = ('/', *path.strip('/').split('/'))
        for index, name in enumerate(parts):
            leaf_mode = mode if index == len(parts) - 1 else None
            flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | (os.O_DIRECTORY if leaf_mode is None else os.O_NONBLOCK)
            self._remaining()
            fd = os.open(name, flags, **({'dir_fd': parent} if parent is not None else {}))
            self._fds.append(fd)
            self._remaining()
            info = self._metadata(fd, leaf_mode)
            self._entries.append((fd, parent, name, leaf_mode, info.st_dev, info.st_ino))
            parent = fd
        return parent

    def _read(self, fd, limit):
        before = self._io(os.fstat, fd)
        if not 0 < before.st_size <= limit:
            raise ValueError()
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = self._io(os.pread, fd, min(65536, before.st_size-len(raw)), len(raw))
            if not chunk or len(chunk) > before.st_size-len(raw):
                raise ValueError()
            raw.extend(chunk)
        after = self._io(os.fstat, fd)
        if (before.st_dev,before.st_ino,before.st_size) != (after.st_dev,after.st_ino,after.st_size):
            raise ValueError()
        return bytes(raw)

    def _hash_tool(self):
        return hashlib.sha256(self._read(self._tool, 134217728)).hexdigest()

    def _socket_info(self):
        info = self._io(os.stat, 'system_bus_socket', dir_fd=self._parent, follow_symlinks=False)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or info.st_nlink != 1:
            raise ValueError()
        return info.st_dev, info.st_ino

    def _guard(self):
        self._identity()
        for fd, parent, name, mode, dev, ino in self._entries:
            info = self._metadata(fd, mode)
            if (info.st_dev, info.st_ino) != (dev, ino):
                raise ValueError()
            if parent is not None:
                linked = self._io(os.stat, name, dir_fd=parent, follow_symlinks=False)
                if (linked.st_dev, linked.st_ino) != (dev, ino):
                    raise ValueError()
        if (self._socket_info() != self._socket_identity or self._hash_tool() != self._digest
                or self._read(self._manifest,65536) != self._manifest_raw):
            raise ValueError()
        self._identity()

    def _call(self, method, value, signature):
        self._guard()
        argv = ('/proc/self/fd/' + str(self._tool), '--address=unix:path=' + _PATH + ',guid=' + self._guid,
            '--json=short', '--no-pager', '--auto-start=no', '--allow-interactive-authorization=no',
            '--timeout=2s', 'call', _BUS, _OBJECT, _BUS, method, 's', value)
        raw = self._io(_capture, argv, self._tool, self._deadline, self._live_budget)
        if type(raw) is not bytes or not 1 <= len(raw) <= 16384:
            raise ValueError()
        message = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        if (type(message) is not dict or set(message) != {'type', 'data'} or message['type'] != signature
                or type(message['data']) is not list or len(message['data']) != 1):
            raise ValueError()
        result = message['data'][0]
        if signature == 's':
            if type(result) is not str or len(result) > 64 or re.fullmatch(r':[0-9]+\.[0-9]+',result) is None:
                raise ValueError()
        elif type(result) is not int or not 0 <= result < 4294967295:
            raise ValueError()
        self._guard()
        return result

    def _probe(self):
        owner = self._call('GetNameOwner', _SERVICE, 's')
        if self._owner is not None and owner != self._owner:
            raise ValueError()
        if (self._call('GetConnectionUnixUser', owner, 'u') != 0
                or self._call('GetConnectionUnixProcessID', owner, 'u') != 1
                or self._call('GetNameOwner', _SERVICE, 's') != owner):
            raise ValueError()
        self._owner = owner
        self._guard()
        return {'reachable': True, 'managerBound': True, 'groupExitProven': False}

    def _run(self, operation, scope_guard=None, *, terminal_veto=None):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy, failed = True, True
        self._scope_guard = scope_guard
        self._terminal_veto = terminal_veto
        try:
            if terminal_veto is not None and not callable(terminal_veto): raise ValueError()
            now = time.monotonic()
            if not math.isfinite(now) or now < self._last:
                raise ValueError()
            self._last, self._deadline = now, now + 5
            self._remaining()
            result = operation()
            self._remaining()
            self._capture_veto()
            failed = False
        except Exception:
            self._retired = True
        finally:
            self._busy = False
            self._scope_guard = None
            self._terminal_veto = None
            if self._retired:
                self._release()
        if failed:
            _deny()
        return result

    def probe(self):
        return self._run(self._probe)

    def _release(self):
        failed = False
        jobs, self._job_stream = self._job_stream, None
        if jobs is not None: jobs._retire()
        channel, self._channel = self._channel, None
        if channel is not None:
            try: channel.close()
            except Exception: failed = True
        while self._fds:
            fd = self._fds.pop()
            try: os.close(fd)
            except Exception: failed = True
        return failed

    def close(self):
        self._retired = True
        if not self._busy and self._release():
            _deny()


# Private fixed-subset D-Bus marshalling for the original persistent job stream.
# Decoded values are observations, never resource/exit authority. No FD types,
# arbitrary containers, activation or public RPC/command surface are supported.
_DBUS_FIELDS = {1: 'o', 2: 's', 3: 's', 4: 's', 5: 'u', 6: 's', 7: 's', 8: 'g', 9: 'u'}


def _dbus_types(signature):
    if type(signature) is not str or len(signature) > 64: raise ValueError()
    result, offset = [], 0
    while offset < len(signature):
        if signature.startswith('(uo)', offset): kind = '(uo)'
        elif signature.startswith('ay', offset): kind = 'ay'
        elif signature[offset] in 'yubsogv': kind = signature[offset]
        else: raise ValueError()
        result.append(kind)
        offset += len(kind)
    return result


class _DBusReader:
    def __init__(self, data, offset, end, endian):
        self.data, self.offset, self.end, self.endian = data, offset, end, endian

    def take(self, count):
        if not 0 <= count <= self.end - self.offset: raise ValueError()
        raw = self.data[self.offset:self.offset + count]
        self.offset += count
        return raw

    def align(self, boundary):
        if any(self.take(-self.offset % boundary)): raise ValueError()

    def value(self, kind, depth=0):
        if depth > 4: raise ValueError()
        if kind in ('u', 'b'):
            self.align(4)
            value = struct.unpack(self.endian + 'I', self.take(4))[0]
            if kind == 'b' and value not in (0, 1): raise ValueError()
            return bool(value) if kind == 'b' else value
        if kind == 'y': return self.take(1)[0]
        if kind in ('s', 'o', 'g'):
            if kind == 'g': size = self.value('y')
            else: size = self.value('u')
            if size > 2048: raise ValueError()
            raw = self.take(size)
            if self.take(1) != b'\0' or b'\0' in raw: raise ValueError()
            try: value = raw.decode('ascii' if kind == 'g' else 'utf-8')
            except UnicodeError: raise ValueError() from None
            if kind == 'g': _dbus_types(value)
            if kind == 'o' and value != '/' and re.fullmatch(r'(?:/[A-Za-z0-9_]+)+', value) is None:
                raise ValueError()
            return value
        if kind == 'ay':
            size = self.value('u')
            if size > 4096: raise ValueError()
            return self.take(size)
        if kind == '(uo)':
            self.align(8)
            return self.value('u', depth + 1), self.value('o', depth + 1)
        if kind == 'v':
            signature = self.value('g', depth + 1)
            types = _dbus_types(signature)
            if len(types) != 1 or types[0] == 'v': raise ValueError()
            return signature, self.value(types[0], depth + 1)
        raise ValueError()


class _DBusWriter:
    def __init__(self): self.data = bytearray()

    def align(self, boundary): self.data.extend(b'\0' * (-len(self.data) % boundary))

    def value(self, kind, value):
        if kind in ('u', 'b', 'y'):
            if kind == 'b':
                if type(value) is not bool: raise ValueError()
                value = int(value)
            if type(value) is not int or not 0 <= value < (256 if kind == 'y' else 2**32):
                raise ValueError()
            if kind == 'y': self.data.append(value)
            else:
                self.align(4)
                self.data.extend(struct.pack('<I', value))
        elif kind in ('s', 'o', 'g'):
            if type(value) is not str or '\0' in value: raise ValueError()
            if kind == 'g': _dbus_types(value)
            if kind == 'o' and value != '/' and re.fullmatch(r'(?:/[A-Za-z0-9_]+)+', value) is None:
                raise ValueError()
            raw = value.encode('ascii' if kind == 'g' else 'utf-8')
            if len(raw) > (64 if kind == 'g' else 2048): raise ValueError()
            self.value('y' if kind == 'g' else 'u', len(raw))
            self.data.extend(raw + b'\0')
        elif kind == 'ay':
            if type(value) is not bytes or len(value) > 4096: raise ValueError()
            self.value('u', len(value))
            self.data.extend(value)
        elif kind == '(uo)':
            if type(value) is not tuple or len(value) != 2: raise ValueError()
            self.align(8)
            self.value('u', value[0]); self.value('o', value[1])
        elif kind == 'v':
            if type(value) is not tuple or len(value) != 2: raise ValueError()
            types = _dbus_types(value[0])
            if len(types) != 1 or types[0] == 'v': raise ValueError()
            self.value('g', value[0]); self.value(types[0], value[1])
        else: raise ValueError()


def _dbus_decode(raw):
    if type(raw) is not bytes or not 16 <= len(raw) <= 32768 or raw[0] not in (108, 66):
        raise ValueError()
    endian = '<' if raw[0] == 108 else '>'
    _order, kind, flags, version, body_size, serial, header_size = struct.unpack(endian + 'BBBBIII', raw[:16])
    header_end = 16 + header_size
    body_start = header_end + (-header_end % 8)
    if (kind not in (1, 2, 3, 4) or flags & ~7 or version != 1 or serial == 0
            or header_size > 8192 or body_size > 16384 or body_start + body_size != len(raw)):
        raise ValueError()
    reader = _DBusReader(raw, 16, header_end, endian)
    headers = {}
    while reader.offset < header_end:
        reader.align(8)
        code = reader.value('y')
        if code not in _DBUS_FIELDS or code in headers: raise ValueError()
        signature, value = reader.value('v')
        if signature != _DBUS_FIELDS[code]: raise ValueError()
        headers[code] = value
    if reader.offset != header_end or any(raw[header_end:body_start]): raise ValueError()
    required = {1, 3} if kind == 1 else {1, 2, 3} if kind == 4 else {5}
    if kind == 3: required.add(4)
    if not required <= set(headers) or headers.get(9, 0) != 0 or 5 in headers and headers[5] == 0:
        raise ValueError()
    for code in (2, 4):
        if code in headers and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+', headers[code]) is None:
            raise ValueError()
    if 3 in headers and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', headers[3]) is None: raise ValueError()
    for code in (1, 2, 3, 4, 6, 7):
        if code in headers and len(headers[code]) > 255: raise ValueError()
    signature = headers.get(8, '')
    reader = _DBusReader(raw, body_start, len(raw), endian)
    values = tuple(reader.value(value) for value in _dbus_types(signature))
    if reader.offset != len(raw): raise ValueError()
    return {'kind': kind, 'flags': flags, 'serial': serial, 'headers': headers,
            'signature': signature, 'body': values}


def _dbus_encode(kind, serial, headers, signature, values, *, flags=0):
    types = _dbus_types(signature)
    if (type(headers) is not dict or 8 in headers or type(values) is not tuple
            or len(values) != len(types) or type(serial) is not int or not 0 < serial < 2**32
            or type(kind) is not int or kind not in (1, 2, 3, 4)
            or type(flags) is not int or flags & ~7): raise ValueError()
    body, encoded = _DBusWriter(), _DBusWriter()
    for value_type, value in zip(types, values): body.value(value_type, value)
    fields = dict(headers)
    if signature: fields[8] = signature
    for code in sorted(fields):
        if type(code) is not int or code not in _DBUS_FIELDS: raise ValueError()
        encoded.align(8)
        encoded.value('y', code)
        encoded.value('v', (_DBUS_FIELDS[code], fields[code]))
    raw = struct.pack('<BBBBIII', 108, kind, flags, 1, len(body.data), serial, len(encoded.data))
    raw += bytes(encoded.data) + b'\0' * (-len(encoded.data) % 8) + bytes(body.data)
    _dbus_decode(raw)
    return raw


class _JobReceipt:
    """Same-stream historical JobRemoved receipt; never physical exit authority."""
    __slots__ = ('_stream', '_job', '_unit', '_result', '_serial')
    def __init__(self): raise TypeError('private original job receipt')
    def __reduce_ex__(self, _protocol): raise TypeError('private original job receipt')


class _ManagerJobStream:
    """Bounded signals on the probe's original authenticated connection. No reconnect."""
    def __init__(self): raise TypeError('private original manager stream')
    def __reduce_ex__(self, _protocol): raise TypeError('private original manager stream')

    @classmethod
    def open(cls, manager, *, scope_guard=None, terminal_veto=None):
        item = None
        try:
            if type(manager) is not SystemManagerProbe: raise ValueError()
            if manager._job_stream is not None:
                original = manager._job_stream
                if type(original) is not cls or original._manager is not manager: raise ValueError()
                original._veto()
                return original
            item = object.__new__(cls)
            item._manager, item._channel = manager, manager._channel
            item._registration, item._pin = manager._registration, manager._pin
            item._guid, item._owner = manager._guid, manager._owner
            item._retired, item._serial, item._name = False, 0, None
            item._announced_name = None
            item._pending, item._receipts, item._seen = {}, {}, set()
            manager._job_stream = item
            def start():
                manager._probe()
                item._send(b'BEGIN\r\n')
                values = item._call(_BUS, _OBJECT, _BUS, 'Hello', '', (), 's')
                if re.fullmatch(r':[0-9]+\.[0-9]+', values[0]) is None: raise ValueError()
                item._name = values[0]
                if item._announced_name is not None and item._announced_name != item._name: raise ValueError()
                rule = ("type='signal',sender='" + item._owner + "',path='/org/freedesktop/systemd1',"
                        "interface='org.freedesktop.systemd1.Manager',member='JobRemoved'")
                item._call(_BUS, _OBJECT, _BUS, 'AddMatch', 's', (rule,), '')
                changed = ("type='signal',sender='org.freedesktop.DBus',path='/org/freedesktop/DBus',"
                    "interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.systemd1'")
                item._call(_BUS, _OBJECT, _BUS, 'AddMatch', 's', (changed,), '')
                item._call(item._owner, '/org/freedesktop/systemd1',
                    'org.freedesktop.systemd1.Manager', 'Subscribe', '', (), '')
                manager._probe()
                item._veto()
            def tail():
                if terminal_veto is not None: terminal_veto()
                item._veto()
            manager._run(start, scope_guard, terminal_veto=tail)
            item._veto()
            return item
        except Exception:
            if item is not None: item._retire()
            if type(manager) is SystemManagerProbe: manager.close()
            _deny()

    def _veto(self):
        manager = self._manager
        if (self._retired or manager._retired or manager._job_stream is not self
                or manager._channel is not self._channel or manager._authenticated_channel is not self._channel
                or manager._registration is not self._registration or manager._pin is not self._pin
                or manager._guid != self._guid or manager._owner != self._owner
                or self._channel.fileno() < 0): raise ValueError()
        manager._veto()

    def _budget(self):
        self._veto()
        remaining = self._manager._remaining()
        self._veto()
        return remaining

    def _prepare(self):
        self._budget()
        peer = self._channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        self._budget()
        if peer != self._manager._peer: raise ValueError()
        self._channel.settimeout(self._budget())
        self._budget()

    def _send(self, raw):
        self._prepare()
        self._channel.sendall(raw)
        self._budget()

    def _read(self, size):
        raw = bytearray()
        while len(raw) < size:
            self._prepare()
            data, ancillary, flags, _address = self._channel.recvmsg(size - len(raw),
                socket.CMSG_SPACE(253 * array.array('i').itemsize), getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
            owned = []
            try:
                for level, kind, value in ancillary:
                    if (level, kind) == (socket.SOL_SOCKET, socket.SCM_RIGHTS):
                        width = array.array('i').itemsize
                        owned.extend(array.array('i', value[:len(value) // width * width]))
                self._budget()  # Newly received FDs are owned before any callback/veto.
                if (ancillary or flags & ~getattr(socket, 'MSG_CMSG_CLOEXEC', 0)
                        or type(data) is not bytes or not data): raise ValueError()
                raw.extend(data)
            finally:
                failed = False
                for fd in owned:
                    try: os.close(fd)
                    except Exception: failed = True
                if failed: raise ValueError()
        return bytes(raw)

    def _receive(self):
        header = self._read(16)
        if header[0] not in (108, 66): raise ValueError()
        endian = '<' if header[0] == 108 else '>'
        _o, _k, _f, _v, size, _serial, fields = struct.unpack(endian + 'BBBBIII', header)
        total = fields + (-fields % 8) + size
        if fields > 8192 or size > 16384 or total > 32752: raise ValueError()
        message = _dbus_decode(header + self._read(total))
        sender = message['headers'].get(7)
        identity = (sender, message['serial'])
        if (sender not in (_BUS, self._owner) or identity in self._seen or len(self._seen) >= 8192):
            raise ValueError()
        destination = message['headers'].get(6)
        if destination is not None and self._name is not None and destination != self._name: raise ValueError()
        self._seen.add(identity)
        self._budget()
        return message

    def _signal(self, message):
        fields, values = message['headers'], message['body']
        if message['kind'] != 4: raise ValueError()
        if (fields.get(7) == _BUS and fields.get(1) == _OBJECT and fields.get(2) == _BUS
                and fields.get(3) == 'NameAcquired' and message['signature'] == 's'):
            if re.fullmatch(r':[0-9]+\.[0-9]+', values[0]) is None: raise ValueError()
            if self._name is not None and values[0] != self._name: raise ValueError()
            self._announced_name = values[0]
            return
        if (fields.get(7) != self._owner or fields.get(1) != '/org/freedesktop/systemd1'
                or fields.get(2) != 'org.freedesktop.systemd1.Manager' or fields.get(3) != 'JobRemoved'
                or message['signature'] != 'uoss'): raise ValueError()
        job_id, job, unit, result = values
        if (re.fullmatch(r'/org/freedesktop/systemd1/job/[1-9][0-9]{0,9}', job) is None
                or not 0 < job_id < 2**32 or job_id != int(job.rsplit('/', 1)[1])
                or not 1 <= len(unit) <= 255): raise ValueError()
        if not unit.startswith('holaday-pool-'):
            if job in self._pending or job in self._receipts: raise ValueError()
            return  # Unrelated manager work is not an owned resource or an exit receipt.
        self._job_binding(job, unit)
        if (job_id != int(job.rsplit('/', 1)[1]) or job in self._pending or job in self._receipts
                or len(self._pending) + len(self._receipts) >= 320): raise ValueError()
        self._pending[job] = (unit, result, message['serial'])

    @staticmethod
    def _job_binding(job, unit):
        if (type(job) is not str or re.fullmatch(r'/org/freedesktop/systemd1/job/[1-9][0-9]{0,9}', job) is None
                or int(job.rsplit('/', 1)[1]) >= 2**32 or type(unit) is not str
                or re.fullmatch(r'holaday-pool-(?:anchor|xvfb|brave|x11vnc|websockify)-[0-9a-f]{32}\.service', unit) is None):
            raise ValueError()

    def _call(self, destination, path, interface, member, signature, values, reply_signature):
        allowed = ((_BUS, _OBJECT, _BUS, 'Hello', '', 's'),
                   (_BUS, _OBJECT, _BUS, 'AddMatch', 's', ''),
                   (self._owner, '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'Subscribe', '', ''),
                   (self._owner, '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'RefUnit', 's', ''),
                   (self._owner, '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'StopUnit', 'ss', 'o'))
        property_call = (destination == self._owner and interface == 'org.freedesktop.DBus.Properties'
            and member == 'Get' and signature == 'ss' and reply_signature == 'v'
            and re.fullmatch(r'/org/freedesktop/systemd1/unit/holaday_2dpool_2d(?:anchor|xvfb|brave|x11vnc|websockify)_2d[0-9a-f]{32}_2eservice', path) is not None)
        if (destination, path, interface, member, signature, reply_signature) not in allowed and not property_call:
            raise ValueError()
        if self._serial >= 8192: raise ValueError()
        self._serial += 1
        serial = self._serial
        self._send(_dbus_encode(1, serial, {1: path, 2: interface, 3: member, 6: destination},
                               signature, values, flags=2))
        for _index in range(256):
            message = self._receive()
            if message['kind'] == 4:
                self._signal(message)
                continue
            if (message['kind'] != 2 or message['headers'].get(5) != serial
                    or message['headers'].get(7) != destination or message['signature'] != reply_signature):
                raise ValueError()
            return message['body']
        raise ValueError()

    def _drain_ready(self):
        for _index in range(256):
            self._budget()
            readable, _write, exceptional = select.select([self._channel], [], [self._channel], 0)
            self._budget()
            if exceptional: raise ValueError()
            if not readable: return
            self._signal(self._receive())
        raise ValueError()

    def wait_job(self, job, unit, *, scope_guard=None, terminal_veto=None):
        """Observe a known original job; ACK/EOF/not-found cannot mint a receipt."""
        try:
            self._job_binding(job, unit)
            def operation():
                self._manager._probe()
                return self._wait_job_locked(job, unit)
            def tail():
                if terminal_veto is not None: terminal_veto()
                self._veto()
            result = self._manager._run(operation, scope_guard, terminal_veto=tail)
            self._veto()
            return result
        except Exception:
            self._retire()
            self._manager.close()
            _deny()

    def _wait_job_locked(self, job, unit):
        if not self._manager._busy: raise ValueError()
        self._drain_ready()
        receipt = self._receipts.get(job)
        if receipt is not None:
            if receipt._stream is not self or receipt._unit != unit: raise ValueError()
            return receipt
        for _index in range(256):
            if job in self._pending:
                original_unit, result, serial = self._pending[job]
                if original_unit != unit or result != 'done': raise ValueError()
                self._manager._probe()
                self._drain_ready()
                receipt = object.__new__(_JobReceipt)
                receipt._stream, receipt._job, receipt._unit = self, job, unit
                receipt._result, receipt._serial = result, serial
                self._receipts[job] = receipt
                del self._pending[job]
                return receipt
            self._signal(self._receive())
        raise ValueError()

    def _stop_original_role(self, live, role):
        from quartet_runtime import _RunningQuartet
        from quartet_records import ROLES
        from quartet_worker_pin import _WorkerPin
        if type(live) is not _RunningQuartet or role not in ROLES: raise ValueError()
        material = live._material
        live._veto()
        if (not live._closing or live._close_stream is not self or material._manager is not self._manager
                or not material._busy or not material._journal._busy): raise ValueError()
        group = material._journal._resources[material._resource]
        close = group.get('close', {})
        if (close.get('closeId') != live._close_id or close.get('stops', {}).get(role, {}).get('state') != 'dispatching'):
            raise ValueError()
        pin = next(pin for original_role, _worker, pin, _view in live._workers if original_role == role)
        if (type(pin) is not _WorkerPin or pin._manager is not self._manager
                or pin._resource != material._resource or pin._cgroup is None or pin._cgroup._retired
                or pin._record != pin._record_of(group['roles'][role])): raise ValueError()
        unit = pin._record[0]
        path = '/org/freedesktop/systemd1/unit/' + unit.replace('-', '_2d').replace('.', '_2e')
        def operation():
            self._manager._probe()
            self._call(self._owner, '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
                       'RefUnit', 's', (unit,), '')
            for prop, interface, expected in (
                    ('Id', 'Unit', ('s', unit)), ('InvocationID', 'Unit', ('ay', bytes.fromhex(pin._record[3]))),
                    ('Restart', 'Service', ('s', 'no'))):
                value = self._call(self._owner, path, 'org.freedesktop.DBus.Properties', 'Get',
                    'ss', ('org.freedesktop.systemd1.' + interface, prop), 'v')
                if value != (expected,): raise ValueError()
            job, = self._call(self._owner, '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
                             'StopUnit', 'ss', (unit, 'fail'), 'o')
            self._job_binding(job, unit)
            material._append('role_stop_accepted', closeId=live._close_id, role=role, job=job)
            receipt = self._wait_job_locked(job, unit)
            if self._receipts.get(job) is not receipt: raise ValueError()
            material._append('role_stop_observed', closeId=live._close_id, role=role,
                             job=job, result='done', signalSerial=receipt._serial)
            return receipt
        def tail():
            live._veto()
            material._owner_veto()
            self._veto()
        return self._manager._run(operation, material._remaining, terminal_veto=tail)

    def _terminal_properties_locked(self, live, pin, stop):
        material = live._material
        self._veto()
        if (not self._manager._busy or not pin._busy or not material._busy or not material._journal._busy
                or material._manager is not self._manager or live._close_stream is not self
                or not live._closing or self._receipts.get(stop._job) is not stop
                or stop._unit != pin._record[0] or pin._manager is not self._manager): raise ValueError()
        self._manager._probe()
        path = '/org/freedesktop/systemd1/unit/' + pin._record[0].replace('-', '_2d').replace('.', '_2e')
        expected = (('Id', 'Unit', ('s', pin._record[0])),
            ('InvocationID', 'Unit', ('ay', bytes.fromhex(pin._record[3]))),
            ('Job', 'Unit', ('(uo)', (0, '/'))), ('Restart', 'Service', ('s', 'no')),
            ('NRestarts', 'Service', ('u', 0)), ('MainPID', 'Service', ('u', 0)))
        for prop, interface, value in expected:
            observed = self._call(self._owner, path, 'org.freedesktop.DBus.Properties', 'Get',
                'ss', ('org.freedesktop.systemd1.' + interface, prop), 'v')
            if observed != (value,): raise ValueError()
        state = self._call(self._owner, path, 'org.freedesktop.DBus.Properties', 'Get',
                          'ss', ('org.freedesktop.systemd1.Unit', 'ActiveState'), 'v')
        if state not in ((('s', 'inactive'),), (('s', 'failed'),)): raise ValueError()
        cgroup = self._call(self._owner, path, 'org.freedesktop.DBus.Properties', 'Get',
                           'ss', ('org.freedesktop.systemd1.Service', 'ControlGroup'), 'v')
        original = '/holadaypool.slice/holadaypool-' + pin._resource + '.slice/' + pin._record[0]
        if cgroup not in ((('s', ''),), (('s', original),)): raise ValueError()
        self._drain_ready()
        self._manager._probe()
        self._veto()

    def _retire(self):
        self._retired = True
