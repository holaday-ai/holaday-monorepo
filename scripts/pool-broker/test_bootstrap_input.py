"""HPR1 data decoding, with real HPE1 producer/consumer integration."""

import unittest
import json
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch

import application_guard as guard
from test_environment_handoff import CapsuleKernel

try:
    import bootstrap_input
except ModuleNotFoundError as error:
    if error.name != 'bootstrap_input':
        raise
    bootstrap_input = None

# Test-only loading of the fixed repository policy. Production initialization
# consumes the exact verified bytes in bootstrap._load_modules instead.
if bootstrap_input is not None:
    bootstrap_input._KEYS = frozenset(json.loads(
        Path(__file__).with_name('application_env_keys.json').read_bytes())['keys'])


class BootstrapInputTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(bootstrap_input, 'bootstrap decoder missing')

    def test_selection_preserves_empty_values_without_parsing_pm2_objects(self):
        raw = (b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0LOG_LEVEL=\0'
               b'NODE_CHANNEL_FD=3\0env={not-json}\0PM2_HOME=/synthetic/private\0\0')
        self.assertEqual(bootstrap_input.decode_bootstrap_input(raw, 'a' * 40),
                         {'NODE_ENV': 'production', 'LOG_LEVEL': ''})

    def test_selected_values_flow_through_actual_seal_and_guard_consumer(self):
        raw = b'HPR1' + b'a' * 40 + 'NODE_ENV=production\0LOG_LEVEL=\0S3_BUCKET=中文=x\0\0'.encode()
        with ExitStack() as stack:
            stack.enter_context(patch.object(guard.sys, 'platform', 'linux'))
            stack.enter_context(patch.object(guard.os, 'getresuid', return_value=(0, 0, 0), create=True))
            stack.enter_context(patch.object(guard.os, 'getresgid', return_value=(0, 0, 0), create=True))
            kernel = CapsuleKernel(stack)
            values = bootstrap_input.decode_bootstrap_input(raw, 'a' * 40)
            guard.seal_application_environment('a' * 40, 'b' * 32, values)
            kernel.inherit()
            self.assertEqual(guard._consume_environment('a' * 40, 'b' * 32),
                             {'NODE_ENV': 'production', 'LOG_LEVEL': '', 'S3_BUCKET': '中文=x'})
            self.assertEqual(kernel.fds, set())

    def reject(self, raw, candidate='a' * 40):
        with self.assertRaises(ValueError) as caught:
            bootstrap_input.decode_bootstrap_input(raw, candidate)
        self.assertEqual(str(caught.exception), 'POOL_BROKER_BOOTSTRAP_INPUT_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_binding_framing_and_type_fail_closed(self):
        good = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0\0'
        for raw in (None, bytearray(good), b'', b'X' + good[1:], good[:4] + b'c' * 40 + good[44:],
                    good[:-1], good + b'x', good[:44] + b'\0' + good[44:], good + b'\0'):
            with self.subTest(raw_type=type(raw).__name__):
                self.reject(raw)
        for candidate in (None, 7, 'a' * 39, 'A' * 40, '0' * 40):
            with self.subTest(candidate_type=type(candidate).__name__):
                self.reject(good, candidate)

    def test_malformed_or_duplicate_discarded_entries_also_rejected(self):
        for suffix in (b'UNKNOWN\0', b'=x\0', b'a-b=x\0', b'9BAD=x\0', b'X=\xff\0',
                       b'X' * 129 + b'=a\0', b'LOG_LEVEL=a\0LOG_LEVEL=b\0',
                       b'NODE_CHANNEL_FD=3\0NODE_CHANNEL_FD=4\0'):
            with self.subTest(length=len(suffix)):
                self.reject(b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0' + suffix + b'\0')

    def test_raw_count_and_length_budgets_are_not_truncated(self):
        header = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0'
        self.reject(header + b'X=' + b'x' * 131070 + b'\0\0')
        entries = b''.join(('X%d=x\0' % i).encode() for i in range(1024))
        self.reject(header + entries + b'\0')
        self.reject(header + b'X=' + b'x' * 131000 + b'\0Y=' + b'y' * 131000 + b'\0Z=' + b'z' * 500 + b'\0\0')

    def test_discarded_metadata_can_exceed_business_value_budget(self):
        raw = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0env=' + b'x' * 10000 + b'\0\0'
        self.assertEqual(bootstrap_input.decode_bootstrap_input(raw, 'a' * 40), {'NODE_ENV': 'production'})

    def test_business_budget_checked_before_returning_selected_values(self):
        header = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0'
        self.reject(header + b'LOG_LEVEL=' + b'x' * 8193 + b'\0\0')
        keys = ['LOG_LEVEL', 'S3_BUCKET', 'S3_ENDPOINT', 'HTTP_PORT', 'WS_PORT', 'DATABASE_URL',
                'REDIS_URL', 'JWT_SECRET', 'MFA_MASTER_KEY']
        self.reject(header + b''.join(k.encode() + b'=' + b'x' * 8192 + b'\0' for k in keys) + b'\0')

    def test_loader_data_is_not_selected_and_root_env_unchanged(self):
        raw = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0LD_PRELOAD=synthetic\0PYTHONPATH=synthetic\0NODE_OPTIONS=synthetic\0\0'
        with patch.object(guard.os, 'environ', {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}):
            self.assertEqual(bootstrap_input.decode_bootstrap_input(raw, 'a' * 40), {'NODE_ENV': 'production'})
            self.assertEqual(dict(guard.os.environ), {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})

    def test_production_is_not_defaulted_and_prior_exception_not_retained(self):
        for body in (b'LOG_LEVEL=info\0', b'NODE_ENV=\0', b'NODE_ENV=development\0'):
            try:
                raise RuntimeError('synthetic private error')
            except RuntimeError:
                self.reject(b'HPR1' + b'a' * 40 + body + b'\0')

    def test_reviewed_dependency_overrides_are_preserved_without_wildcards(self):
        keys = ['DIVINE_API_CACHE_TTL_MS', 'GLOBAL_AGENT_HTTP_PROXY',
                'GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE', 'PLAYWRIGHT_BROWSERS_PATH',
                'npm_config_playwright_browsers_path', 'npm_package_config_init_cwd',
                'XDG_CACHE_HOME', 'TMPDIR', 'TMP', 'TEMP']
        values = {key: '' for key in keys}
        values['GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE'] = 'GLOBAL_AGENT_'
        raw = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0'
        raw += b''.join((key + '=' + value + '\0').encode() for key, value in values.items())
        raw += b'npm_config_unreviewed=discard\0\0'
        self.assertEqual(bootstrap_input.decode_bootstrap_input(raw, 'a' * 40),
                         dict(NODE_ENV='production', **values))

    def test_dynamic_proxy_namespace_and_custom_start_paths_fail_closed(self):
        for entry in (b'GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=',
                      b'GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=CUSTOM_',
                      b'ORCHESTRATOR_NODE_BIN=/tmp/node', b'ORCHESTRATOR_REPO_ROOT=/tmp/app'):
            self.reject(b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0' + entry + b'\0\0')

    def test_empty_start_path_overrides_keep_legacy_shell_default_semantics(self):
        raw = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0ORCHESTRATOR_NODE_BIN=\0ORCHESTRATOR_REPO_ROOT=\0\0'
        self.assertEqual(bootstrap_input.decode_bootstrap_input(raw, 'a' * 40),
                         {'NODE_ENV': 'production', 'ORCHESTRATOR_NODE_BIN': '', 'ORCHESTRATOR_REPO_ROOT': ''})


if __name__ == '__main__':
    unittest.main()
