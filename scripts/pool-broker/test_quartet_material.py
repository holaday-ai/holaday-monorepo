"""Actual exclusive directories, socket and durable journal; synthetic Linux metadata."""
import contextlib
import hashlib
import json
import os
import socket
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import manager_probe
import quartet_journal
import quartet_root_view
import quartet_worker_guard
import resource_journal
import test_manager_probe
import test_slot_identity
from quartet_protocol import decode_quartet_request

try:
    import quartet_material as material
except ModuleNotFoundError as error:
    if error.name != 'quartet_material':
        raise
    material = None

NATIVE = test_manager_probe.NATIVE
Socket = socket.socket


class MaterialTests(unittest.TestCase):
    def test_original_caller_deadline_shortens_create_and_initial_root_scan(self):
        with self.system() as s:
            now = [time.monotonic_ns()]
            deadline = now[0] + 10000000000
            original = material.quartet_root_view.os.pread
            touched = []
            def expire(*args):
                result = original(*args)
                touched.append(True)
                now[0] = deadline
                return result
            with patch.object(material.time, 'monotonic_ns', lambda: now[0]), patch.object(
                    material.quartet_root_view.os, 'pread', side_effect=expire):
                with self.assertRaises(ValueError):
                    material._GroupMaterial.create(s.journal, s.manager, s.prepared, deadline_ns=deadline)
            self.assertTrue(touched)
            self.assertNotIn('material_claim', [row['action'] for row in self.rows(s)])

    def test_original_sixty_second_total_is_not_refreshed_by_later_transactions(self):
        with self.system() as s:
            now = [time.monotonic_ns()]
            with patch.object(material.time, 'monotonic_ns', lambda: now[0]), self.create(s) as owned:
                deadline = getattr(owned, '_create_deadline_ns', None)
                self.assertEqual(deadline, now[0] + 60000000000, 'original total deadline missing')
                now[0] += 59000000000
                budgets = []
                owned._run(lambda: budgets.append(owned._remaining()))
                self.assertTrue(0 < budgets[0] <= 1)
                self.assertEqual(owned._create_deadline_ns, deadline)
                now[0] += 1000000000
                with self.assertRaises(ValueError): owned._check()
                self.assertTrue(owned._retired)

    def test_shared_authority_is_exclusive_and_durable_before_ready(self):
        digests = []
        for _ in range(2):
            with self.system() as s, self.create(s) as owned:
                path = s.directory / 'credentials/xauthority'
                self.assertTrue(path.is_file(), 'shared Xauthority producer missing')
                raw = path.read_bytes()
                self.assertTrue(raw.startswith(b'\xff\xff\0\0\0\x02' + b'99' + b'\0\x12MIT-MAGIC-COOKIE-1\0\x10'))
                self.assertEqual(len(raw), 46)
                self.assertEqual(path.stat().st_mode & 0o777, 0o400)
                self.assertFalse(raw[-16:].hex() in s.journal._expected.decode())
                self.assertEqual(self.rows(s)[-1]['action'], 'material_ready')
                owned._check()
                digests.append(hashlib.sha256(raw).hexdigest())
        self.assertNotEqual(*digests)

    def test_authority_entropy_or_sync_failure_never_records_ready_or_recreates(self):
        for mode in ('entropy', 'sync'):
            with self.system() as s:
                if mode == 'entropy':
                    override = patch.object(material.os, 'urandom', lambda n: b'\0' * n)
                else:
                    original = material.os.fsync
                    def sync(fd):
                        if s.owned.get(fd) == 'xauthority':
                            raise OSError('synthetic authority sync failure')
                        return original(fd)
                    override = patch.object(material.os, 'fsync', sync)
                with override, self.assertRaises(ValueError):
                    with self.create(s):
                        pass
                self.assertNotIn('material_ready', [row['action'] for row in self.rows(s)])
                with self.assertRaises(ValueError):
                    self.create(s)

    def test_authority_original_file_content_and_permissions_rechecked(self):
        for mode in ('content', 'mode', 'replacement'):
            with self.system() as s, self.create(s) as owned:
                path = s.directory / 'credentials/xauthority'
                self.assertTrue(path.is_file(), 'shared Xauthority producer missing')
                raw = path.read_bytes()
                if mode == 'replacement':
                    path.unlink()
                    path.write_bytes(raw)
                else:
                    path.chmod(0o600)
                    if mode == 'content':
                        path.write_bytes(raw[:-1] + bytes([raw[-1] ^ 1]))
                if mode != 'mode':
                    path.chmod(0o400)
                with self.assertRaises(ValueError):
                    owned._check()

    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(material, 'original group material producer missing')
        def setup(root, package, _manifest):
            directory = root / 'var/lib/holaday-pool-broker'
            directory.mkdir(parents=True)
            directory.chmod(0o700)
            (directory / 'groups').mkdir(mode=0o700)
            (directory / 'resource-journal.jsonl').write_bytes(resource_journal._HEADER)
            (directory / 'resource-journal.jsonl').chmod(0o600)
            tree = package / 'rootfs'
            tree.mkdir()
            dirs = ('/', '/usr', '/usr/bin', '/dev', '/proc', '/sys', '/run', '/tmp', '/profile')
            nodes = []
            for path in dirs:
                (tree / path[1:]).mkdir(exist_ok=True)
                nodes.append({'path': path, 'kind': 'directory', 'mode': 0o555})
            for path in ('/usr/bin/python3', '/usr/bin/Xvfb', '/usr/bin/brave-browser',
                         '/usr/bin/x11vnc', '/usr/bin/websockify', '/quartet_worker_guard.py'):
                raw = b'synthetic executable, not launched'
                file = tree / path[1:]
                file.write_bytes(raw)
                mode = 0o444 if path.endswith('.py') else 0o555
                file.chmod(mode)
                nodes.append({'path': path, 'kind': 'file', 'mode': mode,
                              'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
            for path in reversed(dirs):
                (tree / path[1:]).chmod(0o555)
            self.policy = json.dumps({'version': 1, 'status': 'linux-verified', 'candidate': 'a' * 40, 'nodes': nodes}).encode()
            (root / 'proc/self/ns').mkdir(parents=True)
            for name in ('net', 'ipc', 'mnt', 'pid'):
                (root / 'proc/self/ns' / name).write_bytes(b'synthetic namespace inode')
        with test_manager_probe.ProbeTests().system(setup) as s, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(resource_journal, 'os', s.proxy))
            s.journal = resource_journal.ResourceJournal.open(s.registration)
            s.manager = manager_probe.SystemManagerProbe.open(s.registration)
            s.identities = stack.enter_context(test_slot_identity.SlotIdentityTests().system())
            request = decode_quartet_request(json.dumps({'version': 2, 'action': 'create',
                'requestId': 'c' * 32, 'boot': 'b' * 32, 'slot': 0}).encode())
            s.prepared = quartet_journal.prepare_quartet(s.journal, request)
            s.resource = next(iter(s.journal._resources))
            s.directory = s.root / 'var/lib/holaday-pool-broker/groups' / s.resource
            s.owned, s.owners, s.events, s.sockets = {}, {}, [], []
            s.hook = lambda _event: None
            proxy = SimpleNamespace(**vars(NATIVE))
            def opened(path, flags, **kw):
                target = str(s.root / path[1:]) if path.startswith('/') else path
                fd = NATIVE.open(target, flags, **kw)
                s.owned[fd] = path
                s.hook('open')
                return fd
            def close(fd):
                self.assertIn(fd, s.owned)
                s.owned.pop(fd)
                NATIVE.close(fd)
                s.hook('close')
            def info(actual):
                fields = {name: getattr(actual, name) for name in dir(actual) if name.startswith('st_')}
                fields['st_uid'], fields['st_gid'] = s.owners.get(actual.st_ino, (0, 0))
                return SimpleNamespace(**fields)
            proxy.open, proxy.close = opened, close
            proxy.fstat = lambda fd: info(NATIVE.fstat(fd))
            proxy.stat = lambda path, **kw: info(NATIVE.stat(path, **kw))
            proxy.getresuid, proxy.getresgid = lambda: (0, 0, 0), lambda: (0, 0, 0)
            proxy.listxattr = lambda fd: []
            proxy.fstatvfs = lambda fd: SimpleNamespace(f_flag=1)
            proxy.fchown = lambda fd, uid, gid: s.owners.__setitem__(NATIVE.fstat(fd).st_ino, (uid, gid))
            def mkdir(path, mode, **kw):
                s.events.append(('mkdir', path, [r['action'] for r in self.rows(s)]))
                s.hook('mkdir')
                NATIVE.mkdir(path, mode, **kw)
            def sync(fd):
                NATIVE.fsync(fd)
                s.events.append(('fsync',))
                s.hook('fsync')
            proxy.mkdir, proxy.fsync = mkdir, sync
            def chown(path, uid, gid, **kw):
                s.owners[NATIVE.stat(path, **kw).st_ino] = (uid, gid)
            def chmod(path, mode, **kw):
                # macOS does not implement fchmodat's nofollow flag with dir_fd.
                kw.pop('follow_symlinks', None)
                NATIVE.chmod(path, mode, **kw)
            proxy.chown, proxy.chmod = chown, chmod
            class Channel:
                def __init__(self, family, kind):
                    self.actual = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    self.closed = False
                    s.sockets.append(self)
                def set_inheritable(self, value): self.actual.set_inheritable(value)
                def setsockopt(self, *args): pass  # Linux SO_PASSCRED; creation only, not peer acceptance.
                def bind(self, path):
                    self.assert_path = path
                    expected = '/proc/self/fd/'
                    if not path.startswith(expected) or not path.endswith('/control.sock'):
                        raise AssertionError('non-original socket source')
                    cwd = NATIVE.open('.', NATIVE.O_RDONLY | NATIVE.O_DIRECTORY)
                    try:
                        NATIVE.chdir(str(s.directory / 'control'))
                        self.actual.bind('control.sock')
                    finally:
                        NATIVE.fchdir(cwd)
                        NATIVE.close(cwd)
                def listen(self, backlog): self.actual.listen(backlog)
                def close(self):
                    self.actual.close()
                    self.closed = True
                    s.hook('socket-close')
            for module in (quartet_root_view, material):
                stack.enter_context(patch.object(module, 'os', proxy))
            stack.enter_context(patch.object(quartet_root_view, '_POLICY', self.policy))
            stack.enter_context(patch.object(material, 'Socket', Channel))
            def ioctl(fd, command):
                self.assertEqual(command, 0xb703)
                name = s.owned[fd].rsplit('/', 1)[-1]
                return {'net': 0x40000000, 'ipc': 0x08000000, 'mnt': 0x00020000, 'pid': 0x20000000}[name]
            stack.enter_context(patch.object(material, 'fcntl', SimpleNamespace(ioctl=ioctl), create=True))
            try:
                yield s
            finally:
                s.journal.close()
                s.manager.close()
                self.assertEqual(s.owned, {})
                self.assertTrue(all(channel.closed for channel in s.sockets))

    def rows(self, s):
        return [json.loads(raw) for raw in s.journal._expected.splitlines()][1:]

    def create(self, s):
        return material._GroupMaterial.create(s.journal, s.manager, s.prepared)

    def deny(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_MATERIAL_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_claim_is_durable_before_exclusive_creation_and_ready_after_real_syncs(self):
        with self.system() as s:
            with self.create(s) as owned:
                self.assertIsNone(owned._check())
                self.assertEqual([row['action'] for row in self.rows(s)], ['prepare', 'material_claim', 'material_ready'])
                self.assertEqual(set(path.name for path in s.directory.iterdir()), {'control', 'credentials', 'tmp', 'shm', 'profile'})
                self.assertTrue((s.directory / 'control/control.sock').is_socket())
                self.assertTrue(all(event[2][-1] == 'material_claim' for event in s.events if event[0] == 'mkdir'))
                self.assertGreaterEqual(sum(event[0] == 'fsync' for event in s.events), 7)
                for name in ('tmp', 'shm', 'profile'):
                    file = s.directory / name
                    self.assertEqual(s.owners[file.stat().st_ino], (2001, 2001))
                    self.assertEqual(file.stat().st_mode & 0o777, 0o700)
                self.assertFalse(hasattr(owned, 'ready'))
                self.assertNotIn(s.resource, repr(owned))
            self.assertTrue(s.directory.exists())

    def test_existing_directory_or_partial_failure_is_retained_and_not_recreated(self):
        for mode in ('existing', 'partial'):
            with self.system() as s:
                if mode == 'existing':
                    s.directory.mkdir(mode=0o700)
                    (s.directory / 'retained').write_bytes(b'synthetic existing data')
                else:
                    def fail(event):
                        if event == 'mkdir' and len([e for e in s.events if e[0] == 'mkdir']) == 3:
                            raise OSError('synthetic directory creation failure')
                    s.hook = fail
                self.deny(lambda: self.create(s))
                s.hook = lambda _event: None
                self.assertTrue(s.directory.exists())
                self.assertEqual([r['action'] for r in self.rows(s)], ['prepare', 'material_claim'])
                count = len(s.events)
                self.deny(lambda: self.create(s))
                self.assertEqual(len(s.events), count)
                if mode == 'existing':
                    self.assertEqual((s.directory / 'retained').read_bytes(), b'synthetic existing data')

    def test_original_handle_only_no_duplicate_after_success_or_owner_close(self):
        for mode in ('foreign', 'duplicate', 'closed'):
            with self.system() as s:
                if mode == 'foreign':
                    s.prepared = object.__new__(quartet_journal.PreparedQuartet)
                    self.deny(lambda: self.create(s))
                    self.assertFalse(s.directory.exists())
                else:
                    owned = self.create(s)
                    if mode == 'closed': owned.close()
                    try:
                        self.deny(lambda: self.create(s))
                    finally:
                        owned.close()
                    self.assertEqual(len(self.rows(s)), 3)

    def test_path_replacement_revocation_or_manager_change_invalidates_material(self):
        for mode in ('path', 'registration', 'manager'):
            with self.system() as s:
                owned = self.create(s)
                try:
                    if mode == 'path':
                        (s.directory / 'tmp').rename(s.directory / 'retired-tmp')
                        (s.directory / 'tmp').mkdir(mode=0o700)
                    elif mode == 'registration':
                        s.registration.close()
                    else:
                        s.state['owner'] = ':1.6'
                    self.deny(owned._check)
                finally:
                    owned.close()

    def test_fsync_failure_cannot_record_ready_and_never_unlinks_partial_objects(self):
        with self.system() as s:
            s.hook = lambda event: (_ for _ in ()).throw(OSError('synthetic fsync failure')) if event == 'fsync' else None
            self.deny(lambda: self.create(s))
            self.assertTrue(s.directory.exists())
            self.assertEqual([r['action'] for r in self.rows(s)], ['prepare', 'material_claim'])

    def test_failed_journal_sync_cannot_start_creating_group_objects(self):
        with self.system() as s, patch.object(resource_journal.os, 'fsync', side_effect=OSError('synthetic journal fsync failure')):
            self.deny(lambda: self.create(s))
            self.assertFalse(s.directory.exists())
            self.assertFalse(any(event[0] == 'mkdir' for event in s.events))

    def test_material_is_not_a_credential_or_dispatch_authorization(self):
        with self.system() as s, self.create(s):
            before = s.journal._expected
            with self.assertRaises(ValueError):
                s.journal._run(lambda: s.journal._append({'version': 2, 'resource': s.resource,
                    'role': 'anchor', 'action': 'role_dispatch',
                    'unit': 'holaday-pool-anchor-' + s.resource + '.service',
                    'managerGuid': 'd' * 32, 'managerOwner': ':1.5'}))
            self.assertEqual(s.journal._expected, before)

    def test_anchor_binding_is_created_from_original_objects_and_consumed_by_actual_decoder(self):
        with self.system() as s, self.create(s) as owned:
            self.assertTrue(callable(getattr(owned, 'prepare_role', None)), 'original credential producer missing')
            self.assertIsNone(owned.prepare_role('anchor'))
            file = s.directory / 'credentials/anchor.binding'
            raw = file.read_bytes()
            binding = quartet_worker_guard._decode_binding(raw, 'a' * 40, s.resource, 'anchor')
            self.assertEqual((binding['uid'], binding['gid'], binding['slot']), (2001, 2001, 0))
            self.assertEqual(binding['brokerPid'], os.getpid())
            app = binding['application']
            self.assertTrue('dataKey' in binding, 'anchor data-plane subkey missing')
            row = s.journal._resources[s.resource]
            self.assertNotIn(row['capability'], raw.decode())
            self.assertNotIn(row['egressCapability'], raw.decode())
            self.assertEqual(binding['dataKey'], material._derive_data_key(row['capability'],
                binding['candidate'], app['boot'], binding['resource']))
            self.assertEqual((app['pid'], app['uid'], app['gid'], app['boot']),
                             (s.registration._pin._pid, 998, s.registration._pin._gid, s.registration._pin._boot))
            namespace = (s.root / 'proc/self/ns/pid').stat()
            self.assertEqual(app['pidNamespace'], [namespace.st_dev, namespace.st_ino])
            self.assertIsNone(binding['groupNamespaces'])
            tree = s.root / ('usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/rootfs')
            for name, path in (('root', tree), ('tmp', s.directory / 'tmp'), ('shm', s.directory / 'shm')):
                info = path.stat()
                self.assertEqual(binding['objects'][name], [info.st_dev, info.st_ino])
            for name in ('net', 'ipc', 'mnt'):
                info = (s.root / 'proc/self/ns' / name).stat()
                self.assertEqual(binding['hostNamespaces'][name], [info.st_dev, info.st_ino])
            self.assertEqual(file.stat().st_mode & 0o777, 0o400)
            self.assertEqual(self.rows(s)[-2]['action'], 'credential_claim')
            self.assertEqual(self.rows(s)[-1]['action'], 'credential_ready')
            self.assertEqual(self.rows(s)[-1]['bindingDigest'], hashlib.sha256(raw).hexdigest())
            self.assertNotIn(binding['handshake'], s.journal._expected.decode())
            self.assertIsNone(owned._check())

    def test_credential_is_not_recreated_or_replaced_after_first_attempt(self):
        for mode in ('existing', 'duplicate', 'sync'):
            with self.system() as s, self.create(s) as owned:
                self.assertTrue(callable(getattr(owned, 'prepare_role', None)), 'original credential producer missing')
                path = s.directory / 'credentials/anchor.binding'
                if mode == 'existing':
                    path.write_bytes(b'synthetic retained credential')
                    before = path.read_bytes()
                elif mode == 'duplicate':
                    owned.prepare_role('anchor')
                    before = path.read_bytes()
                else:
                    before = None
                    s.hook = lambda event: (_ for _ in ()).throw(OSError('synthetic fsync failure')) if event == 'fsync' else None
                self.deny(lambda: owned.prepare_role('anchor'))
                s.hook = lambda _event: None
                if before is not None:
                    self.assertEqual(path.read_bytes(), before)
                if mode == 'sync':
                    self.assertEqual(self.rows(s)[-1]['action'], 'credential_claim')
                    self.assertTrue(path.exists())

    def test_changed_namespace_or_binding_invalidates_original_material(self):
        for mode in ('namespace', 'binding'):
            with self.system() as s, self.create(s) as owned:
                self.assertTrue(callable(getattr(owned, 'prepare_role', None)), 'original credential producer missing')
                owned.prepare_role('anchor')
                if mode == 'namespace':
                    file = s.root / 'proc/self/ns/net'
                    file.rename(file.with_name('retired-net'))
                    file.write_bytes(b'new namespace')
                else:
                    file = s.directory / 'credentials/anchor.binding'
                    size = file.stat().st_size
                    file.chmod(0o600)
                    file.write_bytes(b'x' * size)
                    file.chmod(0o400)
                self.deny(owned._check)

    def test_journal_close_during_material_io_cannot_release_lock_before_tail_finishes(self):
        with self.system() as s:
            acquired = []
            def interrupt(event):
                if event != 'mkdir': return
                s.hook = lambda _event: None
                s.journal.close()
                try:
                    other = resource_journal.ResourceJournal.open(s.registration)
                except ValueError:
                    acquired.append(False)
                else:
                    acquired.append(True)
                    other.close()
            s.hook = interrupt
            self.deny(lambda: self.create(s))
            self.assertEqual(acquired, [False], 'writer lock escaped a still-running material transaction')
            reopened = resource_journal.ResourceJournal.open(s.registration)
            try:
                self.assertEqual(reopened.snapshot()['dispatching'], 1)
            finally:
                reopened.close()

    def test_material_veto_inside_journal_guard_prevents_subsequent_actual_write(self):
        for mode in ('close', 'expired'):
            with self.system() as s, self.create(s) as owned:
                state = {'armed': False, 'now': 1.0, 'writes': 0}
                original_append, original_info = s.journal._append, resource_journal.os.fstat
                def append(row):
                    state['armed'] = True
                    return original_append(row)
                def info(fd):
                    result = original_info(fd)
                    if state['armed']:
                        state['armed'] = False
                        if mode == 'close': owned.close()
                        else: state['now'] += 31.0
                    return result
                def write(fd, data):
                    state['writes'] += 1
                    return NATIVE.write(fd, data)
                with patch.object(s.journal, '_append', side_effect=append), \
                        patch.object(resource_journal.os, 'fstat', side_effect=info), \
                        patch.object(resource_journal.os, 'write', side_effect=write), \
                        patch.object(material, 'time', SimpleNamespace(monotonic=lambda: state['now'], monotonic_ns=time.monotonic_ns)):
                    self.deny(lambda: owned.prepare_role('anchor'))
                self.assertEqual(state['writes'], 0, 'journal wrote after material revocation/deadline')

    def test_failure_cleanup_including_final_guard_keeps_writer_lock_until_listener_closed(self):
        for mode in ('operation', 'final-guard'):
            with self.subTest(mode=mode), self.system() as s:
                owned = self.create(s)
                acquired = []
                channel = s.sockets[0]
                original_close = channel.close
                def close():
                    self.assertFalse(channel.closed)
                    try:
                        other = resource_journal.ResourceJournal.open(s.registration)
                    except ValueError:
                        acquired.append(False)
                    else:
                        acquired.append(True)
                        other.close()
                    original_close()
                with patch.object(channel, 'close', side_effect=close):
                    if mode == 'operation':
                        s.hook = lambda event: s.journal.close() if event == 'fsync' else None
                        self.deny(lambda: owned.prepare_role('anchor'))
                    else:
                        original_verify = owned._verify
                        state = {'done': False}
                        def verify():
                            original_verify()
                            state['done'] = True
                        original_info = resource_journal.os.fstat
                        def info(fd):
                            result = original_info(fd)
                            if state['done']:
                                s.journal.close()
                            return result
                        with patch.object(owned, '_verify', side_effect=verify), \
                                patch.object(resource_journal.os, 'fstat', side_effect=info):
                            self.deny(owned._check)
                self.assertEqual(acquired, [False], 'journal unlocked before material failure cleanup')
                owned.close()


if __name__ == '__main__':
    unittest.main()
