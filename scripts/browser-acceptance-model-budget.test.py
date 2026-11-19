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


if __name__ == '__main__':
    unittest.main()
