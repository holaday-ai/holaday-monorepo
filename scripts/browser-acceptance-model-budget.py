"""Local acceptance policy, not production execution authority or a billing verifier.

Audit bytes are operator-verified local evidence, not provider-signed receipts.
The relay loads them only from its fixed private directory, never from model input.
"""
from datetime import datetime, timezone
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import uuid


class BudgetError(ValueError):
    pass


def _require(condition, code):
    if not condition:
        raise BudgetError(code)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def _integer(value, minimum=0, maximum=1_000_000_000):
    return type(value) is int and minimum <= value <= maximum


def _utc(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        _require(parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0,
                 'INVALID_AUDIT_TIME')
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        raise BudgetError('INVALID_AUDIT_TIME') from None


def _ledger(state, limit=25):
    _require(isinstance(state, dict) and type(state.get('maxAttempts')) is int
             and state['maxAttempts'] == limit and state.get('providerCredentialsCopied') is False,
             'INVALID_LEDGER_POLICY')
    entries = state.get('attempts')
    _require(isinstance(entries, list) and len(entries) <= limit, 'INVALID_LEDGER_POLICY')
    for entry in entries:
        _require(isinstance(entry, dict)
                 and entry.get('scope') in {'connectivity-probe', 'github-pr360', 'sheets-synthetic'}
                 and isinstance(entry.get('model'), str) and bool(entry['model'])
                 and _integer(entry.get('maxTokens'), 1, 4096)
                 and isinstance(entry.get('bodySHA256'), str)
                 and re.fullmatch(r'[a-f0-9]{64}', entry['bodySHA256'])
                 and entry.get('state') in {'received', 'unknown'}, 'INVALID_LEDGER_ATTEMPT')
        start = _utc(entry.get('startedAtUTC'))
        if entry['state'] == 'received':
            _require(_integer(entry.get('httpStatus'), 100, 599)
                     and _utc(entry.get('finishedAtUTC')) >= start, 'INVALID_LEDGER_RECEIPT')
    return entries


def _json(raw):
    _require(isinstance(raw, bytes) and len(raw) <= 512 * 1024, 'INVALID_AUDIT_BYTES')

    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, 'DUPLICATE_AUDIT_KEY')
            result[key] = value
        return result

    def constant(_value):
        raise BudgetError('INVALID_AUDIT_NUMBER')

    try:
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError):
        raise BudgetError('INVALID_AUDIT_JSON') from None
    _require(isinstance(value, dict), 'INVALID_AUDIT_JSON')
    return value


