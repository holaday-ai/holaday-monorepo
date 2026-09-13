"""B2 NSS boundary tests: synthetic accounts only, never host account changes."""

import contextlib
import copy
import dataclasses
import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

try:
    import slot_identity
except ModuleNotFoundError as error:
    if error.name != 'slot_identity':
        raise
    slot_identity = None


class PrivateRecord(SimpleNamespace):
    @property
    def pw_passwd(self):
        raise AssertionError('password must not be read')

    @property
    def pw_gecos(self):
        raise AssertionError('personal metadata must not be read')

    @property
    def gr_passwd(self):
        raise AssertionError('group password must not be read')


class SlotIdentityTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(slot_identity, 'B2 identity inspection missing')
        policy = {'version': 1, 'status': 'linux-verified', 'candidate': 'a' * 40,
                  'capacity': 2, 'slots': [{'slot': 0, 'uid': 2001, 'gid': 2001},
                                          {'slot': 1, 'uid': 2002, 'gid': 2002}]}
        app = PrivateRecord(pw_name='holaday', pw_uid=998, pw_gid=998,
                            pw_dir='/var/lib/holaday', pw_shell='/usr/sbin/nologin')
        first = PrivateRecord(pw_name='holaday-pool-slot-00', pw_uid=2001, pw_gid=2001,
                              pw_dir='/var/lib/holaday-pool-slots/slot-00', pw_shell='/usr/sbin/nologin')
        second = PrivateRecord(pw_name='holaday-pool-slot-01', pw_uid=2002, pw_gid=2002,
                               pw_dir='/var/lib/holaday-pool-slots/slot-01', pw_shell='/usr/sbin/nologin')
        users = [app, first, second]
        groups = [PrivateRecord(gr_name=u.pw_name, gr_gid=u.pw_gid, gr_mem=[]) for u in users]
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(sys, 'platform', 'linux'))
            stack.enter_context(patch.object(slot_identity, '_POLICY', json.dumps(policy).encode(), create=True))
            mocks = {}
            for obj, name, fn in (
                (slot_identity.os, 'geteuid', lambda: 0),
                (slot_identity.pwd, 'getpwall', lambda: users),
                (slot_identity.pwd, 'getpwnam', lambda name: next(u for u in users if u.pw_name == name)),
                (slot_identity.pwd, 'getpwuid', lambda uid: next(u for u in users if u.pw_uid == uid)),
                (slot_identity.grp, 'getgrall', lambda: groups),
                (slot_identity.grp, 'getgrnam', lambda name: next(g for g in groups if g.gr_name == name)),
                (slot_identity.grp, 'getgrgid', lambda gid: next(g for g in groups if g.gr_gid == gid)),
                (slot_identity.os, 'getgrouplist', lambda name, gid: [gid]),
            ):
                mocks[name] = stack.enter_context(patch.object(obj, name, side_effect=fn))
            yield SimpleNamespace(policy=policy, app=app, first=first, second=second,
                                  users=users, groups=groups, mocks=mocks)

    def inspect(self):
        return slot_identity.inspect_slot_identities('a' * 40)

    def deny(self, fn):
        with self.assertRaises(ValueError) as caught:
            fn()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_SLOT_IDENTITY_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_selects_only_fixed_distinct_slots_and_hides_metadata(self):
        with self.system():
            snapshot = self.inspect()
            self.assertEqual(snapshot.candidate, 'a' * 40)
            self.assertEqual(snapshot.capacity, 2)
            self.assertEqual((snapshot.for_slot(0).uid, snapshot.for_slot(1).uid), (2001, 2002))
            self.assertEqual(snapshot.for_slot(1).home, '/var/lib/holaday-pool-slots/slot-01')
            self.assertEqual(snapshot.for_slot(1).name, 'holaday-pool-slot-01')
            for value in ('2001', '2002', 'holaday', 'a' * 40):
                self.assertNotIn(value, repr(snapshot))
                self.assertNotIn(value, repr(snapshot.for_slot(0)))
            with self.assertRaises(dataclasses.FrozenInstanceError):
                snapshot.for_slot(0).uid = 0
            for slot in (-1, 2, 32, True, 0.0, '0', None):
                self.deny(lambda: snapshot.for_slot(slot))

    def test_policy_must_be_loaded_verified_and_candidate_bound(self):
        with self.system() as s:
            for raw in (None, b'', b'{}', b'[]', b' ' * 8193, json.dumps(s.policy),
                        json.dumps(s.policy | {'status': 'unverified'}).encode(),
                        json.dumps(s.policy | {'candidate': 'b' * 40}).encode(),
                        json.dumps(s.policy | {'version': True}).encode(),
                        json.dumps(s.policy | {'extra': True}).encode()):
                with patch.object(slot_identity, '_POLICY', raw):
                    self.deny(self.inspect)
            s.mocks['getpwall'].assert_not_called()

    def test_exact_slot_capacity_and_ids_reject_aliases_and_arbitrary_account_fields(self):
        with self.system() as s:
            variants = [s.policy | {'capacity': value} for value in (0, 1, 3, 33, True, 2.0, '2')]
            variants += [s.policy | {'slots': slots} for slots in ([], {}, list(reversed(s.policy['slots'])))]
            for field, values in (('slot', (True, 1, -1, 32, 0.0)),
                                  ('uid', (0, 998, 65534, 4294967295, True, 2002)),
                                  ('gid', (0, 998, 65534, 4294967295, True, 2002)),
                                  ('name', ('root',)), ('home', ('/root',)), ('shell', ('/bin/sh',))):
                for value in values:
                    policy = copy.deepcopy(s.policy)
                    policy['slots'][0][field] = value
                    variants.append(policy)
            for policy in variants:
                with patch.object(slot_identity, '_POLICY', json.dumps(policy).encode()):
                    self.deny(self.inspect)

    def test_duplicate_keys_json_constants_bom_invalid_utf8_reject(self):
        with self.system() as s:
            raw = json.dumps(s.policy).encode()
            for invalid in (raw.replace(b'"version": 1', b'"version": 1, "version": 1'),
                            raw.replace(b'"uid": 2001', b'"uid": NaN'), b'\xef\xbb\xbf' + raw, b'\xff'):
                with patch.object(slot_identity, '_POLICY', invalid):
                    self.deny(self.inspect)

    def test_non_root_non_linux_invalid_candidate_reject_before_nss(self):
        with self.system() as s:
            for candidate in ('', 'A' * 40, '0' * 40, None, '../' + 'a' * 40):
                self.deny(lambda: slot_identity.inspect_slot_identities(candidate))
            with patch.object(sys, 'platform', 'darwin'):
                self.deny(self.inspect)
            s.mocks['geteuid'].side_effect = lambda: 998
            self.deny(self.inspect)
            s.mocks['getpwall'].assert_not_called()

    def test_each_slot_shell_home_uid_gid_name_and_app_conflict_reject(self):
        for role, field, value in (
            ('first', 'pw_shell', '/bin/sh'), ('second', 'pw_dir', '/var/lib/holaday'),
            ('first', 'pw_uid', 2002), ('second', 'pw_gid', 2001),
            ('first', 'pw_name', 'holaday-browser-pool'), ('app', 'pw_dir', '/root'),
            ('app', 'pw_gid', 2001), ('first', 'pw_uid', True),
        ):
            with self.subTest(role=role, field=field), self.system() as s:
                setattr(getattr(s, role), field, value)
                self.deny(self.inspect)

    def test_hidden_primary_members_uid_name_and_group_aliases_reject(self):
        for mode in ('uid', 'name', 'primary', 'gid', 'group-name', 'supplementary'):
            with self.subTest(mode=mode), self.system() as s:
                if mode in ('uid', 'name', 'primary'):
                    extra = PrivateRecord(pw_name='other', pw_uid=3000, pw_gid=3000,
                                          pw_dir='/nonexistent', pw_shell='/usr/sbin/nologin')
                    setattr(extra, {'uid': 'pw_uid', 'name': 'pw_name', 'primary': 'pw_gid'}[mode],
                            'holaday-pool-slot-00' if mode == 'name' else 2001)
                    s.users.append(extra)
                else:
                    s.groups.append(PrivateRecord(gr_name='holaday-pool-slot-00' if mode == 'group-name' else 'other',
                        gr_gid=2001 if mode == 'gid' else 3000,
                        gr_mem=['holaday-pool-slot-00'] if mode == 'supplementary' else []))
                self.deny(self.inspect)

    def test_cross_slot_and_app_supplementary_members_and_lookup_disagreement_reject(self):
        for mode in ('cross-slot', 'app-slot', 'getpwuid', 'getgrgid', 'group-member'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'cross-slot':
                    s.mocks['getgrouplist'].side_effect = lambda name, gid: [gid, 2002] if gid == 2001 else [gid]
                elif mode == 'app-slot':
                    s.mocks['getgrouplist'].side_effect = lambda name, gid: [gid, 2001] if gid == 998 else [gid]
                elif mode == 'group-member':
                    s.groups[1].gr_mem = ['holaday-pool-slot-01']
                else:
                    s.mocks[mode].side_effect = lambda value: s.app if mode == 'getpwuid' else s.groups[0]
                self.deny(self.inspect)

    def test_nss_failure_incomplete_or_overlarge_enumeration_is_private(self):
        for name in ('getpwall', 'getgrall', 'getpwnam', 'getpwuid', 'getgrnam', 'getgrgid', 'getgrouplist'):
            with self.subTest(name=name), self.system() as s:
                s.mocks[name].side_effect = OSError('synthetic private NSS failure')
                self.deny(self.inspect)
        for name in ('getpwall', 'getgrall', 'getgrouplist'):
            for value in ([], [None] * 4097, None):
                with self.system() as s:
                    s.mocks[name].side_effect = lambda *args: value
                    self.deny(self.inspect)

    def test_fresh_inspection_rejects_identity_change_instead_of_caching_permission(self):
        with self.system() as s:
            original = self.inspect()
            s.second.pw_shell = '/bin/sh'
            self.deny(self.inspect)
            self.assertEqual(original.for_slot(1).uid, 2002)

    def test_other_users_derived_membership_cannot_enter_slot_group(self):
        with self.system() as s:
            s.users.append(PrivateRecord(pw_name='outsider', pw_uid=3000, pw_gid=3000,
                                         pw_dir='/nonexistent', pw_shell='/usr/sbin/nologin'))
            s.groups.append(PrivateRecord(gr_name='outsider', gr_gid=3000, gr_mem=[]))
            s.mocks['getgrouplist'].side_effect = lambda name, gid: [gid, 2001] if name == 'outsider' else [gid]
            self.deny(self.inspect)

    def test_normal_root_and_nobody_nss_groups_do_not_fail_slot_policy(self):
        with self.system() as s:
            for name, number in (('root', 0), ('nobody', 65534)):
                s.users.append(PrivateRecord(pw_name=name, pw_uid=number, pw_gid=number,
                                             pw_dir='/nonexistent', pw_shell='/usr/sbin/nologin'))
                s.groups.append(PrivateRecord(gr_name=name, gr_gid=number, gr_mem=[]))
            self.assertEqual(self.inspect().capacity, 2)


if __name__ == '__main__':
    unittest.main()
