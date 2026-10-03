"""Actual stream IO and durable offer, with explicit Linux credentials seams."""
import array
import contextlib
import socket
import struct
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_quartet_journal as fixture
import test_resource_journal
import quartet_protocol as protocol
try:
    import quartet_create_control as module
except ModuleNotFoundError as error:
    if error.name != 'quartet_create_control': raise
    module = None

NATIVE = test_resource_journal.NATIVE


class CreateControlTests(unittest.TestCase):
    def test_cleanup_failure_still_closes_original_control_stream(self):
        with self.system() as (s, owned, _peer, _state):
            control = module._CreateControl.accept(s.journal, owned)
            def failed_cleanup(): raise OSError('synthetic material cleanup failure')
            # Only exercise failure cleanup; this is not an accepted/live group.
            control._material = SimpleNamespace(close=failed_cleanup)
            with self.assertRaises(Exception): control.close()
            self.assertEqual(owned.fileno(), -1)

    @contextlib.contextmanager
    def system(self, *, base=None):
        self.assertIsNotNone(module, 'original create control missing')
        with (fixture.QuartetJournalTests().system() if base is None else base()) as s, contextlib.ExitStack() as stack:
            left, right = socket.socketpair()
            peer = struct.pack('=iII', 123, 998, 998)
            state = {'peer': peer, 'right_fds': []}
            class KernelSocket(socket.socket):
                def setsockopt(self, *args):
                    if args == (socket.SOL_SOCKET, 16, 1): return
                    return super().setsockopt(*args)
                def getsockopt(self, level, option, *args):
                    if (level, option) == (socket.SOL_SOCKET, 17): return state['peer']
                    return super().getsockopt(level, option, *args)
                def recvmsg(self, size, space, flags=0):
                    if state.get('recv_limit'): size = min(size, state['recv_limit'])
                    data, ancillary, flags, address = super().recvmsg(size, space)
                    for level, kind, raw in ancillary:
                        if (level, kind) == (socket.SOL_SOCKET, socket.SCM_RIGHTS):
                            state['right_fds'].extend(array.array('i', raw))
                    if state.get('after_receive'): state['after_receive']()
                    return data, ancillary + ([(socket.SOL_SOCKET, 2, state['peer'])] if data else []), flags, address
            owned = KernelSocket(fileno=left.detach())
            stack.callback(owned.close); stack.callback(right.close)
            right.settimeout(2)
            stack.enter_context(patch.object(module, 'os', NATIVE))
            yield s, owned, right, state

    def request(self):
        return protocol.encode_control_frame({'version': 2, 'action': 'create',
            'requestId': 'c'*32, 'boot': 'b'*32, 'slot': 0})

    def read(self, stream):
        header = b''
        while len(header) < 4:
            chunk = stream.recv(4 - len(header))
            if not chunk: raise ValueError('synthetic EOF')
            header += chunk
        size = struct.unpack('!I', header)[0]
        data = b''
        while len(data) < size:
            chunk = stream.recv(size - len(data))
            if not chunk: raise ValueError('synthetic EOF')
            data += chunk
        return header + data

    def test_one_original_stream_reserves_before_ack_without_dispatching_roles(self):
        with self.system() as (s, owned, peer, _state):
            failures, observed = [], []
            def client():
                try:
                    peer.sendall(self.request())
                    raw = self.read(peer)
                    observed.append(b'create_offer' in s.contents())
                    data = protocol.decode_control_frame(raw)
                    scope = {key: data[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
                    peer.sendall(protocol.encode_control_frame(scope | {'phase': 'accepted',
                        'preparedDigest': protocol.control_prepared_digest(raw)}))
                except Exception as error: failures.append(type(error).__name__)
            thread = threading.Thread(target=client)
            thread.start()
            control = module._CreateControl.accept(s.journal, owned)
            try:
                offer = control.prepare()
                self.assertIs(offer, control._offer)
                self.assertTrue(offer._accepted)
                self.assertEqual(s.journal._resources[offer._resource]['roles'], {})
                self.assertLessEqual(offer._deadline_ns, control._deadline_ns)
                with self.assertRaises(ValueError): control.prepare()
            finally:
                control.close()
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertEqual(observed, [True])

    def test_trailing_premature_frame_and_wrong_sender_never_create_offer(self):
        for mode in ('trailing', 'peer', 'truncated'):
            with self.subTest(mode=mode), self.system() as (s, owned, peer, state):
                control = module._CreateControl.accept(s.journal, owned)
                before = s.contents()
                if mode == 'peer': state['peer'] = struct.pack('=iII', 124, 998, 998)
                peer.sendall(self.request() + (self.request() if mode == 'trailing' else b''))
                if mode == 'truncated':
                    # Replace the full-frame case with a declared oversize prefix.
                    owned.recv(len(self.request()))
                    peer.sendall(struct.pack('!I', 4097))
                with self.assertRaises(ValueError): control.prepare()
                self.assertEqual(s.contents(), before)
                self.assertEqual(owned.fileno(), -1)

    def test_received_real_rights_close_even_if_parent_is_closed_during_recv(self):
        with self.system() as (s, owned, peer, state):
            control = module._CreateControl.accept(s.journal, owned)
            fd = NATIVE.open('/dev/null', NATIVE.O_RDONLY)
            try:
                state['after_receive'] = control.close
                peer.sendmsg([self.request()], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
                with self.assertRaises(ValueError): control.prepare()
                self.assertEqual(len(state['right_fds']), 1)
                with self.assertRaises(OSError): NATIVE.fstat(state['right_fds'][0])
            finally: NATIVE.close(fd)

    def test_control_scope_veto_covers_original_offer_journal_io(self):
        for mode in ('close', 'expired'):
            with self.subTest(mode=mode), self.system() as (s, owned, peer, _state):
                control = module._CreateControl.accept(s.journal, owned)
                original_pread, original_write = s.proxy.pread, s.proxy.write
                original_clock = module.time.monotonic_ns
                vetoed, writes = [], []
                def read(*args):
                    value = original_pread(*args)
                    if not vetoed:
                        vetoed.append(True)
                        if mode == 'close': control.close()
                    return value
                def write(*args):
                    if vetoed: writes.append(True)
                    return original_write(*args)
                def clock():
                    return control._phase_ns if vetoed and mode == 'expired' else original_clock()
                s.proxy.pread, s.proxy.write = read, write
                peer.sendall(self.request())
                with patch.object(module.time, 'monotonic_ns', side_effect=clock):
                    with self.assertRaises(ValueError): control.prepare()
                self.assertEqual(vetoed, [True])
                self.assertEqual(len(writes), 0, 'control scope lost inside original journal IO')

    def test_exact_short_read_cannot_hide_already_queued_extra_after_accepted(self):
        with self.system() as (s, owned, peer, state):
            state['recv_limit'] = 1
            failures = []
            def client():
                try:
                    peer.sendall(self.request())
                    raw = self.read(peer)
                    data = protocol.decode_control_frame(raw)
                    scope = {key: data[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
                    accepted = protocol.encode_control_frame(scope | {'phase': 'accepted',
                        'preparedDigest': protocol.control_prepared_digest(raw)})
                    peer.sendall(accepted + b'x')
                except Exception as error: failures.append(type(error).__name__)
            thread = threading.Thread(target=client)
            thread.start()
            control = module._CreateControl.accept(s.journal, owned)
            try:
                with self.assertRaises(ValueError): control.prepare()
            finally:
                control.close()
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertNotIn(b'create_accept', s.contents())


if __name__ == '__main__': unittest.main()
