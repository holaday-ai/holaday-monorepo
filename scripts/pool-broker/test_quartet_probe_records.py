"""Closed durable observations: never reconstruct runtime handles or readiness."""
import copy
import unittest
import quartet_records as records

RESOURCE = 'b' * 32


class ProbeRecordTests(unittest.TestCase):
    def group(self):
        return {RESOURCE: {'version': 2, 'state': 'observed', 'material': {'state': 'ready'},
            'endpoints': {'state': 'ready'}, 'egress': {'state': 'ready'}, 'bridge': {'state': 'committed'},
            'roles': {'anchor': {'granted': True, 'state': 'observed', 'invocation': 'a' * 32}}}}

    def row(self, action, stage=0, **fields):
        return {'version': 2, 'revision': 1, 'action': action, 'resource': RESOURCE,
            'role': records.ROLES[stage], 'stage': stage, 'invocation': 'a' * 32 if stage == 0 else str(stage) * 32,
            'pid': 1000 + stage, 'challengeDigest': str(stage + 1) * 64,
            'totalDeadlineNs': 60000000000, 'phaseDeadlineNs': (stage + 1) * 5000000000,
            'clockDevice': 4, 'clockInode': 5} | fields

    def apply(self, resources, action, stage=0, **fields):
        records.replay(self.row(action, stage, **fields), resources, {})

    def test_fixed_four_stage_chain_is_observation_not_ready_or_reconstructible_handle(self):
        groups = self.group()
        self.apply(groups, 'probe_open')
        self.apply(groups, 'probe_accept')
        for stage in range(1, 5):
            groups[RESOURCE]['roles'][records.ROLES[stage]] = {'granted': True, 'state': 'observed', 'invocation': str(stage) * 32}
            self.apply(groups, 'protocol_command', stage)
            self.apply(groups, 'protocol_observed', stage)
        self.apply(groups, 'protocol_complete', 4)
        self.assertEqual(groups[RESOURCE]['protocol']['state'], 'complete')
        self.assertEqual(groups[RESOURCE]['state'], 'observed')
        self.assertNotIn('ready', groups[RESOURCE])
        self.assertNotIn('groupExitProven', groups[RESOURCE])

    def test_duplicate_wrong_context_and_skipped_observation_preserve_previous_state(self):
        for mode in ('duplicate', 'deadline', 'clock', 'stage', 'unknown', 'not-granted', 'invocation', 'early-complete'):
            with self.subTest(mode=mode):
                groups = self.group()
                self.apply(groups, 'probe_open')
                before = copy.deepcopy(groups)
                action, stage, fields = 'probe_accept', 0, {}
                if mode == 'duplicate': action = 'probe_open'
                if mode == 'deadline': fields = {'totalDeadlineNs': 61000000000}
                if mode == 'clock': fields = {'clockInode': 6}
                if mode == 'stage': action, stage = 'protocol_command', 2
                if mode == 'unknown': fields = {'extra': True}
                if mode == 'not-granted': groups[RESOURCE]['roles']['anchor']['granted'] = False
                if mode == 'invocation': fields = {'invocation': 'f' * 32}
                if mode == 'early-complete': action, stage = 'protocol_complete', 4
                before = copy.deepcopy(groups)
                with self.assertRaises(ValueError): self.apply(groups, action, stage, **fields)
                self.assertEqual(groups, before)

    def test_stage_deadline_nonce_and_ack_must_match_original_command(self):
        for fields in ({'phaseDeadlineNs': 60000000001}, {'challengeDigest': '1' * 64}, {'pid': True}, {'stage': True}):
            groups = self.group()
            self.apply(groups, 'probe_open')
            self.apply(groups, 'probe_accept')
            groups[RESOURCE]['roles']['xvfb'] = {'granted': True, 'state': 'observed', 'invocation': '1' * 32}
            before = copy.deepcopy(groups)
            with self.assertRaises(ValueError):
                records.replay(self.row('protocol_command', 1) | fields, groups, {})
            self.assertEqual(groups, before)
        groups = self.group()
        self.apply(groups, 'probe_open')
        self.apply(groups, 'probe_accept')
        groups[RESOURCE]['roles']['xvfb'] = {'granted': True, 'state': 'observed', 'invocation': '1' * 32}
        self.apply(groups, 'protocol_command', 1)
        for fields in ({'phaseDeadlineNs': 10000000001}, {'pid': 1002}, {'challengeDigest': '3' * 64}):
            with self.assertRaises(ValueError): self.apply(groups, 'protocol_observed', 1, **fields)
        self.assertEqual(groups[RESOURCE]['protocol']['stages']['1']['state'], 'commanded')


if __name__ == '__main__': unittest.main()
