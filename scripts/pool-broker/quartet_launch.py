"""Fixed B2 role dispatch through the original writer and manager. Not ready."""
import re
import time

import manager_probe
import quartet_material
from protocol import _identifier
from quartet_material import _GroupMaterial
from quartet_records import ROLES
from quartet_worker_channel import _WorkerChannel
from xvfb_launch import _message

_SERVICE = 'org.freedesktop.systemd1'
_OBJECT = '/org/freedesktop/systemd1'
_PROPERTIES = 'org.freedesktop.DBus.Properties'


def _deny():
    try:
        raise ValueError('POOL_BROKER_QUARTET_LAUNCH_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _template(material, role):
    """Private: only the locked dispatcher supplies these original objects."""
    unit = 'holaday-pool-' + role + '-' + material._resource + '.service'
    group = 'holadaypool-' + material._resource + '.slice'
    # systemd consumes paths asynchronously and chases bind sources. These
    # exclusive, root-parent-owned objects are never unlinked/replaced on
    # close or unknown, including across broker boots. Never encode PID/FD.
    source = '/var/lib/holaday-pool-broker/groups/' + material._resource
    root = '/usr/local/lib/holaday-pool-broker/releases/' + material._candidate + '/rootfs'
    argv = ('/usr/bin/python3', '-I', '-S', '-B', '/quartet_worker_guard.py',
            material._candidate, material._resource, role)
    mounts = tuple(item for name, destination in (('tmp', '/tmp'), ('shm', '/dev/shm'), ('profile', '/profile'))
        for item in (source + '/' + name, destination, 'false', '0'))
    read_only = (source + '/control', '/run/holaday-pool', 'false', '0')
    credentials = ('binding', source + '/credentials/' + role + '.binding',
                   'xauthority', source + '/credentials/xauthority')
    if role == 'anchor' and material._egress is not None:
        from quartet_egress import _GroupEgress
        egress = material._egress
        if (type(egress) is not _GroupEgress or egress._material is not material
                or egress._retired or not egress._complete or egress._credential is None):
            raise ValueError()
        egress._verify_locked()
        read_only += ('/run/holaday-pool-egress-links/' + material._resource + '/egress.sock',
                      '/run/holaday-egress.sock', 'false', '0')
        credentials += ('egress', source + '/credentials/egress')
    properties = (
        ('Type', 's', 'exec'), ('User', 's', str(material._uid)), ('Group', 's', str(material._gid)),
        ('SupplementaryGroups', 'as', '0'), ('DynamicUser', 'b', 'false'),
        ('Restart', 's', 'no'), ('KillMode', 's', 'control-group'), ('RemainAfterExit', 'b', 'true'),
        ('NoNewPrivileges', 'b', 'true'), ('Delegate', 'b', 'false'),
        ('CapabilityBoundingSet', 't', '0'), ('AmbientCapabilities', 't', '0'),
        ('PrivateTmp', 'b', 'false'), ('PrivateNetwork', 'b', 'true'), ('PrivateIPC', 'b', 'true'),
        ('PrivateMounts', 'b', 'true'), ('PrivateDevices', 'b', 'true'), ('MountAPIVFS', 'b', 'true'),
        ('ProtectProc', 's', 'invisible'), ('ProtectControlGroups', 'b', 'true'),
        ('ProtectSystem', 's', 'strict'), ('ProtectHome', 's', 'yes'),
        ('RootDirectory', 's', root), ('WorkingDirectory', 's', '/'),
        ('ReadOnlyPaths', 'as', '1', '+/'),
        ('ReadWritePaths', 'as', '3', '+/tmp', '+/dev/shm', '+/profile'),
        ('NoExecPaths', 'as', '3', '+/tmp', '+/dev/shm', '+/profile'),
        ('BindPaths', 'a(ssbt)', '3', *mounts),
        ('BindReadOnlyPaths', 'a(ssbt)', str(len(read_only) // 4), *read_only),
        ('LoadCredential', 'a(ss)', str(len(credentials) // 2), *credentials),
        ('StandardInput', 's', 'null'), ('StandardOutput', 's', 'null'), ('StandardError', 's', 'null'),
        ('LimitCORE', 't', '0'), ('MemoryMax', 't', '268435456'), ('TasksMax', 't', '128'),
        ('TimeoutStartUSec', 't', '5000000'), ('TimeoutStopUSec', 't', '5000000'), ('Slice', 's', group),
        ('ExecStart', 'a(sasb)', '1', '/usr/bin/python3', str(len(argv)), *argv, 'false'))
    if role != 'anchor':
        anchor = 'holaday-pool-anchor-' + material._resource + '.service'
        properties += tuple((name, 'as', '1', anchor) for name in ('Requires', 'After', 'BindsTo', 'JoinsNamespaceOf'))
    auxiliary = ('1', group, '2', 'MemoryMax', 't', '1073741824', 'TasksMax', 't', '256') if role == 'anchor' else ('0',)
    return ('ssa(sv)a(sa(sv))', unit, 'fail', str(len(properties)),
            *(value for prop in properties for value in prop), *auxiliary)


class _RoleDispatch:
    def __init__(self, material, role):
        if type(material) is not _GroupMaterial or type(role) is not str or role not in ROLES:
            raise ValueError()
        self._material, self._role, self._anchor = material, role, None

    def _budget(self):
        remaining = self._material._remaining()
        self._owner_veto()
        return remaining

    def _owner_veto(self):
        self._material._owner_veto()
        if not self._material._journal._busy:
            raise ValueError()
        if self._anchor is not None:
            anchor, pin, view = self._anchor
            if (self._material._workers.get('anchor') is not anchor or anchor._pin is not pin
                    or anchor._view is not view or pin is None or view is None
                    or pin._fd is None or pin._proc is None):
                raise ValueError()
            anchor._veto()

    def _guard(self):
        self._budget()
        if self._role == 'anchor': self._material._verify()
        for name in ('tmp', 'shm', 'profile'):
            flags = self._material._io(quartet_material.os.fstatvfs, self._material._objects[name][0]).f_flag
            # BindPaths has no nodev option in v249. Do not assume source
            # mounts are hardened, and never relax either worker-side check.
            if flags & 14 != 14 or flags & 1:
                raise ValueError()
        if self._role != 'anchor':
            # This original anchor view includes the same material verification.
            self._material._anchor_locked()
        self._budget()

    def _call(self, path, interface, method, arguments, signature):
        self._guard()
        manager = self._material._manager
        def operation():
            manager._probe()
            argv = ('/proc/self/fd/' + str(manager._tool),
                '--address=unix:path=/run/dbus/system_bus_socket,guid=' + manager._guid,
                '--json=short', '--no-pager', '--auto-start=no', '--allow-interactive-authorization=no',
                '--timeout=2s', 'call', manager._owner, path, interface, method, *arguments)
            raw = manager._io(manager_probe._capture, argv, manager._tool, manager._deadline, manager._live_budget)
            manager._probe()
            self._budget()
            return _message(raw, signature)
        value = manager._run(operation, self._budget, terminal_veto=self._owner_veto)
        self._guard()
        return value

    def _dispatch(self):
        material, role = self._material, self._role
        roles = material._journal._resources[material._resource]['roles']
        if (len(roles) >= len(ROLES) or role != ROLES[len(roles)] or role not in material._credentials
                or any(not row.get('granted', False) for row in roles.values())):
            raise ValueError()
        if role != 'anchor':
            anchor = material._workers.get('anchor')
            if type(anchor) is not _WorkerChannel:
                raise ValueError()
            self._anchor = (anchor, anchor._pin, anchor._view)
        self._guard()
        arguments = _template(material, role)
        self._guard()
        unit = arguments[1]
        material._append('role_dispatch', role=role, unit=unit,
            managerGuid=material._manager._guid, managerOwner=material._manager._owner)
        job = self._call(_OBJECT, _SERVICE + '.Manager', 'StartTransientUnit', arguments, 'o')
        if (type(job) is not str or re.fullmatch(r'/org/freedesktop/systemd1/job/[1-9][0-9]{0,9}', job) is None
                or int(job.rsplit('/', 1)[1]) > 4294967295):
            raise ValueError()
        material._append('role_accepted', role=role, job=job)
        expected = _OBJECT + '/unit/' + unit.replace('-', '_2d').replace('.', '_2e')
        if self._call(_OBJECT, _SERVICE + '.Manager', 'GetUnit', ('s', unit), 'o') != expected:
            raise ValueError()
        def property_value(name, kind):
            value = self._call(expected, _PROPERTIES, 'Get', ('ss', _SERVICE + '.Unit', name), 'v')
            if type(value) is not dict or set(value) != {'type', 'data'} or value['type'] != kind:
                raise ValueError()
            return value['data']
        if property_value('Id', 's') != unit:
            raise ValueError()
        def invocation():
            value = property_value('InvocationID', 'ay')
            if (type(value) is not list or len(value) != 16
                    or any(type(byte) is not int or not 0 <= byte <= 255 for byte in value)):
                raise ValueError()
            return _identifier(bytes(value).hex(), 32)
        original = invocation()
        if invocation() != original:
            raise ValueError()
        self._guard()
        material._append('role_observe', role=role, invocation=original)
        self._guard()


def dispatch_role(material, role):
    """Internal only: a successful return records observation, never permission."""
    try:
        transaction = _RoleDispatch(material, role)
        material._run(transaction._dispatch)
    except Exception:
        _deny()


def _launch_material(material, *, ready_offer=None):
    """One complete start on original material; no externally usable ready reply."""
    from quartet_endpoints import _GroupEndpoints
    from quartet_egress import _GroupEgress
    from quartet_bridge_channel import _BridgeChannel
    from quartet_probe_channel import _ProtocolChannel
    if type(material) is not _GroupMaterial: _deny()
    try:
        if ready_offer is not None:
            from quartet_create_offer import _CreateOffer
            if (type(ready_offer) is not _CreateOffer or not ready_offer._consumed or not ready_offer._accepted
                    or ready_offer._journal is not material._journal or ready_offer._prepared is not material._prepared
                    or ready_offer._resource != material._resource
                    or ready_offer._deadline_ns != material._create_deadline_ns): raise ValueError()
            ready_offer._budget()
        if getattr(material, '_launch_attempted', False): raise ValueError()
        material._launch_attempted = True
        # The core owns this binding before its first IO; callers cannot omit
        # ongoing offer/control revocation by leaving out an optional scope.
        material._launch_offer = ready_offer
        def initial():
            material._verify()
            row = material._journal._resources[material._resource]
            if (row['state'] != 'material_prepared' or row['roles'] or material._workers
                    or material._credentials or material._endpoints is not None or material._egress is not None):
                raise ValueError()
        material._run(initial)
        _GroupEndpoints.create(material)
        _GroupEgress.create(material)
        material.prepare_role('anchor')
        dispatch_role(material, 'anchor')
        material.accept_role('anchor')
        material._run(lambda: _BridgeChannel._transfer_locked(material), handshake=True)
        material._run(lambda: _ProtocolChannel._open_locked(material), handshake=True)
        protocol = material._protocol
        for stage, role in enumerate(ROLES[1:], 1):
            material.prepare_role(role)
            dispatch_role(material, role)
            material.accept_role(role)
            material._run(lambda: protocol._observe_locked(stage), handshake=True)
        def terminal():
            material._remaining()
            if (material._protocol is not protocol or not protocol._complete or protocol._retired
                    or set(material._workers) != set(ROLES)
                    or material._journal._resources[material._resource]['protocol']['state'] != 'complete'):
                raise ValueError()
            originals = tuple((role, material._workers[role], material._workers[role]._pin,
                material._workers[role]._view) for role in ROLES)
            if any(type(worker) is not _WorkerChannel for _role, worker, _pin, _view in originals):
                raise ValueError()
            material._terminal_workers = originals
            material._remaining()
            material._anchor_locked()
            for role in ROLES[1:]:
                worker = material._workers[role]
                if type(worker) is not _WorkerChannel: raise ValueError()
                worker._view._check_running_locked(scope_guard=material._remaining)
            protocol._clock._check_locked(scope_guard=material._remaining)
            for _role, _worker, pin, _view in originals:
                # Actual original pidfd liveness, never reopen by PID. This is
                # a bounded sequential observation, not a global atomic snapshot.
                pin._run(pin._observe, material._remaining, locked=True)
            material._remaining()
            if ready_offer is not None:
                ready_offer._budget()
                material._append('group_ready', preparedDigest=ready_offer._digest)
                # Original liveness after durable IO; do not reopen by PID or
                # manufacture a runtime owner from the journal's ready fact.
                for _role, _worker, pin, _view in originals:
                    pin._run(pin._observe, material._remaining, locked=True)
                material._remaining()
                material._ready_offer = ready_offer
        material._run(terminal)
    except Exception:
        material.close()
        _deny()


def launch_quartet(journal, manager, request):
    """Trusted internal creation, with one deadline starting before reservation.

    The returned original material is not a serialized ready response, lease,
    or exit authority. Only a later original runtime transaction may adopt it.
    """
    from resource_journal import ResourceJournal
    from quartet_journal import prepare_quartet
    from quartet_protocol import QuartetCreateRequest
    material = None
    try:
        if (type(journal) is not ResourceJournal or type(manager) is not manager_probe.SystemManagerProbe
                or type(request) is not QuartetCreateRequest): raise ValueError()
        registration, pin = journal._registration, journal._pin
        last = time.monotonic_ns()
        if type(last) is not int or not 0 <= last < 2**63 - 60000000000: raise ValueError()
        deadline = last + 60000000000
        def budget():
            nonlocal last
            now = time.monotonic_ns()
            if (type(now) is not int or now < last or now >= deadline
                    or journal._retired or manager._retired or registration._revoked
                    or journal._registration is not registration or manager._registration is not registration
                    or journal._pin is not pin or manager._pin is not pin or registration._pin is not pin
                    or pin._fd is None or not registration._received
                    or request.boot != journal._boot or manager._candidate != journal._candidate):
                raise ValueError()
            last = now
            return (deadline - now) / 1000000000
        budget()
        prepared = prepare_quartet(journal, request, scope_guard=budget)
        budget()
        material = _GroupMaterial.create(journal, manager, prepared, deadline_ns=deadline)
        budget()
        _launch_material(material)
        budget()
        material._owner_veto()
        if (material._retired or material._protocol is None or not material._protocol._complete
                or material._protocol._retired or set(material._workers) != set(ROLES)):
            raise ValueError()
        completed, material = material, None
        return completed
    except Exception:
        if material is not None: material.close()
        _deny()
