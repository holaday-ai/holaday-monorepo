"""Public fixed entry routing plus real child grant/exec consumer (exec is a seam)."""
import unittest
from unittest.mock import patch
import test_quartet_worker_exec as fixture

guard = fixture.guard


class WorkerMainTests(unittest.TestCase):
    def test_public_child_entry_consumes_real_original_grant_before_exec(self):
        self.assertTrue(callable(getattr(guard, 'main', None)), 'fixed worker entry missing')
        with fixture.WorkerExecTests().system('brave') as (s, worker, _):
            with patch.object(guard, '__file__', '/quartet_worker_guard.py'), patch.object(
                    guard.sys, 'argv', ['/quartet_worker_guard.py', s.binding['candidate'], s.binding['resource'], 'brave']), patch.object(
                    guard._WorkerGuard, 'open', return_value=worker) as opened:
                with self.assertRaises(fixture.ExecObserved): guard.main()
            opened.assert_called_once_with(s.binding['candidate'], s.binding['resource'], 'brave')
            self.assertEqual(len(s.execs), 1)
            self.assertEqual(s.opened, {})

    def test_bad_entry_arguments_cannot_open_any_worker(self):
        self.assertTrue(callable(getattr(guard, 'main', None)))
        for argv in ([], ['/quartet_worker_guard.py'], ['/quartet_worker_guard.py', 'a'*40, 'b'*32, 'unknown'],
                ['/quartet_worker_guard.py', '0'*40, 'b'*32, 'anchor'],
                ['/quartet_worker_guard.py', 'a'*40, 'b'*32, 'anchor', 'extra']):
            with patch.object(guard, '__file__', '/quartet_worker_guard.py'), patch.object(
                    guard.sys, 'argv', argv), patch.object(guard._WorkerGuard, 'open') as opened:
                self.assertEqual(guard.main(), 1)
                opened.assert_not_called()

    def test_anchor_wiring_owns_every_factory_and_cleans_up_after_tick_failure(self):
        self.assertTrue(callable(getattr(guard, 'main', None)))
        # Wiring seam only; the real anchor selector/control are covered separately.
        events = []
        class Worker:
            def _receive_bridge(self): events.append('bridge')
            def close(self): events.append('worker-close')
        class Source:
            def close(self): events.append('source-close')
        class Engine:
            def _attach_egress(self, source): self.source = source; events.append('egress')
            def _attach_control(self): events.append('control')
            def tick(self): events.append('tick'); raise ValueError()
            def close(self): events.append('engine-close'); self.source.close()
        worker, source, engine = Worker(), Source(), Engine()
        with patch.object(guard, '__file__', '/quartet_worker_guard.py'), patch.object(
                guard.sys, 'argv', ['/quartet_worker_guard.py', 'a'*40, 'b'*32, 'anchor']), patch.object(
                guard._WorkerGuard, 'open', return_value=worker), patch.object(
                guard._EgressSource, 'open', return_value=source), patch.object(
                guard._AnchorBridge, 'open', return_value=engine):
            self.assertEqual(guard.main(), 1)
        self.assertEqual(events, ['bridge', 'egress', 'control', 'tick', 'engine-close', 'source-close', 'worker-close'])


if __name__ == '__main__': unittest.main()
