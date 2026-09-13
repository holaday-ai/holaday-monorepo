"""B2 fixed non-root entry, original grants and bounded anchor bridge.

Importing this module cannot start work. The fixed executable entry still needs
original root-issued credentials, HPW1/HPB1 and HPT1, never a readiness argument.
"""

import array
import base64
import errno
import fcntl
import hashlib
import hmac
import json
import math
import os
import re
import select
import selectors
import signal
import socket
from socket import socket as Socket
import stat
import struct
import sys
import time


_ROLES = ('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify')
_NAMESPACES = {'net': 0x40000000, 'ipc': 0x08000000, 'mnt': 0x00020000}
_NOEXEC_MOUNT = 2 | 4 | 8  # Linux ST_NOSUID | ST_NODEV | ST_NOEXEC
_BRIDGE_FRAME = struct.Struct('!4sB20s16s16s32sQQQQ')


def _bridge_frame(kind, binding, invocation, nonce, identities):
    return _BRIDGE_FRAME.pack(b'HPB1', kind, bytes.fromhex(binding['candidate']),
        bytes.fromhex(binding['resource']), bytes.fromhex(invocation), bytes.fromhex(nonce), *identities)


def _bridge_socket_info(fd):
    # fromfd owns a temporary duplicate; it never takes the original right.
    with socket.fromfd(fd, socket.AF_UNIX, socket.SOCK_STREAM) as item:
        return (item.getsockopt(socket.SOL_SOCKET, getattr(socket, 'SO_DOMAIN', 39)),
                item.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE),
                item.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN), item.getsockname())


def _deny():
    try:
        raise ValueError('POOL_BROKER_WORKER_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _hex(value, size):
    if (type(value) is not str or re.fullmatch(r'[0-9a-f]{%d}' % size, value) is None
            or value == '0' * size):
        raise ValueError()


def _uid(value):
    return type(value) is int and 0 < value < 4294967295 and value not in (998, 65534)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _objects(values, names):
    if type(values) is not dict or set(values) != set(names):
        raise ValueError()
    for pair in values.values():
        if (type(pair) is not list or len(pair) != 2
                or any(type(v) is not int or not 0 <= v <= 18446744073709551615 for v in pair)
                or pair[1] == 0):
            raise ValueError()
    if len({tuple(pair) for pair in values.values()}) != len(names):
        raise ValueError()


def _decode_binding(raw, candidate, resource, role):
    # Only called on the held, read-only, fixed-path LoadCredential object.
    _hex(candidate, 40)
    _hex(resource, 32)
    if type(role) is not str or role not in _ROLES or type(raw) is not bytes or not 0 < len(raw) <= 8192:
        raise ValueError()
    data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique,
                      parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    keys = {'version', 'candidate', 'resource', 'role', 'slot', 'uid', 'gid', 'brokerPid',
            'handshake', 'hostNamespaces', 'groupNamespaces', 'objects'}
    if role == 'anchor': keys.update(('application', 'dataKey'))
    if (type(data) is not dict or set(data) != keys
            or type(data['version']) is not int or data['version'] != 1
            or (data['candidate'], data['resource'], data['role']) != (candidate, resource, role)
            or type(data['slot']) is not int or not 0 <= data['slot'] < 32
            or not _uid(data['uid']) or not _uid(data['gid'])
            or type(data['brokerPid']) is not int or not 2 <= data['brokerPid'] <= 2147483647):
        raise ValueError()
    _hex(data['handshake'], 64)
    _objects(data['hostNamespaces'], ('net', 'ipc', 'mnt'))
    _objects(data['objects'], ('root', 'tmp', 'shm'))
    if role == 'anchor':
        _hex(data['dataKey'], 64)
        if data['groupNamespaces'] is not None:
            raise ValueError()
        app = data['application']
        if (type(app) is not dict or set(app) != {'pid', 'uid', 'gid', 'boot', 'pidNamespace'}
                or type(app['pid']) is not int or not 2 <= app['pid'] <= 2147483647
                or type(app['uid']) is not int or app['uid'] != 998
                or type(app['gid']) is not int or not 0 < app['gid'] < 4294967295
                or app['gid'] in (data['gid'], 65534)):
            raise ValueError()
        _hex(app['boot'], 32)
        _objects({'pid': app['pidNamespace']}, ('pid',))
    else:
        _objects(data['groupNamespaces'], ('net', 'ipc'))
        if any(data['groupNamespaces'][key] == data['hostNamespaces'][key] for key in ('net', 'ipc')):
            raise ValueError()
    return data


def _pair(info):
    return [info.st_dev, info.st_ino]


def _decode_egress_binding(raw, candidate, resource, boot):
    for value, size in ((candidate, 40), (resource, 32), (boot, 32)):
        _hex(value, size)
    if type(raw) is not bytes or not 0 < len(raw) <= 2048:
        raise ValueError()
    data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique,
        parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    if (type(data) is not dict or set(data) != {'version', 'candidate', 'resource', 'boot', 'key', 'leaf'}
            or type(data['version']) is not int or data['version'] != 1
            or (data['candidate'], data['resource'], data['boot']) != (candidate, resource, boot)):
        raise ValueError()
    _hex(data['key'], 64)
    leaf = data['leaf']
    if (type(leaf) is not dict or set(leaf) != {'device', 'inode'}
            or any(type(value) is not int or not 0 <= value < 2**64 for value in leaf.values())
            or leaf['inode'] == 0):
        raise ValueError()
    return data


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink)


def _credential_metadata(fd, uid, gid, *, directory):
    info = os.fstat(fd)
    attrs = set(os.listxattr(fd))
    allowed = {'system.posix_acl_access'}
    if (info.st_uid not in (0, uid) or info.st_gid not in (0, gid)
            or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode))
            or (not directory and info.st_nlink != 1)
            or attrs & {'system.posix_acl_default', 'security.capability'}
            or not os.fstatvfs(fd).f_flag & 1):
        raise ValueError()
    mode = 0o500 if directory else 0o400
    if attrs & allowed:
        # systemd v249 prefers root ownership + exactly one read-only UID ACL;
        # on filesystems without ACLs it chowns on a read-only mount instead.
        raw = os.getxattr(fd, 'system.posix_acl_access')
        access = 5 if directory else 4
        expected = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *row) for row in (
            (1, access, 0xffffffff), (2, access, uid), (4, 0, 0xffffffff),
            (16, access, 0xffffffff), (32, 0, 0xffffffff)))
        if info.st_uid != 0 or raw != expected:
            raise ValueError()
        mode |= 0o050 if directory else 0o040
    if stat.S_IMODE(info.st_mode) != mode:
        raise ValueError()
    return info


