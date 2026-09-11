"""Fixed, read-only system-manager transport. Never resource or exit authority."""
import hashlib
import json
import math
import os
import re
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
    any resource. Resource writes are restricted to xvfb_launch's transaction.
    """
    def budget():
        remaining = deadline - time.monotonic()
        # The original probe checks retired AFTER reading its current clock.
        # This is a veto, not a new scope or caller-supplied success proof.
        original = scope_guard()
        if (not math.isfinite(remaining) or not math.isfinite(original)
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
        probe._busy, probe._retired = True, False
        probe._scope_guard = None
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
        if self._scope_guard is not None:
            self._scope_guard()
        # Last, non-IO veto after the clock/native checks. Closing a registration
        # or its original pin does not necessarily close this manager object.
        if hasattr(self, '_pin') and (self._registration._revoked or not self._registration._received
                or self._registration._pin is not self._pin or self._pin._fd is None
                or self._registration._candidate.hex() != self._candidate):
            raise ValueError()
        if (self._retired or type(now) not in (int, float) or not math.isfinite(now)
                or now < self._last or not 0 < self._deadline - now <= 5):
            raise ValueError()
        self._last = now
        return self._deadline - now

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

    def _run(self, operation, scope_guard=None):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy, failed = True, True
        self._scope_guard = scope_guard
        try:
            now = time.monotonic()
            if not math.isfinite(now) or now < self._last:
                raise ValueError()
            self._last, self._deadline = now, now + 5
            self._remaining()
            result = operation()
            self._remaining()
            failed = False
        except Exception:
            self._retired = True
        finally:
            self._busy = False
            self._scope_guard = None
            if self._retired:
                self._release()
        if failed:
            _deny()
        return result

    def probe(self):
        return self._run(self._probe)

    def _release(self):
        failed = False
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
