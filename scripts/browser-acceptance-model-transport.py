"""Acceptance-only HTTP primitives; callers retain endpoint and credential authority.

Both functions are self-contained so the existing SSH program embeds their exact
tested source. No retries, credential acquisition or ledger mutation happen here.
"""


def bounded_http(request, *, timeout_seconds=75, max_bytes=2 * 1024 * 1024):
    import math
    import signal
    import time
    import urllib.error
    import urllib.request

    if (type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds)
            or not 0 < timeout_seconds <= 75 or type(max_bytes) is not int
            or not 1 <= max_bytes <= 2 * 1024 * 1024):
        raise ValueError('INVALID_PROVIDER_BUDGET')
    if signal.getitimer(signal.ITIMER_REAL)[0]:
        raise RuntimeError('DEADLINE_ALREADY_ACTIVE')

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):
            return None

    def expired(_number, _frame):
        raise TimeoutError('PROVIDER_TOTAL_DEADLINE')

    previous = signal.signal(signal.SIGALRM, expired)
    response = None
    start = time.monotonic()
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        opener = urllib.request.build_opener(NoRedirect())
        try:
            response = opener.open(request, timeout=timeout_seconds)
        except urllib.error.HTTPError as error:
            response = error
        except urllib.error.URLError as error:
            if isinstance(error.reason, TimeoutError):
                raise TimeoutError('PROVIDER_TOTAL_DEADLINE') from None
            raise
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError('PROVIDER_RESPONSE_TOO_LARGE')
        selected = {}
        for name in ['x-request-id', 'request-id']:
            value = response.headers.get(name)
            if isinstance(value, str) and len(value) <= 256:
                selected[name] = value
        return {'status': response.status, 'body': body, 'headers': selected,
                'contentType': response.headers.get('Content-Type', 'application/json'),
                'elapsedMs': round((time.monotonic() - start) * 1000, 2)}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if response is not None:
            response.close()


def receipt_metadata(status, headers, body, *, credential=None):
    import json
    import re

    def identifier(value):
        if (isinstance(value, str) and 1 <= len(value) <= 160
                and re.fullmatch(r'[A-Za-z0-9_.:-]+', value)
                and not value.startswith('sk-') and not (credential and credential in value)):
            return value
        return None

    try:
        decoded = json.loads(body)
        if not isinstance(decoded, dict): decoded = {}
    except (ValueError, UnicodeError):
        decoded = {}
    source = None
    request_id = None
    normalized_headers = {key.lower(): value for key, value in headers.items()
                          if isinstance(key, str) and key.lower() in ['x-request-id', 'request-id']}
    for name in ['x-request-id', 'request-id']:
        request_id = identifier(normalized_headers.get(name))
        if request_id:
            source = f'header.{name}'
            break
    if not request_id:
        request_id = identifier(decoded.get('request_id'))
        if request_id: source = 'body.request_id'
    usage = {}
    raw_usage = decoded.get('usage')
    if isinstance(raw_usage, dict):
        for name in ['input_tokens', 'output_tokens', 'total_tokens',
                     'cache_read_input_tokens', 'cache_creation_input_tokens']:
            value = raw_usage.get(name)
            if type(value) is int and 0 <= value <= 1_000_000_000:
                usage[name] = value
    return {'httpStatus': status, 'providerRequestId': request_id,
            'requestIdSource': source, 'providerMessageId': identifier(decoded.get('id')),
            'usage': usage}