def _audit(prefix, audit):
    identity = audit.get('existingKeyMatch', {})
    _require(isinstance(identity, dict)
             and all(identity.get(key) is True for key in
                     ['sourceCwdVerified', 'existingCNKeyPresent', 'keyMatchesVisibleAuditMask'])
             and identity.get('credentialsCopied') is False
             and type(identity.get('providerRequestsSent')) is int
             and identity['providerRequestsSent'] == 0, 'AUDIT_IDENTITY_UNPROVEN')
    rows = audit.get('matches')
    _require(audit.get('uniqueCompleteLedgerBijection') is True
             and audit.get('allProviderStatuses200') is True
             and audit.get('canonicalLedgerChanged') is False
             and type(audit.get('newQwenCalls')) is int and audit['newQwenCalls'] == 0
             and type(audit.get('rowCount')) is int and audit['rowCount'] == len(prefix)
             and isinstance(rows, list) and len(rows) == len(prefix), 'INCOMPLETE_AUDIT')
    matched = {}
    request_ids = set()
    for row in rows:
        _require(isinstance(row, dict) and _integer(row.get('attempt'), 1, len(prefix)),
                 'INVALID_AUDIT_MATCH')
        index = row['attempt']
        _require(index not in matched, 'DUPLICATE_AUDIT_MATCH')
        entry = prefix[index - 1]
        request_id = row.get('providerRequestId')
        try:
            _require(str(uuid.UUID(request_id)) == request_id, 'INVALID_PROVIDER_REQUEST_ID')
        except (ValueError, TypeError, AttributeError):
            raise BudgetError('INVALID_PROVIDER_REQUEST_ID') from None
        _require(request_id not in request_ids, 'DUPLICATE_PROVIDER_REQUEST_ID')
        request_ids.add(request_id)
        for left, right in [('scope', 'scope'), ('model', 'model'), ('bodySHA256', 'bodySHA256'),
                            ('localState', 'state'), ('localStartedAtUTC', 'startedAtUTC'),
                            ('localFinishedAtUTC', 'finishedAtUTC')]:
            _require(row.get(left) == entry.get(right), 'AUDIT_ATTEMPT_MISMATCH')
        duration = row.get('providerDurationSeconds')
        _require(type(row.get('providerStatus')) is int and row['providerStatus'] == 200
                 and _integer(row.get('providerReportedTotalTokens'))
                 and type(duration) in (int, float) and math.isfinite(duration)
                 and 0 <= duration <= 86400, 'AUDIT_PROVIDER_NOT_COMPLETED')
        observed = _utc(row.get('providerUTCStartToSecond'))
        possible = []
        anchored_matches = []
        for number, candidate in enumerate(prefix, 1):
            start = _utc(candidate['startedAtUTC'])
            end = _utc(candidate['finishedAtUTC']) if candidate.get('finishedAtUTC') else None
            receipt = candidate.get('providerReceipt')
            message_id = receipt.get('providerMessageId') if isinstance(receipt, dict) else None
            # A received response supplies an exact provider body ID. It is a
            # stronger correlation than SSH/queue timing, but still requires the
            # provider start to fall inside that same local request. Missing
            # client responses retain the original unique 15-second window.
            anchored_id = (candidate['state'] == 'received' and isinstance(message_id, str)
                           and re.fullmatch(r'msg_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', message_id))
            if candidate['model'] != row['model']:
                continue
            if anchored_id:
                if message_id == 'msg_'+request_id and start <= observed and end is not None and observed < end:
                    anchored_matches.append(number)
            elif 0 <= (observed - start).total_seconds() <= 15 and (end is None or observed < end):
                possible.append(number)
        _require((anchored_matches or possible) == [index], 'AMBIGUOUS_OR_UNMATCHED_AUDIT_TIME')
        matched[index] = row
    _require(set(matched) == set(range(1, len(prefix) + 1)), 'INCOMPLETE_AUDIT')
    resolution = audit.get('lastAttemptResolution')
    _require(isinstance(resolution, dict)
             and _integer(resolution.get('attempt'), 1, len(prefix)), 'INVALID_AUDIT_RESOLUTION')
    index = resolution['attempt']
    row = matched[index]
    _require(prefix[index - 1]['state'] == 'unknown'
             and resolution.get('providerOutcome') == 'completed'
             and resolution.get('clientResponseReceived') is False
             and resolution.get('clientResponseRecoveryAvailable') is False,
             'CLIENT_RESPONSE_MUST_REMAIN_MISSING')
    for field in ['scope', 'model', 'bodySHA256', 'localState', 'localStartedAtUTC',
                  'providerRequestId', 'providerStatus', 'providerUTCStartToSecond']:
        _require(resolution.get(field) == row.get(field), 'AUDIT_RESOLUTION_MISMATCH')
    milliseconds = resolution.get('providerStartUnixMs')
    _require(_integer(milliseconds, 0, 10**15), 'INVALID_AUDIT_TIME')
    observed = _utc(row['providerUTCStartToSecond']).timestamp()
    _require(observed <= milliseconds / 1000 < observed + 1, 'AUDIT_RESOLUTION_TIME_MISMATCH')
    usage = resolution.get('usage', {})
    _require(isinstance(usage, dict) and all(_integer(usage.get(key)) for key in
             ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens']), 'INVALID_AUDIT_USAGE')
    _require(usage['inputTokens'] + usage['outputTokens'] == usage['totalTokens']
             and usage['totalTokens'] == row['providerReportedTotalTokens']
             and usage['cachedInputTokens'] <= usage['inputTokens']
             and usage['outputTokens'] <= prefix[index - 1]['maxTokens'], 'INVALID_AUDIT_USAGE')
    return index


def _extension_template(entries):
    return {'schemaVersion': 1, 'baselineMaxAttempts': 25, 'baselineAttempts': 25,
            'baselineSHA256': _digest(entries[:25]), 'additionalAttempts': 16,
            'maxAttempts': 41, 'model': 'qwen3.8-max', 'maxOutputTokens': 4096,
            'allowedScopes': ['github-pr360', 'sheets-synthetic'], 'automaticRetries': 0,
            'freshOriginalDownloads': {'github-pr360': 1, 'sheets-synthetic': 1},
            'approved': False, 'authorizationRef': None}


def prepare_extension(state):
    """Pure proposal; never records consent, writes a ledger, or opens a budget slot."""
    entries = _ledger(state)
    _require(len(entries) == 25, 'EXHAUSTED_BASELINE_REQUIRED')
    return _extension_template(entries)


def _extension_ledger(state, extension):
    # This is operator-owned policy, not a field accepted from model/request input.
    # The reference records explicit consent; it is not a cryptographic signature.
    _require(isinstance(state, dict) and type(state.get('maxAttempts')) is int
             and state['maxAttempts'] in (25, 41), 'INVALID_LEDGER_POLICY')
    entries = _ledger(state, state['maxAttempts'])
    _require(len(entries) >= 25, 'EXTENSION_BASELINE_REQUIRED')
    expected = _extension_template(entries)
    _require(isinstance(extension, dict) and set(extension) == set(expected),
             'INVALID_EXTENSION_POLICY')
    _require(extension['approved'] is True
             and isinstance(extension['authorizationRef'], str)
             and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}', extension['authorizationRef']),
             'EXPLICIT_EXTENSION_APPROVAL_REQUIRED')
    for field in ['schemaVersion', 'baselineMaxAttempts', 'baselineAttempts',
                  'additionalAttempts', 'maxAttempts', 'maxOutputTokens', 'automaticRetries']:
        _require(type(extension[field]) is int and extension[field] == expected[field],
                 'INVALID_EXTENSION_POLICY')
    _require(extension['baselineSHA256'] == expected['baselineSHA256'],
             'EXTENSION_BASELINE_MISMATCH')
    _require(extension['model'] == expected['model']
             and extension['allowedScopes'] == expected['allowedScopes']
             and isinstance(extension['freshOriginalDownloads'], dict)
             and set(extension['freshOriginalDownloads']) == set(expected['freshOriginalDownloads'])
             and all(type(value) is int and value == 1
                     for value in extension['freshOriginalDownloads'].values()),
             'INVALID_EXTENSION_POLICY')
    seen = {entry['bodySHA256'] for entry in entries[:25]}
    for entry in entries[25:]:
        _require(entry['scope'] in extension['allowedScopes'] and entry['model'] == extension['model'],
                 'EXTENSION_HISTORY_OUT_OF_SCOPE')
        _require(entry['bodySHA256'] not in seen, 'BODY_REPLAY_FORBIDDEN')
        seen.add(entry['bodySHA256'])
    return entries


def extend_ledger(state, extension):
    """Return a separate migrated value after operator approval; no disk activation."""
    entries = _ledger(state)
    _require(len(entries) == 25, 'EXHAUSTED_BASELINE_REQUIRED')
    _extension_ledger(state, extension)
    migrated = copy.deepcopy(state)
    migrated['maxAttempts'] = 41
    return migrated


def _saved_template(entries, runtime_source, materials):
    _require(isinstance(runtime_source, str)
             and re.fullmatch(r'[a-f0-9]{40}', runtime_source), 'INVALID_SAVED_RUNTIME')
    _require(isinstance(materials, list) and len(materials) == 2, 'INVALID_SAVED_MATERIALS')
    for item in materials:
        _require(isinstance(item, dict) and set(item) == {'scope', 'name', 'bytes', 'sha256'}
                 and item['scope'] in {'github-pr360', 'sheets-synthetic'}
                 and isinstance(item['name'], str) and 0 < len(item['name']) <= 255
                 and not any(c in item['name'] for c in '/\\\x00')
                 and _integer(item['bytes'], 1, 100_000_000)
                 and isinstance(item['sha256'], str)
                 and re.fullmatch(r'[a-f0-9]{64}', item['sha256']), 'INVALID_SAVED_MATERIALS')
    _require({item['scope'] for item in materials} == {'github-pr360', 'sheets-synthetic'}
             and len({item['sha256'] for item in materials}) == 2, 'INVALID_SAVED_MATERIALS')
    return {'schemaVersion': 1, 'baselineMaxAttempts': 41, 'baselineAttempts': 41,
            'baselineSHA256': _digest(entries[:41]), 'additionalAttempts': 16,
            'maxAttempts': 57, 'model': 'qwen3.8-max', 'maxOutputTokens': 4096,
            'allowedScopes': ['github-pr360', 'sheets-synthetic'], 'automaticRetries': 0,
            'freshOriginalDownloads': {'github-pr360': 0, 'sheets-synthetic': 0},
            'allowedTools': ['read_task_file', 'analyze_task_table', 'create_file', 'finish'],
            'runtimeSourceCommit': runtime_source,
            'materials': sorted(copy.deepcopy(materials), key=lambda item: item['scope']),
            'approved': False, 'authorizationRef': None}


def prepare_saved_extension(state, extension, *, runtime_source, materials):
    """Pure, unapproved second proposal for saved inputs; no live policy activation."""
    entries = _extension_ledger(state, extension)
    _require(state['maxAttempts'] == 41 and len(entries) == 41,
             'EXHAUSTED_SAVED_BASELINE_REQUIRED')
    return _saved_template(entries, runtime_source, materials)


def _saved_request(policy, scope, model, max_tokens, material_sha, runtime_source, tool_names):
    material = next((item for item in policy['materials'] if item['scope'] == scope), None)
    _require(material is not None and model == policy['model']
             and _integer(max_tokens, 1, 4096)
             and material_sha == material['sha256']
             and runtime_source == policy['runtimeSourceCommit']
             and isinstance(tool_names, (list, tuple)) and bool(tool_names)
             and all(isinstance(name, str) and name in policy['allowedTools'] for name in tool_names)
             and len(set(tool_names)) == len(tool_names), 'SAVED_REQUEST_OUT_OF_SCOPE')


def _saved_extension_ledger(state, extension, saved_extension):
    _require(isinstance(state, dict) and type(state.get('maxAttempts')) is int
             and state['maxAttempts'] in (41, 57), 'INVALID_LEDGER_POLICY')
    entries = _ledger(state, state['maxAttempts'])
    _require(len(entries) >= 41, 'SAVED_BASELINE_REQUIRED')
    baseline = {**state, 'maxAttempts': 41, 'attempts': entries[:41]}
    _extension_ledger(baseline, extension)
    _require(isinstance(saved_extension, dict), 'INVALID_SAVED_EXTENSION_POLICY')
    expected = _saved_template(entries, saved_extension.get('runtimeSourceCommit'),
                               saved_extension.get('materials'))
    _require(set(saved_extension) == set(expected), 'INVALID_SAVED_EXTENSION_POLICY')
    _require(saved_extension['approved'] is True
             and isinstance(saved_extension['authorizationRef'], str)
             and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}',
                              saved_extension['authorizationRef']),
             'EXPLICIT_SAVED_EXTENSION_APPROVAL_REQUIRED')
    _require(saved_extension['baselineSHA256'] == expected['baselineSHA256'],
             'SAVED_EXTENSION_BASELINE_MISMATCH')
    fields = set(expected) - {'approved', 'authorizationRef'}
    _require(_digest({key:saved_extension[key] for key in fields})
             == _digest({key:expected[key] for key in fields}), 'INVALID_SAVED_EXTENSION_POLICY')
    seen = {entry['bodySHA256'] for entry in entries[:41]}
    for entry in entries[41:]:
        _saved_request(saved_extension, entry['scope'], entry['model'], entry['maxTokens'],
                       entry.get('savedInputSHA256'), entry.get('runtimeSourceCommit'),
                       entry.get('toolNames'))
        _require(entry['bodySHA256'] not in seen, 'BODY_REPLAY_FORBIDDEN')
        seen.add(entry['bodySHA256'])
    return entries


