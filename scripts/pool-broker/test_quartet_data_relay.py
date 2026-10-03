"""Actual authenticated Unix stream to TCP relay; Linux credentials are seams."""
import array
import contextlib
import errno
import selectors
import socket
import struct
import unittest
from unittest.mock import patch

import test_quartet_data_peer as data_fixture

FRAME, guard, NATIVE, Socket = data_fixture.FRAME, data_fixture.guard, data_fixture.NATIVE, data_fixture.Socket


class DataRelayTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, kind=1, authenticate=True):
        fixture = data_fixture.DataPeerTests()
        with fixture.system(kind) as s, contextlib.ExitStack() as stack:
            listener = stack.enter_context(Socket(socket.AF_INET, socket.SOCK_STREAM))
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(1)
            s.connects = []
            s.target_hook = lambda: None
            class LocalTarget(Socket):
                def connect_ex(self, address):
                    s.connects.append(address)
                    return super().connect_ex(listener.getsockname())
                def recv(self, size, *args):
                    data = super().recv(size, *args)
                    s.target_hook()
                    return data
            relay_class = getattr(guard, '_DataRelay', None)
            self.assertTrue(callable(relay_class), 'actual fixed-target data relay missing')
            stack.enter_context(patch.object(guard, '_RelaySocket', LocalTarget))
            if authenticate:
                s.client.sendall(fixture.response(s, fixture.challenge(s)))
                s.peer.advance(selectors.EVENT_READ)
                s.peer.advance(selectors.EVENT_WRITE)
                self.assertEqual(len(s.client.recv(FRAME.size)), FRAME.size)
            s.relay = None
            try:
                if authenticate:
                    s.relay = relay_class.open(s.peer)
                    s.target = stack.enter_context(listener.accept()[0])
                    s.target.settimeout(1)
                    s.relay.advance('target', selectors.EVENT_WRITE)
                yield s
            finally:
                if s.relay is not None: s.relay.close()

    def test_only_completed_auth_can_connect_and_fixed_targets_are_distinct(self):
        with self.system(authenticate=False) as s:
            with self.assertRaises(ValueError): guard._DataRelay.open(s.peer)
            self.assertEqual(s.connects, [])
        for kind, port in ((1, 19222), (2, 16080)):
            with self.subTest(kind=kind), self.system(kind) as s:
                self.assertEqual(s.connects, [('127.0.0.1', port)])
                with self.assertRaises(ValueError): guard._DataRelay.open(s.peer)
                self.assertEqual(len(s.connects), 1)

    def test_bidirectional_bytes_remain_valid_after_auth_budget_and_half_close_flushes(self):
        with self.system() as s:
            s.now += 20  # Authentication's five seconds is not the relay lifetime.
            s.data_eof_credential = False
            s.client.sendall(b'client request')
            s.relay.advance('app', selectors.EVENT_READ)
            s.relay.advance('target', selectors.EVENT_WRITE)
            self.assertEqual(s.target.recv(1024), b'client request')
            s.client.shutdown(socket.SHUT_WR)
            s.relay.advance('app', selectors.EVENT_READ)
            self.assertEqual(s.target.recv(1), b'')
            s.target.sendall(b'final response')
            s.target.shutdown(socket.SHUT_WR)
            s.relay.advance('target', selectors.EVENT_READ)
            s.relay.advance('target', selectors.EVENT_READ)
            self.assertFalse(s.relay._finished)
            s.relay.advance('app', selectors.EVENT_WRITE)
            self.assertEqual(s.client.recv(1024), b'final response')
            self.assertEqual(s.client.recv(1), b'')
            self.assertTrue(s.relay._finished)
            self.assertFalse(hasattr(s.relay, 'groupExitProven'))

    def test_both_queues_are_bounded_and_restore_read_interest_after_flush(self):
        with self.system() as s:
            payload = b'x' * 4096
            for _ in range(16):
                s.client.sendall(payload)
                s.target.sendall(payload)
                s.relay.advance('app', selectors.EVENT_READ)
                s.relay.advance('target', selectors.EVENT_READ)
            self.assertEqual(len(s.relay._to_target), 65536)
            self.assertEqual(len(s.relay._to_app), 65536)
            interests = s.relay.interests()
            self.assertFalse(interests['app'] & selectors.EVENT_READ)
            self.assertFalse(interests['target'] & selectors.EVENT_READ)
            s.relay.advance('app', selectors.EVENT_WRITE)
            s.relay.advance('target', selectors.EVENT_WRITE)
            self.assertTrue(s.relay.interests()['app'] & selectors.EVENT_READ)
            self.assertTrue(s.relay.interests()['target'] & selectors.EVENT_READ)

    def test_queue_deadline_is_not_extended_by_new_input(self):
        with self.system() as s:
            s.client.sendall(b'first')
            s.relay.advance('app', selectors.EVENT_READ)
            s.now += 29
            s.client.sendall(b'later')
            s.relay.advance('app', selectors.EVENT_READ)
            s.now += 2
            with self.assertRaises(ValueError): s.relay.interests()
            self.assertEqual(s.data_channel.fileno(), -1)

    def test_credentials_or_rights_cannot_be_smuggled_after_valid_authentication(self):
        for mode in ('credentials', 'rights', 'truncation', 'death', 'backwards'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'credentials': s.data_credential = struct.pack('=iII', 124, 998, 998)
                if mode == 'truncation': s.data_flags = socket.MSG_CTRUNC
                if mode == 'death': NATIVE.write(s.app_writers[0], b'x')
                if mode == 'backwards': s.now -= 1
                if mode == 'rights':
                    s.client.sendmsg([b'x'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                        array.array('i', [item.fileno() for item in s.listeners]))])
                else: s.client.sendall(b'x')
                with self.assertRaises(ValueError): s.relay.advance('app', selectors.EVENT_READ)
                self.assertEqual(s.data_channel.fileno(), -1)
                self.assertNotIn('<data-unwanted-right>', s.opened.values())
                self.assertEqual(s.target.recv(1), b'')

    def test_application_death_after_read_discards_bytes_before_forwarding(self):
        with self.system() as s:
            s.client.sendall(b'never forwarded')
            s.data_hook = lambda _: NATIVE.write(s.app_writers[0], b'x')
            with self.assertRaises(ValueError): s.relay.advance('app', selectors.EVENT_READ)
            self.assertEqual(s.target.recv(1), b'')

    def test_close_during_recvmsg_still_owns_every_delivered_right(self):
        with self.system() as s:
            s.client.sendmsg([b'x'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                array.array('i', [item.fileno() for item in s.listeners]))])
            s.data_hook = lambda _: s.relay.close()
            with self.assertRaises(ValueError): s.relay.advance('app', selectors.EVENT_READ)
            self.assertNotIn('<data-unwanted-right>', s.opened.values())

    def test_first_read_cannot_postpone_queue_budget_past_original_thirty_seconds(self):
        for side in ('app', 'target'):
            with self.subTest(side=side), self.system() as s:
                source = s.client if side == 'app' else s.target
                source.sendall(b'late bytes')
                if side == 'app': s.data_hook = lambda _: setattr(s, 'now', s.now + 31)
                else: s.target_hook = lambda: setattr(s, 'now', s.now + 31)
                with self.assertRaises(ValueError): s.relay.advance(side, selectors.EVENT_READ)
                self.assertEqual(s.data_channel.fileno(), -1)

    def test_real_write_eagain_keeps_queued_bytes_without_extending_deadline(self):
        with self.system() as s:
            s.target.sendall(b'queued response')
            s.relay.advance('target', selectors.EVENT_READ)
            original_deadline = s.relay._app_deadline
            helper = data_fixture.DataPeerTests()
            total = helper.congest(s)
            s.now += 10
            s.relay.advance('app', selectors.EVENT_WRITE)
            self.assertEqual(s.relay._to_app, b'queued response')
            self.assertEqual(s.relay._app_deadline, original_deadline)
            helper.consume_padding(s, total)
            s.relay.advance('app', selectors.EVENT_WRITE)
            self.assertEqual(s.client.recv(100), b'queued response')
            self.assertEqual(s.relay._to_app, b'')
            self.assertIsNone(s.relay._app_deadline)


if __name__ == '__main__':
    unittest.main()
