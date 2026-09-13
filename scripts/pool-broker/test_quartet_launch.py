"""Actual role dispatch/journal/handshake, synthetic external systemd/kernel only."""
import contextlib
import json
import unittest
from unittest.mock import patch

import manager_probe
import quartet_material
import test_manager_probe
import test_quartet_anchor_binding
import test_quartet_worker_channel

try:
    import quartet_launch as launch
except ModuleNotFoundError as error:
    if error.name != 'quartet_launch': raise
    launch = None


def properties(args):
    """Decode the actual emitted busctl vector independently of the producer."""
    assert args[0] == 'ssa(sv)a(sa(sv))' and args[2] == 'fail'
    result, offset = {}, 4
    for _ in range(int(args[3])):
        name, kind = args[offset:offset + 2]
        offset += 2
        assert name not in result
        if kind in ('s', 'b', 't', 'u'):
            value = args[offset]; offset += 1
        elif kind in ('as', 'a(ss)', 'a(ssbt)'):
            count = int(args[offset]); offset += 1
            width = {'as': 1, 'a(ss)': 2, 'a(ssbt)': 4}[kind]
            value = args[offset:offset + count * width]; offset += count * width
        elif kind == 'a(sasb)':
            assert args[offset] == '1'
            path, count = args[offset + 1], int(args[offset + 2])
            value = (path, args[offset + 3:offset + 3 + count], args[offset + 3 + count])
            offset += 4 + count
        else:
            raise AssertionError('unrecognized fixed property signature')
        result[name] = (kind, value)
    return result, args[offset:]


class QuartetLaunchTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, base=None):
        self.assertIsNotNone(launch, 'actual fixed five-role dispatcher missing')
        with (test_quartet_worker_channel.WorkerChannelTests().system(observed=False) if base is None else base()) as s:
            source_inodes = {test_manager_probe.NATIVE.fstat(s.material._objects[name][0]).st_ino
                             for name in ('tmp', 'shm', 'profile')}
            s.source_flags = 14
            native_mount = quartet_material.os.fstatvfs
            def mount_flags(fd):
                if test_manager_probe.NATIVE.fstat(fd).st_ino in source_inodes:
                    from types import SimpleNamespace
                    return SimpleNamespace(f_flag=s.source_flags)
                return native_mount(fd)
            s.starts, s.dispatch_events, s.manager_methods = [], [], []
            s.dispatch_mode, s.dispatch_hook = '', lambda _method: None
            original = manager_probe._capture.side_effect
            sync = s.proxy.fsync
            def fsync(fd):
                sync(fd)
                s.dispatch_events.append('sync')
            def capture(argv, fd, deadline, guard):
                if argv[8] == 'org.freedesktop.DBus':
                    return original(argv, fd, deadline, guard)
                method = argv[11]
                s.manager_methods.append(method)
                guard()
                s.dispatch_hook(method)
                self.assertEqual(argv[8], ':1.5')
                self.assertIn('guid=' + 'd' * 32, argv[1])
                if method == 'StartTransientUnit':
                    raw = test_manager_probe.NATIVE.pread(s.journal._fd, 1048576, 0)
                    row = json.loads(raw.splitlines()[-1])
                    self.assertEqual(row['action'], 'role_dispatch')
                    self.assertEqual(s.dispatch_events[-2:], ['sync', 'sync'])
                    self.assertEqual(row['managerOwner'], ':1.5')
                    s.starts.append(argv[12:])
                    s.dispatch_events.append('start')
                    if s.dispatch_mode == 'lost': raise TimeoutError()
                    if s.dispatch_mode == 'exists': raise ValueError()
                    path = '/org/freedesktop/systemd1/job/' + str(6 + len(s.starts))
                    if s.dispatch_mode == 'bad-job': path = '/unexpected/job/1'
                    return json.dumps({'type': 'o', 'data': [path]}).encode()
                if method == 'GetUnit':
                    unit = argv[-1]
                    self.assertIn(unit, s.units)
                    path = '/org/freedesktop/systemd1/unit/' + unit.replace('-', '_2d').replace('.', '_2e')
                    if s.dispatch_mode == 'wrong-path': path += 'x'
                    return json.dumps({'type': 'o', 'data': [path]}).encode()
                return original(argv, fd, deadline, guard)
            with patch.object(s.proxy, 'fsync', side_effect=fsync), \
                    patch.object(quartet_material.os, 'fstatvfs', side_effect=mount_flags), \
                    patch.object(manager_probe, '_capture', side_effect=capture):
                yield s

    def test_journal_dispatch_readback_and_real_grant_use_same_material(self):
        with self.system() as s:
            self.assertIsNone(launch.dispatch_role(s.material, 'anchor'))
            self.assertEqual(s.journal._resources[s.resource]['roles']['anchor']['state'], 'observed')
            self.assertFalse(s.journal._resources[s.resource]['roles']['anchor'].get('granted', False))
            s.material.accept_role('anchor')
            self.assertEqual(s.sends, [b'challenge', b'grant'])
            self.assertTrue(s.grant_durable[0])
            self.assertEqual(len(s.starts), 1)

    def test_five_fixed_roles_have_persistent_private_sources_and_no_arbitrary_exec(self):
        with self.system() as s:
            roles = ('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify')
            for index, role in enumerate(roles):
                if index:
                    s.material.prepare_role(role)
                    test_quartet_anchor_binding.AnchorBindingTests().dispatch_observation(s, role, index, observed=False)
                launch.dispatch_role(s.material, role)
                props, auxiliary = properties(s.starts[-1])
                self.assertEqual(props['User'], ('s', '2001'))
                self.assertEqual(props['Group'], ('s', '2001'))
                for name in ('NoNewPrivileges', 'PrivateNetwork', 'PrivateIPC', 'PrivateMounts', 'PrivateDevices'):
                    self.assertEqual(props[name], ('b', 'true'))
                for name in ('DynamicUser', 'PrivateTmp', 'Delegate'):
                    self.assertEqual(props[name], ('b', 'false'))
                self.assertEqual(props['SupplementaryGroups'], ('as', ()))
                self.assertEqual(props['CapabilityBoundingSet'], ('t', '0'))
                self.assertEqual(props['AmbientCapabilities'], ('t', '0'))
                self.assertEqual(props['Type'], ('s', 'exec'))
                self.assertEqual(props['Restart'], ('s', 'no'))
                self.assertEqual(props['ProtectProc'], ('s', 'invisible'))
                self.assertEqual(props['NoExecPaths'], ('as', ('+/tmp', '+/dev/shm', '+/profile')))
                self.assertEqual(props['ReadOnlyPaths'], ('as', ('+/',)))
                prefix = '/var/lib/holaday-pool-broker/groups/' + s.resource
                self.assertEqual(props['RootDirectory'], ('s', '/usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/rootfs'))
                self.assertEqual(props['LoadCredential'], ('a(ss)', ('binding', prefix + '/credentials/' + role + '.binding',
                    'xauthority', prefix + '/credentials/xauthority')))
                expected = tuple(item for name, dest in (('tmp', '/tmp'), ('shm', '/dev/shm'), ('profile', '/profile'))
                    for item in (prefix + '/' + name, dest, 'false', '0'))
                self.assertEqual(props['BindPaths'], ('a(ssbt)', expected))
                self.assertEqual(props['BindReadOnlyPaths'], ('a(ssbt)',
                    (prefix + '/control', '/run/holaday-pool', 'false', '0')))
                self.assertEqual(props['ExecStart'], ('a(sasb)', ('/usr/bin/python3',
                    ('/usr/bin/python3', '-I', '-S', '-B', '/quartet_worker_guard.py', 'a' * 40, s.resource, role), 'false')))
                anchor = 'holaday-pool-anchor-' + s.resource + '.service'
                for name in ('Requires', 'After', 'BindsTo', 'JoinsNamespaceOf'):
                    if index: self.assertEqual(props[name], ('as', (anchor,)))
                    else: self.assertNotIn(name, props)
                if index: self.assertEqual(auxiliary, ('0',))
                else:
                    self.assertEqual(auxiliary[0:2], ('1', 'holadaypool-' + s.resource + '.slice'))
                self.assertNotIn('--no-sandbox', s.starts[-1])
                s.material.accept_role(role)
            self.assertEqual(len(s.starts), 5)
            self.assertEqual(s.sends, [b'challenge', b'grant'] * 5)

    def test_lost_response_and_rejection_never_retry_or_grant(self):
        for mode in ('lost', 'exists', 'bad-job'):
            with self.system() as s:
                s.dispatch_mode = mode
                with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
                with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
                self.assertEqual(len(s.starts), 1)
                self.assertEqual(s.journal._resources[s.resource]['roles']['anchor']['state'], 'dispatching')
                self.assertEqual(s.sends, [])

    def test_wrong_unit_or_invocation_readback_retains_accepted(self):
        for mode in ('wrong-path', 'zero-invocation', 'boolean-invocation'):
            with self.system() as s:
                s.dispatch_mode = mode
                if mode.endswith('invocation'):
                    s.properties['InvocationID'] = ('ay', [0 if mode.startswith('zero') else True] * 16)
                with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
                self.assertEqual(s.journal._resources[s.resource]['roles']['anchor']['state'], 'accepted')
                self.assertEqual(s.sends, [])

    def test_dispatch_fsync_failure_or_revoke_prevents_external_dispatch(self):
        for mode in ('fail', 'revoke'):
            with self.system() as s:
                original = s.proxy.fsync.side_effect
                def fsync(fd):
                    original(fd)
                    raw = test_manager_probe.NATIVE.pread(s.journal._fd, 1048576, 0)
                    if json.loads(raw.splitlines()[-1])['action'] == 'role_dispatch':
                        if mode == 'fail': raise OSError('synthetic fsync failure')
                        s.material.close()
                with patch.object(s.proxy, 'fsync', side_effect=fsync):
                    with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
                self.assertEqual(s.starts, [])

    def test_duplicate_wrong_order_and_nonexact_role_never_dispatch(self):
        class Alias(str): pass
        for role in ('xvfb', 'unknown', Alias('anchor')):
            with self.system() as s:
                with self.assertRaises(ValueError): launch.dispatch_role(s.material, role)
                self.assertEqual(s.starts, [])
        with self.system() as s:
            launch.dispatch_role(s.material, 'anchor')
            with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
            self.assertEqual(len(s.starts), 1)

    def test_final_real_collector_veto_never_reaches_popen(self):
        for target in ('material', 'anchor'):
            with self.system() as s:
                role = 'anchor'
                if target == 'anchor':
                    launch.dispatch_role(s.material, role)
                    s.material.accept_role(role)
                    role = 'xvfb'
                    s.material.prepare_role(role)
                    test_quartet_anchor_binding.AnchorBindingTests().dispatch_observation(s, role, 1, observed=False)
                original = manager_probe._capture.side_effect
                attempted = []
                origin = s.material if target == 'material' else s.material._workers['anchor']._pin
                def capture(argv, fd, deadline, guard):
                    if 'StartTransientUnit' not in argv: return original(argv, fd, deadline, guard)
                    clock = manager_probe.time.monotonic
                    def expired_origin():
                        origin.close()
                        return clock()
                    with patch.object(manager_probe.time, 'monotonic', side_effect=expired_origin), \
                            patch.object(manager_probe.subprocess, 'Popen', side_effect=lambda *a, **kw: attempted.append(True)):
                        return test_manager_probe.REAL_CAPTURE(argv, fd, deadline, guard)
                with patch.object(manager_probe, '_capture', side_effect=capture):
                    with self.assertRaises(ValueError): launch.dispatch_role(s.material, role)
                self.assertEqual(attempted, [])
                self.assertEqual(s.journal._resources[s.resource]['roles'][role]['state'], 'dispatching')

    def test_accepted_fsync_failure_cannot_readback_or_reissue(self):
        with self.system() as s:
            original = s.proxy.fsync.side_effect
            def fsync(fd):
                original(fd)
                raw = test_manager_probe.NATIVE.pread(s.journal._fd, 1048576, 0)
                if json.loads(raw.splitlines()[-1])['action'] == 'role_accepted':
                    raise OSError('synthetic accepted fsync failure')
            with patch.object(s.proxy, 'fsync', side_effect=fsync):
                with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
            self.assertEqual(len(s.starts), 1)

            self.assertNotIn('GetUnit', s.manager_methods)
            with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
            self.assertEqual(len(s.starts), 1)

    def test_delayed_manager_sources_survive_closed_and_reused_original_fds(self):
        with self.system() as s:
            native = test_manager_probe.NATIVE
            source_fds = [s.material._view._root] + [s.material._objects[name][0]
                for name in ('tmp', 'shm', 'profile', 'control')] + [s.material._credentials['anchor'][0], s.material._authority[0]]
            expected = [(native.fstat(fd).st_dev, native.fstat(fd).st_ino) for fd in source_fds]
            s.dispatch_mode = 'lost'
            with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
            opened = []
            try:
                while not opened or opened[-1] <= max(source_fds):
                    opened.append(native.open('/dev/null', native.O_RDONLY | native.O_CLOEXEC))
                self.assertTrue(set(opened) & set(source_fds))
                props, _ = properties(s.starts[0])
                paths = [props['RootDirectory'][1]] + list(props['BindPaths'][1][::4]) + \
                    [props['BindReadOnlyPaths'][1][0], *props['LoadCredential'][1][1::2]]
                actual = []
                for path in paths:
                    # Linux /proc numeric-FD resolution, absent on this Mac,
                    # would now resolve to the reused object, not the source.
                    info = native.fstat(int(path.rsplit('/', 1)[1])) if path.startswith('/proc/') else \
                        native.stat(str(s.root / path[1:]))
                    actual.append((info.st_dev, info.st_ino))
                self.assertEqual(actual, expected)
                self.assertTrue(all(not path.startswith('/proc/') for path in paths))
            finally:
                for fd in reversed(opened): native.close(fd)
            self.assertEqual(s.sends, [])

    def test_weak_source_mount_flags_stop_before_dispatch(self):
        for flags in (0, 12, 10, 6, 15):
            with self.system() as s:
                s.source_flags = flags
                with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
                self.assertEqual(s.starts, [])
                self.assertNotIn('anchor', s.journal._resources[s.resource]['roles'])

    def test_source_parent_rename_during_dispatch_refuses_followup_or_grant(self):
        with self.system() as s:
            def hook(method):
                if method == 'StartTransientUnit':
                    test_manager_probe.NATIVE.rename(str(s.directory), str(s.directory) + '.retained')
            s.dispatch_hook = hook
            with self.assertRaises(ValueError): launch.dispatch_role(s.material, 'anchor')
            self.assertEqual(len(s.starts), 1)
            self.assertNotIn('GetUnit', s.manager_methods)
            self.assertEqual(s.sends, [])


if __name__ == '__main__':
    unittest.main()
