"""Local acceptance policy, not production execution authority or a billing verifier.

Audit bytes are operator-verified local evidence, not provider-signed receipts.
The relay loads them only from its fixed private directory, never from model input.
"""
from datetime import datetime, timezone
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


def _ledger(state):
    _require(isinstance(state, dict) and type(state.get('maxAttempts')) is int
             and state['maxAttempts'] == 25 and state.get('providerCredentialsCopied') is False,
             'INVALID_LEDGER_POLICY')
    entries = state.get('attempts')
    _require(isinstance(entries, list) and len(entries) <= 25, 'INVALID_LEDGER_POLICY')
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
        for number, candidate in enumerate(prefix, 1):
            start = _utc(candidate['startedAtUTC'])
            end = _utc(candidate['finishedAtUTC']) if candidate.get('finishedAtUTC') else None
            if candidate['model'] == row['model'] and 0 <= (observed - start).total_seconds() <= 15:
                if end is None or observed < end:
                    possible.append(number)
        _require(possible == [index], 'AMBIGUOUS_OR_UNMATCHED_AUDIT_TIME')
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


def seal_audit(state, audit_bytes):
    """Seal only already verified, complete local metadata; does not alter any ledger."""
    entries = _ledger(state)
    _require(bool(entries), 'EMPTY_AUDIT_PREFIX')
    audit = _json(audit_bytes)
    _audit(entries, audit)
    return {'schemaVersion': 1, 'prefixCount': len(entries), 'prefixSHA256': _digest(entries),
            'auditSHA256': hashlib.sha256(audit_bytes).hexdigest()}


def authorize(state, scope, body_sha, permits=()):
    """Read-only admission for a new request, never permission to resume an old task."""
    entries = _ledger(state)
    _require(scope in {'connectivity-probe', 'github-pr360', 'sheets-synthetic'}
             and isinstance(body_sha, str) and re.fullmatch(r'[a-f0-9]{64}', body_sha),
             'INVALID_NEW_REQUEST')
    _require(not (scope == 'connectivity-probe'
                 and any(entry['scope'] == scope for entry in entries)), 'PROBE_ALREADY_ATTEMPTED')
    _require(len(entries) < 25, 'BUDGET_EXHAUSTED')
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