def _trusted_directory(fd):
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
            or stat.S_IMODE(info.st_mode) & 0o7022
            or set(os.listxattr(fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
        raise ValueError()
    return info


class _WorkerGuard:
    """Private retained boundary. A handshake result is not public readiness."""

    __slots__ = ('_fds', '_binding', '_credential', '_raw', '_objects', '_namespaces',
                 '_attempted', '_channel', '_deadline', '_last', '_bridge', '_application', '_data_bridge_active', '_egress_active')

    def __init__(self):
        raise TypeError('use fixed worker boundary')

    @classmethod
    def open(cls, candidate, resource, role):
        self = object.__new__(cls)
        self._fds, self._objects, self._namespaces = [], {}, {}
        self._binding, self._raw, self._channel = None, None, None
        self._deadline, self._last = None, None
        self._attempted = False
        self._bridge = None
        self._application = None
        self._data_bridge_active = False
        self._egress_active = False
        try:
            _hex(candidate, 40)
            _hex(resource, 32)
            if (type(role) is not str or role not in _ROLES or sys.platform != 'linux'
                    or not (sys.flags.isolated and sys.flags.no_site and sys.flags.ignore_environment)
                    or sys.executable != '/usr/bin/python3'):
                raise ValueError()
            uid, gid = os.getresuid(), os.getresgid()
            if not _uid(uid[0]) or uid != (uid[0],) * 3 or not _uid(gid[0]) or gid != (gid[0],) * 3:
                raise ValueError()
            self._credential = '/run/credentials/holaday-pool-' + role + '-' + resource + '.service/binding'
            # Walk every path component using retained O_NOFOLLOW directory FDs.
            fds = self._walk(self._credential, credential=(uid[0], gid[0]))
            file = fds[-1]
            info = _credential_metadata(file, uid[0], gid[0], directory=False)
            if not 0 < info.st_size <= 8192:
                raise ValueError()
            self._raw = os.pread(file, info.st_size + 1, 0)
            if len(self._raw) != info.st_size:
                raise ValueError()
            self._binding = _decode_binding(self._raw, candidate, resource, role)
            if (self._binding['uid'], self._binding['gid']) != (uid[0], gid[0]):
                raise ValueError()
            self._objects[self._credential] = (file, _signature(info))
            for path in ('/', '/tmp', '/dev/shm'):
                fd = self._walk(path)[-1]
                self._objects[path] = (fd, _signature(os.fstat(fd)))
            for name in _NAMESPACES:
                fd = self._namespace(name)
                self._namespaces[name] = (fd, _pair(os.fstat(fd)))
            self._check()
            return self
        except Exception:
            self._discard()
            _deny()

    def _walk(self, path, *, credential=None):
        opened = []
        parts = path.split('/')[1:] if path != '/' else []
        for index, name in enumerate(['/'] + parts):
            leaf = index == len(parts)
            regular = leaf and credential is not None
            access = getattr(os, 'O_PATH', 0x200000) if leaf and path == '/run/holaday-pool' else os.O_RDONLY
            fd = os.open(name, access | os.O_CLOEXEC | os.O_NOFOLLOW
                         | (os.O_NONBLOCK if regular else os.O_DIRECTORY),
                         **({'dir_fd': opened[-1]} if opened else {}))
            self._fds.append(fd)
            opened.append(fd)
            if credential is not None and index >= len(parts) - 1:
                _credential_metadata(fd, *credential, directory=not leaf)
            elif not leaf or path == '/':
                _trusted_directory(fd)
        return opened

    def _namespace(self, name):
        # /proc/self/ns/* are intentional kernel magic symlinks, not user paths.
        fd = os.open('/proc/self/ns/' + name, os.O_RDONLY | os.O_CLOEXEC)
        self._fds.append(fd)
        if fcntl.ioctl(fd, 0xb703) != (0x20000000 if name == 'pid' else _NAMESPACES[name]):
            raise ValueError()
        return fd

    def _proc_pid(self, path):
        fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
        self._fds.append(fd)
        try:
            raw = os.read(fd, 65537)
        finally:
            self._close_last()
        if not raw or len(raw) > 65536:
            raise ValueError()
        values = [line.partition(b':')[2].strip() for line in raw.splitlines()
                  if line.partition(b':')[0] == b'Pid']
        if len(values) != 1 or re.fullmatch(b'[1-9][0-9]{0,9}', values[0]) is None:
            raise ValueError()
        return int(values[0])

    def _capture_application(self):
        # First reference only, before any hello. Its authority still requires
        # the later root grant from the ORIGINAL registered application pin.
        binding = self._binding
        if binding['role'] != 'anchor' or self._application is not None:
            raise ValueError()
        self._remaining()
        namespace = self._namespace('pid')
        if (_pair(os.fstat(namespace)) != binding['application']['pidNamespace']
                or self._proc_pid('/proc/self/status') != os.getpid()):
            raise ValueError()
        self._remaining()
        fd = os.pidfd_open(binding['application']['pid'], 0)
        self._fds.append(fd)
        self._application = (fd, namespace)
        self._remaining()
        self._check_application()
        self._remaining()

    def _check_application(self):
        if self._application is None:
            if self._binding['role'] == 'anchor' and self._attempted:
                raise ValueError()
            return
        app = self._binding['application']
        fd, namespace = self._application
        if (fd not in self._fds or namespace not in self._fds or fd == namespace
                or os.get_inheritable(fd) or os.get_inheritable(namespace)
                or fcntl.ioctl(namespace, 0xb703) != 0x20000000
                or _pair(os.fstat(namespace)) != app['pidNamespace']):
            raise ValueError()
        self._poll_application()
        count = len(self._fds)
        try:
            current = self._namespace('pid')
            if (_pair(os.fstat(current)) != app['pidNamespace']
                    or self._proc_pid('/proc/self/status') != os.getpid()
                    or self._proc_pid('/proc/self/fdinfo/' + str(fd)) != app['pid']):
                raise ValueError()
        finally:
            while len(self._fds) > count:
                self._close_last()
        self._poll_application()

    def _poll_application(self):
        # Terminal native observation after other IO and temporary FD cleanup.
        # Never opens/reconstructs a process reference or performs signal(0).
        if self._binding is None:
            raise ValueError()
        if self._application is None:
            if self._binding['role'] == 'anchor' and self._attempted:
                raise ValueError()
            return
        fd, namespace = self._application
        if fd not in self._fds or namespace not in self._fds:
            raise ValueError()
        poller = select.poll()
        poller.register(fd, select.POLLIN | select.POLLHUP | select.POLLERR | select.POLLNVAL)
        if poller.poll(0):
            raise ValueError()

    def _identity(self):
        uid, gid = self._binding['uid'], self._binding['gid']
        groups = os.getgroups()
        if (sys.platform != 'linux' or os.getresuid() != (uid,) * 3
                or os.getresgid() != (gid,) * 3 or groups not in ([], [gid])):
            raise ValueError()
        fd = os.open('/proc/self/status', os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        self._fds.append(fd)
        raw = os.read(fd, 65537)
        self._close_last()
        if not raw or len(raw) > 65536:
            raise ValueError()
        expected = {b'Uid': [uid] * 4, b'Gid': [gid] * 4, b'Groups': groups,
                    b'NoNewPrivs': [1], b'Threads': [1], b'TracerPid': [0]}
        caps = {b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb'}
        seen = set()
        for line in raw.splitlines():
            key, sep, value = line.partition(b':')
            if key not in expected and key not in caps:
                continue
            if not sep or key in seen:
                raise ValueError()
            seen.add(key)
            values = value.split()
            if key in caps:
                if len(values) != 1 or not re.fullmatch(b'0{16}', values[0]):
                    raise ValueError()
            elif (any(not re.fullmatch(b'[0-9]{1,10}', v) for v in values)
                  or [int(v) for v in values] != expected[key]):
                raise ValueError()
        if seen != set(expected) | caps or socket.if_nameindex() != [(1, 'lo')]:
            raise ValueError()

    def _check(self):
        try:
            if not self._fds or self._binding is None:
                raise ValueError()
            self._identity()
            count = len(self._fds)
            try:
                for path, (original, signature) in self._objects.items():
                    credential = (self._binding['uid'], self._binding['gid']) if path == self._credential else None
                    current = self._walk(path, credential=credential)[-1]
                    for fd in (original, current):
                        observed = _signature(os.fstat(fd))
                        if path in ('/tmp', '/dev/shm'):
                            # These original directories contain legitimate live child directories.
                            # Identity/ownership/mode stay pinned; child count is not identity.
                            if observed[:-1] != signature[:-1] or observed[-1] < 1: raise ValueError()
                        elif observed != signature: raise ValueError()
                    if credential:
                        if os.pread(current, 8193, 0) != self._raw:
                            raise ValueError()
                    else:
                        key = {'/': 'root', '/tmp': 'tmp', '/dev/shm': 'shm'}[path]
                        info, flags = os.fstat(current), os.fstatvfs(current).f_flag
                        if _pair(info) != self._binding['objects'][key]:
                            raise ValueError()
                        if path == '/':
                            if not flags & 1:
                                raise ValueError()
                        elif (info.st_uid != self._binding['uid'] or info.st_gid != self._binding['gid']
                              or stat.S_IMODE(info.st_mode) != 0o700 or not stat.S_ISDIR(info.st_mode)
                              or flags & _NOEXEC_MOUNT != _NOEXEC_MOUNT or flags & 1
                              or set(os.listxattr(current)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
                            raise ValueError()
                for name, (original, pair) in self._namespaces.items():
                    fd = self._namespace(name)
                    if (_pair(os.fstat(original)) != pair or _pair(os.fstat(fd)) != pair
                            or pair == self._binding['hostNamespaces'][name]):
                        raise ValueError()
                    group = self._binding['groupNamespaces']
                    if name in ('net', 'ipc') and group is not None and pair != group[name]:
                        raise ValueError()
            finally:
                while len(self._fds) > count:
                    self._close_last()
            self._check_application()
        except Exception:
            self._discard()
            _deny()

    def _await_grant(self):
        """Consume one root challenge/grant. No FD handoff, exec, or readiness."""
        try:
            self._remaining()
            self._check()
            if self._attempted:
                raise ValueError()
            self._attempted = True
            binding = self._binding
            if binding['role'] == 'anchor':
                self._capture_application()

            def clock():
                remaining = self._remaining()
                if self._binding is not binding:
                    raise ValueError()
                return remaining

            def budget():
                clock()
                self._check()
                return clock()

            directories = self._walk('/run/holaday-pool')
            parent = directories[-1]
            directory_signatures = tuple(_signature(os.fstat(fd)) for fd in directories)

            def endpoint():
                count = len(self._fds)
                try:
                    current = self._walk('/run/holaday-pool')
                    if (tuple(_signature(os.fstat(fd)) for fd in directories) != directory_signatures
                            or tuple(_signature(os.fstat(fd)) for fd in current) != directory_signatures):
                        raise ValueError()
                    info = os.stat('control.sock', dir_fd=parent, follow_symlinks=False)
                    if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0 or info.st_gid != binding['gid']
                            or stat.S_IMODE(info.st_mode) != 0o660 or info.st_nlink != 1
                            or _signature(os.stat('control.sock', dir_fd=current[-1], follow_symlinks=False)) != _signature(info)):
                        raise ValueError()
                    return _signature(info)
                finally:
                    while len(self._fds) > count:
                        self._close_last()

            # This directory may be group-searchable, but only root can alter it.
            info = os.fstat(parent)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                    or info.st_gid not in (0, self._binding['gid'])
                    or stat.S_IMODE(info.st_mode) & 0o7022
                    or set(os.listxattr('/proc/self/fd/' + str(parent))) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
                raise ValueError()
            original = endpoint()
            channel = Socket(socket.AF_UNIX, socket.SOCK_SEQPACKET | getattr(socket, 'SOCK_CLOEXEC', 0))
            self._channel = channel
            channel.set_inheritable(False)
            channel.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
            channel.settimeout(budget())
            clock()
            # Resolve beneath the original directory FD, never a replacement
            # absolute parent. The fixed path and leaf are still rechecked.
            channel.connect('/proc/self/fd/' + str(parent) + '/control.sock')
            expected = struct.pack('=iII', self._binding['brokerPid'], 0, 0)
            if channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12) != expected or endpoint() != original:
                raise ValueError()

            def send(payload):
                channel.settimeout(budget())
                if endpoint() != original:
                    raise ValueError()
                channel.settimeout(budget())
                clock()
                if channel.sendmsg([payload]) != len(payload):
                    raise ValueError()
                budget()

            def receive(kind):
                channel.settimeout(budget())
                clock()
                data, ancillary, flags, _address = channel.recvmsg(256,
                    socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
                credentials, unwanted = [], False
                # Take ownership of *all* delivered rights before rejecting flags.
                for level, name, raw in ancillary:
                    if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                        unwanted = True
                        width = array.array('i').itemsize
                        for fd in array.array('i', raw[:len(raw) // width * width]):
                            if fd >= 0 and fd not in self._fds:
                                self._fds.append(fd)
                    elif level == socket.SOL_SOCKET and name == socket.SCM_CREDENTIALS:
                        credentials.append(raw)
                    else:
                        unwanted = True
                if (unwanted or flags & ~socket.MSG_CMSG_CLOEXEC or credentials != [expected]
                        or type(data) is not bytes or re.fullmatch(b'HPW1 ' + kind + b' [0-9a-f]{64}', data) is None):
                    raise ValueError()
                budget()
                if endpoint() != original:
                    raise ValueError()
                nonce = data.rsplit(b' ', 1)[1].decode('ascii')
                _hex(nonce, 64)
                return nonce

            send(('HPW1 hello ' + binding['resource'] + ' ' + binding['role'] + ' ' + binding['handshake']).encode('ascii'))
            nonce = receive(b'challenge')
            if nonce == binding['handshake']:
                raise ValueError()
            send(('HPW1 response ' + nonce).encode('ascii'))
            if receive(b'grant') != nonce:
                raise ValueError()
            budget()
            owned, self._channel = self._channel, None
            owned.close()
            self._check()
            if endpoint() != original:
                raise ValueError()
            clock()
            self._poll_application()
            clock()
        except Exception:
            self._discard()
            _deny()

    def _receive_bridge(self):
        """Anchor-only second control connection. No data accept/forward or ready."""
        try:
            self._remaining()
            binding = self._binding
            if binding['role'] != 'anchor' or self._attempted:
                raise ValueError()
            self._await_grant()  # Uses the same original deadline, never a success argument.
            directories = self._walk('/run/holaday-pool')
            signatures = tuple(_signature(os.fstat(fd)) for fd in directories)
            parent = directories[-1]
            original = _signature(os.stat('control.sock', dir_fd=parent, follow_symlinks=False))

            def clock():
                result = self._remaining()
                if self._binding is not binding:
                    raise ValueError()
                return result

            def budget():
                clock()
                self._check()
                count = len(self._fds)
                try:
                    current = self._walk('/run/holaday-pool')
                    if (tuple(_signature(os.fstat(fd)) for fd in directories) != signatures
                            or tuple(_signature(os.fstat(fd)) for fd in current) != signatures):
                        raise ValueError()
                    for directory in (parent, current[-1]):
                        info = os.stat('control.sock', dir_fd=directory, follow_symlinks=False)
                        if (_signature(info) != original or not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0
                                or info.st_gid != binding['gid'] or stat.S_IMODE(info.st_mode) != 0o660 or info.st_nlink != 1):
                            raise ValueError()
                finally:
                    while len(self._fds) > count:
                        self._close_last()
                self._poll_application()
                return clock()

            budget()
            self._channel = Socket(socket.AF_UNIX, socket.SOCK_SEQPACKET | getattr(socket, 'SOCK_CLOEXEC', 0))
            channel = self._channel
            clock()
            channel.set_inheritable(False)
            channel.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
            channel.settimeout(budget())
            clock()
            channel.connect('/proc/self/fd/' + str(parent) + '/control.sock')
            expected = struct.pack('=iII', binding['brokerPid'], 0, 0)
            if channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12) != expected:
                raise ValueError()
            budget()

            def send(payload):
                channel.settimeout(budget())
                clock()
                if channel.sendmsg([payload]) != len(payload):
                    raise ValueError()
                budget()

            def receive(kind, rights_count):
                channel.settimeout(budget())
                clock()
                data, ancillary, flags, _address = channel.recvmsg(_BRIDGE_FRAME.size + 1,
                    socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
                peers, rights, unwanted, rights_messages = [], [], False, 0
                for level, name, raw in ancillary:
                    if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                        rights_messages += 1
                        width = array.array('i').itemsize
                        unwanted = unwanted or len(raw) % width != 0
                        for fd in array.array('i', raw[:len(raw) // width * width]):
                            if fd < 0 or fd in self._fds:
                                unwanted = True
                            else:
                                self._fds.append(fd)
                                rights.append(fd)
                    elif level == socket.SOL_SOCKET and name == socket.SCM_CREDENTIALS:
                        peers.append(raw)
                    else:
                        unwanted = True
                clock()  # Every delivered FD is owned even on revocation/truncation.
                if (unwanted or peers != [expected] or flags & ~socket.MSG_CMSG_CLOEXEC
                        or len(rights) != rights_count or rights_messages != (1 if rights_count else 0)
                        or type(data) is not bytes or len(data) != _BRIDGE_FRAME.size):
                    raise ValueError()
                fields = _BRIDGE_FRAME.unpack(data)
                if (fields[:2] != (b'HPB1', kind) or fields[2].hex() != binding['candidate']
                        or fields[3].hex() != binding['resource']):
                    raise ValueError()
                budget()
                return data, fields, rights

            send(_bridge_frame(0, binding, '0' * 32, binding['handshake'], (0, 0, 0, 0)))
            _raw, fields, _rights = receive(1, 0)
            invocation, nonce, identities = fields[4].hex(), fields[5].hex(), fields[6:]
            _hex(invocation, 32)
            _hex(nonce, 64)
            if (nonce == binding['handshake'] or not identities[1] or not identities[3]
                    or identities[:2] == identities[2:]):
                raise ValueError()
            send(_bridge_frame(2, binding, invocation, nonce, identities))
            raw, _fields, received = receive(3, 2)
            if raw != _bridge_frame(3, binding, invocation, nonce, identities):
                raise ValueError()

            def listeners():
                for index, fd in enumerate(received):
                    clock()
                    info = os.fstat(fd)
                    if (not stat.S_ISSOCK(info.st_mode) or (info.st_dev, info.st_ino) != identities[index * 2:index * 2 + 2]
                            or os.get_inheritable(fd) or not fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_NONBLOCK
                            or _bridge_socket_info(fd) != (socket.AF_UNIX, socket.SOCK_STREAM, 1,
                                '/run/holaday-pool-data/' + binding['resource'] + '/' + ('cdp.sock', 'vnc.sock')[index])):
                        raise ValueError()
                    clock()

            listeners()
            send(_bridge_frame(4, binding, invocation, nonce, identities))
            raw, _fields, _rights = receive(5, 0)
            if raw != _bridge_frame(5, binding, invocation, nonce, identities):
                raise ValueError()
            listeners()
            budget()
            owned, self._channel = self._channel, None
            owned.close()
            budget()
            self._bridge = tuple(received)  # Internal ownership only, not readiness.
        except Exception:
            self._discard()
            _deny()

    def _remaining(self):
        now = time.monotonic()
        if (not math.isfinite(now) or now < 0 or self._binding is None or not self._fds
                or (self._last is not None and now < self._last)):
            raise ValueError()
        if self._deadline is None:
            self._deadline = now + 5.0
        self._last = now
        if now >= self._deadline:
            raise ValueError()
        return self._deadline - now

    def _executable(self, path):
        """Only fixed candidate paths; retained original objects, not fexecve scripts."""
        parent, name = path.rsplit('/', 1)
        directory = self._walk(parent)[-1]
        fd = os.open(name, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        self._fds.append(fd)
        info, flags = os.fstat(fd), os.fstatvfs(fd).f_flag
        if (not stat.S_ISREG(info.st_mode) or (info.st_uid, info.st_gid) != (0, 0)
                or stat.S_IMODE(info.st_mode) != 0o555 or info.st_nlink != 1
                or not 0 < info.st_size <= 536870912 or not flags & 1 or flags & 8
                or set(os.listxattr(fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
            raise ValueError()
        return fd, _signature(info), os.pread(fd, 128, 0)

    def _exec_fds(self):
        # The guard is single-threaded. A /proc enumeration may mention its own
        # already-closed directory FD; only EBADF permits ignoring that entry.
        names = os.listdir('/proc/self/fd')
        if len(names) > 1024 or len(set(self._fds)) != len(self._fds):
            raise ValueError()
        seen = set()
        for name in names:
            if type(name) is not str or re.fullmatch(r'0|[1-9][0-9]{0,9}', name) is None:
                raise ValueError()
            fd = int(name)
            try:
                info = os.fstat(fd)
            except OSError as error:
                if error.errno == errno.EBADF and fd not in self._fds and fd > 2:
                    continue
                raise
            if fd in seen:
                raise ValueError()
            seen.add(fd)
            if fd < 3:
                if not stat.S_ISCHR(info.st_mode) or info.st_rdev != os.makedev(1, 3):
                    raise ValueError()
            elif fd not in self._fds or os.get_inheritable(fd):
                raise ValueError()
            self._remaining()
        if seen != {0, 1, 2, *self._fds}:
            raise ValueError()

    def _execute(self):
        """One fixed four-role exec. Owns its fresh grant."""
        try:
            self._remaining()  # One original five-second budget, including grant.
            self._check()
            binding = self._binding
            role = binding['role']
            if self._attempted or role not in ('xvfb', 'brave', 'x11vnc', 'websockify'):
                raise ValueError()
            authority = self._credential.rsplit('/', 1)[0] + '/xauthority'
            uid, gid = binding['uid'], binding['gid']
            auth = self._walk(authority, credential=(uid, gid))[-1]
            auth_info = _credential_metadata(auth, uid, gid, directory=False)
            auth_raw = os.pread(auth, 129, 0)
            prefix = b'\xff\xff\0\0\0\x02' + b'99' + b'\0\x12MIT-MAGIC-COOKIE-1\0\x10'
            if (len(auth_raw) != len(prefix) + 16 or not auth_raw.startswith(prefix)
                    or auth_raw[-16:] == b'\0' * 16 or auth_info.st_size != len(auth_raw)):
                raise ValueError()
            profile = self._walk('/profile')[-1]
            profile_info = os.fstat(profile)
            profile_signature = _signature(profile_info)

            def inputs():
                count = len(self._fds)
                try:
                    current_auth = self._walk(authority, credential=(uid, gid))[-1]
                    current_profile = self._walk('/profile')[-1]
                    for fd in (profile, current_profile):
                        info, flags = os.fstat(fd), os.fstatvfs(fd).f_flag
                        if (_signature(info) != profile_signature or not stat.S_ISDIR(info.st_mode)
                                or (info.st_uid, info.st_gid) != (uid, gid) or stat.S_IMODE(info.st_mode) != 0o700
                                or flags & 14 != 14 or flags & 1
                                or set(os.listxattr(fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
                            raise ValueError()
                    for fd in (auth, current_auth):
                        if (_signature(_credential_metadata(fd, uid, gid, directory=False)) != _signature(auth_info)
                                or os.pread(fd, 129, 0) != auth_raw):
                            raise ValueError()
                finally:
                    while len(self._fds) > count:
                        self._close_last()
                self._remaining()

            commands = {
                'xvfb': ['/usr/bin/Xvfb', ':99', '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-auth', authority],
                'brave': ['/usr/bin/brave-browser', '--remote-debugging-port=19222',
                    '--remote-debugging-address=127.0.0.1', '--user-data-dir=/profile',
                    '--proxy-server=http://127.0.0.1:18080', '--proxy-bypass-list=<-loopback>',
                    '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
                    '--disable-background-networking', '--disable-sync', '--no-first-run',
                    '--no-default-browser-check', '--deny-permission-prompts', '--window-size=1280,800',
                    '--window-position=0,0', '--start-maximized', '--homepage=about:blank', '--lang=zh-CN', 'about:blank'],
                'x11vnc': ['/usr/bin/x11vnc', '-display', ':99', '-auth', authority, '-forever',
                    '-nopw', '-shared', '-noxdamage', '-listen', '127.0.0.1', '-rfbport', '15900'],
                'websockify': ['/usr/bin/websockify', '127.0.0.1:16080', '127.0.0.1:15900'],
            }
            argv = commands[role]
            executables = [(argv[0], self._executable(argv[0]))]
            header = executables[0][1][2]
            if header.startswith(b'#!'):
                interpreter = header.split(b'\n', 1)[0][2:]
                if interpreter not in (b'/bin/sh', b'/bin/bash', b'/usr/bin/python3'):
                    raise ValueError()
                item = self._executable(interpreter.decode('ascii'))
                if not item[2].startswith(b'\x7fELF'):
                    raise ValueError()
                executables.append((interpreter.decode('ascii'), item))
                if interpreter == b'/usr/bin/python3':
                    # A shebang does not inherit the guard interpreter's -I.
                    # Keep trusted system site-packages, never writable user-site
                    # or cwd/script-directory import injection; do not add -S.
                    argv = ['/usr/bin/python3', '-I', *argv]
            elif not header.startswith(b'\x7fELF'):
                raise ValueError()
            inputs()
            self._await_grant()
            os.umask(0o077)
            for sig in signal.valid_signals():
                if sig not in (signal.SIGKILL, signal.SIGSTOP):
                    signal.signal(sig, signal.SIG_DFL)
            signal.pthread_sigmask(signal.SIG_SETMASK, [])
            os.chdir('/profile')
            self._check()
            inputs()
            for path, (original, signature, raw) in executables:
                count = len(self._fds)
                try:
                    current, current_signature, current_raw = self._executable(path)
                    if (_signature(os.fstat(original)) != signature or current_signature != signature
                            or os.pread(original, 128, 0) != raw or current_raw != raw):
                        raise ValueError()
                finally:
                    while len(self._fds) > count:
                        self._close_last()
                self._remaining()
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/profile',
                   'TMPDIR': '/tmp', 'DISPLAY': ':99', 'XAUTHORITY': authority,
                   'PYTHONNOUSERSITE': '1'}
            self._exec_fds()
            # No more file acquisition after the final descriptor boundary.
            self._remaining()
            if self._binding is not binding:
                raise ValueError()
            os.execve(argv[0], argv, env)
            raise ValueError()  # An exec that returns never means readiness.
        except Exception:
            self._discard()
            _deny()

    def _close_last(self):
        owned = self._fds.pop()
        os.close(owned)

    def _discard(self):
        failed = False
        owned, self._channel = self._channel, None
        self._binding, self._raw = None, None
        self._bridge = None
        self._application = None
        if owned is not None:
            try:
                owned.close()
            except Exception:
                failed = True
        while self._fds:
            try:
                self._close_last()
            except Exception:
                failed = True
        return failed

    def close(self):
        if self._discard():
            _deny()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


_DATA_FRAME = struct.Struct('!4sBB20s16s16s32s32s32s')
_DATA_DOMAIN = b'HoladayPool/data-auth/v1\0'
_RelaySocket = socket.socket
_ListenerSocket = socket.socket
_PROBE_CONTROL_FRAME = struct.Struct('!4sBB20s16s16s16sI32sQQ')


def _probe_control_frame(kind, stage, binding, invocation, pid, nonce, total_ns, phase_ns):
    try:
        if (type(kind) is not int or kind not in range(1, 8) or type(stage) is not int
                or type(pid) is not int or type(total_ns) is not int or type(phase_ns) is not int
                or type(nonce) is not bytes or len(nonce) != 32 or nonce == bytes(32)):
            raise ValueError()
        _hex(binding['candidate'], 40)
        _hex(binding['resource'], 32)
        _hex(binding['application']['boot'], 32)
        if kind == 1:
            if (stage, invocation, pid, total_ns, phase_ns) != (0, '0' * 32, 0, 0, 0): raise ValueError()
        else:
            _hex(invocation, 32)
            if not 2 <= pid <= 2147483647 or not 0 < phase_ns <= total_ns < 2**63: raise ValueError()
            if kind in (2, 3):
                if stage != 0: raise ValueError()
            elif stage not in ((4,) if kind == 7 else (1, 2, 3, 4)):
                raise ValueError()
        return _PROBE_CONTROL_FRAME.pack(b'HPT1', kind, stage, bytes.fromhex(binding['candidate']),
            bytes.fromhex(binding['resource']), bytes.fromhex(binding['application']['boot']),
            bytes.fromhex(invocation), pid, nonce, total_ns, phase_ns)
    except Exception: _deny()


def _decode_probe_control_frame(data, binding):
    try:
        if type(data) is not bytes or len(data) != _PROBE_CONTROL_FRAME.size: raise ValueError()
        fields = _PROBE_CONTROL_FRAME.unpack(data)
        _, kind, stage, _candidate, _resource, _boot, invocation, pid, nonce, total_ns, phase_ns = fields
        values = (kind, stage, invocation.hex(), pid, nonce, total_ns, phase_ns)
        if _probe_control_frame(kind, stage, binding, *values[2:]) != data: raise ValueError()
        return values
    except Exception: _deny()


class _ProbeExchange:
    """Bounded fixed protocol codec. It has no socket, authority or ready API."""

    def __init__(self, stage, cookie=None):
        self._closed, self._complete = False, False
        self._incoming = self._outbound = self._rfb_bytes = b''
        self._total = 0
        self._stage, self._state, self._accept = stage, 'initial', None
        try:
            if type(stage) is not int or stage not in (1, 2, 3, 4): raise ValueError()
            if stage == 1:
                if type(cookie) is not bytes or len(cookie) != 16 or cookie == bytes(16): raise ValueError()
                self._outbound = struct.pack('!BBHHHHH', 66, 0, 11, 0, 18, 16, 0) + b'MIT-MAGIC-COOKIE-1\0\0' + cookie
            elif cookie is not None: raise ValueError()
            elif stage == 2:
                self._outbound = b'GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:19222\r\nConnection: close\r\n\r\n'
            elif stage == 4:
                nonce = os.urandom(16)
                if type(nonce) is not bytes or len(nonce) != 16 or nonce == bytes(16): raise ValueError()
                key = base64.b64encode(nonce)
                self._accept = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
                self._outbound = (b'GET / HTTP/1.1\r\nHost: 127.0.0.1:16080\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                    b'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\nSec-WebSocket-Key: ' + key + b'\r\n\r\n')
        except Exception:
            self.close()
            _deny()

    def sent(self, count):
        try:
            if self._closed or self._complete or type(count) is not int or not 0 < count <= len(self._outbound):
                raise ValueError()
            self._outbound = self._outbound[count:]
        except Exception:
            self.close()
            _deny()

    def feed(self, data):
        try:
            if (self._closed or self._complete or self._outbound or type(data) is not bytes
                    or not data or self._total + len(data) > 16384): raise ValueError()
            self._total += len(data)
            self._incoming += data
            if self._stage == 1: self._x11()
            elif self._stage == 2 or self._stage == 4 and self._state == 'initial': self._http()
            elif self._stage == 3:
                self._rfb_bytes += self._incoming
                self._incoming = b''
                self._rfb()
            else: self._websocket()
        except Exception:
            self.close()
            _deny()

    def _x11(self):
        data = self._incoming
        if len(data) < 8: return
        status, _, major, minor, units = struct.unpack('!BBHHH', data[:8])
        total = 8 + 4 * units
        if status != 1 or (major, minor) != (11, 0) or not 40 <= total <= 16384 or len(data) > total:
            raise ValueError()
        if len(data) < total: return
        fields = struct.unpack('!IIIIHHBBBBBBBB4x', data[8:40])
        _release, _base, mask, _motion, vendor, max_request, screens, formats, image_order, bit_order, unit, pad, min_key, max_key = fields
        if (not mask or vendor > 1024 or not max_request or screens != 1 or not 1 <= formats <= 16
                or image_order not in (0, 1) or bit_order not in (0, 1) or unit not in (8, 16, 32)
                or pad not in (8, 16, 32) or min_key > max_key): raise ValueError()
        pos = 40 + (vendor + 3) // 4 * 4
        for _ in range(formats):
            if pos + 8 > total: raise ValueError()
            depth, bpp, scan_pad = struct.unpack('!BBB5x', data[pos:pos + 8])
            if not 1 <= depth <= 32 or bpp not in (1, 4, 8, 16, 24, 32) or scan_pad not in (8, 16, 32): raise ValueError()
            pos += 8
        if pos + 40 > total: raise ValueError()
        screen = struct.unpack('!IIIIIHHHHHHIBBBB', data[pos:pos + 40])
        if not screen[0] or screen[5:7] != (1280, 800) or screen[14] != 24 or not 1 <= screen[15] <= 16:
            raise ValueError()
        root_visual, found = screen[11], False
        pos += 40
        for _ in range(screen[15]):
            if pos + 8 > total: raise ValueError()
            depth, _, count = struct.unpack('!BBH4x', data[pos:pos + 8])
            pos += 8
            if not 1 <= depth <= 32 or count > 512 or pos + count * 24 > total: raise ValueError()
            for _ in range(count):
                visual = struct.unpack('!IBBHIII4x', data[pos:pos + 24])
                if visual[0] == root_visual and depth == 24 and visual[1] in (4, 5): found = True
                pos += 24
        if pos != total or not found: raise ValueError()
        self._incoming, self._complete = b'', True

    def _http(self):
        boundary = self._incoming.find(b'\r\n\r\n')
        if boundary < 0:
            if len(self._incoming) > 4096: raise ValueError()
            return
        if boundary > 4096: raise ValueError()
        lines = self._incoming[:boundary].split(b'\r\n')
        expected = b'200' if self._stage == 2 else b'101'
        status = lines[0].split(b' ', 2)
        if len(status) != 3 or status[:2] != [b'HTTP/1.1', expected]: raise ValueError()
        headers = {}
        for line in lines[1:]:
            key, colon, value = line.partition(b':')
            key = key.lower()
            if (not colon or not re.fullmatch(rb'[a-z0-9-]+', key) or key in headers
                    or any(byte < 32 and byte != 9 or byte == 127 for byte in value)): raise ValueError()
            headers[key] = value.strip()
        if b'transfer-encoding' in headers: raise ValueError()
        body = self._incoming[boundary + 4:]
        if self._stage == 2:
            length = headers.get(b'content-length', b'')
            if (not re.fullmatch(rb'0|[1-9][0-9]{0,4}', length) or not 1 <= int(length) <= 8192
                    or headers.get(b'content-type', b'').split(b';', 1)[0].strip().lower() != b'application/json'
                    or len(body) > int(length)): raise ValueError()
            if len(body) < int(length): return
            data = json.loads(body, object_pairs_hook=_unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if (type(data) is not dict or data.get('Protocol-Version') != '1.3'
                    or type(data.get('Browser')) is not str or not 1 <= len(data['Browser']) <= 128
                    or type(data.get('webSocketDebuggerUrl')) is not str
                    or re.fullmatch(r'ws://127\.0\.0\.1:19222/devtools/browser/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',
                        data['webSocketDebuggerUrl']) is None): raise ValueError()
            self._incoming, self._complete = b'', True
        else:
            if (headers.get(b'upgrade', b'').lower() != b'websocket'
                    or b'upgrade' not in [value.strip().lower() for value in headers.get(b'connection', b'').split(b',')]
                    or headers.get(b'sec-websocket-accept') != self._accept
                    or headers.get(b'sec-websocket-protocol') != b'binary'
                    or b'sec-websocket-extensions' in headers or b'content-length' in headers): raise ValueError()
            self._incoming, self._state = body, 'rfb-version'
            if body: self._websocket()

    def _websocket(self):
        # Iterative even for thousands of tiny binary messages; cumulative received bytes are bounded.
        while self._incoming:
            if len(self._incoming) < 2: return
            first, second = self._incoming[:2]
            if first != 0x82 or second & 128: raise ValueError()
            length, offset = second & 127, 2
            if length == 127: raise ValueError()
            if length == 126:
                if len(self._incoming) < 4: return
                length, offset = struct.unpack('!H', self._incoming[2:4])[0], 4
                if length < 126: raise ValueError()
            if not 1 <= length <= 8192: raise ValueError()
            if len(self._incoming) < offset + length: return
            self._rfb_bytes += self._incoming[offset:offset + length]
            self._incoming = self._incoming[offset + length:]
            self._rfb()
            if self._incoming and (self._outbound or self._complete): raise ValueError()

    def _reply(self, data):
        if self._rfb_bytes: raise ValueError()
        if self._stage == 4:
            mask = os.urandom(4)
            if type(mask) is not bytes or len(mask) != 4: raise ValueError()
            data = bytes([0x82, 128 | len(data)]) + mask + bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self._outbound = data

    def _rfb(self):
        data = self._rfb_bytes
        if self._state in ('initial', 'rfb-version'):
            if len(data) < 12: return
            if data != b'RFB 003.008\n': raise ValueError()
            self._rfb_bytes, self._state = b'', 'rfb-security'
            self._reply(b'RFB 003.008\n')
        elif self._state == 'rfb-security':
            if not data: return
            count = data[0]
            if not 1 <= count <= 16 or len(data) > count + 1: raise ValueError()
            if len(data) < count + 1: return
            if 1 not in data[1:] or len(set(data[1:])) != count: raise ValueError()
            self._rfb_bytes, self._state = b'', 'rfb-result'
            self._reply(b'\x01')
        elif self._state == 'rfb-result':
            if len(data) < 4: return
            if data != bytes(4): raise ValueError()
            self._rfb_bytes, self._state = b'', 'rfb-init'
            self._reply(b'\x01')
        elif self._state == 'rfb-init':
            if len(data) < 24: return
            fields = struct.unpack('!HHBBBBHHHBBB3xI', data[:24])
            if (fields[:4] != (1280, 800, 32, 24) or fields[4] not in (0, 1)
                    or fields[5:12] != (1, 255, 255, 255, 16, 8, 0)
                    or fields[12] > 4096 or len(data) > 24 + fields[12]): raise ValueError()
            if len(data) < 24 + fields[12]: return
            self._rfb_bytes, self._complete = b'', True
        else: raise ValueError()

    def close(self):
        self._closed, self._complete = True, False
        self._incoming = self._outbound = self._rfb_bytes = b''
        self._accept = None


_ProbeSocket = Socket


_ProbeControlSocket = Socket


class _ProbeControl:
    """One root metadata connection; protocol reports require a durable root ACK.

    No public ready result. The original bridge drives this and one probe fairly.
    """

    def __init__(self):
        raise TypeError('original source required')

    @classmethod
    def open(cls, source, *, scope_guard=None):
        if type(source) is not _EgressSource or source._closed or getattr(source, '_probe_active', False): _deny()
        source._probe_active = True
        self = object.__new__(cls)
        self._source, self._binding, self._source_data = source, source._binding, source._data
        self._scope_guard = scope_guard
        self._endpoint = self._stream = self._probe = self._command = None
        self._state, self._stage, self._finished = 'connect', 0, False
        self._outbound = b''
        self._last_ns = time.monotonic_ns()
        self._total_ns, self._phase_ns = self._last_ns + 60000000000, self._last_ns + 5000000000
        self._total_deadline, self._stage_deadline = self._total_ns / 1e9, self._phase_ns / 1e9
        self._wire_total = None
        self._nonces = {bytes.fromhex(self._binding['handshake'])}
        self._invocations, self._pids = set(), set()
        try:
            if scope_guard is not None and not callable(scope_guard): raise ValueError()
            self._check()
            self._endpoint = _ProbeControlSource.open(source, self._clock)
            self._check()
            self._stream = _ProbeControlSocket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
            self._check()
            self._stream.set_inheritable(False)
            self._stream.setblocking(False)
            self._stream.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
            path = self._endpoint.path()
            self._check()
            result = self._stream.connect_ex(path)
            self._check()
            if result == 0: self._connected()
            elif result not in (errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR): raise ValueError()
            return self
        except Exception:
            self.close()
            _deny()

    def _veto(self):
        if (self._state == 'closed' or self._source is None or self._source._closed
                or self._source._binding is not self._binding or self._source._data is not self._source_data): raise ValueError()

    def _clock(self):
        if self._scope_guard is not None: self._scope_guard()
        now = time.monotonic_ns()
        self._veto()
        if (type(now) is not int or type(self._last_ns) is not int or now < 0 or now < self._last_ns
                or now >= self._total_ns or self._phase_ns is not None and now >= self._phase_ns): raise ValueError()
        self._last_ns = now
        if self._scope_guard is not None: self._scope_guard()
        self._veto()

    def _check(self):
        self._clock()
        self._source._check()
        self._clock()
        if self._endpoint is not None: self._endpoint.check()
        self._clock()

    def _connected(self):
        self._check()
        expected = struct.pack('=iII', self._binding['brokerPid'], 0, 0)
        if self._stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12) != expected: raise ValueError()
        self._check()
        self._peer = expected
        self._outbound = _probe_control_frame(1, 0, self._binding, '0' * 32, 0,
                                             bytes.fromhex(self._binding['handshake']), 0, 0)
        self._state = 'hello'

    def _receive(self):
        stream = self._stream
        data, ancillary, flags, _ = stream.recvmsg(_PROBE_CONTROL_FRAME.size + 1,
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
        peers, rights, invalid = [], [], False
        try:
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    invalid = True
                    width = array.array('i').itemsize
                    for fd in array.array('i', raw[:len(raw) // width * width]):
                        if fd >= 0 and fd not in rights: rights.append(fd)
                elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS: peers.append(raw)
                else: invalid = True
            self._check()
            if (self._stream is not stream or invalid or peers != [self._peer]
                    or flags & ~socket.MSG_CMSG_CLOEXEC): raise ValueError()
            return _decode_probe_control_frame(data, self._binding)
        finally:
            failed = False
            while rights:
                try: os.close(rights.pop())
                except Exception: failed = True
            if failed: _deny()

    def _handle(self, frame):
        self._check()
        kind, stage, invocation, pid, nonce, total_ns, phase_ns = frame
        if self._state == 'challenge':
            if kind != 2 or stage != 0 or pid != os.getpid() or nonce in self._nonces: raise ValueError()
            self._clock()
            if not self._last_ns < phase_ns <= total_ns <= self._total_ns or phase_ns - self._last_ns > 5000000000: raise ValueError()
            self._wire_total = total_ns
            self._total_ns, self._phase_ns = total_ns, min(self._phase_ns, phase_ns)
            self._total_deadline, self._stage_deadline = self._total_ns / 1e9, self._phase_ns / 1e9
            self._nonces.add(nonce)
            self._invocations.add(invocation)
            self._pids.add(pid)
            self._outbound = _probe_control_frame(3, stage, self._binding, invocation, pid, nonce, total_ns, phase_ns)
            self._state = 'accept'
        elif self._state == 'command':
            if (kind != 4 or stage != self._stage + 1 or nonce in self._nonces
                    or invocation in self._invocations or pid in self._pids): raise ValueError()
            self._clock()
            if (total_ns != self._wire_total or not self._last_ns < phase_ns <= total_ns
                    or phase_ns - self._last_ns > 5000000000): raise ValueError()
            self._phase_ns, self._stage_deadline = phase_ns, phase_ns / 1e9
            self._nonces.add(nonce)
            self._invocations.add(invocation)
            self._pids.add(pid)
            self._command, self._stage, self._state = frame, stage, 'probing'
            self._probe = _ProtocolProbe.open(self._source, stage, pid, self._stage_deadline, scope_guard=self._clock)
        elif self._state == 'ack':
            if kind != 6 or frame[1:] != self._command[1:]: raise ValueError()
            if stage == 4:
                self._outbound = _probe_control_frame(7, stage, self._binding, invocation, pid, nonce, total_ns, phase_ns)
                self._state = 'final'
            else:
                self._command, self._phase_ns, self._stage_deadline, self._state = None, None, None, 'command'
        else: raise ValueError()
        self._check()

    def _drive_probe(self, events):
        self._check()
        probe = self._probe
        if type(probe) is not _ProtocolProbe or self._state != 'probing': raise ValueError()
        probe.advance(events)
        self._check()
        if probe._observed:
            self._probe = None
            probe.close()
            self._check()
            _, stage, invocation, pid, nonce, total_ns, phase_ns = self._command
            self._outbound = _probe_control_frame(5, stage, self._binding, invocation, pid, nonce, total_ns, phase_ns)
            self._state = 'report'

    def interests(self):
        self._check()
        desired = {'control': selectors.EVENT_WRITE if self._state == 'connect' or self._outbound else selectors.EVENT_READ}
        if self._probe is not None:
            events = self._probe.interests()
            if events: desired['probe'] = events
        self._check()
        return desired

    def advance(self, side, events):
        try:
            if side not in ('control', 'probe', 'tick') or type(events) is not int or events < 0 or events & ~3: raise ValueError()
            self._check()
            if side == 'probe': self._drive_probe(events)
            elif side == 'tick':
                if events: raise ValueError()
                if self._probe is not None and self._probe._state == 'waiting': self._drive_probe(0)
            elif self._state == 'connect':
                if events & selectors.EVENT_WRITE:
                    error = self._stream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                    self._check()
                    if error: raise ValueError()
                    self._connected()
            else:
                try:
                    if self._outbound and events & selectors.EVENT_WRITE:
                        payload = self._outbound
                        count = self._stream.sendmsg([payload])
                        self._check()
                        if count != len(payload): raise ValueError()
                        self._outbound = b''
                        if self._state == 'hello': self._state = 'challenge'
                        elif self._state == 'accept': self._state, self._phase_ns, self._stage_deadline = 'command', None, None
                        elif self._state == 'report': self._state = 'ack'
                        elif self._state == 'final':
                            # Both closes remain inside the final stage budget.
                            stream, self._stream = self._stream, None
                            stream.close()
                            self._check()
                            endpoint, self._endpoint = self._endpoint, None
                            endpoint.close()
                            self._check()
                            self._finished, self._state = True, 'finished'
                        else: raise ValueError()
                    elif not self._outbound and events & selectors.EVENT_READ:
                        self._handle(self._receive())
                except BlockingIOError: self._check()
            self._check()
        except Exception:
            self.close()
            _deny()

    def close(self):
        self._state, self._finished = 'closed', False
        owners = (self._probe, self._stream, self._endpoint)
        self._probe = self._stream = self._endpoint = self._source = self._binding = self._source_data = None
        self._outbound, self._command = b'', None
        failed = False
        for owner in owners:
            if owner is not None:
                try: owner.close()
                except Exception: failed = True
        if failed: _deny()


class _ProbeControlSource:
    """Search-only original root-owned control endpoint, with no grant authority."""

    def __init__(self):
        raise TypeError('original source required')

    @classmethod
    def open(cls, source, budget):
        self = object.__new__(cls)
        self._source, self._budget = source, budget
        self._fds, self._closed = [], False
        self._directory = self._leaf = None
        try:
            if type(source) is not _EgressSource or not callable(budget): raise ValueError()
            self._base()
            flags = getattr(os, 'O_PATH', 0x200000) | os.O_NOFOLLOW | os.O_CLOEXEC
            fd = self._open('holaday-pool', flags | os.O_DIRECTORY, source._dirs[1][0])
            self._directory = (fd, self._metadata(fd, True))
            fd = self._open('control.sock', flags, fd)
            self._leaf = (fd, self._metadata(fd, False))
            self.check()
            return self
        except Exception:
            self.close()
            _deny()

    def _base(self):
        if self._closed or self._source is None: raise ValueError()
        self._budget()
        if self._closed or self._source is None or self._source._closed: raise ValueError()
        self._source._check()
        self._budget()
        if self._closed or self._source is None or self._source._closed: raise ValueError()

    def _io(self, call, *args, **kwargs):
        self._base()
        result = call(*args, **kwargs)
        self._base()
        return result

    def _open(self, name, flags, parent):
        self._base()
        fd = os.open(name, flags, dir_fd=parent)
        self._fds.append(fd)
        self._base()
        return fd

    def _metadata(self, fd, directory):
        info = self._io(os.fstat, fd)
        if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISSOCK(info.st_mode))
                or (info.st_uid, info.st_gid) != (0, self._source._binding['gid'])
                or stat.S_IMODE(info.st_mode) != (0o710 if directory else 0o660)
                or info.st_nlink < 1 or not directory and info.st_nlink != 1
                or self._io(os.get_inheritable, fd) or not self._io(os.fstatvfs, fd).f_flag & 1
                or set(self._io(os.listxattr, '/proc/self/fd/' + str(fd))) &
                    {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
            raise ValueError()
        return _signature(info)

    def check(self):
        self._base()
        for item, parent, name, directory in (
                (self._directory, self._source._dirs[1][0], 'holaday-pool', True),
                (self._leaf, self._directory[0], 'control.sock', False)):
            fd, signature = item
            if (self._metadata(fd, directory) != signature or
                    _signature(self._io(os.stat, name, dir_fd=parent, follow_symlinks=False)) != signature):
                raise ValueError()
        self._base()

    def path(self):
        self.check()
        return '/proc/self/fd/' + str(self._leaf[0])

    def close(self):
        self._closed = True
        self._source = self._directory = self._leaf = None
        failed = False
        while self._fds:
            try: os.close(self._fds.pop())
            except Exception: failed = True
        if failed: _deny()


class _X11ProbeInputs:
    """Original credential, private tmp and one captured X socket inode."""

    def __init__(self):
        raise TypeError('original source required')

    @classmethod
    def open(cls, source, budget):
        self = object.__new__(cls)
        self._source, self._budget = source, budget
        self._fds, self._closed = [], False
        self._auth = self._directory = self._leaf = None
        self._raw = None
        try:
            self._check_base()
            fd = self._open('xauthority', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, source._dirs[-1][0])
            binding = source._binding
            info = _credential_metadata(fd, binding['uid'], binding['gid'], directory=False)
            self._check_base()
            raw = os.pread(fd, 129, 0)
            self._check_base()
            prefix = b'\xff\xff\0\0\0\x0299\0\x12MIT-MAGIC-COOKIE-1\0\x10'
            if len(raw) != len(prefix) + 16 or not raw.startswith(prefix) or raw[-16:] == bytes(16) or info.st_size != len(raw):
                raise ValueError()
            self._auth, self._raw = (fd, _signature(info)), raw
            self.check()
            return self
        except Exception:
            self.close()
            _deny()

    def _check_base(self):
        self._budget()
        if self._closed or self._source is None or self._source._closed: raise ValueError()

    def _open(self, name, flags, parent):
        self._check_base()
        fd = os.open(name, flags, dir_fd=parent)
        self._fds.append(fd)
        self._check_base()
        return fd

    def _metadata(self, fd, directory):
        self._check_base()
        info = os.fstat(fd)
        binding = self._source._binding
        if ((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISSOCK(info.st_mode)) is not True
                or (info.st_uid, info.st_gid) != (binding['uid'], binding['gid'])
                or stat.S_IMODE(info.st_mode) != (0o1777 if directory else 0o777)
                or info.st_nlink < 1 or not directory and info.st_nlink != 1
                or os.get_inheritable(fd)):
            raise ValueError()
        self._check_base()
        flags = os.fstatvfs(fd).f_flag
        self._check_base()
        if flags & 14 != 14 or flags & 1: raise ValueError()
        attrs = os.listxattr(fd if directory else '/proc/self/fd/' + str(fd))
        self._check_base()
        if set(attrs) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}: raise ValueError()
        return _signature(info)[:-1]

    def check(self):
        self._check_base()
        source = self._source
        fd, signature = self._auth
        binding = source._binding
        if _signature(_credential_metadata(fd, binding['uid'], binding['gid'], directory=False)) != signature:
            raise ValueError()
        self._check_base()
        if (_signature(os.stat('xauthority', dir_fd=source._dirs[-1][0], follow_symlinks=False)) != signature
                or os.get_inheritable(fd) or not hmac.compare_digest(os.pread(fd, 129, 0), self._raw)): raise ValueError()
        self._check_base()
        if self._directory is not None:
            fd, identity = self._directory
            if (self._metadata(fd, True) != identity or _signature(os.stat('.X11-unix',
                    dir_fd=source._worker._objects['/tmp'][0], follow_symlinks=False))[:-1] != identity): raise ValueError()
            self._check_base()
        if self._leaf is not None:
            fd, identity = self._leaf
            if (self._metadata(fd, False) != identity or _signature(os.stat('X99',
                    dir_fd=self._directory[0], follow_symlinks=False))[:-1] != identity): raise ValueError()
            self._check_base()
        self._check_base()

    def capture(self):
        self.check()
        try:
            if self._directory is None:
                fd = self._open('.X11-unix', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                self._source._worker._objects['/tmp'][0])
                self._directory = (fd, self._metadata(fd, True))
            if self._leaf is None:
                fd = self._open('X99', getattr(os, 'O_PATH', 0x200000) | os.O_NOFOLLOW | os.O_CLOEXEC, self._directory[0])
                self._leaf = (fd, self._metadata(fd, False))
        except FileNotFoundError:
            self.check()
            return False
        self.check()
        return True

    def path(self):
        self.check()
        if self._leaf is None: raise ValueError()
        return '/proc/self/fd/' + str(self._leaf[0])

    def close(self):
        self._closed = True
        self._source = self._raw = self._auth = self._directory = self._leaf = None
        failed = False
        while self._fds:
            try: os.close(self._fds.pop())
            except Exception: failed = True
        if failed: _deny()


class _ProtocolProbe:
    """Original-guard nonblocking observation; no public readiness or dispatch."""

    def __init__(self):
        raise TypeError('original source and stage required')

    @classmethod
    def open(cls, source, stage, role_pid, deadline, *, scope_guard=None):
        self = object.__new__(cls)
        self._source = self._source_data = self._worker = self._binding = None
        self._stream = self._exchange = self._x11 = None
        self._scope_guard = scope_guard
        self._state, self._observed, self._attempts = 'waiting', False, 0
        self._last = time.monotonic()
        self._next_attempt = self._last
        self._deadline = deadline
        try:
            if (scope_guard is not None and not callable(scope_guard) or
                    type(source) is not _EgressSource or type(stage) is not int or stage not in (1, 2, 3, 4)
                    or type(role_pid) is not int or not 2 <= role_pid <= 2147483647
                    or type(deadline) not in (int, float) or not math.isfinite(deadline)
                    or not math.isfinite(self._last) or not self._last < deadline <= self._last + 5): raise ValueError()
            self._source, self._source_data = source, source._data
            self._worker, self._binding = source._worker, source._binding
            self._stage, self._role_pid = stage, role_pid
            self._check()
            if stage == 1: self._x11 = _X11ProbeInputs.open(source, self._base_check)
            self._exchange = _ProbeExchange(stage, self._x11._raw[-16:] if self._x11 is not None else None)
            self._check()
            return self
        except Exception:
            self.close()
            _deny()

    def _veto(self):
        if (self._state == 'closed' or self._source is None or self._source._closed
                or self._source._data is not self._source_data or self._source._worker is not self._worker
                or self._source._binding is not self._binding or self._worker is None
                or self._worker._binding is not self._binding): raise ValueError()

    def _clock(self):
        if self._scope_guard is not None: self._scope_guard()
        now = time.monotonic()
        self._veto()
        if not math.isfinite(now) or now < 0 or now < self._last or now >= self._deadline: raise ValueError()
        self._last = now
        if self._scope_guard is not None: self._scope_guard()
        self._veto()

    def _base_check(self):
        self._clock()
        self._source._check()
        self._clock()

    def _check(self):
        self._base_check()
        if self._x11 is not None: self._x11.check()
        self._clock()

    def _connected(self):
        self._check()
        if self._stage == 1:
            expected = struct.pack('=iII', self._role_pid, self._binding['uid'], self._binding['gid'])
            value = self._stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            self._check()
            if value != expected: raise ValueError()
            self._x11_peer = expected
        self._state = 'connected'

    def _retry(self):
        stream, self._stream = self._stream, None
        if stream is not None: stream.close()
        self._check()
        if self._attempts >= 50: raise ValueError()
        self._state, self._next_attempt = 'waiting', self._last + .1

    def _start(self):
        self._check()
        if self._last < self._next_attempt: return
        if self._attempts >= 50: raise ValueError()
        self._attempts += 1
        if self._x11 is not None and not self._x11.capture():
            self._retry()
            return
        address = self._x11.path() if self._x11 is not None else ('127.0.0.1', {2: 19222, 3: 15900, 4: 16080}[self._stage])
        self._check()
        self._stream = _ProbeSocket(socket.AF_UNIX if self._x11 is not None else socket.AF_INET, socket.SOCK_STREAM)
        self._check()
        self._stream.set_inheritable(False)
        self._stream.setblocking(False)
        if self._x11 is not None: self._stream.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
        self._check()
        result = self._stream.connect_ex(address)
        self._check()
        if result == errno.ECONNREFUSED: self._retry()
        elif result == 0: self._connected()
        elif result in (errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR): self._state = 'connecting'
        else: raise ValueError()

    def interests(self):
        try:
            self._check()
            if self._state in ('waiting', 'observed'): return 0
            return selectors.EVENT_WRITE if self._state == 'connecting' or self._exchange._outbound else selectors.EVENT_READ
        except Exception:
            self.close()
            _deny()

    def _receive(self):
        if self._stage != 1: return self._stream.recv(4096)
        data, ancillary, flags, _ = self._stream.recvmsg(4096,
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
        rights, peers, invalid = [], [], False
        try:
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    invalid = True
                    width = array.array('i').itemsize
                    for fd in array.array('i', raw[:len(raw) // width * width]):
                        if fd >= 0 and fd not in rights: rights.append(fd)
                elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS: peers.append(raw)
                else: invalid = True
            self._check()
            if invalid or peers != [self._x11_peer] or flags & ~socket.MSG_CMSG_CLOEXEC: raise ValueError()
            return data
        finally:
            failed = False
            while rights:
                try: os.close(rights.pop())
                except Exception: failed = True
            if failed: _deny()

    def advance(self, events):
        try:
            if type(events) is not int or events < 0 or events & ~3 or self._observed: raise ValueError()
            self._check()
            if self._state == 'waiting': self._start()
            elif self._state == 'connecting' and events & selectors.EVENT_WRITE:
                self._check()
                error = self._stream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                self._check()
                if error == errno.ECONNREFUSED: self._retry()
                elif error == 0: self._connected()
                else: raise ValueError()
            elif self._state == 'connected':
                try:
                    if self._exchange._outbound and events & selectors.EVENT_WRITE:
                        self._check()
                        count = self._stream.send(self._exchange._outbound)
                        self._check()
                        self._exchange.sent(count)
                    elif not self._exchange._outbound and events & selectors.EVENT_READ:
                        self._check()
                        data = self._receive()
                        self._check()
                        self._exchange.feed(data)
                        self._check()
                except BlockingIOError: self._check()
                if self._exchange._complete:
                    stream, self._stream = self._stream, None
                    stream.close()
                    self._check()
                    self._exchange.close()
                    self._check()
                    inputs, self._x11 = self._x11, None
                    if inputs is not None: inputs.close()
                    self._check()
                    self._state, self._observed = 'observed', True
            self._check()
        except Exception:
            self.close()
            _deny()

    def close(self):
        self._state, self._observed = 'closed', False
        stream, self._stream = self._stream, None
        exchange, self._exchange = self._exchange, None
        inputs, self._x11 = self._x11, None
        self._source = self._source_data = self._worker = self._binding = None
        failed = False
        for owned in (stream, exchange, inputs):
            if owned is not None:
                try: owned.close()
                except Exception: failed = True
        if failed: _deny()


class _EgressSource:
    """Original anchor credential and held read-only leaf; not a ready receipt."""

    def __init__(self):
        raise TypeError('original anchor egress source required')

    @classmethod
    def open(cls, worker):
        self = object.__new__(cls)
        self._fds, self._dirs = [], []
        self._worker = self._binding = self._bridge = self._application = None
        self._file = self._leaf = self._data = self._raw = None
        self._closed, self._opening = False, True
        self._last = time.monotonic()
        self._deadline = self._last + 5.0
        try:
            if (type(worker) is not _WorkerGuard or worker._binding is None
                    or worker._binding['role'] != 'anchor' or worker._bridge is None
                    or worker._application is None or getattr(worker, '_egress_active', False)):
                raise ValueError()
            worker._egress_active = True
            self._worker, self._binding = worker, worker._binding
            self._bridge, self._application = worker._bridge, worker._application
            self._clock()
            worker._check()
            self._clock()
            resource = self._binding['resource']
            parts = ('/', 'run', 'credentials', 'holaday-pool-anchor-' + resource + '.service', 'egress')
            for index, name in enumerate(parts):
                file = index == len(parts) - 1
                parent = self._dirs[-1][0] if self._dirs else None
                fd = self._open(name, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW |
                    (os.O_NONBLOCK if file else os.O_DIRECTORY), parent)
                if index >= len(parts) - 2:
                    info = self._io(_credential_metadata, fd, self._binding['uid'], self._binding['gid'], directory=not file)
                else: info = self._io(_trusted_directory, fd)
                if file:
                    if not 0 < info.st_size <= 2048: raise ValueError()
                    self._file = (fd, _signature(info))
                    self._raw = self._io(os.pread, fd, info.st_size + 1, 0)
                    if len(self._raw) != info.st_size: raise ValueError()
                else: self._dirs.append((fd, _signature(info), parent, name, index == 3))
            app = self._binding['application']
            self._data = _decode_egress_binding(self._raw, self._binding['candidate'], resource, app['boot'])
            self._leaf = self._open('holaday-egress.sock', getattr(os, 'O_PATH', 0x200000) |
                os.O_NOFOLLOW | os.O_CLOEXEC, self._dirs[1][0])
            self._check()
            self._opening = False
            return self
        except Exception:
            self.close()
            _deny()

    def _clock(self):
        now = time.monotonic()
        if (self._closed or self._worker is None or self._worker._binding is not self._binding
                or self._worker._bridge is not self._bridge or self._worker._application is not self._application
                or not math.isfinite(now) or not math.isfinite(self._last) or now < 0 or now < self._last
                or self._opening and now >= self._deadline):
            raise ValueError()
        self._last = now

    def _io(self, call, *args, **kwargs):
        self._clock()
        result = call(*args, **kwargs)
        self._clock()
        return result

    def _open(self, path, flags, parent=None):
        self._clock()
        fd = os.open(path, flags, **({'dir_fd': parent} if parent is not None else {}))
        self._fds.append(fd)
        self._clock()
        return fd

    def _check(self):
        self._clock()
        self._worker._check()
        self._clock()
        for fd, signature, parent, name, credential in self._dirs:
            info = (self._io(_credential_metadata, fd, self._binding['uid'], self._binding['gid'], directory=True)
                    if credential else self._io(_trusted_directory, fd))
            if (_signature(info) != signature or self._io(os.get_inheritable, fd)
                    or parent is not None and _signature(self._io(os.stat, name, dir_fd=parent, follow_symlinks=False)) != signature):
                raise ValueError()
        fd, signature = self._file
        info = self._io(_credential_metadata, fd, self._binding['uid'], self._binding['gid'], directory=False)
        if (_signature(info) != signature or self._io(os.get_inheritable, fd)
                or _signature(self._io(os.stat, 'egress', dir_fd=self._dirs[-1][0], follow_symlinks=False)) != signature
                or not hmac.compare_digest(self._io(os.pread, fd, 2049, 0), self._raw)):
            raise ValueError()
        fd = self._leaf
        leaf = self._io(os.fstat, fd)
        current = self._io(os.stat, 'holaday-egress.sock', dir_fd=self._dirs[1][0], follow_symlinks=False)
        identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid)
        if (not stat.S_ISSOCK(leaf.st_mode) or identity(leaf) != identity(current) or leaf.st_nlink < 1
                or (leaf.st_dev, leaf.st_ino) != (self._data['leaf']['device'], self._data['leaf']['inode'])
                or stat.S_IMODE(leaf.st_mode) != 0o666 or leaf.st_uid != 998
                or leaf.st_gid != self._binding['application']['gid']
                or self._io(os.get_inheritable, fd) or not self._io(os.fstatvfs, fd).f_flag & 1
                or set(self._io(os.listxattr, '/proc/self/fd/' + str(fd))) &
                    {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
            raise ValueError()
        self._clock()
        self._worker._poll_application()
        self._clock()

    def _path(self):
        self._check()
        return '/proc/self/fd/' + str(self._leaf)

    def close(self):
        self._closed = True
        self._worker = self._binding = self._bridge = self._application = None
        self._data = self._raw = self._file = self._leaf = None
        self._dirs = []
        failed = False
        while self._fds:
            try: os.close(self._fds.pop())
            except Exception: failed = True
        if failed: _deny()


_EgressSocket = Socket
_EgressListenerSocket = Socket
_EGRESS_DOMAIN = b'HoladayPool/egress-auth/v1\0'


class _EgressPeer:
    """One original-leaf connection; complete ACK allows relay, not readiness."""

    def __init__(self):
        raise TypeError('original anchor egress source required')

    @classmethod
    def open(cls, source, client):
        self = object.__new__(cls)
        self._source = self._data = self._stream = None
        self._client = client if isinstance(client, socket.socket) else None
        self._worker = self._binding = self._bridge = self._application = None
        self._authenticated, self._relaying, self._state = False, False, 'connect'
        self._incoming = self._outbound = b''
        self._key = self._nonce = self._hello_tag = None
        self._last = time.monotonic()
        self._deadline = self._last + 5.0
        try:
            if type(source) is not _EgressSource or self._client is None: raise ValueError()
            self._source, self._data = source, source._data
            self._worker, self._binding = source._worker, source._binding
            self._bridge, self._application = source._bridge, source._application
            self._budget()
            if (client.family != socket.AF_INET or client.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM
                    or client.getsockname()[0] != '127.0.0.1' or client.getpeername()[0] != '127.0.0.1'):
                raise ValueError()
            client.set_inheritable(False)
            client.setblocking(False)
            self._key = bytes.fromhex(self._data['key'])
            app = self._binding['application']
            self._peer = struct.pack('=iII', app['pid'], app['uid'], app['gid'])
            self._nonce = os.urandom(32)
            if type(self._nonce) is not bytes or len(self._nonce) != 32 or self._nonce in (b'\0' * 32, self._key):
                raise ValueError()
            self._outbound = self._frame(1, b'\0' * 32)
            self._hello_tag = self._outbound[-32:]
            self._budget()
            self._stream = _EgressSocket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._budget()
            self._stream.set_inheritable(False)
            self._stream.setblocking(False)
            self._stream.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
            path = source._path()
            self._budget()
            result = self._stream.connect_ex(path)
            self._budget()
            if result not in (0, errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR): raise ValueError()
            if result == 0:
                self._credential()
                self._state = 'hello'
            return self
        except Exception:
            self.close()
            _deny()

    def _clock(self):
        now = time.monotonic()
        if (self._source is None or self._source._data is not self._data or self._worker is None
                or self._worker._binding is not self._binding or self._worker._bridge is not self._bridge
                or self._worker._application is not self._application or self._state == 'closed'
                or not math.isfinite(now) or not math.isfinite(self._last) or now < 0 or now < self._last
                or now >= self._deadline): raise ValueError()
        self._last = now

    def _budget(self):
        self._clock()
        self._source._check()
        self._clock()

    def _credential(self):
        self._budget()
        value = self._stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        self._budget()
        if value != self._peer: raise ValueError()

    def _frame(self, kind, server, transcript=b''):
        data = self._data
        header = _DATA_FRAME.pack(b'HPG1', kind, 3, bytes.fromhex(data['candidate']),
            bytes.fromhex(data['resource']), bytes.fromhex(data['boot']), server, self._nonce, b'\0' * 32)[:-32]
        return header + hmac.new(self._key, _EGRESS_DOMAIN + header + transcript, hashlib.sha256).digest()

    def _receive(self):
        self._credential()
        self._budget()
        data, ancillary, flags, _ = self._stream.recvmsg(_DATA_FRAME.size + 1 - len(self._incoming),
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
        rights, peers, invalid = [], [], False
        try:
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    invalid = True
                    width = array.array('i').itemsize
                    for fd in array.array('i', raw[:len(raw) // width * width]):
                        if fd >= 0 and fd not in rights: rights.append(fd)
                elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS: peers.append(raw)
                else: invalid = True
            self._budget()
            if (invalid or peers != [self._peer] or flags & ~socket.MSG_CMSG_CLOEXEC
                    or type(data) is not bytes or not data or len(self._incoming) + len(data) > _DATA_FRAME.size):
                raise ValueError()
            self._incoming += data
            if len(self._incoming) == _DATA_FRAME.size:
                fields = _DATA_FRAME.unpack(self._incoming)
                server = fields[6]
                if server in (b'\0' * 32, self._nonce) or not hmac.compare_digest(
                        self._incoming, self._frame(2, server, self._hello_tag)): raise ValueError()
                self._outbound = self._frame(3, server, self._incoming[-32:] + self._hello_tag)
                self._incoming, self._state = b'', 'ack'
            self._budget()
        finally:
            failed = False
            while rights:
                try: os.close(rights.pop())
                except Exception: failed = True
            if failed: _deny()

    def advance(self, events):
        try:
            if type(events) is not int or events < 0 or events & ~3 or self._authenticated: raise ValueError()
            self._budget()
            try:
                if self._state == 'connect' and events & selectors.EVENT_WRITE:
                    self._budget()
                    error = self._stream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                    self._budget()
                    if error: raise ValueError()
                    self._credential()
                    self._state = 'hello'
                elif self._state == 'challenge' and events & selectors.EVENT_READ:
                    self._receive()
                elif self._state in ('hello', 'ack') and events & selectors.EVENT_WRITE:
                    self._credential()
                    self._budget()
                    count = self._stream.send(self._outbound)
                    self._budget()
                    if count <= 0 or count > len(self._outbound): raise ValueError()
                    self._outbound = self._outbound[count:]
                    if not self._outbound:
                        if self._state == 'hello': self._state = 'challenge'
                        else:
                            self._authenticated, self._state = True, 'data'
                            return 0
            except BlockingIOError: self._budget()
            return selectors.EVENT_READ if self._state == 'challenge' else selectors.EVENT_WRITE
        except Exception:
            self.close()
            _deny()

    def close(self):
        stream, self._stream = self._stream, None
        client, self._client = self._client, None
        self._authenticated, self._state = False, 'closed'
        self._source = self._data = self._worker = self._binding = self._bridge = self._application = None
        self._key = self._nonce = self._hello_tag = None
        self._incoming = self._outbound = b''
        failed = False
        for owned in (stream, client):
            if owned is not None:
                try: owned.close()
                except Exception: failed = True
        if failed: _deny()


class _DataPeer:
    """Private nonblocking data authentication; not protocol or group readiness."""

    def __init__(self):
        raise TypeError('original anchor owns data peers')

    @classmethod
    def open(cls, worker, stream, kind):
        self = object.__new__(cls)
        self._stream = stream if isinstance(stream, socket.socket) else None
        self._rights, self._authenticated = [], False
        self._relaying = False
        self._worker = self._binding = self._bridge = self._application = None
        self._key = self._server = self._response_tag = None
        self._incoming, self._outbound, self._state = b'', b'', 'closed'
        try:
            if (type(worker) is not _WorkerGuard or self._stream is None
                    or type(kind) is not int or kind not in (1, 2)
                    or worker._binding is None or worker._binding['role'] != 'anchor'
                    or worker._bridge is None or worker._application is None):
                raise ValueError()
            self._worker, self._binding = worker, worker._binding
            self._bridge, self._application = worker._bridge, worker._application
            self._kind, self._state = kind, 'challenge'
            self._last = time.monotonic()
            if not math.isfinite(self._last) or self._last < 0:
                raise ValueError()
            self._deadline = self._last + 5.0
            self._budget()
            if stream.family != socket.AF_UNIX or stream.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM:
                raise ValueError()
            stream.set_inheritable(False)
            stream.setblocking(False)
            stream.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
            app = self._binding['application']
            self._peer = struct.pack('=iII', app['pid'], app['uid'], app['gid'])
            if stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12) != self._peer:
                raise ValueError()
            self._budget()
            self._key = bytes.fromhex(self._binding['dataKey'])
            self._server = os.urandom(32)
            if (type(self._server) is not bytes or len(self._server) != 32 or self._server == b'\0' * 32
                    or self._server.hex() in (self._binding['handshake'], self._binding['dataKey'])):
                raise ValueError()
            self._outbound = self._frame(1, b'\0' * 32)
            self._budget()
            return self
        except Exception:
            self.close()
            _deny()

    def _clock(self):
        now = time.monotonic()
        if (self._stream is None or self._binding is None or self._worker._binding is not self._binding
                or self._worker._bridge is not self._bridge or self._worker._application is not self._application
                or not math.isfinite(now) or now < self._last or now >= self._deadline):
            raise ValueError()
        self._last = now

    def _budget(self):
        self._clock()
        self._worker._check()
        self._clock()
        self._worker._poll_application()
        self._clock()

    def _frame(self, kind, client, transcript=b''):
        binding = self._binding
        header = _DATA_FRAME.pack(b'HPD1', kind, self._kind, bytes.fromhex(binding['candidate']),
            bytes.fromhex(binding['resource']), bytes.fromhex(binding['application']['boot']),
            self._server, client, b'\0' * 32)[:-32]
        return header + hmac.new(self._key, _DATA_DOMAIN + header + transcript, hashlib.sha256).digest()

    def _send(self):
        self._budget()
        count = self._stream.sendmsg([self._outbound])
        if count != len(self._outbound):
            raise ValueError()
        self._budget()

    def _receive(self):
        self._budget()
        data, ancillary, flags, _address = self._stream.recvmsg(_DATA_FRAME.size + 1 - len(self._incoming),
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
        peers, invalid = [], False
        for level, kind, raw in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                invalid = True
                width = array.array('i').itemsize
                for fd in array.array('i', raw[:len(raw) // width * width]):
                    if fd >= 0 and fd not in self._rights: self._rights.append(fd)
            elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS:
                peers.append(raw)
            else:
                invalid = True
        if (invalid or peers != [self._peer] or flags & ~socket.MSG_CMSG_CLOEXEC
                or type(data) is not bytes or not data or len(self._incoming) + len(data) > _DATA_FRAME.size):
            raise ValueError()
        self._budget()
        self._incoming += data
        if len(self._incoming) == _DATA_FRAME.size:
            fields = _DATA_FRAME.unpack(self._incoming)
            client = fields[7]
            if (client == b'\0' * 32 or client == self._server
                    or not hmac.compare_digest(self._incoming, self._frame(2, client))):
                raise ValueError()
            self._response_tag = self._incoming[-32:]
            self._outbound = self._frame(3, client, self._response_tag)
            self._incoming, self._state = b'', 'ack'
        self._budget()

    def advance(self, events):
        try:
            if type(events) is not int or events & ~3 or events < 0 or self._authenticated:
                raise ValueError()
            self._budget()
            try:
                if self._state in ('challenge', 'ack') and events & selectors.EVENT_WRITE:
                    self._send()
                    if self._state == 'challenge':
                        self._state = 'response'
                    else:
                        self._authenticated, self._state = True, 'data'
                        return 0
                elif self._state == 'response' and events & selectors.EVENT_READ:
                    self._receive()
            except BlockingIOError:
                self._budget()
            return selectors.EVENT_READ if self._state == 'response' else selectors.EVENT_WRITE
        except Exception:
            self.close()
            _deny()

    def close(self):
        stream, self._stream = self._stream, None
        self._authenticated, self._state = False, 'closed'
        self._worker = self._binding = self._bridge = self._application = None
        self._key = self._server = self._response_tag = None
        self._incoming, self._outbound = b'', b''
        failed = False
        if stream is not None:
            try: stream.close()
            except Exception: failed = True
        while self._rights:
            try: os.close(self._rights.pop())
            except Exception: failed = True
        if failed: _deny()


class _DataRelay:
    """One bounded, nonblocking, authenticated connection; never group readiness."""

    def __init__(self):
        raise TypeError('original authenticated peer required')

    @classmethod
    def open(cls, peer):
        return cls._open(peer, False)

    @classmethod
    def open_egress(cls, peer):
        return cls._open(peer, True)

    @classmethod
    def _open(cls, peer, egress):
        self = object.__new__(cls)
        self._peer = self._target = None
        self._source = self._source_data = None
        self._finished = False
        self._to_app = self._to_target = b''
        self._app_deadline = self._target_deadline = None
        self._app_eof = self._target_eof = self._app_shutdown = self._target_shutdown = False
        try:
            if (type(peer) is not (_EgressPeer if egress else _DataPeer)
                    or not peer._authenticated or peer._state != 'data' or peer._relaying):
                raise ValueError()
            self._peer, peer._relaying = peer, True
            self._last = time.monotonic()
            self._connecting, self._connect_deadline = not egress, self._last + 5.0
            if egress:
                self._source, self._source_data = peer._source, peer._data
                self._check()
                if peer._client is None: raise ValueError()
                self._target, peer._client = peer._client, None
                self._check()
                return self
            self._check()
            self._target = _RelaySocket(socket.AF_INET, socket.SOCK_STREAM)
            self._target.set_inheritable(False)
            self._target.setblocking(False)
            self._check()
            result = self._target.connect_ex(('127.0.0.1', 19222 if peer._kind == 1 else 16080))
            if result not in (0, errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR):
                raise ValueError()
            self._check()
            if result == 0: self._connecting = False
            return self
        except Exception:
            self.close()
            _deny()

    def _clock(self):
        now = time.monotonic()
        peer = self._peer
        if (peer is None or not peer._authenticated or not peer._relaying or peer._state != 'data'
                or peer._worker is None or peer._worker._binding is not peer._binding
                or peer._worker._bridge is not peer._bridge or peer._worker._application is not peer._application
                or (type(peer) is _EgressPeer and (peer._source is not self._source
                    or self._source is None or self._source._data is not self._source_data))
                or not math.isfinite(now) or now < 0 or now < self._last
                or (self._connecting and now >= self._connect_deadline)
                or (self._app_deadline is not None and now >= self._app_deadline)
                or (self._target_deadline is not None and now >= self._target_deadline)):
            raise ValueError()
        self._last = now

    def _check(self):
        self._clock()
        if self._source is not None:
            self._source._check()
            self._clock()
        self._peer._worker._check()
        self._clock()
        self._peer._worker._poll_application()
        self._clock()

    def interests(self):
        try:
            self._check()
            if self._connecting: return {'app': 0, 'target': selectors.EVENT_WRITE}
            return {
                'app': (selectors.EVENT_READ if not self._app_eof and len(self._to_target) < 65536 else 0)
                       | (selectors.EVENT_WRITE if self._to_app else 0),
                'target': (selectors.EVENT_READ if not self._target_eof and len(self._to_app) < 65536 else 0)
                          | (selectors.EVENT_WRITE if self._to_target else 0),
            }
        except Exception:
            self.close()
            _deny()

    def _read_app(self):
        peer = self._peer
        data, ancillary, flags, _address = peer._stream.recvmsg(65536 - len(self._to_target),
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12), socket.MSG_CMSG_CLOEXEC)
        peers, rights, invalid = [], [], False
        try:
            # Returned rights belong to this call even if close() ran inside recvmsg.
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    invalid = True
                    width = array.array('i').itemsize
                    for fd in array.array('i', raw[:len(raw) // width * width]):
                        if fd >= 0 and fd not in rights: rights.append(fd)
                elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS:
                    peers.append(raw)
                else: invalid = True
            # EOF may carry no credentials on Linux, never uncredentialed bytes.
            if (invalid or self._peer is not peer or flags & ~socket.MSG_CMSG_CLOEXEC or type(data) is not bytes
                    or (peers != [peer._peer] and not (not data and peers == []))):
                raise ValueError()
            return data
        finally:
            failed = False
            while rights:
                try: os.close(rights.pop())
                except Exception: failed = True
            if failed: _deny()

    def _transfer(self, side, event):
        source = self._peer._stream if side == 'app' else self._target
        if event == selectors.EVENT_READ:
            queue = '_to_target' if side == 'app' else '_to_app'
            deadline = '_target_deadline' if side == 'app' else '_app_deadline'
            original = self._last
            data = self._read_app() if side == 'app' else source.recv(65536 - len(self._to_app))
            if data and not getattr(self, queue): setattr(self, deadline, original + 30.0)
            self._check()
            if not data: setattr(self, '_' + side + '_eof', True)
            else:
                setattr(self, queue, getattr(self, queue) + data)
        else:
            queue = '_to_app' if side == 'app' else '_to_target'
            data = getattr(self, queue)
            count = source.send(data)
            self._check()
            if count <= 0 or count > len(data): raise ValueError()
            setattr(self, queue, data[count:])
            if count == len(data): setattr(self, '_' + side + '_deadline', None)

    def _drain(self):
        for source, destination, stream, queue in (
                ('app', 'target', self._target, self._to_target),
                ('target', 'app', self._peer._stream, self._to_app)):
            if getattr(self, '_' + source + '_eof') and not queue and not getattr(self, '_' + destination + '_shutdown'):
                self._check()
                stream.shutdown(socket.SHUT_WR)
                self._check()
                setattr(self, '_' + destination + '_shutdown', True)
        if self._app_eof and self._target_eof and not self._to_app and not self._to_target:
            self.close()
            self._finished = True

    def advance(self, side, events):
        try:
            if side not in ('app', 'target') or type(events) is not int or events < 0 or events & ~3:
                raise ValueError()
            self._check()
            if self._connecting:
                if side == 'target' and events & selectors.EVENT_WRITE:
                    error = self._target.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                    self._check()
                    if error != 0: raise ValueError()
                    self._connecting = False
                return
            for event in (selectors.EVENT_READ, selectors.EVENT_WRITE):
                if events & event and self.interests()[side] & event:
                    self._check()
                    try: self._transfer(side, event)
                    except BlockingIOError: self._check()
            self._drain()
        except Exception:
            self.close()
            _deny()

    def close(self):
        peer, self._peer = self._peer, None
        target, self._target = self._target, None
        self._source = self._source_data = None
        self._to_app = self._to_target = b''
        self._app_deadline = self._target_deadline = None
        failed = False
        for owned in (target, peer):
            if owned is not None:
                try: owned.close()
                except Exception: failed = True
        if failed: _deny()


class _AnchorBridge:
    """Bounded selector over the original HPB1 objects."""

    def __init__(self):
        raise TypeError('original anchor guard required')

    @classmethod
    def open(cls, worker):
        self = object.__new__(cls)
        self._worker = self._binding = self._bridge = self._application = self._selector = None
        self._listeners, self._connections, self._registered = [], {}, {}
        self._egress = self._egress_data = self._pending_egress = None
        self._egress_attempted = False
        self._control, self._control_attempted, self._control_done = None, False, False
        try:
            if (type(worker) is not _WorkerGuard or worker._binding is None
                    or worker._binding['role'] != 'anchor' or worker._bridge is None
                    or worker._application is None or getattr(worker, '_data_bridge_active', False)):
                raise ValueError()
            worker._data_bridge_active = True
            self._worker, self._binding = worker, worker._binding
            self._bridge, self._application = worker._bridge, worker._application
            self._check()
            self._selector = selectors.DefaultSelector()
            for index, original in enumerate(self._bridge):
                copied = os.dup(original)
                try:
                    stream = _ListenerSocket(fileno=copied)
                except Exception:
                    os.close(copied)
                    raise
                self._listeners.append((stream, original, None, index + 1))
                identity = _pair(os.fstat(original))
                self._listeners[-1] = (stream, original, identity, index + 1)
                stream.set_inheritable(False)
                stream.setblocking(False)
                self._check()
            self._sync()
            return self
        except Exception:
            self.close()
            _deny()

    def _attach_egress(self, source):
        # Reject duplicate/foreign sources before changing an existing live owner.
        if (self._egress_attempted or self._connections or type(source) is not _EgressSource
                or self._worker is None or source._worker is not self._worker
                or source._binding is not self._binding or source._bridge is not self._bridge
                or source._application is not self._application): _deny()
        self._egress_attempted, self._egress = True, source
        self._egress_data = source._data
        last = time.monotonic()
        deadline = last + 5.0
        def budget():
            nonlocal last
            for check in (lambda: None, self._check):
                check()
                now = time.monotonic()
                if not math.isfinite(now) or not math.isfinite(last) or now < 0 or now < last or now >= deadline:
                    raise ValueError()
                last = now
                self._veto()
        try:
            budget()
            self._pending_egress = _EgressListenerSocket(socket.AF_INET, socket.SOCK_STREAM)
            budget()
            stream = self._pending_egress
            stream.set_inheritable(False)
            stream.setblocking(False)
            budget()
            stream.bind(('127.0.0.1', 18080))
            budget()
            stream.listen(64)
            budget()
            original = stream.fileno()
            identity = _pair(os.fstat(original))
            budget()
            self._listeners.append((stream, original, identity, 3))
            self._pending_egress = None
            budget()
            self._sync()
            budget()
        except Exception:
            self.close()
            _deny()

    def _attach_control(self):
        if self._control_attempted or self._connections or self._egress is None: _deny()
        self._control_attempted = True
        try:
            self._check()
            self._control = _ProbeControl.open(self._egress, scope_guard=self._veto)
            self._check()
            self._sync()
            self._check()
        except Exception:
            self.close()
            _deny()

    def _veto(self):
        if (self._worker is None or self._worker._binding is not self._binding
                or self._worker._bridge is not self._bridge or self._worker._application is not self._application):
            raise ValueError()
        source = self._egress
        if self._egress_attempted and (source is None or source._closed or source._data is not self._egress_data
                or source._worker is not self._worker or source._binding is not self._binding
                or source._bridge is not self._bridge or source._application is not self._application):
            raise ValueError()
        if self._control is not None:
            if type(self._control) is not _ProbeControl or self._control._source is not source: raise ValueError()
            self._control._veto()

    def _check(self):
        self._veto()
        self._worker._check()
        if self._egress is not None:
            if self._egress._worker is not self._worker or self._egress._binding is not self._binding: raise ValueError()
            self._egress._check()
        for stream, original, identity, kind in self._listeners:
            info = os.fstat(original)
            if (not stat.S_ISSOCK(info.st_mode) or _pair(info) != identity
                    or _pair(os.fstat(stream.fileno())) != identity or stream.get_inheritable()
                    or stream.getblocking()):
                raise ValueError()
            if kind == 3:
                if (self._egress is None or stream.family != socket.AF_INET
                        or stream.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM
                        or stream.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) != 1
                        or stream.getsockname() != ('127.0.0.1', 18080)): raise ValueError()
            elif _bridge_socket_info(original) != (socket.AF_UNIX, socket.SOCK_STREAM, 1,
                    '/run/holaday-pool-data/' + self._binding['resource'] + '/' + ('cdp.sock' if kind == 1 else 'vnc.sock')):
                raise ValueError()
        self._worker._poll_application()
        self._veto()
        if self._control is not None and not self._control._finished:
            self._control._clock()
        self._veto()

    def _drop(self, key):
        owner = self._connections.pop(key, None)
        if owner is not None: owner.close()

    def _sync(self):
        desired = {}
        if self._control is not None:
            control = self._control
            if control._finished:
                self._control = None
                control.close()
                self._check()
                self._control_done = True
            else:
                control.advance('tick', 0)
                for side, events in control.interests().items():
                    stream = control._stream if side == 'control' else control._probe._stream
                    desired[stream.fileno()] = (stream, events, ('control', side))
        for stream, _original, _identity, kind in self._listeners:
            desired[stream.fileno()] = (stream, selectors.EVENT_READ, ('listener', kind))
        for key, owner in list(self._connections.items()):
            try:
                if type(owner) in (_DataPeer, _EgressPeer):
                    events = owner.advance(0)
                    desired[owner._stream.fileno()] = (owner._stream, events, ('auth', key))
                else:
                    if owner._finished:
                        self._drop(key)
                        continue
                    for side, events in owner.interests().items():
                        if events:
                            stream = owner._peer._stream if side == 'app' else owner._target
                            desired[stream.fileno()] = (stream, events, (side, key))
            except Exception:
                self._drop(key)
                self._check()  # A client timeout is local; original guard death is not.
        for fd, previous in list(self._registered.items()):
            current = desired.get(fd)
            if current is None or current[0] is not previous[0]:
                self._selector.unregister(fd)
                del self._registered[fd]
        for fd, current in desired.items():
            previous = self._registered.get(fd)
            if previous is None:
                self._selector.register(current[0], current[1], current[2])
            elif current[1:] != previous[1:]:
                self._selector.modify(current[0], current[1], current[2])
            self._registered[fd] = current

    def _accept(self, stream, kind):
        accepted = None
        try:
            self._check()
            try: accepted, _address = stream.accept()
            except BlockingIOError: return
            self._check()
            if len(self._connections) >= 64: return
            original, accepted = accepted, None  # Factory owns even a failed handshake.
            try:
                peer = (_EgressPeer.open(self._egress, original) if kind == 3
                        else _DataPeer.open(self._worker, original, kind))
            except Exception:
                self._check()
                return
            self._connections[peer] = peer
        finally:
            if accepted is not None: accepted.close()

    def tick(self):
        try:
            self._check()
            self._sync()  # Check idle clients' deadlines, not only ready sockets.
            events = self._selector.select(0.1)
            self._check()
            for selected, mask in events:
                action, key = selected.data
                if action == 'listener':
                    self._accept(selected.fileobj, key)
                elif action == 'control':
                    if self._control is not None: self._control.advance(key, mask)
                else:
                    owner = self._connections.get(key)
                    if owner is None: continue
                    try:
                        if action == 'auth':
                            owner.advance(mask)
                            if owner._authenticated:
                                self._connections[key] = (_DataRelay.open_egress(owner) if type(owner) is _EgressPeer
                                                          else _DataRelay.open(owner))
                        else: owner.advance(action, mask)
                    except Exception:
                        self._drop(key)
                        self._check()
                self._check()
            self._sync()
            self._check()
        except Exception:
            self.close()
            _deny()

    def close(self):
        owners = list(self._connections.values()) + [entry[0] for entry in self._listeners]
        if self._control is not None: owners.insert(0, self._control)
        if self._pending_egress is not None: owners.append(self._pending_egress)
        if self._egress is not None: owners.append(self._egress)
        if self._selector is not None: owners.append(self._selector)
        self._connections, self._listeners, self._registered = {}, [], {}
        self._egress = self._egress_data = self._pending_egress = None
        self._control = None
        self._worker = self._binding = self._bridge = self._application = self._selector = None
        failed = False
        for owner in owners:
            try: owner.close()
            except Exception: failed = True
        if failed: _deny()


def main():
    """Fixed rootfs entry only. Failure is silent/nonzero; never retries a grant."""
    worker = engine = pending_source = None
    try:
        if (__file__ != '/quartet_worker_guard.py' or type(sys.argv) is not list
                or len(sys.argv) != 4 or sys.argv[0] != __file__): raise ValueError()
        _, candidate, resource, role = sys.argv
        _hex(candidate, 40)
        _hex(resource, 32)
        if type(role) is not str or role not in _ROLES: raise ValueError()
        worker = _WorkerGuard.open(candidate, resource, role)
        if role != 'anchor':
            worker._execute()
            raise ValueError()  # A real successful exec never returns.
        worker._receive_bridge()  # Owns the original HPW1 grant and HPB1 transfer.
        pending_source = _EgressSource.open(worker)
        engine = _AnchorBridge.open(worker)
        engine._attach_egress(pending_source)
        pending_source = None  # The original engine now owns this source.
        engine._attach_control()
        while True:
            engine.tick()
    except Exception:
        return 1
    finally:
        # Continue cleanup after any individual close failure; exit stays failed.
        for owner in (engine, pending_source, worker):
            if owner is not None:
                try: owner.close()
                except Exception: pass


if __name__ == '__main__':
    sys.exit(main())
