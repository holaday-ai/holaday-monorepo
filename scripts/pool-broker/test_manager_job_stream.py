"""Real original stream/socket IO; Linux peer credentials and manager CLI are seams."""
import array
import contextlib
import socket
import struct
import threading
import unittest
from unittest.mock import patch

import manager_probe as module
import test_manager_probe as fixture
from test_manager_job_wire import frame


UNIT = 'holaday-pool-anchor-' + 'a' * 32 + '.service'
JOB = '/org/freedesktop/systemd1/job/7'


def string(value):
    raw = value.encode()
    return struct.pack('<I', len(raw)) + raw + b'\0'


class ManagerJobStreamTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, mode='done'):
        with fixture.ProbeTests().system() as s:
            left, right = socket.socketpair()
            failures, calls, delivered, received_rights = [], [], [], []
            right.settimeout(5)
            class KernelSocket(socket.socket):
                def connect(self, path):
                    if path != '/run/dbus/system_bus_socket': raise ValueError()
                def getsockopt(self, *args): return struct.pack('=iII', 42, 102, 102)
                def recvmsg(self, *args):
                    result = super().recvmsg(*args)
                    for level, kind, raw in result[1]:
                        if (level, kind) == (socket.SOL_SOCKET, socket.SCM_RIGHTS):
                            received_rights.extend(array.array('i', raw))
                    return result
            owned = KernelSocket(fileno=left.detach())
            def receive(size):
                raw = b''
                while len(raw) < size:
                    data = right.recv(size - len(raw))
                    if not data: raise EOFError()
                    raw += data
                return raw
            def signal(unit=UNIT, job_id=7, serial=90):
                body = struct.pack('<I', job_id)
                for value in ('/org/freedesktop/systemd1/job/' + str(job_id), unit, 'failed' if mode == 'failed' else 'done'):
                    body += b'\0' * (-len(body) % 4) + string(value)
                sender = ':9.9' if mode == 'foreign' else ':1.5'
                return frame(4, [(1, 'o', '/org/freedesktop/systemd1'),
                    (2, 's', 'org.freedesktop.systemd1.Manager'), (3, 's', 'JobRemoved'),
                    (7, 's', sender), (8, 'g', 'uoss')], body, serial=serial)
            def server():
                try:
                    self.assertEqual(receive(19), b'\0AUTH EXTERNAL 30\r\n')
                    right.sendall(b'OK ' + b'd' * 32 + b'\r\n')
                    self.assertEqual(receive(7), b'BEGIN\r\n')
                    while True:
                        header = receive(16)
                        _o, _k, _f, _v, body_size, _serial, header_size = struct.unpack('<BBBBIII', header)
                        raw = header + receive(header_size + (-header_size % 8) + body_size)
                        request = module._dbus_decode(raw)
                        member = request['headers'][3]
                        calls.append((member, request['body']))
                        signature = 's' if member == 'Hello' else ''
                        sender = 'org.freedesktop.DBus' if member in ('Hello', 'AddMatch') else ':1.5'
                        fields = [(5, 'u', request['serial']), (7, 's', sender)]
                        if signature: fields.append((8, 'g', signature))
                        if member == 'Subscribe' and mode != 'missing':
                            # JobRemoved may arrive before Subscribe's ACK / consumer wait.
                            if mode == 'noise': right.sendall(signal('unrelated.service', 6, 89))
                            payload = signal()
                            if mode == 'rights':
                                fd = fixture.NATIVE.open('/dev/null', fixture.NATIVE.O_RDONLY)
                                try: right.sendmsg([payload], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
                                finally: fixture.NATIVE.close(fd)
                            else: right.sendall(payload)
                            delivered.append(True)
                        right.sendall(frame(2, fields, string(':1.42') if signature else b'', serial=100 + len(calls)))
                        if member == 'Subscribe':
                            if mode == 'missing': right.shutdown(socket.SHUT_WR)
                            return
                except BrokenPipeError:
                    if mode not in ('foreign', 'rights'): failures.append('BrokenPipeError')
                except Exception as error: failures.append(type(error).__name__)
            thread = threading.Thread(target=server); thread.start()
            manager = None
            original_close = module.os.close
            def close(fd):
                if fd in received_rights: fixture.NATIVE.close(fd)
                else: original_close(fd)
            try:
                with patch.object(module, 'Socket', return_value=owned), patch.object(module.os, 'close', side_effect=close):
                    manager = module.SystemManagerProbe.open(s.registration)
                    s.manager, s.calls, s.failures, s.received_rights = manager, calls, failures, received_rights
                    yield s
            finally:
                if manager is not None: manager.close()
                owned.close(); right.close(); thread.join(6)
                self.assertFalse(thread.is_alive())
                self.assertEqual(failures, [])

    def test_subscribe_before_consuming_matches_original_job_and_unit_once(self):
        self.assertTrue(hasattr(module, '_ManagerJobStream'), 'persistent original-manager job stream missing')
        with self.system() as s:
            stream = module._ManagerJobStream.open(s.manager)
            receipt = stream.wait_job(JOB, UNIT)
            self.assertEqual((receipt._job, receipt._unit, receipt._result), (JOB, UNIT, 'done'))
            self.assertIs(receipt._stream, stream)
            self.assertIs(stream.wait_job(JOB, UNIT), receipt)
            self.assertEqual([name for name, _args in s.calls], ['Hello', 'AddMatch', 'AddMatch', 'Subscribe'])
            self.assertFalse(hasattr(receipt, 'groupExitProven'))

    def test_foreign_sender_and_failed_job_never_produce_a_done_receipt(self):
        self.assertTrue(hasattr(module, '_ManagerJobStream'))
        for mode in ('foreign', 'failed'):
            with self.subTest(mode=mode), self.system(mode) as s:
                with self.assertRaises(ValueError):
                    stream = module._ManagerJobStream.open(s.manager)
                    stream.wait_job(JOB, UNIT)
                self.assertTrue(s.manager._retired)

    def test_subscription_ack_without_completion_is_not_a_job_receipt(self):
        self.assertTrue(hasattr(module, '_ManagerJobStream'))
        with self.system('missing') as s:
            stream = module._ManagerJobStream.open(s.manager)
            with self.assertRaises(ValueError): stream.wait_job(JOB, UNIT)
            self.assertEqual(stream._receipts, {})
            self.assertTrue(s.manager._retired)

    def test_unexpected_real_scm_rights_are_closed_and_original_stream_rejected(self):
        self.assertTrue(hasattr(module, '_ManagerJobStream'))
        with self.system('rights') as s:
            with self.assertRaises(ValueError): module._ManagerJobStream.open(s.manager)
            self.assertTrue(s.manager._retired)
            self.assertGreaterEqual(len(s.received_rights), 1)
            for fd in s.received_rights:
                with self.assertRaises(OSError): fixture.NATIVE.fstat(fd)

    def test_unrelated_system_jobs_do_not_replace_or_poison_the_original_receipt(self):
        with self.system('noise') as s:
            try: stream = module._ManagerJobStream.open(s.manager)
            except ValueError: self.fail('unrelated JobRemoved poisoned the original manager stream')
            self.assertEqual(stream.wait_job(JOB, UNIT)._unit, UNIT)
            self.assertFalse(s.manager._retired)


if __name__ == '__main__': unittest.main()
