"""Original five-unit stop flow, durable journal and real socket wire; Linux is synthetic."""
import contextlib
import json
import unittest

import quartet_launch
import quartet_runtime
import test_quartet_ready as fixture


class QuartetStopTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, mode='late'):
        with fixture.RuntimeReadyTests().system() as s:
            quartet_launch._launch_material(s.material, ready_offer=s.offer)
            s.live = quartet_runtime._RunningQuartet.adopt(s.material, s.offer)
            s.job_wire_mode = mode
            yield s

    def test_five_original_stop_jobs_are_durable_matched_and_idempotent_without_exit_claim(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'stop_original', None)),
                        'original fixed five-unit stop producer missing')
        for mode in ('early', 'late'):
            with self.subTest(mode=mode), self.system(mode) as s:
                receipts = s.live.stop_original()
                expected = ['holaday-pool-' + role + '-' + s.resource + '.service'
                            for role in ('xvfb', 'brave', 'x11vnc', 'websockify', 'anchor')]
                self.assertEqual(s.stop_calls, expected)
                self.assertEqual([item._unit for item in receipts], expected)
                self.assertIs(s.live.stop_original(), receipts)
                self.assertEqual(s.stop_calls, expected)
                rows = [json.loads(line) for line in s.journal._expected.splitlines()]
                for action in ('role_stop_dispatch', 'role_stop_accepted', 'role_stop_observed'):
                    self.assertEqual(sum(row['action'] == action for row in rows), 5)
                self.assertEqual(s.journal._resources[s.resource]['state'], 'closing')
                self.assertFalse(s.journal.snapshot()['groupExitProven'])

    def test_signal_without_stop_ack_remains_unknown_and_is_never_resent(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'stop_original', None)))
        with self.system('lost-ack') as s:
            with self.assertRaises(ValueError): s.live.stop_original()
            with self.assertRaises(ValueError): s.live.stop_original()
            self.assertEqual(len(s.stop_calls), 1)
            rows = [json.loads(line) for line in (s.root / 'var/lib/holaday-pool-broker/resource-journal.jsonl').read_bytes().splitlines()]
            self.assertEqual(sum(row['action'] == 'role_stop_dispatch' for row in rows), 1)
            self.assertFalse(any(row['action'] in ('role_stop_accepted', 'role_stop_observed') for row in rows))

    def test_rebound_invocation_is_rejected_before_stopping_that_role(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'stop_original', None)))
        with self.system('rebound') as s:
            with self.assertRaises(ValueError): s.live.stop_original()
            self.assertEqual(len(s.stop_calls), 1)
            self.assertIn('xvfb-', s.stop_calls[0])
            self.assertTrue(s.live._retired)


if __name__ == '__main__': unittest.main()
