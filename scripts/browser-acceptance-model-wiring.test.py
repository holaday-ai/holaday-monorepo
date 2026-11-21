"""Explicit opt-in: clone the private bundle, block network subprocesses, never send.

Only ROOT is substituted through its AST. Original ledger bytes are checked after
each case; mutable fixture files and raw audit identifiers remain in local temp.
"""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

bundle = os.environ.get('HOLADAY_MODEL_RELAY_WIRING_ROOT')


@unittest.skipUnless(bundle, 'requires explicit private bundle opt-in; no provider access')
class WiringTest(unittest.TestCase):
    def setUp(self):
        self.bundle = Path(bundle).resolve()
        self.original_ledger = self.bundle/'model-relay/requests.json'
        self.before = self.original_ledger.read_bytes()
        self.temporary = tempfile.TemporaryDirectory(prefix='holaday-relay-wiring-')
        self.folder = Path(self.temporary.name)
        self.helpers = self.folder/'helpers'
        self.root = self.folder/'model-relay'
        self.helpers.mkdir(mode=0o700)
        self.root.mkdir(mode=0o700)
        self.source = (self.bundle/'helpers/real-model-relay.py').read_text()
        self.tree = ast.parse(self.source)
        self.policy = json.loads((self.bundle/'model-relay/provider-audit-policy.json').read_text())
        for name in ['browser_acceptance_budget.py', 'browser_acceptance_transport.py', 'existing-model-fetch.mjs']:
            shutil.copy2(self.bundle/'helpers'/name, self.helpers/name)
        for name in ['requests.json', 'provider-audit-policy.json']:
            shutil.copy2(self.bundle/'model-relay'/name, self.root/name)
        shutil.copytree(self.bundle/'model-relay/reconciliations', self.root/'reconciliations')
        root_nodes = [node for node in self.tree.body if isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == 'ROOT' for target in node.targets)]
        self.assertEqual(len(root_nodes), 1)
        self.assertEqual(root_nodes[0].value.args[0].value, str(self.bundle/'model-relay'))
        root_nodes[0].value.args[0].value = str(self.root)
        self.fixture = self.helpers/'real-model-relay.py'
        self.fixture.write_text(ast.unparse(self.tree))
        self.request = {'mode': 'send', 'scope': 'github-pr360', 'body': {
            'model': 'qwen3.8-max', 'max_tokens': 1,
            'messages': [{'role': 'user', 'content': 'Local admission test only.'}]}}

    def tearDown(self):
        self.assertEqual(self.original_ledger.read_bytes(), self.before)
        self.temporary.cleanup()

    def run_fixture(self, request, flags=()):
        bootstrap = '''import runpy, subprocess, sys
def forbidden(*args, **kwargs): raise RuntimeError('NETWORK_SPAWN_FORBIDDEN_IN_WIRING_TEST')
subprocess.run = forbidden
subprocess.Popen = forbidden
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
'''
        before = (self.root/'requests.json').read_bytes()
        result = subprocess.run([sys.executable, '-c', bootstrap, str(self.fixture), *flags],
                                input=json.dumps(request), capture_output=True, text=True, timeout=5)
        self.assertEqual((self.root/'requests.json').read_bytes(), before)
        self.assertFalse((self.root/'task-file-audit.ndjson').exists())
        return result

    def test_fixed_policy_and_exact_module_fingerprints(self):
        self.assertEqual(self.policy['maxAttempts'], 25)
        self.assertEqual(self.policy['baselinePrefixCount'], 14)
        for name, digest in self.policy['moduleHashes'].items():
            self.assertEqual(hashlib.sha256((self.helpers/name).read_bytes()).hexdigest(), digest)

    def test_generated_mask_still_removes_account_email(self):
        node = next(node for node in ast.walk(self.tree)
                    if isinstance(node, ast.FunctionDef) and node.name == 'mask')
        namespace = {'re': re}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<mask-only>', 'exec'), namespace)
        output = namespace['mask']({'nested': ['contact person@example.com']})
        self.assertEqual(output, {'nested': ['contact [ACCOUNT_EMAIL]']})

    def test_actual_remote_program_concatenation_compiles_and_uses_bounded_http(self):
        expression = next(node.value for node in self.tree.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'program' for target in node.targets))
        program = eval(compile(ast.Expression(expression), '<construction-only>', 'eval'),
                       {'json': json, 'base64': base64},
                       {'r': self.request, 'sources': {'browser_acceptance_transport.py':
                                                     (self.helpers/'browser_acceptance_transport.py').read_bytes()}})
        parsed = ast.parse(program)
        bounded = [node for node in ast.walk(parsed) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Name) and node.func.id == 'bounded_http']
        self.assertEqual(len(bounded), 1)
        self.assertEqual(next(item.value.value for item in bounded[0].keywords
                              if item.arg == 'timeout_seconds'), 75)
        self.assertIn('PINNED_HELPER_CHANGED', self.source)

    def test_actual_audit_filename_matches_the_generated_policy_gate(self):
        patterns = [node.args[0].value for node in ast.walk(self.tree) if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute) and node.func.attr == 'fullmatch'
                    and isinstance(node.args[0], ast.Constant)]
        self.assertTrue(any(re.fullmatch(pattern, 'audit-20261119-v1.json') for pattern in patterns))

    def test_check_only_enforces_live_snapshot_budget_without_reserving_or_sending(self):
        result = self.run_fixture(self.request, ['--check-admission-only'])
        snapshot = json.loads(self.before)
        attempts = len(snapshot['attempts'])
        if attempts >= snapshot['maxAttempts']:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('BUDGET_EXHAUSTED', result.stderr)
            self.assertEqual(result.stdout, '')
            return
        self.assertEqual(result.returncode, 0, result.stderr[-500:])
        response = json.loads(result.stdout)
        self.assertTrue(response['admitted'])
        self.assertFalse(response['executionAllowed'])
        self.assertEqual(response['providerRequestsSent'], 0)
        self.assertEqual(response['attempts'], attempts)

    def test_missing_flag_and_request_side_policy_overrides_are_rejected(self):
        for request, flags, reason in [
            (self.request, [], 'EXPLICIT_REAL_MODEL_EXECUTION_REQUIRED'),
            ({**self.request, 'auditPath': '/not-an-authority'}, ['--check-admission-only'], 'INVALID_RELAY_REQUEST'),
            ({**self.request, 'scope': 'unconfirmed'}, ['--check-admission-only'], 'UNCONFIRMED_SCOPE'),
        ]:
            with self.subTest(reason=reason):
                result = self.run_fixture(request, flags)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(reason, result.stderr)

    def test_tampered_pinned_module_is_rejected_before_reservation(self):
        target = self.helpers/'browser_acceptance_budget.py'
        target.write_bytes(target.read_bytes()+b'\n# synthetic drift\n')
        result = self.run_fixture(self.request, ['--check-admission-only'])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('PINNED_HELPER_CHANGED', result.stderr)


if __name__ == '__main__':
    unittest.main()
