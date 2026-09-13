"""Real durable shared journal; synthetic root/NSS boundaries only."""
import contextlib
import json
import unittest
from unittest.mock import patch

import resource_journal
import slot_identity
import test_resource_journal
import test_slot_identity
from protocol import decode_request
from quartet_protocol import decode_quartet_request

try:
    import quartet_journal
except ModuleNotFoundError as error:
    if error.name != 'quartet_journal':
        raise
    quartet_journal = None


class QuartetJournalTests(unittest.TestCase):
    def test_original_create_scope_can_veto_preparation_before_write(self):
        with self.system() as s:
            before = s.contents()
            with self.assertRaises(ValueError):
                quartet_journal.prepare_quartet(s.journal, self.request(), scope_guard=lambda: 0)
            self.assertEqual(s.contents(), before)

    def test_data_child_key_does_not_authorize_management_query(self):
        from quartet_protocol import _derive_data_key
        with self.system() as s:
            self.prepare(s)
            row = self.rows(s)[0]
            child = _derive_data_key(row['capability'], row['candidate'], row['boot'], row['resource'])
            request = decode_quartet_request(json.dumps({'version': 2, 'action': 'query',
                'requestId': 'd' * 32, 'boot': row['boot'], 'capability': child}).encode())
            self.deny(lambda: quartet_journal.query_quartet(s.journal, request))

    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(quartet_journal, 'whole-group journal missing')
        # NSS and root path metadata are separate synthetic OS boundaries;
        # the implementation still opens/writes/fsyncs/flocks the real file.
        with test_resource_journal.JournalTests().system() as s:
            journal = resource_journal.ResourceJournal.open(s.registration)
            with test_slot_identity.SlotIdentityTests().system() as identities:
                s.journal, s.identities = journal, identities
                try:
                    yield s
                finally:
                    s.journal.close()

    def request(self, **overrides):
        return decode_quartet_request(json.dumps({'version': 2, 'action': 'create',
            'requestId': 'c' * 32, 'boot': 'b' * 32, 'slot': 0} | overrides).encode())

    def prepare(self, s, **overrides):
        return quartet_journal.prepare_quartet(s.journal, self.request(**overrides))

    def rows(self, s):
        return [json.loads(line) for line in s.contents().splitlines()][1:]

    def deny(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_QUARTET_JOURNAL_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_prepare_persists_two_distinct_capabilities_fixed_identity_and_reuses_request(self):
        with self.system() as s:
            handle = self.prepare(s)
            self.assertIs(self.prepare(s), handle)
            rows = self.rows(s)
            self.assertEqual(len(rows), 1)
            self.assertEqual((rows[0]['version'], rows[0]['component'], rows[0]['slot']), (2, 'quartet', 0))
            self.assertEqual((rows[0]['uid'], rows[0]['gid']), (2001, 2001))
            self.assertNotEqual(rows[0]['capability'], rows[0]['egressCapability'])
            self.assertEqual(len(rows[0]['policyDigest']), 64)
            self.assertGreaterEqual(len(s.syncs), 2)
            self.assertEqual(s.journal.snapshot()['prepared'], 1)
            self.assertNotIn(rows[0]['capability'], repr(handle))

    def test_old_v1_role_and_whole_group_cannot_occupy_same_slot_in_either_order(self):
        for group_first in (True, False):
            with self.subTest(group_first=group_first), self.system() as s:
                legacy = decode_request(json.dumps({'version': 1, 'action': 'create', 'requestId': 'd' * 32,
                    'boot': 'b' * 32, 'component': 'brave', 'slot': 0}).encode())
                if group_first:
                    self.prepare(s)
                    before = s.contents()
                    with self.assertRaises(ValueError):
                        s.journal.prepare(legacy)
                else:
                    s.journal.prepare(legacy)
                    before = s.contents()
                    self.deny(lambda: self.prepare(s))
                self.assertEqual(s.contents(), before)

    def test_two_slots_share_one_lock_but_not_identity_or_tokens(self):
        with self.system() as s:
            self.prepare(s)
            self.prepare(s, slot=1, requestId='d' * 32)
            rows = self.rows(s)
            self.assertEqual([row['uid'] for row in rows], [2001, 2002])
            self.assertEqual(len({row[key] for row in rows for key in ('capability', 'egressCapability')}), 4)
            with self.assertRaises(ValueError):
                resource_journal.ResourceJournal.open(s.registration)
            self.assertEqual(s.journal.snapshot()['total'], 2)

    def test_unlisted_slot_wrong_boot_changed_policy_and_identity_do_not_append(self):
        for mode in ('slot', 'boot', 'nss', 'policy'):
            with self.subTest(mode=mode), self.system() as s:
                self.prepare(s)
                before = s.contents()
                changes = {'requestId': 'd' * 32, 'slot': 1}
                if mode == 'slot':
                    changes['slot'] = 2
                elif mode == 'boot':
                    changes['boot'] = 'e' * 32
                elif mode == 'nss':
                    s.identities.second.pw_shell = '/bin/sh'
                else:
                    slot_identity._POLICY = b'{}'
                self.deny(lambda: self.prepare(s, **changes))
                self.assertEqual(s.contents(), before)

    def test_management_query_rejects_egress_token_and_legacy_decoder_consumer(self):
        for token in ('capability', 'egressCapability'):
            with self.system() as s:
                handle = self.prepare(s)
                row = self.rows(s)[0]
                query = decode_quartet_request(json.dumps({'version': 2, 'action': 'query',
                    'requestId': 'd' * 32, 'boot': 'b' * 32, 'capability': row[token]}).encode())
                if token == 'capability':
                    self.assertEqual(quartet_journal.query_quartet(s.journal, query),
                                     {'state': 'prepared', 'groupExitProven': False})
                    with self.assertRaises(ValueError):
                        s.journal.claim_dispatch(handle)
                else:
                    self.deny(lambda: quartet_journal.query_quartet(s.journal, query))

    def test_legacy_query_cannot_consume_group_management_capability(self):
        with self.system() as s:
            self.prepare(s)
            query = decode_request(json.dumps({'version': 1, 'action': 'query', 'requestId': 'd' * 32,
                'boot': 'b' * 32, 'capability': self.rows(s)[0]['capability']}).encode())
            with self.assertRaises(ValueError):
                s.journal.query(query)

    def test_partial_write_or_sync_failure_preserves_unknown_bytes(self):
        for mode in ('write', 'fsync'):
            with self.system() as s:
                if mode == 'write':
                    def partial(fd, data):
                        test_resource_journal.NATIVE.write(fd, data[:10])
                        raise OSError('synthetic partial append')
                    s.proxy.write = partial
                else:
                    s.proxy.fsync = lambda fd: (_ for _ in ()).throw(OSError('synthetic sync failure'))
                self.deny(lambda: self.prepare(s))
                self.assertGreater(len(s.contents()), 34)
                self.assertEqual(s.opened, set())

    def test_reopen_preserves_group_and_foreign_boot_blocks_new_work(self):
        with self.system() as s:
            self.prepare(s)
            before = s.contents()
            s.journal.close()
            s.journal = resource_journal.ResourceJournal.open(s.registration)
            self.prepare(s)
            self.assertEqual(s.contents(), before)
            s.journal.close()
            changed = before.replace(('b' * 32).encode(), ('e' * 32).encode())
            s.path.write_bytes(changed)
            s.journal = resource_journal.ResourceJournal.open(s.registration)
            self.assertTrue(s.journal.snapshot()['foreignBoot'])
            self.deny(lambda: self.prepare(s, slot=1, requestId='d' * 32))
            self.assertEqual(s.contents(), changed)

    def test_v1_entropy_collision_with_either_group_token_is_rejected(self):
        for key in ('capability', 'egressCapability'):
            with self.system() as s:
                self.prepare(s)
                row = self.rows(s)[0]
                raw = iter((b'\x44' * 16, bytes.fromhex(row[key])))
                s.proxy.urandom = lambda size: next(raw)
                legacy = decode_request(json.dumps({'version': 1, 'action': 'create', 'requestId': 'd' * 32,
                    'boot': 'b' * 32, 'component': 'brave', 'slot': 1}).encode())
                before = s.contents()
                with self.assertRaises(ValueError):
                    s.journal.prepare(legacy)
                self.assertEqual(s.contents(), before)

    def test_entropy_collision_zero_or_wrong_type_never_returns_handle(self):
        for mode in ('equal', 'zero', 'type'):
            with self.system() as s:
                before = s.contents()
                s.proxy.urandom = lambda size: 'x' * size if mode == 'type' else (b'\0' if mode == 'zero' else b'x') * size
                self.deny(lambda: self.prepare(s))
                self.assertEqual(s.contents(), before)

    def test_short_writes_and_close_during_sync_keep_same_exclusive_owner(self):
        with self.system() as s:
            s.proxy.write = lambda fd, data: test_resource_journal.NATIVE.write(fd, data[:9])
            self.prepare(s)
            self.assertEqual(len(self.rows(s)), 1)
        with self.system() as s:
            def sync(fd):
                s.journal.close()
                with self.assertRaises(ValueError):
                    resource_journal.ResourceJournal.open(s.registration)
                test_resource_journal.NATIVE.fsync(fd)
            s.proxy.fsync = sync
            self.deny(lambda: self.prepare(s))
            self.assertGreater(len(s.contents()), 34)
            self.assertEqual(s.opened, set())

    def test_five_role_dispatch_observation_is_strictly_ordered_and_not_readiness(self):
        with self.system() as s:
            self.prepare(s)
            resource = self.rows(s)[0]['resource']
            for index, role in enumerate(('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify'), 1):
                common = {'version': 2, 'resource': resource, 'role': role}
                s.journal._run(lambda: s.journal._append(common | {'action': 'role_dispatch',
                    'unit': 'holaday-pool-' + role + '-' + resource + '.service',
                    'managerGuid': 'd' * 32, 'managerOwner': ':1.4'}))
                s.journal._run(lambda: s.journal._append(common | {'action': 'role_accepted',
                    'job': '/org/freedesktop/systemd1/job/' + str(index)}))
                s.journal._run(lambda: s.journal._append(common | {'action': 'role_observe',
                    'invocation': str(index) * 32}))
            self.assertEqual(s.journal.snapshot()['dispatching'], 1)
            self.assertFalse(s.journal.snapshot()['groupExitProven'])
            s.journal.close()
            s.journal = resource_journal.ResourceJournal.open(s.registration)
            self.assertEqual(s.journal._resources[resource]['state'], 'observed')
            self.assertEqual(len(s.journal._resources[resource]['roles']), 5)

    def test_unknown_dispatch_is_not_reissued_or_skipped_after_reopen(self):
        for action in ('retry', 'skip', 'manager', 'terminal'):
            with self.system() as s:
                self.prepare(s)
                resource = self.rows(s)[0]['resource']
                dispatch = {'version': 2, 'action': 'role_dispatch', 'resource': resource, 'role': 'anchor',
                    'unit': 'holaday-pool-anchor-' + resource + '.service',
                    'managerGuid': 'd' * 32, 'managerOwner': ':1.4'}
                s.journal._run(lambda: s.journal._append(dispatch))
                s.journal.close()
                s.journal = resource_journal.ResourceJournal.open(s.registration)
                before = s.contents()
                if action == 'skip':
                    dispatch = dispatch | {'role': 'xvfb', 'unit': 'holaday-pool-xvfb-' + resource + '.service'}
                elif action == 'manager':
                    dispatch = dispatch | {'managerOwner': ':1.5'}
                elif action == 'terminal':
                    dispatch = {'version': 2, 'action': 'terminal', 'resource': resource}
                with self.assertRaises(ValueError):
                    s.journal._run(lambda: s.journal._append(dispatch))
                self.assertEqual(s.contents(), before)

    def test_observed_anchor_does_not_allow_next_role_on_a_different_manager(self):
        for field, value in (('managerGuid', 'e' * 32), ('managerOwner', ':1.5')):
            with self.subTest(field=field), self.system() as s:
                self.prepare(s)
                resource = self.rows(s)[0]['resource']
                common = {'version': 2, 'resource': resource, 'role': 'anchor'}
                s.journal._run(lambda: s.journal._append(common | {'action': 'role_dispatch',
                    'unit': 'holaday-pool-anchor-' + resource + '.service',
                    'managerGuid': 'd' * 32, 'managerOwner': ':1.4'}))
                s.journal._run(lambda: s.journal._append(common | {'action': 'role_accepted',
                    'job': '/org/freedesktop/systemd1/job/1'}))
                s.journal._run(lambda: s.journal._append(common | {'action': 'role_observe',
                    'invocation': '1' * 32}))
                before = s.contents()
                next_role = common | {'action': 'role_dispatch', 'role': 'xvfb',
                    'unit': 'holaday-pool-xvfb-' + resource + '.service',
                    'managerGuid': 'd' * 32, 'managerOwner': ':1.4', field: value}
                with self.assertRaises(ValueError):
                    s.journal._run(lambda: s.journal._append(next_role))
                self.assertEqual(s.contents(), before)

    def test_all_32_slots_have_fixed_capacity_without_a_33rd_or_uid_reuse(self):
        with self.system() as s:
            self.prepare(s)
            template = self.rows(s)[0]
        rows = [template | {'revision': i + 1, 'resource': format(i + 1, '032x'),
            'requestId': format(i + 1, '032x'), 'slot': i, 'uid': 2001 + i, 'gid': 2001 + i,
            'capability': format(100 + i, '064x'), 'egressCapability': format(200 + i, '064x')}
            for i in range(32)]
        def payload(values):
            return b'{"version":1,"action":"initialize"}\n' + b''.join(json.dumps(row).encode() + b'\n' for row in values)
        resources, _, revision = resource_journal._replay(payload(rows))
        self.assertEqual((len(resources), revision), (32, 32))
        with self.assertRaises(ValueError):
            resource_journal._replay(payload(rows + [rows[-1] | {'revision': 33, 'slot': 32}]))
        for changes in ({'uid': 2001}, {'gid': 2001}, {'policyDigest': 'f' * 64}):
            with self.assertRaises(ValueError):
                resource_journal._replay(payload(rows[:-1] + [rows[-1] | changes]))


if __name__ == '__main__':
    unittest.main()
