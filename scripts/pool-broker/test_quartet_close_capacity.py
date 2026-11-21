"""Creation capacity must not consume the bounded budget reserved for original closes."""
import contextlib
import unittest
from unittest.mock import patch

import quartet_listener
import test_quartet_close_control as close_fixture
import test_quartet_listener as listener_fixture
import test_quartet_stop as stop_fixture


class CloseCapacityTests(unittest.TestCase):
    def test_original_close_remains_available_after_thirty_two_create_transactions(self):
        with patch('tempfile.tempdir', '/private/tmp'), stop_fixture.QuartetStopTests().system('empty') as s, \
                listener_fixture.QuartetListenerTests().system(base=lambda: contextlib.nullcontext(s)):
            listener = quartet_listener._QuartetListener.open(s.journal)
            listener._groups.append(s.live)
            listener._count = 32  # Existing resource capacity; only original-close allowance is under test.
            group = s.journal._resources[s.resource]
            before = set(s.journal._resources)
            request = {'version': 2, 'action': 'close', 'requestId': 'e'*32,
                       'boot': group['boot'], 'capability': group['capability']}
            try:
                try: reply = close_fixture.CloseControlTests().exchange(s, listener, request)
                except ValueError: self.fail('original close blocked after creation request budget exhausted')
                self.assertEqual(reply[0]['phase'], 'terminal-observed')
                self.assertEqual(set(s.journal._resources), before)
                self.assertEqual(len(s.stop_calls), 5)
                self.assertFalse(s.journal.snapshot()['groupExitProven'])
            finally: listener.close()

    def test_combined_create_and_close_transport_budget_is_still_bounded(self):
        with listener_fixture.QuartetListenerTests().system() as s:
            listener = quartet_listener._QuartetListener.open(s.journal)
            listener._count = 64
            try:
                with self.assertRaises(ValueError): listener.accept_control()
                self.assertEqual(s.state['accepted'], [])
            finally: listener.close()


if __name__ == '__main__': unittest.main()
