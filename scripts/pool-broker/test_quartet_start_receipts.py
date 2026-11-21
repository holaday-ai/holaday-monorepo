"""Original start completion is mandatory before worker grant, never inferred from ACK."""
import json
import unittest

import quartet_launch
import test_quartet_launch as fixture


class StartReceiptTests(unittest.TestCase):
    def test_subscribe_and_ref_original_unit_before_consuming_early_start_completion(self):
        with fixture.QuartetLaunchTests().system() as s:
            quartet_launch.dispatch_role(s.material, 'anchor')
            self.assertIn('Subscribe', s.wire_calls, 'start dispatched without original job subscription')
            self.assertEqual(s.start_subscribed, [True])
            self.assertEqual(s.ref_units, ['holaday-pool-anchor-' + s.resource + '.service'])
            receipts = s.material._start_receipts
            self.assertEqual(set(receipts), {'anchor'})
            receipt = receipts['anchor']
            self.assertIs(receipt._stream, s.manager._job_stream)
            self.assertEqual((receipt._unit, receipt._job, receipt._result),
                ('holaday-pool-anchor-' + s.resource + '.service', '/org/freedesktop/systemd1/job/7', 'done'))
            rows = [json.loads(line) for line in s.journal._expected.splitlines()]
            self.assertEqual(sum(row['action'] == 'role_start_observed' for row in rows), 1)
            self.assertFalse(s.journal.snapshot()['groupExitProven'])

    def test_missing_failed_or_different_original_completion_never_grants_or_retries(self):
        for mode in ('missing-completion', 'failed-completion', 'wrong-completion-unit'):
            with self.subTest(mode=mode), fixture.QuartetLaunchTests().system() as s:
                s.dispatch_mode = mode
                with self.assertRaises(ValueError): quartet_launch.dispatch_role(s.material, 'anchor')
                with self.assertRaises(ValueError): quartet_launch.dispatch_role(s.material, 'anchor')
                self.assertEqual(len(s.starts), 1)
                self.assertEqual(s.sends, [])


if __name__ == '__main__': unittest.main()
