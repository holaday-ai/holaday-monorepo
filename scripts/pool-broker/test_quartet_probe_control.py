"""Real message socket IO; Darwin DGRAM substitutes unavailable Linux SEQPACKET.

Linux credentials, connection establishment and immutable mounts are explicit seams.
"""
import array
import base64
import contextlib
import hashlib
import selectors
import socket
import stat
import struct
import unittest
from unittest.mock import patch
import test_quartet_probe_control_source as fixture
from test_quartet_probe_exchange import x11_setup, server_init
import test_quartet_protocol_probe as tcp_fixture
import test_quartet_anchor_egress as engine_fixture

guard, NATIVE = fixture.guard, fixture.NATIVE
Socket = socket.socket


class ProbeControlTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, authority=False, base=None):
        with fixture.ProbeControlSourceTests().system(authority=authority, base=base) as s, contextlib.ExitStack() as stack:
            s.control_source.close()
            client, server = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
            stack.callback(client.close)
            stack.callback(server.close)
            server.settimeout(1)
            s.control_peer = struct.pack('=iII', s.binding['brokerPid'], 0, 0)
            s.control_hook = lambda: None
            s.control_received, s.control_flags = [], 0
            s.control_stream = None
            assertion = self.assertEqual
            class Channel(Socket):
                def __init__(self, family, kind):
                    assertion((family, kind), (socket.AF_UNIX, socket.SOCK_SEQPACKET))
                    super().__init__(fileno=client.detach())
                    s.control_stream = self
                def connect_ex(self, path):
                    assertion(s.opened[int(path.rsplit('/', 1)[1])], '/run/holaday-pool/control.sock')
                    return 0
                def setsockopt(self, level, option, value):
                    if option == socket.SO_PASSCRED: return
                    return super().setsockopt(level, option, value)
                def getsockopt(self, level, option, *args):
                    if option == socket.SO_PEERCRED: return s.control_peer
                    return super().getsockopt(level, option, *args)
                def recvmsg(self, size, space, flags):
                    data, ancillary, output_flags, address = super().recvmsg(size, space, 0)
                    ancillary.append((socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.control_peer))
                    for level, kind, raw in ancillary:
                        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                            for fd in array.array('i', raw):
                                s.control_received.append(fd)
                                s.opened[fd] = '<control-unwanted-right>'
                    s.control_hook()
                    return data, ancillary, output_flags | s.control_flags, address
            stack.enter_context(patch.object(guard, '_ProbeControlSocket', Channel, create=True))
            stack.enter_context(patch.object(guard.time, 'monotonic_ns', lambda: int(s.now * 1000000000)))
            cls = getattr(guard, '_ProbeControl', None)
            self.assertIsNotNone(cls, 'original probe control consumer missing')
            if hasattr(s, 'engine'):
                attach = getattr(s.engine, '_attach_control', None)
                self.assertIsNotNone(attach, 'one-selector control attachment missing')
                attach()
                control = s.engine._control
            else: control = cls.open(s.egress_source)
            s.control, s.control_server = control, server
            try: yield s
            finally:
                control.close()
                server.close()
                client.close()

    def test_original_engine_registers_control_without_spending_business_capacity(self):
        with self.system(base=engine_fixture.AnchorEgressTests().system) as s:
            self.assertEqual(len(s.engine._connections), 0)
            self.assertEqual(len(s.engine._registered), 4)
            s.engine.tick()
            hello = s.control_server.recv(256)
            self.assertEqual(guard._decode_probe_control_frame(hello, s.binding)[:2], (1, 0))
            with self.assertRaises(ValueError): s.engine._attach_control()
            self.assertGreaterEqual(s.control_stream.fileno(), 0)
            s.control_server.send(b'invalid control')
            with self.assertRaises(ValueError): s.engine.tick()
            self.assertIsNone(s.engine._worker)
            self.assertEqual(s.control_stream.fileno(), -1)
            self.assertTrue(s.egress_source._closed)

    def test_select_returns_expired_control_before_queued_business_accept(self):
        with self.system(base=engine_fixture.AnchorEgressTests().system) as s, Socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            listener = s.engine._listeners[0][0]
            client.connect(s.listeners[0].getsockname())
            original = s.engine._selector.select
            returned = []
            def expired(_timeout):
                events = [item for item in original(0) if item[0].data == ('listener', 1)]
                returned.extend(events)
                s.now = s.control._phase_ns / 1000000000
                return events
            with patch.object(s.engine._selector, 'select', side_effect=expired), \
                    patch.object(listener, 'accept', wraps=listener.accept) as accepted:
                with self.assertRaises(ValueError): s.engine.tick()
                self.assertTrue(returned)
                accepted.assert_not_called()

    def advance(self, s, side, events):
        if hasattr(s, 'engine'): s.engine.tick()
        else: s.control.advance(side, events)

    def handshake(self, s):
        self.advance(s, 'control', selectors.EVENT_WRITE)
        hello = s.control_server.recv(256)
        self.assertEqual(guard._decode_probe_control_frame(hello, s.binding)[0:2], (1, 0))
        deadline = int((s.now + 60) * 1000000000)
        s.control_total_ns = deadline
        phase = int((s.now + 5) * 1000000000)
        challenge = guard._probe_control_frame(2, 0, s.binding, 'e' * 32, NATIVE.getpid(), b'n' * 32, deadline, phase)
        s.control_server.send(challenge)
        self.advance(s, 'control', selectors.EVENT_READ)
        self.advance(s, 'control', selectors.EVENT_WRITE)
        accept = s.control_server.recv(256)
        self.assertEqual(accept, guard._probe_control_frame(3, 0, s.binding, 'e' * 32, NATIVE.getpid(), b'n' * 32, deadline, phase))

    def test_real_handshake_does_not_observe_any_stage_or_refresh_total_deadline(self):
        with self.system() as s:
            deadline = s.control._total_deadline
            self.handshake(s)
            self.assertEqual(s.control._stage, 0)
            self.assertFalse(s.control._finished)
            self.assertEqual(s.control._total_deadline, deadline)
            self.assertEqual(s.control.interests(), {'control': selectors.EVENT_READ})
            with self.assertRaises(ValueError): guard._ProbeControl.open(s.egress_source)
            self.assertGreaterEqual(s.control_stream.fileno(), 0)

    def test_replay_wrong_phase_sender_and_deadline_fail_closed(self):
        for mode in ('stage', 'nonce', 'sender', 'deadline', 'eof'):
            with self.subTest(mode=mode), self.system() as s:
                self.handshake(s)
                wire = guard._probe_control_frame(4, 2 if mode == 'stage' else 1,
                    s.binding, 'f' * 32, 1234, b'n' * 32 if mode == 'nonce' else b'p' * 32,
                    s.control_total_ns, int((s.now + 5) * 1000000000))
                if mode == 'sender': s.control_peer = struct.pack('=iII', s.binding['brokerPid'] + 1, 0, 0)
                if mode == 'deadline': s.now = s.control._total_deadline
                if mode == 'eof': s.control_server.send(b'')
                else: s.control_server.send(wire)
                with self.assertRaises(ValueError): s.control.advance('control', selectors.EVENT_READ)
                self.assertEqual(s.control_stream.fileno(), -1)
                self.assertFalse(s.control._finished)

    def test_received_rights_close_even_if_control_is_closed_during_recvmsg(self):
        with self.system() as s:
            self.handshake(s)
            read, write = NATIVE.pipe()
            try:
                called = []
                def closed():
                    called.append(True)
                    s.control.close()
                s.control_hook = closed
                s.control_server.sendmsg([b'invalid'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [read]))])
                with self.assertRaises(ValueError): s.control.advance('control', selectors.EVENT_READ)
                self.assertEqual(called, [True])
                self.assertEqual(len(s.control_received), 1)
                with self.assertRaises(OSError): NATIVE.fstat(s.control_received[0])
                NATIVE.fstat(read)
            finally:
                NATIVE.close(read)
                NATIVE.close(write)

    @contextlib.contextmanager
    def protocols(self, s):
        with contextlib.ExitStack() as stack:
            directory = s.root / 'tmp/.X11-unix'
            directory.mkdir()
            (directory / 'X99').write_bytes(b'Linux O_PATH stand-in')
            s.metadata['/tmp/.X11-unix'] = {'st_mode': stat.S_IFDIR | 0o1777, 'st_uid': 2001, 'st_gid': 2001}
            s.metadata['/tmp/.X11-unix/X99'] = {'st_mode': stat.S_IFSOCK | 0o777, 'st_uid': 2001, 'st_gid': 2001}
            s.flags['/tmp/.X11-unix'] = s.flags['/tmp/.X11-unix/X99'] = 14
            listeners = {}
            for stage in (1, 2, 3, 4):
                listener = stack.enter_context(Socket(socket.AF_UNIX if stage == 1 else socket.AF_INET, socket.SOCK_STREAM))
                listener.bind(str(directory / 'real.sock') if stage == 1 else ('127.0.0.1', 0))
                listener.listen(1)
                listener.settimeout(1)
                listeners[stage] = listener
            original_open, assertion = guard.os.open, self.assertEqual
            def opened(name, flags, **kw):
                if name == 'X99':
                    assertion(flags, 0x200000 | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC)
                    flags = NATIVE.O_RDONLY | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC
                return original_open(name, flags, **kw)
            class ProbeSocket(Socket):
                def connect_ex(self, address):
                    stage = s.control._stage
                    if stage == 1:
                        fd = int(address.rsplit('/', 1)[1])
                        assertion(s.opened[fd], '/tmp/.X11-unix/X99')
                        assertion(fd, s.control._probe._x11._leaf[0])
                    else: assertion(address, ('127.0.0.1', {2: 19222, 3: 15900, 4: 16080}[stage]))
                    return super().connect_ex(listeners[stage].getsockname())
                def getsockopt(self, level, option, *args):
                    if option == socket.SO_PEERCRED: return struct.pack('=iII', 1001, 2001, 2001)
                    return super().getsockopt(level, option, *args)
                def setsockopt(self, level, option, value):
                    if option == socket.SO_PASSCRED: return
                    return super().setsockopt(level, option, value)
                def recvmsg(self, size, space, flags):
                    data, ancillary, flags, address = super().recvmsg(size, space, 0)
                    return data, ancillary + [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS,
                        struct.pack('=iII', 1001, 2001, 2001))], flags, address
            stack.enter_context(patch.object(guard.os, 'open', side_effect=opened))
            stack.enter_context(patch.object(guard, '_ProbeSocket', ProbeSocket))
            s.protocol_listeners = listeners
            yield

    def stage_report(self, s, stage):
        invocation, pid, nonce = str(stage) * 32, 1000 + stage, bytes([stage]) * 32
        deadline = int((s.now + 5) * 1000000000)
        command = guard._probe_control_frame(4, stage, s.binding, invocation, pid, nonce, s.control_total_ns, deadline)
        s.control_server.send(command)
        self.advance(s, 'control', selectors.EVENT_READ)
        self.advance(s, 'tick', 0)
        with s.protocol_listeners[stage].accept()[0] as remote:
            remote.settimeout(1)
            for _ in range(2): self.advance(s, 'probe', selectors.EVENT_WRITE)
            if stage == 1:
                self.assertTrue(remote.recv(256).endswith(b'c' * 16))
                remote.sendall(x11_setup())
                self.advance(s, 'probe', selectors.EVENT_READ)
            elif stage == 2:
                self.assertIn(b'GET /json/version ', remote.recv(1024))
                remote.sendall(tcp_fixture.ProtocolProbeTests().response())
                self.advance(s, 'probe', selectors.EVENT_READ)
            else:
                if stage == 4:
                    request = remote.recv(1024)
                    key = request.split(b'Sec-WebSocket-Key: ', 1)[1].split(b'\r\n', 1)[0]
                    accept = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
                    remote.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: binary\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
                    self.advance(s, 'probe', selectors.EVENT_READ)
                for incoming, expected in ((b'RFB 003.008\n', b'RFB 003.008\n'), (b'\x01\x01', b'\x01'), (bytes(4), b'\x01')):
                    remote.sendall(bytes([0x82, len(incoming)]) + incoming if stage == 4 else incoming)
                    self.advance(s, 'probe', selectors.EVENT_READ)
                    self.advance(s, 'probe', selectors.EVENT_WRITE)
                    reply = remote.recv(256)
                    if stage == 4:
                        self.assertEqual(reply[:2], bytes([0x82, 128 | len(expected)]))
                        reply = bytes(byte ^ reply[2 + index % 4] for index, byte in enumerate(reply[6:]))
                    self.assertEqual(reply, expected)
                payload = server_init()
                remote.sendall(bytes([0x82, len(payload)]) + payload if stage == 4 else payload)
                self.advance(s, 'probe', selectors.EVENT_READ)
            self.assertEqual(remote.recv(1), b'')
        self.assertIsNone(s.control._probe)
        self.assertFalse(s.control._finished)
        self.advance(s, 'control', selectors.EVENT_WRITE)
        self.assertEqual(s.control_server.recv(256), guard._probe_control_frame(5, stage, s.binding, invocation, pid, nonce, s.control_total_ns, deadline))
        return guard._probe_control_frame(6, stage, s.binding, invocation, pid, nonce, s.control_total_ns, deadline)

    def test_four_actual_protocols_need_exact_per_stage_ack_and_final_exchange(self):
        with self.system(authority=True) as s, self.protocols(s):
            self.handshake(s)
            original_deadline = s.control._total_deadline
            for stage in (1, 2, 3, 4):
                ack = self.stage_report(s, stage)
                self.assertEqual(s.control._state, 'ack')
                s.control_server.send(ack)
                s.control.advance('control', selectors.EVENT_READ)
                self.assertEqual(s.control._total_deadline, original_deadline)
                if stage < 4:
                    self.assertIsNone(s.control._stage_deadline)
                    self.assertFalse(s.control._finished)
            s.control.advance('control', selectors.EVENT_WRITE)
            self.assertEqual(guard._decode_probe_control_frame(s.control_server.recv(256), s.binding)[:2], (7, 4))
            self.assertTrue(s.control._finished)
            self.assertEqual(s.control_stream.fileno(), -1)
            s.egress_source._check()

    def test_one_real_selector_drives_all_protocols_and_detaches_startup_deadline(self):
        base = lambda: engine_fixture.AnchorEgressTests().system(authority=True)
        with self.system(base=base) as s, self.protocols(s):
            self.handshake(s)
            for stage in (1, 2, 3, 4):
                ack = self.stage_report(s, stage)
                self.assertLessEqual(len(s.engine._registered), 5)
                self.assertEqual(len(s.engine._connections), 0)
                s.control_server.send(ack)
                s.engine.tick()
            s.engine.tick()
            self.assertEqual(guard._decode_probe_control_frame(s.control_server.recv(256), s.binding)[:2], (7, 4))
            self.assertTrue(s.engine._control_done)
            self.assertIsNone(s.engine._control)
            s.now += 65
            s.engine.tick()
            self.assertEqual(len(s.engine._registered), 3)
            self.assertIsNotNone(s.engine._worker)

    def test_observed_protocol_cannot_advance_without_ack_or_after_deadline(self):
        for mode in ('next', 'wrong-ack', 'late'):
            with self.subTest(mode=mode), self.system(authority=True) as s, self.protocols(s):
                self.handshake(s)
                ack = self.stage_report(s, 1)
                if mode == 'next': ack = guard._probe_control_frame(4, 2, s.binding, '2' * 32, 1002, b'2' * 32, s.control_total_ns, int((s.now + 5) * 1000000000))
                if mode == 'wrong-ack': ack = ack[:-1] + bytes([ack[-1] ^ 1])
                if mode == 'late': s.now = s.control._stage_deadline
                s.control_server.send(ack)
                with self.assertRaises(ValueError): s.control.advance('control', selectors.EVENT_READ)
                self.assertFalse(s.control._finished)

    def test_queued_expired_command_cannot_create_or_connect_a_probe(self):
        with self.system(authority=True) as s:
            self.handshake(s)
            wire = guard._probe_control_frame(4, 1, s.binding, '1' * 32, 1001, b'p' * 32, s.control_total_ns, int((s.now + 5) * 1000000000))
            s.control_server.send(wire)
            s.now += 6
            with patch.object(guard._ProtocolProbe, 'open', wraps=guard._ProtocolProbe.open) as opened:
                with self.assertRaises(ValueError): s.control.advance('control', selectors.EVENT_READ)
                opened.assert_not_called()

    def test_parent_close_during_auth_acquisition_vetoes_further_native_io(self):
        with self.system(authority=True) as s:
            self.handshake(s)
            original, after = guard.os.open, []
            triggered = False
            def opened(name, flags, **kw):
                nonlocal triggered
                if triggered: after.append(name)
                fd = original(name, flags, **kw)
                if name == 'xauthority':
                    triggered = True
                    s.control.close()
                return fd
            wire = guard._probe_control_frame(4, 1, s.binding, '1' * 32, 1001, b'p' * 32, s.control_total_ns, int((s.now + 5) * 1000000000))
            s.control_server.send(wire)
            with patch.object(guard.os, 'open', side_effect=opened):
                with self.assertRaises(ValueError): s.control.advance('control', selectors.EVENT_READ)
            self.assertTrue(triggered)
            self.assertEqual(after, [])


if __name__ == '__main__': unittest.main()
