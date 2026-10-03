"""Real Unix/TCP streams; only Linux identity and O_PATH connect are simulated."""
import array
import contextlib
import hashlib
import hmac
import selectors
import socket
import struct
import unittest
from unittest.mock import patch
import test_quartet_egress_source as fixture

guard, NATIVE = fixture.guard, fixture.NATIVE
Socket = fixture.fixture.Socket
FRAME = struct.Struct('!4sBB20s16s16s32s32s32s')
DOMAIN = b'HoladayPool/egress-auth/v1\0'


class EgressPeerTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, listening=False, authority=False):
        with fixture.EgressSourceTests().system(listening=listening, authority=authority) as s, contextlib.ExitStack() as stack:
            listener = stack.enter_context(Socket(socket.AF_UNIX, socket.SOCK_STREAM))
            endpoint = str(s.root / 'run/holaday-pool/peer.sock')
            listener.bind(endpoint)
            listener.listen(1)
            listener.settimeout(1)
            s.egress_listener = listener
            tcp = stack.enter_context(Socket(socket.AF_INET, socket.SOCK_STREAM))
            tcp.bind(('127.0.0.1', 0))
            tcp.listen(1)
            client = stack.enter_context(Socket(socket.AF_INET, socket.SOCK_STREAM))
            client.connect(tcp.getsockname())
            client.settimeout(1)
            local = stack.enter_context(tcp.accept()[0])
            app = s.binding['application']
            s.egress_peercred = struct.pack('=iII', app['pid'], app['uid'], app['gid'])
            s.egress_flags, s.egress_short = 0, None
            s.egress_hook = lambda _: None
            s.egress_connects, s.egress_streams = [], []
            class LinuxStream(Socket):
                def connect_ex(self, path):
                    s.egress_connects.append(path)
                    self_result = super().connect_ex(endpoint)
                    s.egress_hook('connect')
                    return self_result
                def getsockopt(self, level, option, *args):
                    if option == socket.SO_PEERCRED: return s.egress_peercred
                    return super().getsockopt(level, option, *args)
                def setsockopt(self, level, option, value):
                    if option == socket.SO_PASSCRED: return
                    return super().setsockopt(level, option, value)
                def recvmsg(self, size, space, flags=0):
                    data, ancillary, flags, address = super().recvmsg(size, space)
                    for level, name, raw in ancillary:
                        if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                            for fd in array.array('i', raw):
                                s.opened[fd] = '<egress-unwanted-right>'
                                NATIVE.set_inheritable(fd, False)
                    s.egress_hook('recv')
                    creds = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.egress_peercred)] if data else []
                    return data, ancillary + creds, flags | s.egress_flags, address
                def send(self, data, *args):
                    if s.egress_short is not None: data = data[:s.egress_short]
                    result = super().send(data, *args)
                    s.egress_hook('send')
                    return result
            def stream(*args):
                value = LinuxStream(*args)
                s.egress_streams.append(value)
                return value
            stack.enter_context(patch.object(guard, '_EgressSocket', stream, create=True))
            cls = getattr(guard, '_EgressPeer', None)
            self.assertIsNotNone(cls, 'original source egress authentication missing')
            peer = None
            try:
                peer = cls.open(s.egress_source, local)
                remote = stack.enter_context(listener.accept()[0])
                remote.settimeout(1)
                s.peer, s.remote, s.local, s.client = peer, remote, local, client
                yield s
            finally:
                if peer is not None: peer.close()

    def hello(self, s):
        while s.peer._state != 'challenge': s.peer.advance(selectors.EVENT_WRITE)
        wire = b''
        while len(wire) < FRAME.size: wire += s.remote.recv(FRAME.size - len(wire))
        fields = FRAME.unpack(wire)
        self.assertEqual(fields[:3], (b'HPG1', 1, 3))
        self.assertEqual(fields[6], b'\0' * 32)
        self.assertNotEqual(fields[7], b'\0' * 32)
        self.assertEqual(wire[-32:], hmac.new(bytes.fromhex(s.egress_binding['key']), DOMAIN + wire[:-32], hashlib.sha256).digest())
        return wire

    def challenge(self, s, hello, server=b's' * 32):
        fields = list(FRAME.unpack(hello))
        fields[1], fields[6] = 2, server
        header = FRAME.pack(*fields)[:-32]
        return header + hmac.new(bytes.fromhex(s.egress_binding['key']), DOMAIN + header + hello[-32:], hashlib.sha256).digest()

    def authenticate(self, s):
        hello = self.hello(s)
        challenge = self.challenge(s, hello)
        s.remote.sendall(challenge)
        s.peer.advance(selectors.EVENT_READ)
        while not s.peer._authenticated: s.peer.advance(selectors.EVENT_WRITE)
        ack = b''
        while len(ack) < FRAME.size: ack += s.remote.recv(FRAME.size - len(ack))
        self.assertEqual(FRAME.unpack(ack)[1], 3)
        self.assertEqual(ack[-32:], hmac.new(bytes.fromhex(s.egress_binding['key']), DOMAIN + ack[:-32] + challenge[-32:] + hello[-32:], hashlib.sha256).digest())

    def test_fragmented_auth_and_partial_writes_never_consume_local_http_before_ack(self):
        with self.system() as s:
            s.client.sendall(b'GET /synthetic HTTP/1.1\r\n\r\n')
            s.egress_short = 17
            hello = self.hello(s)
            challenge = self.challenge(s, hello)
            for fragment in (challenge[:30], challenge[30:]):
                s.remote.sendall(fragment)
                s.peer.advance(selectors.EVENT_READ)
                self.assertFalse(s.peer._authenticated)
            while not s.peer._authenticated: s.peer.advance(selectors.EVENT_WRITE)
            ack = b''
            while len(ack) < FRAME.size: ack += s.remote.recv(FRAME.size - len(ack))
            self.assertEqual(len(ack), FRAME.size)
            self.assertEqual(s.local.recv(100, socket.MSG_PEEK), b'GET /synthetic HTTP/1.1\r\n\r\n')
            self.assertEqual(s.egress_connects, [s.egress_source._path()])

    def test_bad_challenge_credentials_rights_or_deadline_closes_both_streams(self):
        for mode in ('tag', 'scope', 'nonce', 'replay', 'extra', 'credentials', 'rights', 'truncated', 'timeout', 'death'):
            with self.subTest(mode=mode), self.system() as s:
                hello = self.hello(s)
                challenge = self.challenge(s, hello, b'\0' * 32 if mode == 'nonce' else b's' * 32)
                if mode == 'tag': challenge = challenge[:-1] + bytes([challenge[-1] ^ 1])
                if mode == 'scope': challenge = challenge[:6] + b'x' + challenge[7:]
                if mode == 'replay': challenge = hello
                if mode == 'extra': challenge += b'x'
                if mode == 'credentials': s.egress_peercred = struct.pack('=iII', 999, 998, 998)
                if mode == 'truncated': s.egress_flags = socket.MSG_CTRUNC
                if mode == 'timeout': s.now += 5
                if mode == 'death': NATIVE.write(s.app_writers[0], b'x')
                if mode == 'rights':
                    s.remote.sendmsg([challenge], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [s.listeners[0].fileno()]))])
                else: s.remote.sendall(challenge)
                with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_READ)
                self.assertFalse(s.peer._authenticated)
                self.assertEqual(s.local.fileno(), -1)
                self.assertEqual(s.egress_streams[0].fileno(), -1)
                self.assertNotIn('<egress-unwanted-right>', s.opened.values())

    def test_close_during_recvmsg_still_closes_delivered_rights(self):
        with self.system() as s:
            challenge = self.challenge(s, self.hello(s))
            s.remote.sendmsg([challenge], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [s.listeners[0].fileno()]))])
            s.egress_hook = lambda _: s.peer.close()
            with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_READ)
            self.assertNotIn('<egress-unwanted-right>', s.opened.values())

    def test_last_ack_write_cannot_authenticate_after_expiry_or_source_change(self):
        for mode in ('expiry', 'source'):
            with self.subTest(mode=mode), self.system() as s:
                s.remote.sendall(self.challenge(s, self.hello(s)))
                s.peer.advance(selectors.EVENT_READ)
                def mutate(_):
                    if mode == 'expiry': s.now += 5
                    else: s.worker._binding = dict(s.worker._binding)
                s.egress_hook = mutate
                with self.assertRaises(ValueError): s.peer.advance(selectors.EVENT_WRITE)
                self.assertFalse(s.peer._authenticated)


if __name__ == '__main__': unittest.main()
