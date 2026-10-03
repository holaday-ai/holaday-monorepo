"""Egress uses the same bounded relay with its original accepted TCP client."""
import array
import contextlib
import selectors
import socket
import unittest
import test_quartet_egress_peer as fixture

guard, NATIVE = fixture.guard, fixture.NATIVE


class EgressRelayTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, authenticate=True):
        harness = fixture.EgressPeerTests()
        with harness.system() as s:
            relay = None
            try:
                method = getattr(guard._DataRelay, 'open_egress', None)
                self.assertIsNotNone(method, 'authenticated original-client egress relay missing')
                if authenticate:
                    harness.authenticate(s)
                    relay = method(s.peer)
                s.relay = relay
                yield s
            finally:
                if relay is not None: relay.close()

    def test_only_completed_ack_can_transfer_original_client_once(self):
        with self.system(False) as s:
            with self.assertRaises(ValueError): guard._DataRelay.open_egress(s.peer)
            self.assertGreaterEqual(s.local.fileno(), 0)
        with self.system() as s:
            self.assertIs(s.relay._target, s.local)
            self.assertIsNone(s.peer._client)
            with self.assertRaises(ValueError): guard._DataRelay.open_egress(s.peer)
            self.assertEqual(len(s.egress_connects), 1)

    def test_real_bidirectional_bytes_and_half_close_after_auth_deadline(self):
        with self.system() as s:
            s.now += 20
            s.client.sendall(b'GET /synthetic HTTP/1.1\r\n\r\n')
            s.relay.advance('target', selectors.EVENT_READ)
            s.relay.advance('app', selectors.EVENT_WRITE)
            self.assertEqual(s.remote.recv(1024), b'GET /synthetic HTTP/1.1\r\n\r\n')
            s.client.shutdown(socket.SHUT_WR)
            s.relay.advance('target', selectors.EVENT_READ)
            self.assertEqual(s.remote.recv(1), b'')
            s.remote.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
            s.remote.shutdown(socket.SHUT_WR)
            s.relay.advance('app', selectors.EVENT_READ)
            s.relay.advance('app', selectors.EVENT_READ)
            s.relay.advance('target', selectors.EVENT_WRITE)
            self.assertEqual(s.client.recv(1024), b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
            self.assertEqual(s.client.recv(1), b'')
            self.assertTrue(s.relay._finished)
            s.egress_source._check()

    def test_original_source_veto_before_actual_send_and_rights_after_auth(self):
        for mode in ('source', 'credential', 'death', 'rights'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'rights':
                    s.remote.sendmsg([b'blocked'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                        array.array('i', [s.listeners[0].fileno()]))])
                    event, side = selectors.EVENT_READ, 'app'
                else:
                    s.client.sendall(b'blocked')
                    s.relay.advance('target', selectors.EVENT_READ)
                    if mode == 'source': s.worker._binding = dict(s.worker._binding)
                    elif mode == 'credential':
                        s.egress_credential.write_bytes(s.egress_credential.read_bytes().replace(b'"version": 1', b'"version": 2'))
                    else: NATIVE.write(s.app_writers[0], b'x')
                    event, side = selectors.EVENT_WRITE, 'app'
                with self.assertRaises(ValueError): s.relay.advance(side, event)
                self.assertEqual(s.local.fileno(), -1)
                self.assertEqual(s.egress_streams[0].fileno(), -1)
                self.assertNotIn('<egress-unwanted-right>', s.opened.values())

    def test_shared_queue_limit_and_first_byte_deadline(self):
        with self.system() as s:
            for _ in range(16):
                s.client.sendall(b'x' * 4096)
                s.relay.advance('target', selectors.EVENT_READ)
            self.assertEqual(len(s.relay._to_app), 65536)
            self.assertFalse(s.relay.interests()['target'] & selectors.EVENT_READ)
            s.now += 30
            with self.assertRaises(ValueError): s.relay.interests()


if __name__ == '__main__': unittest.main()
