"""Durable close admission on real original creation/journal; Linux edges are seams."""
import copy
import json
import unittest

import quartet_launch
import quartet_records
import quartet_runtime
import resource_journal
import test_quartet_ready as fixture


class CloseIntentTests(unittest.TestCase):
    def contents(self, system):
        return (system.root / 'var/lib/holaday-pool-broker/resource-journal.jsonl').read_bytes()

    def start(self, system):
        quartet_launch._launch_material(system.material, ready_offer=system.offer)
        return quartet_runtime._RunningQuartet.adopt(system.material, system.offer)

    def test_close_intent_is_durable_once_and_keeps_original_pins_without_exit_claim(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'begin_close', None)),
                        'original runtime has no durable close admission')
        with fixture.RuntimeReadyTests().system() as s:
            live = self.start(s)
            workers = s.material._terminal_workers
            pins = tuple(pin._fd for _role, _worker, pin, _view in workers)
            syncs, original_sync = [], s.proxy.fsync
            def sync(fd):
                original_sync(fd)
                syncs.append(fd)
            s.proxy.fsync = sync
            self.assertIsNone(live.begin_close())
            raw = self.contents(s)
            row = json.loads(raw.splitlines()[-1])
            self.assertEqual(row['action'], 'close_intent')
            self.assertEqual(s.journal._resources[s.resource]['state'], 'closing')
            self.assertEqual(row['managerGuid'], s.manager._guid)
            self.assertEqual(row['managerOwner'], s.manager._owner)
            self.assertEqual(set(row['roles']), set(quartet_records.ROLES))
            self.assertGreaterEqual(len(syncs), 2)
            self.assertIsNone(live.begin_close())
            self.assertEqual(self.contents(s), raw, 'repeat close must retain the original transaction')
            self.assertIs(s.material._terminal_workers, workers)
            self.assertEqual(tuple(pin._fd for _role, _worker, pin, _view in workers), pins)
            self.assertFalse(live._retired)
            self.assertEqual(len(s.starts), 5, 'close admission must not start replacement units')
            self.assertFalse(s.journal.snapshot()['groupExitProven'])
            self.assertEqual(s.journal.snapshot()['total'], 1)
            with self.assertRaises(ValueError): live.check()
            self.assertFalse(live._retired, 'admission rejection must retain the closing owner')

    def test_close_fences_running_checks_before_the_first_journal_io(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'begin_close', None)))
        with fixture.RuntimeReadyTests().system() as s:
            live = self.start(s)
            original = s.proxy.pread
            observed = []
            def pread(*args):
                if not observed:
                    observed.append(s.journal._resources[s.resource]['state'])
                    with self.assertRaises(ValueError): live.check()
                    with self.assertRaises(ValueError): live.begin_close()
                    self.assertFalse(live._retired)
                return original(*args)
            s.proxy.pread = pread
            live.begin_close()
            self.assertEqual(observed, ['ready'])
            self.assertEqual(s.journal._resources[s.resource]['state'], 'closing')

    def test_replay_rejects_rebound_units_or_success_flags_without_mutating_group(self):
        self.assertTrue(callable(getattr(quartet_runtime._RunningQuartet, 'begin_close', None)))
        with fixture.RuntimeReadyTests().system() as s:
            live = self.start(s)
            before = self.contents(s)
            live.begin_close()
            intent = json.loads(self.contents(s).splitlines()[-1])
            for mode in ('unit', 'invocation', 'manager', 'egress', 'success', 'incomplete'):
                with self.subTest(mode=mode):
                    resources, requests, _revision = resource_journal._replay(before)
                    candidate = copy.deepcopy(intent)
                    if mode == 'unit': candidate['roles']['brave']['unit'] = 'foreign.service'
                    elif mode == 'invocation': candidate['roles']['brave']['invocation'] = 'f' * 32
                    elif mode == 'manager': candidate['managerOwner'] = ':9.99'
                    elif mode == 'egress': candidate['closeId'] = resources[s.resource]['egressCapability']
                    elif mode == 'success': candidate['groupExitProven'] = True
                    elif mode == 'incomplete': del candidate['roles']['anchor']
                    original = copy.deepcopy(resources)
                    with self.assertRaises(ValueError): quartet_records.replay(candidate, resources, requests)
                    self.assertEqual(resources, original)
            resources, requests, _revision = resource_journal._replay(self.contents(s))
            with self.assertRaises(ValueError): quartet_records.replay(intent, resources, requests)
            self.assertEqual(resources[s.resource]['state'], 'closing')

    def test_sync_failure_never_acknowledges_intent_or_creates_a_second_transaction(self):
        with fixture.RuntimeReadyTests().system() as s:
            live = self.start(s)
            def failed_sync(_fd): raise OSError('synthetic journal sync failure')
            s.proxy.fsync = failed_sync
            with self.assertRaises(ValueError): live.begin_close()
            self.assertTrue(live._retired)
            self.assertTrue(s.journal._retired)
            raw = self.contents(s)
            rows = [json.loads(line) for line in raw.splitlines()]
            self.assertEqual(sum(row['action'] == 'close_intent' for row in rows), 1)
            with self.assertRaises(ValueError): live.begin_close()
            self.assertEqual(self.contents(s), raw)
            recovered, _requests, _revision = resource_journal._replay(raw)
            self.assertEqual(recovered[s.resource]['state'], 'closing')
            self.assertNotIn('groupExitProven', recovered[s.resource])


if __name__ == '__main__': unittest.main()
