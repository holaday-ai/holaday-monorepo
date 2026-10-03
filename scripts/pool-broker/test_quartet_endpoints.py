"""Real exclusive Unix listeners and journal; only host path/UID seams synthetic."""
import contextlib
import socket
import unittest
from unittest.mock import patch

import resource_journal
import test_quartet_material as fixtures

try:
    import quartet_endpoints as endpoints
except ModuleNotFoundError as error:
    if error.name != 'quartet_endpoints':
        raise
    endpoints = None

NATIVE, Socket = fixtures.NATIVE, fixtures.Socket


class EndpointTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(endpoints, 'original endpoint producer missing')
        fixture = fixtures.MaterialTests()
        with fixture.system() as s, fixture.create(s) as material:
            with self.environment(s, material):
                yield s

    @contextlib.contextmanager
    def environment(self, s, material):
        fixture = fixtures.MaterialTests()
        with contextlib.ExitStack():
            s.material = material
            s.parent = s.root / 'run/holaday-pool-data'
            s.parent.mkdir(parents=True, mode=0o750)
            s.parent.chmod(0o750)
            s.owners[s.parent.stat().st_ino] = (0, s.registration._gid)
            s.data = s.parent / s.resource
            s.listeners, s.binds = [], []
            s.endpoint_hook = lambda _event: None
            class Listener:
                def __init__(self, family, kind):
                    if family != socket.AF_UNIX or kind & socket.SOCK_STREAM != socket.SOCK_STREAM:
                        raise AssertionError('wrong socket type')
                    self.actual = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    self.name = None
                    self.listening = False
                    s.listeners.append(self)
                def __getattr__(self, name): return getattr(self.actual, name)
                def bind(self, path):
                    name = path.rsplit('/', 1)[-1]
                    if path != '/run/holaday-pool-data/' + s.resource + '/' + name or name not in ('cdp.sock', 'vnc.sock'):
                        raise AssertionError('non-fixed endpoint')
                    s.binds.append((name, [r['action'] for r in fixture.rows(s)]))
                    s.endpoint_hook('bind-' + name)
                    cwd = NATIVE.open('.', NATIVE.O_RDONLY | NATIVE.O_DIRECTORY)
                    try:
                        NATIVE.chdir(str(s.data))
                        self.actual.bind(name)
                    finally:
                        NATIVE.fchdir(cwd)
                        NATIVE.close(cwd)
                    self.name = path
                def getsockname(self): return self.name
                def listen(self, backlog):
                    self.actual.listen(backlog)
                    self.listening = True
                def getsockopt(self, level, option):
                    # macOS AF_UNIX rejects SO_ACCEPTCONN (errno 42). Only this
                    # Linux query is synthetic; listen and client connect are real.
                    if level == socket.SOL_SOCKET and option == socket.SO_ACCEPTCONN:
                        return int(self.listening)
                    return self.actual.getsockopt(level, option)
                def accept(self): raise AssertionError('root must not accept business bytes')
                def close(self):
                    s.endpoint_hook('listener-close')
                    self.actual.close()
            with patch.object(endpoints, 'os', fixtures.material.os), patch.object(endpoints, 'Socket', Listener):
                try:
                    yield s
                finally:
                    material.close()
                    self.assertTrue(all(item.fileno() == -1 for item in s.listeners), 'listener leaked')

    def create(self, s):
        return endpoints._GroupEndpoints.create(s.material)

    def actions(self, s):
        return [row['action'] for row in fixtures.MaterialTests().rows(s)]

    def test_claim_before_creation_and_two_live_listeners_before_material_ready(self):
        with self.system() as s:
            owned = self.create(s)
            self.assertEqual(self.actions(s)[-2:], ['endpoint_claim', 'endpoint_ready'])
            self.assertEqual([name for name, _ in s.binds], ['cdp.sock', 'vnc.sock'])
            self.assertTrue(all(actions[-1] == 'endpoint_claim' for _, actions in s.binds))
            mkdir = [e for e in s.events if e[0] == 'mkdir' and e[1] == s.resource][-1]
            self.assertEqual(mkdir[2][-1], 'endpoint_claim')
            self.assertEqual({p.name for p in s.data.iterdir()}, {'cdp.sock', 'vnc.sock'})
            self.assertEqual(len({item.fileno() for item in s.listeners}), 2)
            for listener in s.listeners:
                self.assertEqual(listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN), 1)
                self.assertFalse(listener.get_inheritable())
                self.assertFalse(listener.getblocking())
            for path in s.data.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o660)
                self.assertEqual(s.owners[path.stat().st_ino], (0, s.registration._gid))
                cwd = NATIVE.open('.', NATIVE.O_RDONLY | NATIVE.O_DIRECTORY)
                try:
                    NATIVE.chdir(str(s.data))
                    with Socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                        client.settimeout(0.5)
                        client.connect(path.name)
                finally:
                    NATIVE.fchdir(cwd)
                    NATIVE.close(cwd)
            s.material._check()
            owned.close()
            self.assertTrue(s.data.exists())
            self.assertEqual(s.journal._resources[s.resource]['state'], 'material_prepared')
            with self.assertRaises(ValueError): s.material._check()

    def test_missing_weak_or_foreign_parent_never_creates_group(self):
        for mode in ('missing', 'mode', 'owner', 'symlink'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'missing': s.parent.rmdir()
                elif mode == 'mode': s.parent.chmod(0o770)
                elif mode == 'owner': s.owners[s.parent.stat().st_ino] = (0, 2001)
                else:
                    old = s.parent.with_name('old-data')
                    s.parent.rename(old)
                    s.parent.symlink_to(old)
                with self.assertRaises(ValueError): self.create(s)
                self.assertFalse(s.data.exists())
                self.assertNotIn('endpoint_claim', self.actions(s))

    def test_partial_bind_keeps_unknown_and_never_retries(self):
        with self.system() as s:
            def fail(event):
                if event == 'bind-vnc.sock': raise OSError('synthetic second bind failure')
            s.endpoint_hook = fail
            with self.assertRaises(ValueError): self.create(s)
            self.assertTrue((s.data / 'cdp.sock').is_socket())
            self.assertEqual(self.actions(s)[-1], 'endpoint_claim')
            self.assertTrue(all(item.fileno() == -1 for item in s.listeners))
            count = len(s.binds)
            with self.assertRaises(ValueError): self.create(s)
            self.assertEqual(len(s.binds), count)

    def test_journal_claim_sync_failure_prevents_mkdir_or_bind(self):
        with self.system() as s:
            with patch.object(resource_journal.os, 'fsync', side_effect=OSError('synthetic sync failure')):
                with self.assertRaises(ValueError): self.create(s)
            self.assertFalse(s.data.exists())
            self.assertEqual(s.binds, [])

    def test_original_directory_socket_and_permissions_are_rechecked_by_material(self):
        for mode in ('parent', 'leaf', 'mode', 'fd'):
            with self.subTest(mode=mode), self.system() as s:
                self.create(s)
                if mode == 'parent': s.parent.rename(s.parent.with_name('retired-data'))
                elif mode == 'leaf': (s.data / 'cdp.sock').rename(s.data / 'old.sock')
                elif mode == 'mode': (s.data / 'cdp.sock').chmod(0o666)
                else: s.listeners[0].actual.close()
                with self.assertRaises(ValueError): s.material._check()

    def test_final_writer_failure_cleans_listeners_while_flock_still_held(self):
        with self.system() as s:
            original_guard = s.journal._guard
            original_create = endpoints._GroupEndpoints._create_locked
            state = {'returned': False}
            acquired = []
            def create(item):
                original_create(item)
                state['returned'] = True
            def guard():
                original_guard()
                if state['returned']:
                    raise ValueError('synthetic outer guard failure')
            def observe(event):
                if event != 'listener-close': return
                try: other = resource_journal.ResourceJournal.open(s.registration)
                except ValueError: acquired.append(False)
                else:
                    acquired.append(True)
                    other.close()
            s.endpoint_hook = observe
            with patch.object(s.journal, '_guard', guard), patch.object(endpoints._GroupEndpoints, '_create_locked', create):
                with self.assertRaises(ValueError): self.create(s)
            self.assertTrue(state['returned'], 'failure did not reach the outer transaction guard')
            self.assertEqual(acquired, [False, False])
            self.assertTrue(s.data.exists())

    def test_retired_endpoint_inside_journal_guard_prevents_actual_ready_write(self):
        with self.system() as s:
            original_append, original_info = s.journal._append, resource_journal.os.fstat
            state = {'armed': False, 'writes': 0}
            def append(row):
                state['armed'] = row['action'] == 'endpoint_ready'
                return original_append(row)
            def info(fd):
                result = original_info(fd)
                if state['armed']:
                    state['armed'] = False
                    s.material._endpoints.close()
                return result
            def write(fd, data):
                state['writes'] += 1
                return NATIVE.write(fd, data)
            with patch.object(s.journal, '_append', append), patch.object(resource_journal.os, 'fstat', info), \
                    patch.object(resource_journal.os, 'write', write):
                with self.assertRaises(ValueError): self.create(s)
            self.assertEqual(state['writes'], 1, 'endpoint_ready appended after listener retirement')
            self.assertEqual(self.actions(s)[-1], 'endpoint_claim')

    def test_group_sync_failure_before_ready_keeps_both_paths_and_claim(self):
        with self.system() as s:
            original = endpoints.os.fsync
            def sync(fd):
                if len(s.binds) == 2: raise OSError('synthetic endpoint directory fsync failure')
                return original(fd)
            with patch.object(endpoints.os, 'fsync', sync):
                with self.assertRaises(ValueError): self.create(s)
            self.assertEqual(self.actions(s)[-1], 'endpoint_claim')
            self.assertEqual({p.name for p in s.data.iterdir()}, {'cdp.sock', 'vnc.sock'})

    def test_duplicate_create_or_preexisting_directory_never_rebinds(self):
        for mode in ('duplicate', 'existing'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'duplicate': self.create(s)
                else:
                    s.data.mkdir(mode=0o750)
                    (s.data / 'retained').write_bytes(b'synthetic retained marker')
                count = len(s.binds)
                with self.assertRaises(ValueError): self.create(s)
                self.assertEqual(len(s.binds), count)
                if mode == 'existing': self.assertEqual((s.data / 'retained').read_bytes(), b'synthetic retained marker')

    def test_journal_rejects_extra_fields_wrong_order_and_duplicate_before_write(self):
        for mode in ('ready-first', 'extra', 'foreign', 'duplicate', 'after-credential'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'duplicate': self.create(s)
                elif mode == 'after-credential': s.material.prepare_role('anchor')
                row = {'version': 2, 'action': 'endpoint_ready' if mode == 'ready-first' else 'endpoint_claim',
                       'resource': s.resource}
                if mode == 'extra': row['fd'] = 12
                elif mode == 'foreign': row['resource'] = 'f' * 32
                before = s.journal._expected
                with self.assertRaises(ValueError): s.journal._run(lambda: s.journal._append(row))
                self.assertEqual(s.journal._expected, before)

    def test_reopen_keeps_endpoint_fact_but_never_recreates_original_handle(self):
        with self.system() as s:
            self.create(s)
            s.material.close()
            s.journal.close()
            reopened = resource_journal.ResourceJournal.open(s.registration)
            try:
                self.assertEqual(reopened._resources[s.resource]['endpoints'], {'state': 'ready'})
                self.assertEqual(reopened.snapshot()['dispatching'], 1)
            finally:
                reopened.close()
            with self.assertRaises(ValueError): self.create(s)


if __name__ == '__main__':
    unittest.main()
