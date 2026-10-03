"""Real nonblocking Unix streams and HPB1 guard; only Linux credential seams."""
import array
import contextlib
import hashlib
import hmac
import selectors
import socket
import struct
import unittest

import test_quartet_bridge_receiver as fixture

guard, NATIVE, Socket = fixture.guard, fixture.NATIVE, fixture.Socket
FRAME = struct.Struct('!4sBB20s16s16s32s32s32s')
DOMAIN = b'HoladayPool/data-auth/v1\0'


class DataPeerTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, kind=1, delay=0, listening=False):
        with fixture.BridgeReceiverTests().system(listening=listening) as s:
            s.worker._receive_bridge()
            s.now += delay
            peer_class = getattr(guard, '_DataPeer', None)
            self.assertTrue(callable(peer_class), 'nonblocking original-app data authentication missing')
            left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
            right.settimeout(1)
            app = s.binding['application']
            s.data_credential = struct.pack('=iII', app['pid'], app['uid'], app['gid'])
            s.data_flags, s.data_short, s.data_hook = 0, False, lambda _: None
            s.data_close_failure = False
            s.data_eof_credential = True
            s.data_sent = []
            class LinuxStream(Socket):
                def getsockopt(self, level, option, *args):
                    if option == socket.SO_PEERCRED: return s.data_credential
                    return super().getsockopt(level, option, *args)
                def setsockopt(self, level, option, value):
                    if option == socket.SO_PASSCRED: return
                    return super().setsockopt(level, option, value)
                def recvmsg(self, size, space, flags=0):
                    data, ancillary, flags, address = super().recvmsg(size, space)
                    for level, name, raw in ancillary:
                        if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                            for fd in array.array('i', raw):
                                s.opened[fd] = '<data-unwanted-right>'
                                NATIVE.set_inheritable(fd, False)
                    s.data_hook('recv')
                    credentials = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.data_credential)] if data or s.data_eof_credential else []
                    return data, ancillary + credentials, flags | s.data_flags, address
                def sendmsg(self, buffers, *args):
                    count = super().sendmsg(buffers, *args)
                    s.data_sent.append(b''.join(buffers))
                    s.data_hook('send')
                    return count - 1 if s.data_short else count
                def close(self):
                    super().close()
                    if s.data_close_failure:
                        s.data_close_failure = False
                        raise OSError('synthetic post-close failure')
            channel = LinuxStream(fileno=left.detach())
            s.data_stream_class = LinuxStream
            peer = None
            try:
                peer = peer_class.open(s.worker, channel, kind)
                s.peer, s.client, s.data_channel = peer, right, channel
                yield s
            finally:
                if peer is not None: peer.close()
                channel.close()
                right.close()

    def challenge(self, s):
        self.assertFalse(s.peer._authenticated)
        self.assertEqual(s.peer.advance(selectors.EVENT_WRITE), selectors.EVENT_READ)
        wire = s.client.recv(FRAME.size + 1)
        self.assertEqual(len(wire), FRAME.size)
        fields = FRAME.unpack(wire)
        self.assertEqual(fields[:3], (b'HPD1', 1, s.peer._kind))
        self.assertEqual(fields[7], b'\0' * 32)
        self.assertNotEqual(fields[6], b'\0' * 32)
        self.assertEqual(wire[-32:], hmac.new(bytes.fromhex(s.binding['dataKey']), DOMAIN + wire[:-32], hashlib.sha256).digest())
        return fields

    def response(self, s, fields, *, key=None, client=b'\x7f' * 32):
        values = list(fields)
        values[1], values[7], values[8] = 2, client, b'\0' * 32
        header = FRAME.pack(*values)[:-32]
        return header + hmac.new(key or bytes.fromhex(s.binding['dataKey']), DOMAIN + header, hashlib.sha256).digest()

    def test_actual_stream_fragmented_response_requires_complete_ack(self):
        for kind in (1, 2):
            with self.subTest(kind=kind), self.system(kind) as s:
                fields = self.challenge(s)
                response = self.response(s, fields)
                s.client.sendall(response[:17])
                self.assertEqual(s.peer.advance(selectors.EVENT_READ), selectors.EVENT_READ)
                self.assertFalse(s.peer._authenticated)
                s.client.sendall(response[17:])
                self.assertEqual(s.peer.advance(selectors.EVENT_READ), selectors.EVENT_WRITE)
                self.assertFalse(s.peer._authenticated)
                self.assertEqual(s.peer.advance(selectors.EVENT_WRITE), 0)
                ack = s.client.recv(FRAME.size + 1)
                values = FRAME.unpack(ack)
                self.assertEqual(values[1], 3)
                self.assertEqual(values[7], b'\x7f' * 32)
                self.assertEqual(ack[-32:], hmac.new(bytes.fromhex(s.binding['dataKey']),
                    DOMAIN + ack[:-32] + response[-32:], hashlib.sha256).digest())
                self.assertTrue(s.peer._authenticated)

    def test_unavailable_read_does_not_block_or_authenticate(self):
        with self.system() as s:
            self.challenge(s)
            self.assertEqual(s.peer.advance(selectors.EVENT_READ), selectors.EVENT_READ)
            self.assertFalse(s.peer._authenticated)

    def congest(self, s):
        total = 0
        while True:
            try: total += s.data_channel.send(b'p' * 4096)
            except BlockingIOError: break
            self.assertLess(total, 1048576, 'unexpected local socket send-buffer size')
        return total

    def consume_padding(self, s, total):
        while total:
            chunk = s.client.recv(total)
            self.assertTrue(chunk)
            self.assertEqual(chunk, b'p' * len(chunk))
            total -= len(chunk)

    def test_write_eagain_resumes_original_challenge_and_ack_once(self):
        with self.system() as s:
            total = self.congest(s)
            self.assertEqual(s.peer.advance(selectors.EVENT_WRITE), selectors.EVENT_WRITE)
            self.assertEqual(s.data_sent, [])
            self.consume_padding(s, total)
            response = self.response(s, self.challenge(s))
            s.client.sendall(response)
            s.peer.advance(selectors.EVENT_READ)
            total = self.congest(s)
            self.assertEqual(s.peer.advance(selectors.EVENT_WRITE), selectors.EVENT_WRITE)
            self.assertFalse(s.peer._authenticated)
            self.consume_padding(s, total)
            self.assertEqual(s.peer.advance(selectors.EVENT_WRITE), 0)
            self.assertEqual(FRAME.unpack(s.client.recv(FRAME.size))[1], 3)
            self.assertEqual(len(s.data_sent), 2)

    def test_auth_uses_new_bounded_io_budget_without_extending_each_fragment(self):
        with self.system(delay=10) as s:
            response = self.response(s, self.challenge(s))
            s.now += 4
            s.client.sendall(response[:40])
            s.peer.advance(selectors.EVENT_READ)
            s.now += 2
            s.client.sendall(response[40:])
            with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_READ)
            self.assertFalse(s.peer._authenticated)

    def test_wrong_tag_context_nonce_and_observed_extra_bytes_permanently_close(self):
        for mode in ('key', 'kind', 'candidate', 'resource', 'boot', 'nonce', 'zero-client', 'extra', 'replay'):
            with self.subTest(mode=mode), self.system() as s:
                fields = list(self.challenge(s))
                if mode in ('kind', 'candidate', 'resource', 'boot', 'nonce'):
                    index = {'kind': 2, 'candidate': 3, 'resource': 4, 'boot': 5, 'nonce': 6}[mode]
                    fields[index] = 2 if index == 2 else b'\x33' * len(fields[index])
                response = self.response(s, fields, key=b'\x44' * 32 if mode == 'key' else None,
                                         client=b'\0' * 32 if mode == 'zero-client' else b'\x7f' * 32)
                if mode == 'extra': response += b'X'
                if mode == 'replay': response = s.data_sent[0]
                s.client.sendall(response)
                with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_READ)
                self.assertFalse(s.peer._authenticated)
                self.assertEqual(s.data_channel.fileno(), -1)
                with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_WRITE)

    def test_credentials_rights_truncation_and_app_death_deny_even_valid_hmac(self):
        for mode in ('credentials', 'rights', 'truncation', 'death', 'deadline', 'short-ack', 'ack-death'):
            with self.subTest(mode=mode), self.system() as s:
                response = self.response(s, self.challenge(s))
                if mode == 'credentials': s.data_credential = struct.pack('=iII', 124, 998, 998)
                if mode == 'truncation': s.data_flags = socket.MSG_CTRUNC
                if mode == 'death': NATIVE.write(s.app_writers[0], b'x')
                if mode == 'deadline': s.now += 6
                if mode == 'rights':
                    s.client.sendmsg([response], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                                 array.array('i', [s.listeners[0].fileno()]))])
                else: s.client.sendall(response)
                if mode in ('short-ack', 'ack-death'):
                    s.peer.advance(selectors.EVENT_READ)
                    s.data_short = mode == 'short-ack'
                    if mode == 'ack-death': s.data_hook = lambda _: NATIVE.write(s.app_writers[0], b'x')
                    event = selectors.EVENT_WRITE
                else: event = selectors.EVENT_READ
                with self.assertRaises(ValueError): s.peer.advance(event)
                self.assertFalse(s.peer._authenticated)
                self.assertEqual(s.data_channel.fileno(), -1)
                self.assertNotIn('<data-unwanted-right>', s.opened.values())

    def test_changed_sender_on_later_fragment_is_rejected(self):
        with self.system() as s:
            response = self.response(s, self.challenge(s))
            s.client.sendall(response[:40])
            s.peer.advance(selectors.EVENT_READ)
            s.data_credential = struct.pack('=iII', 124, 998, 998)
            s.client.sendall(response[40:])
            with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_READ)
            self.assertFalse(s.peer._authenticated)

    def test_failed_stream_cleanup_still_closes_every_smuggled_right(self):
        with self.system() as s:
            response = self.response(s, self.challenge(s))
            s.client.sendmsg([response], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                          array.array('i', [item.fileno() for item in s.listeners]))])
            s.data_close_failure = True
            try:
                s.peer.advance(selectors.EVENT_READ)
            except Exception:
                pass
            self.assertNotIn('<data-unwanted-right>', s.opened.values())



if __name__ == '__main__':
    unittest.main()
