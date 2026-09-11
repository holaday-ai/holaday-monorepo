"""Decode raw first-exec data; never merge it into the root environment."""

import json
import re

import application_guard


# Initialized once by the trusted loader from the already-verified data bytes.
# An ordinary import has no policy and cannot successfully decode an input.
_KEYS: frozenset


def decode_bootstrap_input(raw, candidate):
    try:
        application_guard._binding(candidate, '1' * 32)
        if (type(raw) is not bytes or not 46 < len(raw) <= 262144
                or raw[:44] != b'HPR1' + candidate.encode('ascii') or not raw.endswith(b'\0\0')):
            raise ValueError()
        entries = raw[44:-2].split(b'\0')
        if not 1 <= len(entries) <= 1024:
            raise ValueError()
        values, seen = {}, set()
        for item in entries:
            if not item or len(item) + 1 > 131072:
                raise ValueError()
            key, value = item.decode('utf-8').split('=', 1)
            if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', key) is None or key in seen:
                raise ValueError()
            seen.add(key)
            if key in _KEYS:
                values[key] = value
        for key, expected in {
                'GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE': 'GLOBAL_AGENT_',
                'ORCHESTRATOR_NODE_BIN': '/opt/node22/bin/node',
                'ORCHESTRATOR_REPO_ROOT': '/opt/holaday-monorepo'}.items():
            allowed = (expected,) if key == 'GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE' else ('', expected)
            if key in values and values[key] not in allowed:
                raise ValueError()
        env = application_guard._application_environment(values)
        # Match the existing HPE1 wire budget, including the future boot field.
        if len(json.dumps(['HPE1', candidate, '1' * 32, list(env.items())], ensure_ascii=False).encode('utf-8')) > 65536:
            raise ValueError()
        return env
    except Exception:
        try:
            raise ValueError('POOL_BROKER_BOOTSTRAP_INPUT_UNPROVEN') from None
        except ValueError as error:
            error.__context__ = None
            raise
