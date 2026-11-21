"""Original five-unit stop flow, durable journal and real socket wire; Linux is synthetic."""
import contextlib
import json
import socket
import unittest

import manager_probe
import quartet_launch
import quartet_runtime
import test_quartet_ready as fixture


class QuartetStopTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, mode='late'):
        with fixture.RuntimeReadyTests().system() as s:
            quartet_launch._launch_material(s.material, ready_offer=s.offer)
            s.live = quartet_runtime._RunningQuartet.adopt(s.material, s.offer)
            left, right = socket.socketpair()
            channel = s.manager._channel  # Same original source object; Linux D-Bus behavior is a seam.
            original_close = channel.close
            s.stop_calls, s.wire_calls, s.next_serial = [], [], 100
            def emit(kind, headers, signature='', values=()):
                s.next_serial += 1
                right.sendall(manager_probe._dbus_encode(kind, s.next_serial, headers, signature, values))
            def send(raw):
                if raw == b'BEGIN\r\n': return
                data = manager_probe._dbus_decode(raw)
                fields, values = data['headers'], data['body']
                member = fields[3]
                s.wire_calls.append(member)
                sender = 'org.freedesktop.DBus' if member in ('Hello', 'AddMatch') else ':1.5'
                reply = {5: data['serial'], 7: sender}
                if member == 'Hello': emit(2, reply, 's', (':1.42',))
                elif member in ('AddMatch', 'Subscribe', 'RefUnit'): emit(2, reply)
                elif member == 'Get':
                    unit = next(name for name in s.units if fields[1] ==
                        '/org/freedesktop/systemd1/unit/' + name.replace('-', '_2d').replace('.', '_2e'))
                    prop = values[1]
                    kind, value = s.units[unit][prop]
                    if kind == 'ay': value = bytes(value)
                    if mode == 'rebound' and 'brave-' in unit and prop == 'InvocationID': value = b'\xff' * 16
                    emit(2, reply, 'v', ((kind, value),))
                elif member == 'StopUnit':
                    unit, policy = values
                    self.assertEqual(policy, 'fail')
                    s.stop_calls.append(unit)
                    job_id = 100 + len(s.stop_calls)
                    job = '/org/freedesktop/systemd1/job/' + str(job_id)
                    signal = {1: '/org/freedesktop/systemd1', 2: 'org.freedesktop.systemd1.Manager',
                              3: 'JobRemoved', 7: ':1.5'}
                    if mode in ('early', 'lost-ack'): emit(4, signal, 'uoss', (job_id, job, unit, 'done'))
                    if mode == 'lost-ack':
                        right.shutdown(socket.SHUT_WR)
                        return
                    emit(2, reply, 'o', (job,))
                    if mode != 'early': emit(4, signal, 'uoss', (job_id, job, unit, 'done'))
                    if mode in ('empty', 'removed', 'live', 'restart'):
                        s.units[unit].update(ActiveState=('s', 'inactive'), MainPID=('u', 0),
                            ControlGroup=('s', ''), Job=('(uo)', (0, '/')),
                            NRestarts=('u', 1 if mode == 'restart' else 0))
                        if len(s.stop_calls) == 5:
                            s.exited = mode != 'live'
                            for _role, _worker, pin, _view in s.live._workers:
                                directory = s.root / ('sys/fs/cgroup/holadaypool.slice/holadaypool-' +
                                    s.resource + '.slice/' + pin._record[0])
                                if mode == 'removed':
                                    (directory / 'cgroup.events').unlink(); directory.rmdir()
                                else: (directory / 'cgroup.events').write_bytes(b'populated 0\nfrozen 0\n')
                else: raise AssertionError('unexpected manager method')
            def close():
                left.close(); right.close(); original_close()
            channel.sendall, channel.recvmsg, channel.fileno = send, left.recvmsg, left.fileno
            channel.settimeout, channel.close = left.settimeout, close
            try: yield s
            finally: close()

    def test_five_original_stop_jobs_are_durable_matched_and_idempotent_without_exit_claim(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'stop_original', None)),
                        'original fixed five-unit stop producer missing')
        for mode in ('early', 'late'):
            with self.subTest(mode=mode), self.system(mode) as s:
                receipts = s.live.stop_original()
                expected = ['holaday-pool-' + role + '-' + s.resource + '.service'
                            for role in ('xvfb', 'brave', 'x11vnc', 'websockify', 'anchor')]
                self.assertEqual(s.stop_calls, expected)
                self.assertEqual([item._unit for item in receipts], expected)
                self.assertIs(s.live.stop_original(), receipts)
                self.assertEqual(s.stop_calls, expected)
                rows = [json.loads(line) for line in s.journal._expected.splitlines()]
                for action in ('role_stop_dispatch', 'role_stop_accepted', 'role_stop_observed'):
                    self.assertEqual(sum(row['action'] == action for row in rows), 5)
                self.assertEqual(s.journal._resources[s.resource]['state'], 'closing')
                self.assertFalse(s.journal.snapshot()['groupExitProven'])

    def test_signal_without_stop_ack_remains_unknown_and_is_never_resent(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'stop_original', None)))
        with self.system('lost-ack') as s:
            with self.assertRaises(ValueError): s.live.stop_original()
            with self.assertRaises(ValueError): s.live.stop_original()
            self.assertEqual(len(s.stop_calls), 1)
            rows = [json.loads(line) for line in (s.root / 'var/lib/holaday-pool-broker/resource-journal.jsonl').read_bytes().splitlines()]
            self.assertEqual(sum(row['action'] == 'role_stop_dispatch' for row in rows), 1)
            self.assertFalse(any(row['action'] in ('role_stop_accepted', 'role_stop_observed') for row in rows))

    def test_rebound_invocation_is_rejected_before_stopping_that_role(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'stop_original', None)))
        with self.system('rebound') as s:
            with self.assertRaises(ValueError): s.live.stop_original()
            self.assertEqual(len(s.stop_calls), 1)
            self.assertIn('xvfb-', s.stop_calls[0])
            self.assertTrue(s.live._retired)


if __name__ == '__main__': unittest.main()
