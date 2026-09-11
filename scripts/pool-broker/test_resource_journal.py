"""Real file/append/fsync/flock; only fixed path, root ownership and pidfd are synthetic."""

import contextlib
import json
import os
import pickle
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import launch_listener
from protocol import decode_request
import test_launch_listener

NATIVE = SimpleNamespace(**vars(os))

try:
    import resource_journal
except ModuleNotFoundError as error:
    if error.name != 'resource_journal':
        raise
    resource_journal = None


class JournalTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, raw=b'{"version":1,"action":"initialize"}\n'):
        self.assertIsNotNone(resource_journal, 'durable resource journal missing')
        with tempfile.TemporaryDirectory(prefix='holaday-journal-') as directory:
            root = Path(directory)
            parent = root / 'var/lib/holaday-pool-broker'
            parent.mkdir(parents=True)
            parent.chmod(0o700)
            path = parent / 'resource-journal.jsonl'
            if raw is not None:
                path.write_bytes(raw)
                path.chmod(0o600)
            with test_launch_listener.ListenerTests().system() as base, contextlib.ExitStack() as stack:
                listener = launch_listener.RootLaunchListener.open('a' * 40)
                listener.accept_once()
                proxy = SimpleNamespace(**vars(NATIVE))
                opened, closed, syncs = set(), [], []
                def open_file(name, flags, *args, **kwargs):
                    target = str(root) if name == '/' else name
                    fd = NATIVE.open(target, flags, *args, **kwargs)
                    opened.add(fd)
                    return fd
                def close(fd):
                    opened.remove(fd)
                    closed.append(fd)
                    NATIVE.close(fd)
                def root_info(info):
                    return SimpleNamespace(st_uid=0, st_gid=0, st_mode=info.st_mode, st_nlink=info.st_nlink,
                        st_size=info.st_size, st_dev=info.st_dev, st_ino=info.st_ino)
                proxy.open, proxy.close = open_file, close
                # Linux ACL/capability metadata is synthetic on this macOS host.
                proxy.listxattr = lambda fd: []
                proxy.fstat = lambda fd: root_info(NATIVE.fstat(fd))
                proxy.stat = lambda *args, **kwargs: root_info(NATIVE.stat(*args, **kwargs))
                def sync(fd):
                    NATIVE.fsync(fd)
                    syncs.append(fd)
                proxy.fsync = sync
                stack.enter_context(patch.object(resource_journal, 'os', proxy))
                def contents():
                    fd = NATIVE.open(str(path), NATIVE.O_RDONLY)
                    try: return NATIVE.read(fd, 262145)
                    finally: NATIVE.close(fd)
                yield SimpleNamespace(base=base, listener=listener, registration=listener._registration,
                    path=path, proxy=proxy, opened=opened, closed=closed, syncs=syncs, contents=contents)
                listener.close()
                self.assertEqual(opened, set(), 'journal leaked owned descriptors')

    def request(self, **changes):
        data = {'version': 1, 'action': 'create', 'requestId': 'c' * 32, 'boot': 'b' * 32,
                'component': 'brave', 'slot': 1}
        data.update(changes)
        return decode_request(json.dumps(data).encode())

    def denied(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_RESOURCE_JOURNAL_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_prepare_is_durable_and_duplicate_request_reuses_same_resource(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            handle = journal.prepare(self.request())
            self.assertIs(journal.prepare(self.request()), handle)
            rows = [json.loads(line) for line in s.contents().splitlines()]
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[1]['action'], 'prepare')
            self.assertEqual(rows[1]['candidate'], 'a' * 40)
            self.assertEqual(rows[1]['boot'], 'b' * 32)
            self.assertEqual(len(rows[1]['capability']), 64)
            self.assertGreaterEqual(len(s.syncs), 2)
            self.assertEqual(journal.snapshot(), {'total': 1, 'prepared': 1, 'dispatching': 0,
                'foreignBoot': False, 'groupExitProven': False})
            journal.close()

    def test_dispatch_claim_persists_and_cannot_be_replayed_after_reopen(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            handle = journal.prepare(self.request())
            self.assertIsNone(journal.claim_dispatch(handle))
            self.assertEqual(journal.snapshot(), {'total': 1, 'prepared': 0, 'dispatching': 1,
                'foreignBoot': False, 'groupExitProven': False})
            journal.close()
            reopened = resource_journal.ResourceJournal.open(s.registration)
            handle2 = reopened.prepare(self.request())
            self.denied(lambda: reopened.claim_dispatch(handle2))
            self.assertEqual(len(s.contents().splitlines()), 3)

    def test_private_capability_query_never_proves_group_exit(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            journal.prepare(self.request())
            cap = json.loads(s.contents().splitlines()[1])['capability']
            query = decode_request(json.dumps({'version': 1, 'action': 'query', 'requestId': 'd' * 32,
                'boot': 'b' * 32, 'capability': cap}).encode())
            self.assertEqual(journal.query(query), {'state': 'prepared', 'groupExitProven': False})
            journal.close()

    def test_missing_empty_malformed_and_partial_journals_fail_closed(self):
        for raw in (None, b'', b'{}\n', b'{"version":1,"action":"initialize"}',
                    b'{"version":true,"action":"initialize"}\n',
                    b'{"version":1,"version":1,"action":"initialize"}\n', b'x' * 262145):
            with self.subTest(size=None if raw is None else len(raw)), self.system(raw) as s:
                self.denied(lambda: resource_journal.ResourceJournal.open(s.registration))

    def test_real_exclusive_lock_rejects_a_second_writer(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            self.denied(lambda: resource_journal.ResourceJournal.open(s.registration))
            journal.prepare(self.request())
            journal.close()

    def test_same_request_conflict_and_slot_collision_do_not_add_records(self):
        for request in (dict(slot=2), dict(requestId='d' * 32)):
            with self.subTest(request=request), self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                journal.prepare(self.request())
                self.denied(lambda: journal.prepare(self.request(**request)))
                self.assertEqual(len(s.contents().splitlines()), 2)

    def test_short_writes_are_completed_before_handle_is_returned(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            s.proxy.write = lambda fd, data: NATIVE.write(fd, data[:7])
            journal.prepare(self.request())
            self.assertEqual(len(s.contents().splitlines()), 2)
            self.assertEqual(json.loads(s.contents().splitlines()[1])['component'], 'brave')
            journal.close()

    def test_partial_write_and_sync_failure_never_delete_uncertain_bytes(self):
        for boundary in ('write', 'fsync'):
            with self.subTest(boundary=boundary), self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                if boundary == 'write':
                    def partial(fd, data):
                        NATIVE.write(fd, data[:10])
                        raise OSError('synthetic private failure')
                    s.proxy.write = partial
                else:
                    s.proxy.fsync = lambda fd: (_ for _ in ()).throw(OSError('synthetic sync'))
                self.denied(lambda: journal.prepare(self.request()))
                self.assertGreater(len(s.contents()), 34)
                self.assertEqual(s.opened, set())

    def test_foreign_boot_preserves_records_and_blocks_new_prepare(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            journal.prepare(self.request())
            journal.close()
            raw = s.contents().replace(('b' * 32).encode(), ('e' * 32).encode())
            s.path.write_bytes(raw)
            reopened = resource_journal.ResourceJournal.open(s.registration)
            self.assertTrue(reopened.snapshot()['foreignBoot'])
            self.denied(lambda: reopened.prepare(self.request(requestId='d' * 32, slot=2)))
            self.assertEqual(s.contents(), raw)

    def test_corrupt_replay_and_illegal_transition_are_not_repaired(self):
        for mutation in ('duplicate', 'revision', 'terminal', 'partial'):
            with self.subTest(mutation=mutation), self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                journal.prepare(self.request())
                journal.close()
                raw = s.contents()
                if mutation == 'duplicate': raw += raw.splitlines(keepends=True)[1]
                elif mutation == 'revision': raw = raw.replace(b'"revision":1', b'"revision":9')
                elif mutation == 'terminal': raw += b'{"version":1,"action":"terminal"}\n'
                else: raw += b'{"version":'
                s.path.write_bytes(raw)
                self.denied(lambda: resource_journal.ResourceJournal.open(s.registration))
                self.assertEqual(s.contents(), raw)

    def test_copied_or_previous_writer_handle_does_not_authorize_dispatch(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            handle = journal.prepare(self.request())
            with self.assertRaises(TypeError): pickle.dumps(handle)
            journal.close()
            reopened = resource_journal.ResourceJournal.open(s.registration)
            self.denied(lambda: reopened.claim_dispatch(handle))
            self.assertEqual(len(s.contents().splitlines()), 2)

    def test_reentrant_close_keeps_lock_until_write_or_fsync_unwinds(self):
        for boundary in ('write', 'fsync'):
            with self.subTest(boundary=boundary), self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                original = getattr(s.proxy, boundary)
                def interrupted(*args):
                    result = original(*args)
                    journal.close()
                    self.denied(lambda: resource_journal.ResourceJournal.open(s.registration))
                    return result
                setattr(s.proxy, boundary, interrupted)
                self.denied(lambda: journal.prepare(self.request()))
                self.assertEqual(s.opened, set())
                self.assertGreater(len(s.contents()), 34)

    def test_content_and_path_replacement_poison_writer(self):
        for replacement in (False, True):
            with self.subTest(replacement=replacement), self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                if replacement:
                    changed = s.path.with_suffix('.new')
                    changed.write_bytes(b'{"version":1,"action":"initialize"}\n')
                    NATIVE.chmod(str(changed), 0o600)
                    NATIVE.replace(str(changed), str(s.path))
                else: s.path.write_bytes(b'corrupt\n')
                self.denied(lambda: journal.prepare(self.request()))
                self.assertEqual(s.opened, set())

    def test_wrong_capability_or_boot_never_reveals_resource(self):
        for field in ('capability', 'boot'):
            with self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                journal.prepare(self.request())
                cap = json.loads(s.contents().splitlines()[1])['capability']
                data = {'version': 1, 'action': 'query', 'requestId': 'd' * 32,
                        'boot': 'b' * 32, 'capability': cap}
                data[field] = 'e' * (64 if field == 'capability' else 32)
                self.denied(lambda: journal.query(decode_request(json.dumps(data).encode())))

    def test_zero_random_and_capability_collision_do_not_append(self):
        for collision in (False, True):
            with self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                if collision:
                    journal.prepare(self.request())
                    cap = json.loads(s.contents().splitlines()[1])['capability']
                    s.proxy.urandom = lambda count: bytes.fromhex(cap) if count == 32 else b'\xaa' * count
                else:
                    s.proxy.urandom = lambda count: b'\x00' * count
                before = s.contents()
                self.denied(lambda: journal.prepare(self.request(requestId='d' * 32, slot=2)))
                self.assertEqual(s.contents(), before)

    def test_permissions_acl_and_original_registration_revocation_fail_closed(self):
        for change in ('mode', 'acl', 'registration'):
            with self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                if change == 'mode': NATIVE.chmod(str(s.path), 0o620)
                elif change == 'acl': s.proxy.listxattr = lambda fd: ['system.posix_acl_access']
                else: s.registration.close()
                self.denied(lambda: journal.prepare(self.request()))
                self.assertEqual(s.contents(), b'{"version":1,"action":"initialize"}\n')

    def test_directory_replacement_invalidates_fixed_path_binding(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            parent = s.path.parent
            NATIVE.rename(str(parent), str(parent) + '.old')
            NATIVE.mkdir(str(parent), 0o700)
            self.denied(lambda: journal.prepare(self.request()))

    def test_short_reads_recover_all_records_and_early_eof_is_rejected(self):
        for early_eof in (False, True):
            with self.system() as s:
                journal = resource_journal.ResourceJournal.open(s.registration)
                journal.prepare(self.request())
                journal.close()
                raw = s.contents().replace(('b' * 32).encode(), ('e' * 32).encode())
                s.path.write_bytes(raw)
                chunk = len(b'{"version":1,"action":"initialize"}\n')
                def bounded(fd, count, offset):
                    if early_eof and offset >= chunk:
                        return b''
                    return NATIVE.pread(fd, min(count, chunk), offset)
                s.proxy.pread = bounded
                if early_eof:
                    self.denied(lambda: resource_journal.ResourceJournal.open(s.registration))
                else:
                    reopened = resource_journal.ResourceJournal.open(s.registration)
                    self.assertEqual(reopened.snapshot()['total'], 1)
                    self.assertTrue(reopened.snapshot()['foreignBoot'])
                    reopened.close()

    def test_close_failure_reports_fixed_error_after_all_once_only_cleanup(self):
        with self.system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            owned = set(s.opened)
            original = s.proxy.close
            def failure(fd):
                original(fd)
                raise OSError('synthetic close result unknown')
            s.proxy.close = failure
            self.denied(journal.close)
            self.assertEqual(set(s.closed), owned)
            self.assertEqual(len(s.closed), len(owned))
            self.denied(journal.snapshot)

    def test_full_role_slot_capacity_replays_without_proving_idle(self):
        rows = []
        for index in range(128):
            rows.append({'version': 1, 'action': 'prepare', 'revision': index + 1,
                'resource': format(index + 1, '032x'), 'capability': format(index + 1, '064x'),
                'candidate': 'a' * 40, 'boot': 'b' * 32, 'requestId': format(index + 1, '032x'),
                'component': ('xvfb', 'brave', 'x11vnc', 'websockify')[index // 32], 'slot': index % 32})
        raw = b'{"version":1,"action":"initialize"}\n' + b''.join(
            json.dumps(row, separators=(',', ':')).encode() + b'\n' for row in rows)
        with self.system(raw) as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            self.assertEqual(journal.snapshot(), {'total': 128, 'prepared': 128,
                'dispatching': 0, 'foreignBoot': False, 'groupExitProven': False})
            self.denied(lambda: journal.prepare(self.request()))
            self.assertEqual(s.contents(), raw)




if __name__ == '__main__':
    unittest.main()
