"""Original one-shot application reservation. No socket, process or ready claim."""
import hashlib
import hmac
import math
import time

from quartet_journal import PreparedQuartet, _random, prepare_quartet
from quartet_protocol import QuartetCreateRequest, encode_control_frame, control_prepared_digest
from resource_journal import ResourceJournal


def _deny():
    try:
        raise ValueError('POOL_BROKER_CREATE_OFFER_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class _CreateOffer:
    def __init__(self): raise TypeError('private original create offer')
    def __reduce_ex__(self, _protocol): raise TypeError('private original create offer')

    @classmethod
    def open(cls, journal, request, *, deadline_ns=None, scope_guard=None):
        item = object.__new__(cls)
        item._retired, item._busy = False, False
        item._sent = item._accept_attempted = item._accepted = item._consumed = False
        item._frame = item._prepared = item._resource = None
        item._scope_guard = scope_guard
        try:
            if type(journal) is not ResourceJournal or type(request) is not QuartetCreateRequest:
                raise ValueError()
            if scope_guard is not None and not callable(scope_guard): raise ValueError()
            item._journal, item._request = journal, request
            item._registration, item._pin = journal._registration, journal._pin
            item._last_ns = time.monotonic_ns()
            if type(item._last_ns) is not int or not 0 <= item._last_ns < 2**63 - 60000000000: raise ValueError()
            item._deadline_ns = item._last_ns + 60000000000
            if deadline_ns is not None:
                if type(deadline_ns) is not int or not item._last_ns < deadline_ns <= item._deadline_ns: raise ValueError()
                item._deadline_ns = deadline_ns
            item._budget()
            item._prepared = prepare_quartet(journal, request, fresh=True, scope_guard=item._budget)
            item._resource = next((key for key, value in journal._handles.items() if value is item._prepared), None)
            if item._resource is None: raise ValueError()
            def prepare():
                group = item._eligible()
                nonce = journal._io(_random, 32)
                item._scope = {key: group[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
                item._frame = encode_control_frame(item._scope | {'phase': 'prepared',
                    'capability': group['capability'], 'egressCapability': group['egressCapability'], 'nonce': nonce})
                item._digest = control_prepared_digest(item._frame)
                journal._append({'version': 2, 'action': 'create_offer', 'resource': item._resource,
                    'preparedDigest': item._digest, 'nonceDigest': hashlib.sha256(bytes.fromhex(nonce)).hexdigest()})
            item._run(prepare)
            return item
        except Exception:
            item.close()
            _deny()

    def _veto(self):
        journal, registration, pin = self._journal, self._registration, self._pin
        if (self._retired or journal._retired or registration._revoked or not registration._received
                or journal._registration is not registration or journal._pin is not pin
                or registration._pin is not pin or pin._fd is None
                or journal._boot != self._request.boot or journal._candidate != registration._candidate.hex()
                or self._resource is not None and (type(self._prepared) is not PreparedQuartet
                    or journal._handles.get(self._resource) is not self._prepared)):
            raise ValueError()

    def _budget(self):
        now = time.monotonic_ns()
        if type(now) is not int or now < self._last_ns or now >= self._deadline_ns: raise ValueError()
        self._last_ns = now
        scope = self._scope_guard
        outer = scope() if scope is not None else None
        if scope is not self._scope_guard or scope is not None and (
                type(outer) not in (int, float) or not math.isfinite(outer) or outer <= 0): raise ValueError()
        self._veto()
        remaining = (self._deadline_ns - now) / 1000000000
        return min(remaining, outer) if outer is not None else remaining

    def _eligible(self):
        self._budget()
        group = self._journal._resources[self._resource]
        if group['state'] != 'prepared' or group['roles'] or 'material' in group: raise ValueError()
        return group

    def _run(self, operation):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy = True
        try:
            self._budget()
            value = self._journal._run(operation, self._budget)
            self._budget()  # Covers the tail after journal's own scope is released.
            return value
        except Exception:
            self.close()
            _deny()
        finally:
            self._busy = False

    def take_prepared(self):
        def take():
            group = self._eligible()
            if self._sent or group['createOffer']['state'] != 'offered': raise ValueError()
            self._sent = True
            return self._frame
        return self._run(take)

    def accept_frame(self, frame):
        def accept():
            group = self._eligible()
            if not self._sent or self._accept_attempted or group['createOffer']['state'] != 'offered': raise ValueError()
            self._accept_attempted = True
            expected = encode_control_frame(self._scope | {'phase': 'accepted', 'preparedDigest': self._digest})
            if type(frame) is not bytes or not hmac.compare_digest(frame, expected): raise ValueError()
            self._journal._append({'version': 2, 'action': 'create_accept', 'resource': self._resource,
                                   'preparedDigest': self._digest})
            self._accepted = True
        self._run(accept)

    def consume(self):
        def consume():
            group = self._eligible()
            if not self._accepted or self._consumed or group['createOffer']['state'] != 'accepted': raise ValueError()
            self._consumed = True
            return self._prepared
        return self._run(consume)

    def close(self):
        self._retired, self._frame = True, None
        # The original writer and all durable unknown state belong to runtime.
