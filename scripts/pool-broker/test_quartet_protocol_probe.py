"""Actual bounded protocol IO under the original guard, fixed TCP targets."""
import contextlib
import base64
import errno
import hashlib
import json
import selectors
import socket
import unittest
from unittest.mock import patch
import test_quartet_egress_source as fixture
from test_quartet_probe_exchange import server_init

guard, Socket = fixture.guard, fixture.fixture.Socket


class ProtocolProbeTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, stage=2, refused=0):
        with fixture.EgressSourceTests().system() as s, contextlib.ExitStack() as stack:
            listener = stack.enter_context(Socket(socket.AF_INET, socket.SOCK_STREAM))
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(1)
            s.probe_attempts, s.probe_sockets = [], []
            s.probe_refused, s.probe_close_hook, s.probe_io_hook = refused, lambda: None, lambda: None
            class ProbeSocket(Socket):
                def __init__(self, *args):
                    super().__init__(*args)
                    s.probe_sockets.append(self)
                def connect_ex(self, address):
                    s.probe_attempts.append(address)
                    if s.probe_refused:
                        s.probe_refused -= 1
                        return errno.ECONNREFUSED
                    return super().connect_ex(listener.getsockname())
                def recv(self, *args):
                    data = super().recv(*args)
                    s.probe_io_hook()
                    return data
                def close(self):
                    super().close()
                    s.probe_close_hook()
            stack.enter_context(patch.object(guard, '_ProbeSocket', ProbeSocket, create=True))
            cls = getattr(guard, '_ProtocolProbe', None)
            self.assertIsNotNone(cls, 'original guard bounded protocol IO missing')
            probe = cls.open(s.egress_source, stage, 321, s.now + 5.0)
            s.probe, s.probe_listener = probe, listener
            try: yield s
            finally: probe.close()

    def connected(self, s):
        s.probe.advance(0)
        remote = s.probe_listener.accept()[0]
        remote.settimeout(1)
        for _ in range(3): s.probe.advance(selectors.EVENT_WRITE)
        return remote

    def response(self):
        body = json.dumps({'Browser': 'Chrome/synthetic', 'Protocol-Version': '1.3',
            'webSocketDebuggerUrl': 'ws://127.0.0.1:19222/devtools/browser/11111111-2222-3333-4444-555555555555'}).encode()
        return b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body

    def test_actual_http_protocol_completes_only_after_original_socket_cleanup(self):
        with self.system() as s, self.connected(s) as remote:
            self.assertIn(b'GET /json/version ', remote.recv(1024))
            self.assertEqual(s.probe_attempts, [('127.0.0.1', 19222)])
            packet = self.response()
            remote.sendall(packet[:20])
            s.probe.advance(selectors.EVENT_READ)
            self.assertFalse(s.probe._observed)
            remote.sendall(packet[20:])
            s.probe.advance(selectors.EVENT_READ)
            self.assertTrue(s.probe._observed)
            self.assertEqual(s.probe_sockets[0].fileno(), -1)
            s.egress_source._check()

    def test_initial_refusal_wait_does_not_reset_original_budget(self):
        with self.system(refused=1) as s:
            s.probe.advance(0)
            self.assertEqual(len(s.probe_attempts), 1)
            self.assertEqual(s.probe_sockets[0].fileno(), -1)
            s.probe.advance(0)
            self.assertEqual(len(s.probe_attempts), 1)
            s.now += .11
            with self.connected(s) as remote:
                remote.recv(1024)
                s.now += 5
                with self.assertRaises(ValueError): s.probe.advance(selectors.EVENT_READ)
                self.assertFalse(s.probe._observed)
                self.assertEqual(len(s.probe_attempts), 2)

    def test_cleanup_expiry_and_connected_eof_never_retry(self):
        with self.system(refused=1) as s:
            s.probe_close_hook = lambda: setattr(s, 'now', s.now + 5)
            with self.assertRaises(ValueError): s.probe.advance(0)
            self.assertEqual(len(s.probe_attempts), 1)
        with self.system() as s:
            with self.connected(s) as remote: remote.recv(1024)
            with self.assertRaises(ValueError): s.probe.advance(selectors.EVENT_READ)
            with self.assertRaises(ValueError): s.probe.advance(0)
            self.assertEqual(len(s.probe_attempts), 1)

    def test_post_read_guard_death_or_final_close_expiry_cannot_report_observed(self):
        for mode in ('guard', 'deadline', 'cleanup'):
            with self.subTest(mode=mode), self.system() as s, self.connected(s) as remote:
                remote.recv(1024)
                remote.sendall(self.response())
                if mode == 'guard': s.probe_io_hook = s.egress_source.close
                elif mode == 'deadline': s.probe_io_hook = lambda: setattr(s, 'now', s.now + 5)
                else: s.probe_close_hook = lambda: setattr(s, 'now', s.now + 5)
                with self.assertRaises(ValueError): s.probe.advance(selectors.EVENT_READ)
                self.assertFalse(s.probe._observed)

    def test_actual_rfb_and_websocket_carry_shared_init_not_framebuffer_requests(self):
        for stage in (3, 4):
            with self.subTest(stage=stage), self.system(stage) as s, self.connected(s) as remote:
                self.assertEqual(s.probe_attempts, [('127.0.0.1', 15900 if stage == 3 else 16080)])
                if stage == 4:
                    request = remote.recv(1024)
                    key = request.split(b'Sec-WebSocket-Key: ', 1)[1].split(b'\r\n', 1)[0]
                    accept = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
                    remote.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: binary\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
                    s.probe.advance(selectors.EVENT_READ)
                    self.assertFalse(s.probe._observed)
                for incoming, expected in ((b'RFB 003.008\n', b'RFB 003.008\n'), (b'\x01\x01', b'\x01'), (bytes(4), b'\x01')):
                    remote.sendall(bytes([0x82, len(incoming)]) + incoming if stage == 4 else incoming)
                    s.probe.advance(selectors.EVENT_READ)
                    s.probe.advance(selectors.EVENT_WRITE)
                    reply = remote.recv(256)
                    if stage == 4:
                        self.assertEqual(reply[:2], bytes([0x82, 128 | len(expected)]))
                        mask = reply[2:6]
                        reply = bytes(byte ^ mask[index % 4] for index, byte in enumerate(reply[6:]))
                    self.assertEqual(reply, expected)
                payload = server_init()
                remote.sendall(bytes([0x82, len(payload)]) + payload if stage == 4 else payload)
                s.probe.advance(selectors.EVENT_READ)
                self.assertTrue(s.probe._observed)
                self.assertEqual(remote.recv(1), b'')


if __name__ == '__main__': unittest.main()
