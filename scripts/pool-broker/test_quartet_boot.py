"""First lowered app identity: actual streams, existing synthetic Linux kernel seams."""
import array
import json
import inspect
import socket
import struct
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import quartet_protocol as protocol
import quartet_create_control as control_module
import test_quartet_create_control as fixture


def frame(data):
    raw = json.dumps(data, sort_keys=True, separators=(',', ':')).encode()
    return struct.pack('!I', len(raw)) + raw


def hello():
    return {'version': 2, 'phase': 'boot-hello', 'candidate': 'a'*40,
            'boot': 'b'*32, 'clientNonce': 'd'*32}


def boot_client(peer, received=None):
    helper = fixture.CreateControlTests()
    with peer:
        peer.sendall(frame(hello()))
        challenge = json.loads(helper.read(peer)[4:])
        peer.sendall(frame(challenge | {'phase': 'boot-accepted'}))
        ack = json.loads(helper.read(peer)[4:])
        if ack != challenge | {'phase': 'boot-ack'} or peer.recv(1) != b'':
            raise AssertionError('synthetic boot transcript not completed')
        if received is not None: received.append(ack)


def confirm_root(test, s):
    failures = []
    def client():
        try: boot_client(s.connect())
        except Exception as error: failures.append(type(error).__name__)
    worker = threading.Thread(target=client)
    worker.start()
    try: s.listener.confirm_application_boot()
    finally: worker.join(4)
    test.assertFalse(worker.is_alive())
    test.assertEqual(failures, [])


