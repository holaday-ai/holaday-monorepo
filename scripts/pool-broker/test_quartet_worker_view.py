"""Root inspection of real held objects; Linux proc/mount/pidfd seams only."""
import contextlib
import json
import os
import struct
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import manager_probe
import quartet_worker_pin
import test_quartet_material

try:
    import quartet_worker_view as worker_view
except ModuleNotFoundError as error:
    if error.name != 'quartet_worker_view':
        raise
    worker_view = None

NATIVE = test_quartet_material.NATIVE
STATUS = (b'Uid: 2001 2001 2001 2001\nGid: 2001 2001 2001 2001\nGroups: 2001\n'
          b'NoNewPrivs: 1\nThreads: 1\nTracerPid: 0\n' +
          b''.join(name + b': 0000000000000000\n' for name in
                   (b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb')))
NET = (b'Inter-|   Receive                                                |  Transmit\n'
       b' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n'
       b'    lo: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n')


class WorkerViewTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, *, pin=True, observed=True, material_setup=None, prepare_anchor=True):
        self.assertIsNotNone(worker_view, 'root-side worker environment inspection missing')
        with test_quartet_material.MaterialTests().system() as s, contextlib.ExitStack() as stack:
            material = test_quartet_material.MaterialTests().create(s)
            s.material = material
            try:
                if material_setup is not None:
                    stack.enter_context(material_setup(s))
                if prepare_anchor: material.prepare_role('anchor')
                unit = 'holaday-pool-anchor-' + s.resource + '.service'
                common = {'version': 2, 'resource': s.resource, 'role': 'anchor'}
                # Durable observed records, NOT a real systemd dispatch proof.
                for row in ({'action': 'role_dispatch', 'unit': unit, 'managerGuid': 'd' * 32, 'managerOwner': ':1.5'},
                            {'action': 'role_accepted', 'job': '/org/freedesktop/systemd1/job/7'},
                            {'action': 'role_observe', 'invocation': '1' * 32}):
                    if observed:
                        s.journal._run(lambda: s.journal._append(common | row))
                proc = s.root / 'proc/777'
                (proc / 'ns').mkdir(parents=True)
                (proc / 'net').mkdir()
                (s.root / 'proc/self/fdinfo').mkdir()
                (s.root / 'pidfd').write_bytes(b'synthetic Linux pidfd')
                (proc / 'root').symlink_to(s.root / ('usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/rootfs'))
                s.group = '/holadaypool.slice/holadaypool-' + s.resource + '.slice/' + unit
                (proc / 'cgroup').write_bytes(('0::' + s.group + '\n').encode())
                (proc / 'status').write_bytes(STATUS)
                (proc / 'net/dev').write_bytes(NET)
                for name in ('net', 'ipc', 'mnt'):
                    (proc / 'ns' / name).write_bytes(b'synthetic namespace inode')
                s.proc, s.fds, s.peer = proc, {}, struct.pack('=iII', 777, 2001, 2001)
                s.pin_events, s.view_hook, s.exited = [], lambda _: None, False
                s.mounts, s.bad_objects = {}, {}
                s.properties = {'Id': ('s', unit), 'InvocationID': ('ay', [17] * 16), 'ActiveState': ('s', 'active'),
                    'MainPID': ('u', 777), 'Type': ('s', 'exec'), 'Restart': ('s', 'no'),
                    'ControlGroup': ('s', s.group), 'UID': ('u', 2001), 'GID': ('u', 2001)}
                s.units, s.worker_pids = {unit: s.properties}, {777}
                proxy = SimpleNamespace(**vars(NATIVE))
                def opened(path, flags, **kw):
                    target = str(s.root / path[1:]) if path.startswith('/') else path
                    parent = kw.get('dir_fd')
                    # Real bind mounts cannot be made on macOS; resolve only
                    # these fixed kernel mountpoints onto original real dirs.
                    if parent in s.fds and s.fds[parent] == 'root' and path in ('tmp', 'profile'):
                        target = str(s.bad_objects.get(path, s.directory / path))
                    elif parent in s.fds and s.fds[parent] == 'dev' and path == 'shm':
                        target = str(s.bad_objects.get(path, s.directory / path))
                    fd = NATIVE.open(target, flags, **kw)
                    s.fds[fd] = path
                    s.view_hook('open:' + path)
                    return fd
                def close(fd):
                    self.assertIn(fd, s.fds)
                    s.fds.pop(fd)
                    NATIVE.close(fd)
                    s.view_hook('close')
                def info(actual):
                    fields = {key: getattr(actual, key) for key in dir(actual) if key.startswith('st_')}
                    fields['st_uid'], fields['st_gid'] = s.owners.get(actual.st_ino, (0, 0))
                    return SimpleNamespace(**fields)
                def pidfd_open(pid, flags):
                    self.assertIn(pid, s.worker_pids)
                    self.assertEqual(flags, 0)
                    fd = opened('/pidfd', os.O_RDONLY | os.O_CLOEXEC)
                    (s.root / ('proc/self/fdinfo/' + str(fd))).write_bytes(('Pid:\t' + str(pid) + '\n').encode())
                    s.pin_events.append('pidfd_open')
                    return fd
                proxy.open, proxy.close, proxy.pidfd_open = opened, close, pidfd_open
                proxy.fstat = lambda fd: info(NATIVE.fstat(fd))
                proxy.listxattr = lambda fd: []
                proxy.fstatvfs = lambda fd: SimpleNamespace(f_flag=s.mounts.get(s.fds.get(fd),
                    14 if s.fds.get(fd) in ('tmp', 'shm', 'profile') else 1))
                proxy.getresuid, proxy.getresgid = lambda: (0, 0, 0), lambda: (0, 0, 0)
                class Poll:
                    def register(self, fd, events): self.fd = fd
                    def poll(self, timeout): return [(self.fd, 1)] if s.exited else []
                signal = SimpleNamespace(pidfd_send_signal=lambda *args: None)
                select = SimpleNamespace(poll=Poll, POLLIN=1, POLLHUP=16, POLLERR=8)
                def ioctl(fd, command):
                    self.assertEqual(command, 0xb703)
                    return {'ns/net': 0x40000000, 'ns/ipc': 0x08000000, 'ns/mnt': 0x00020000}[s.fds[fd]]
                stack.enter_context(patch.object(quartet_worker_pin, 'os', proxy))
                stack.enter_context(patch.object(quartet_worker_pin, 'signal', signal))
                stack.enter_context(patch.object(quartet_worker_pin, 'select', select))
                stack.enter_context(patch.object(worker_view, 'os', proxy))
                stack.enter_context(patch.object(worker_view, 'fcntl', SimpleNamespace(ioctl=ioctl)))
                original = manager_probe._capture.side_effect
                def capture(argv, fd, deadline, scope):
                    if argv[8] == 'org.freedesktop.DBus':
                        return original(argv, fd, deadline, scope)
                    scope()
                    self.assertEqual(argv[8], ':1.5')
                    matches = [value for name, value in s.units.items() if argv[9] ==
                               '/org/freedesktop/systemd1/unit/' + name.replace('-', '_2d').replace('.', '_2e')]
                    self.assertEqual(len(matches), 1)
                    if argv[7] == 'get-property':
                        fields = (('Id', 'InvocationID', 'ActiveState') if argv[10].endswith('.Unit')
                            else ('Type', 'Restart', 'UID', 'GID', 'MainPID', 'ControlGroup'))
                        self.assertEqual(argv[11:], fields)
                        return b'\n'.join(json.dumps({'type': matches[0][name][0],
                            'data': matches[0][name][1]}).encode() for name in fields) + b'\n'
                    name = argv[-1]
                    self.assertEqual(argv[-2], 'org.freedesktop.systemd1.' +
                        ('Unit' if name in ('Id', 'InvocationID', 'ActiveState') else 'Service'))
                    kind, value = matches[0][name]
                    return json.dumps({'type': 'v', 'data': [{'type': kind, 'data': value}]}).encode()
                stack.enter_context(patch.object(manager_probe, '_capture', side_effect=capture))
                s.pin = None
                def acquire():
                    s.pin = quartet_worker_pin._WorkerPin._from_received_peer_locked(
                        s.journal, s.manager, s.resource, 'anchor', s.peer, scope_guard=material._remaining)
                if pin:
                    material._run(acquire)
                yield s
            finally:
                if getattr(s, 'pin', None) is not None:
                    s.pin.close()
                material.close()
                self.assertEqual(getattr(s, 'fds', {}), {})

    def open(self, s):
        return worker_view._WorkerView._open_locked(s.material, s.pin)

    def deny(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertIsNone(caught.exception.__context__)

    def test_original_live_pin_objects_and_namespaces_inspected_without_grant(self):
        with self.system() as s:
            before = s.journal._expected
            owned = []
            def operation():
                view = self.open(s)
                owned.append(view)
                view._check_locked()
                self.assertEqual(set(view._namespaces), {'net', 'ipc', 'mnt'})
                self.assertFalse(hasattr(view, 'ready'))
                self.assertEqual(s.pin_events, ['pidfd_open'])
                self.assertNotIn(s.resource, repr(view))
            try:
                s.material._run(operation)
                self.assertEqual(s.journal._expected, before)
            finally:
                for view in owned: view.close()

    def test_root_and_writable_mounts_must_match_original_material(self):
        for name in ('root', 'tmp', 'shm', 'profile'):
            with self.system() as s:
                other = s.root / 'other'
                other.mkdir(mode=0o700)
                s.owners[other.stat().st_ino] = (2001, 2001)
                if name == 'root':
                    (s.proc / 'root').unlink()
                    (s.proc / 'root').symlink_to(other)
                else:
                    s.bad_objects[name] = other
                self.deny(lambda: s.material._run(lambda: self.open(s)))

    def test_mount_permissions_and_process_restrictions_are_independently_verified(self):
        variants = [('mount', 'root', 0), ('mount', 'tmp', 6), ('mount', 'shm', 15),
                    ('status', b'CapEff: 0000000000000000', b'CapEff: 0000000000000001'),
                    ('status', b'NoNewPrivs: 1', b'NoNewPrivs: 0'),
                    ('status', b'Groups: 2001', b'Groups: 2001 2002'),
                    ('status', b'Threads: 1', b'Threads: 2'), ('status', b'TracerPid: 0', b'TracerPid: 8')]
        for kind, key, value in variants:
            with self.system() as s:
                if kind == 'mount': s.mounts[key] = value
                else: (s.proc / 'status').write_bytes(STATUS.replace(key, value))
                self.deny(lambda: s.material._run(lambda: self.open(s)))

    def test_host_namespaces_or_host_interface_cannot_be_accepted(self):
        for name in ('net', 'ipc', 'mnt', 'interface'):
            with self.system() as s:
                if name == 'interface':
                    (s.proc / 'net/dev').write_bytes(NET + b' eth0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n')
                else:
                    (s.proc / 'ns' / name).unlink()
                    (s.proc / 'ns' / name).symlink_to(s.root / 'proc/self/ns' / name)
                self.deny(lambda: s.material._run(lambda: self.open(s)))

    def test_original_namespace_replacement_or_worker_exit_invalidates_retained_view(self):
        for mode in ('namespace', 'exit'):
            with self.system() as s:
                views = []
                s.material._run(lambda: views.append(self.open(s)))
                view = views[0]
                try:
                    if mode == 'exit': s.exited = True
                    else:
                        (s.proc / 'ns/net').rename(s.proc / 'ns/retired')
                        (s.proc / 'ns/net').write_bytes(b'replacement namespace')
                    self.deny(lambda: s.material._run(view._check_locked))
                finally:
                    view.close()

    def test_no_outer_material_transaction_or_late_revoke_cannot_return_view(self):
        with self.system() as s:
            self.deny(lambda: self.open(s))
        with self.system() as s:
            def hook(event):
                if event == 'open:ns/mnt': s.material.close()
            s.view_hook = hook
            self.deny(lambda: s.material._run(lambda: self.open(s)))
            self.assertEqual(s.fds, {})  # Failed original pin and view both retire without reattachment.

    def test_original_manager_deadline_stops_native_io_before_material_budget_expires(self):
        with self.system() as s:
            real_clock, real_flags, real_open = time.monotonic, worker_view.os.fstatvfs, worker_view.os.open
            offset, expired, late_opens = 0.0, False, []
            def flags(fd):
                nonlocal offset, expired
                result = real_flags(fd)
                if s.fds.get(fd) == 'root' and not expired:
                    offset = s.manager._deadline + 0.1 - real_clock()
                    expired = True
                return result
            def opened(*args, **kw):
                if expired: late_opens.append(args[0])
                return real_open(*args, **kw)
            with patch.object(time, 'monotonic', lambda: real_clock() + offset), \
                    patch.object(worker_view.os, 'fstatvfs', side_effect=flags), \
                    patch.object(worker_view.os, 'open', side_effect=opened):
                self.deny(lambda: s.material._run(lambda: self.open(s)))
            self.assertTrue(expired)
            self.assertEqual(late_opens, [])

    def test_first_inspection_cannot_mix_old_mount_objects_with_new_namespace(self):
        with self.system() as s:
            original_close = worker_view.os.close
            changed, views = False, []
            other = s.root / 'foreign-tmp'
            other.mkdir(mode=0o700)
            s.owners[other.stat().st_ino] = (2001, 2001)
            def close(fd):
                nonlocal changed
                root = s.fds.get(fd) == 'root'
                original_close(fd)
                if root and not changed:
                    changed = True
                    (s.proc / 'ns/mnt').rename(s.proc / 'ns/retired-mnt')
                    (s.proc / 'ns/mnt').write_bytes(b'changed namespace after old object sample')
                    s.bad_objects['tmp'] = other
            try:
                with patch.object(worker_view.os, 'close', side_effect=close):
                    self.deny(lambda: s.material._run(lambda: views.append(self.open(s))))
                self.assertTrue(changed)
            finally:
                for view in views: view.close()


if __name__ == '__main__':
    unittest.main()
