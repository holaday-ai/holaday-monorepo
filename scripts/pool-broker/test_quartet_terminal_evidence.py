"""Necessary kernel/job evidence on original objects; not a reusable-slot acceptance."""
import errno
import unittest
from unittest.mock import patch

import quartet_runtime
import quartet_worker_pin
import test_quartet_stop as fixture


class TerminalEvidenceTests(unittest.TestCase):
    def test_original_pidfd_and_empty_or_removed_cgroup_are_bound_to_the_original_stop(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'collect_terminal_evidence', None)),
                        'original kernel terminal evidence collector missing')
        for mode in ('empty', 'removed'):
            with self.subTest(mode=mode), fixture.QuartetStopTests().system(mode) as s:
                stops = s.live.stop_original()
                original = quartet_worker_pin.os.pread
                events = {pin._cgroup._events for _role, _worker, pin, _view in s.live._workers}
                def read(fd, *args):
                    if mode == 'removed' and fd in events: raise OSError(errno.ENODEV, 'synthetic retired cgroup')
                    return original(fd, *args)
                with patch.object(quartet_worker_pin.os, 'pread', side_effect=read):
                    evidence = s.live.collect_terminal_evidence()
                self.assertEqual(len(evidence), 5)
                self.assertEqual({item._kind for item in evidence}, {mode})
                self.assertEqual({item._stop for item in evidence}, set(stops))
                self.assertTrue(all(item._owner._cgroup is item._cgroup for item in evidence))
                self.assertIs(s.live.collect_terminal_evidence(), evidence)
                self.assertEqual(len(s.stop_calls), 5)
                self.assertEqual(s.journal._resources[s.resource]['state'], 'closing')
                self.assertFalse(s.journal.snapshot()['groupExitProven'])

    def test_stop_done_with_live_pidfd_or_restart_history_cannot_publish_terminal_evidence(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'collect_terminal_evidence', None)))
        for mode in ('live', 'restart'):
            with self.subTest(mode=mode), fixture.QuartetStopTests().system(mode) as s:
                s.live.stop_original()
                with self.assertRaises(ValueError): s.live.collect_terminal_evidence()
                self.assertIsNone(s.live._terminal_evidence)
                self.assertTrue(s.live._retired)

    def test_late_revocation_of_an_earlier_original_cgroup_prevents_final_publication(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'collect_terminal_evidence', None)))
        with fixture.QuartetStopTests().system('empty') as s:
            s.live.stop_original()
            first = s.live._workers[0][2]._cgroup
            last_fd = s.live._workers[-1][2]._cgroup._events
            original, revoked = quartet_worker_pin.os.pread, []
            def read(fd, *args):
                raw = original(fd, *args)
                if fd == last_fd and not revoked:
                    revoked.append(True); first.close()
                return raw
            with patch.object(quartet_worker_pin.os, 'pread', side_effect=read):
                with self.assertRaises(ValueError): s.live.collect_terminal_evidence()
            self.assertEqual(revoked, [True])
            self.assertIsNone(s.live._terminal_evidence)


if __name__ == '__main__': unittest.main()
