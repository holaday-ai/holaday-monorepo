"""Actual selector, retained listeners, authenticated streams, and TCP targets."""
import contextlib
import selectors
import socket
import unittest
from unittest.mock import patch

import test_quartet_data_peer as fixture

guard, Socket, NATIVE, FRAME = fixture.guard, fixture.Socket, fixture.NATIVE, fixture.FRAME


class AnchorBridgeTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, open_engine=True):
        helper = fixture.DataPeerTests()
        with helper.system(listening=True) as s, contextlib.ExitStack() as stack:
            target = stack.enter_context(Socket(socket.AF_INET, socket.SOCK_STREAM))
            target.bind(('127.0.0.1', 0))
            target.listen(80)
            target.settimeout(1)
            s.connects, s.clients, s.listener_instances = [], [], []
            class Listener(Socket):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs)
                    s.listener_aliases.append(self.fileno())
                    s.listener_instances.append(self)
                def accept(self):
                    stream, address = super().accept()
                    return s.data_stream_class(fileno=stream.detach()), address
                def close(self):
                    fd = self.fileno()
                    super().close()
                    if fd in s.listener_aliases: s.listener_aliases.remove(fd)
            class Target(Socket):
                def connect_ex(self, address):
                    s.connects.append(address)
                    return super().connect_ex(target.getsockname())
            bridge_class = getattr(guard, '_AnchorBridge', None)
            self.assertTrue(callable(bridge_class), 'bounded selector bridge missing')
            stack.enter_context(patch.object(guard, '_ListenerSocket', Listener))
            stack.enter_context(patch.object(guard, '_RelaySocket', Target))
            bridge = bridge_class.open(s.worker) if open_engine else None
            s.engine, s.tcp_listener, s.helper = bridge, target, helper
            try: yield s
            finally:
                if bridge is not None: bridge.close()
                for client in s.clients: client.close()
                self.assertEqual(s.listener_aliases, [])

    def connect(self, s, kind=1):
        client = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.clients.append(client)
        client.settimeout(1)
        client.connect(s.listeners[kind - 1].getsockname())
        for _ in range(3): s.engine.tick()
        fields = FRAME.unpack(client.recv(FRAME.size))
        self.assertEqual(fields[2], kind)
        return client, fields

    def authenticate(self, s, client, fields):
        client.sendall(s.helper.response(s, fields))
        for _ in range(4): s.engine.tick()
        ack = FRAME.unpack(client.recv(FRAME.size))
        self.assertEqual(ack[1], 3)
        target = s.tcp_listener.accept()[0]
        target.settimeout(1)
        return target

    def test_slow_authentication_does_not_block_second_real_connection(self):
        with self.system() as s:
            waiting, _ = self.connect(s)
            client, fields = self.connect(s, 2)
            with self.authenticate(s, client, fields) as target:
                self.assertEqual(s.connects, [('127.0.0.1', 16080)])
                client.sendall(b'websocket request')
                for _ in range(3): s.engine.tick()
                self.assertEqual(target.recv(128), b'websocket request')
                target.sendall(b'websocket response')
                for _ in range(3): s.engine.tick()
                self.assertEqual(client.recv(128), b'websocket response')
                s.now += 6
                s.engine.tick()
                self.assertEqual(waiting.recv(1), b'')
                client.sendall(b'still open')
                for _ in range(3): s.engine.tick()
                self.assertEqual(target.recv(128), b'still open')
                self.assertEqual(len(s.engine._connections), 1)

    def test_application_exit_closes_every_connection_and_owned_listener(self):
        with self.system() as s:
            client, fields = self.connect(s)
            with self.authenticate(s, client, fields) as target:
                NATIVE.write(s.app_writers[0], b'x')
                with self.assertRaises(ValueError): s.engine.tick()
                self.assertEqual(client.recv(1), b'')
                self.assertEqual(target.recv(1), b'')
                self.assertEqual(s.listener_aliases, [])
                self.assertEqual(s.engine._connections, {})

    def test_connection_count_is_bounded_and_extra_client_is_closed(self):
        with self.system() as s:
            for _ in range(64): self.connect(s)
            extra = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.clients.append(extra)
            extra.settimeout(1)
            extra.connect(s.listeners[0].getsockname())
            s.engine.tick()
            self.assertEqual(extra.recv(1), b'')
            self.assertEqual(len(s.engine._connections), 64)
            self.assertEqual(s.connects, [])

    def test_duplicate_listener_is_owned_before_any_fallible_original_metadata_read(self):
        with self.system(open_engine=False) as s:
            original = guard.os.fstat
            def metadata(fd):
                if s.listener_instances and fd in s.received: raise OSError('synthetic original metadata unavailable')
                return original(fd)
            with patch.object(guard.os, 'fstat', metadata):
                try: guard._AnchorBridge.open(s.worker)
                except ValueError as error: retained = error
                else: self.fail('must reject unavailable original object')
            self.assertIsNotNone(retained.__traceback__)
            self.assertEqual(len(s.listener_instances), 1)
            self.assertEqual(s.listener_instances[0].fileno(), -1)


if __name__ == '__main__':
    unittest.main()
