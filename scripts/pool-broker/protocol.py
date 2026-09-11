"""Untrusted broker request data only: decoding never grants authority."""

import json
import re
from dataclasses import dataclass, field


class BrokerRequestError(ValueError):
    """Fixed rejection with no untrusted payload attached."""


@dataclass(frozen=True, slots=True)
class CreateRequest:
    version: int
    action: str
    request_id: str = field(repr=False)
    boot: str = field(repr=False)
    component: str
    slot: int


@dataclass(frozen=True, slots=True)
class ResourceRequest:
    version: int
    action: str
    request_id: str = field(repr=False)
    boot: str = field(repr=False)
    capability: str = field(repr=False)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _reject_constant(_value):
    raise ValueError()


def _identifier(value, length):
    if type(value) is not str or re.fullmatch(r"[0-9a-f]{%d}" % length, value) is None:
        raise ValueError()
    if value == "0" * length:
        raise ValueError()
    return value


def _decode(payload):
    if type(payload) is not bytes or not 1 <= len(payload) <= 4096:
        raise ValueError()
    value = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object,
                       parse_constant=_reject_constant)
    if type(value) is not dict or type(value.get("version")) is not int or value["version"] != 1:
        raise ValueError()
    action = value.get("action")
    if type(action) is not str or action not in ("create", "query", "close"):
        raise ValueError()
    required = {"version", "action", "requestId", "boot"}
    required.update(("component", "slot") if action == "create" else ("capability",))
    if set(value) != required:
        raise ValueError()
    common = (1, action, _identifier(value["requestId"], 32), _identifier(value["boot"], 32))
    if action == "create":
        component, slot = value["component"], value["slot"]
        if type(component) is not str or component not in ("xvfb", "brave", "x11vnc", "websockify"):
            raise ValueError()
        if type(slot) is not int or not 0 <= slot < 32:
            raise ValueError()
        return CreateRequest(*common, component, slot)
    return ResourceRequest(*common, _identifier(value["capability"], 64))


def decode_request(payload: bytes) -> CreateRequest | ResourceRequest:
    """Validate one bounded payload; transport, peer and capability checks are separate."""
    try:
        return _decode(payload)
    except (ValueError, TypeError, KeyError, RecursionError, OverflowError):
        pass
    # Raise outside the handler: even __context__ must not retain a parser
    # exception with its original JSON document or byte sequence.
    raise BrokerRequestError("POOL_BROKER_REQUEST_INVALID") from None
