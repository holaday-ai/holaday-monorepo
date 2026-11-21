"""Authenticated close on actual registered sockets and original live group objects."""
import contextlib
import json
import threading
import unittest
from unittest.mock import patch

import quartet_listener
import quartet_protocol
import test_quartet_create_control as control_fixture
import test_quartet_listener as listener_fixture
import test_quartet_stop as stop_fixture


class CloseControlTests(unittest.TestCase):
    def exchange(self, s, listener, request):
        replies, failures = [], []
        def client():
            try:
                with s.connect() as peer:
                    peer.settimeout(60)
                    peer.sendall(quartet_protocol.encode_control_frame(request))
                    replies.append(quartet_protocol.decode_control_frame(control_fixture.CreateControlTests().read(peer)))
                    if peer.recv(1) != b'': raise ValueError('expected original control EOF')
            except Exception as error: failures.append(type(error).__name__)
        thread = threading.Thread(target=client); thread.start()
        try: listener.serve_create_once(s.manager)
        finally: thread.join(65)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])
        return replies

    def test_original_authenticated_close_returns_bound_observation_once_without_exit_permission(self):
        with patch('tempfile.tempdir', '/private/tmp'), stop_fixture.QuartetStopTests().system('empty') as s, \
                listener_fixture.QuartetListenerTests().system(base=lambda: contextlib.nullcontext(s)):
            listener = quartet_listener._QuartetListener.open(s.journal)
            listener._groups.append(s.live)  # Original actual ready owner, never durable-row reconstruction.
            group = s.journal._resources[s.resource]
            request = {'version': 2, 'action': 'close', 'requestId': 'e'*32,
                       'boot': group['boot'], 'capability': group['capability']}
            try:
                try: first = self.exchange(s, listener, request)
                except ValueError: self.fail('authenticated original-group close route missing')
                self.assertEqual(len(first), 1)
                self.assertEqual(first[0]['phase'], 'terminal-observed')
                self.assertEqual(first[0]['requestId'], 'e'*32)
                self.assertEqual(first[0]['resource'], s.resource)
                self.assertNotIn('groupExitProven', first[0])
                self.assertEqual(self.exchange(s, listener, request), first)
                self.assertEqual(len(s.stop_calls), 5)
                rows = [json.loads(x) for x in s.journal._expected.splitlines()]
                self.assertEqual(sum(row['action'] == 'close_observation' for row in rows), 1)
                self.assertEqual(s.journal._resources[s.resource]['state'], 'closing')
                self.assertFalse(s.journal.snapshot()['groupExitProven'])
            finally: listener.close()

    def test_egress_key_or_other_boot_cannot_stop_an_original_group(self):
        for mode in ('egress', 'boot'):
            with self.subTest(mode=mode), patch('tempfile.tempdir', '/private/tmp'), \
                    stop_fixture.QuartetStopTests().system('empty') as s, \
                    listener_fixture.QuartetListenerTests().system(base=lambda: contextlib.nullcontext(s)):
                listener = quartet_listener._QuartetListener.open(s.journal)
                listener._groups.append(s.live)
                group = s.journal._resources[s.resource]
                request = {'version': 2, 'action': 'close', 'requestId': 'e'*32,
                           'boot': 'f'*32 if mode == 'boot' else group['boot'],
                           'capability': group['egressCapability'] if mode == 'egress' else group['capability']}
                try:
                    with s.connect() as peer:
                        peer.sendall(quartet_protocol.encode_control_frame(request))
                        with self.assertRaises(ValueError): listener.serve_create_once(s.manager)
                    self.assertEqual(s.stop_calls, [])
                finally: listener.close()


if __name__ == '__main__': unittest.main()
