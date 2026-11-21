"""Early same-unit completion is retained, never substituted for our own StopUnit job."""
import json
import unittest

import test_quartet_stop as fixture


class InterveningJobTests(unittest.TestCase):
    def test_early_dependency_completion_is_durable_but_all_five_explicit_stop_receipts_still_required(self):
        with fixture.QuartetStopTests().system('dependency') as s:
            receipts = s.live.stop_original()
            s.live.collect_terminal_evidence()
            rows = [json.loads(line) for line in s.journal._expected.splitlines()]
            prior = [row for row in rows if row['action'] == 'role_intervening_job_observed']
            self.assertEqual(len(prior), 1, 'early original-unit job completion discarded from evidence')
            self.assertEqual((prior[0]['role'], prior[0]['job']),
                             ('brave', '/org/freedesktop/systemd1/job/90'))
            self.assertEqual(len(receipts), 5)
            self.assertEqual(len(s.stop_calls), 5)
            self.assertNotIn('/org/freedesktop/systemd1/job/90', {item._job for item in receipts})
            original = s.live._intervening_receipts['/org/freedesktop/systemd1/job/90']
            self.assertIs(original._stream, s.manager._job_stream)
            self.assertEqual(original._serial, prior[0]['signalSerial'])
            self.assertFalse(s.journal.snapshot()['groupExitProven'])


if __name__ == '__main__': unittest.main()
