"""Whole-group request data. No resource authority, dispatch, or legacy upgrade."""
import json
import hashlib
import hmac
import struct
from dataclasses import dataclass, field

from protocol import _identifier, _unique_object, _reject_constant


def _derive_data_key(management, candidate, boot, resource):
    # RFC5869 single-block Expand. The original management value is already
    # a random 256-bit PRK; only this scoped child reaches the non-root anchor.
    try:
        for value, size in ((management, 64), (candidate, 40), (boot, 32), (resource, 32)):
            _identifier(value, size)
        info = b'HoladayPool/CDP-VNC/data-key/v1\0' + bytes.fromhex(candidate + boot + resource)
        return hmac.new(bytes.fromhex(management), info + b'\x01', hashlib.sha256).hexdigest()
    except Exception:
        pass
    try:
        raise ValueError('POOL_BROKER_DATA_KEY_INVALID') from None
    except ValueError as error:
        error.__context__ = None
        raise


@dataclass(frozen=True, slots=True)
class QuartetCreateRequest:
    version: int
    action: str
    request_id: str = field(repr=False)
    boot: str = field(repr=False)
    slot: int


@dataclass(frozen=True, slots=True)
class QuartetResourceRequest:
    version: int
    action: str
    request_id: str = field(repr=False)
    boot: str = field(repr=False)
    capability: str = field(repr=False)


def _decode(payload):
    if type(payload) is not bytes or not 1 <= len(payload) <= 4096:
        raise ValueError()
    data = json.loads(payload.decode('utf-8'), object_pairs_hook=_unique_object,
                      parse_constant=_reject_constant)
    if type(data) is not dict or type(data.get('version')) is not int or data['version'] != 2:
        raise ValueError()
    action = data.get('action')
    if type(action) is not str or action not in ('create', 'query', 'close'):
        raise ValueError()
    fields = {'version', 'action', 'requestId', 'boot'} | (
        {'slot'} if action == 'create' else {'capability'})
    if set(data) != fields:
        raise ValueError()
    common = (2, action, _identifier(data['requestId'], 32), _identifier(data['boot'], 32))
    if action == 'create':
        slot = data['slot']
        if type(slot) is not int or not 0 <= slot < 32:
            raise ValueError()
        return QuartetCreateRequest(*common, slot)
    return QuartetResourceRequest(*common, _identifier(data['capability'], 64))


def decode_quartet_request(payload: bytes) -> QuartetCreateRequest | QuartetResourceRequest:
    try:
        return _decode(payload)
    except (ValueError, TypeError, KeyError, RecursionError, OverflowError):
        pass
    try:
        raise ValueError('POOL_BROKER_QUARTET_REQUEST_INVALID') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _control_deny():
    try:
        raise ValueError('POOL_BROKER_CONTROL_FRAME_INVALID') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _control_payload(data):
    # These codecs carry data, not readiness or permission. Only the original
    # socket transaction and its durable state machine can consume a phase.
    if type(data) is not dict or type(data.get('version')) is not int or data['version'] != 2:
        raise ValueError()
    raw = json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    if not 1 <= len(raw) <= 4096: raise ValueError()
    if 'action' in data:
        decode_quartet_request(raw)
        return raw
    common = {'version', 'phase', 'requestId', 'candidate', 'boot', 'resource', 'slot'}
    phase = data.get('phase')
    if type(phase) is not str or phase not in ('prepared', 'accepted', 'ready'): raise ValueError()
    extra = {'capability', 'egressCapability', 'nonce'} if phase == 'prepared' else {'preparedDigest'}
    if set(data) != common | extra or type(data['slot']) is not int or not 0 <= data['slot'] < 32:
        raise ValueError()
    for name, width in (('requestId', 32), ('candidate', 40), ('boot', 32), ('resource', 32)):
        _identifier(data[name], width)
    for name in extra: _identifier(data[name], 64)
    if phase == 'prepared' and len({data[name] for name in extra}) != 3: raise ValueError()
    return raw


def encode_control_frame(data):
    try:
        raw = _control_payload(data)
        return struct.pack('!I', len(raw)) + raw
    except Exception:
        pass
    _control_deny()


def decode_control_frame(frame):
    try:
        if type(frame) is not bytes or not 5 <= len(frame) <= 4100: raise ValueError()
        size = struct.unpack('!I', frame[:4])[0]
        if size != len(frame) - 4: raise ValueError()
        data = json.loads(frame[4:].decode('ascii'), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
        if _control_payload(data) != frame[4:]: raise ValueError()
        return data
    except Exception:
        pass
    _control_deny()


def control_prepared_digest(frame):
    try:
        if decode_control_frame(frame).get('phase') != 'prepared': raise ValueError()
        return hashlib.sha256(frame).hexdigest()
    except Exception:
        pass
    _control_deny()


def _boot_payload(data):
    # Separate from every business action/phase. Metadata binds a handshake;
    # it never grants resource creation or maintenance opening authority.
    if type(data) is not dict or type(data.get('version')) is not int or data['version'] != 2:
        raise ValueError()
    phase = data.get('phase')
    if type(phase) is not str or phase not in ('boot-hello', 'boot-challenge', 'boot-accepted', 'boot-ack'):
        raise ValueError()
    fields = {'version', 'phase', 'candidate', 'boot', 'clientNonce'}
    if phase != 'boot-hello': fields |= {'rootNonce', 'epoch'}
    if set(data) != fields: raise ValueError()
    for name in fields - {'version', 'phase'}:
        _identifier(data[name], 40 if name == 'candidate' else 32)
    if phase != 'boot-hello' and data['clientNonce'] == data['rootNonce']: raise ValueError()
    return json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def encode_boot_frame(data):
    try:
        raw = _boot_payload(data)
        return struct.pack('!I', len(raw)) + raw
    except Exception:
        pass
    _control_deny()


def decode_boot_frame(frame):
    try:
        if type(frame) is not bytes or not 5 <= len(frame) <= 1028: raise ValueError()
        if struct.unpack('!I', frame[:4])[0] != len(frame) - 4: raise ValueError()
        data = json.loads(frame[4:].decode('ascii'), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
        if _boot_payload(data) != frame[4:]: raise ValueError()
        return data
    except Exception:
        pass
    _control_deny()
