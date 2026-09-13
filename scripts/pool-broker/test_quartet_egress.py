"""Real socket hardlinks/challenge IO; Linux O_PATH and credentials are seams."""
import array
import contextlib
import hashlib
import json
import socket
import struct
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_quartet_endpoints as fixtures
import resource_journal

try:
    import quartet_egress as egress
except ModuleNotFoundError as error:
    if error.name != 'quartet_egress': raise
    egress = None

NATIVE, Socket = fixtures.NATIVE, fixtures.Socket
FRAME = struct.Struct('!4sB20s16s16s32s')


class EgressTests(unittest.TestCase):
    def test_original_egress_credential_is_private_fixed_and_durable_before_ready(self):
        with self.system() as s:
            self.create(s)
            credential = s.directory / 'credentials/egress'
            self.assertTrue(credential.is_file(), 'anchor egress credential missing')
            raw = credential.read_bytes()
            data = json.loads(raw)
            self.assertEqual(set(data), {'version', 'candidate', 'resource', 'boot', 'key', 'leaf'})
            self.assertEqual(data['key'], s.journal._resources[s.resource]['egressCapability'])
            self.assertEqual(data['leaf'], {'device': s.source_leaf.stat().st_dev, 'inode': s.source_leaf.stat().st_ino})
            self.assertEqual(credential.stat().st_mode & 0o777, 0o400)
            egress_rows = [row for row in s.journal._expected.splitlines()
                if json.loads(row).get('action') in ('egress_claim', 'egress_ready')]
            self.assertNotIn(data['key'].encode(), b'\n'.join(egress_rows))
            # Use the retained writable test FD to preserve mode/inode while
            # corrupting bytes, so the digest check (not chmod) must reject.
            NATIVE.pwrite(s.material._egress._credential[0], raw.replace(b'"version":1', b'"version":2'), 0)
            with self.assertRaises(ValueError): s.material._check()

    def test_credential_sync_failure_retains_claim_and_never_records_ready(self):
        with self.system() as s:
            hit = []
            def fail(event):
                path = s.directory / 'credentials/egress'
                if event == 'fsync' and path.exists() and s.egress_syncs[-1] == path.stat().st_ino:
                    hit.append(True)
                    self.assertEqual(self.actions(s)[-1], 'egress_claim')
                    raise OSError('synthetic credential sync failure')
            s.egress_hook = fail
            with self.assertRaises(ValueError): self.create(s)
            self.assertEqual(hit, [True])
            self.assertEqual(self.actions(s)[-1], 'egress_claim')
            self.assertTrue((s.directory / 'credentials/egress').exists())

    def test_only_original_complete_anchor_template_receives_egress(self):
        import quartet_launch
        from test_quartet_launch import properties
        with self.system() as s:
            self.create(s)
            observed = []
            def template(role):
                s.material._run(lambda: observed.append(properties(quartet_launch._template(s.material, role))[0]))
                return observed[-1]
            anchor = template('anchor')
            self.assertIn('/run/holaday-egress.sock', anchor['BindReadOnlyPaths'][1])
            self.assertIn('egress', anchor['LoadCredential'][1])
            for role in ('xvfb', 'brave', 'x11vnc', 'websockify'):
                child = template(role)
                self.assertNotIn('/run/holaday-egress.sock', child['BindReadOnlyPaths'][1])
                self.assertNotIn('egress', child['LoadCredential'][1])
            s.material._egress._complete = False
            with self.assertRaises(ValueError):
                s.material._run(lambda: quartet_launch._template(s.material, 'anchor'))

    @contextlib.contextmanager
    def system(self, base=None, create_endpoints=True):
        self.assertIsNotNone(egress, 'original egress leaf binding missing')
        helper = fixtures.EndpointTests()
        with (helper.system() if base is None else base()) as s, contextlib.ExitStack() as stack:
            if create_endpoints and s.material._endpoints is None: helper.create(s)
            s.source = s.root / 'run/holaday-pool-egress'
            s.source.mkdir(mode=0o700)
            s.owners[s.source.stat().st_ino] = (998, s.registration._gid)
            s.link_parent = s.root / 'run/holaday-pool-egress-links'
            s.link_parent.mkdir(mode=0o700)
            s.link_group = s.link_parent / s.resource
            s.source_leaf = s.source / 'egress.sock'
            s.link_leaf = s.link_group / 'egress.sock'
            s.egress_server = stack.enter_context(Socket(socket.AF_UNIX, socket.SOCK_STREAM))
            cwd = NATIVE.open('.', NATIVE.O_RDONLY | NATIVE.O_DIRECTORY)
            try:
                NATIVE.chdir(s.source)
                s.egress_server.bind('egress.sock')
            finally:
                NATIVE.fchdir(cwd); NATIVE.close(cwd)
            s.egress_server.listen(8)
            s.egress_server.settimeout(1)
            s.source_leaf.chmod(0o666)
            s.owners[s.source_leaf.stat().st_ino] = (998, s.registration._gid)
            s.egress_hook = lambda _event: None
            s.egress_mode, s.egress_chunk = '', FRAME.size + 1
            s.probes, s.probe_sockets, s.leaf_references, s.egress_syncs = [], [], {}, []
            s.io_budgets = []
            s.egress_peer = struct.pack('=iII', s.material._pin._pid, 998, s.registration._gid)
            proxy = fixtures.fixtures.material.os
            original_open, original_stat, original_link, original_sync = proxy.open, proxy.fstat, proxy.link, proxy.fsync
            def opened(path, flags, **kwargs):
                if flags & 0x200000:
                    self.assertEqual(path, 'egress.sock')
                    self.assertEqual(flags, 0x200000 | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC)
                    actual = NATIVE.stat(path, **kwargs, follow_symlinks=False)
                    # Darwin rejects open(socket, O_EVTONLY). A real duplicate
                    # owns lifetime; fstat below models the Linux O_PATH leaf,
                    # deliberately not claiming native O_PATH verification.
                    fd = NATIVE.dup(s.egress_server.fileno())
                    NATIVE.set_inheritable(fd, False)
                    s.owned[fd] = '<egress-original-leaf>'
                    s.leaf_references[fd] = actual
                    return fd
                return original_open(path, flags, **kwargs)
            def metadata(fd):
                if fd not in s.leaf_references: return original_stat(fd)
                actual = s.leaf_references[fd]
                for path in (s.source_leaf, s.link_leaf):
                    if path.exists() and path.stat().st_ino == actual.st_ino:
                        actual = path.stat(); break
                fields = {name: getattr(actual, name) for name in dir(actual) if name.startswith('st_')}
                fields['st_uid'], fields['st_gid'] = s.owners[actual.st_ino]
                return SimpleNamespace(**fields)
            def link(source, target, **kwargs):
                self.assertEqual((source, target), ('egress.sock', 'egress.sock'))
                self.assertIs(kwargs.get('follow_symlinks'), False)
                self.assertEqual(helper.actions(s)[-1], 'egress_claim')
                s.egress_hook('before-link')
                result = original_link(source, target, **kwargs)
                s.egress_hook('after-link')
                return result
            def sync(fd):
                result = original_sync(fd)
                s.egress_syncs.append(NATIVE.fstat(fd).st_ino)
                s.egress_hook('fsync')
                return result
            class Probe:
                def __init__(self, family, kind):
                    self.actual = Socket(family, kind)
                    self.peer = None
                    self.path = None
                    s.probe_sockets.append(self)
                def __getattr__(self, name): return getattr(self.actual, name)
                def setsockopt(self, level, option, value):
                    self_outer.assertEqual((level, option, value), (socket.SOL_SOCKET, 16, 1))
                def getsockopt(self, level, option, *args):
                    if option == 17: return s.egress_peer
                    return self.actual.getsockopt(level, option, *args)
                def connect(self, path):
                    expected = ('/run/holaday-pool-egress/egress.sock',
                        '/run/holaday-pool-egress-links/' + s.resource + '/egress.sock')
                    self_outer.assertTrue(path in expected or path.startswith('/proc/self/fd/'))
                    self.path = path
                    s.egress_hook('before-connect')
                    if path.startswith('/proc/self/fd/'):
                        fd = int(path.rsplit('/', 1)[1])
                        held = s.leaf_references[fd]
                        actual = next(p for p in list(s.source.iterdir()) + ([s.link_leaf] if s.link_leaf.exists() else [])
                                      if p.lstat().st_ino == held.st_ino)
                    else: actual = s.root / path[1:]
                    cwd = NATIVE.open('.', NATIVE.O_RDONLY | NATIVE.O_DIRECTORY)
                    try:
                        NATIVE.chdir(actual.parent)
                        self.actual.connect(actual.name)
                    finally:
                        NATIVE.fchdir(cwd); NATIVE.close(cwd)
                    self.peer = s.egress_server.accept()[0]
                    self.peer.settimeout(1)
                    s.egress_hook('connect')
                def sendmsg(self, buffers, *args):
                    s.io_budgets.append((self.actual.gettimeout(), s.material._deadline - fixtures.fixtures.material.time.monotonic()))
                    count = self.actual.sendmsg(buffers, *args)
                    raw = self.peer.recv(FRAME.size + 1)
                    self_outer.assertEqual(len(raw), FRAME.size)
                    fields = list(FRAME.unpack(raw))
                    self_outer.assertEqual(fields[:2], [b'HPE1', 1])
                    self_outer.assertEqual(fields[2:5], [bytes.fromhex(s.material._candidate),
                        bytes.fromhex(s.resource), bytes.fromhex(s.material._pin._boot)])
                    s.probes.append((self.path, hashlib.sha256(raw).hexdigest()))
                    fields[1] = 2
                    if s.egress_mode == 'nonce': fields[-1] = b'z' * 32
                    response = FRAME.pack(*fields)
                    if s.egress_mode == 'extra': response += b'X'
                    ancillary = [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i',
                        [s.egress_server.fileno()]))] if s.egress_mode == 'rights' else []
                    self.peer.sendmsg([response], ancillary)
                    s.egress_hook('send')
                    return count - 1 if s.egress_mode == 'short' else count
                def recvmsg(self, size, space, flags):
                    s.io_budgets.append((self.actual.gettimeout(), s.material._deadline - fixtures.fixtures.material.time.monotonic()))
                    data, ancillary, flags, address = self.actual.recvmsg(min(size, s.egress_chunk), space)
                    for level, name, raw in ancillary:
                        if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                            for fd in array.array('i', raw):
                                s.owned[fd] = '<egress-unwanted-right>'
                                NATIVE.set_inheritable(fd, False)
                    s.egress_hook('receive')
                    credentials = s.egress_peer if s.egress_mode != 'credentials' else struct.pack('=iII', 99, 998, 998)
                    return data, ancillary + [(socket.SOL_SOCKET, 2, credentials)], flags, address
                def close(self):
                    self.actual.close()
                    if self.peer is not None: self.peer.close()
                    s.egress_hook('probe-close')
            self_outer = self
            stack.enter_context(patch.object(proxy, 'open', opened))
            stack.enter_context(patch.object(proxy, 'fstat', metadata))
            stack.enter_context(patch.object(proxy, 'link', link))
            stack.enter_context(patch.object(proxy, 'fsync', sync))
            stack.enter_context(patch.object(egress, 'os', proxy))
            stack.enter_context(patch.object(egress, 'Socket', Probe))
            try: yield s
            finally:
                s.material.close()
                self.assertTrue(all(p.actual.fileno() == -1 for p in s.probe_sockets))

    def create(self, s):
        return egress._GroupEgress.create(s.material)

    def actions(self, s):
        return fixtures.EndpointTests().actions(s)

    def test_fixed_hardlink_and_two_original_challenges_precede_durable_ready(self):
        with self.system() as s:
            s.egress_chunk = 11
            item = self.create(s)
            self.assertEqual(s.source_leaf.stat().st_ino, s.link_leaf.stat().st_ino)
            self.assertEqual(s.source_leaf.stat().st_nlink, 2)
            self.assertEqual(s.link_group.stat().st_mode & 0o777, 0o700)
            self.assertEqual(s.link_leaf.stat().st_mode & 0o777, 0o666)
            self.assertTrue(s.probes[0][0].startswith('/proc/self/fd/'))
            self.assertEqual(s.probes[1][0], '/run/holaday-pool-egress-links/' + s.resource + '/egress.sock')
            self.assertNotEqual(s.probes[0][1], s.probes[1][1])
            self.assertEqual(self.actions(s)[-2:], ['egress_claim', 'egress_ready'])
            self.assertIn(s.link_group.stat().st_ino, s.egress_syncs)
            self.assertIn(s.link_parent.stat().st_ino, s.egress_syncs)
            s.material._check()
            item.close()
            self.assertTrue(s.link_leaf.exists())
            with self.assertRaises(ValueError): s.material._check()

    def test_wrong_probe_reply_rights_short_write_and_credentials_reject(self):
        for mode in ('nonce', 'extra', 'rights', 'short', 'credentials'):
            with self.subTest(mode=mode), self.system() as s:
                s.egress_mode = mode
                with self.assertRaises(ValueError): self.create(s)
                self.assertNotIn('egress_ready', self.actions(s))
                self.assertNotIn('<egress-unwanted-right>', s.owned.values())

    def test_link_race_never_consumes_replacement_or_retries(self):
        with self.system() as s:
            def change(event):
                if event == 'before-link':
                    s.source_leaf.rename(s.source / 'original.sock')
                    s.source_leaf.write_bytes(b'synthetic replacement')
            s.egress_hook = change
            with self.assertRaises(ValueError): self.create(s)
            self.assertEqual(self.actions(s)[-1], 'egress_claim')
            self.assertTrue(s.link_leaf.exists())
            self.assertEqual(len(s.probes), 1)
            with self.assertRaises(ValueError): self.create(s)
            self.assertEqual(len(s.probes), 1)

    def test_later_source_rebind_permissions_or_root_target_replacement_reject(self):
        for mode in ('source', 'permissions', 'target', 'parent'):
            with self.subTest(mode=mode), self.system() as s:
                self.create(s)
                if mode == 'source':
                    s.source_leaf.unlink()
                    s.source_leaf.write_bytes(b'not original')
                elif mode == 'permissions': s.source_leaf.chmod(0o600)
                elif mode == 'target':
                    s.link_leaf.unlink()
                    s.link_leaf.write_bytes(b'not original')
                else: s.link_group.rename(s.link_parent / 'retired')
                with self.assertRaises(ValueError): s.material._check()

    def test_legal_additional_link_does_not_invalidate_original_inode(self):
        with self.system() as s:
            self.create(s)
            NATIVE.link(s.source_leaf, s.source / 'other-group-synthetic.sock')
            self.assertEqual(s.link_leaf.stat().st_nlink, 3)
            s.material._check()

    def test_missing_or_unprotected_parent_rejects_before_claim(self):
        for mode in ('app-mode', 'app-owner', 'root-mode', 'root-missing'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'app-mode': s.source.chmod(0o750)
                elif mode == 'app-owner': s.owners[s.source.stat().st_ino] = (999, s.registration._gid)
                elif mode == 'root-mode': s.link_parent.chmod(0o770)
                else: s.link_parent.rmdir()
                with self.assertRaises(ValueError): self.create(s)
                self.assertNotIn('egress_claim', self.actions(s))

    def test_existing_target_or_fsync_failure_retains_claim_without_recreation(self):
        for mode in ('exists', 'fsync', 'link-error'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'exists': s.link_group.mkdir(mode=0o700)
                def fail(event):
                    if (mode == 'fsync' and event == 'fsync' and len(s.probes) == 2
                            or mode == 'link-error' and event == 'before-link'):
                        raise OSError('synthetic original operation failure')
                s.egress_hook = fail
                with self.assertRaises(ValueError): self.create(s)
                self.assertEqual(self.actions(s)[-1], 'egress_claim')
                self.assertTrue(s.link_group.exists())
                probes = len(s.probes)
                with self.assertRaises(ValueError): self.create(s)
                self.assertEqual(len(s.probes), probes)

    def test_journal_rejects_extra_fields_duplicate_and_ready_before_claim(self):
        for mode in ('extra', 'duplicate', 'ready-first', 'identity', 'after-credential'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'duplicate': self.create(s)
                elif mode == 'after-credential': s.material.prepare_role('anchor')
                elif mode == 'identity':
                    s.journal._run(lambda: s.journal._append({'version': 2, 'action': 'egress_claim', 'resource': s.resource}))
                row = {'version': 2, 'action': 'egress_claim', 'resource': s.resource}
                if mode == 'extra': row['fd'] = 12
                if mode in ('ready-first', 'identity'):
                    row.update(action='egress_ready', leafDevice=1, leafInode=0 if mode == 'identity' else 2,
                               challengeDigest='f' * 64)
                before = s.journal._expected
                with self.assertRaises(ValueError): s.journal._run(lambda: s.journal._append(row))
                self.assertEqual(s.journal._expected, before)

    def test_reopen_keeps_unknown_material_without_original_leaf_or_capability(self):
        with self.system() as s:
            self.create(s)
            s.material.close()
            s.journal.close()
            reopened = resource_journal.ResourceJournal.open(s.registration)
            try:
                row = reopened._resources[s.resource]['egress']
                self.assertEqual(set(row), {'state', 'leafDevice', 'leafInode', 'challengeDigest'})
                self.assertEqual(row['state'], 'ready')
                self.assertFalse(reopened.snapshot()['groupExitProven'])
            finally: reopened.close()
            with self.assertRaises(ValueError): self.create(s)

    def test_first_probe_cannot_connect_replacement_listener_after_source_symlink_swap(self):
        with self.system() as s, Socket(socket.AF_UNIX, socket.SOCK_STREAM) as replacement:
            cwd = NATIVE.open('.', NATIVE.O_RDONLY | NATIVE.O_DIRECTORY)
            try:
                NATIVE.chdir(s.source)
                replacement.bind('replacement.sock')
            finally: NATIVE.fchdir(cwd); NATIVE.close(cwd)
            replacement.listen(1)
            replacement.setblocking(False)
            def change(event):
                if event == 'before-connect':
                    s.source_leaf.rename(s.source / 'original.sock')
                    s.source_leaf.symlink_to('replacement.sock')
            s.egress_hook = change
            with self.assertRaises(ValueError): self.create(s)
            accepted = None
            try:
                try: accepted = replacement.accept()[0]
                except BlockingIOError: pass
                self.assertIsNone(accepted, 'root connected to the substituted listener')
            finally:
                if accepted is not None: accepted.close()

    def test_socket_timeout_is_refreshed_after_expensive_verification(self):
        for phase in ('send', 'receive'):
            with self.subTest(phase=phase), self.system() as s:
                now, observed, delayed = [100.0], [0], [False]
                original = egress._GroupEgress._check
                def check(item):
                    original(item)
                    if s.probe_sockets and s.probe_sockets[-1].peer is not None and not delayed[0]:
                        observed[0] += 1
                        # Checks after connect, before send, after send, before recv.
                        if observed[0] == (2 if phase == 'send' else 4):
                            now[0] += 4
                            delayed[0] = True
                with patch.object(fixtures.fixtures.material, 'time', SimpleNamespace(monotonic=lambda: now[0], monotonic_ns=time.monotonic_ns)), \
                        patch.object(egress._GroupEgress, '_check', check):
                    self.create(s)
                self.assertTrue(delayed[0])
                self.assertTrue(s.io_budgets)
                self.assertTrue(all(timeout <= remaining for timeout, remaining in s.io_budgets),
                                'socket received stale remaining budget')

    def test_later_fragment_or_original_process_death_or_timeout_never_records_ready(self):
        for mode in ('second-credentials', 'deadline', 'close-death', 'received-rights-close'):
            with self.subTest(mode=mode), self.system() as s:
                now, count = [100.0], [0]
                s.egress_chunk = 11
                if mode == 'received-rights-close': s.egress_mode = 'rights'
                def change(event):
                    if event == 'receive':
                        count[0] += 1
                        if mode == 'second-credentials' and count[0] == 2: s.egress_mode = 'credentials'
                        if mode == 'received-rights-close': s.material._egress.close()
                    if event == 'send' and mode == 'deadline': now[0] += 6
                    if event == 'probe-close' and mode == 'close-death': s.material._pin.close()
                s.egress_hook = change
                with patch.object(fixtures.fixtures.material, 'time', SimpleNamespace(monotonic=lambda: now[0], monotonic_ns=time.monotonic_ns)):
                    with self.assertRaises(ValueError): self.create(s)
                self.assertNotIn('egress_ready', self.actions(s))
                self.assertNotIn('<egress-unwanted-right>', s.owned.values())
                if mode == 'second-credentials': self.assertEqual(count[0], 2)

    def test_outer_final_failure_closes_original_leaf_while_writer_still_exclusive(self):
        with self.system() as s:
            original_create = egress._GroupEgress._create_locked
            original_guard, original_close = s.journal._guard, egress.os.close
            returned, acquired = [False], []
            def create(item):
                original_create(item)
                returned[0] = True
            def guard():
                original_guard()
                if returned[0]: raise ValueError('synthetic final writer failure')
            def close(fd):
                leaf = s.owned.get(fd) == '<egress-original-leaf>'
                original_close(fd)
                if returned[0] and leaf:
                    try: other = resource_journal.ResourceJournal.open(s.registration)
                    except ValueError: acquired.append(False)
                    else:
                        acquired.append(True); other.close()
            with patch.object(egress._GroupEgress, '_create_locked', create), \
                    patch.object(s.journal, '_guard', guard), patch.object(egress.os, 'close', close):
                with self.assertRaises(ValueError): self.create(s)
            self.assertTrue(returned[0])
            self.assertEqual(acquired, [False])
            self.assertTrue(s.link_leaf.exists())


if __name__ == '__main__':
    unittest.main()