class BootTests(unittest.TestCase):
    def test_wrong_transcript_or_split_extra_input_never_receives_boot_ack(self):
        helper = fixture.CreateControlTests()
        for mode in ('nonce', 'epoch', 'phase', 'extra'):
            with self.subTest(mode=mode), helper.system() as (s, owned, peer, state):
                state['recv_limit'] = 1
                control = self.accept(s, owned)
                received = []
                def client():
                    try:
                        peer.sendall(frame(hello()))
                        challenge = json.loads(helper.read(peer)[4:]) | {'phase': 'boot-accepted'}
                        if mode == 'nonce': challenge['rootNonce'] = 'f'*32
                        if mode == 'epoch': challenge['epoch'] = 'f'*32
                        if mode == 'phase': challenge['phase'] = 'boot-hello'
                        peer.sendall(frame(challenge) + (b'x' if mode == 'extra' else b''))
                        received.append(peer.recv(1024))
                    except ConnectionResetError: received.append(b'')
                worker = threading.Thread(target=client)
                worker.start()
                try:
                    with self.assertRaises(ValueError): control.confirm_boot()
                finally:
                    control.close()
                    worker.join(3)
                self.assertFalse(worker.is_alive())
                self.assertEqual(received, [b''])
                self.assertNotIn(b'create', s.contents())

    def test_last_window_observation_cannot_send_after_original_deadline(self):
        import launch_authorization
        helper = fixture.CreateControlTests()
        with helper.system() as (s, owned, peer, _state):
            control = self.accept(s, owned)
            original = launch_authorization.LaunchWindow.remaining
            now, direct = [control._last_ns], []
            def remaining(window):
                value = original(window)
                caller = inspect.currentframe().f_back.f_back
                if caller.f_code.co_name == '_prepare_io':
                    direct.append(True)
                    if len(direct) == 2: now[0] = control._deadline_ns
                return value
            with patch.object(launch_authorization.LaunchWindow, 'remaining', remaining), \
                    patch.object(control_module, 'time', SimpleNamespace(monotonic_ns=lambda: now[0])):
                with self.assertRaises(ValueError): control._send(frame(hello()))
            control.close()
            self.assertEqual(len(direct), 2)
            self.assertEqual(peer.recv(1024), b'', 'expired scope still sent bytes')

    def test_last_listener_window_observation_cannot_accept_after_deadline(self):
        import launch_authorization
        import test_quartet_listener
        listener_module = test_quartet_listener.module
        with test_quartet_listener.QuartetListenerTests().system() as s:
            listener = listener_module._QuartetListener.open(s.journal)
            original = launch_authorization.LaunchWindow.remaining
            now, direct = [listener._last], []
            def remaining(window):
                value = original(window)
                caller = inspect.currentframe().f_back.f_back
                if caller.f_code.co_name == '_accept_control':
                    direct.append(True)
                    if len(direct) == 2: now[0] = listener._deadline
                return value
            with s.connect(), patch.object(launch_authorization.LaunchWindow, 'remaining', remaining), \
                    patch.object(listener_module, 'time', SimpleNamespace(monotonic=lambda: now[0])):
                with self.assertRaises(ValueError): listener.confirm_boot(s.listener._window)
            self.assertEqual(len(direct), 2)
            self.assertEqual(s.state['accepted'], [], 'expired scope still accepted a stream')
            listener.close()

    def test_reentrant_boot_cannot_release_outer_pending_accept(self):
        import test_quartet_listener
        with test_quartet_listener.QuartetListenerTests().system() as s:
            listener = test_quartet_listener.module._QuartetListener.open(s.journal)
            observed = []
            def reenter():
                with self.assertRaises(ValueError): listener.confirm_boot(s.listener._window)
                observed.append((listener._busy, len(listener._chain)))
            with s.connect():
                s.state['before_accept'] = reenter
                with self.assertRaises(ValueError): listener.confirm_boot(s.listener._window)
            self.assertEqual(observed, [(True, 3)])
            self.assertEqual(s.state['accepted'][0].fileno(), -1)
            listener.close()

    def test_public_root_refuses_business_before_first_lowered_identity(self):
        import test_quartet_entry
        from unittest.mock import patch
        with test_quartet_entry.QuartetEntryTests().system() as s:
            s.listener.start_quartet_runtime()
            runtime = s.listener._quartet
            with patch.object(runtime._socket, 'accept', side_effect=TimeoutError()):
                with self.assertRaises(ValueError): s.listener.serve_quartet_once()
            self.assertEqual(runtime._count, 0)

    def test_root_boot_does_not_spend_business_capacity_and_cannot_repeat(self):
        import test_quartet_entry
        with test_quartet_entry.QuartetEntryTests().system() as s:
            s.listener.start_quartet_runtime()
            self.assertTrue(callable(getattr(s.listener, 'confirm_application_boot', None)),
                            'root first boot gate missing')
            runtime = s.listener._quartet
            confirm_root(self, s)
            self.assertEqual(runtime._count, 0)
            self.assertEqual(s.listener._journal._resources, {})
            with self.assertRaises(ValueError): s.listener.confirm_application_boot()
            self.assertTrue(runtime._retired)

    def test_boot_codec_is_closed_and_never_a_business_request(self):
        decode = getattr(protocol, 'decode_boot_frame', None)
        self.assertTrue(callable(decode), 'boot-only codec missing')
        data = hello()
        self.assertEqual(decode(frame(data)), data)
        transcript = data | {'epoch': 'c'*32, 'rootNonce': 'e'*32}
        for phase in ('boot-challenge', 'boot-accepted', 'boot-ack'):
            item = transcript | {'phase': phase}
            self.assertEqual(decode(frame(item)), item)
            with self.assertRaises(ValueError): protocol.decode_control_frame(frame(item))
        for item in (data | {'epoch': 'c'*32}, data | {'version': True},
                     data | {'clientNonce': '0'*32}, data | {'phase': 'create'},
                     transcript | {'phase': 'boot-ack', 'rootNonce': 'd'*32}):
            with self.assertRaises(ValueError): decode(frame(item))
        for raw in (fixture.CreateControlTests().request(), frame(data) + b'x',
                    frame(data).replace(b'"version":2', b'"version":2,"version":2')):
            with self.assertRaises(ValueError): decode(raw)

    def accept(self, s, owned):
        method = getattr(control_module._CreateControl, 'accept_boot', None)
        self.assertTrue(callable(method), 'separate first-boot transport missing')
        return method(s.journal, owned, s.listener._window)

    def test_actual_four_frames_then_original_close_with_zero_business_writes(self):
        helper = fixture.CreateControlTests()
        with helper.system() as (s, owned, peer, _state):
            before = s.contents()
            control = self.accept(s, owned)
            failures, received = [], []
            def client():
                try:
                    peer.sendall(frame(hello()))
                    challenge = json.loads(helper.read(peer)[4:])
                    received.append(challenge)
                    peer.sendall(frame(challenge | {'phase': 'boot-accepted'}))
                    received.append(json.loads(helper.read(peer)[4:]))
                    received.append(peer.recv(1))
                except Exception as error: failures.append(type(error).__name__)
            thread = threading.Thread(target=client)
            thread.start()
            try:
                self.assertIsNone(control.confirm_boot())
                self.assertEqual(owned.fileno(), -1)
                with self.assertRaises(ValueError): control.confirm_boot()
                with self.assertRaises(ValueError): control.prepare()
            finally:
                control.close()
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertEqual(received[0]['epoch'], 'c'*32)
            self.assertEqual(received[0]['clientNonce'], 'd'*32)
            self.assertEqual(received[0]['phase'], 'boot-challenge')
            self.assertEqual(received[1], received[0] | {'phase': 'boot-ack'})
            self.assertEqual(received[2], b'')
            self.assertEqual(s.contents(), before)

    def test_wrong_identity_old_boot_business_and_rights_cannot_initialize(self):
        helper = fixture.CreateControlTests()
        for mode in ('root', 'other-pid', 'boot', 'candidate', 'business', 'extra', 'rights'):
            with self.subTest(mode=mode), helper.system() as (s, owned, peer, state):
                before = s.contents()
                control = self.accept(s, owned)
                data = hello()
                if mode == 'root': state['peer'] = struct.pack('=iII', 123, 0, 0)
                if mode == 'other-pid': state['peer'] = struct.pack('=iII', 124, 998, 998)
                if mode == 'boot': data['boot'] = 'f'*32
                if mode == 'candidate': data['candidate'] = 'f'*40
                raw = helper.request() if mode == 'business' else frame(data)
                if mode == 'extra': raw += helper.request()
                fd = None
                try:
                    if mode == 'rights':
                        fd = fixture.NATIVE.open('/dev/null', fixture.NATIVE.O_RDONLY)
                        peer.sendmsg([raw], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
                    else: peer.sendall(raw)
                    with self.assertRaises(ValueError): control.confirm_boot()
                    self.assertEqual(owned.fileno(), -1)
                    self.assertEqual(s.contents(), before)
                    for received in state['right_fds']:
                        with self.assertRaises(OSError): fixture.NATIVE.fstat(received)
                finally:
                    control.close()
                    if fd is not None: fixture.NATIVE.close(fd)


if __name__ == '__main__': unittest.main()
