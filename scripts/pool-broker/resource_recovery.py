"""Read-only whole-journal reconciliation. Observations never authorize reuse."""
import math
import time

import manager_probe
from protocol import _identifier
from resource_journal import ResourceJournal
from xvfb_launch import _message

_clock = time.monotonic
_SERVICE = 'org.freedesktop.systemd1'
_OBJECT = '/org/freedesktop/systemd1'
_STATES = ('active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating', 'maintenance')
_REASONS = ('foreign_registration', 'missing_binding', 'missing_invocation',
            'manager_changed', 'identity_changed', 'unstable_observation')


def _deny():
    try:
        raise ValueError('POOL_BROKER_RECOVERY_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _inspect(row, journal, manager):
    """Private fixed reads of an already journal-bound instance, never a lease."""
    unit = row['unit']
    expected = _OBJECT + '/unit/' + unit.replace('-', '_2d').replace('.', '_2e')

    def call(path, interface, method, args, signature):
        journal._guard()
        manager._guard()
        argv = ('/proc/self/fd/' + str(manager._tool),
            '--address=unix:path=/run/dbus/system_bus_socket,guid=' + manager._guid,
            '--json=short', '--no-pager', '--auto-start=no', '--allow-interactive-authorization=no',
            '--timeout=2s', 'call', manager._owner, path, interface, method, *args)
        raw = manager._io(manager_probe._capture, argv, manager._tool, manager._deadline, manager._live_budget)
        value = _message(raw, signature)
        journal._guard()
        manager._guard()
        return value

    path = call(_OBJECT, _SERVICE + '.Manager', 'GetUnit', ('s', unit), 'o')
    if type(path) is not str:
        raise ValueError()
    if path != expected:
        return None, 'identity_changed'

    def property_value(name, signature):
        value = call(expected, 'org.freedesktop.DBus.Properties', 'Get', ('ss', _SERVICE + '.Unit', name), 'v')
        if type(value) is not dict or set(value) != {'type', 'data'} or value['type'] != signature:
            raise ValueError()
        data = value['data']
        if signature == 's':
            if type(data) is not str:
                raise ValueError()
            return data
        if (type(data) is not list or len(data) != 16
                or any(type(byte) is not int or not 0 <= byte <= 255 for byte in data)):
            raise ValueError()
        return _identifier(bytes(data).hex(), 32)

    states = []
    for _ in range(2):
        if property_value('Id', 's') != unit or property_value('InvocationID', 'ay') != row['invocation']:
            return None, 'identity_changed'
        state = property_value('ActiveState', 's')
        if state not in _STATES:
            raise ValueError()
        states.append(state)
    if property_value('InvocationID', 'ay') != row['invocation']:
        return None, 'identity_changed'
    if states[0] != states[1]:
        return None, 'unstable_observation'
    return states[0], None


def recover_resources(journal, manager):
    """All records or a fixed failure. Never write, restart, adopt, or release slots.

    Per-resource observations are sequential, not an atomic global snapshot.
    A failed scan returns no partial result. The caller must retain uncertainty.
    """
    try:
        if (type(journal) is not ResourceJournal or type(manager) is not manager_probe.SystemManagerProbe
                or journal._registration is not manager._registration or journal._pin is not manager._pin):
            raise ValueError()
        registration, pin = journal._registration, journal._pin
        start = _clock()
        if type(start) not in (int, float) or not math.isfinite(start):
            raise ValueError()
        last = start

        def scope():
            nonlocal last
            now = _clock()
            journal._alive()
            if (manager._retired or registration._revoked or not registration._received
                    or registration._pin is not pin or pin._fd is None
                    or journal._pin is not pin or manager._pin is not pin
                    or manager._registration is not registration or journal._registration is not registration
                    or registration._candidate.hex() != journal._candidate
                    or manager._candidate != journal._candidate or pin._boot != journal._boot
                    or type(now) not in (int, float) or not math.isfinite(now)
                    or now < last or not 0 <= now - start < 30):
                raise ValueError()
            last = now
            return 30 - (now - start)

        def registered():
            registration._require_registered()
            scope()

        def scan():
            registered()
            manager._run(manager._probe, scope)
            result = {'total': len(journal._resources), 'prepared': 0, 'matched': 0, 'unknown': 0,
                'observedStates': dict.fromkeys(_STATES, 0), 'unknownReasons': dict.fromkeys(_REASONS, 0),
                'groupExitProven': False, 'admissionAllowed': False}
            for row in journal._resources.values():
                registered()
                reason = None
                if row['candidate'] != journal._candidate or row['boot'] != journal._boot:
                    reason = 'foreign_registration'
                elif row['state'] == 'prepared':
                    result['prepared'] += 1
                    continue
                elif not all(key in row for key in ('unit', 'managerGuid', 'managerOwner')):
                    reason = 'missing_binding'
                elif 'invocation' not in row:
                    reason = 'missing_invocation'
                elif row['managerGuid'] != manager._guid or row['managerOwner'] != manager._owner:
                    reason = 'manager_changed'
                else:
                    def inspect():
                        manager._probe()
                        observed = _inspect(row, journal, manager)
                        manager._probe()
                        return observed
                    state, reason = manager._run(inspect, scope)
                    if reason is None:
                        result['matched'] += 1
                        result['observedStates'][state] += 1
                if reason is not None:
                    result['unknown'] += 1
                    result['unknownReasons'][reason] += 1
            manager._run(manager._probe, scope)
            registered()
            return result

        result = journal._run(scan)
        # _run performs native file/pin checks AFTER scan returns. Include those
        # checks in the same global budget even on empty/entirely-unknown logs.
        registered()
        return result
    except Exception:
        for value, expected in ((journal, ResourceJournal), (manager, manager_probe.SystemManagerProbe)):
            if type(value) is expected:
                try: value.close()
                except Exception: pass
        _deny()