def extend_saved_ledger(state, extension, saved_extension):
    """Return a separate value after explicit approval; caller owns any disk activation."""
    _require(isinstance(state, dict) and state.get('maxAttempts') == 41,
             'EXHAUSTED_SAVED_BASELINE_REQUIRED')
    entries = _saved_extension_ledger(state, extension, saved_extension)
    _require(len(entries) == 41, 'EXHAUSTED_SAVED_BASELINE_REQUIRED')
    return {**copy.deepcopy(state), 'maxAttempts': 57}


def seal_audit(state, audit_bytes, *, extension=None, saved_extension=None):
    """Seal only already verified, complete local metadata; does not alter any ledger."""
    entries = (_saved_extension_ledger(state, extension, saved_extension)
               if saved_extension is not None else
               _ledger(state) if extension is None else _extension_ledger(state, extension))
    _require(bool(entries), 'EMPTY_AUDIT_PREFIX')
    audit = _json(audit_bytes)
    _audit(entries, audit)
    return {'schemaVersion': 1, 'prefixCount': len(entries), 'prefixSHA256': _digest(entries),
            'auditSHA256': hashlib.sha256(audit_bytes).hexdigest()}


def authorize(state, scope, body_sha, permits=(), *, extension=None, model=None, max_tokens=None,
              saved_extension=None, material_sha=None, runtime_source=None, tool_names=None):
    """Read-only admission for a new request, never permission to resume an old task."""
    entries = (_saved_extension_ledger(state, extension, saved_extension)
               if saved_extension is not None else
               _ledger(state) if extension is None else _extension_ledger(state, extension))
    limit = 25
    if saved_extension is not None:
        _require(state['maxAttempts'] == 57, 'SAVED_EXTENSION_LEDGER_NOT_MIGRATED')
        _saved_request(saved_extension, scope, model, max_tokens,
                       material_sha, runtime_source, tool_names)
        limit = 57
    elif extension is not None:
        _require(state['maxAttempts'] == 41, 'EXTENSION_LEDGER_NOT_MIGRATED')
        _require(scope in extension['allowedScopes'] and model == extension['model']
                 and _integer(max_tokens, 1, 4096), 'EXTENSION_REQUEST_OUT_OF_SCOPE')
        limit = 41
    _require(scope in {'connectivity-probe', 'github-pr360', 'sheets-synthetic'}
             and isinstance(body_sha, str) and re.fullmatch(r'[a-f0-9]{64}', body_sha),
             'INVALID_NEW_REQUEST')
    _require(not (scope == 'connectivity-probe'
                 and any(entry['scope'] == scope for entry in entries)), 'PROBE_ALREADY_ATTEMPTED')
    _require(len(entries) < limit, 'BUDGET_EXHAUSTED')
    if extension is not None:
        _require(not any(entry['bodySHA256'] == body_sha for entry in entries),
                 'BODY_REPLAY_FORBIDDEN')
    _require(not any(entry['state'] == 'unknown' and entry['bodySHA256'] == body_sha
                     for entry in entries), 'UNKNOWN_BODY_REPLAY_FORBIDDEN')
    reconciled = set()
    for seal, audit_bytes in permits:
        _require(isinstance(seal, dict) and set(seal) ==
                 {'schemaVersion', 'prefixCount', 'prefixSHA256', 'auditSHA256'}
                 and type(seal['schemaVersion']) is int and seal['schemaVersion'] == 1
                 and _integer(seal['prefixCount'], 1, len(entries)), 'INVALID_AUDIT_SEAL')
        _require(_digest(entries[:seal['prefixCount']]) == seal['prefixSHA256'], 'AUDIT_PREFIX_MISMATCH')
        _require(isinstance(audit_bytes, bytes)
                 and hashlib.sha256(audit_bytes).hexdigest() == seal['auditSHA256'], 'AUDIT_HASH_MISMATCH')
        reconciled.add(_audit(entries[:seal['prefixCount']], _json(audit_bytes)))
    _require(all(index in reconciled for index, entry in enumerate(entries, 1)
                 if entry['state'] == 'unknown'), 'UNRESOLVED_PROVIDER_UNKNOWN')


def write_ledger(path, state):
    """Crash-safe reservation before dispatch; the private relay holds its separate serial lock."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)
