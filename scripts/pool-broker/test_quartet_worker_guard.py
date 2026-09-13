"""Real guard/file lifetime tests; only Linux kernel boundaries are synthetic.

No process is launched and no host account, namespace or mount is changed.
"""

import array
import contextlib
import copy
import json
import os
from pathlib import Path
import socket
import stat
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

try:
    import quartet_worker_guard as guard
except ModuleNotFoundError as error:
    if error.name != 'quartet_worker_guard':
        raise
    guard = None


NATIVE = SimpleNamespace(**{key: getattr(os, key) for key in dir(os)})
CANDIDATE, RESOURCE = 'a' * 40, 'b' * 32
STATUS = b'''Uid: 2001 2001 2001 2001
Gid: 2001 2001 2001 2001
Groups:
CapInh: 0000000000000000
CapPrm: 0000000000000000
CapEff: 0000000000000000
CapBnd: 0000000000000000
CapAmb: 0000000000000000
NoNewPrivs: 1
Threads: 1
TracerPid: 0
'''


class WorkerGuardTests(unittest.TestCase):
    def test_shared_work_directories_allow_child_creation_but_not_replacement_or_permissions(self):
        for path in ('tmp', 'dev/shm'):
            with self.subTest(path=path), self.system() as s:
                with guard._WorkerGuard.open(s.binding['candidate'], s.binding['resource'], 'anchor') as worker:
                    directory = s.root / path
                    before = directory.stat().st_nlink
                    (directory / 'synthetic-child').mkdir()
                    self.assertNotEqual(directory.stat().st_nlink, before)
                    worker._check()
                    s.metadata['/' + path] = {'st_mode': stat.S_IFDIR | 0o777}
                    with self.assertRaises(ValueError): worker._check()
            with self.subTest(path=path, replacement=True), self.system() as s:
                with guard._WorkerGuard.open(s.binding['candidate'], s.binding['resource'], 'anchor') as worker:
                    directory = s.root / path
                    directory.rename(directory.with_name('retired'))
                    directory.mkdir()
                    with self.assertRaises(ValueError): worker._check()

    @contextlib.contextmanager
    def system(self, role='anchor'):
        self.assertIsNotNone(guard, 'quartet worker pre-work guard missing')
        with tempfile.TemporaryDirectory() as temp, contextlib.ExitStack() as stack:
            root = Path(temp)
            credential = '/run/credentials/holaday-pool-' + role + '-' + RESOURCE + '.service/binding'
            for part in ('run/credentials', 'run/holaday-pool', 'tmp', 'dev/shm', 'proc/self/ns'):
                (root / part).mkdir(parents=True, exist_ok=True)
            file = root / credential[1:]
            file.parent.mkdir()
            (root / 'proc/self/status').write_bytes(STATUS)
            for name in ('net', 'ipc', 'mnt', 'pid'):
                (root / ('proc/self/ns/' + name)).write_bytes(b'kernel namespace stand-in')
            (root / 'proc/self/status').write_bytes(STATUS + ('Pid: %d\n' % os.getpid()).encode())
            (root / 'proc/self/fdinfo').mkdir()
            # A real leaf inode, with its Linux socket mode supplied at the OS seam.
            (root / 'run/holaday-pool/control.sock').write_bytes(b'')
            pair = lambda p: [p.stat().st_dev, p.stat().st_ino]
            binding = {'version': 1, 'candidate': CANDIDATE, 'resource': RESOURCE, 'role': role,
                       'slot': 0, 'uid': 2001, 'gid': 2001, 'brokerPid': 456,
                       'handshake': 'c' * 64,
                       'hostNamespaces': {'net': [99, 1], 'ipc': [99, 2], 'mnt': [99, 3]},
                       'groupNamespaces': None if role == 'anchor' else {'net': [99, 10], 'ipc': [99, 20]},
                       'objects': {'root': pair(root), 'tmp': pair(root / 'tmp'), 'shm': pair(root / 'dev/shm')}}
            if role == 'anchor':
                binding['dataKey'] = 'e' * 64
                binding['application'] = {'pid': 123, 'uid': 998, 'gid': 998,
                                          'boot': 'b' * 32, 'pidNamespace': [99, 40]}
            state = SimpleNamespace(binding=binding, raw=None, file=file, root=root, opened={},
                                    credential=credential, namespaces={'net': [99, 10], 'ipc': [99, 20], 'mnt': [99, 30], 'pid': [99, 40]},
                                    flags={}, metadata={}, attrs={}, attr_values={}, groups=[],
                                    uid=(2001, 2001, 2001), gid=(2001, 2001, 2001), now=1.0,
                                    socket_created=0, packets=[], sent=[], timeouts=[], channels=[], closed=[],
                                    peer=struct.pack('=iII', 456, 0, 0), interfaces=[(1, 'lo')],
                                    hook=lambda event: None, events=[], app_fds=[], app_writers=[], app_info=None)
            proxy = SimpleNamespace(**vars(NATIVE))

            def opened(path, flags, *, dir_fd=None):
                if dir_fd is not None:
                    relative = state.opened[dir_fd].rstrip('/') + '/' + path
                else:
                    relative = path
                if flags & 0x200000 and not hasattr(NATIVE, 'O_PATH'):
                    self.assertEqual(relative, '/run/holaday-pool')
                    flags &= ~0x200000  # Only the fixed Linux O_PATH control-directory seam.
                resolved = root / relative.lstrip('/')
                if relative == credential:
                    file.write_bytes(state.raw if state.raw is not None else json.dumps(binding).encode())
                if relative.startswith('/proc/self/fdinfo/'):
                    target = int(relative.rsplit('/', 1)[1])
                    if target not in state.app_fds:
                        raise AssertionError('unknown application descriptor')
                    resolved.write_bytes(state.app_info if state.app_info is not None
                                         else ('Pid:\t%d\n' % binding['application']['pid']).encode())
                fd = NATIVE.open(str(resolved), flags)
                state.opened[fd] = relative
                return fd

            def fstat(fd):
                actual = NATIVE.fstat(fd)
                path = state.opened[fd]
                values = {key: getattr(actual, key) for key in dir(actual) if key.startswith('st_')}
                values.update(st_uid=0, st_gid=0)
                if path in ('/tmp', '/dev/shm'):
                    values.update(st_uid=2001, st_gid=2001, st_mode=stat.S_IFDIR | 0o700)
                elif path == credential:
                    values.update(st_mode=stat.S_IFREG | 0o400, st_uid=2001)
                elif path == credential.rsplit('/', 1)[0]:
                    values.update(st_mode=stat.S_IFDIR | 0o500, st_uid=2001)
                elif path.endswith('/control.sock'):
                    values.update(st_mode=stat.S_IFSOCK | 0o660, st_gid=2001)
                elif stat.S_ISDIR(actual.st_mode):
                    values.update(st_mode=stat.S_IFDIR | 0o755)
                if '/proc/self/ns/' in path:
                    values.update(zip(('st_dev', 'st_ino'), state.namespaces[path.rsplit('/', 1)[1]]))
                values.update(state.metadata.get(path, {}))
                state.hook('fstat')
                return SimpleNamespace(**values)

            def close(fd):
                self.assertIn(fd, state.opened, 'a descriptor may be closed only once')
                state.closed.append(state.opened.pop(fd))
                NATIVE.close(fd)

            def ioctl(fd, request):
                self.assertEqual(request, 0xb703)  # Linux NS_GET_NSTYPE
                return {'net': 0x40000000, 'ipc': 0x08000000, 'mnt': 0x00020000,
                        'pid': 0x20000000}[state.opened[fd].rsplit('/', 1)[1]]

            def stat_at(path, *, dir_fd, follow_symlinks):
                self.assertFalse(follow_symlinks)
                relative = state.opened[dir_fd].rstrip('/') + '/' + path
                fd = opened(relative, NATIVE.O_RDONLY | NATIVE.O_CLOEXEC | NATIVE.O_NOFOLLOW)
                try:
                    return fstat(fd)
                finally:
                    close(fd)

            def flags(fd):
                path = state.opened[fd]
                default = 14 if path in ('/tmp', '/dev/shm') else 15
                return SimpleNamespace(f_flag=state.flags.get(path, default))

            proxy.open, proxy.close, proxy.fstat, proxy.stat = opened, close, fstat, stat_at
            proxy.getresuid, proxy.getresgid, proxy.getgroups = lambda: state.uid, lambda: state.gid, lambda: state.groups
            proxy.fstatvfs = flags
            def attrs(fd):
                if type(fd) is str and fd.startswith('/proc/self/fd/'):
                    fd = int(fd.rsplit('/', 1)[1])
                    self.assertEqual(state.opened[fd], '/run/holaday-pool')
                return state.attrs.get(state.opened[fd], [])
            proxy.listxattr = attrs
            proxy.getxattr = lambda fd, key: state.attr_values[(state.opened[fd], key)]
            def pidfd_open(pid, flags):
                self.assertEqual((pid, flags), (binding['application']['pid'], 0))
                read, write = NATIVE.pipe()
                state.opened[read] = '<application-pidfd>'
                state.app_fds.append(read)
                state.app_writers.append(write)
                state.events.append(('application-reference', state.now))
                state.hook('pidfd_open')
                return read
            proxy.pidfd_open = pidfd_open

            class Channel:
                def __init__(self, family, kind):
                    self.family, self.kind, self.closed = family, kind, False
                    state.socket_created += 1
                    state.channels.append(self)
                def set_inheritable(self, value):
                    self.assert_value = value
                    if value:
                        raise AssertionError('inheritable channel')
                def setsockopt(self, level, option, value):
                    if (level, option, value) != (socket.SOL_SOCKET, 16, 1):
                        raise AssertionError('unexpected socket option')
                def settimeout(self, value):
                    state.timeouts.append(value)
                    state.hook('settimeout')
                def connect(self, path):
                    prefix, suffix = '/proc/self/fd/', '/control.sock'
                    if (not path.startswith(prefix) or not path.endswith(suffix)
                            or state.opened.get(int(path[len(prefix):-len(suffix)])) != '/run/holaday-pool'):
                        raise AssertionError('unexpected endpoint')
                    state.events.append(('connect', state.now))
                    state.hook('connect')
                def getsockopt(self, level, option, size):
                    return state.peer
                def sendmsg(self, buffers):
                    state.events.append(('send', state.now))
                    state.hook('send')
                    state.sent.append(b''.join(buffers))
                    return len(state.sent[-1])
                def recvmsg(self, size, space, flags):
                    state.events.append(('recv', state.now))
                    state.hook('recv')
                    packet = state.packets.pop(0)
                    return packet() if callable(packet) else packet
                def close(self):
                    if self.closed:
                        raise AssertionError('channel closed twice')
                    self.closed = True
                    state.hook('close')

            for obj, name, value in ((guard, 'os', proxy), (guard.sys, 'platform', 'linux'),
                                     (guard.sys, 'flags', SimpleNamespace(isolated=1, no_site=1, ignore_environment=1)),
                                     (guard.sys, 'executable', '/usr/bin/python3'),
                                     (guard.fcntl, 'ioctl', ioctl), (guard, 'Socket', Channel),
                                     (guard.time, 'monotonic', lambda: state.now),
                                     (guard.socket, 'if_nameindex', lambda: state.interfaces),
                                     (guard.socket, 'SO_PASSCRED', 16), (guard.socket, 'SO_PEERCRED', 17),
                                     (guard.socket, 'SCM_CREDENTIALS', 2), (guard.socket, 'MSG_CMSG_CLOEXEC', 0x40000000)):
                stack.enter_context(patch.object(obj, name, value, create=True))
            try:
                yield state
            finally:
                for fd in state.app_writers:
                    NATIVE.close(fd)
                self.assertEqual(state.opened, {}, 'guard must dispose every original descriptor')
                self.assertTrue(all(c.closed for c in state.channels))

    def open(self, role='anchor'):
        return guard._WorkerGuard.open(CANDIDATE, RESOURCE, role)

    def deny(self, fn):
        with self.assertRaises(ValueError) as caught:
            fn()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_WORKER_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def packet(self, s, kind, nonce='d' * 64):
        return (('HPW1 ' + kind + ' ' + nonce).encode(),
                [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.peer)], 0, None)

    def test_real_files_guard_holds_original_objects_and_no_public_ready(self):
        for role in ('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify'):
            with self.system(role) as s:
                with self.open(role) as worker:
                    worker._check()
                    self.assertGreaterEqual(len(s.opened), 7)
                    self.assertFalse(hasattr(worker, 'ready'))
                    self.assertNotIn(RESOURCE, repr(worker))
                    self.assertEqual(s.socket_created, 0)

    def test_closed_schema_rejects_before_endpoint(self):
        with self.system() as s:
            original = copy.deepcopy(s.binding)
            variants = [dict(original, **change) for change in (
                {'version': True}, {'uid': 998}, {'gid': 0}, {'slot': True}, {'slot': 32},
                {'brokerPid': True}, {'candidate': 'f' * 40}, {'role': 'brave'},
                {'argv': ['/bin/sh']}, {'groupNamespaces': {'net': [99, 10], 'ipc': [99, 20]}},
                {'handshake': '0' * 64}, {'objects': original['objects'] | {'other': [1, 2]}})]
            for value in variants:
                s.raw = json.dumps(value).encode()
                self.deny(self.open)
            for raw in (b'', b' ' * 8193, b'{}', b'\xff', b'\xef\xbb\xbf' + json.dumps(original).encode(),
                        json.dumps(original).encode().replace(b'"version": 1', b'"version": 1, "version": 1')):
                s.raw = raw
                self.deny(self.open)
            self.assertEqual(s.socket_created, 0)

    def test_readonly_credentials_no_symlinks_and_no_write_acl(self):
        with self.system() as s:
            for path, changes in ((s.credential, {'st_mode': stat.S_IFREG | 0o600}),
                                  (s.credential, {'st_uid': 998}),
                                  (s.credential, {'st_nlink': 2}),
                                  ('/run/credentials', {'st_mode': stat.S_IFDIR | 0o777})):
                s.metadata[path] = changes
                self.deny(self.open)
                s.metadata.clear()
            s.flags[s.credential] = 14
            self.deny(self.open)
            s.flags.clear()
            s.attrs[s.credential] = ['security.capability']
            self.deny(self.open)
            s.attrs.clear()
            target = s.file.parent / 'other'
            target.write_bytes(json.dumps(s.binding).encode())
            s.file.unlink()
            s.file.symlink_to(target)
            self.deny(self.open)

    def test_systemd_exact_readonly_uid_acl_or_readonly_uid_ownership_supported(self):
        with self.system() as s:
            acl = lambda entries: struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *row) for row in entries)
            entries = [(1, 4, 0xffffffff), (2, 4, 2001), (4, 0, 0xffffffff), (16, 4, 0xffffffff), (32, 0, 0xffffffff)]
            s.attrs[s.credential] = ['system.posix_acl_access']
            s.attr_values[(s.credential, 'system.posix_acl_access')] = acl(entries)
            s.metadata[s.credential] = {'st_mode': stat.S_IFREG | 0o440, 'st_uid': 0}
            directory = s.credential.rsplit('/', 1)[0]
            directory_entries = [(tag, 5 if permission == 4 else permission, identity) for tag, permission, identity in entries]
            s.attrs[directory] = ['system.posix_acl_access']
            s.attr_values[(directory, 'system.posix_acl_access')] = acl(directory_entries)
            s.metadata[directory] = {'st_mode': stat.S_IFDIR | 0o550, 'st_uid': 0}
            with self.open():
                pass
            for changes in ([(2, 6, 2001)], [(2, 4, 2002)], [(8, 4, 2001)]):
                s.attr_values[(s.credential, 'system.posix_acl_access')] = acl(entries[:1] + changes + entries[2:])
                self.deny(self.open)
            s.attrs.clear()
            s.metadata.clear()
            s.metadata[s.credential] = {'st_mode': stat.S_IFREG | 0o400, 'st_uid': 2001}
            with self.open():
                pass

    def test_identity_capabilities_status_and_network_fail_closed(self):
        with self.system() as s:
            for name, value in (('uid', (0, 2001, 2001)), ('gid', (2001, 0, 2001)),
                                ('groups', [998]), ('interfaces', [(1, 'lo'), (2, 'eth0')])):
                before = getattr(s, name)
                setattr(s, name, value)
                self.deny(self.open)
                setattr(s, name, before)
            for raw in (STATUS.replace(b'NoNewPrivs: 1', b'NoNewPrivs: 0'),
                        STATUS.replace(b'CapBnd: 0000000000000000', b'CapBnd: 0000000000000001'),
                        STATUS + b'Uid: 2001 2001 2001 2001\n', b'x' * 65537):
                (s.root / 'proc/self/status').write_bytes(raw)
                self.deny(self.open)

    def test_degraded_or_other_group_namespaces_and_objects_refused(self):
        with self.system('brave') as s:
            for name in ('net', 'ipc', 'mnt'):
                original = s.namespaces[name]
                s.namespaces[name] = s.binding['hostNamespaces'][name]
                self.deny(lambda: self.open('brave'))
                s.namespaces[name] = original
            s.namespaces['ipc'] = [99, 333]
            self.deny(lambda: self.open('brave'))
            s.namespaces['ipc'] = [99, 20]
            for path in ('/', '/tmp', '/dev/shm'):
                s.metadata[path] = {'st_ino': 999999}
                self.deny(lambda: self.open('brave'))
                s.metadata.clear()
            for path, flags in (('/', 14), ('/tmp', 6), ('/dev/shm', 12)):
                s.flags[path] = flags
                self.deny(lambda: self.open('brave'))
                s.flags.clear()

    def test_original_objects_rechecked_and_closed_guard_cannot_reuse(self):
        with self.system() as s:
            worker = self.open()
            s.namespaces['net'] = [99, 11]
            self.deny(worker._check)
            worker.close()
            worker.close()
            self.deny(worker._check)

    def test_fresh_challenge_reply_and_grant_once_no_ready_or_exec(self):
        with self.system() as s:
            s.packets = [self.packet(s, 'challenge'), self.packet(s, 'grant')]
            with self.open() as worker:
                self.assertIsNone(worker._await_grant())
                self.assertEqual(s.sent, [('HPW1 hello ' + RESOURCE + ' anchor ' + 'c' * 64).encode(),
                                          ('HPW1 response ' + 'd' * 64).encode()])
                self.assertTrue(all(0 < t <= 5 for t in s.timeouts))
                self.deny(worker._await_grant)
            self.assertEqual(s.socket_created, 1)

    def test_bad_root_peer_nonce_and_truncation_no_second_exchange(self):
        for mode in ('peer', 'nonce', 'direct-grant', 'truncated', 'credential', 'deadline'):
            with self.system() as s:
                s.packets = [self.packet(s, 'challenge'), self.packet(s, 'grant')]
                if mode == 'peer':
                    s.peer = struct.pack('=iII', 789, 0, 0)
                elif mode == 'nonce':
                    s.packets[1] = self.packet(s, 'grant', 'e' * 64)
                elif mode == 'direct-grant':
                    s.packets[0] = self.packet(s, 'grant')
                elif mode == 'truncated':
                    p = s.packets[0]
                    s.packets[0] = (p[0], p[1], socket.MSG_TRUNC, None)
                elif mode == 'credential':
                    p = s.packets[1]
                    s.packets[1] = (p[0], [], 0, None)
                elif mode == 'deadline':
                    p = s.packets[0]
                    def expired():
                        s.now += 6
                        return p
                    s.packets[0] = expired
                with self.open() as worker:
                    self.deny(worker._await_grant)
                    self.deny(worker._await_grant)
                self.assertEqual(s.socket_created, 1)

    def test_smuggled_fds_closed_even_on_truncated_packet(self):
        with self.system() as s:
            fd = guard.os.open('/tmp', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            p = self.packet(s, 'challenge')
            s.packets = [(p[0], p[1] + [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]).tobytes())],
                          socket.MSG_CTRUNC, None)]
            with self.open() as worker:
                self.deny(worker._await_grant)
            self.assertNotIn(fd, s.opened)

    def test_cleanup_or_final_check_crossing_deadline_cannot_succeed(self):
        for event in ('close', 'final-fstat'):
            with self.system() as s:
                s.packets = [self.packet(s, 'challenge'), self.packet(s, 'grant')]
                with self.open() as worker:
                    def hook(name):
                        if name == event or (event == 'final-fstat' and name == 'fstat'
                                             and s.channels and s.channels[0].closed):
                            s.now = 7.0
                    s.hook = hook
                    self.deny(worker._await_grant)

    def test_timeout_setter_cannot_allow_io_after_original_deadline(self):
        for number in (1, 3, 4, 6, 7):
            with self.system() as s:
                s.packets = [self.packet(s, 'challenge'), self.packet(s, 'grant')]
                with self.open() as worker:
                    s.hook = lambda name: setattr(s, 'now', 7.0) if name == 'settimeout' and len(s.timeouts) == number else None
                    self.deny(worker._await_grant)
                    self.assertFalse(any(when >= 6.0 for _kind, when in s.events), 'no IO may begin after deadline')

    def test_replaced_control_parent_same_root_peer_is_not_original_endpoint(self):
        with self.system() as s:
            s.packets = [self.packet(s, 'challenge'), self.packet(s, 'grant')]
            with self.open() as worker:
                def replace_parent(name):
                    if name != 'connect':
                        return
                    original = s.root / 'run/holaday-pool'
                    original.rename(s.root / 'run/retired-pool')
                    # Open FDs still refer to the old directory after real rename.
                    for fd, path in list(s.opened.items()):
                        if path.startswith('/run/holaday-pool'):
                            s.opened[fd] = path.replace('/run/holaday-pool', '/run/retired-pool', 1)
                    original.mkdir()
                    (original / 'control.sock').write_bytes(b'new inode')
                s.hook = replace_parent
                self.deny(worker._await_grant)
                self.assertEqual(s.sent, [], 'a replaced parent must be rejected before hello')


if __name__ == '__main__':
    unittest.main()
