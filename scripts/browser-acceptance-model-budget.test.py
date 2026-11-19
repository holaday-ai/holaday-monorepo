"""Acceptance-only policy: no provider access or real ledger mutation."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

path = Path(__file__).with_name('browser-acceptance-model-budget.py')
spec = importlib.util.spec_from_file_location('acceptance_budget', path)
budget = importlib.util.module_from_spec(spec) if path.exists() else None
if budget:
    spec.loader.exec_module(budget)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def fixture():
    attempts = [
        {'scope': 'sheets-synthetic', 'model': 'model-a', 'maxTokens': 64,
         'bodySHA256': '1'*64, 'state': 'received', 'httpStatus': 200,
         'startedAtUTC': '2026-11-19T00:00:00+00:00', 'finishedAtUTC': '2026-11-19T00:00:10+00:00'},
        {'scope': 'github-pr360', 'model': 'model-a', 'maxTokens': 64,
         'bodySHA256': '2'*64, 'state': 'unknown', 'startedAtUTC': '2026-11-19T00:00:12+00:00'},
    ]
    state = {'attempts': attempts, 'maxAttempts': 25, 'providerCredentialsCopied': False}
    matches = []
    for index, entry in enumerate(attempts, 1):
        matches.append({'attempt': index, 'scope': entry['scope'], 'model': entry['model'],
            'bodySHA256': entry['bodySHA256'], 'localState': entry['state'],
            'localStartedAtUTC': entry['startedAtUTC'], 'localFinishedAtUTC': entry.get('finishedAtUTC'),
            'providerRequestId': f'00000000-0000-4000-8000-{index:012d}',
            'providerUTCStartToSecond': f'2026-11-19T00:00:{1 if index == 1 else 13:02d}+00:00',
            'providerStatus': 200, 'providerDurationSeconds': 1.0, 'providerReportedTotalTokens': 83})
    audit = {'existingKeyMatch': {'sourceCwdVerified': True, 'existingCNKeyPresent': True,
        'keyMatchesVisibleAuditMask': True, 'credentialsCopied': False, 'providerRequestsSent': 0},
        'rowCount': 2, 'allProviderStatuses200': True, 'uniqueCompleteLedgerBijection': True,
        'matches': matches, 'canonicalLedgerChanged': False, 'newQwenCalls': 0,
        'lastAttemptResolution': {**matches[-1], 'providerOutcome': 'completed',
            'providerStartUnixMs': 1795046413000, 'clientResponseReceived': False,
            'clientResponseRecoveryAvailable': False,
            'usage': {'inputTokens': 80, 'outputTokens': 3, 'totalTokens': 83, 'cachedInputTokens': 60}}}
    return state, audit


class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(budget, 'evidence-bound admission has not been implemented')
        self.state, self.audit = fixture()

    def permit(self, audit=None):
        raw = encoded(audit if audit is not None else self.audit)
        return budget.seal_audit(self.state, raw), raw

    def assert_bad_audit(self, audit):
        seal, _ = self.permit()
        raw = encoded(audit)
        seal['auditSHA256'] = hashlib.sha256(raw).hexdigest()
        with self.assertRaises(budget.BudgetError):
            budget.authorize(self.state, 'github-pr360', '3'*64, [(seal, raw)])

    def test_unproved_unknown_is_still_frozen(self):
        with self.assertRaisesRegex(budget.BudgetError, 'UNKNOWN'):
            budget.authorize(self.state, 'github-pr360', '3'*64)

    def test_valid_audit_allows_only_a_new_body_without_mutating_the_ledger(self):
        before = copy.deepcopy(self.state)
        budget.authorize(self.state, 'github-pr360', '3'*64, [self.permit()])
        self.assertEqual(self.state, before)
        self.assertEqual(self.state['attempts'][-1]['state'], 'unknown')

    def test_hash_tampering_is_rejected(self):
        seal, raw = self.permit()
        with self.assertRaises(budget.BudgetError):
            budget.authorize(self.state, 'github-pr360', '3'*64, [(seal, raw+b' ')])

    def test_changed_original_prefix_is_rejected(self):
        permit = self.permit()
        self.state['attempts'][0]['maxTokens'] = 63
        with self.assertRaises(budget.BudgetError):
            budget.authorize(self.state, 'github-pr360', '3'*64, [permit])

    def test_resealing_incorrect_fields_cannot_create_evidence(self):
        changes = [('providerStatus', 500), ('model', 'wrong'), ('bodySHA256', 'f'*64),
                   ('localState', 'received'), ('scope', 'wrong'),
                   ('providerUTCStartToSecond', '2026-11-19T02:00:00+00:00')]
        for field, value in changes:
            with self.subTest(field=field):
                audit = copy.deepcopy(self.audit)
                audit['matches'][-1][field] = value
                self.assert_bad_audit(audit)

    def test_missing_identity_and_partial_audits_are_rejected(self):
        for variant in ['identity', 'missing_row', 'duplicate_id']:
            with self.subTest(variant=variant):
                audit = copy.deepcopy(self.audit)
                if variant == 'identity': audit['existingKeyMatch']['keyMatchesVisibleAuditMask'] = False
                elif variant == 'missing_row': audit['matches'].pop(0)
                else: audit['matches'][1]['providerRequestId'] = audit['matches'][0]['providerRequestId']
                self.assert_bad_audit(audit)

    def test_ambiguous_time_window_is_not_an_authoritative_match(self):
        self.state['attempts'][0]['finishedAtUTC'] = '2026-11-19T00:00:20+00:00'
        self.audit['matches'][0]['localFinishedAtUTC'] = self.state['attempts'][0]['finishedAtUTC']
        with self.assertRaisesRegex(budget.BudgetError, 'AMBIGUOUS'):
            budget.seal_audit(self.state, encoded(self.audit))

    def test_received_message_id_correlates_a_delayed_provider_start_inside_its_local_request(self):
        entry = self.state['attempts'][0]
        row = self.audit['matches'][0]
        entry['finishedAtUTC'] = '2026-11-19T00:00:30+00:00'
        entry['providerReceipt'] = {'providerMessageId': 'msg_'+row['providerRequestId']}
        row['localFinishedAtUTC'] = entry['finishedAtUTC']
        row['providerUTCStartToSecond'] = '2026-11-19T00:00:17+00:00'
        before = copy.deepcopy(self.state)
        self.permit()
        self.assertEqual(self.state, before)

    def test_persisted_received_message_id_cannot_be_replaced_by_a_time_only_match(self):
        self.state['attempts'][0]['providerReceipt'] = {
            'providerMessageId': 'msg_00000000-0000-4000-8000-000000000099'}
        with self.assertRaises(budget.BudgetError):
            self.permit()

    def test_received_message_id_does_not_accept_a_provider_start_outside_the_request(self):
        for observed in ['2026-11-18T23:59:59+00:00', '2026-11-19T00:00:11+00:00']:
            with self.subTest(observed=observed):
                self.state, self.audit = fixture()
                row = self.audit['matches'][0]
                self.state['attempts'][0]['providerReceipt'] = {'providerMessageId': 'msg_'+row['providerRequestId']}
                row['providerUTCStartToSecond'] = observed
                with self.assertRaises(budget.BudgetError):
                    self.permit()

    def test_unknown_attempt_cannot_use_a_message_id_to_widen_its_time_window(self):
        row = self.audit['matches'][-1]
        self.state['attempts'][-1]['providerReceipt'] = {'providerMessageId': 'msg_'+row['providerRequestId']}
        row['providerUTCStartToSecond'] = '2026-11-19T00:00:30+00:00'
        with self.assertRaises(budget.BudgetError):
            self.permit()

    def test_client_response_is_not_fabricated(self):
        audit = copy.deepcopy(self.audit)
        audit['lastAttemptResolution']['clientResponseReceived'] = True
        self.assert_bad_audit(audit)

    def test_usage_must_be_numeric_and_consistent(self):
        for field, value in [('totalTokens', 84), ('cachedInputTokens', 81), ('inputTokens', True)]:
            with self.subTest(field=field):
                audit = copy.deepcopy(self.audit)
                audit['lastAttemptResolution']['usage'][field] = value
                self.assert_bad_audit(audit)

    def test_old_unknown_body_stays_non_replayable_after_provider_completion(self):
        with self.assertRaisesRegex(budget.BudgetError, 'REPLAY'):
            budget.authorize(self.state, 'github-pr360', '2'*64, [self.permit()])

    def test_new_unknown_is_not_covered_by_the_old_receipt(self):
        permit = self.permit()
        self.state['attempts'].append({**self.state['attempts'][-1], 'bodySHA256': '4'*64,
                                      'startedAtUTC': '2026-11-19T00:01:00+00:00'})
        with self.assertRaisesRegex(budget.BudgetError, 'UNKNOWN'):
            budget.authorize(self.state, 'github-pr360', '3'*64, [permit])

    def test_truncating_the_anchored_ledger_cannot_reset_its_budget(self):
        permit = self.permit()
        self.state['attempts'].pop()
        with self.assertRaises(budget.BudgetError):
            budget.authorize(self.state, 'github-pr360', '3'*64, [permit])

    def test_cap_changes_and_all_reserved_slots_stay_blocked(self):
        permit = self.permit()
        self.state['maxAttempts'] = 26
        with self.assertRaisesRegex(budget.BudgetError, 'POLICY'):
            budget.authorize(self.state, 'github-pr360', '3'*64, [permit])
        self.state['maxAttempts'] = 25
        self.state['attempts'] += [copy.deepcopy(self.state['attempts'][0]) for _ in range(23)]
        with self.assertRaisesRegex(budget.BudgetError, 'BUDGET'):
            budget.authorize(self.state, 'github-pr360', '3'*64, [permit])

    def test_invalid_json_and_duplicate_keys_fail_closed(self):
        for raw in [b'{"x":NaN}', b'{"x":1,"x":2}', b'[]']:
            with self.subTest(raw=raw), self.assertRaises(budget.BudgetError):
                budget.seal_audit(self.state, raw)

    def test_connectivity_probe_is_never_repeated(self):
        self.state['attempts'][0]['scope'] = 'connectivity-probe'
        with self.assertRaisesRegex(budget.BudgetError, 'PROBE'):
            budget.authorize(self.state, 'connectivity-probe', '3'*64)

    def test_failed_atomic_replace_keeps_original_ledger_and_removes_tempfile(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder)/'ledger.json'
            target.write_bytes(b'original')
            with mock.patch.object(budget.os, 'replace', side_effect=OSError('synthetic failure')):
                with self.assertRaises(OSError): budget.write_ledger(target, self.state)
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual([p.name for p in Path(folder).iterdir()], ['ledger.json'])
            budget.write_ledger(target, self.state)
            self.assertEqual(json.loads(target.read_text()), self.state)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)


class ExtensionTest(unittest.TestCase):
    """Synthetic operator approval only; never reads or writes the live relay."""

    def setUp(self):
        self.assertTrue(callable(getattr(budget, 'prepare_extension', None)),
                        'an exhausted ledger has no evidence-bound extension preparation')
        self.state, self.audit = fixture()
        prefix = copy.deepcopy(self.state)
        raw = encoded(self.audit)
        self.permits = [(budget.seal_audit(prefix, raw), raw)]
        for ordinal in range(3, 26):
            self.state['attempts'].append(self.entry(ordinal))

    def entry(self, ordinal):
        return {'scope': 'github-pr360', 'model': 'qwen3.8-max', 'maxTokens': 4096,
                'bodySHA256': f'{ordinal:064x}', 'state': 'received', 'httpStatus': 200,
                'startedAtUTC': f'2026-11-19T00:{ordinal:02d}:00+00:00',
                'finishedAtUTC': f'2026-11-19T00:{ordinal:02d}:10+00:00'}

    def approval(self):
        proposal = budget.prepare_extension(self.state)
        proposal.update(approved=True, authorizationRef='synthetic-unit-test-approval')
        return proposal

    def admit(self, state, extension, **overrides):
        args = {'scope': 'github-pr360', 'body_sha': 'f'*64, 'permits': self.permits,
                'extension': extension, 'model': 'qwen3.8-max', 'max_tokens': 4096}
        args.update(overrides)
        return budget.authorize(state, **args)

    def test_preparation_never_grants_or_mutates_the_exhausted_budget(self):
        before = encoded(self.state)
        proposal = budget.prepare_extension(self.state)
        self.assertEqual(encoded(self.state), before)
        self.assertIs(proposal['approved'], False)
        self.assertIsNone(proposal['authorizationRef'])
        self.assertEqual(proposal['baselineAttempts'], 25)
        self.assertEqual(proposal['additionalAttempts'], 16)
        self.assertEqual(proposal['maxAttempts'], 41)
        with self.assertRaisesRegex(budget.BudgetError, 'APPROVAL'):
            budget.extend_ledger(self.state, proposal)

    def test_unapproved_or_unexhausted_state_cannot_be_migrated(self):
        approval = self.approval()
        for value in [False, 1, 'true']:
            with self.subTest(value=value):
                bad = {**approval, 'approved': value}
                with self.assertRaises(budget.BudgetError):
                    budget.extend_ledger(self.state, bad)
        with self.assertRaises(budget.BudgetError):
            budget.extend_ledger(self.state, {**approval, 'authorizationRef': ''})
        self.state['attempts'].pop()
        with self.assertRaises(budget.BudgetError):
            budget.prepare_extension(self.state)

    def test_migration_preserves_every_original_attempt_and_unknown(self):
        before = copy.deepcopy(self.state)
        approval = self.approval()
        migrated = budget.extend_ledger(self.state, approval)
        self.assertEqual(self.state, before)
        self.assertEqual(migrated, {**before, 'maxAttempts': 41})
        self.assertEqual(migrated['attempts'][1]['state'], 'unknown')
        migrated['attempts'][0]['model'] = 'mutated-copy'
        self.assertEqual(self.state, before)

    def test_default_guard_remains_exhausted_and_extension_cannot_be_applied_twice(self):
        approval = self.approval()
        with self.assertRaisesRegex(budget.BudgetError, 'EXHAUSTED'):
            budget.authorize(self.state, 'github-pr360', 'f'*64, self.permits)
        migrated = budget.extend_ledger(self.state, approval)
        with self.assertRaisesRegex(budget.BudgetError, 'POLICY'):
            budget.authorize(migrated, 'github-pr360', 'f'*64, self.permits)
        with self.assertRaises(budget.BudgetError):
            budget.extend_ledger(migrated, approval)
        with self.assertRaises(budget.BudgetError):
            self.admit(self.state, approval)

    def test_only_sixteen_fresh_attempts_are_admitted_after_approval(self):
        approval = self.approval()
        migrated = budget.extend_ledger(self.state, approval)
        for ordinal in range(26, 42):
            body = f'{ordinal:064x}'
            self.admit(migrated, approval, body_sha=body)
            migrated['attempts'].append(self.entry(ordinal))
        self.assertEqual(len(migrated['attempts']), 41)
        with self.assertRaisesRegex(budget.BudgetError, 'EXHAUSTED'):
            self.admit(migrated, approval)

    def test_historical_received_and_unknown_bodies_cannot_be_replayed(self):
        approval = self.approval()
        migrated = budget.extend_ledger(self.state, approval)
        for entry in migrated['attempts']:
            with self.subTest(state=entry['state'], body=entry['bodySHA256']):
                with self.assertRaisesRegex(budget.BudgetError, 'REPLAY'):
                    self.admit(migrated, approval, body_sha=entry['bodySHA256'])

    def test_cap_scope_model_tokens_and_retry_cannot_be_widened(self):
        approval = self.approval()
        migrated = budget.extend_ledger(self.state, approval)
        variants = [('maxAttempts', 42), ('additionalAttempts', 17), ('baselineAttempts', 24),
                    ('baselineMaxAttempts', 26), ('model', 'qwen3.8-flash'),
                    ('maxOutputTokens', 4097), ('automaticRetries', 1),
                    ('allowedScopes', ['connectivity-probe', 'github-pr360', 'sheets-synthetic']),
                    ('freshOriginalDownloads', {'github-pr360': 2, 'sheets-synthetic': 1}),
                    ('schemaVersion', True)]
        for key, value in variants:
            with self.subTest(key=key), self.assertRaises(budget.BudgetError):
                self.admit(migrated, {**approval, key: value})
        for change in [{'scope': 'connectivity-probe'}, {'model': 'qwen3.8-flash'},
                       {'max_tokens': 4097}, {'max_tokens': True}]:
            with self.subTest(change=change), self.assertRaises(budget.BudgetError):
                self.admit(migrated, approval, **change)

    def test_changed_truncated_or_reordered_baseline_cannot_reset_budget(self):
        approval = self.approval()
        for variant in ['changed', 'truncated', 'reordered', 'unknown-washed-green']:
            with self.subTest(variant=variant):
                changed = budget.extend_ledger(self.state, approval)
                if variant == 'changed': changed['attempts'][0]['maxTokens'] = 63
                elif variant == 'truncated': changed['attempts'].pop()
                elif variant == 'reordered': changed['attempts'][0:2] = changed['attempts'][1::-1]
                else: changed['attempts'][1] = copy.deepcopy(changed['attempts'][0])
                with self.assertRaises(budget.BudgetError):
                    self.admit(changed, approval)

    def test_approval_never_substitutes_for_provider_reconciliation(self):
        approval = self.approval()
        migrated = budget.extend_ledger(self.state, approval)
        with self.assertRaisesRegex(budget.BudgetError, 'UNKNOWN'):
            self.admit(migrated, approval, permits=[])
        self.admit(migrated, approval)
        migrated['attempts'].append({**self.entry(26), 'state': 'unknown'})
        with self.assertRaisesRegex(budget.BudgetError, 'UNKNOWN'):
            self.admit(migrated, approval)

    def test_new_history_cannot_hide_out_of_scope_or_duplicate_attempts(self):
        approval = self.approval()
        for change in [{'scope': 'connectivity-probe'}, {'model': 'qwen3.8-flash'},
                       {'bodySHA256': self.state['attempts'][0]['bodySHA256']}]:
            with self.subTest(change=change):
                migrated = budget.extend_ledger(self.state, approval)
                migrated['attempts'].append({**self.entry(26), **change})
                with self.assertRaises(budget.BudgetError):
                    self.admit(migrated, approval)

    def test_extended_audit_can_seal_complete_metadata_without_changing_old_unknown(self):
        approval = self.approval()
        migrated = budget.extend_ledger(self.state, approval)
        migrated['attempts'].append(self.entry(26))
        audit = copy.deepcopy(self.audit)
        for index, entry in enumerate(migrated['attempts'][2:], 3):
            audit['matches'].append({'attempt': index, 'scope': entry['scope'], 'model': entry['model'],
                'bodySHA256': entry['bodySHA256'], 'localState': entry['state'],
                'localStartedAtUTC': entry['startedAtUTC'], 'localFinishedAtUTC': entry['finishedAtUTC'],
                'providerRequestId': f'00000000-0000-4000-8000-{index:012d}',
                'providerUTCStartToSecond': f'2026-11-19T00:{index:02d}:01+00:00',
                'providerStatus': 200, 'providerDurationSeconds': 1.0, 'providerReportedTotalTokens': 83})
        audit['rowCount'] = 26
        before = encoded(migrated)
        seal = budget.seal_audit(migrated, encoded(audit), extension=approval)
        self.assertEqual(seal['prefixCount'], 26)
        self.assertEqual(encoded(migrated), before)
        self.assertEqual(migrated['attempts'][1]['state'], 'unknown')


if __name__ == '__main__':
    unittest.main()
