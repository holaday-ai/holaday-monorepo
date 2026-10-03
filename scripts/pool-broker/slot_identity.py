"""B2 fixed-slot NSS inspection. A snapshot is data, never launch authority."""

import grp
import hashlib
import json
import os
import pwd
import sys
from dataclasses import dataclass, field

from installation import _account_fields, _id, _name
from protocol import _identifier, _reject_constant, _unique_object

# Injected only by the hash-verifying release loader. Ordinary import is closed.
_POLICY: bytes


def _deny():
    try:
        raise ValueError('POOL_BROKER_SLOT_IDENTITY_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


@dataclass(frozen=True, slots=True)
class SlotIdentity:
    slot: int = field(repr=False)
    uid: int = field(repr=False)
    gid: int = field(repr=False)
    name: str = field(repr=False)
    home: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class SlotIdentitySnapshot:
    candidate: str = field(repr=False)
    policy_digest: str = field(repr=False)
    slots: tuple = field(repr=False)

    @property
    def capacity(self):
        return len(self.slots)

    def for_slot(self, slot):
        if type(slot) is not int or not 0 <= slot < len(self.slots):
            _deny()
        return self.slots[slot]


def _policy(raw, candidate):
    _identifier(candidate, 40)
    if type(raw) is not bytes or not 1 <= len(raw) <= 8192:
        raise ValueError()
    data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
                      parse_constant=_reject_constant)
    if (type(data) is not dict or set(data) != {'version', 'status', 'candidate', 'capacity', 'slots'}
            or type(data['version']) is not int or data['version'] != 1
            or data['status'] != 'linux-verified' or data['candidate'] != candidate
            or type(data['capacity']) is not int or not 1 <= data['capacity'] <= 32
            or type(data['slots']) is not list or len(data['slots']) != data['capacity']):
        raise ValueError()
    users, groups, slots = set(), set(), []
    for index, row in enumerate(data['slots']):
        if (type(row) is not dict or set(row) != {'slot', 'uid', 'gid'}
                or type(row['slot']) is not int or row['slot'] != index
                or not _id(row['uid']) or row['uid'] == 998 or row['uid'] in users
                or not _id(row['gid']) or row['gid'] == 998 or row['gid'] in groups):
            raise ValueError()
        users.add(row['uid'])
        groups.add(row['gid'])
        suffix = f'{index:02d}'
        slots.append(SlotIdentity(index, row['uid'], row['gid'], 'holaday-pool-slot-' + suffix,
                                  '/var/lib/holaday-pool-slots/slot-' + suffix))
    return SlotIdentitySnapshot(candidate, hashlib.sha256(raw).hexdigest(), tuple(slots))


def _bounded(value):
    if type(value) is not list or not 1 <= len(value) <= 4096:
        raise ValueError()
    return value


def _user_record(user):
    fields = _account_fields(user)
    if (not _name(fields[0]) or type(fields[1]) is not int or type(fields[2]) is not int
            or type(fields[3]) is not str or type(fields[4]) is not str):
        raise ValueError()
    return fields


def _group_record(group):
    if (not _name(group.gr_name) or type(group.gr_gid) is not int
            or type(group.gr_mem) is not list or len(group.gr_mem) > 4096
            or any(not _name(member) for member in group.gr_mem)
            or len(set(group.gr_mem)) != len(group.gr_mem)):
        raise ValueError()
    return group.gr_name, group.gr_gid, tuple(group.gr_mem)


def _supplementary(name, gid):
    values = _bounded(os.getgrouplist(name, gid))
    if any(not _id(value) for value in values) or gid not in values:
        raise ValueError()
    return set(values)


def _inspect(snapshot):
    # Full enumeration is an explicit deployment NSS requirement. Allocation
    # within NSS itself is outside these accepted-result bounds.
    users = [_user_record(user) for user in _bounded(pwd.getpwall())]
    groups = [_group_record(group) for group in _bounded(grp.getgrall())]
    app = _user_record(pwd.getpwuid(998))
    slot_gids = {slot.gid for slot in snapshot.slots}
    if (app[1] != 998 or not _id(app[2]) or app[2] in slot_gids or app[3] != '/var/lib/holaday'
            or _user_record(pwd.getpwnam(app[0])) != app
            or [user for user in users if user[0] == app[0] or user[1] == 998] != [app]
            or _supplementary(app[0], app[2]) & slot_gids):
        raise ValueError()
    for slot in snapshot.slots:
        expected = (slot.name, slot.uid, slot.gid, slot.home, '/usr/sbin/nologin')
        if (_user_record(pwd.getpwnam(slot.name)) != expected
                or _user_record(pwd.getpwuid(slot.uid)) != expected
                or [user for user in users if user[0] == slot.name or user[1] == slot.uid] != [expected]
                or any(user[2] == slot.gid and user != expected for user in users)
                or _supplementary(slot.name, slot.gid) != {slot.gid}):
            raise ValueError()
        group = _group_record(grp.getgrnam(slot.name))
        if (group[:2] != (slot.name, slot.gid) or any(member != slot.name for member in group[2])
                or _group_record(grp.getgrgid(slot.gid)) != group
                or [g for g in groups if g[0] == slot.name or g[1] == slot.gid] != [group]
                or any(slot.name in g[2] and g[1] != slot.gid for g in groups)):
            raise ValueError()
    slot_names = {slot.name for slot in snapshot.slots}
    for user in users:
        if user[0] in slot_names:
            continue
        # NSS initgroups can expose membership absent from gr_mem. Ordinary
        # users (including root/nobody) may legitimately have GID 0/65534.
        derived = _bounded(os.getgrouplist(user[0], user[2]))
        if (any(type(gid) is not int or not 0 <= gid < 4294967295 for gid in derived)
                or user[2] not in derived or set(derived) & slot_gids):
            raise ValueError()
    return snapshot


def inspect_slot_identities(candidate):
    """Read selected metadata only; no files, passwords, provisioning or cache.

    Caller must re-inspect at dispatch with original registration/manager and
    enforce runtime identity/namespace checks. This is not locked-password,
    process isolation, immutable NSS, slot-reuse or production-ready evidence.
    """
    try:
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise ValueError()
        snapshot = _policy(_POLICY, candidate)
        return _inspect(snapshot)
    except Exception:
        _deny()
