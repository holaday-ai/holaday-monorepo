"""One real selector for data and original-source egress, shared capacity."""
import contextlib
import selectors
import socket
import unittest
from unittest.mock import patch
import test_quartet_egress_peer as fixture

guard, NATIVE, Socket, FRAME = fixture.guard, fixture.NATIVE, fixture.Socket, fixture.FRAME


class AnchorEgressTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, attach=True, authority=False):
        with fixture.EgressPeerTests().system(listening=True, authority=authority) as s, contextlib.ExitStack() as stack:
            s.peer.close()
            s.remote.close()
            s.egress_clients, s.egress_nodes, s.egress_local_listeners = [], [], []
            s.egress_listen_hook = lambda: None
            class DataStream(Socket):
                def getsockopt(self, level, option, *args):
                    if option == socket.SO_PEERCRED: return s.egress_peercred
                    return super().getsockopt(level, option, *args)
                def setsockopt(self, level, option, value):
                    if option == socket.SO_PASSCRED: return
                    return super().setsockopt(level, option, value)
            class DataListener(Socket):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs)
                    s.listener_aliases.append(self.fileno())
                def accept(self):
                    stream, address = super().accept()
                    return DataStream(fileno=stream.detach()), address
                def close(self):
                    fd = self.fileno()
                    super().close()
                    if fd in s.listener_aliases: s.listener_aliases.remove(fd)
            class EgressListener(Socket):
                def __init__(self, *args):
                    super().__init__(*args)
                    s.opened[self.fileno()] = '<egress-local-listener>'
                    s.egress_local_listeners.append(self)
                def bind(self, address):
                    self.expected_address = address
                    self.assert_fixed = address == ('127.0.0.1', 18080)
                    super().bind(('127.0.0.1', 0))
                    self.real_address = super().getsockname()
                def getsockname(self):
                    s.egress_listen_hook()
                    return self.expected_address
                def listen(self, backlog):
                    super().listen(backlog)
                    self.actual_listening = True
                def getsockopt(self, level, option, *args):
                    # Darwin rejects SO_ACCEPTCONN; real listen/connect remain exercised.
                    if option == socket.SO_ACCEPTCONN: return int(getattr(self, 'actual_listening', False))
                    return super().getsockopt(level, option, *args)
                def close(self):
                    fd = self.fileno()
                    super().close()
                    s.opened.pop(fd, None)
            stack.enter_context(patch.object(guard, '_ListenerSocket', DataListener))
            stack.enter_context(patch.object(guard, '_EgressListenerSocket', EgressListener, create=True))
            engine = guard._AnchorBridge.open(s.worker)
            s.engine = engine
            try:
                method = getattr(engine, '_attach_egress', None)
                self.assertIsNotNone(method, 'one-selector original-source egress attachment missing')
                if attach: method(s.egress_source)
                yield s
            finally:
                engine.close()
                for stream in s.egress_clients + s.egress_nodes: stream.close()

    def connect(self, s):
        client = Socket(socket.AF_INET, socket.SOCK_STREAM)
        s.egress_clients.append(client)
        client.settimeout(1)
        client.connect(s.egress_local_listeners[0].real_address)
        s.engine.tick()
        remote = s.egress_listener.accept()[0]
        s.egress_nodes.append(remote)
        remote.settimeout(1)
        for _ in range(3): s.engine.tick()
        hello = remote.recv(FRAME.size)
        self.assertEqual(len(hello), FRAME.size)
        return client, remote, hello

    def test_original_listener_and_selector_forward_authenticated_http(self):
        with self.system() as s:
            self.assertTrue(s.egress_local_listeners[0].assert_fixed)
            with self.assertRaises(ValueError): s.engine._attach_egress(s.egress_source)
            # Duplicate attachment is rejected without touching the live owner.
            client, remote, hello = self.connect(s)
            remote.sendall(fixture.EgressPeerTests().challenge(s, hello))
            for _ in range(3): s.engine.tick()
            self.assertEqual(FRAME.unpack(remote.recv(FRAME.size))[1], 3)
            client.sendall(b'GET /synthetic HTTP/1.1\r\n\r\n')
            for _ in range(3): s.engine.tick()
            self.assertEqual(remote.recv(1024), b'GET /synthetic HTTP/1.1\r\n\r\n')
            remote.sendall(b'synthetic response')
            for _ in range(3): s.engine.tick()
            self.assertEqual(client.recv(1024), b'synthetic response')
            self.assertEqual(len(s.engine._connections), 1)

    def test_idle_auth_timeout_is_local_but_source_death_closes_all(self):
        with self.system() as s:
            client, remote, _ = self.connect(s)
            s.now += 5
            s.engine.tick()
            self.assertEqual(client.recv(1), b'')
            self.assertEqual(remote.recv(1), b'')
            self.assertEqual(len(s.engine._connections), 0)
            client, remote, _ = self.connect(s)
            NATIVE.write(s.app_writers[0], b'x')
            with self.assertRaises(ValueError): s.engine.tick()
            self.assertEqual(client.recv(1), b'')
            self.assertEqual(remote.recv(1), b'')
            self.assertTrue(s.egress_source._closed)
            self.assertEqual(s.egress_local_listeners[0].fileno(), -1)

    def test_data_and_egress_auth_share_one_sixty_four_connection_limit(self):
        with self.system() as s:
            # Keep one data authentication outstanding using its original listener.
            data = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.egress_clients.append(data)
            data.connect(s.listeners[0].getsockname())
            s.engine.tick()
            self.assertEqual(len(s.engine._connections), 1)
            for _ in range(63): self.connect(s)
            extra = Socket(socket.AF_INET, socket.SOCK_STREAM)
            s.egress_clients.append(extra)
            extra.settimeout(1)
            extra.connect(s.egress_local_listeners[0].real_address)
            s.engine.tick()
            self.assertEqual(extra.recv(1), b'')
            self.assertEqual(len(s.engine._connections), 64)
            self.assertEqual(len(s.egress_connects), 64)  # Includes fixture's retired peer.

    def test_final_listener_query_cannot_hide_closed_source(self):
        with self.system() as s:
            s.egress_listen_hook = s.egress_source.close
            with self.assertRaises(ValueError): s.engine._check()

    def test_final_attach_query_cannot_hide_closed_source(self):
        with self.system(attach=False) as s:
            original = s.engine._sync
            def final_sync():
                original()
                s.egress_listen_hook = s.egress_source.close
            with patch.object(s.engine, '_sync', side_effect=final_sync):
                with self.assertRaises(ValueError): s.engine._attach_egress(s.egress_source)
            self.assertEqual(s.egress_local_listeners[0].fileno(), -1)
            self.assertEqual(s.engine._connections, {})


if __name__ == '__main__': unittest.main()
